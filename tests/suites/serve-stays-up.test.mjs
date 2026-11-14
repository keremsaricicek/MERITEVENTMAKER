// `npm run serve` must keep serving until it is stopped (audit 2026-11-14, item 23).
//
//   THE MANUAL-REVIEW SERVER EXITS ON ITS OWN. tests/lib/server.mjs unref()s the
//   server so a test runner never hangs on it; tests/serve.mjs held nothing else
//   open, so the process printed its URL and exited at once.
// Mutation proof, recorded 2026-11-14: on 4b5d2b2 the process has exited before
// the 3 s probe and the request is refused.
import path from "node:path";
import net from "node:net";

export const meta = { name: "serve-stays-up", tags: ["structure", "fast"], timeout: 30000 };

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });

export default async function run({ checks, repoRoot }) {
  const { spawn } = await import("node:child_process");
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(repoRoot, "tests/serve.mjs")], { env: { PATH: process.env.PATH, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  let exited = false;
  child.on("exit", () => { exited = true; });
  try {
    await new Promise((r) => setTimeout(r, 3000));
    checks.ok(!exited, "the serve process is still running after 3 s");
    let status = 0;
    try { status = (await fetch(`http://127.0.0.1:${port}/index.html`)).status; } catch {}
    checks.equal(status, 200, "it still answers /index.html after 3 s");
  } finally {
    child.kill("SIGINT");
    await new Promise((r) => (exited ? r() : child.once("exit", r)));
  }
  checks.ok(exited, "ctrl-c (SIGINT) stops it");
}
