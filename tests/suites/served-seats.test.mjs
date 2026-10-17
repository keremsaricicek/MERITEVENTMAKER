// Solid seats around outlined tables: the population the chair stage takes as
// "the seat" is really the tables (D12, 2026-10-17).
//
// On a sheet that draws each table as a closed outline and its chairs as solid
// shapes, the largest chair source is the outline-interior one, and what it
// holds is the tables' interiors. The real chairs were never offered as seats,
// the verdict found "seats" sitting at nothing and called the drawing
// symbolic: 0 of 169 chairs on the generated `rel-bold-black-7000032`, 0 of 123
// on `rel-pastel-arch-7000043`, and 29 black chairs promoted to TABLES on the
// first. `MeritPlanChairs` now asks, where the reference is at table scale,
// whether a smaller population SERVES it — outside each table, at most of
// them, at least two per table, on more than one side — and if so seats it.
//
// Three drawings built here, so the truth is exact by construction:
//   A. outlined squares, four solid black seats each;
//   B. pale outlined squares with half-disc seats, one row set at 45°
//      (the seat's axis-aligned box is square there, which used to fail the
//      seat-shape test and leave those tables seatless);
//   C. the control: numbered outlined squares with two seat-sized solid
//      marks BELOW each — two per table, as in A, but on one side only. It
//      must stay symbolic, refused on the surround rule and nothing else (a
//      smaller mark was read as printing by OCR and never reached the rule,
//      which proved nothing). The cost is stated, not hidden: tables seated
//      along one side only are not recognised by this rule either.
import { openApp, futureDate } from "../lib/app-actions.mjs";

export const meta = {
  name: "served-seats",
  tags: ["intelligence", "detection"],
  timeout: 240000,
  viewport: { width: 1200, height: 800 },
};

function buildPlans() {
  const W = 1400, H = 900, S = 56, GAP = 6;
  const canvas = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H); return [c, g]; };
  const out = {};
  // A — solid black seats
  {
    const [c, g] = canvas(); const tables = [], seats = []; const SEAT = 34;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) {
      const x = 150 + k * 175, y = 130 + r * 200;
      g.strokeStyle = "#111"; g.lineWidth = 4; g.strokeRect(x - S / 2, y - S / 2, S, S);
      tables.push([x, y]);
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const off = S / 2 + GAP + SEAT / 2, sx = x + dx * off, sy = y + dy * off;
        g.fillStyle = "#111"; g.fillRect(sx - SEAT / 2, sy - SEAT / 2, SEAT, SEAT);
        seats.push([sx, sy]);
      }
    }
    out.A = { src: c.toDataURL("image/png"), tables, seats };
  }
  // B — half-disc seats, the bottom row turned 45°
  {
    const [c, g] = canvas(); const tables = [], seats = []; const R = 15;
    const table = (x, y, rot, sides) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = "#e8eff8"; g.fillRect(-S / 2, -S / 2, S, S);
      g.strokeStyle = "#7f93ad"; g.lineWidth = 1.5; g.strokeRect(-S / 2, -S / 2, S, S);
      for (const a of sides) {
        const off = S / 2 + GAP, sx = Math.cos(a) * off, sy = Math.sin(a) * off;
        g.beginPath(); g.arc(sx, sy, R, a - Math.PI / 2, a + Math.PI / 2); g.closePath();
        g.fillStyle = "#f6d6dc"; g.fill(); g.strokeStyle = "#3c4a63"; g.lineWidth = 1.2; g.stroke();
        seats.push([x + Math.cos(a + rot) * (off + R * 0.42), y + Math.sin(a + rot) * (off + R * 0.42)]);
      }
      g.restore(); tables.push([x, y]);
    };
    for (let r = 0; r < 2; r++) for (let k = 0; k < 7; k++) table(150 + k * 175, 140 + r * 220, 0, [0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    for (let k = 0; k < 7; k++) table(150 + k * 175, 640, Math.PI / 4, [0, Math.PI]);
    out.B = { src: c.toDataURL("image/png"), tables, seats };
  }
  // C — the control: two marks on ONE side of each numbered table
  {
    const [c, g] = canvas(); const tables = [], marks = []; const M = 24;
    g.font = "16px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    let n = 1;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) {
      const x = 150 + k * 175, y = 120 + r * 200;
      g.strokeStyle = "#222"; g.lineWidth = 3; g.strokeRect(x - S / 2, y - S / 2, S, S);
      g.fillStyle = "#222"; g.fillText(String(n++), x, y);
      for (const dx of [-15, 15]) { g.fillRect(x + dx - M / 2, y + S / 2 + GAP, M, M); marks.push([x + dx, y + S / 2 + GAP + M / 2]); }
      tables.push([x, y]);
    }
    out.C = { src: c.toDataURL("image/png"), tables, marks };
  }
  return { ...out, W, H };
}

// One fresh event per drawing: the review screen replaces the Analyse control
// once an analysis exists.
async function freshEvent(page, baseUrl) {
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* storage isolated per suite */ } });
  await openApp(page, baseUrl);
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Served seats");
  await page.fill('input[name="hotel"]', "Merit");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);
}

async function analyse(page, baseUrl, src, name) {
  await freshEvent(page, baseUrl);
  await page.evaluate(({ src, name }) => {
    state.events[0].background = { src, name, opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, { src, name });
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 100000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const a = state.events[0].analysis, d = a.diagnostics || {};
    const live = (a.candidates || []).filter((c) => c.status !== "rejected");
    const centre = (c) => [(c.x + c.w / 2) / 100, (c.y + c.h / 2) / 100];
    return {
      representation: d.representation ? d.representation.kind : null,
      served: d.secondaryChairFamilies ? d.secondaryChairFamilies.servedSeats : null,
      tables: live.filter((c) => c.kind === "table").map(centre),
      // seats at a table, as the product stores them (centre boxes in percent)
      seats: live.flatMap((c) => (c.chairDetections || []).map((s) => [s.x / 100, s.y / 100])),
    };
  });
}

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const plans = await page.evaluate(buildPlans);
  const { W, H } = plans;
  const hits = (pts, found, r) => pts.filter((p) => found.some((f) => Math.hypot(f[0] * W - p[0], f[1] * H - p[1]) <= r)).length;

  const a = await analyse(page, baseUrl, plans.A.src, "solid-seats.png");
  checks.equal(a.representation, "PHYSICAL", "A: outlined tables ringed by solid seats are a drawing that draws its seats", a.served);
  checks.ok(a.served && a.served.accepted === true, "A: the interiors are recognised as the tables the solid seats serve", a.served);
  checks.equal(hits(plans.A.tables, a.tables, 20), plans.A.tables.length, "A: every table is found");
  checks.equal(hits(plans.A.seats, a.seats, 12), plans.A.seats.length, "A: every solid seat is found, at a table");
  checks.equal(hits(plans.A.seats, a.tables, 12), 0, "A: no solid seat is promoted to a table");
  checks.equal(a.tables.length, plans.A.tables.length, "A: and nothing else is a table");

  const b = await analyse(page, baseUrl, plans.B.src, "half-disc-seats.png");
  checks.equal(b.representation, "PHYSICAL", "B: pale tables with half-disc seats are a drawing that draws its seats", b.served);
  checks.equal(hits(plans.B.tables, b.tables, 20), plans.B.tables.length, "B: every table is found, the 45° row included");
  checks.equal(hits(plans.B.seats, b.seats, 12), plans.B.seats.length, "B: every half-disc is found, at a table — the ones beside a 45° table too");

  const c = await analyse(page, baseUrl, plans.C.src, "marks-below.png");
  checks.equal(c.representation, "SYMBOLIC", "C: numbered tables with two marks printed on one side stay symbolic", c.served);
  checks.ok(c.served && c.served.considered === true && c.served.accepted === false && c.served.resultant > 0.5,
    "C: the question was asked and refused because the marks stand on one side, not around", c.served);
  checks.equal(hits(plans.C.tables, c.tables, 20), plans.C.tables.length, "C: every table is still found");
  checks.equal(hits(plans.C.marks, c.tables, 10), 0, "C: no mark becomes a table");
}
