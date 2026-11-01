// THE ONE-CLICK DIAGNOSTIC REPORT CARRIES NO GUEST DATA
// (src/diagnose-report.js, server/vlm-relay.mjs /vlm-relay/diagnose;
// tools/local-vlm/windows/PRE-TRIAL-CHECKLIST.md line 11).
//
//   THE MACHINE'S SIDE. The local server answers versions, CPU, memory, backups
//     and models; a foreign Host is refused like every other relay door.
//   THE BROWSER'S SIDE. With a guest in the event and an error whose message
//     carries that guest's name, the report holds neither: storage as key names
//     and sizes, the error as kind/file/line.
// Mutation proof, recorded 2026-11-02: before the change there was no report
// and no /vlm-relay/diagnose door → every check fails.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { openApp, createBlankEvent, addGuest, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "diagnose-report", tags: ["privacy", "fast"], timeout: 180000 };
const SECRET = "Zübeyde Gizliadsoy";

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const { createBackupStore } = await import(path.join(repoRoot, "server/disk-backup.mjs"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-diag-"));
  const log = { log: () => {}, error: () => {} };
  const relay = await startRelay({ config: core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "d"), PORT: "0" }, { repoRoot }), client: null, log,
    backups: createBackupStore({ dir: path.join(tmp, "b") }) });
  try {
    const r = await fetch(relay.baseUrl + "/vlm-relay/diagnose").then((x) => x.json());
    checks.ok(r.ok && r.cpu.count > 0 && r.memoryMB.total > 0 && r.backups.enabled === true && typeof r.node === "string",
      "the local server reports its machine: CPU, memory, backups, versions", r);
    const foreign = await new Promise((resolve) => {
      const u = new URL(relay.baseUrl + "/vlm-relay/diagnose");
      http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", () => resolve(0));
    });
    checks.equal(foreign, 421, "a foreign Host is refused");
  } finally { await relay.close(); fs.rmSync(tmp, { recursive: true, force: true }); }

  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Tanı Testi" });
  await gotoTab(page, "guests");
  await addGuest(page, { name: SECRET });
  // an error whose message names the guest, as the page's own error event (a real uncaught throw
  // would also fail the runner's console check)
  await page.evaluate((n) => { const m = "guest " + n + " broke"; globalThis.dispatchEvent(new ErrorEvent("error", { error: new TypeError(m), message: m, filename: "http://x/src/app-v8.js", lineno: 12, colno: 3 })); }, SECRET);
  const rep = await page.evaluate(() => globalThis.MeritDiagnoseReport.build());
  const text = JSON.stringify(rep);
  checks.ok(rep && rep.kind === "merit-diagnose/1", "the report is built", rep && rep.kind);
  checks.ok(!text.includes("Gizliadsoy") && !text.includes("Zübeyde"), "it carries no guest name — not from storage, not from an error message");
  checks.ok(rep.errors.length >= 1 && rep.errors.every((e) => !("message" in e)), "the error is kept as kind/file/line only", rep.errors);
  checks.ok(Array.isArray(rep.storage.localStorage) && rep.storage.localStorage.every((k) => Object.keys(k).join() === "key,bytes"), "storage is reported as key names and sizes only", rep.storage.localStorage);
  checks.ok(rep.errors.some((e) => e.kind === "TypeError" && e.file === "app-v8.js" && e.line === 12), "the error's kind, file and line are kept", rep.errors);
}
