// A symbolic plan, end to end, on a drawing built here with exact ground truth.
//
// Phase 6 found that 30 of ORNEK's 34 missed tables were lost in three places,
// all the same failure: a rule whose safety depends on an exemption that a plan
// drawing no furniture cannot supply.
//
//   the family's other polarity   9   solid discs arrive through the TABLE
//                                     sources and were demoted with the
//                                     architecture
//   seat of a demoted table      10   counted as a seat of an architecture
//                                     proposal, destroyed when the swap
//                                     demoted it
//   a printed text run           11   flagged as glyphs; the test's own
//                                     discriminator is degenerate when the
//                                     marks ARE the tables
//
// The drawing below is the smallest thing that reproduces the shape of that
// plan: one repeated symbol in two tones, numbers printed inside, no seating
// drawn anywhere, and a piece of architecture. Constructed here rather than
// committed as an image, so its ground truth is exact by construction and
// cannot drift from the file.
//
// The drawing is arranged so that all three routes are actually taken — a
// tightly spaced row that reads as a word, a pair of symbols close enough to a
// solid one to be counted as its seats, and the solid symbols themselves — and
// each is asserted by name. The counts are checked because a fixture where a
// route quietly stops firing would pass every other assertion here while
// guarding nothing.
//
// The load-bearing assertion behind them is the INVARIANT: on a plan the system
// has decided is symbolic, every detected member of the uniform family must end
// up as a table. That is what all three fixes establish together, and it holds
// however a drawing happens to route its members.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "symbolic-plan-detection",
  tags: ["intelligence", "detection"],
  timeout: 120000,
  viewport: { width: 1200, height: 800 },
};

// The drawing, and its own ground truth in the same breath.
function buildPlan() {
  const W = 1400, H = 1080, R = 26;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  g.font = "16px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  const open = [], filled = [], tight = [], hugging = [];
  let n = 1;
  // The plan's symbol: a ring with its table number printed inside it. Exactly
  // the construction that makes the OCR text-suppression exemption unavailable.
  const ring = (x, y) => {
    g.strokeStyle = "#222"; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#222"; g.fillText(String(n++), x, y);
  };
  for (let r = 0; r < 4; r++) for (let col = 0; col < 8; col++) {
    const x = 130 + col * 150, y = 120 + r * 150;
    ring(x, y); open.push([x, y]);
  }
  // The SAME symbol drawn solid. A different tone, not a different object.
  for (let i = 0; i < 4; i++) {
    const x = 130 + i * 150, y = 745;
    g.fillStyle = "#333";
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
    filled.push([x, y]);
  }
  // A long architectural band: not a table, and not a "stage" either.
  g.fillStyle = "#555"; g.fillRect(800, 715, 460, 58);
  // Two symbols drawn close enough to a solid one to be counted as its seats.
  // The swap then demotes that solid symbol, which is how ten of ORNEK's real
  // tables were destroyed.
  for (let i = 0; i < 2; i++) { const x = 130 + i * 150, y = 802; ring(x, y); hugging.push([x, y]); }
  // Six symbols in a row, spaced like the letters of a word: the gaps are
  // under half a mark wide and the row stands well clear of any detected
  // table, which is exactly what the printed-text-run test looks for.
  for (let i = 0; i < 6; i++) { const x = 110 + i * 66, y = 1010; ring(x, y); tight.push([x, y]); }
  return { src: c.toDataURL("image/png"), open, filled, tight, hugging, W, H,
    band: { x: 800, y: 715, w: 460, h: 58 } };
}

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Symbolic fixture");
  await page.fill('input[name="hotel"]', "Merit");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);

  const plan = await page.evaluate(buildPlan);
  await page.evaluate((src) => {
    state.events[0].background = { src, name: "symbolic.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, plan.src);
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 100000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const a = state.events[0].analysis, d = a.diagnostics || {};
    const all = [...(a.candidates || []), ...(a.venues || [])];
    const tables = (a.candidates || []).filter((c) => c.kind === "table");
    return {
      representation: d.representation ? d.representation.kind : null,
      swap: d.representationSwap || null,
      chairsDetected: d.chairsDetected,
      tables: tables.length,
      boxes: tables.map((c) => ({ cx: (c.x + c.w / 2) / 100, cy: (c.y + c.h / 2) / 100 })),
      venueTypes: all.filter((c) => c.kind === "venue")
        .reduce((m, c) => (m[c.type] = (m[c.type] || 0) + 1, m), {}),
      seatsClaimed: tables.reduce((n, c) => n + (c.chairDetections || []).length, 0),
      allSeatsUnknown: tables.every((c) => c.seatsUnknown === true),
      allInFamily: tables.every((c) => c.symbolFamily === true),
    };
  });

  const constructed = plan.open.length + plan.filled.length + plan.tight.length + plan.hugging.length;
  checks.require(out.representation === "SYMBOLIC",
    "a drawing of repeated symbols with no seating is read as symbolic", out.representation);

  // ---- the invariant ---------------------------------------------------
  // On a symbolic plan the uniform family IS the tables. Every member the
  // detector found must be one — whichever source found it, and whichever
  // route it took. Each of the three Phase 6 fixes exists to make this hold.
  const swap = out.swap || {};
  checks.equal(swap.promotedToTable, out.chairsDetected + (swap.fromTheFamilysOtherPolarity || 0),
    "every detected member of the uniform family becomes a table");

  // ---- and it found the drawing ----------------------------------------
  checks.equal(out.tables, constructed,
    `all ${constructed} constructed symbols are returned as tables`);
  const hit = (pt) => out.boxes.some((b) =>
    Math.hypot(b.cx * plan.W - pt[0], b.cy * plan.H - pt[1]) <= 32);
  checks.equal(plan.open.map(hit).filter(Boolean).length, plan.open.length,
    "every open symbol is found");
  checks.equal(plan.filled.map(hit).filter(Boolean).length, plan.filled.length,
    "every SOLID symbol is found — the family is a family, not a polarity");
  checks.equal(plan.tight.map(hit).filter(Boolean).length, plan.tight.length,
    "a row of symbols spaced like the letters of a word survives as tables");
  checks.equal(plan.hugging.map(hit).filter(Boolean).length, plan.hugging.length,
    "and so do symbols close enough to another to have been read as its seats");

  // Each route is asserted by name. A fixture where one quietly stopped firing
  // would satisfy every count above while guarding nothing.
  checks.equal(swap.fromTheFamilysOtherPolarity, plan.filled.length,
    "the solid symbols are recovered by the family rule");
  checks.equal(swap.restoredFromTextRun, plan.tight.length,
    "the word-shaped row is restored rather than deleted as printing");
  checks.equal(swap.restoredFromSeatOfADemotedTable, plan.hugging.length,
    "and members counted as seats of a demoted table are given back");

  // ---- what it must NOT do ---------------------------------------------
  const b = plan.band;
  checks.ok(!out.boxes.some((x) => x.cx * plan.W > b.x && x.cx * plan.W < b.x + b.w
    && x.cy * plan.H > b.y && x.cy * plan.H < b.y + b.h),
    "the architectural band is not returned as a table");
  checks.equal(out.venueTypes.stage || 0, 0,
    "and it is not named a stage on the strength of its aspect ratio");
  checks.equal(out.venueTypes.chair || 0, 0,
    "no chairs are invented on a drawing that draws none");
  checks.equal(out.seatsClaimed, 0, "no seats are claimed at any table");
  checks.ok(out.allSeatsUnknown,
    "every table reports its seat count as unknown rather than as zero");
  checks.ok(out.allInFamily,
    "every table carries its family membership, so later stages can see the basis");
}
