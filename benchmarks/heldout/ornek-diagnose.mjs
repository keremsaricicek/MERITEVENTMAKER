// Why did ORNEK score 0 tables and 143 chairs?
//
//   node benchmarks/heldout/ornek-diagnose.mjs
//
// The object-level benchmark reports precision and recall, which on this plan
// are both zero — and a zero hides which of two completely different failures
// happened. "The detector cannot see anything on this plan" and "the detector
// sees every object perfectly and calls it the wrong thing" produce the same
// score and need opposite fixes.
//
// So this asks the question the score cannot: for each candidate the pipeline
// produced, where is it relative to the 166 annotated tables, and what class
// did the pipeline give it? The answer is recorded in ORNEK-FIRST-RUN.md and
// must not be overwritten by later runs.
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import fs from "node:fs";

const app = await serveApp();
const gt = JSON.parse(fs.readFileSync(new URL("../annotations/ornek-symbolic.json", import.meta.url), "utf8"));
const img = fs.readFileSync(new URL("../plans/ornek-upright.png", import.meta.url));
const dataUrl = `data:image/png;base64,${img.toString("base64")}`;

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("  PAGE ERROR", e.message));
await page.goto(`${app.baseUrl}/index.html`);
await page.waitForLoadState("networkidle");
await page.click('.appbar [data-action="create-event"]');
await page.waitForTimeout(300);
await page.fill('input[name="name"]', "ORNEK probe");
await page.fill('input[name="hotel"]', "ORNEK probe");
await page.fill('input[name="date"]', "2026-10-02");
await page.click('button[data-setup="blank"]');
await page.waitForTimeout(700);
await page.evaluate((src) => {
  state.events[0].background = { src, name: "ornek.png", opacity: 1, visible: true, locked: false, scale: 100 };
  render();
}, dataUrl);
await page.waitForTimeout(400);
await page.click('[data-v8-action="detect"]');
await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 300000 }).catch(() => {});
await page.waitForTimeout(600);

const out = await page.evaluate(() => {
  const a = state.events[0].analysis;
  const cs = a.candidates || [];
  return {
    total: cs.length,
    byKind: cs.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {}),
    byKindSelected: cs.filter((c) => c.selected !== false).reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {}),
    items: cs.map((c) => ({
      kind: c.kind, x: c.x, y: c.y, w: c.w, h: c.h,
      selected: c.selected !== false,
      seats: (c.chairDetections || []).length,
      lowEvidence: c.lowEvidence ? c.lowEvidence.reason : null,
    })),
    planSummary: (a.planIntelligence || {}).planSummary || null,
  };
});
await browser.close();
await app.close();

const W = 2402, H = 1719;
console.log(`candidates ${out.total}`);
console.log(`by kind        ${JSON.stringify(out.byKind)}`);
console.log(`by kind (kept) ${JSON.stringify(out.byKindSelected)}`);
console.log(`plan summary: ${JSON.stringify(out.planSummary).slice(0, 500)}`);

// candidate geometry is a percentage of the plan; ground truth is in pixels
const toPx = (c) => ({
  cx: ((c.x + c.w / 2) / 100) * W,
  cy: ((c.y + c.h / 2) / 100) * H,
  w: (c.w / 100) * W, h: (c.h / 100) * H,
});
const tables = gt.objects;
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null);
for (const kind of Object.keys(out.byKind)) {
  const of = out.items.filter((c) => c.kind === kind).map(toPx);
  let hit = 0;
  const dists = [];
  for (const c of of) {
    let best = 1e9;
    for (const t of tables) best = Math.min(best, Math.hypot(t.cx - c.cx, t.cy - c.cy));
    dists.push(best);
    if (best < 45) hit++;
  }
  const covered = new Set();
  for (const c of of) for (const t of tables) if (Math.hypot(t.cx - c.cx, t.cy - c.cy) < 45) covered.add(t.id);
  console.log(`\n${kind}: ${of.length}`);
  console.log(`  box size median ${Math.round(med(of.map((c) => c.w)))} x ${Math.round(med(of.map((c) => c.h)))}  (a real table is 78 x 78)`);
  console.log(`  ${hit} of them sit within 45px of a real table centre`);
  console.log(`  they cover ${covered.size} of the 166 real tables`);
  console.log(`  distance to nearest real table: median ${Math.round(med(dists))}px`);
}

// which tables were not located AT ALL, and what did it call a table instead?
const covered = new Set();
for (const c of out.items.filter((c) => c.kind === "venue").map(toPx))
  for (const t of tables) if (Math.hypot(t.cx - c.cx, t.cy - c.cy) < 45) covered.add(t.id);
const missed = tables.filter((t) => !covered.has(t.id));
console.log(`\nNOT LOCATED AT ALL: ${missed.length} of ${tables.length}`);
console.log(`  by state: ${JSON.stringify(missed.reduce((m, t) => ((m[t.state] = (m[t.state] || 0) + 1), m), {}))}`);
console.log(`  numbers : ${missed.map((t) => t.number ?? "dark").join(",")}`);
console.log(`\nWHAT IT CALLED A TABLE:`);
for (const c of out.items.filter((c) => c.kind === "table").map(toPx)) {
  const r = gt.regions.find((g) => g.id !== "room-outline" && c.cx > g.x && c.cx < g.x + g.w && c.cy > g.y && c.cy < g.y + g.h);
  console.log(`  ${Math.round(c.w)}x${Math.round(c.h)} at (${Math.round(c.cx)},${Math.round(c.cy)}) -> ${r ? r.id : "(not in any annotated region)"}`);
}
