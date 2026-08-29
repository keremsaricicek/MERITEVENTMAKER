(() => {
  "use strict";
  // StorageProvider: the app's persistence boundary. Business logic calls
  // saveState()/loadV8() in app-v8.js, which go through whichever provider is
  // selected here -- it never touches localStorage or IndexedDB directly.
  // This is what lets a future desktop build swap in SQLiteStorageProvider
  // without touching a single line of Events/Guests/Seating/Live/Reports
  // code (see .claude/skills/merit-desktop-architecture).
  //
  // IndexedDBStorageProvider is primary: localStorage's ~5-10MB quota is
  // already tight for an event with a floor-plan background image and a few
  // hundred guests, where IndexedDB's quota is effectively disk-sized.
  // LocalStorageStorageProvider remains as the fallback for the rare
  // environment where IndexedDB is unavailable (very old browsers, some
  // locked-down embedded webviews) -- and as the read path for one-time
  // migration of data saved before this change.

  const DB_NAME = "meritEventMaker";
  const DB_VERSION = 1;
  const STORE = "state";
  const RECORD_KEY = "root";

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error("IndexedDB is not available in this environment.")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed."));
      req.onblocked = () => reject(new Error("IndexedDB open blocked (another tab holds an older version)."));
    });
  }

  class IndexedDBStorageProvider {
    async load(key = RECORD_KEY) {
      const db = await openDB();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error || new Error("IndexedDB read failed."));
        });
      } finally { db.close(); }
    }
    async save(data, key = RECORD_KEY) {
      const db = await openDB();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(data, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed."));
          tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted."));
        });
        return true;
      } finally { db.close(); }
    }
  }

  // Synchronous by nature -- kept async-shaped so callers never need to know
  // which provider is live.
  class LocalStorageStorageProvider {
    constructor(key) { this.key = key; }
    async load() {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    }
    async save(data) {
      localStorage.setItem(this.key, JSON.stringify(data));
      return true;
    }
  }

  globalThis.MeritStorageProviders = { IndexedDBStorageProvider, LocalStorageStorageProvider };
})();
