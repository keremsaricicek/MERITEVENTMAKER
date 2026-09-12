// Where in the pipeline does each missed table die?
//
//   node benchmarks/heldout/ornek-stage-walk.mjs
//
// "34 tables were missed" is a number. "Which stage removed each one" is a
// diagnosis, and the two demand opposite fixes: an object the detector never
// saw needs different work from one it saw and a later rule discarded.
//
// The first attempt at Phase 6 guessed at the causes and got two of three
// wrong — the assumed fold band does not exist (the local paper estimate reads
// 255 across the whole sheet), and the dark discs were not in the chair family
// they were assumed to be in. This walk is what replaced the guessing.
//
// It reads `globalThis.MERIT_STAGE_CENSUS`, which the detector populates only
// when `MERIT_DETECT_DEBUG` is set, and prints a per-object trace through every
// stage of the table path alongside a control group of tables that ARE found —
// so a stage that drops everything is distinguishable from one that drops only
// the objects under investigation.
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(path.dirname(here));
const gt = JSON.parse(fs.readFileSync(path.join(repo, "benchmarks/annotations/ornek-symbolic.json"), "utf8"));
const reportPath = path.join(repo, "benchmarks/reports/latest.json");
if (!fs.existsSync(reportPath)) throw new Error("run `npm run benchmark` first — no report to read misses from");
const rep = JSON.parse(fs.readFileSync(reportPath, "utf8")).reports.find((r) => r.planId === "ornek-symbolic");
if (!rep) throw new Error("no ornek-symbolic report in benchmarks/reports/latest.json");
const missed = new Set(rep.tables.missedIds || []);

const img = fs.readFileSync(path.join(repo, "benchmarks/plans/ornek-upright.png"));
const dataUrl = `data:image/png;base64,${img.toString("base64")}`;

const app = await serveApp();
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await page.goto(app.baseUrl + "/index.html");
await page.waitForLoadState("networkidle");
await page.evaluate(() => { globalThis.MERIT_DETECT_DEBUG = true; });
await page.click('.appbar [data-action="create-event"]');
await page.waitForTimeout(300);
await page.fill('input[name="name"]', "ORNEK");
await page.fill('input[name="hotel"]', "Merit");
await page.fill('input[name="date"]', "2026-10-02");
await page.click('button[data-setup="blank"]');
await page.waitForTimeout(600);
await page.evaluate((src) => {
  state.events[0].background = { src, name: "ornek.png", opacity: 1, visible: true, locked: false, scale: 100 };
  render();
}, dataUrl);
await page.waitForTimeout(400);
await page.click('[data-v8-action="detect"]');
await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 300000 });
await page.waitForTimeout(500);

// The annotation is in raw page pixels; detection runs on a canvas capped at
// 1920 on its long side, so one factor converts between them.
const dims = await page.evaluate(() => new Promise((res) => {
  const i = new Image();
  i.onload = () => res({ W: i.naturalWidth, H: i.naturalHeight });
  i.src = state.events[0].background.src;
}));
const k = Math.min(1, 1920 / Math.max(dims.W, dims.H));

const out = await page.evaluate(() => {
  const c = globalThis.MERIT_STAGE_CENSUS || {};
  const d = state.events[0].analysis.diagnostics || {};
  return {
    stages: {
      "source components": c.allSourceComps || [],
      "table pool": c.stage_pool || [],
      "after split": c.stage_expanded || [],
      "after de-dup": c.stage_unique || [],
      "after surface": c.stage_afterSurface || [],
      "chosen as table": c.stage_chosen || [],
    },
    chairs: c.accepted || [],
    chairModal: c.chairModal,
    swap: d.representationSwap || null,
    lostToAssociation: d.familyLostToAssociation || [],
    lostToTextRun: d.familyLostToTextRun || [],
  };
});
await browser.close();
await app.close();

const STAGES = Object.keys(out.stages);
console.log(`ORNEK stage walk — ${gt.objects.length} annotated, ${missed.size} missed by the last benchmark run`);
console.log(`chair-family modal ${out.chairModal}px   swap ${JSON.stringify(out.swap)}\n`);
console.log("stage sizes: " + STAGES.map((s) => `${s}=${out.stages[s].length}`).join("  "));

const hits = (boxes, o) => {
  const cx = o.cx * k, cy = o.cy * k, r = (o.w * k) / 2;
  return boxes.filter((b) => Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) <= r * 0.9);
};
// The two exits report percentages of the plan, not canvas pixels.
const hitsPct = (boxes, o) => boxes.filter((b) =>
  Math.hypot((b.x + b.w / 2) / 100 - o.cx / gt.source.width,
    (b.y + b.h / 2) / 100 - o.cy / gt.source.height) <= (o.w / gt.source.width) * 0.45);

const dark = gt.objects.filter((o) => o.state === "filled");
const foundAll = gt.objects.filter((o) => !missed.has(o.id));
const control = foundAll.filter((_, i) => i % Math.max(1, Math.floor(foundAll.length / 8)) === 0).slice(0, 8);
const stillMissed = gt.objects.filter((o) => missed.has(o.id));

for (const [label, set] of [
  ["STILL MISSED", stillMissed],
  ["the solid-ink half of the family", dark],
  ["control — tables that ARE found", control],
]) {
  if (!set.length) { console.log(`\n=== ${label}: none`); continue; }
  console.log(`\n=== ${label} (${set.length})`);
  for (const o of set) {
    const trace = STAGES.map((s) => (hits(out.stages[s], o).length ? "Y" : ".")).join("");
    const exits = [
      hitsPct(out.lostToAssociation, o).length ? "seat-of-a-demoted-table" : "",
      hitsPct(out.lostToTextRun, o).length ? "read-as-a-text-run" : "",
    ].filter(Boolean).join(" ");
    console.log(`  ${String(o.number ?? "solid").padStart(5)} @(${String(Math.round(o.cx)).padStart(4)},${String(Math.round(o.cy)).padStart(4)})  ${trace}  ${exits}`);
  }
}
console.log(`\n  trace columns, in order: ${STAGES.join(" | ")}`);
console.log("  a member can also leave the chair path entirely by one of the two exits named at the end of its row;");
console.log("  on a symbolic plan both are restored by the representation swap, so they should read as found.");
