// DOES `schemaVersion` MEAN ANYTHING?
//
// It did not. `parseRoot()` opened with:
//
//     const parsed = JSON.parse(raw); parsed.version = 8; parsed.schemaVersion = 8;
//
// — it STAMPED the version rather than reading it. Everything downstream was
// one unconditional pass of "fill in a sane default if missing", which is
// safe while every change is additive and silently wrong the moment one is
// not. Three consequences, in rising order of damage:
//
//   A RECORD FROM A NEWER BUILD WAS SILENTLY DOWNGRADED. Open this build
//   against data written by the next one and its schemaVersion is overwritten
//   with 8, its unknown fields are ignored, and the first mutation SAVES OVER
//   IT. The newer install's data is not misread — it is destroyed, by a
//   build that never knew it was looking at something it could not read.
//
//   NOTHING COULD BE VERSION-GATED. A non-additive step — a field that
//   changes meaning rather than appearing — has nowhere to live, because no
//   code can tell a record that has had it applied from one that has not.
//
//   A CORRUPT ROOT WAS INDISTINGUISHABLE FROM AN OLD ONE. `{}`, a string, an
//   array, a root whose `events` is not an array: all were "version 8" too.
//
// The registry answers those three. It READS the stored version, runs a
// SEQUENTIAL chain of named steps from there to the current one, is
// IDEMPOTENT (running it on an already-current root changes nothing), and
// CONTAINS what it cannot handle — a future record is refused rather than
// downgraded, and refusing includes refusing to write over it.
import fs from "node:fs";
import path from "node:path";
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "schema-registry", tags: ["storage", "fast"], timeout: 90000 };

const DB_NAME = "meritEventMaker";

async function putRoot(page, root) {
  await page.evaluate(async ({ dbName, payload }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(payload, "root");
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
    db.close();
    // The app's own beforeunload -> saveState() would otherwise persist THIS
    // page's in-memory state over the fixture just written, masking the very
    // load path under test. Same neutralisation schema-migration uses.
    saveState = () => {};
  }, { dbName: DB_NAME, payload: typeof root === "string" ? root : JSON.stringify(root) });
}

async function readRoot(page) {
  return page.evaluate(async ({ dbName }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const raw = await new Promise((res, rej) => {
      const tx = db.transaction("state", "readonly");
      const req = tx.objectStore("state").get("root");
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    db.close();
    try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return { UNPARSEABLE: true, raw }; }
  }, { dbName: DB_NAME });
}

export default async function run({ page, checks, baseUrl, repoRoot }) {
  // --- 1. the registry exists and is a real chain, not a stamp -------------
  const src = fs.readFileSync(path.join(repoRoot, "src", "schema-migrations.js"), "utf8");
  const current = src.match(/CURRENT_VERSION\s*=\s*(\d+)/);
  checks.require(current, "the current schema version is a named constant in the registry", current);
  const CURRENT = Number(current[1]);

  const v8 = fs.readFileSync(path.join(repoRoot, "src", "app-v8.js"), "utf8")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").replace(/\s/g, "");
  checks.ok(!/parsed\.schemaVersion=\d/.test(v8),
    "parseRoot no longer STAMPS a version over whatever it was handed — reading the stored version is the whole point of having one",
    true);

  await openApp(page, baseUrl, { lang: "en" });

  // --- 2. the chain is sequential, named, and covers every gap -------------
  const chain = await page.evaluate(() => {
    const M = MeritSchemaMigrations;
    const steps = M.STEPS.map(s => ({ from: s.from, to: s.to, describe: s.describe }));
    let contiguous = true;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].to !== steps[i].from + 1) contiguous = false;
      if (i && steps[i].from !== steps[i - 1].to) contiguous = false;
    }
    return {
      current: M.CURRENT_VERSION,
      steps,
      contiguous,
      described: steps.every(s => typeof s.describe === "string" && s.describe.length > 10),
      endsAtCurrent: steps.length === 0 || steps[steps.length - 1].to === M.CURRENT_VERSION,
      planFromOldest: M.plan(steps.length ? steps[0].from : M.CURRENT_VERSION).map(s => `${s.from}->${s.to}`),
    };
  });
  checks.equal(chain.current, CURRENT, "the module and the source agree on the current version", chain.current);
  checks.ok(chain.steps.length > 0,
    "the registry carries at least one real step — an empty chain is scaffolding, and this project's rules argue against building that",
    chain.steps);
  checks.ok(chain.contiguous,
    "every step moves exactly one version and starts where the previous one ended. A gap would make a record stall at a version nothing can migrate from",
    chain.steps);
  checks.ok(chain.endsAtCurrent,
    "and the chain ends at the current version, so a fully migrated record needs no further step", chain.steps);
  checks.ok(chain.described,
    "each step says what it does, in words — a migration nobody can read is a migration nobody can review", chain.steps);

  // --- 3. a real old record climbs the whole chain -------------------------
  // The v8 shape this programme's own seat-model work replaced: a symbolic
  // table carrying fabricated chair objects tagged physical:false.
  const OLD = {
    version: 8, schemaVersion: 8, audit: [], events: [{
      id: "ev_v8", name: "Version 8 Gala", hotel: "Merit Royal", salon: "", status: "Planning",
      date: "2099-05-05", createdAt: "2026-01-01T00:00:00.000Z", lastModified: "2026-01-01T00:00:00.000Z",
      guests: [], venueObjects: [],
      tables: [{
        id: "t_sym", number: "T01", type: "round", x: 10, y: 10, w: 100, h: 100,
        capacity: 4, zone: "MAIN", hasPhysicalSeats: false, capacitySource: "PRINTED_TABLE_CAPACITY",
        chairs: [0, 1, 2, 3].map(i => ({ id: "c" + i, parentTableId: "t_sym", seatNumber: i + 1,
          x: 50, y: 50, rotation: 0, occupancy: null, physical: false })),
      }],
    }],
  };
  const climbed = await page.evaluate((old) => {
    const M = MeritSchemaMigrations;
    const r = M.migrate(JSON.parse(JSON.stringify(old)));
    const t = r.root.events[0].tables[0];
    return {
      status: r.status, from: r.from, to: r.to, applied: r.applied,
      version: r.root.schemaVersion,
      chairs: (t.chairs || []).length,
      capacity: t.capacity,
      anyPhysicalFlag: (t.chairs || []).some(c => "physical" in c),
    };
  }, OLD);
  checks.equal(climbed.status, "OK", "a version-8 record migrates cleanly", climbed);
  checks.equal(climbed.from, 8, "from the version it actually declared", climbed);
  checks.equal(climbed.to, CURRENT, "up to the current one", climbed);
  checks.ok(climbed.applied.length > 0, "having really run its steps", climbed.applied);
  checks.equal(climbed.version, CURRENT, "and the migrated record carries the new version", climbed.version);
  checks.equal(climbed.capacity, 4,
    "capacity — the logical seat count — is untouched by the migration", climbed.capacity);
  checks.equal(climbed.chairs, 0,
    "while the four fabricated chairs on a symbolic table are gone. This is a real, non-additive step: a v8 record and a current one differ in a way no 'fill in the default' pass could express",
    climbed.chairs);
  checks.ok(!climbed.anyPhysicalFlag, "and the retired physical flag with them", climbed);

  // --- 4. idempotence ------------------------------------------------------
  const idempotent = await page.evaluate((old) => {
    const M = MeritSchemaMigrations;
    const once = M.migrate(JSON.parse(JSON.stringify(old)));
    const twice = M.migrate(JSON.parse(JSON.stringify(once.root)));
    return {
      secondApplied: twice.applied.length,
      secondStatus: twice.status,
      identical: JSON.stringify(once.root) === JSON.stringify(twice.root),
    };
  }, OLD);
  checks.equal(idempotent.secondApplied, 0,
    "migrating an already-current record runs no steps at all", idempotent);
  checks.equal(idempotent.secondStatus, "OK", "and is not an error", idempotent.secondStatus);
  checks.ok(idempotent.identical,
    "the result is byte-identical the second time. A migration that is not idempotent corrupts data every time a record is simply re-read",
    idempotent);

  // --- 5. FUTURE-VERSION SAFETY — the one that destroyed data --------------
  const future = await page.evaluate((cur) => {
    const M = MeritSchemaMigrations;
    const root = { schemaVersion: cur + 3, version: cur + 3, events: [
      { id: "ev_future", name: "From A Newer Build", somethingThisBuildHasNeverHeardOf: 42 }], audit: [] };
    const r = M.migrate(root);
    return { status: r.status, from: r.from, to: r.to,
      stampedDown: r.root && r.root.schemaVersion === cur,
      keptField: !!(r.root && r.root.events && r.root.events[0] && r.root.events[0].somethingThisBuildHasNeverHeardOf) };
  }, CURRENT);
  checks.equal(future.status, "FUTURE",
    "a record from a NEWER build is recognised as such, not treated as an old one", future);
  checks.ok(!future.stampedDown,
    "it is NOT stamped down to this build's version. Stamping was the destructive half: the version was overwritten, the unknown fields ignored, and the first save wrote over a newer install's data",
    future);
  checks.ok(future.keptField,
    "and the field this build has never heard of is left exactly where it was", future);

  // --- 6. containment: a corrupt root is not mistaken for an old one -------
  const corrupt = await page.evaluate(() => {
    const M = MeritSchemaMigrations;
    const cases = {
      empty: M.migrate({}),
      nullRoot: M.migrate(null),
      aString: M.migrate("not a root at all"),
      anArray: M.migrate([1, 2, 3]),
      eventsNotArray: M.migrate({ schemaVersion: 8, events: "oops" }),
      versionIsText: M.migrate({ schemaVersion: "eight", events: [] }),
    };
    const out = {};
    for (const [k, r] of Object.entries(cases)) out[k] = r.status;
    return out;
  });
  checks.equal(corrupt.nullRoot, "UNREADABLE", "a null root is contained, not migrated", corrupt);
  checks.equal(corrupt.aString, "UNREADABLE", "so is a string", corrupt);
  checks.equal(corrupt.anArray, "UNREADABLE", "and an array", corrupt);
  checks.equal(corrupt.eventsNotArray, "UNREADABLE",
    "and a root whose events is not a list — every one of these used to be 'version 8' as far as the loader was concerned", corrupt);
  checks.equal(corrupt.empty, "OK",
    "but an EMPTY object is a legitimate pre-versioned record, not corruption, and still migrates", corrupt);
  checks.equal(corrupt.versionIsText, "OK",
    "and an unreadable version number on an otherwise sound root is treated as the oldest known, which is the safe direction", corrupt);

  // --- 7. end to end: the app refuses to overwrite a future record ---------
  // The destructive half of the old behaviour was not the misread; it was the
  // save that followed.
  await putRoot(page, { schemaVersion: 99, version: 99, audit: [],
    events: [{ id: "ev_99", name: "Written By A Newer Build", tables: [], guests: [] }] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const guarded = await page.evaluate(async () => {
    // Try hard to make the app write.
    if (state.events && state.events[0]) state.events[0].name = "OVERWRITTEN";
    const r = saveState();
    if (r && typeof r.then === "function") await r;
    return { blocked: typeof MERIT_SCHEMA_GUARD === "object" ? MERIT_SCHEMA_GUARD.readOnly : null };
  });
  const afterAttempt = await readRoot(page);
  checks.equal(afterAttempt.schemaVersion, 99,
    "the future record is still version 99 on disk after the app loaded and a save was attempted", afterAttempt.schemaVersion);
  checks.equal(afterAttempt.events?.[0]?.name, "Written By A Newer Build",
    "and its content is untouched — refusing to read something also means refusing to write over it", afterAttempt.events?.[0]?.name);
  checks.equal(guarded.blocked, true,
    "the app knows it is in that state rather than behaving normally over data it cannot read", guarded);

  // --- 8. and it SAYS so, in the operator's language -----------------------
  const told = await page.evaluate(() => {
    const el = document.querySelector("[data-schema-future]");
    return { present: !!el, text: el ? el.textContent.trim() : null };
  });
  checks.ok(told.present,
    "the screen says the data was written by a newer version rather than showing an empty app with no explanation", told);
  checks.ok(told.text && !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(told.text),
    "in words, not a raw translation key", told.text);
}
