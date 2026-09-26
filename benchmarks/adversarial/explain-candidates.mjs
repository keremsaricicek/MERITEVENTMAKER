// WHY WAS THIS PROPOSED? — a diagnostic, not a score.
//
// The adversarial runner says a fixture produced 46 phantom tables. It does
// not say what each of them carried, and "diagnose before theorising" is this
// repository's own rule: Phase 6 guessed at three causes and measurement
// contradicted two of them.
//
// This runs ONE fixture through the real detector and prints, for every
// candidate, the evidence the pipeline attached to it — so a separating
// signal can be LOOKED FOR rather than assumed. It deliberately prints the
// product's own fields only. It never reads the fixture's declaration: a
// signal that needs the ground truth to compute is not a signal the detector
// could ever use.
//
//   node benchmarks/adversarial/explain-candidates.mjs a6-architectural-confusion
//
// Optional second argument writes the full dump as JSON.
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const planId = process.argv[2];
const outPath = process.argv[3] || null;

if (!planId) {
  console.error("usage: explain-candidates.mjs <fixture-id> [out.json]");
  process.exit(2);
}
const imagePath = path.join(HERE, "fixtures", `${planId}.png`);
if (!fs.existsSync(imagePath)) {
  console.error(`no such fixture: ${imagePath}`);
  process.exit(2);
}

const server = await serveApp(ROOT);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(`${server.baseUrl}/index.html`);
await page.waitForLoadState("networkidle");
await page.click('.appbar [data-action="create-event"]');
await page.waitForTimeout(300);
await page.fill('input[name="name"]', "Explain");
await page.fill('input[name="hotel"]', "Explain");
await page.fill('input[name="date"]', "2026-10-02");
await page.click('button[data-setup="blank"]');
await page.waitForTimeout(700);
await page.evaluate((src) => {
  state.events[0].background = { src, name: "explain.png", opacity: 1, visible: true, locked: false, scale: 100 };
  render();
}, `data:image/png;base64,${fs.readFileSync(imagePath).toString("base64")}`);
await page.waitForTimeout(400);
await page.click('[data-v8-action="detect"]');
await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 180000 })
  .catch(() => console.log("  (detection timed out — printing whatever landed)"));
await page.waitForTimeout(500);

const out = await page.evaluate(() => {
  const a = state.events[0].analysis || {};
  return {
    diagnostics: a.diagnostics || null,
    // What the interpreter concluded, and what the capacity audit handed it.
    // A fact that is missing is usually missing because an INPUT was not what
    // it was assumed to be, so the inputs are printed beside the output.
    facts: ((a.planIntelligence || {}).facts || []).map((f) => ({ id: f.id, strength: f.strength })),
    capacityAudit: (a.diagnostics || {}).capacityAudit
      || (a.planIntelligence || {}).capacityAudit || null,
    candidates: (a.candidates || []).map((c) => ({
      kind: c.kind, type: c.type,
      x: c.x, y: c.y, w: c.w, h: c.h,
      confidence: c.confidence,
      lowEvidence: c.lowEvidence || null,
      status: c.status,
      chairDetections: (c.chairDetections || []).length,
      evidence: c.evidence || null,
    })),
  };
});

await browser.close();
await server.close();

const cands = out.candidates || [];
const tables = cands.filter((c) => c.kind === "table");
const chairs = cands.filter((c) => c.kind === "venue" && c.type === "chair");

console.log(`\n=== ${planId} ===`);
if (pageErrors.length) console.log("  PAGE ERRORS:", pageErrors.slice(0, 3));
console.log(`  representation : ${JSON.stringify(out.diagnostics?.representation ?? null)}`);
console.log(`  facts          : ${JSON.stringify(out.facts)}`);
console.log(`  capacityAudit  : ${JSON.stringify(out.capacityAudit)}`);
console.log(`  candidates     : ${cands.length}  (tables ${tables.length}, standalone chairs ${chairs.length})`);

const withSeats = tables.filter((t) => t.chairDetections > 0);
console.log(`  tables WITH an associated chair : ${withSeats.length}`);
console.log(`  tables WITHOUT one              : ${tables.length - withSeats.length}`);

// Which evidence fields exist at all, and how they distribute. A field that
// takes the same value on every candidate cannot separate anything.
const keys = new Set();
for (const t of tables) for (const k of Object.keys(t.evidence || {})) keys.add(k);
console.log(`  evidence fields : ${[...keys].join(", ") || "(none)"}`);
for (const k of keys) {
  const vals = tables.map((t) => (t.evidence || {})[k]).filter((v) => v !== undefined);
  const nums = vals.filter((v) => typeof v === "number");
  if (nums.length === vals.length && nums.length) {
    nums.sort((a, b) => a - b);
    const q = (p) => nums[Math.min(nums.length - 1, Math.floor(p * nums.length))];
    console.log(`    ${k.padEnd(14)} n=${nums.length} min=${q(0)} p25=${q(.25)} med=${q(.5)} p75=${q(.75)} max=${nums[nums.length - 1]}`);
  } else {
    const tally = {};
    for (const v of vals) { const s = String(v); tally[s] = (tally[s] || 0) + 1; }
    console.log(`    ${k.padEnd(14)} ${JSON.stringify(tally)}`);
  }
}

// Split by whether a chair was associated: if the two groups differ on some
// field, that field is a candidate signal.
const summarise = (label, group) => {
  if (!group.length) { console.log(`  ${label}: none`); return; }
  const conf = group.map((t) => t.confidence).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const area = group.map((t) => (t.w || 0) * (t.h || 0)).sort((a, b) => a - b);
  const mid = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
  console.log(`  ${label}: n=${group.length} medianConfidence=${mid(conf)} medianAreaPct=${mid(area)?.toFixed?.(3) ?? mid(area)}`);
};
summarise("with a chair   ", withSeats);
summarise("without a chair", tables.filter((t) => t.chairDetections === 0));

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`\n  full dump -> ${outPath}`);
}
console.log();
