// A CONFIRMED CHAIR KEEPS THE COORDINATE THE DETECTOR FOUND IT AT.
//
// `.claude/rules/ai.md`: "Confirmed chair coordinates from a candidate are
// written verbatim — never regenerated into a synthetic ring."
//
// `benchmarks/CODE-INVENTORY.md` §3 records that `commitCandidates` writes
// `table.chairs` directly rather than through `syncTableChairs`, lists it as a
// deliberate exception — and then says the thing this suite exists for:
//
//   "The problem is that NONE of them is protected by a test: if a future
//    de-duplication pass routed commitCandidates through syncTableChairs to
//    'keep capacity and chairs in sync', every confirmed chair would be
//    replaced by a synthetic ring, the detector's real coordinates would be
//    lost, and no suite would fail."
//
// It is named there as a prerequisite for any work in this area, so it is
// written before that work rather than after it.
//
// WHY A RING IS THE FAILURE AND NOT JUST A DIFFERENT NUMBER. The chairs below
// are placed where a detector actually finds chairs on a real plan: unevenly,
// because a photographed drawing is uneven, and with a gap where the service
// side of the table is. A generator that "keeps things in sync" produces four
// points at 90° on a circle — plausible, tidy, and a fabrication. The
// operator cannot tell the difference by looking at the floor plan, which is
// exactly why it needs a test rather than an eye.
//
// The positions are asserted EXACTLY. An approximate check would pass on a
// ring that happened to land nearby, and "nearby" is not the contract.
import { openApp, createBlankEvent, futureDate, click } from "../lib/app-actions.mjs";

export const meta = { name: "confirmed-chair-coordinates", tags: ["business", "fast"], timeout: 60000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Confirm", hotel: "Merit", date: futureDate() });

  // A table candidate with four chairs at deliberately irregular offsets, and
  // a PHYSICAL verdict, because that is the one that says the drawing really
  // showed chairs. The numbers are chosen so that no ring generator could
  // produce them: three on one side at uneven spacing, one alone opposite.
  const planted = await page.evaluate(() => {
    const event = state.events[0];
    // Candidate box in percent of the plan, and chair CENTRES in the same
    // space — which is how the detector reports them.
    const c = {
      id: "cand-under-test", kind: "table", type: "round",
      x: 20, y: 30, w: 10, h: 8, rotation: 0,
      confidence: 0.9, status: "unreviewed", selected: true,
      chairDetections: [
        { id: "ch1", x: 21.5, y: 28.4, w: 1.2, h: 1.2, rotation: 12 },
        { id: "ch2", x: 24.9, y: 28.1, w: 1.2, h: 1.2, rotation: -5 },
        { id: "ch3", x: 27.3, y: 28.8, w: 1.2, h: 1.2, rotation: 0 },
        { id: "ch4", x: 25.0, y: 37.6, w: 1.2, h: 1.2, rotation: 174 },
      ],
      evidence: { geometry: 0.8, chairs: 4, repetition: 4 },
    };
    event.analysis = {
      id: "an-under-test", engine: "ASSISTED_DETECTION", trainedModel: false,
      createdAt: new Date().toISOString(),
      imageWidth: 1000, imageHeight: 800, threshold: 128,
      candidates: [c], missed: [], groupingDecisions: [],
      // The fields the real pipeline writes beside the candidates. They are
      // here because the review screen reads them, not for decoration: the
      // first version of this suite omitted `comparison` and render() threw
      // "Cannot read properties of undefined (reading 'added')" with no
      // control on screen to click.
      comparison: { added: 1, removed: 0, changed: 0 },
      memoryReapplied: 0, memoryRestored: 0, memoryConflicts: [],
      ocr: { available: false, reason: "not attempted", engine: "tesseract.js" },
      ocrText: null, timings: {},
      diagnostics: { representation: { kind: "PHYSICAL", associationRate: 0.96, evidence: {} } },
    };
    // The review screen's commit control lives on the status pill, which reads
    // `analysis.planIntelligence`. It is built here with the product's own
    // `buildPlanIntelligence` — published on globalThis — rather than
    // hand-shaped, so this suite cannot pass against a structure the product
    // would never produce.
    event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, null);
    ui.tab = "floor";
    ui.planMode = "review";
    render();
    // What the committed chairs MUST equal: the detector's centres expressed
    // relative to the table box, which is the conversion commitCandidates
    // does. Computed here from the same inputs so the expectation is derived
    // rather than copied from a passing run.
    return c.chairDetections.map((ch) => ({
      x: Math.max(0, Math.min(100, (ch.x - c.x) / c.w * 100)),
      y: Math.max(0, Math.min(100, (ch.y - c.y) / c.h * 100)),
      rotation: ch.rotation || 0,
    }));
  });
  checks.equal(planted.length, 4, "four chairs were planted on the candidate", planted.length);

  await click(page, '[data-review-action="commit"]');
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const event = state.events[0];
    const table = event.tables[0];
    return {
      tables: event.tables.length,
      capacity: table?.capacity ?? null,
      hasPhysicalSeats: table?.hasPhysicalSeats ?? null,
      capacitySource: table?.capacitySource ?? null,
      chairs: (table?.chairs || []).map((ch) => ({
        x: ch.x, y: ch.y, rotation: ch.rotation, seatNumber: ch.seatNumber,
        parented: ch.parentTableId === table.id,
      })),
    };
  });

  checks.equal(out.tables, 1, "the candidate committed to exactly one table", out.tables);
  checks.equal(out.chairs.length, 4,
    "carrying four chair records — one per detection, not a count turned back into geometry", out.chairs.length);

  // THE CONTRACT. Exact equality, in order, on every axis the detector
  // reported.
  for (let i = 0; i < planted.length; i++) {
    const want = planted[i], got = out.chairs[i] || {};
    checks.ok(got.x === want.x && got.y === want.y,
      `chair ${i + 1} sits exactly where the detector found it. A synthetic ring would put it somewhere plausible instead, and nothing on the floor plan would look wrong`,
      { want, got });
    checks.equal(got.rotation, want.rotation,
      `chair ${i + 1} keeps its own rotation — .claude/rules/ai.md forbids forcing a detected object to axis-aligned`,
      { want: want.rotation, got: got.rotation });
  }

  // And the shape of the record, which is what a "keep them in sync" refactor
  // would also quietly change.
  checks.ok(out.chairs.every((ch, i) => ch.seatNumber === i + 1),
    "seat numbers run 1..4 in detection order", out.chairs.map((c) => c.seatNumber));
  checks.ok(out.chairs.every((ch) => ch.parented),
    "and every chair is parented to the table it was committed with", out.chairs.map((c) => c.parented));
  checks.equal(out.capacity, 4,
    "capacity equals the number of REAL chairs, so the two cannot disagree — that is what the direct write is for",
    out.capacity);
  checks.equal(out.hasPhysicalSeats, true,
    "and the table says it has physical seats, because the plan actually drew them", out.hasPhysicalSeats);
  checks.equal(out.capacitySource, "DETECTED_PHYSICAL_SEATS",
    "with the provenance naming where the number came from rather than leaving it UNKNOWN",
    out.capacitySource);

  // The negative half of the same rule, from the other direction: a table
  // committed off a plan with NO drawn chairs must carry no chair objects at
  // all — not a ring flagged as unreal. `physical-logical-seat-separation`
  // asserts the flag; this asserts the array, through the same real path.
  const symbolic = await page.evaluate(() => {
    const event = state.events[0];
    event.tables.length = 0;
    event.analysis.diagnostics.representation.kind = "SYMBOLIC";
    const c = event.analysis.candidates[0];
    c.committedId = null;
    c.status = "unreviewed";
    c.selected = true;
    c.chairDetections = [];
    event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, null);
    ui.tab = "floor"; ui.planMode = "review"; render();
    return true;
  });
  checks.ok(symbolic, "the symbolic case is set up on the same event");
  await click(page, '[data-review-action="commit"]');
  await page.waitForTimeout(400);
  const sym = await page.evaluate(() => {
    const t = state.events[0].tables[0];
    return { chairs: (t?.chairs || []).length, hasPhysicalSeats: t?.hasPhysicalSeats ?? null,
      capacitySource: t?.capacitySource ?? null };
  });
  checks.equal(sym.chairs, 0,
    "a table committed off a SYMBOLIC plan carries NO chair objects — the drawing showed none, so there is nothing to write, and a ring of fabricated positions flagged as unreal is not an acceptable substitute for not writing it",
    sym);
  checks.equal(sym.hasPhysicalSeats, false, "and it says so", sym.hasPhysicalSeats);
  checks.equal(sym.capacitySource, "UNKNOWN",
    "with the capacity provenance saying UNKNOWN rather than claiming a measurement", sym.capacitySource);
}
