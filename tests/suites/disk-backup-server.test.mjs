// Automatic backup to DISK — the relay's side (server/disk-backup.mjs).
//
// A browser profile that is cleared takes every event with it. In the portable
// package the local relay also keeps whole-install backups in a folder next to
// the package. This suite holds the folder to its promises without a browser:
//   - a backup in the app's format is written WHOLE (temp + rename; no temp
//     file survives, an unchanged backup is not written twice);
//   - rotation keeps the newest N plus the newest of each day;
//   - the doors: a cross-site POST, a foreign Host, a missing relay header, an
//     oversize body, a body that is not JSON, and JSON that is not a backup are
//     each refused with nothing written; the list and the files need the same
//     same-site proof; a file name outside the pattern is never read;
//   - nothing a guest typed reaches the relay's log.
// The page's side (sending after a change, restoring through the validated
// path) is `disk-backup`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

export const meta = { name: "disk-backup-server", tags: ["storage", "security", "fast"], timeout: 60000 };

const GUEST = "ZEYNEP-PRIVATE-GUEST-NAME";
const backupText = (events) => JSON.stringify({ format: "merit-event-maker-backup", formatVersion: 1, exportedAt: new Date().toISOString(),
  payload: { version: 9, schemaVersion: 9, events } });
const eventWith = (id, guests = 1) => ({ id, name: `E ${id}`, tables: [{ id: `${id}-t1`, capacity: 4, chairs: [] }],
  guests: Array.from({ length: guests }, (_, i) => ({ id: `${id}-g${i}`, name: `${GUEST} ${i}`, pax: 1 })) });

export default async function run({ checks, repoRoot }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-disk-backup-"));
  const { createBackupStore, NAME_RE } = await import(path.join(repoRoot, "server/disk-backup.mjs"));
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));

  // ---- the store, on a clock we control ---------------------------------------
  let clock = Date.UTC(2026, 9, 1, 9, 0, 0);
  const sdir = path.join(tmp, "store");
  const store = createBackupStore({ dir: sdir, keepLast: 3, keepDays: 4, now: () => clock });
  const w1 = store.write(backupText([eventWith("a")]));
  checks.require(w1.ok && NAME_RE.test(w1.name), "a backup in the app's format is written under a time + event-count name", w1);
  checks.equal(JSON.parse(fs.readFileSync(path.join(sdir, w1.name), "utf8")).payload.events[0].id, "a", "the file holds the backup as sent");
  checks.ok(!w1.name.includes(GUEST) && !/ZEYNEP/i.test(w1.name), "a file name carries no record content", w1.name);
  const again = store.write(backupText([eventWith("a")]));
  checks.ok(again.ok && again.unchanged && store.list().length === 1, "an unchanged backup is not written a second time", again);
  checks.equal(fs.readdirSync(sdir).filter(n => n.endsWith(".tmp")).length, 0, "no temp file is left behind by a write");

  // rotation: ten days, three writes per day, newest 3 + newest of each of 4 days
  for (let d = 0; d < 10; d++) for (let h = 0; h < 3; h++) {
    clock = Date.UTC(2026, 9, 2 + d, 8 + h, 0, 0);
    const r = store.write(backupText([eventWith(`d${d}h${h}`)]));
    checks.require(r.ok && !r.unchanged, `rotation write day ${d} hour ${h}`, r);
  }
  const left = store.list();
  const days = [...new Set(left.map(f => f.day))];
  checks.equal(left.length, 6, "rotation keeps the newest 3 plus the newest of each of the 4 most recent days");
  checks.equal(days.length, 4, "one file per day survives for the most recent days");
  checks.ok(left[0].name > left[1].name && left[0].day === "20261011", "the newest backup is first and kept", left.map(f => f.name));
  const perOlderDay = days.slice(1).map(d => left.filter(f => f.day === d));
  checks.ok(perOlderDay.slice(1).every(fs_ => fs_.length === 1 && fs_[0].name.includes("-10")), "an older day keeps only its NEWEST file", left.map(f => f.name));

  // a write that fails half-way (simulated: a temp file left over) never shows up as a backup
  fs.writeFileSync(path.join(sdir, ".merit-yedek-20261011-999999999-e1.json.dead.tmp"), "{\"half");
  checks.ok(!store.list().some(f => f.name.includes("999999999")), "a half-written temp file is never listed as a backup");
  store.rotate();
  checks.equal(fs.readdirSync(sdir).filter(n => n.endsWith(".tmp")).length, 0, "rotation clears a temp file left by a dead write");

  // the store refuses what is not a backup and what is too large
  const small = createBackupStore({ dir: path.join(tmp, "small"), maxBytes: 2000 });
  checks.equal([small.write("{not json").code, small.write(JSON.stringify({ format: "other", payload: { events: [] } })).code,
    small.write(JSON.stringify({ format: "merit-event-maker-backup", formatVersion: 1, payload: { events: "x" } })).code,
    small.write(backupText([eventWith("big", 80)])).code],
  ["BAD_JSON", "NOT_A_BACKUP", "NOT_A_BACKUP", "PAYLOAD_TOO_LARGE"], "the store refuses bad JSON, a foreign file, a broken shape and an oversize body");
  checks.equal(fs.existsSync(path.join(tmp, "small")) ? fs.readdirSync(path.join(tmp, "small")).length : 0, 0, "and writes nothing for any of them");
  checks.equal([store.read("../secret.json").code, store.read("merit-yedek-x.json").code, store.read("merit-yedek-20261011-080000000-e1.json/../../x").code],
    ["BAD_NAME", "BAD_NAME", "BAD_NAME"], "a name outside the pattern is never read (no path escapes)");

  // ---- the relay's doors ------------------------------------------------------
  const lines = [], log = { log: (l) => lines.push(String(l)), error: (l) => lines.push(String(l)) };
  const config = core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "relay-data"), PORT: "0" }, { repoRoot });
  const rdir = path.join(tmp, "relay-backups");
  const relay = await startRelay({ config, client: null, log, backups: createBackupStore({ dir: rdir, maxBytes: 4000 }) });
  const off = await startRelay({ config: core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "relay-off"), PORT: "0" }, { repoRoot }), client: null, log });
  try {
    const H = { "content-type": "application/json", "x-merit-relay": "1" };
    // node:http, not fetch: fetch will not send a forged Host header.
    const save = (body, headers = H, base = relay.baseUrl) => new Promise((resolve) => {
      const u = new URL(base + "/merit-backup/save");
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "content-length": Buffer.byteLength(body), ...headers } }, (res) => {
        const c = []; res.on("data", d => c.push(d)); res.on("end", () => { let j = null; try { j = JSON.parse(Buffer.concat(c).toString()); } catch { /* none */ } resolve({ http: res.statusCode, json: j }); });
      });
      req.on("error", () => resolve({ http: 0, json: null }));
      req.end(body);
    });
    const files = () => fs.existsSync(rdir) ? fs.readdirSync(rdir).filter(n => NAME_RE.test(n)) : [];

    const st0 = await fetch(relay.baseUrl + "/merit-backup/status").then(r => r.json());
    checks.ok(st0.ok && st0.enabled === true && st0.count === 0, "status says backups are on and none exist yet", st0);
    const stOff = await fetch(off.baseUrl + "/merit-backup/status").then(r => ({ http: r.status, j: r.json() }));
    checks.ok(stOff.http === 200 && (await stOff.j).enabled === false, "a relay started without a backup folder answers status with enabled:false (no 404 in the page's console)");

    const ok1 = await save(backupText([eventWith("r1")]));
    checks.require(ok1.http === 200 && ok1.json.ok && files().length === 1, "a same-site POST of a valid backup is written", ok1);

    const refusals = [
      ["cross-site Origin", await save(backupText([eventWith("x1")]), { ...H, origin: "https://evil.example" })],
      ["Sec-Fetch-Site cross-site", await save(backupText([eventWith("x2")]), { ...H, "sec-fetch-site": "cross-site" })],
      ["no relay header (a plain form)", await save(backupText([eventWith("x3")]), { "content-type": "application/json" })],
      ["foreign Host (DNS rebinding)", await save(backupText([eventWith("x4")]), { ...H, host: "evil.example" })],
      ["oversize body", await save(backupText([eventWith("x5", 80)]))],
      ["not JSON", await save("{\"format\":\"merit-event-maker-backup\",")],
      ["JSON that is not a backup", await save(JSON.stringify({ hello: "world" }))],
      ["wrong content type", await save(backupText([eventWith("x6")]), { "content-type": "text/plain", "x-merit-relay": "1" })],
    ];
    checks.equal(refusals.map(([n, r]) => `${n}:${r.http}`), ["cross-site Origin:403", "Sec-Fetch-Site cross-site:403", "no relay header (a plain form):403",
      "foreign Host (DNS rebinding):403", "oversize body:413", "not JSON:400", "JSON that is not a backup:400", "wrong content type:400"],
    "the relay refuses cross-site, foreign-host, oversize, bad-JSON, non-backup and wrong-type posts");
    checks.equal(files().length, 1, "and none of them wrote a file");

    const list = await fetch(relay.baseUrl + "/merit-backup/list", { headers: { "x-merit-relay": "1" } }).then(r => r.json());
    checks.ok(list.ok && list.files.length === 1 && list.files[0].events === 1, "the list names each backup with its time and event count", list);
    const listCross = await fetch(relay.baseUrl + "/merit-backup/list").then(r => r.status);
    const fileCross = await fetch(relay.baseUrl + "/merit-backup/file?name=" + encodeURIComponent(list.files[0].name), { headers: { "sec-fetch-site": "cross-site", "x-merit-relay": "1" } }).then(r => r.status);
    checks.equal([listCross, fileCross], [403, 403], "the list and the files need the same same-site proof as a save (they hold every guest)");
    const back = await fetch(relay.baseUrl + "/merit-backup/file?name=" + encodeURIComponent(list.files[0].name), { headers: { "x-merit-relay": "1" } }).then(r => r.json());
    checks.equal(back.payload.events[0].id, "r1", "a listed backup reads back as written");
    const badName = await fetch(relay.baseUrl + "/merit-backup/file?name=" + encodeURIComponent("../relay-data/usage.json"), { headers: { "x-merit-relay": "1" } }).then(r => r.status);
    checks.equal(badName, 400, "a file outside the backup pattern is refused by name");
    const offSave = await save(backupText([eventWith("o1")]), H, off.baseUrl);
    checks.equal(offSave.http, 404, "a relay without a backup folder writes nothing");

    checks.ok(!lines.some(l => l.includes(GUEST) || /ZEYNEP/i.test(l)), "no guest name reached the relay's log", lines.filter(l => /backup/.test(l)));
    checks.ok(lines.some(l => /backup written/.test(l)) && lines.some(l => /backup refused/.test(l)), "the log says what happened (names and sizes only)", lines.filter(l => /backup/.test(l)));
  } finally {
    await relay.close(); await off.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
