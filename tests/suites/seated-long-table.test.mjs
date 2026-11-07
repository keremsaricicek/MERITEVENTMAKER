// A long table seated along both long sides is a table, however long it is.
//
// The source size gate refuses any surface whose sides differ by more than
// 1:3.6 (aspect < 0.28 or > 3.6) — that is what keeps walls, bar counters and
// banquettes out of the table pool. On the third real plan (Golden 2, a SEEN plan
// since 2026-11-01, benchmarks/plans/blind/README.md) the 8-seat banquet table is
// 68x247 detection px, aspect 0.275, and was refused there; its chairs were left
// loose. What separates it from a wall or a counter is not its shape but who sits
// at it: seats along BOTH long sides. A counter is served from one side, a
// banquette from one side, a wall from none.
//
// Built here so the truth is exact: twelve square tables with two chairs each set
// the plan's vocabulary; one long table (60x240, aspect 0.25) carries four chairs
// along each long side; one counter of the same size carries four chairs along ONE
// side only. The long table must be found as a rectangle with its chairs; the
// counter must not become a table.
import { openApp, futureDate } from "../lib/app-actions.mjs";

export const meta = {
  name: "seated-long-table",
  tags: ["intelligence", "detection"],
  timeout: 150000,
  viewport: { width: 1200, height: 800 },
};

function buildPlan() {
  const W = 1400, H = 1000;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const img = g.createImageData(W, H), d = img.data;
  d.fill(255);
  const put = (x, y, [r, gg, b]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = 4 * (y * W + x); d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; };
  const BEIGE = [232, 212, 170], BLUE = [70, 110, 190], OR = [235, 100, 50], ORD = [170, 60, 30];
  const box = (x0, y0, x1, y1, fill, line) => {
    for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      const edge = x - Math.round(x0) < 2 || Math.round(x1) - x < 2 || y - Math.round(y0) < 2 || Math.round(y1) - y < 2;
      put(x, y, edge ? line : fill);
    }
  };
  const chair = (cx, cy, w, h) => box(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, OR, ORD);
  const squares = [];
  for (let r = 0; r < 3; r++) for (let col = 0; col < 4; col++) {
    const x = 140 + col * 130, y = 150 + r * 190;
    box(x - 30, y - 30, x + 30, y + 30, BEIGE, BLUE);
    chair(x, y - 47, 28, 24); chair(x, y + 47, 28, 24);
    squares.push([x, y]);
  }
  // the long table: 60 x 240, four chairs along each long side
  const long = [850, 450];
  box(long[0] - 30, long[1] - 120, long[0] + 30, long[1] + 120, BEIGE, BLUE);
  for (let k = 0; k < 4; k++) { const y = long[1] - 90 + k * 60; chair(long[0] - 47, y, 24, 28); chair(long[0] + 47, y, 24, 28); }
  // the counter: the same surface, served from one side only
  const counter = [1200, 450];
  box(counter[0] - 30, counter[1] - 120, counter[0] + 30, counter[1] + 120, BEIGE, BLUE);
  for (let k = 0; k < 4; k++) chair(counter[0] - 47, counter[1] - 90 + k * 60, 24, 28);
  g.putImageData(img, 0, 0);
  return { src: c.toDataURL("image/png"), squares, long, counter, W, H };
}

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await page.click('.mx-head [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Long table");
  await page.fill('input[name="hotel"]', "Merit");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);

  const plan = await page.evaluate(buildPlan);
  await page.evaluate((src) => {
    state.events[0].background = { src, name: "long.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, plan.src);
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 130000 });
  await page.waitForTimeout(400);

  const tables = await page.evaluate(() => (state.events[0].analysis.candidates || [])
    .filter((c) => c.kind === "table" && c.status !== "rejected")
    .map((c) => ({ x: c.x / 100, y: c.y / 100, w: c.w / 100, h: c.h / 100, type: c.type, chairs: (c.chairDetections || []).length, source: c.source || "classical" })));
  const at = (pt, r = 30) => tables.find((t) => Math.hypot((t.x + t.w / 2) * plan.W - pt[0], (t.y + t.h / 2) * plan.H - pt[1]) <= r);

  checks.ok(plan.squares.every((p) => at(p)), "the twelve square tables that set the plan's vocabulary are found", tables.length);
  const t = at(plan.long, 40);
  checks.ok(!!t, "the long table (60x240, aspect 0.25) seated along both long sides is found", tables);
  if (t) {
    const box = [Math.round(t.w * plan.W), Math.round(t.h * plan.H)];
    checks.ok(t.type === "rectangle" && box[0] >= 50 && box[0] <= 75 && box[1] >= 220 && box[1] <= 260, "as a rectangle the size of its drawn surface", { type: t.type, box });
    checks.ok(t.chairs >= 6 && t.chairs <= 8, "with the chairs drawn along its sides as its seats (8 drawn)", t.chairs);
  }
  checks.ok(!at(plan.counter, 40), "a counter of the same size seated from ONE side only is not made a table", tables.filter((x) => x.x * plan.W > 1100));
}
