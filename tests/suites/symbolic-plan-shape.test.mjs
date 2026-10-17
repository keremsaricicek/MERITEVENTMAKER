// A symbolic plan whose one repeated symbol is a SQUARE table.
//
// When a drawing shows no seating, the representation verdict promotes the
// plan's uniform family to tables. Until 2026-10-17 every promoted member was
// typed "round", which is right for ORNEK's printed discs and wrong for any
// plan whose symbol is a square: measured on the generated bold-black and
// pastel-arch relation scenes, 126 of 126 squares came back round, and the
// grouping rule (which never joins round symbols) then left every
// pushed-together row apart. A promoted member is now typed from its own
// filled outline (`MeritPlanShape.classifyTableShape`), the same reading every
// other table gets. `symbolic-plan-detection` keeps the ring version of this
// plan, and asserts its discs stay round.
//
// Built here, so its ground truth is exact by construction: outlined squares
// with their number printed inside, the same square drawn solid (the family's
// other polarity), and no seat drawn anywhere.
import { openApp, futureDate } from "../lib/app-actions.mjs";

export const meta = {
  name: "symbolic-plan-shape",
  tags: ["intelligence", "detection"],
  timeout: 120000,
  viewport: { width: 1200, height: 800 },
};

function buildPlan() {
  const W = 1400, H = 900, S = 52;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  g.font = "16px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  const open = [], filled = [];
  let n = 1;
  for (let r = 0; r < 4; r++) for (let col = 0; col < 8; col++) {
    const x = 130 + col * 150, y = 120 + r * 150;
    g.strokeStyle = "#222"; g.lineWidth = 3;
    g.strokeRect(x - S / 2, y - S / 2, S, S);
    g.fillStyle = "#222"; g.fillText(String(n++), x, y);
    open.push([x, y]);
  }
  for (let i = 0; i < 4; i++) {
    const x = 130 + i * 150, y = 745;
    g.fillStyle = "#333"; g.fillRect(x - S / 2, y - S / 2, S, S);
    filled.push([x, y]);
  }
  return { src: c.toDataURL("image/png"), open, filled, W, H };
}

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Square symbols");
  await page.fill('input[name="hotel"]', "Merit");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);

  const plan = await page.evaluate(buildPlan);
  await page.evaluate((src) => {
    state.events[0].background = { src, name: "squares.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, plan.src);
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 100000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const a = state.events[0].analysis, d = a.diagnostics || {};
    const tables = (a.candidates || []).filter((c) => c.kind === "table");
    return {
      representation: d.representation ? d.representation.kind : null,
      tables: tables.map((c) => ({ cx: (c.x + c.w / 2) / 100, cy: (c.y + c.h / 2) / 100, type: c.type, basis: c.typeBasis || null, family: !!c.symbolFamily })),
      ownShapeLeft: [...(a.candidates || []), ...(a.venues || [])].filter((c) => "ownShape" in c).length,
    };
  });

  checks.require(out.representation === "SYMBOLIC", "a drawing of repeated square symbols with no seating is read as symbolic", out.representation);
  const at = (pt) => out.tables.find((b) => Math.hypot(b.cx * plan.W - pt[0], b.cy * plan.H - pt[1]) <= 32);
  const found = [...plan.open, ...plan.filled].map(at).filter(Boolean);
  checks.equal(found.length, plan.open.length + plan.filled.length, "every square symbol, open and solid, is found as a table");
  checks.ok(found.every((t) => t.family), "each carries its family membership");
  const typed = found.reduce((m, t) => (m[t.type] = (m[t.type] || 0) + 1, m), {});
  checks.equal(typed, { square: found.length }, "every square symbol is typed square, not round", found.filter((t) => t.type !== "square").slice(0, 4));
  checks.ok(found.every((t) => typeof t.basis === "string" && t.basis.startsWith("family-member-own-shape:")),
    "and says its type came from its own outline", found.map((t) => t.basis).slice(0, 3));
  checks.equal(out.ownShapeLeft, 0, "the intermediate own-shape reading is not left on any stored object");
}
