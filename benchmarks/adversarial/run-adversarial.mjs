// Runs the real build against the eight adversarial fixtures and scores it.
//
// The rule this file exists to enforce is the one that is easy to write down
// and hard to keep:
//
//     CREATE  ->  FREEZE  ->  RUN  ->  RECORD  ->  only then change inference.
//
// A fixture that can be edited after its first result is not a test, it is a
// mirror. So the freeze is mechanical, not a promise: FROZEN.json holds the
// sha256 of every fixture image AND of every declaration, and this runner
// refuses to score a fixture whose bytes have moved. Changing a fixture is
// allowed — regenerating and re-freezing is a deliberate, visible act — but it
// cannot happen quietly in the middle of tuning.
//
// What it measures, per fixture:
//
//   objects        table and chair precision/recall/F1, and table types
//   held back      real tables the pipeline detected but deselected — the
//                  gates that keep an object off the floor plan are exactly
//                  where an over-general rule does its damage
//   relations      chair -> table, scored ONLY where both ends were detected,
//                  plus what the system did with the chairs whose ground truth
//                  deliberately abstains
//   zones          precision, recall, and false zone inventions
//   facts          expected present, forbidden present, and how many of the
//                  forbidden ones were stated as STRONG
//   regions        detections landing inside annotated text/architecture
//   cost           detection time
//
// Usage:
//   node benchmarks/adversarial/run-adversarial.mjs                 # all
//   node benchmarks/adversarial/run-adversarial.mjs a1              # one
//   node benchmarks/adversarial/run-adversarial.mjs --freeze        # (re)freeze
//   node benchmarks/adversarial/run-adversarial.mjs --record-baseline
//   node benchmarks/adversarial/run-adversarial.mjs --compare       # vs baseline
//
// SYNTHETIC ADVERSARIAL FIXTURES. NOT REAL VENUES. They do not count toward
// REAL DISTINCT VENUE PLANS, which is 1.

import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(ROOT, "..");
const DECL_DIR = path.join(ROOT, "declarations");
const FROZEN = path.join(ROOT, "FROZEN.json");
const BASELINE = path.join(ROOT, "BASELINE.json");
const LATEST = path.join(ROOT, "latest.json");

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const FILTER = argv.find(a => !a.startsWith("--")) || "";

const sha = buf => crypto.createHash("sha256").update(buf).digest("hex");
const declFiles = () => fs.readdirSync(DECL_DIR).filter(f => f.endsWith(".json")).sort();

// ---- freeze ----------------------------------------------------------------
function freeze() {
  const entries = {};
  for (const f of declFiles()) {
    const declBytes = fs.readFileSync(path.join(DECL_DIR, f));
    const decl = JSON.parse(declBytes);
    const img = path.join(BENCH, decl.source.file);
    entries[decl.planId] = {
      declaration: sha(declBytes),
      image: sha(fs.readFileSync(img)),
      width: decl.source.width, height: decl.source.height,
      tables: decl.objects.filter(o => o.class === "table").length,
      chairs: decl.objects.filter(o => o.class === "chair").length,
      scoreableRelations: decl.relationships.filter(r => r.belongsTo).length,
      ambiguousRelations: decl.relationships.filter(r => !r.belongsTo).length,
    };
  }
  fs.writeFileSync(FROZEN, JSON.stringify({
    frozenAt: new Date().toISOString(),
    note: "Hashes of the adversarial fixtures and their declarations at the moment they were frozen. " +
      "run-adversarial.mjs refuses to score a fixture whose bytes differ from these, so a fixture cannot be " +
      "quietly adjusted to agree with an algorithm change. Re-freezing is deliberate and shows up in the diff.",
    realVenue: false,
    entries,
  }, null, 2) + "\n");
  console.log(`froze ${Object.keys(entries).length} fixtures -> ${path.relative(process.cwd(), FROZEN)}`);
}

// A fixture that fails its freeze check is not scored at all. Skipping the
// check when the file is missing would make the guard vacuous, so a missing
// FROZEN.json is itself a refusal.
function checkFrozen(decl, declBytes, imgBytes) {
  if (!fs.existsSync(FROZEN))
    return { ok: false, why: "FROZEN.json is missing — nothing has been frozen, so nothing can be scored" };
  const frozen = JSON.parse(fs.readFileSync(FROZEN, "utf8"));
  const e = frozen.entries[decl.planId];
  if (!e) return { ok: false, why: `${decl.planId} is not in FROZEN.json` };
  const problems = [];
  if (e.declaration !== sha(declBytes)) problems.push("the declaration has changed since it was frozen");
  if (e.image !== sha(imgBytes)) problems.push("the image has changed since it was frozen");
  return problems.length ? { ok: false, why: problems.join("; ") } : { ok: true };
}

// ---- scoring helpers -------------------------------------------------------
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
  return { matches, missed: gtList.filter((_, i) => !gUsed.has(i)), spurious: detList.filter((_, i) => !dUsed.has(i)) };
}
const prf = (tp, fp, fn) => {
  const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, precision: +p.toFixed(3), recall: +r.toFixed(3), f1: +(p + r ? (2 * p * r) / (p + r) : 0).toFixed(3) };
};
const toPx = (c, W, H) => ({ ...c,
  cx: (c.xPct + c.wPct / 2) / 100 * W, cy: (c.yPct + c.hPct / 2) / 100 * H,
  w: c.wPct / 100 * W, h: c.hPct / 100 * H });
const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
};

// ---- detection through the real app ---------------------------------------
async function detect(browser, imagePath, baseUrl, timeoutMs) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Adversarial");
  await page.fill('input[name="hotel"]', "Adversarial");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(700);
  await page.evaluate(src => {
    state.events[0].background = { src, name: "adv.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, `data:image/png;base64,${fs.readFileSync(imagePath).toString("base64")}`);
  await page.waitForTimeout(400);

  const t0 = Date.now();
  await page.click('[data-v8-action="detect"]');
  // Wait for the pass to FINISH. `analysis` is assigned partway through, so
  // waiting on it alone reads a run that is still going.
  let timedOut = false;
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: timeoutMs })
    .catch(() => { timedOut = true; });
  const ms = Date.now() - t0;
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const a = state.events[0].analysis;
    if (!a) return null;
    const pi = a.planIntelligence || {};
    return {
      candidates: (a.candidates || []).map(c => ({
        id: c.id, kind: c.kind, type: c.type, status: c.status, selected: c.selected !== false,
        lowEvidence: c.lowEvidence || null,
        xPct: c.x, yPct: c.y, wPct: c.w, hPct: c.h, confidence: c.confidence,
        // `relation` does not exist in the build this baseline was recorded
        // from. Harvesting it anyway keeps the record shape stable, and a
        // baseline full of nulls is the honest statement that the concept was
        // absent rather than that it scored zero.
        chairs: (c.chairDetections || []).map(ch => ({ id: ch.id, xPct: ch.x, yPct: ch.y, wPct: ch.w, hPct: ch.h,
          relation: ch.relation || null })),
      })),
      providerMetadata: pi.providerMetadata || null,
      facts: (pi.facts || []).map(f => ({ id: f.id, strength: f.strength, params: f.params,
        provenance: (f.provenance || []).length })),
      zones: (pi.zones || []).map(z => ({ id: z.id, type: z.type, confidence: z.confidence,
        memberIds: z.memberIds || [], objects: z.objects, seats: z.seats })),
      sceneGraph: pi.sceneGraph ? { counts: pi.sceneGraph.counts, nodeCount: pi.sceneGraph.nodeCount,
        edges: (pi.sceneGraph.edges || []).length } : null,
      contradictions: (pi.contradictions || []).map(c => ({ id: c.id, kind: c.kind, severity: c.severity })),
      reviewPriorities: (pi.reviewPriorities || []).length,
      reviewGroups: (pi.reviewGroups || []).length,
      uncertainQuestions: (pi.uncertainQuestions || []).length,
      planSummary: pi.planSummary || null,
      diagnostics: a.diagnostics || null,
    };
  });
  await page.close();
  return { out, ms, errors, timedOut };
}

// ---- evaluation ------------------------------------------------------------
function evaluate(decl, det) {
  const W = decl.source.width, H = decl.source.height, diag = Math.hypot(W, H);
  const tol = decl.matchToleranceP ?? 2.0;

  const alive = det.candidates.filter(c => c.status !== "rejected").map(c => toPx(c, W, H));
  const gtTables = decl.objects.filter(o => o.class === "table");
  const gtChairs = decl.objects.filter(o => o.class === "chair");
  const detTables = alive.filter(c => c.kind === "table");

  const tm = matchObjects(gtTables, detTables, diag, tol);
  const tables = prf(tm.matches.length, tm.spurious.length, tm.missed.length);

  // Tables the pipeline found and then held back. This is the number the
  // seat-containment gate moves, and it is invisible in precision/recall
  // because a deselected candidate is still a candidate.
  const heldBack = tm.matches.filter(m => !m.det.selected);
  const heldBackReasons = heldBack.reduce((m, x) => {
    const r = x.det.lowEvidence?.reason || "unknown";
    m[r] = (m[r] || 0) + 1; return m;
  }, {});

  const typeStats = {};
  for (const m of tm.matches) {
    const k = m.gt.type;
    typeStats[k] = typeStats[k] || { matched: 0, correct: 0 };
    typeStats[k].matched++;
    if (m.det.type === k) typeStats[k].correct++;
  }
  for (const k in typeStats)
    typeStats[k].accuracy = +(typeStats[k].correct / typeStats[k].matched).toFixed(3);
  const distinctTypesFound = new Set(tm.matches.map(m => m.det.type)).size;

  // Chairs: every nested seat plus every standalone chair candidate.
  const detChairs = [];
  for (const c of alive) {
    for (const ch of c.chairs) detChairs.push({ ...toPx(ch, W, H), parentId: c.id });
    if (c.kind === "venue" && c.type === "chair") detChairs.push({ ...c, parentId: null, standalone: true });
  }
  const cm = matchObjects(gtChairs, detChairs, diag, tol);
  const chairs = prf(cm.matches.length, cm.spurious.length, cm.missed.length);

  // Relations. Scoreable only where the chair AND its ground-truth table were
  // both detected: a relation verdict on an object nobody found says nothing
  // about the relation logic.
  const tableDetToGt = new Map(tm.matches.map(m => [m.det.id, m.gt.id]));
  const gtChairToDet = new Map(cm.matches.map(m => [m.gt.id, m.det]));
  let correct = 0, wrong = 0, orphan = 0, unscoreable = 0;
  let forcedOnAmbiguous = 0, ambiguousDeclared = 0, ambiguousUnfound = 0;
  const wrongExamples = [];
  for (const rel of decl.relationships) {
    const d = gtChairToDet.get(rel.chair);
    if (!d) { if (!rel.belongsTo) ambiguousUnfound++; else unscoreable++; continue; }
    if (!rel.belongsTo) {
      // The drawing does not say which table this chair belongs to. Attaching
      // it to one anyway is not "correct by luck" — it is a confident answer to
      // a question with no answer. Attaching it AND SAYING SO is a different
      // thing and is allowed: the seat is real, so dropping it would lose
      // capacity; what must not happen is a silent confident answer.
      if (d.parentId && !(d.relation && d.relation.ambiguous)) forcedOnAmbiguous++;
      else if (d.parentId) ambiguousDeclared++;
      continue;
    }
    if (!d.parentId) { orphan++; continue; }
    const gtOfParent = tableDetToGt.get(d.parentId);
    if (gtOfParent === undefined) { unscoreable++; continue; }
    if (gtOfParent === rel.belongsTo) correct++;
    else { wrong++; if (wrongExamples.length < 6) wrongExamples.push({ chair: rel.chair, expected: rel.belongsTo, got: gtOfParent }); }
  }
  const scored = correct + wrong + orphan;
  const relations = {
    groundTruthScoreable: decl.relationships.filter(r => r.belongsTo).length,
    groundTruthAmbiguous: decl.relationships.filter(r => !r.belongsTo).length,
    scored, correct, wrong, orphan, unscoreable,
    accuracy: scored ? +(correct / scored).toFixed(3) : null,
    coverage: decl.relationships.filter(r => r.belongsTo).length
      ? +(scored / decl.relationships.filter(r => r.belongsTo).length).toFixed(3) : null,
    forcedOnAmbiguous, ambiguousDeclared, ambiguousChairsNotDetected: ambiguousUnfound,
    // How many scoreable relations the system itself flagged as close calls,
    // and how many of those it got right. A system that marks everything
    // ambiguous is not honest, it is useless, so this has to be readable next
    // to accuracy rather than instead of it.
    declaredAmbiguousAmongScoreable: (() => {
      let n = 0, right = 0;
      for (const rel of decl.relationships) {
        if (!rel.belongsTo) continue;
        const d = gtChairToDet.get(rel.chair);
        if (!d || !d.parentId || !(d.relation && d.relation.ambiguous)) continue;
        n++;
        if (tableDetToGt.get(d.parentId) === rel.belongsTo) right++;
      }
      return { count: n, correct: right };
    })(),
    wrongExamples,
  };

  // Zones. A detected zone's membership is expressed in candidate ids, so it
  // is translated back to ground-truth ids before comparison; a zone made
  // entirely of false positives therefore matches nothing, which is right.
  const candToGt = new Map(tm.matches.map(m => [m.det.id, m.gt.id]));
  const detectedZones = (det.zones || []).map(z => ({
    ...z, gtMembers: z.memberIds.map(id => candToGt.get(id)).filter(Boolean),
  }));
  const typed = detectedZones.filter(z => z.type !== "unknown");
  const expected = decl.expectedZones || [];
  const usedExpected = new Set();
  let zoneMatched = 0;
  for (const z of typed) {
    const hit = expected.find((e, i) => !usedExpected.has(i) && e.type === z.type && jaccard(e.memberIds, z.gtMembers) >= 0.5);
    if (hit) { usedExpected.add(expected.indexOf(hit)); zoneMatched++; }
  }
  const forbiddenTypes = new Set(decl.forbiddenZoneTypes || []);
  const invented = detectedZones.filter(z => forbiddenTypes.has(z.type));
  const zones = {
    expected: expected.length,
    detected: detectedZones.length,
    detectedTyped: typed.length,
    unknownZones: detectedZones.length - typed.length,
    matched: zoneMatched,
    precision: typed.length ? +(zoneMatched / typed.length).toFixed(3) : null,
    recall: expected.length ? +(zoneMatched / expected.length).toFixed(3) : null,
    falseZoneInventions: invented.length,
    inventedTypes: [...new Set(invented.map(z => z.type))],
    byType: detectedZones.reduce((m, z) => (m[z.type] = (m[z.type] || 0) + 1, m), {}),
  };

  // Facts.
  const factById = new Map((det.facts || []).map(f => [f.id, f]));
  const expectedFacts = decl.expectedFacts || [], forbiddenFacts = decl.forbiddenFacts || [];
  const expectedMissing = expectedFacts.filter(id => !factById.has(id));
  const forbiddenPresent = forbiddenFacts.filter(id => factById.has(id))
    .map(id => ({ id, strength: factById.get(id).strength, params: factById.get(id).params }));
  const facts = {
    total: (det.facts || []).length,
    expected: expectedFacts.length,
    expectedPresent: expectedFacts.length - expectedMissing.length,
    expectedMissing,
    forbidden: forbiddenFacts.length,
    forbiddenPresent,
    // The protected invariant. A forbidden claim stated as STRONG is the
    // worst output this product can produce: confidently wrong.
    fabricatedStrong: forbiddenPresent.filter(f => f.strength === "strong").length,
    withoutProvenance: (det.facts || []).filter(f => !f.provenance).map(f => f.id),
    byStrength: (det.facts || []).reduce((m, f) => (m[f.strength] = (m[f.strength] || 0) + 1, m), {}),
  };

  // Detections landing where nothing real is.
  const inRegion = (c, r) => c.cx >= r.x && c.cx <= r.x + r.w && c.cy >= r.y && c.cy <= r.y + r.h;
  const textRegions = (decl.regions || []).filter(r => r.class === "text");
  const archRegions = (decl.regions || []).filter(r => r.class === "architecture" && r.w * r.h < W * H * 0.5);
  const regionFP = {
    textRegions: textRegions.length,
    tablesInText: alive.filter(c => c.kind === "table" && textRegions.some(r => inRegion(c, r))).length,
    architectureRegions: archRegions.length,
    tablesInArchitecture: alive.filter(c => c.kind === "table" && archRegions.some(r => inRegion(c, r))).length,
  };

  const minTypes = decl.minTableTypes;
  return {
    planId: decl.planId, realVenue: false, hypothesis: decl.hypothesis,
    tables: { groundTruth: gtTables.length, detected: detTables.length, ...tables,
      heldBack: heldBack.length, heldBackReasons,
      missedIds: tm.missed.slice(0, 20).map(g => g.id) },
    tableTypes: { byType: typeStats, distinctFound: distinctTypesFound,
      required: minTypes ?? null, meetsRequirement: minTypes == null ? null : distinctTypesFound >= minTypes },
    chairs: { groundTruth: gtChairs.length, detected: detChairs.length, ...chairs },
    relations, zones, facts, regionFP,
    sceneGraph: det.sceneGraph,
    contradictions: (det.contradictions || []).length,
    contradictionIds: [...new Set((det.contradictions || []).map(c => c.id))],
    effort: { reviewGroups: det.reviewGroups, uncertainQuestions: det.uncertainQuestions,
      reviewPriorities: det.reviewPriorities },
  };
}

// A fixture's verdict, from its own declared expectations only. Nothing here
// knows which fixture it is looking at, and no threshold below may be relaxed
// to make a particular one pass.
//
// FAIL is reserved for outputs that are actively wrong: a confident claim that
// is forbidden, a room that does not exist, or a real object the pipeline found
// and then threw away. PARTIAL is for missing or degraded results, which are
// honest failures of recall rather than false statements.
function verdict(r) {
  const fail = [], partial = [];
  const gtTables = r.tables.groundTruth, gtChairs = r.chairs.groundTruth;
  if (r.facts.fabricatedStrong > 0) fail.push(`${r.facts.fabricatedStrong} forbidden fact(s) stated as STRONG`);
  if (r.zones.falseZoneInventions > 0) fail.push(`${r.zones.falseZoneInventions} invented zone(s): ${r.zones.inventedTypes.join(", ")}`);
  if (r.tables.heldBack > 0) fail.push(`${r.tables.heldBack} real table(s) detected then held back (${Object.entries(r.tables.heldBackReasons).map(([k, v]) => `${k} x${v}`).join(", ")})`);
  // Precision is a FAIL, not a nuance: a phantom table goes onto the floor
  // plan and into the capacity total. A fixture with no furniture at all is
  // the strictest case — any table there is invented by definition.
  if (gtTables === 0 && r.tables.detected > 0)
    fail.push(`${r.tables.detected} table(s) proposed on a drawing with no furniture`);
  else if (gtTables > 0 && r.tables.fp > gtTables)
    fail.push(`more phantom tables than real ones: ${r.tables.fp} FP against ${gtTables} GT (precision ${r.tables.precision})`);
  if (gtChairs === 0 && r.chairs.detected > 0)
    fail.push(`${r.chairs.detected} chair(s) proposed on a drawing with no furniture`);

  if (r.facts.forbiddenPresent.length > r.facts.fabricatedStrong)
    partial.push(`${r.facts.forbiddenPresent.length - r.facts.fabricatedStrong} forbidden fact(s) below STRONG`);
  if (r.facts.expectedMissing.length) partial.push(`missing expected fact(s): ${r.facts.expectedMissing.join(", ")}`);
  if (r.tableTypes.meetsRequirement === false)
    partial.push(`${r.tableTypes.distinctFound} table type(s) survived, ${r.tableTypes.required} required`);
  for (const [type, v] of Object.entries(r.tableTypes.byType))
    if (v.matched >= 3 && v.accuracy < 0.5) partial.push(`${type} tables typed ${v.correct}/${v.matched}`);
  if (r.relations.wrong > 0) partial.push(`${r.relations.wrong} chair(s) seated at the wrong table`);
  if (r.relations.orphan > 0) partial.push(`${r.relations.orphan} detected chair(s) seated at no table at all`);
  if (r.relations.forcedOnAmbiguous > 0)
    partial.push(`${r.relations.forcedOnAmbiguous} chair(s) silently given a table the drawing leaves ambiguous`);
  // Recall is only meaningful where there was something to recall. On a
  // fixture with no furniture, recall is 0 by arithmetic and means nothing —
  // reporting it as a shortfall would be a scorer bug, not a finding.
  if (gtTables > 0 && r.tables.recall < 0.9) partial.push(`table recall ${r.tables.recall}`);
  if (gtChairs > 0 && r.chairs.recall < 0.9) partial.push(`chair recall ${r.chairs.recall}`);
  if (gtTables > 0 && r.tables.fp > 0 && r.tables.fp <= gtTables)
    partial.push(`${r.tables.fp} phantom table(s) (precision ${r.tables.precision})`);
  if (r.zones.expected > 0 && r.zones.precision !== null && r.zones.precision < 0.5)
    partial.push(`zone precision ${r.zones.precision} — ${r.zones.detectedTyped} typed zones for ${r.zones.expected} real ones`);
  return { status: fail.length ? "FAIL" : partial.length ? "PARTIAL" : "PASS", fail, partial };
}

// ---- main ------------------------------------------------------------------
if (has("--freeze")) { freeze(); process.exit(0); }

const app = await serveApp();
const browser = await launchChromium();
const results = [], refusals = [];

for (const file of declFiles()) {
  const declBytes = fs.readFileSync(path.join(DECL_DIR, file));
  const decl = JSON.parse(declBytes);
  if (FILTER && !decl.planId.includes(FILTER)) continue;
  const img = path.join(BENCH, decl.source.file);
  if (!fs.existsSync(img)) { refusals.push({ planId: decl.planId, why: `image missing at ${img}` }); continue; }
  const frozenCheck = checkFrozen(decl, declBytes, fs.readFileSync(img));
  if (!frozenCheck.ok) {
    refusals.push({ planId: decl.planId, why: frozenCheck.why });
    console.error(`REFUSED ${decl.planId}: ${frozenCheck.why}`);
    continue;
  }

  // The large fixture is allowed longer, because measuring what it costs is
  // the point of it; a timeout is recorded as a result, not swallowed.
  const budget = decl.objects.length > 1000 ? 900000 : 240000;
  process.stdout.write(`\n=== ${decl.planId} ===\n`);
  const { out, ms, errors, timedOut } = await detect(browser, img, app.baseUrl, budget);
  if (!out) {
    results.push({ planId: decl.planId, error: "detection produced no analysis", detectionMs: ms, timedOut });
    console.error(`  no analysis after ${ms} ms${timedOut ? " (timed out)" : ""}`);
    continue;
  }
  const r = evaluate(decl, out);
  r.detectionMs = ms; r.timedOut = timedOut; r.pageErrors = errors;
  r.verdict = verdict(r);
  results.push(r);

  const t = r.tables, c = r.chairs;
  console.log(`  ${r.verdict.status}`);
  console.log(`  TABLES   gt=${t.groundTruth} det=${t.detected} TP=${t.tp} FP=${t.fp} FN=${t.fn} P=${t.precision} R=${t.recall} F1=${t.f1}  heldBack=${t.heldBack}`);
  if (t.heldBack) console.log(`           held back: ${Object.entries(t.heldBackReasons).map(([k, v]) => `${k} x${v}`).join(", ")}`);
  console.log(`  TYPES    ${Object.entries(r.tableTypes.byType).map(([k, v]) => `${k} ${v.correct}/${v.matched}`).join("  ") || "(none)"}` +
    (r.tableTypes.required ? `   distinct=${r.tableTypes.distinctFound}/${r.tableTypes.required}` : ""));
  console.log(`  CHAIRS   gt=${c.groundTruth} det=${c.detected} TP=${c.tp} FP=${c.fp} FN=${c.fn} P=${c.precision} R=${c.recall} F1=${c.f1}`);
  const rel = r.relations;
  console.log(`  RELATION scoreable=${rel.groundTruthScoreable} scored=${rel.scored} correct=${rel.correct} wrong=${rel.wrong} orphan=${rel.orphan} acc=${rel.accuracy} coverage=${rel.coverage}`);
  if (rel.groundTruthAmbiguous)
    console.log(`           ambiguous by construction: ${rel.groundTruthAmbiguous}, of which ${rel.forcedOnAmbiguous} were given a table anyway`);
  console.log(`  ZONES    detected=${r.zones.detected} (${Object.entries(r.zones.byType).map(([k, v]) => `${k}x${v}`).join(" ") || "none"}) matched=${r.zones.matched}/${r.zones.expected} P=${r.zones.precision} R=${r.zones.recall} invented=${r.zones.falseZoneInventions}`);
  console.log(`  FACTS    ${r.facts.total} total (${Object.entries(r.facts.byStrength).map(([k, v]) => `${k} ${v}`).join(", ")})  expected ${r.facts.expectedPresent}/${r.facts.expected}  forbidden present ${r.facts.forbiddenPresent.length}  FABRICATED STRONG ${r.facts.fabricatedStrong}`);
  if (r.facts.expectedMissing.length) console.log(`           missing: ${r.facts.expectedMissing.join(", ")}`);
  if (r.facts.forbiddenPresent.length) console.log(`           forbidden: ${r.facts.forbiddenPresent.map(f => `${f.id}(${f.strength})`).join(", ")}`);
  console.log(`  REGIONS  tables in text ${r.regionFP.tablesInText}/${r.regionFP.textRegions}  in architecture ${r.regionFP.tablesInArchitecture}/${r.regionFP.architectureRegions}`);
  console.log(`  GRAPH    ${r.sceneGraph ? `${r.sceneGraph.nodeCount} nodes, ${r.sceneGraph.edges} edges ${JSON.stringify(r.sceneGraph.counts)}` : "none"}`);
  console.log(`  EFFORT   groups=${r.effort.reviewGroups} questions=${r.effort.uncertainQuestions} queue=${r.effort.reviewPriorities}  contradictions=${r.contradictions} ${r.contradictionIds.join(",")}`);
  console.log(`  TIME     ${ms} ms${timedOut ? "  TIMED OUT" : ""}  pageErrors=${errors.length}`);
  for (const f of r.verdict.fail) console.log(`  FAIL     ${f}`);
  for (const p of r.verdict.partial) console.log(`  PARTIAL  ${p}`);
}

await browser.close();
await app.close?.();

const payload = {
  ranAt: new Date().toISOString(),
  realVenue: false,
  note: "SYNTHETIC ADVERSARIAL FIXTURES — NOT REAL VENUES. These scores are never mixed into real-plan aggregates. " +
    "REAL DISTINCT VENUE PLANS: 1. CROSS-VENUE GENERALIZATION: NOT VERIFIED.",
  refusals, results,
};
fs.writeFileSync(LATEST, JSON.stringify(payload, null, 2) + "\n");

if (has("--record-baseline")) {
  fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nrecorded adversarial baseline -> ${path.relative(process.cwd(), BASELINE)}`);
}

if (has("--compare") && fs.existsSync(BASELINE)) {
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const byId = new Map(base.results.map(r => [r.planId, r]));
  console.log("\n=== against the frozen adversarial baseline ===");
  // Every guarded field compared separately, because a trade (relations up,
  // table recall down) is invisible in one score and is a revert, not a win.
  const fields = [
    ["tables.f1", r => r.tables?.f1], ["tables.recall", r => r.tables?.recall],
    ["tables.heldBack", r => r.tables?.heldBack, "lower"],
    ["chairs.f1", r => r.chairs?.f1],
    ["relations.accuracy", r => r.relations?.accuracy], ["relations.coverage", r => r.relations?.coverage],
    ["relations.forcedOnAmbiguous", r => r.relations?.forcedOnAmbiguous, "lower"],
    ["zones.precision", r => r.zones?.precision], ["zones.recall", r => r.zones?.recall],
    ["zones.falseZoneInventions", r => r.zones?.falseZoneInventions, "lower"],
    ["facts.fabricatedStrong", r => r.facts?.fabricatedStrong, "lower"],
    ["facts.expectedPresent", r => r.facts?.expectedPresent],
  ];
  let regressions = 0, improvements = 0;
  for (const r of results) {
    const b = byId.get(r.planId);
    if (!b) { console.log(`  ${r.planId}: new fixture, no baseline`); continue; }
    for (const [name, get, dir] of fields) {
      const now = get(r), was = get(b);
      if (now == null || was == null || now === was) continue;
      const better = dir === "lower" ? now < was : now > was;
      console.log(`  ${better ? "IMPROVED " : "REGRESSED"} ${r.planId} ${name}: ${was} -> ${now}`);
      better ? improvements++ : regressions++;
    }
  }
  console.log(`\n${regressions} regression(s), ${improvements} improvement(s)`);
  if (regressions) process.exitCode = 1;
}

const counts = results.reduce((m, r) => (m[r.verdict?.status || "ERROR"] = (m[r.verdict?.status || "ERROR"] || 0) + 1, m), {});
console.log(`\n${results.length} fixture(s): ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}` +
  (refusals.length ? `, ${refusals.length} REFUSED` : ""));
console.log("SYNTHETIC ADVERSARIAL FIXTURES — NOT REAL VENUES. REAL DISTINCT VENUE PLANS: 1.");
