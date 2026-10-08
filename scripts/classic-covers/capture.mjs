/**
 * 经典配方封面截帧导入（一次性工具，可幂等重跑）。
 *
 * 流程：对每个已发布的经典配方，Playwright（Edge/Chromium headless）打开
 * /r/{code}?__cover=1 → 调用页面暴露的 window.__shakerCover（与编辑器发布
 * 走同一条 captureCover 路径，ADR-015 同源逻辑）→ 拿到暗/亮两套 PNG 直传 MinIO
 * （服务端有凭证，不走 presign）→ UPSERT media_assets 两行（variant=dark/light，
 * committed 直接置位，owner=官方账号）→ UPDATE recipes.cover_url / cover_url_light。
 *
 * 幂等：对象键固定为 recipes/{id}/cover-dark.png | cover-light.png（覆盖写，
 * 不再产生新版本）；media_assets 按 storage_key UPSERT（保留 committed_at）。
 * 迁移到固定键后，旧的带序号记录 cover-{rev}.png 与其对象成为孤儿，脚本顺手清理。
 *
 * 环境变量与 API 同名同默认值（apps/api/internal/config）：
 *   SHAKER_DATABASE_URL / SHAKER_S3_ENDPOINT / SHAKER_S3_BUCKET /
 *   SHAKER_S3_ACCESS_KEY / SHAKER_S3_SECRET_KEY / SHAKER_S3_PUBLIC_URL
 * 另有 SHAKER_WEB_BASE（默认 http://localhost:3000）。
 */
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { chromium } from "playwright-core";

const env = (k, d) => process.env[k] || d;
const DB_URL = env("SHAKER_DATABASE_URL", "postgres://shaker:shaker_dev@localhost:5432/shaker?sslmode=disable");
const S3_ENDPOINT = env("SHAKER_S3_ENDPOINT", "http://localhost:9000");
const S3_BUCKET = env("SHAKER_S3_BUCKET", "shaker-media");
const S3_ACCESS_KEY = env("SHAKER_S3_ACCESS_KEY", "shaker");
const S3_SECRET_KEY = env("SHAKER_S3_SECRET_KEY", "shaker_dev_secret");
const S3_PUBLIC_URL = env("SHAKER_S3_PUBLIC_URL", "http://localhost:9000/shaker-media");
const WEB_BASE = env("SHAKER_WEB_BASE", "http://localhost:3000");

/* base58：与 apps/api/internal/base58 完全一致（BTC 字符集）。 */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(n) {
  let s = "";
  do {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  } while (n > 0n);
  return s;
}

/* uuid v7：与后端 google/uuid 的 NewV7 同构（48bit 毫秒时间戳 + 随机）。 */
function uuidv7() {
  const ts = BigInt(Date.now());
  const rnd = randomUUID().replaceAll("-", "");
  const b = Buffer.alloc(16);
  for (let i = 5; i >= 0; i--) b[i] = Number((ts >> BigInt((5 - i) * 8)) & 0xffn);
  b.write(rnd.slice(12), 6, "hex"); // 后 10 字节取随机
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function launchBrowser() {
  // Windows 自带 Edge，避免下载 Playwright 浏览器；有缓存的 chromium 则用之
  for (const opt of [{ channel: "msedge" }, { channel: "chrome" }, {}]) {
    try {
      return await chromium.launch(opt);
    } catch (e) {
      // 换下一个候选
    }
  }
  throw new Error("找不到可用的浏览器（Edge / Chrome / chromium）");
}

const pool = new pg.Pool({ connectionString: DB_URL });

const { rows: classics } = await pool.query(`
  SELECT id, short_no, title FROM recipes
  WHERE is_canonical AND status = 'published' AND deleted_at IS NULL
  ORDER BY short_no`);

const { rows: official } = await pool.query(
  `SELECT id FROM users WHERE is_official LIMIT 1`);
if (!official[0]) throw new Error("官方账号不存在：先启动 API 完成种子导入");

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

/* 固定的暗/亮对象键：覆盖写，不留版本，故可反复重跑。 */
const keysOf = (id) => ({
  dark: `recipes/${id}/cover-dark.png`,
  light: `recipes/${id}/cover-light.png`,
});

/* UPSERT media_assets：storage_key 唯一，重跑覆盖元数据、保留 committed_at；
   首次写入直接置 committed（脚本已把对象传完）。 */
async function upsertAsset(id, key, variant, buf, width, height) {
  await pool.query(
    `INSERT INTO media_assets
       (id, storage_key, owner_id, entity_type, entity_id,
        mime_type, byte_size, width, height, variant, committed_at)
     VALUES ($1, $2, $3, 'recipe_cover', $4, 'image/png', $5, $6, $7, $8, now())
     ON CONFLICT (storage_key) DO UPDATE SET
       owner_id = EXCLUDED.owner_id,
       entity_type = EXCLUDED.entity_type,
       entity_id = EXCLUDED.entity_id,
       mime_type = EXCLUDED.mime_type,
       byte_size = EXCLUDED.byte_size,
       width = EXCLUDED.width,
       height = EXCLUDED.height,
       variant = EXCLUDED.variant,
       committed_at = COALESCE(media_assets.committed_at, now())`,
    [uuidv7(), key, official[0].id, id, buf.length, width, height, variant],
  );
}

/* 清理迁移前的孤儿：该实体除固定键外的旧记录（cover-{rev}.png）+ 桶内对象。 */
async function purgeLegacy(id, keep) {
  const { rows } = await pool.query(
    `SELECT id, storage_key FROM media_assets
     WHERE entity_type = 'recipe_cover' AND entity_id = $1
       AND storage_key <> ALL($2)`,
    [id, [keep.dark, keep.light]],
  );
  if (rows.length === 0) return 0;
  for (const r of rows) {
    await s3.send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: r.storage_key }),
    );
  }
  await pool.query(`DELETE FROM media_assets WHERE id = ANY($1)`, [
    rows.map((r) => r.id),
  ]);
  return rows.length;
}

console.log(`经典配方 ${classics.length} 个，全部重截（固定键覆盖写）`);

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let ok = 0;
let fail = 0;
for (const c of classics) {
  const code = base58(BigInt(c.short_no));
  try {
    await page.goto(`${WEB_BASE}/r/${code}?__cover=1`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    await page.waitForFunction(() => "__shakerCover" in window, null, {
      timeout: 30_000,
    });
    const shots = await page.evaluate(() => window.__shakerCover());
    if (!shots) throw new Error("封面帧未就绪（timeline 编译失败或超时）");

    const keys = keysOf(c.id);
    for (const variant of ["dark", "light"]) {
      const shot = shots[variant];
      const buf = Buffer.from(shot.dataUrl.split(",")[1], "base64");
      if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error(`${variant} 截帧产物不是 PNG`);
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: keys[variant],
          Body: buf,
          ContentType: "image/png",
        }),
      );
      await upsertAsset(c.id, keys[variant], variant, buf, shot.width, shot.height);
    }

    const purged = await purgeLegacy(c.id, keys);
    await pool.query(
      `UPDATE recipes SET cover_url = $1, cover_url_light = $2 WHERE id = $3`,
      [`${S3_PUBLIC_URL}/${keys.dark}`, `${S3_PUBLIC_URL}/${keys.light}`, c.id],
    );
    ok++;
    console.log(
      `  ✓ ${code} ${c.title} → cover-dark/light.png${purged ? `（清理旧版 ${purged} 个）` : ""}`,
    );
  } catch (err) {
    fail++;
    console.error(`  ✗ ${code} ${c.title}：${err.message}`);
  }
}

await browser.close();
await pool.end();
console.log(`完成：成功 ${ok}，失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);