// A partial read of a table's surface is not the table.
//
// The table pool takes one box per physical table from several sources and
// prefers the TONE source (the table finish), because the enclosed interior can
// also take in a chair tucked against the table. On a scan whose fill is uneven
// the tone family catches only PART of a table, and that part used to win: on
// the third real plan (Golden 2, a SEEN plan since its exam, 2026-11-01) the two
// upper round tables were each a closed ring (interior 91x92 px) of which the
// tone mask held 41 % and 7 %, so a piece seeded first, the whole disc was
// dropped as its duplicate, and the piece was then removed as a fragment —
// with the table's chairs left loose.
//
// Built here, so the truth is exact: twelve square tables set the plan's
// vocabulary, and two round tables are drawn as a ring whose table finish
// covers only a third of the disc (the rest a lighter cream), with six chairs
// each — the control rounds of the scratch version are left out, because a
// fully toned round is a different question (see the diagnosis in
// benchmarks/plans/blind/README.md). The interior must stand for the table: a ROUND table the size of the
// ring, with its chairs. Before the rule the piece came back as a 74x44
// "rectangle".
import { openApp, futureDate } from "../lib/app-actions.mjs";

export const meta = {
  name: "table-partial-surface-read",
  tags: ["intelligence", "detection"],
  timeout: 150000,
  viewport: { width: 1200, height: 800 },
};

function buildPlan() {
  // Painted pixel by pixel (no anti-aliasing), so the drawing is exactly the
  // one described above on every machine.
  const W = 1400, H = 1000, R = 45;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const img = g.createImageData(W, H), d = img.data;
  d.fill(255);
  const put = (x, y, [r, gg, b]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = 4 * (y * W + x); d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; };
  const BEIGE = [232, 212, 170], LIGHT = [247, 241, 230], BLUE = [70, 110, 190], OR = [235, 100, 50], ORD = [170, 60, 30];
  // a filled box with a 2 px outline, both ends inclusive
  const box = (x0, y0, x1, y1, fill, line) => {
    for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      const edge = x - Math.round(x0) < 2 || Math.round(x1) - x < 2 || y - Math.round(y0) < 2 || Math.round(y1) - y < 2;
      put(x, y, edge ? line : fill);
    }
  };
  const chair = (cx, cy, w, h) => box(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, OR, ORD);
  const squares = [], rounds = [];
  for (let r = 0; r < 3; r++) for (let col = 0; col < 4; col++) {
    const x = 140 + col * 130, y = 150 + r * 190;
    box(x - 30, y - 30, x + 30, y + 30, BEIGE, BLUE);
    chair(x, y - 47, 28, 24); chair(x, y + 47, 28, 24);
    squares.push([x, y]);
  }
  for (const [x, y] of [[850, 250], [850, 600]]) {
    for (let py = y - R; py <= y + R; py++) for (let px = x - R; px <= x + R; px++) {
      const dist = Math.hypot(px - x, py - y);
      if (dist > R) continue;
      // the finish reaches a third of the disc (200-320 degrees, y down), as
      // on an unevenly scanned print; the rest is a lighter cream
      const ang = (Math.atan2(py - y, px - x) * 180 / Math.PI + 360) % 360;
      put(px, py, dist > R - 2 ? BLUE : ang >= 200 && ang <= 320 ? BEIGE : LIGHT);
    }
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; chair(x + (R + 18) * Math.cos(a), y + (R + 18) * Math.sin(a), 24, 24); }
    rounds.push([x, y]);
  }
  g.putImageData(img, 0, 0);
  return { src: c.toDataURL("image/png"), squares, rounds, W, H, R };
}

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await page.click('.mx-head [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Partial surface");
  await page.fill('input[name="hotel"]', "Merit");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);

  const plan = await page.evaluate(buildPlan);
  await page.evaluate((src) => {
    state.events[0].background = { src, name: "partial.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, plan.src);
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 130000 });
  await page.waitForTimeout(400);

  const tables = await page.evaluate(() => (state.events[0].analysis.candidates || [])
    .filter((c) => c.kind === "table" && c.status !== "rejected")
    .map((c) => ({ x: c.x / 100, y: c.y / 100, w: c.w / 100, h: c.h / 100, type: c.type, chairs: (c.chairDetections || []).length, source: c.source || "classical" })));
  const at = (pt) => tables.find((t) => Math.hypot((t.x + t.w / 2) * plan.W - pt[0], (t.y + t.h / 2) * plan.H - pt[1]) <= 25);

  const squares = plan.squares.map(at);
  checks.ok(squares.every(Boolean), "the twelve square tables that set the plan's vocabulary are found", squares.filter((s) => !s).length);
  for (const [i, pt] of plan.rounds.entries()) {
    const t = at(pt);
    const box = t ? [Math.round(t.w * plan.W), Math.round(t.h * plan.H)] : null;
    checks.ok(!!t, `round table ${i + 1}, whose finish covers a third of its ring, is found`, tables.length);
    if (!t) continue;
    checks.equal(t.source, "classical", `round table ${i + 1} is the classical pipeline's own table, not only a second witness's`, t.source);
    checks.equal(t.type, "round", `round table ${i + 1} is typed round — the ring, not the piece of finish`, t.type);
    // the piece of finish alone measured 74 x 44; the ring is 90 across
    checks.ok(Math.min(...box) >= 0.75 * 2 * plan.R && Math.max(...box) <= 1.15 * 2 * plan.R, `its box is about the ring's size (${2 * plan.R} px), not the piece's`, box);
    checks.ok(t.chairs >= 5, `and its drawn chairs are its seats (6 drawn)`, t.chairs);
  }
}
