// FAULT INJECTION — make storage fail on purpose, from outside the product.
//
// `.claude/skills/merit-resilience-hardening/SKILL.md`, required evidence 1:
// "A fault-injection helper in tests/lib/ that can make storage fail, return
// corrupt data, and throw from a named boundary."
//
// Everything here works on the BROWSER'S OWN APIs — IndexedDB's put and open —
// never on the product's functions, so a suite exercises the product's real
// handling rather than a stub of it. Faults are switched on and off at run
// time through `window.__faults`, and can be armed before boot so a failure
// can meet the very first read.

// Install the switchable wrappers before any page script runs. `initial`
// arms faults from the first instruction of the page, e.g. `{ put: "quota" }`.
export async function installStorageFaults(page, initial = {}) {
  await page.addInitScript((init) => {
    window.__faults = Object.assign({ put: null, open: null }, init);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      // Only the product's own records: the suite's direct writes go through
      // `window.__faultsBypass`.
      if (!window.__faultsBypass && window.__faults.put === "quota")
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return put.call(this, value, key);
    };
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      if (!window.__faultsBypass && window.__faults.open === "fail")
        throw new DOMException("The database could not be opened.", "InvalidStateError");
      return open.apply(this, args);
    };
  }, initial);
}

export const setFault = (page, name, value) =>
  page.evaluate(([n, v]) => { window.__faults[n] = v; }, [name, value]);

// Direct reads and writes of the product's IndexedDB records, bypassing the
// faults — the suite's own view of what is really on disk.
const idb = (page, op, key, value) => page.evaluate(([op, key, value]) => new Promise((resolve, reject) => {
  window.__faultsBypass = true;
  const r = indexedDB.open("meritEventMaker");
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("state")) r.result.createObjectStore("state"); };
  r.onsuccess = () => {
    const db = r.result;
    const tx = db.transaction("state", op === "get" ? "readonly" : "readwrite");
    const store = tx.objectStore("state");
    let out = null;
    if (op === "get") { const g = store.get(key); g.onsuccess = () => { out = g.result ?? null; }; }
    else if (op === "delete") store.delete(key);
    else store.put(value, key);
    tx.oncomplete = () => { db.close(); window.__faultsBypass = false; resolve(out); };
    tx.onerror = () => { window.__faultsBypass = false; reject(tx.error); };
  };
  r.onerror = () => { window.__faultsBypass = false; reject(r.error); };
}), [op, key, value]);
export const readRecord = (page, key = "root") => idb(page, "get", key);
export const writeRecord = (page, key, value) => idb(page, "put", key, value);
export const deleteRecord = (page, key) => idb(page, "delete", key);
export const listKeys = (page) => page.evaluate(() => new Promise((resolve) => {
  window.__faultsBypass = true;
  const r = indexedDB.open("meritEventMaker");
  r.onsuccess = () => {
    const db = r.result, g = db.transaction("state", "readonly").objectStore("state").getAllKeys();
    g.onsuccess = () => { db.close(); window.__faultsBypass = false; resolve(g.result.map(String)); };
  };
}));

// A same-origin page that does NOT run the app, so records can be planted
// without the running app saving a good copy over them first.
export async function gotoBlank(page, baseUrl) {
  await page.route(`${baseUrl}/__blank.html`, (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>blank</title>" }));
  await page.goto(`${baseUrl}/__blank.html`);
}

// Boot the app and wait until the async storage load has resolved.
export async function bootApp(page, baseUrl, lang = "en") {
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForFunction(() => { try { return Array.isArray(state.events) && typeof render === "function"; } catch { return false; } }, null, { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate((l) => { ui.lang = l; render(); }, lang);
}

// Throw from a NAMED BOUNDARY: a published module method, addressed by path
// ("MeritTeachArea.inForce"). The original is kept so the fault can be lifted.
// `when` is an optional predicate source, evaluated in the page, that decides
// per call whether to throw — e.g. "ui.screen === 'workspace'".
export const throwFrom = (page, path, message = "INJECTED FAULT", when = "true") =>
  page.evaluate(([path, message, when]) => {
    const parts = path.split("."), name = parts.pop();
    const owner = parts.reduce((o, k) => o[k], globalThis);
    window.__faultOriginals = window.__faultOriginals || {};
    if (!window.__faultOriginals[path]) window.__faultOriginals[path] = owner[name];
    const original = window.__faultOriginals[path];
    const gate = new Function(`return (${when});`);
    owner[name] = function (...args) {
      if (gate()) throw new Error(message);
      return original.apply(this, args);
    };
  }, [path, message, when]);
export const liftFault = (page, path) =>
  page.evaluate((path) => {
    const parts = path.split("."), name = parts.pop();
    const owner = parts.reduce((o, k) => o[k], globalThis);
    if (window.__faultOriginals && window.__faultOriginals[path]) owner[name] = window.__faultOriginals[path];
  }, path);
