// Object-level detection benchmark.
//
// Reports precision/recall per object class by MATCHING detections to
// annotated objects one-for-one. It deliberately does not compare totals:
// a detector can return the right count while missing real objects and
// inventing others, and that failure has to be visible here.
//
// Usage:
//   node benchmarks/run-benchmark.mjs [planIdSubstring]
// Requires the app served at localhost:8000 (python3 -m http.server 8000).

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.MERIT_BENCH_PORT || "8000";
const FILTER = process.argv[2] || "";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// ---- matching -------------------------------------------------------------
// Greedy nearest-first over all (gt, det) pairs within tolerance. Greedy on a
// globally sorted distance list is not optimal assignment, but it is stable,
// explainable and cannot silently pair a far detection when a near one exists.
function matchObjects(gtList, detList, diag, tolPct) {
  const tol = (tolPct / 100) * diag;
  const pairs = [];
  gtList.forEach((g, gi) => detList.forEach((d, di) => {
    const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy);
    if (dist <= tol) pairs.push({ gi, di, dist });
  }));
  pairs.sort((a, b) => a.dist - b.dist);
  const gUsed = new Set(), dUsed = new Set(), matches = [];
  for (const p of pairs) {
    if (gUsed.has(p.gi) || dUsed.has(p.di)) continue;
    gUsed.add(p.gi); dUsed.add(p.di);
    matches.push({ gt: gtList[p.gi], det: detList[p.di], dist: p.dist });
  }
  return {
    matches,
    missed: gtList.filter((_, i) => !gUsed.has(i)),      // false negatives
    spurious: detList.filter((_, i) => !dUsed.has(i)),   // false positives
  };
}

function prf(tp, fp, fn) {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3) };
}

// ---- detection through the real app --------------------------------------
async function detect(browser, imagePath) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // MERIT_BENCH_NO_FRAGMENT_FILTER=1 measures the pre-suppression baseline on
  // the same build, so a before/after table is two runs of one binary rather
  // than a comparison against remembered numbers from reverted code.
  if (process.env.MERIT_BENCH_NO_FRAGMENT_FILTER) {
    await page.addInitScript(() => { globalThis.MERIT_DISABLE_FRAGMENT_FILTER = true; });
  }
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Benchmark");
  await page.fill('input[name="hotel"]', "Benchmark");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(700);

  const b64 = fs.readFileSync(imagePath).toString("base64");
  await page.evaluate(src => {
    state.events[0].background = { src, name: "bench.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, `data:image/png;base64,${b64}`);
  await page.waitForTimeout(400);

  const t0 = Date.now();
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 180000 }).catch(() => {});
  const ms = Date.now() - t0;
  await page.waitForTimeout(600);

  // Candidate geometry is stored as percentages of the plan; convert back to
  // source pixels so it is directly comparable with the annotation.
  const out = await page.evaluate(() => {
    const a = state.events[0].analysis;
    if (!a) return null;
    const pi = a.planIntelligence || {};
    return {
      candidates: (a.candidates || []).map(c => ({
        id: c.id, kind: c.kind, type: c.type, status: c.status,
        xPct: c.x, yPct: c.y, wPct: c.w, hPct: c.h,
        confidence: c.confidence,
        chairCount: (c.chairDetections || []).length,
        chairs: (c.chairDetections || []).map(ch => ({ xPct: ch.x, yPct: ch.y })),
      })),
      planSummary: pi.planSummary || null,
      providerMetadata: pi.providerMetadata || null,
      reviewGroups: (pi.reviewGroups || []).length,
      uncertainQuestions: (pi.uncertainQuestions || []).length,
      capacityAudit: pi.capacityAudit || null,
      diagnostics: a.diagnostics || null,
    };
  });
  await page.close();
  return { out, ms, errors };
}

function toPixels(c, W, H) {
  return { ...c, cx: (c.xPct + c.wPct / 2) / 100 * W, cy: (c.yPct + c.hPct / 2) / 100 * H,
           w: c.wPct / 100 * W, h: c.hPct / 100 * H };
}

// ---- report ---------------------------------------------------------------
function evaluate(annot, det) {
  const W = annot.source.width, H = annot.source.height;
  const diag = Math.hypot(W, H);
  const tolPct = annot.matchToleranceP ?? 3.0;

  const cands = det.candidates.filter(c => c.status !== "rejected").map(c => toPixels(c, W, H));
  const gtTables = annot.objects.filter(o => o.class === "table");
  const detTables = cands.filter(c => c.kind === "table");

  const tableMatch = matchObjects(gtTables, detTables, diag, tolPct);
  const tables = prf(tableMatch.matches.length, tableMatch.spurious.length, tableMatch.missed.length);

  // Type accuracy is computed over MATCHED tables only: a type verdict on a
  // table the detector never found is meaningless.
  const typeStats = {};
  for (const t of ["square", "round", "bistro", "rectangle"]) typeStats[t] = { gtMatched: 0, correct: 0 };
  for (const m of tableMatch.matches) {
    const gtType = m.gt.type;
    if (!typeStats[gtType]) typeStats[gtType] = { gtMatched: 0, correct: 0 };
    typeStats[gtType].gtMatched++;
    if (m.det.type === gtType) typeStats[gtType].correct++;
  }
  const typeAccuracy = {};
  for (const k in typeStats) {
    typeAccuracy[k] = typeStats[k].gtMatched
      ? { matched: typeStats[k].gtMatched, correct: typeStats[k].correct,
          accuracy: +(typeStats[k].correct / typeStats[k].gtMatched).toFixed(3) }
      : { matched: 0, correct: 0, accuracy: null };
  }

  // Chairs: the annotation records a total count, not per-chair positions, so
  // report the count comparison and label it as such. Claiming chair
  // precision/recall without per-chair ground truth would be invented.
  const detChairsOnTables = cands.reduce((n, c) => n + (c.kind === "table" ? c.chairCount : 0), 0);
  const detStandaloneChairs = cands.filter(c => c.kind === "chair" || (c.kind === "venue" && c.type === "chair")).length;

  // Semantic venue objects
  const semantic = {};
  for (const cls of ["stage", "bar", "entrance", "exit", "column"]) {
    const gt = annot.objects.filter(o => o.class === cls);
    const dt = cands.filter(c => c.kind === "venue" && c.type === cls);
    if (!gt.length && !dt.length) continue;
    const m = matchObjects(gt, dt, diag, tolPct * 3); // venue objects are large; looser centre tolerance
    semantic[cls] = prf(m.matches.length, m.spurious.length, m.missed.length);
  }

  // How many detections land inside an annotated text or architecture region.
  // This is the direct measure of text/architecture false positives.
  //
  // Split by kind, because they are different failures with different costs.
  // A wall proposed as a TABLE puts a phantom table on the floor plan and into
  // the capacity total — that is the one that corrupts the product. A wall
  // proposed as a venue object is at worst clutter in the review queue. Rolling
  // both into one number hides which of the two a change actually moved.
  const inRegion = (c, r) => c.cx >= r.x && c.cx <= r.x + r.w && c.cy >= r.y && c.cy <= r.y + r.h;
  const textRegions = (annot.regions || []).filter(r => r.class === "text");
  const archRegions = (annot.regions || []).filter(r => r.class === "architecture" && r.w * r.h < W * H * 0.5);
  const textFPall = cands.filter(c => textRegions.some(r => inRegion(c, r)));
  const archFPall = cands.filter(c => archRegions.some(r => inRegion(c, r)));
  const textFP = textFPall.filter(c => c.kind === "table");
  const archFP = archFPall.filter(c => c.kind === "table");
  // Which specific regions attracted a phantom table, so a regression names
  // the offender instead of just moving a count.
  const regionHits = r => cands.filter(c => c.kind === "table" && inRegion(c, r)).length;
  const worstTextRegions = textRegions.map(r => ({ id: r.id, tables: regionHits(r) }))
    .filter(r => r.tables).sort((a, b) => b.tables - a.tables);
  const worstArchRegions = archRegions.map(r => ({ id: r.id, subclass: r.subclass, tables: regionHits(r) }))
    .filter(r => r.tables).sort((a, b) => b.tables - a.tables);

  return {
    planId: annot.planId,
    matchToleranceP: tolPct,
    tables: {
      groundTruth: gtTables.length, detected: detTables.length, ...tables,
      missedIds: tableMatch.missed.map(g => g.id),
      spuriousCount: tableMatch.spurious.length,
    },
    tableTypeAccuracy: typeAccuracy,
    chairs: {
      note: "This annotation records a chair TOTAL, not per-chair positions, so precision/recall is not computed for chairs — only the count comparison below.",
      annotatedChairs: annot.capacity?.annotatedChairs ?? null,
      detectedOnTables: detChairsOnTables,
      detectedStandalone: detStandaloneChairs,
      detectedTotal: detChairsOnTables + detStandaloneChairs,
    },
    capacity: {
      ocrStated: annot.capacity?.ocrStated ?? null,
      annotatedChairs: annot.capacity?.annotatedChairs ?? null,
      systemPhysicalSeats: det.planSummary?.physicalSeats ?? null,
      unverifiedInAnnotation: (annot.capacity?.unverified || []).map(u => ({ objectIds: u.objectIds, reason: u.reason })),
      auditFromApp: det.capacityAudit,
    },
    semanticObjects: semantic,
    falsePositiveRegions: {
      textRegionsAnnotated: textRegions.length,
      tablesInsideTextRegions: textFP.length,
      anyDetectionInsideTextRegions: textFPall.length,
      worstTextRegions,
      architectureRegionsAnnotated: archRegions.length,
      tablesInsideArchitectureRegions: archFP.length,
      anyDetectionInsideArchitectureRegions: archFPall.length,
      worstArchitectureRegions: worstArchRegions,
    },
    humanEffort: {
      reviewGroups: det.reviewGroups,
      uncertainQuestions: det.uncertainQuestions,
      note: "review groups + questions the operator must resolve before Plan Confirmed",
    },
    provider: det.providerMetadata,
  };
}

// ---- main -----------------------------------------------------------------
const annDir = path.join(ROOT, "annotations");
const files = fs.readdirSync(annDir).filter(f => f.endsWith(".json")).filter(f => !FILTER || f.includes(FILTER));
if (!files.length) { console.error("no annotations matched", FILTER); process.exit(1); }

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const reports = [];
for (const f of files) {
  const annot = JSON.parse(fs.readFileSync(path.join(annDir, f), "utf8"));
  const img = path.join(ROOT, annot.source.file);
  if (!fs.existsSync(img)) { console.error(`SKIP ${annot.planId}: image missing at ${img}`); continue; }
  const sha = crypto.createHash("sha256").update(fs.readFileSync(img)).digest("hex");
  const shaOK = !annot.source.sha256 || annot.source.sha256 === sha;
  if (!shaOK) console.error(`WARNING ${annot.planId}: image sha256 differs from annotation — ground truth may no longer describe this image`);

  process.stdout.write(`\n=== ${annot.planId} ===\n`);
  const { out, ms, errors } = await detect(browser, img);
  if (!out) { console.error("  detection produced no analysis"); continue; }
  const rep = evaluate(annot, out);
  rep.detectionMs = ms;
  rep.pageErrors = errors;
  rep.imageShaMatches = shaOK;
  reports.push(rep);

  const t = rep.tables;
  console.log(`  TABLES   gt=${t.groundTruth} det=${t.detected} TP=${t.tp} FP=${t.fp} FN=${t.fn} P=${t.precision} R=${t.recall} F1=${t.f1}`);
  console.log(`  TYPES    ${Object.entries(rep.tableTypeAccuracy).filter(([, v]) => v.matched).map(([k, v]) => `${k} ${v.correct}/${v.matched}`).join("  ") || "(none matched)"}`);
  console.log(`  CHAIRS   annotated=${rep.chairs.annotatedChairs} detected=${rep.chairs.detectedTotal} (onTables=${rep.chairs.detectedOnTables} standalone=${rep.chairs.detectedStandalone})`);
  console.log(`  CAPACITY ocrStated=${JSON.stringify(rep.capacity.ocrStated?.total ?? null)} systemSeats=${rep.capacity.systemPhysicalSeats}`);
  const fpz = rep.falsePositiveRegions;
  console.log(`  FP-ZONES text: ${fpz.tablesInsideTextRegions} tables (${fpz.anyDetectionInsideTextRegions} any) in ${fpz.textRegionsAnnotated} regions` +
    `   arch: ${fpz.tablesInsideArchitectureRegions} tables (${fpz.anyDetectionInsideArchitectureRegions} any) in ${fpz.architectureRegionsAnnotated} regions`);
  if (fpz.worstTextRegions.length) console.log(`           text offenders: ${fpz.worstTextRegions.slice(0, 6).map(r => `${r.id}x${r.tables}`).join(" ")}`);
  if (fpz.worstArchitectureRegions.length) console.log(`           arch offenders: ${fpz.worstArchitectureRegions.slice(0, 6).map(r => `${r.id}x${r.tables}`).join(" ")}`);
  const sem = Object.entries(rep.semanticObjects).map(([k, v]) => `${k} TP${v.tp}/FP${v.fp}/FN${v.fn}`).join("  ");
  if (sem) console.log(`  SEMANTIC ${sem}`);
  console.log(`  EFFORT   reviewGroups=${rep.humanEffort.reviewGroups} questions=${rep.humanEffort.uncertainQuestions}`);
  console.log(`  TIME     ${ms} ms   pageErrors=${errors.length}`);
}
await browser.close();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(ROOT, "reports", `benchmark-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), reports }, null, 2));
fs.writeFileSync(path.join(ROOT, "reports", "latest.json"), JSON.stringify({ ranAt: new Date().toISOString(), reports }, null, 2));
console.log(`\nwrote ${outFile}`);
