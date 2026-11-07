// A static file server the test run owns.
//
// The scratchpad scripts all assumed `python3 -m http.server 8000` was already
// running in another terminal, and quietly produced nonsense when it had died
// (which it did, repeatedly). A test suite that depends on a human having
// started a server is not a one-command test suite, so the runner starts its
// own on an ephemeral port and shuts it down at the end.
//
// Node's own http module is used rather than python3 so the same command works
// on a machine that has Node and nothing else.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".traineddata": "application/octet-stream",
  ".gz": "application/gzip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function createHandler(root = REPO_ROOT) {
  return (req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      res.writeHead(400).end("bad path");
      return;
    }
    if (rel.endsWith("/")) rel += "index.html";
    // Resolve inside the served root, so a `..` in a URL cannot read the disk.
    const target = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!target.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.stat(target, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found: " + rel);
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
        "content-length": stat.size,
        "cache-control": "no-store",
      });
      fs.createReadStream(target).pipe(res);
    });
  };
}

// What a runner should call: an already-running server when MERIT_BASE_URL
// names one, otherwise one this process owns. No runner in this repo requires
// a human to have started `python3 -m http.server` in another terminal first.
export async function serveApp() {
  if (process.env.MERIT_BASE_URL) {
    return { baseUrl: process.env.MERIT_BASE_URL.replace(/\/$/, ""), close: async () => {} };
  }
  return startStaticServer();
}

export async function startStaticServer({ root = REPO_ROOT, host = "127.0.0.1", port = 0 } = {}) {
  const server = http.createServer(createHandler(root));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const bound = server.address().port;
  // The server must never be the reason a runner hangs at the end: it stays
  // alive only as long as the work that uses it.
  server.unref();
  return {
    baseUrl: `http://${host}:${bound}`,
    port: bound,
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}
