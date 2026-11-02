// ONE-CLICK DIAGNOSTIC REPORT (tools/local-vlm/windows/PRE-TRIAL-CHECKLIST.md line 11).
//
// When something goes wrong on one of the owner's work PCs, one click saves a
// small JSON file he can send: the browser, the screen, storage use, the disk
// backup's state, the last errors, and — when the local server serves the app
// — the machine's side (/vlm-relay/diagnose: versions, CPU, memory, models).
//
//   NO GUEST DATA. Nothing from an event, a guest, a plan or a file is read.
//     Storage is reported as key names and sizes only; an error as its kind,
//     file and line — never its message, which can carry a name.
//   NOTHING LEAVES BY ITSELF. The report is a download; the owner decides
//     whether to send it.
(function () {
  "use strict";
  // THE PROGRAM'S VERSION — one place; equals package.json "version" (suite diagnose-report).
  globalThis.MERIT_APP_VERSION = "0.9.0";
  const MAX_ERRORS = 30;
  const errors = [];
  const base = (f) => String(f || "").split(/[\\/]/).pop().split("?")[0] || null;
  function keep(kind, file, line, col) {
    errors.push({ at: new Date().toISOString(), kind, file: base(file), line: Number(line) || null, col: Number(col) || null });
    if (errors.length > MAX_ERRORS) errors.shift();
  }
  globalThis.addEventListener("error", (e) => keep(e && e.error && e.error.name ? e.error.name : "error", e && e.filename, e && e.lineno, e && e.colno));
  globalThis.addEventListener("unhandledrejection", (e) => keep("rejection:" + (e && e.reason && e.reason.name ? e.reason.name : typeof (e && e.reason)), null, null, null));

  const tr = (key, vars) => (typeof t === "function" ? t(key, vars) : key);
  function storageKeys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out.push({ key: k, bytes: (localStorage.getItem(k) || "").length * 2 });
      }
    } catch { return null; }
    return out.sort((a, b) => b.bytes - a.bytes);
  }
  async function machine() {
    const backup = globalThis.MeritDiskBackup && globalThis.MeritDiskBackup.state ? globalThis.MeritDiskBackup.state() : null;
    if (!backup || !backup.served) return { served: false };
    try {
      const r = await fetch("/vlm-relay/diagnose", { headers: { "x-merit-relay": "1" }, cache: "no-store", credentials: "same-origin" });
      return r.ok ? await r.json() : { served: true, status: r.status };
    } catch { return { served: true, unreachable: true }; }
  }
  async function build() {
    let estimate = null;
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); estimate = { usageMB: Math.round((e.usage || 0) / 1048576), quotaMB: Math.round((e.quota || 0) / 1048576) }; } } catch { estimate = null; }
    return {
      kind: "merit-diagnose/1",
      at: new Date().toISOString(),
      app: { version: globalThis.MERIT_APP_VERSION, lang: globalThis.MERIT_I18N_LANG ? globalThis.MERIT_I18N_LANG() : null, origin: location.origin, file: location.protocol === "file:" },
      browser: { userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null,
        screen: `${screen.width}x${screen.height}`, window: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio || 1 },
      storage: { estimate, localStorage: storageKeys() },
      diskBackup: globalThis.MeritDiskBackup && globalThis.MeritDiskBackup.state ? globalThis.MeritDiskBackup.state() : null,
      errors: errors.slice(),
      machine: await machine(),
    };
  }
  async function download() {
    const rep = await build();
    const stamp = rep.at.replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
    const name = `merit-tani-${stamp}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(rep, null, 1)], { type: "application/json" }));
    try {
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    if (typeof toast === "function" && typeof t === "function") toast(t("diagnose.done", { name }), "success", 5000);
    return rep;
  }
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-action="diagnose-report"]');
    if (!b) return;
    e.preventDefault();
    download();
  });
  globalThis.MeritDiagnoseReport = Object.freeze({ build, download, errors: () => errors.slice() });
})();
