// Section 15: does the migration chain actually upgrade genuinely old data,
// not just today's shape with one field missing?
//
// migrateEvent()/parseRoot() (src/app-v8.js) are a single, unconditional pass
// of idempotent "fill in a sane default if missing" patches, run on every
// load -- never a version-gated dispatch table. That has been safe so far
// because every migration to date has been purely additive. This suite does
// not invent a dispatch mechanism that has nothing to route yet (there is no
// known upcoming non-additive step to gate, and building one now would be
// speculative scaffolding this project's own rules argue against) -- instead
// it proves the one thing that IS real and buildable today: a record shaped
// like a genuinely early install (before capacitySource, freezes, handover
// notes, or the planning/arrival status split existed) still comes out the
// other end in today's correct, complete shape, with nothing thrown along
// the way. A write directly into IndexedDB, not through the app, is the only
// way to get a truly pre-field-existence fixture past the app's own always-
// current in-memory model.
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "schema-migration", tags: ["storage", "fast"], timeout: 60000 };

const DB_NAME = "meritEventMaker";

// Shaped like a real install from long before this build: no capacitySource,
// no hasPhysicalSeats, no chairs array, no freezes/handoverNotes/background,
// and a guest carrying only the pre-split `status` field (the predecessor to
// today's separate planningStatus/arrivalStatus axes) with no pax at all.
const OLD_ROOT = {
  events: [{
    id: "ev_old", name: "Legacy Gala", hotel: "Merit Royal", status: "Confirmed",
    date: "2019-06-15", createdAt: "2019-01-01T00:00:00.000Z",
    tables: [{ id: "t_old", number: "T01", type: "round", x: 100, y: 100, w: 120, h: 120, capacity: 6, zone: "MAIN" }],
    guests: [{ id: "g_old", name: "Legacy Guest", status: "Tentative" }],
  }],
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  await page.evaluate(async ({ dbName, root }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(JSON.stringify(root), "root");
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
    db.close();
    // The app's own unconditional beforeunload->saveState() is about to fire
    // on the reload below, persisting THIS PAGE's in-memory (blank) state and
    // overwriting the fixture just written -- exactly the same masking this
    // session already found in storage-provider.test.mjs's write-ordering
    // check. Neutralising saveState right before navigating away is the fix
    // there too: it touches nothing this test is actually exercising
    // (parseRoot/migrateEvent), only the unrelated safety-net save.
    saveState = () => {};
  }, { dbName: DB_NAME, root: OLD_ROOT });

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => Array.isArray(state.events) && state.events.length > 0, null, { timeout: 20000 });

  const migrated = await page.evaluate(() => {
    const e = state.events.find((x) => x.id === "ev_old");
    if (!e) return null;
    const t = e.tables[0], g = e.guests[0];
    return {
      capacitySource: t.capacitySource,
      hasPhysicalSeats: t.hasPhysicalSeats,
      chairCount: (t.chairs || []).length,
      capacity: t.capacity,
      freezes: e.freezes, handoverNotes: e.handoverNotes,
      backgroundPresent: e.background && typeof e.background === "object",
      lastModified: e.lastModified,
      guestPlanning: g.planningStatus, guestArrival: g.arrivalStatus,
      guestPax: g.pax, guestAdditional: g.additionalGuests, guestVip: g.vip,
      guestAssignment: g.assignment,
    };
  });

  checks.require(migrated, "a record from long before this build's fields existed still loads as an event at all", migrated);
  checks.ok(migrated.capacitySource === "UNKNOWN",
    "a table with no capacitySource at all is backfilled honestly as UNKNOWN, not guessed at", migrated.capacitySource);
  checks.ok(migrated.hasPhysicalSeats === true,
    "hasPhysicalSeats defaults true for a pre-field table, matching every other physical table that ever existed", migrated.hasPhysicalSeats);
  checks.ok(migrated.chairCount === migrated.capacity && migrated.chairCount === 6,
    "chairs are synthesised to match the table's declared capacity", migrated);
  checks.ok(Array.isArray(migrated.freezes) && migrated.freezes.length === 0,
    "an install from before Freeze Zones existed gets the correct empty state, not a crash", migrated.freezes);
  checks.ok(Array.isArray(migrated.handoverNotes) && migrated.handoverNotes.length === 0,
    "same for handover notes", migrated.handoverNotes);
  checks.ok(migrated.backgroundPresent, "background is backfilled to a real object, not left undefined", migrated.backgroundPresent);
  checks.ok(!!migrated.lastModified, "lastModified is backfilled even though this old record never had one", migrated.lastModified);
  checks.ok(migrated.guestPlanning === "Tentative",
    "the pre-split `status: Tentative` correctly becomes today's planningStatus", migrated.guestPlanning);
  checks.ok(migrated.guestArrival === "Not Arrived",
    "and arrivalStatus gets its own correct default, independent of the old status field", migrated.guestArrival);
  checks.ok(migrated.guestPax === 1 && migrated.guestAdditional === 0,
    "a guest with no pax at all becomes a party of exactly one", migrated);
  checks.ok(migrated.guestVip === "Standard" && migrated.guestAssignment === null,
    "and every other new guest field gets its own correct, honest default", migrated);
}
