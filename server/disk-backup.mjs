// MERIT Event Maker — automatic backup to DISK (the portable package's copy).
//
// The app keeps every event in the browser's own storage. One cleared browser
// profile loses all of it. When the page is served by the local relay
// (server/vlm-relay.mjs — the portable Windows package's server), the page also
// hands the relay a whole-install backup after changes, and this module writes
// it to a folder next to the package, where clearing the browser cannot reach.
//
// What it promises:
//   - a file is written WHOLE or not at all: temp file in the same folder,
//     fsync, then rename — a crash mid-write leaves the previous files intact;
//   - only a backup in the app's own format is accepted (the same marker the
//     page's validated restore path checks), within a size limit;
//   - rotation keeps the newest `keepLast` files plus the newest file of each
//     of the last `keepDays` days, so a bad hour cannot push out yesterday;
//   - a file is named by time and event count only. Nothing it logs, names or
//     answers in a list carries a guest's name or any other record content.
//
// It does not restore anything. Restoring is the page's job, through its one
// validated restore path (importBackupFile in src/app-v8.js): a file that
// fails there leaves the current state exactly as it was.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const BACKUP_FORMAT = "merit-event-maker-backup";
// merit-yedek-20261101-143005123-e3.json  (UTC date, time + ms, event count)
export const NAME_RE = /^merit-yedek-(\d{8})-(\d{9})-e(\d{1,6})\.json$/;
export const DEFAULTS = Object.freeze({ keepLast: 20, keepDays: 30, maxBytes: 64 * 1024 * 1024 });

const pad = (n, w = 2) => String(n).padStart(w, "0");
function stamp(ms) {
  const d = new Date(ms);
  return {
    day: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${pad(d.getUTCMilliseconds(), 3)}`,
  };
}
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// The relay's structural check. The page's restore path checks far more (every
// record, every reference, the schema version); this only refuses what is not
// a backup at all, so the folder never fills with something nobody can restore.
export function validateBackupText(text) {
  if (typeof text !== "string" || !text.length) return { ok: false, code: "BAD_PAYLOAD" };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, code: "BAD_JSON" }; }
  if (!isPlainObject(parsed) || parsed.format !== BACKUP_FORMAT || !Number.isInteger(parsed.formatVersion)) return { ok: false, code: "NOT_A_BACKUP" };
  const p = parsed.payload;
  if (!isPlainObject(p) || !Array.isArray(p.events) || !p.events.every(isPlainObject)) return { ok: false, code: "NOT_A_BACKUP" };
  return { ok: true, events: p.events.length, payloadHash: crypto.createHash("sha256").update(JSON.stringify(p)).digest("hex") };
}

export function createBackupStore({ dir, keepLast = DEFAULTS.keepLast, keepDays = DEFAULTS.keepDays, maxBytes = DEFAULTS.maxBytes, now = Date.now } = {}) {
  if (!dir) return null;
  const root = path.resolve(dir);
  let lastHash = null, lastMs = 0;

  const ensureDir = () => fs.mkdirSync(root, { recursive: true });
  function list() {
    let names = [];
    try { names = fs.readdirSync(root); } catch { return []; }
    return names.map((name) => {
      const m = NAME_RE.exec(name);
      if (!m) return null;
      let size = 0;
      try { const st = fs.statSync(path.join(root, name)); if (!st.isFile()) return null; size = st.size; } catch { return null; }
      const [, day, time] = m;
      const at = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.${time.slice(6, 9)}Z`;
      return { name, day, at, events: Number(m[3]), size };
    }).filter(Boolean).sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  }

  // Keep the newest `keepLast`; of the rest, keep the newest file of each day
  // for the `keepDays` most recent days that have one. Everything else goes.
  function rotate() {
    const files = list();
    const keep = new Set(files.slice(0, keepLast).map((f) => f.name));
    const days = new Set();
    for (const f of files) {
      if (days.has(f.day)) continue;
      if (days.size >= keepDays) break;
      days.add(f.day); keep.add(f.name);
    }
    const removed = [];
    for (const f of files) if (!keep.has(f.name)) { try { fs.unlinkSync(path.join(root, f.name)); removed.push(f.name); } catch { /* left for the next rotation */ } }
    // a temp file left by a write that died half-way is never a backup
    try { for (const n of fs.readdirSync(root)) if (/^\.merit-yedek-.*\.tmp$/.test(n)) { try { fs.unlinkSync(path.join(root, n)); } catch { /* ignore */ } } } catch { /* ignore */ }
    return removed;
  }

  function write(text) {
    if (typeof text !== "string") return { ok: false, code: "BAD_PAYLOAD" };
    if (Buffer.byteLength(text) > maxBytes) return { ok: false, code: "PAYLOAD_TOO_LARGE" };
    const v = validateBackupText(text);
    if (!v.ok) return v;
    if (lastHash === null) { const newest = list()[0]; if (newest) { const back = read(newest.name); const vb = back.ok ? validateBackupText(back.text) : null; if (vb && vb.ok) lastHash = vb.payloadHash; } }
    if (v.payloadHash === lastHash) return { ok: true, unchanged: true, name: (list()[0] || {}).name || null };
    ensureDir();
    let t = now(); if (t <= lastMs) t = lastMs + 1; lastMs = t;
    const s = stamp(t);
    const name = `merit-yedek-${s.day}-${s.time}-e${v.events}.json`;
    const tmp = path.join(root, `.${name}.${crypto.randomBytes(4).toString("hex")}.tmp`);
    let fd = null;
    try {
      fd = fs.openSync(tmp, "wx");
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = null;
      fs.renameSync(tmp, path.join(root, name));
    } catch (err) {
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return { ok: false, code: "WRITE_FAILED", errorCode: err && err.code };
    }
    lastHash = v.payloadHash;
    const removed = rotate();
    return { ok: true, name, events: v.events, bytes: Buffer.byteLength(text), removed: removed.length };
  }

  function read(name) {
    if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, code: "BAD_NAME" };
    try { return { ok: true, text: fs.readFileSync(path.join(root, name), "utf8") }; }
    catch { return { ok: false, code: "NOT_FOUND" }; }
  }

  return { dir: root, keepLast, keepDays, maxBytes, list, write, read, rotate };
}

export function backupStoreFromEnv(env, fallbackDir) {
  if (env.MERIT_BACKUP_DIR === "off") return null;
  const n = (v, d) => { const x = Number(v); return Number.isInteger(x) && x > 0 ? x : d; };
  return createBackupStore({
    dir: env.MERIT_BACKUP_DIR || fallbackDir,
    keepLast: n(env.MERIT_BACKUP_KEEP, DEFAULTS.keepLast),
    keepDays: n(env.MERIT_BACKUP_KEEP_DAYS, DEFAULTS.keepDays),
    maxBytes: n(env.MERIT_BACKUP_MAX_MB, DEFAULTS.maxBytes / 1048576) * 1048576,
  });
}
