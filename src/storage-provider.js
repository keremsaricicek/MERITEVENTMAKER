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
  // v2 adds the BLOBS store. Training-data image crops are the reason: they
  // are large, they are read one at a time by id, and they must never be
  // pulled into memory or re-serialised just because an event was saved. The
  // upgrade only creates a store -- it does not touch the existing `state`
  // record -- so data written by v1 loads unchanged afterwards.
  const DB_VERSION = 2;
  const STORE = "state";
  const BLOBS = "blobs";
  const RECORD_KEY = "root";

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error("IndexedDB is not available in this environment.")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      };
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

    // Side storage for large values addressed by id -- today, training-data
    // image crops. Deliberately NOT part of the state record: a few thousand
    // crops would turn every ordinary save into a multi-megabyte
    // serialise/parse, and nothing that renders a guest list needs them.
    async putBlob(id, value) {
      const db = await openDB();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(BLOBS, "readwrite");
          tx.objectStore(BLOBS).put(value, id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("IndexedDB blob write failed."));
          tx.onabort = () => reject(tx.error || new Error("IndexedDB blob write aborted."));
        });
        return true;
      } finally { db.close(); }
    }
    async getBlob(id) {
      const db = await openDB();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(BLOBS, "readonly");
          const req = tx.objectStore(BLOBS).get(id);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error || new Error("IndexedDB blob read failed."));
        });
      } finally { db.close(); }
    }
    async deleteBlob(id) {
      const db = await openDB();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(BLOBS, "readwrite");
          tx.objectStore(BLOBS).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("IndexedDB blob delete failed."));
        });
        return true;
      } finally { db.close(); }
    }
    async listBlobIds() {
      const db = await openDB();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(BLOBS, "readonly");
          const req = tx.objectStore(BLOBS).getAllKeys();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error("IndexedDB blob key listing failed."));
        });
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
    // The blob API exists here so callers never branch on provider, but this
    // is the fallback for environments without IndexedDB and localStorage's
    // few megabytes cannot hold an image dataset. A write that does not fit
    // throws rather than silently dropping the crop, so the caller can record
    // the decision without pretending the pixels were kept.
    async putBlob(id, value) {
      try {
        localStorage.setItem(this.key + ".blob." + id, value);
        return true;
      } catch (error) {
        throw new Error(`localStorage cannot hold this crop (${error.name}). Image capture needs IndexedDB.`);
      }
    }
    async getBlob(id) { return localStorage.getItem(this.key + ".blob." + id); }
    async deleteBlob(id) { localStorage.removeItem(this.key + ".blob." + id); return true; }
    async listBlobIds() {
      const prefix = this.key + ".blob.";
      return Object.keys(localStorage).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
    }
  }

  globalThis.MeritStorageProviders = { IndexedDBStorageProvider, LocalStorageStorageProvider };
})();
