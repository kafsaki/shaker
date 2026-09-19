/**
 * 经典配方封面截帧导入（一次性工具，可幂等重跑）。
 *
 * 流程：对每个无封面的经典配方，Playwright（Edge/Chromium headless）打开
 * /r/{code}?__cover=1 → 调用页面暴露的 window.__shakerCover（与编辑器发布
 * 走同一条 captureCover 路径，ADR-015 同源逻辑）→ PNG 直传 MinIO
 * （服务端有凭证，不走 presign）→ 写 media_assets（committed 直接置位，
 * owner=官方账号）→ UPDATE recipes.cover_url。
 *
 * 幂等：默认跳过已有封面的配方；--force 全部重截（revision 递增出新 key，
 * recipes.cover_url 指向最新版，旧版留给孤儿清理任务处理）。
 *
 * 环境变量与 API 同名同默认值（apps/api/internal/config）：
 *   SHAKER_DATABASE_URL / SHAKER_S3_ENDPOINT / SHAKER_S3_BUCKET /
 *   SHAKER_S3_ACCESS_KEY / SHAKER_S3_SECRET_KEY / SHAKER_S3_PUBLIC_URL
 * 另有 SHAKER_WEB_BASE（默认 http://localhost:3000）。
 */
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
const FORCE = process.argv.includes("--force");

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

const { rows: classicsAll } = await pool.query(`
  SELECT id, short_no, title, cover_url FROM recipes
  WHERE is_canonical AND status = 'published' AND deleted_at IS NULL
  ORDER BY short_no`);
const todo = classicsAll.filter((c) => FORCE || !c.cover_url);

const { rows: official } = await pool.query(
  `SELECT id FROM users WHERE is_official LIMIT 1`);
if (!official[0]) throw new Error("官方账号不存在：先启动 API 完成种子导入");

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

console.log(
  `经典配方 ${classicsAll.length} 个，本次处理 ${todo.length} 个${FORCE ? "（--force 全量重截）" : ""}`,
);

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let ok = 0;
let fail = 0;
for (const c of todo) {
  const code = base58(BigInt(c.short_no));
  try {
    await page.goto(`${WEB_BASE}/r/${code}?__cover=1`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    await page.waitForFunction(() => "__shakerCover" in window, null, {
      timeout: 30_000,
    });
    const shot = await page.evaluate(() => window.__shakerCover());
    if (!shot) throw new Error("封面帧未就绪（timeline 编译失败或超时）");

    const buf = Buffer.from(shot.dataUrl.split(",")[1], "base64");
    if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error("截帧产物不是 PNG");
    }

    // revision = 该实体已有媒体数 + 1（镜像 media.nextRevision；撞唯一键则递增重试）
    let rev =
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM media_assets
           WHERE entity_type = 'recipe_cover' AND entity_id = $1`,
          [c.id],
        )
      ).rows[0].n + 1;
    let key;
    for (;;) {
      key = `recipes/${c.id}/cover-${rev}.png`;
      try {
        await pool.query(
          `INSERT INTO media_assets
             (id, storage_key, owner_id, entity_type, entity_id,
              mime_type, byte_size, width, height, committed_at)
           VALUES ($1, $2, $3, 'recipe_cover', $4, 'image/png', $5, $6, $7, now())`,
          [uuidv7(), key, official[0].id, c.id, buf.length, shot.width, shot.height],
        );
        break;
      } catch (e) {
        if (e.code === "23505") {
          rev++;
          continue;
        }
        throw e;
      }
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buf,
        ContentType: "image/png",
      }),
    );
    await pool.query(`UPDATE recipes SET cover_url = $1 WHERE id = $2`, [
      `${S3_PUBLIC_URL}/${key}`,
      c.id,
    ]);
    ok++;
    console.log(`  ✓ ${code} ${c.title} → ${key}（${buf.length}B）`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${code} ${c.title}：${err.message}`);
  }
}

await browser.close();
await pool.end();
console.log(`完成：成功 ${ok}，失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
