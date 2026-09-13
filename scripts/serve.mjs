/**
 * 极简静态文件服务器，只为在浏览器里打开原型用。
 *
 * 不用 vite / http-server 是为了让原型零额外依赖 —— esbuild 已经够了，
 * 再拉一个 dev server 进来只是给这个「验证装置」增加维护面。
 *
 * 监听 0.0.0.0 是刻意的：手机要连同一局域网访问它来实测 WebView 帧率（ADR-005）。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { networkInterfaces } from "node:os";

const root = resolve(process.argv[2] ?? ".");
const port = Number(process.env.PORT ?? 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";

    // 防目录穿越
    const target = resolve(join(root, normalize(rel)));
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404");
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target)] ?? "application/octet-stream",
      // 原型要反复改反复看，别缓存
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(e));
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`  本机     http://localhost:${port}/`);
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === "IPv4" && !n.internal) {
        console.log(`  手机实测 http://${n.address}:${port}/`);
      }
    }
  }
  console.log(`\n  根目录   ${root}`);
});
