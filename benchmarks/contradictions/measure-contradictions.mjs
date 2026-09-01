// Does a contradiction point at something that is actually wrong?
//
//   npm run benchmark:contradictions
//
// The contradiction engine's whole value rests on one number. It tells an
// operator "these two stages of the analysis cannot both be right, look here" —
// and if the objects it points at are ordinary correct detections, it is worse
// than silence: it teaches people to dismiss it, and the one time it is right
// they will dismiss that too.
//
// So this scores TARGETED PRECISION against ground truth: of the objects the
// engine pointed at, what share are actually false positives? The honest
// baseline is the plain false-positive rate of the same rendering — pointing at
// random detections would score that. Anything at or below the baseline means
// the engine is not adding information, whatever its sentences say.
//
// It also checks the two things that would make it dishonest rather than
// merely useless: a claim still stated as certain while another stage disputes
// it, and a contradiction that does not name both of its sides.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const GOLDEN = path.join(BENCH, "plans", "merit-real-venue-plan.png");
const GOLDEN_ANNOT = JSON.parse(fs.readFileSync(path.join(BENCH, "annotations", "merit-real-venue.json"), "utf8"));

// The clean original plus the renderings where the detector is known to invent,
// so the correlation between "how wrong is this" and "how much does the engine
// object" is measurable rather than asserted.
const VARIANTS = ["ORIGINAL", "jpeg-q40", "grayscale", "noise", "downscale-70", "blur", "hue-shift", "contrast-high", "jpeg-q20"];

function imageFor(id) {
  if (id === "ORIGINAL") return { file: GOLDEN, annot: GOLDEN_ANNOT };
  const a = JSON.parse(fs.readFileSync(path.join(BENCH, "robustness", "annotations", `merit-real-${id}.json`), "utf8"));
  return { file: path.join(BENCH, a.source.file), annot: a };
}

const dataUrl = f => {
  const ext = path.extname(f).toLowerCase() === ".jpg" ? "jpeg" : "png";
  return `data:image/${ext};base64,${fs.readFileSync(f).toString("base64")}`;
};

async function analyse(page, baseUrl, file) {
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(250);
  await page.fill('input[name="name"]', "Contra");
  await page.fill('input[name="hotel"]', "Contra");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);
  await page.evaluate(src => {
    state.events[0].background = { src, name: "p", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, dataUrl(file));
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const a = state.events[0].analysis, pi = a.planIntelligence;
    const ow = a.originalWidth, oh = a.originalHeight;
    const box = c => ({ id: c.id, cx: (c.x + c.w / 2) / 100 * ow, cy: (c.y + c.h / 2) / 100 * oh });
    const was = ui.lang;
    const renderAll = lang => {
      ui.lang = lang;
      return {
        contradictions: pi.contradictions.map(c => t(c.key, c.params)),
        facts: pi.facts.map(f => t(f.key, f.params)),
        priorities: pi.reviewPriorities.slice(0, 3).map(p => t(p.key, p.params)),
      };
    };
    const text = { en: renderAll("en"), tr: renderAll("tr") };
    ui.lang = was;
    return {
      tables: a.candidates.filter(c => c.kind === "table" && c.status !== "rejected").map(box),
      contradictions: pi.contradictions.map(c => ({
        id: c.id, kind: c.kind, severity: c.severity, affects: c.affects,
        sides: c.sides.map(s => s.from), targetIds: c.targetIds,
      })),
      facts: pi.facts.map(f => ({ id: f.id, strength: f.strength,
        strengthBefore: f.strengthBefore || null, contradictedBy: f.contradictedBy || null })),
      topPriorities: pi.reviewPriorities.slice(0, 3).map(p => p.key),
      text,
    };
  });
}

const app = await serveApp();
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });

const report = { ranAt: new Date().toISOString(), variants: [], gates: {} };
const failures = [];

console.log("variant           tables  FP  baseline | contra  pointedAt  ofThoseFalse  precision | lift  kinds");
console.log("-".repeat(112));

for (const id of VARIANTS) {
  const { file, annot } = imageFor(id);
  const run = await analyse(page, app.baseUrl, file);
  const gt = annot.objects.filter(o => o.class === "table");
  const tol = ((annot.matchToleranceP ?? 3.0) / 100) * Math.hypot(annot.source.width, annot.source.height);

  // The same greedy matching the object benchmark uses, so a false positive
  // means the same thing here as it does everywhere else in this repository.
  const pairs = [];
  gt.forEach((g, gi) => run.tables.forEach((d, di) => {
    const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy);
    if (dist <= tol) pairs.push({ gi, di, dist });
  }));
  pairs.sort((a, b) => a.dist - b.dist);
  const usedG = new Set(), usedD = new Set();
  for (const p of pairs) {
    if (usedG.has(p.gi) || usedD.has(p.di)) continue;
    usedG.add(p.gi); usedD.add(p.di);
  }
  const falseIds = new Set(run.tables.filter((_, i) => !usedD.has(i)).map(t => t.id));
  const tableIds = new Set(run.tables.map(t => t.id));
  const baseline = run.tables.length ? falseIds.size / run.tables.length : 0;

  // Only table targets are scorable: the annotation settles what is and is not
  // a real table, and says nothing about which chair belongs to which one.
  const pointed = new Set(run.contradictions.flatMap(c => c.targetIds).filter(x => tableIds.has(x)));
  const pointedFalse = [...pointed].filter(x => falseIds.has(x)).length;
  const precision = pointed.size ? pointedFalse / pointed.size : null;
  const lift = precision != null && baseline > 0 ? precision / baseline : null;

  const kinds = [...new Set(run.contradictions.map(c => c.kind))].join(",");
  console.log(`${id.padEnd(17)} ${String(run.tables.length).padStart(6)} ${String(falseIds.size).padStart(3)}`
    + `  ${baseline.toFixed(3).padStart(8)} | ${String(run.contradictions.length).padStart(6)}`
    + ` ${String(pointed.size).padStart(10)} ${String(pointedFalse).padStart(13)}`
    + `  ${(precision == null ? "—" : precision.toFixed(3)).padStart(9)} | ${(lift == null ? "—" : lift.toFixed(2)).padStart(4)}  ${kinds}`);

  // -- the dishonesty checks, per rendering --------------------------------
  for (const f of run.facts)
    if (f.strength === "strong" && (f.contradictedBy || []).length)
      failures.push(`${id}: fact ${f.id} is stated as certain while ${f.contradictedBy.length} contradiction(s) dispute it`);
  for (const c of run.contradictions) {
    if (c.sides.length !== 2 || c.sides[0] === c.sides[1])
      failures.push(`${id}: contradiction ${c.id} does not name two distinct sides (${c.sides.join(" / ")})`);
    if (!c.targetIds.length && !["contra:memoryLost", "contra:tablesNoDining"].includes(c.id))
      failures.push(`${id}: contradiction ${c.id} points at nothing an operator could open`);
  }
  for (const lang of ["en", "tr"]) {
    const all = [...run.text[lang].contradictions, ...run.text[lang].facts, ...run.text[lang].priorities];
    for (const s of all)
      if (/^(contradiction|fact|priority)\./.test(s) || /\{[a-zA-Z]+\}/.test(s))
        failures.push(`${id}/${lang}: unrendered string "${s}"`);
  }

  report.variants.push({ variant: id, tables: run.tables.length, falsePositives: falseIds.size,
    baselineFalseRate: +baseline.toFixed(4), contradictions: run.contradictions.length,
    kinds: [...new Set(run.contradictions.map(c => c.kind))],
    pointedAt: pointed.size, pointedAtFalse: pointedFalse,
    targetedPrecision: precision == null ? null : +precision.toFixed(4),
    lift: lift == null ? null : +lift.toFixed(3),
    severities: run.contradictions.reduce((m, c) => (m[c.severity] = (m[c.severity] || 0) + 1, m), {}),
    downgradedFacts: run.facts.filter(f => f.strengthBefore).map(f => ({ id: f.id, from: f.strengthBefore, to: f.strength })),
    topPriorities: run.topPriorities,
    sample: { en: run.text.en.contradictions, tr: run.text.tr.contradictions } });
}

await browser.close();
await app.close();

// ---- gates -------------------------------------------------------------------
const scorable = report.variants.filter(v => v.targetedPrecision != null && v.baselineFalseRate > 0);
const meanPrecision = scorable.reduce((s, v) => s + v.targetedPrecision, 0) / Math.max(1, scorable.length);
const meanBaseline = scorable.reduce((s, v) => s + v.baselineFalseRate, 0) / Math.max(1, scorable.length);
const original = report.variants.find(v => v.variant === "ORIGINAL");
const beatsBaseline = scorable.filter(v => v.targetedPrecision > v.baselineFalseRate).length;

report.gates = {
  meanTargetedPrecision: +meanPrecision.toFixed(4),
  meanBaselineFalseRate: +meanBaseline.toFixed(4),
  renderingsWherePointingBeatsChance: `${beatsBaseline}/${scorable.length}`,
  contradictionsOnTheCleanOriginal: original ? original.contradictions : null,
  honestyFailures: failures.length,
};

console.log("\nGATES");
const gate = (label, value, ok, target) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${String(value).padStart(8)}   ${target}`);
  if (!ok) failures.push(`gate: ${label} = ${value} (${target})`);
};
gate("mean targeted precision", meanPrecision.toFixed(4), meanPrecision > meanBaseline,
  `> ${meanBaseline.toFixed(4)}, the rate of pointing at random`);
gate("renderings where pointing beats chance", `${beatsBaseline}/${scorable.length}`,
  beatsBaseline >= Math.ceil(scorable.length * 0.7), "at least 70%");
gate("contradictions on the clean original", original ? original.contradictions : "—",
  original && original.contradictions <= 4, "<= 4, or it cries wolf on a good plan");
const certainWhileDisputed = failures.filter(f => /stated as certain/.test(f)).length;
gate("facts stated as certain while disputed", certainWhileDisputed, certainWhileDisputed === 0, "0");

fs.writeFileSync(path.join(HERE, "report.json"), JSON.stringify(report, null, 1) + "\n");
console.log(`\nwrote ${path.relative(process.cwd(), path.join(HERE, "report.json"))}`);
console.log("\nREAL DISTINCT VENUE PLANS: 1. Every rendering above is the same drawing.");

if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("\nAll gates met.");
