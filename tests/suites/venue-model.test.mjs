// Venue → Layout → LayoutVersion → Event, and the promise that publishing a
// layout version freezes it.
//
// The whole point of a layout version is that next year's event can be built
// from last year's plan. That is only true if editing the event never reaches
// back into the version it was copied from, and if promoting an edited event
// adds a version rather than rewriting one.
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = { name: "venue-model", tags: ["storage", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  checks.require(await page.evaluate(() => !!globalThis.MeritVenueModel),
    "the venue model is reachable");

  // --- 1. the hotel string becomes a venue record, additively ---------------
  await createBlankEvent(page, { name: "Concert A", hotel: "Merit Starlit", date: "2026-11-20", salon: "Main Ballroom" });
  const migrated = await page.evaluate(() => ({
    venues: state.venues.map(v => ({ name: v.name, layouts: v.layouts.map(l => l.name) })),
    ref: state.events[0].venueRef,
    hotelPreserved: state.events[0].hotel,
  }));
  checks.ok(migrated.venues.length === 1 && migrated.venues[0].name === "Merit Starlit",
    "a venue record was created from the typed hotel name", migrated.venues);
  checks.ok(migrated.ref && migrated.ref.venueName === "Merit Starlit", "the event carries a venueRef", migrated.ref);
  checks.ok(migrated.hotelPreserved === "Merit Starlit",
    "the original hotel string is untouched — the migration is additive, not a replacement");

  // --- 2. the same venue typed sloppily is the same venue -------------------
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(400);
  await createBlankEvent(page, { name: "Concert B", hotel: "  merit starlit ", date: "2026-11-27", salon: "Main Ballroom" });
  const reused = await page.evaluate(() => ({
    venues: state.venues.length,
    layouts: state.venues[0].layouts.length,
    sameVenue: state.events[0].venueRef.venueId === state.events[1].venueRef.venueId,
    sameLayout: state.events[0].venueRef.layoutId === state.events[1].venueRef.layoutId,
  }));
  checks.ok(reused.venues === 1,
    "different casing and padding did not create a second venue", reused);
  checks.ok(reused.sameVenue && reused.sameLayout,
    "both events resolve to the same venue and the same layout", reused);

  // --- 3. a published version is frozen -------------------------------------
  const frozen = await page.evaluate(() => {
    const ev = state.events[0];
    ev.tables = [
      { id: "T1", number: "T01", x: 100, y: 100, w: 60, h: 60, capacity: 8, chairs: [] },
      { id: "T2", number: "T02", x: 300, y: 100, w: 60, h: 60, capacity: 8, chairs: [] },
    ];
    const ref = ev.venueRef;
    const version = MeritVenueModel.createLayoutVersion(state, ref.venueId, ref.layoutId,
      { structure: { tables: ev.tables, venueObjects: [], background: null }, label: "v1" });
    const other = state.events[1];
    MeritVenueModel.snapshotVersionIntoEvent(state, other, version.id);
    other.tables[0].capacity = 99;
    other.tables[0].x = 777;
    other.tables.push({ id: "T3", number: "T03", x: 500, y: 100, w: 60, h: 60, capacity: 4, chairs: [] });
    const layout = MeritVenueModel.findLayout(MeritVenueModel.findVenue(state, ref.venueId), ref.layoutId);
    const v = MeritVenueModel.findVersion(layout, version.id);
    return {
      versionTables: v.structure.tables.map(t => ({ n: t.number, cap: t.capacity, x: t.x })),
      eventTables: other.tables.map(t => ({ n: t.number, cap: t.capacity, x: t.x })),
      versionId: version.id,
      recordedOrigin: other.venueRef.layoutVersionId,
    };
  });
  checks.ok(frozen.versionTables.length === 2 && frozen.versionTables[0].cap === 8 && frozen.versionTables[0].x === 100,
    "hard edits to the event did not reach back into the published version", frozen.versionTables);
  checks.ok(frozen.eventTables.length === 3 && frozen.eventTables[0].cap === 99,
    "the event holds its own edited copy", frozen.eventTables);
  checks.ok(frozen.recordedOrigin === frozen.versionId,
    "the event records which version it was built from");

  // --- 4. promotion appends, never overwrites -------------------------------
  const promoted = await page.evaluate(() => {
    const other = state.events[1];
    const layoutOf = () => MeritVenueModel.findLayout(MeritVenueModel.findVenue(state, other.venueRef.venueId), other.venueRef.layoutId);
    const before = layoutOf().versions.length;
    MeritVenueModel.promoteEventToNewVersion(state, other, { label: "v2" });
    const layout = layoutOf();
    return {
      before, after: layout.versions.length,
      v1: layout.versions[0].structure.tables.map(t => ({ n: t.number, cap: t.capacity })),
      v2: layout.versions[1].structure.tables.map(t => ({ n: t.number, cap: t.capacity })),
    };
  });
  checks.ok(promoted.after === promoted.before + 1, "promotion added a version", promoted);
  checks.ok(promoted.v1.length === 2 && promoted.v1[0].cap === 8, "v1 is still exactly what it was", promoted.v1);
  checks.ok(promoted.v2.length === 3 && promoted.v2[0].cap === 99, "v2 captured the event's edits", promoted.v2);

  // --- 5. the layout change detector explains itself ------------------------
  const diff = await page.evaluate(() => {
    const other = state.events[1];
    const layout = MeritVenueModel.findLayout(MeritVenueModel.findVenue(state, other.venueRef.venueId), other.venueRef.layoutId);
    return MeritVenueModel.compareToVersion(state, layout.versions[0].id, {
      tables: [
        { number: "T01", x: 180, y: 100, w: 60, h: 60, capacity: 10 },
        { number: "T02", x: 300, y: 100, w: 60, h: 60, capacity: 8 },
        { number: "T03", x: 500, y: 100, w: 60, h: 60, capacity: 4 },
      ],
      venueObjects: [{ type: "stage" }],
    });
  });
  checks.ok(diff.tables.before === 2 && diff.tables.after === 3, "the detector counts before and after", diff.tables);
  checks.ok(diff.tables.added === 1, "it names the added table", diff.tables);
  checks.ok(diff.tables.unchanged === 1, "it recognises the untouched table", diff.tables);
  checks.ok(diff.capacity.delta === 6, "capacity delta is computed (16 → 22)", diff.capacity);
  checks.ok(!!diff.semanticChanges.stage, "it notices a stage appearing", diff.semanticChanges);
  checks.ok(typeof diff.method === "string" && diff.method.includes("median"),
    "it reports HOW it matched, not just a verdict", diff.method);

  // --- 6. memory is scoped to its layout ------------------------------------
  const memory = await page.evaluate(() => {
    const ev = state.events[0];
    MeritVenueModel.rememberVerifiedExample(state, ev.venueRef, {
      verifiedClass: "chair", originalPrediction: "table",
      descriptor: { fillRatio: 0.4 }, geometry: { w: 20, h: 20 }, planHash: "abc",
    });
    return {
      mine: MeritVenueModel.layoutMemory(state, ev.venueRef),
      foreign: MeritVenueModel.layoutMemory(state, { venueId: ev.venueRef.venueId, layoutId: "nope" }).length,
    };
  });
  checks.ok(memory.mine.length === 1 && memory.mine[0].verifiedClass === "chair",
    "a verified correction is stored against its layout family", memory.mine[0]);
  checks.ok(memory.mine[0].originalPrediction === "table",
    "what the detector originally said is kept next to the human truth — that difference is the training signal");
  checks.ok(memory.foreign === 0, "memory does not leak to another layout");

  // --- 7. all of it survives a reload ---------------------------------------
  await page.evaluate(() => saveState());
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const persisted = await page.evaluate(() => ({
    venues: state.venues.length,
    layouts: state.venues[0]?.layouts.length,
    versions: state.venues[0]?.layouts[0]?.versions.length,
    memory: state.venues[0]?.layouts[0]?.memory?.length || 0,
    refs: state.events.filter(e => e.venueRef).length,
  }));
  checks.ok(persisted.venues === 1 && persisted.layouts === 1, "venue and layout survived the reload", persisted);
  checks.ok(persisted.versions === 2, "both layout versions survived", persisted);
  checks.ok(persisted.memory === 1, "the verified correction survived", persisted);
  checks.ok(persisted.refs === 2, "both events kept their venueRef", persisted);
}
