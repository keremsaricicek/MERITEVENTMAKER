(() => {
  "use strict";
  // AUTOMATIC BACKUP TO DISK — the page's side.
  //
  // Everything the app knows lives in this browser's storage; one cleared
  // browser profile loses every event. When the page was served by the local
  // relay (server/vlm-relay.mjs — the portable package's server, which names
  // itself in the navigation's Server-Timing), this module also hands the
  // relay a whole-install backup after the app saves, and the relay writes it
  // to a folder next to the package (server/disk-backup.mjs).
  //
  //   - It is hooked at the storage boundary (MeritStorageProviders' save), so
  //     it sees exactly the record that was stored -- never a different picture
  //     of `state` -- and needs no change in the app shell.
  //   - Debounced: a burst of saves is ONE backup, sent DEBOUNCE_MS after the
  //     last one. A timer retries a send that failed. A record with no events
  //     is never sent: it protects nothing, and it would push real backups out
  //     of the folder's rotation after a cleared browser opens blank.
  //   - Served any other way (the plain browser build, file://, the test
  //     server), it hooks nothing, sends nothing and shows nothing.
  //   - Restoring goes through the app's ONE validated restore path: the chosen
  //     file is handed to #backupFileInput exactly as if the operator had picked
  //     it, so importBackupFile() checks format, schema version, every record
  //     and every reference, asks before replacing, and leaves the current state
  //     intact when it refuses.
  const BASE = "/merit-backup/";
  const HEADERS = { "x-merit-relay": "1" };
  const DEBOUNCE_MS = () => { const v = Number(globalThis.MERIT_DISK_BACKUP_DEBOUNCE_MS); return Number.isFinite(v) && v >= 0 ? v : 4000; };
  const RETRY_MS = () => { const v = Number(globalThis.MERIT_DISK_BACKUP_RETRY_MS); return Number.isFinite(v) && v > 0 ? v : 5 * 60 * 1000; };

  function relayHere() {
    try {
      const n = globalThis.performance.getEntriesByType("navigation")[0];
      return !!(n && Array.isArray(n.serverTiming) && n.serverTiming.some((e) => e.name === "merit-relay"));
    } catch { return false; }
  }
  const served = relayHere();
  // "unknown" until the relay's status answers; "on" / "off" after.
  let status = served ? "unknown" : "off";
  let pending = null, lastSent = null, timer = null, sending = false, failed = false;

  const tr = (key, vars) => (typeof t === "function" ? t(key, vars) : key);
  const say = (key, type, vars) => { if (typeof toast === "function") toast(tr(key, vars), type, type === "error" ? 6500 : 3200); };

  // A stored record with at least one event. Parsed once per debounced send,
  // not once per save.
  const hasEvents = (raw) => { try { const p = JSON.parse(raw); return !!p && Array.isArray(p.events) && p.events.length > 0; } catch { return false; } };

  function note(raw) {
    if (status === "off" || typeof raw !== "string") return;
    pending = raw;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, DEBOUNCE_MS());
  }

  async function flush() {
    if (status !== "on" || sending || pending === null || pending === lastSent) return;
    const raw = pending;
    if (!hasEvents(raw)) { lastSent = raw; return; }
    sending = true;
    // The app's own backup format, built around the stored record verbatim.
    const body = `{"format":"merit-event-maker-backup","formatVersion":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"source":"disk-auto","payload":${raw}}`;
    try {
      const r = await fetch(BASE + "save", { method: "POST", headers: { ...HEADERS, "content-type": "application/json" }, body, cache: "no-store", credentials: "same-origin" });
      if (!r.ok) throw new Error("backup refused: " + r.status);
      lastSent = raw; failed = false;
    } catch (error) {
      failed = true;
      console.warn("Automatic disk backup did not reach the local server; it will be retried.", error && error.message);
    } finally {
      sending = false;
    }
    if (pending !== lastSent && !failed) flush();
  }

  if (served) {
    const P = globalThis.MeritStorageProviders;
    for (const C of [P && P.IndexedDBStorageProvider, P && P.LocalStorageStorageProvider]) {
      if (!C || !C.prototype || typeof C.prototype.save !== "function") continue;
      const save = C.prototype.save;
      C.prototype.save = async function (data, key) {
        const result = await save.call(this, data, key);
        if ((key === undefined || key === null || key === "root") && typeof data === "string") note(data);
        return result;
      };
    }
    fetch(BASE + "status", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (j) => {
        status = j && j.ok && j.enabled ? "on" : "off";
        if (status === "off") { document.querySelectorAll('[data-action="disk-backup-restore"]').forEach((b) => { b.hidden = true; }); return; }
        // a session's first backup: whatever is stored now (the relay skips it
        // when it equals the newest file)
        if (pending === null) {
          try { const raw = globalThis.MERIT_STORAGE_PROVIDER && await globalThis.MERIT_STORAGE_PROVIDER.load(); if (typeof raw === "string" && hasEvents(raw)) pending = raw; } catch (error) { console.warn("Disk backup could not read the stored record for its first copy.", error && error.name); }
        }
        flush();
        setInterval(() => { if (failed || (pending !== null && pending !== lastSent)) { failed = false; flush(); } }, RETRY_MS());
      })
      .catch(() => { status = "off"; });
  }

  // ---- restore: pick a file, hand it to the validated path -------------------
  let dialog = null;
  function buildDialog() {
    const d = document.createElement("dialog");
    d.id = "meritDiskBackupDialog"; d.className = "dialog-sm disk-backup-dialog";
    d.setAttribute("aria-labelledby", "meritDiskBackupTitle");
    const head = document.createElement("div"); head.className = "dialog-head";
    const h = document.createElement("h2"); h.id = "meritDiskBackupTitle"; head.appendChild(h);
    const body = document.createElement("div"); body.className = "dialog-body";
    const p = document.createElement("p"); p.className = "ask-body disk-backup-note";
    const list = document.createElement("div"); list.className = "disk-backup-list"; list.setAttribute("role", "list");
    body.append(p, list);
    const foot = document.createElement("div"); foot.className = "dialog-foot";
    const close = document.createElement("button"); close.type = "button"; close.className = "btn"; close.dataset.diskBackup = "close";
    close.onclick = () => d.close();
    foot.appendChild(close);
    d.append(head, body, foot);
    document.body.appendChild(d);
    return d;
  }
  function fmtWhen(iso) {
    const lang = globalThis.MERIT_I18N_LANG;
    try { return new Date(iso).toLocaleString(lang && lang() === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "medium" }); }
    catch { return iso; }
  }
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  async function openPicker() {
    if (!dialog) dialog = buildDialog();
    const d = dialog;
    d.querySelector("h2").textContent = tr("diskBackup.title");
    d.querySelector(".disk-backup-note").textContent = tr("diskBackup.note");
    d.querySelector('[data-disk-backup="close"]').textContent = tr("diskBackup.close");
    const list = d.querySelector(".disk-backup-list");
    list.replaceChildren();
    let files = null;
    try {
      const r = await fetch(BASE + "list", { headers: HEADERS, cache: "no-store", credentials: "same-origin" });
      const j = r.ok ? await r.json() : null;
      files = j && j.ok && Array.isArray(j.files) ? j.files : null;
    } catch { files = null; }
    if (!files) { say("diskBackup.unreachable", "error"); return; }
    if (!files.length) {
      const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = tr("diskBackup.none"); list.appendChild(empty);
    }
    for (const f of files) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn quiet disk-backup-row"; b.setAttribute("role", "listitem");
      b.dataset.diskBackupName = f.name;
      const when = document.createElement("b"); when.textContent = fmtWhen(f.at);
      const what = document.createElement("span"); what.className = "muted"; what.textContent = `${tr("diskBackup.events", { n: f.events })} · ${fmtSize(f.size)}`;
      b.append(when, what);
      b.onclick = () => { d.close(); restore(f.name); };
      list.appendChild(b);
    }
    if (!d.open) d.showModal();
    const first = list.querySelector("button") || d.querySelector('[data-disk-backup="close"]');
    if (first) first.focus();
  }

  async function restore(name) {
    let text;
    try {
      const r = await fetch(BASE + "file?name=" + encodeURIComponent(name), { headers: HEADERS, cache: "no-store", credentials: "same-origin" });
      if (!r.ok) throw new Error(String(r.status));
      text = await r.text();
    } catch { say("diskBackup.unreachable", "error"); return; }
    const input = document.getElementById("backupFileInput");
    if (!input || typeof DataTransfer !== "function") { say("diskBackup.unreachable", "error"); return; }
    const dt = new DataTransfer();
    dt.items.add(new File([text], name, { type: "application/json" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (served) {
    document.addEventListener("click", (e) => {
      const b = e.target && e.target.closest && e.target.closest('[data-action="disk-backup-restore"]');
      if (!b) return;
      e.preventDefault();
      openPicker();
    });
  }

  globalThis.MeritDiskBackup = Object.freeze({
    // whether the restore control belongs on screen: served by the relay, and
    // the relay has not said its backups are off
    available: () => served && status !== "off",
    state: () => ({ served, status, failed, pending: pending !== null && pending !== lastSent }),
    flush, openPicker, restore,
  });
})();
