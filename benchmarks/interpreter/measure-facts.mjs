// The whole-plan interpreter, scored against ground truth.
//
//   node benchmarks/interpreter/measure-facts.mjs
//
// The interpreter makes CLAIMS about a drawing — "46 tables, most of them
// square", "the plan states 124 pax but 112 seats were counted", "two stage
// areas". A claim can be wrong, and a product that states wrong things
// confidently is worse than one that says less. So every fact is checked
// against the annotation, and the two gates are deliberately asymmetric:
//
//   ACCURACY >= 0.90 over all checkable facts.
//
//   ZERO FABRICATED STRONG FACTS. A `strong` fact is one the interpreter says
//   the evidence is direct about. Being wrong there is not a miss, it is a
//   product that lies with confidence, and one is a failure.
//
// A fact whose truth the annotation cannot settle is UNCHECKABLE and scored
// neither way, with the reason recorded. Marking those correct would inflate
// the number with things nobody verified.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);

function plans() {
  const out = [];
  for (const f of fs.readdirSync(path.join(BENCH, "annotations")).sort()) {
    if (!f.endsWith(".json")) continue;
    const annot = JSON.parse(fs.readFileSync(path.join(BENCH, "annotations", f), "utf8"));
    const file = path.join(BENCH, annot.source.file);
    if (fs.existsSync(file)) out.push({ annot, file });
  }
  return out;
}

// What the annotation says, in the terms the facts make claims in.
function groundTruth(annot) {
  const tables = annot.objects.filter(o => o.class === "table");
  const byType = tables.reduce((m, t) => (m[t.type] = (m[t.type] || 0) + 1, m), {});
  const ranked = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  return {
    tables: tables.length,
    byType,
    modalType: ranked.length ? ranked[0][0] : null,
    chairs: annot.objects.filter(o => o.class === "chair").length,
    stages: annot.objects.filter(o => o.class === "stage" || o.class === "stage_extension").length,
    columns: annot.objects.filter(o => o.class === "column").length,
    statedCapacity: annot.capacity ? annot.capacity.ocrStated : null,
    // A chair with no relationship in the annotation is one the annotation
    // declines to seat, which is not the same as one seated nowhere.
    seatedTables: new Set((annot.relationships || []).filter(r => r.belongsTo).map(r => r.belongsTo)).size,
  };
}

// Each fact is checked by the only evidence that can settle it. Anything not
// listed here is reported as UNCHECKABLE rather than assumed true.
function checkFact(fact, gt) {
  const p = fact.params || {};
  switch (fact.key) {
    case "fact.tableTypeMix":
      // Which type dominates. Checked exactly, with no slack: it is a property
      // of the drawing, so missing a few tables must not change the answer.
      if (!gt.tables) return { checkable: false, why: "the annotation records no tables" };
      return { checkable: true, correct: p.type === gt.modalType,
        detail: { claimed: p.type, annotated: gt.modalType } };
    case "fact.tableCount":
      // How many. Allowed detection slack, because a count can never be better
      // than recall — which is exactly why this is a separate, weaker claim.
      if (!gt.tables) return { checkable: false, why: "the annotation records no tables" };
      return { checkable: true, correct: Math.abs(p.total - gt.tables) <= Math.max(2, gt.tables * 0.15),
        detail: { claimed: p.total, annotated: gt.tables } };
    case "fact.alsoHas":
      if (!(p.type in gt.byType)) return { checkable: true, correct: false,
        detail: { claimed: `${p.n} ${p.type}`, annotated: `no ${p.type} tables annotated` } };
      return { checkable: true, correct: Math.abs(p.n - gt.byType[p.type]) <= Math.max(1, gt.byType[p.type] * 0.34),
        detail: { claimed: p.n, annotated: gt.byType[p.type] } };
    case "fact.seats":
      if (!gt.chairs) return { checkable: false, why: "the annotation records no chairs" };
      return { checkable: true, correct: Math.abs(p.seats - gt.chairs) <= Math.max(3, gt.chairs * 0.15),
        detail: { claimed: p.seats, annotated: gt.chairs } };
    case "fact.unseatedTables": {
      if (!(annotHasRelationships)) return { checkable: false, why: "the annotation carries no chair-to-table relationships" };
      const annotatedUnseated = gt.tables - gt.seatedTables;
      return { checkable: true, correct: Math.abs(p.n - annotatedUnseated) <= Math.max(3, gt.tables * 0.15),
        detail: { claimed: p.n, annotated: annotatedUnseated } };
    }
    case "fact.zone":
      if (p.type === "stage")
        return { checkable: true, correct: gt.stages > 0,
          detail: { claimed: `${p.n} stage areas`, annotated: `${gt.stages} stage objects` } };
      if (p.type === "bistro")
        return { checkable: true, correct: (gt.byType.bistro || 0) > 0,
          detail: { claimed: `${p.n} bistro areas`, annotated: `${gt.byType.bistro || 0} bistro tables` } };
      if (p.type === "dining")
        return { checkable: true, correct: gt.tables > 0,
          detail: { claimed: `${p.n} dining areas`, annotated: `${gt.tables} tables` } };
      // lounge and entrance have no annotated counterpart on these plans.
      return { checkable: false, why: `the annotation does not record ${p.type} areas` };
    case "fact.capacityAgrees":
    case "fact.capacityDiffers": {
      if (gt.statedCapacity == null) return { checkable: false, why: "the annotation records no stated capacity" };
      // The claim is about what the DRAWING says, which OCR either read
      // correctly or did not.
      const statedOk = p.stated === gt.statedCapacity;
      const agreesClaimed = fact.key === "fact.capacityAgrees";
      const reallyAgrees = Math.abs(gt.statedCapacity - gt.chairs) <= Math.max(2, gt.statedCapacity * 0.05);
      return { checkable: true, correct: statedOk && agreesClaimed === reallyAgrees,
        detail: { claimedStated: p.stated, annotatedStated: gt.statedCapacity,
          claimedAgreement: agreesClaimed, annotatedAgreement: reallyAgrees } };
    }
    case "fact.noStatedCapacity":
      // True exactly when OCR did not run. The annotation cannot settle it, and
      // the fact is about the run rather than the plan.
      return { checkable: false, why: "a statement about whether OCR ran, not about the plan" };
    case "fact.undeterminedAreas":
      return { checkable: false, why: "an admission of uncertainty, which the annotation cannot contradict" };
    case "fact.unverifiedSeating":
      return { checkable: false, why: "banquette seat counts are not annotated — the annotation says so itself" };
    case "fact.combinedTables":
      if (!(annotHasLogicalGroups)) return { checkable: false, why: "the annotation records no logical groups" };
      return { checkable: true, correct: p.groups > 0,
        detail: { claimed: p.groups, annotated: annotLogicalGroupCount } };
    case "fact.nothingFound":
      return { checkable: true, correct: gt.tables === 0,
        detail: { claimed: "nothing detected", annotated: `${gt.tables} tables annotated` } };
    default:
      return { checkable: false, why: "no check is defined for this fact" };
  }
}

let annotHasRelationships = false, annotHasLogicalGroups = false, annotLogicalGroupCount = 0;

async function factsFor(browser, baseUrl, imagePath) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(250);
  await page.fill('input[name="name"]', "Interp");
  await page.fill('input[name="hotel"]', "Interp");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);
  const ext = path.extname(imagePath).toLowerCase() === ".jpg" ? "jpeg" : "png";
  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, `data:image/${ext};base64,${fs.readFileSync(imagePath).toString("base64")}`);
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => {
    const pi = state.events[0].analysis.planIntelligence;
    // Every fact must render in both languages without leaving a raw key or an
    // unfilled placeholder on screen.
    const was = ui.lang;
    const rendered = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang;
      rendered[lang] = (pi.facts || []).map(f => t(f.key, f.params));
    }
    ui.lang = was;
    return { facts: pi.facts || [], priorities: pi.reviewPriorities || [], rendered };
  });
  await page.close();
  return { ...out, errors };
}

const app = await serveApp();
const browser = await launchChromium();
const report = { ranAt: new Date().toISOString(), plans: [] };
let totalCheckable = 0, totalCorrect = 0, fabricatedStrong = [];

for (const { annot, file } of plans()) {
  annotHasRelationships = (annot.relationships || []).some(r => r.belongsTo);
  annotHasLogicalGroups = (annot.logicalGroups || []).length > 0;
  annotLogicalGroupCount = (annot.logicalGroups || []).length;
  const gt = groundTruth(annot);
  const { facts, priorities, rendered, errors } = await factsFor(browser, app.baseUrl, file);

  console.log(`\n=== ${annot.planId}`);
  const rows = [];
  for (const [i, f] of facts.entries()) {
    const verdict = checkFact(f, gt);
    const mark = !verdict.checkable ? "  --  " : verdict.correct ? "  ok  " : " WRONG";
    console.log(`${mark} [${f.strength.padEnd(9)}] ${rendered.en[i]}`);
    if (!verdict.checkable) console.log(`         unchecked: ${verdict.why}`);
    else if (!verdict.correct) console.log(`         ${JSON.stringify(verdict.detail)}`);
    if (verdict.checkable) {
      totalCheckable++;
      if (verdict.correct) totalCorrect++;
      else if (f.strength === "strong") fabricatedStrong.push({ plan: annot.planId, fact: f.key, rendered: rendered.en[i], detail: verdict.detail });
    }
    rows.push({ key: f.key, strength: f.strength, en: rendered.en[i], tr: rendered.tr[i],
      provenance: f.provenance, basis: f.basis, ...verdict });
  }

  // Every fact has to survive both languages.
  const untranslated = [];
  for (const lang of ["en", "tr"])
    rendered[lang].forEach((s, i) => {
      if (!s || /^fact\./.test(s) || /\{[a-zA-Z]+\}/.test(s)) untranslated.push({ lang, key: facts[i].key, got: s });
    });
  if (untranslated.length) console.log(`  UNTRANSLATED: ${JSON.stringify(untranslated.slice(0, 4))}`);

  console.log(`  priorities: ${priorities.length}` +
    (priorities.length ? `  first: ${priorities[0].key} -> ${priorities[0].targetIds.length} object(s)` : ""));
  report.plans.push({ planId: annot.planId, facts: rows, priorities, untranslated, pageErrors: errors.length });
}

await browser.close();
await app.close();

const accuracy = totalCheckable ? totalCorrect / totalCheckable : null;
const untranslatedTotal = report.plans.reduce((n, p) => n + p.untranslated.length, 0);
console.log(`\n=== SEMANTIC FACTS`);
console.log(`  checkable facts        ${totalCheckable}`);
console.log(`  correct                ${totalCorrect}`);
console.log(`  ACCURACY               ${accuracy === null ? "n/a" : accuracy.toFixed(4)}   gate >= 0.90  ${accuracy >= 0.9 ? "MET" : "NOT MET"}`);
console.log(`  FABRICATED STRONG      ${fabricatedStrong.length}                gate == 0     ${fabricatedStrong.length === 0 ? "MET" : "NOT MET"}`);
for (const f of fabricatedStrong) console.log(`    ${f.plan}: ${f.rendered}  ${JSON.stringify(f.detail)}`);
console.log(`  untranslated strings   ${untranslatedTotal}`);

report.accuracy = accuracy === null ? null : +accuracy.toFixed(4);
report.checkable = totalCheckable;
report.correct = totalCorrect;
report.fabricatedStrong = fabricatedStrong;
report.untranslated = untranslatedTotal;
report.gates = { accuracy: 0.9, accuracyMet: accuracy >= 0.9,
  fabricatedStrongMet: fabricatedStrong.length === 0, untranslatedMet: untranslatedTotal === 0 };
fs.writeFileSync(path.join(HERE, "report.json"), JSON.stringify(report, null, 1) + "\n");
console.log(`\nwrote ${path.relative(process.cwd(), path.join(HERE, "report.json"))}`);
process.exit(accuracy >= 0.9 && !fabricatedStrong.length && !untranslatedTotal ? 0 : 1);
