// Scoring for the plan-understanding contract (CONTRACT.md).
//
// Pure functions: an analysis as the app stored it, the base annotation and the
// understanding truth file go in; numbers come out. Nothing here runs the app,
// so the same scorer reads a live run, a stored baseline or a replay.
//
// Two readings of every detection, because they are different products:
//   auto     — what the operator gets by confirming the result as offered
//              (candidates the app pre-selected). This is the one the 9/10
//              thresholds are written against.
//   proposed — everything shown for review (not rejected), including what the
//              app held back. Reported, never used to pass a gate: a real
//              object held back still has to be found and switched on by hand.

export const CLASSES = ["table", "bistro", "chair", "sofa", "stage", "column", "bar", "entrance", "loca"];

const VENUE_CLASS = {
  sofa: ["sofa", "banquette", "bench"],
  stage: ["stage"],
  column: ["column"],
  bar: ["bar"],
  entrance: ["entrance", "exit"],
  loca: ["loca", "box", "lodge"],
};

// Two conventions live side by side in a stored analysis, and reading one as
// the other moved every chair by half its own size: a CANDIDATE's x/y is its
// top-left corner, a chair detection's x/y is its CENTRE (the review layer
// draws it with translate(-50%,-50%), and the commit path keeps it as a centre
// in table-local percent). run-benchmark.mjs read chairs as top-left until
// 2026-10-04; a 3%-of-diagonal match tolerance hid the 24 px it added.
export function toPixels(c, W, H) {
  return {
    ...c,
    cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H,
    pw: c.w / 100 * W, ph: c.h / 100 * H,
  };
}
export function chairToPixels(ch, W, H) {
  return { ...ch, cx: ch.x / 100 * W, cy: ch.y / 100 * H, pw: ch.w / 100 * W, ph: ch.h / 100 * H };
}

function prf(tp, fp, fn, gt, det) {
  const precision = tp + fp ? tp / (tp + fp) : (gt === 0 ? 1 : 0);
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const countError = gt ? Math.abs(det - gt) / gt : (det ? Infinity : 0);
  return { gt, det, tp, fp, fn,
    precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3),
    countError: Number.isFinite(countError) ? +countError.toFixed(3) : null };
}

// Greedy nearest-first, the same rule run-benchmark.mjs uses, so a table that
// is a TP there is a TP here.
export function matchByDistance(gt, det, tol) {
  const pairs = [];
  gt.forEach((g, gi) => det.forEach((d, di) => {
    const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy);
    if (dist <= tol) pairs.push({ gi, di, dist });
  }));
  pairs.sort((a, b) => a.dist - b.dist);
  const gu = new Set(), du = new Set(), matches = [];
  for (const p of pairs) {
    if (gu.has(p.gi) || du.has(p.di)) continue;
    gu.add(p.gi); du.add(p.di);
    matches.push({ gt: gt[p.gi], det: det[p.di], dist: p.dist });
  }
  return { matches, missed: gt.filter((_, i) => !gu.has(i)), spurious: det.filter((_, i) => !du.has(i)) };
}

// Venue elements are large and their "centre" is a matter of drawing style
// (a stage with its truss, a bar with its back shelves), so a detection
// matches an element when either centre falls inside the other's box, grown
// by 10% or 10 px. One-to-one; a second stage on the same stage is a FP.
function inside(p, b, grow) {
  const gx = Math.max(10, b.w * grow), gy = Math.max(10, b.h * grow);
  return Math.abs(p.cx - b.cx) <= b.w / 2 + gx && Math.abs(p.cy - b.cy) <= b.h / 2 + gy;
}
export function matchElements(gt, det) {
  const pairs = [];
  gt.forEach((g, gi) => det.forEach((d, di) => {
    const db = { cx: d.cx, cy: d.cy, w: d.pw, h: d.ph };
    if (inside(d, g, 0.1) || inside(g, db, 0.1)) pairs.push({ gi, di, dist: Math.hypot(g.cx - d.cx, g.cy - d.cy) });
  }));
  pairs.sort((a, b) => a.dist - b.dist);
  const gu = new Set(), du = new Set(), matches = [];
  for (const p of pairs) {
    if (gu.has(p.gi) || du.has(p.di)) continue;
    gu.add(p.gi); du.add(p.di);
    matches.push({ gt: gt[p.gi], det: det[p.di], dist: p.dist });
  }
  return { matches, missed: gt.filter((_, i) => !gu.has(i)), spurious: det.filter((_, i) => !du.has(i)) };
}

export function iou(a, b) {
  const ax0 = a.cx - a.w / 2, ax1 = a.cx + a.w / 2, ay0 = a.cy - a.h / 2, ay1 = a.cy + a.h / 2;
  const bx0 = b.cx - b.w / 2, bx1 = b.cx + b.w / 2, by0 = b.cy - b.h / 2, by1 = b.cy + b.h / 2;
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = ix * iy, uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r3 = v => v == null ? null : +v.toFixed(3);
const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d); };

function inRect(p, r) { return p.cx >= r.x && p.cx <= r.x + r.w && p.cy >= r.y && p.cy <= r.y + r.h; }

// ---------------------------------------------------------------------------
// The committed digital plan, mapped back onto the drawing AS THE CANVAS DRAWS
// IT: the reference layer fills the world box with `background-size: <scale>%
// auto; background-position: center` — the image `scale`% of the world's
// width, its own aspect, centred. A committed object is in the right place
// exactly when it lands on the drawing in that frame. (The first version of
// this scorer assumed top-left anchoring and mis-scored ORNEK; a rendered
// screenshot caught it.)
function scoreDigital(digital, annotation, tol) {
  if (!digital) return null;
  const nw = digital.background.naturalWidth, nh = digital.background.naturalHeight;
  const bw = digital.world.width * digital.background.scalePct / 100, bh = bw * nh / nw;
  const ox = (digital.world.width - bw) / 2, oy = (digital.world.height - bh) / 2;
  const sx = nw / bw, sy = nh / bh;
  // A committed table is a footprint box; where the drawing's table SURFACE
  // is, is `surface` (percent of the footprint) when the product kept it, and
  // the whole footprint when it did not — so a product that stores no surface
  // is scored on the box it does store.
  const tables = digital.tables.map(t => {
    const s = t.surface || { x: 0, y: 0, w: 100, h: 100 };
    const bx = t.x + s.x / 100 * t.w, by = t.y + s.y / 100 * t.h, bw2 = s.w / 100 * t.w, bh2 = s.h / 100 * t.h;
    return { ...t, cx: (bx + bw2 / 2 - ox) * sx, cy: (by + bh2 / 2 - oy) * sy, pw: bw2 * sx, ph: bh2 * sy };
  });
  const gtTables = annotation.objects.filter(o => o.class === "table");
  const tm = matchByDistance(gtTables, tables, tol);
  const centre = tm.matches.map(m => m.dist / Math.min(m.gt.w, m.gt.h));
  const aspect = tm.matches.map(m => Math.abs(Math.log((m.det.pw / m.det.ph) / (m.gt.w / m.gt.h))));
  const size = tm.matches.map(m => Math.max(Math.abs(m.det.pw - m.gt.w) / m.gt.w, Math.abs(m.det.ph - m.gt.h) / m.gt.h));
  // A committed chair is stored relative to its table: centre in percent of
  // the table's own width and height from its top-left corner.
  const chairs = tables.flatMap(t => (t.chairs || []).map(c => ({
    cx: (t.x + c.x / 100 * t.w - ox) * sx, cy: (t.y + c.y / 100 * t.h - oy) * sy })));
  const gtChairs = annotation.objects.filter(o => o.class === "chair");
  const cm = matchByDistance(gtChairs, chairs, tol);
  const chairCentre = cm.matches.map(m => m.dist / Math.min(m.gt.w, m.gt.h));
  return {
    committedTables: tables.length, matchedTables: tm.matches.length, missedTables: tm.missed.length, extraTables: tm.spurious.length,
    tableCentreErrorP90Share: r3(pct(centre, 0.9)), tableAspectLogErrorP90: r3(pct(aspect, 0.9)), tableSizeErrorP90: r3(pct(size, 0.9)),
    committedChairs: chairs.length, matchedChairs: cm.matches.length,
    chairCentreErrorP90Share: gtChairs.length ? r3(pct(chairCentre, 0.9)) : null,
    venueObjects: digital.venueObjects.length,
    frame: { worldWidth: digital.world.width, worldHeight: +digital.world.height.toFixed(1), imageDrawnWidth: +bw.toFixed(1), imageDrawnHeight: +bh.toFixed(1), offsetY: +oy.toFixed(1) },
  };
}

export function score({ analysis, annotation, truth, run = {}, digital = null }) {
  const W = annotation.source.width, H = annotation.source.height;
  const diag = Math.hypot(W, H);
  const tol = (annotation.matchToleranceP ?? 3) / 100 * diag;
  const all = (analysis.candidates || []).map(c => toPixels(c, W, H));
  const views = {
    auto: all.filter(c => c.status !== "rejected" && c.selected === true),
    proposed: all.filter(c => c.status !== "rejected"),
  };
  const gtTables = annotation.objects.filter(o => o.class === "table");
  const gtChairs = annotation.objects.filter(o => o.class === "chair");
  const elements = truth.elements || [];
  const excluded = truth.excluded || [];
  const out = { planId: truth.planId, classes: {}, proposed: {} };

  for (const [view, cands] of Object.entries(views)) {
    const target = view === "auto" ? out.classes : out.proposed;
    const detTables = cands.filter(c => c.kind === "table");
    const tm = matchByDistance(gtTables, detTables, tol);
    target.table = { ...prf(tm.matches.length, tm.spurious.length, tm.missed.length, gtTables.length, detTables.length) };
    // Bistro is a TYPE of table: a bistro found but typed square is a miss
    // here and a TP in "table" — both are true.
    const gtB = gtTables.filter(t => t.type === "bistro");
    const detB = detTables.filter(t => t.type === "bistro");
    const bm = matchByDistance(gtB, detB, tol);
    target.bistro = prf(bm.matches.length, bm.spurious.length, bm.missed.length, gtB.length, detB.length);
    // Chairs: those seated at an offered table plus offered standalone chairs.
    const detChairs = [
      ...detTables.flatMap(t => (t.chairDetections || []).map(ch => ({ ...chairToPixels(ch, W, H), parentId: t.id }))),
      ...cands.filter(c => c.kind !== "table" && /chair|armchair/.test(c.type || "")).map(c => ({ ...c, parentId: null })),
    ];
    const cm = matchByDistance(gtChairs, detChairs, tol);
    target.chair = prf(cm.matches.length, cm.spurious.length, cm.missed.length, gtChairs.length, detChairs.length);
    for (const [cls, types] of Object.entries(VENUE_CLASS)) {
      const gt = elements.filter(e => e.class === cls);
      const det = cands.filter(c => c.kind === "venue" && types.includes(c.type))
        .filter(c => !excluded.some(r => inRect(c, r)));
      const em = matchElements(gt, det);
      target[cls] = prf(em.matches.length, em.spurious.length, em.missed.length, gt.length, det.length);
      target[cls].scoredOnThisPlan = gt.length > 0 || det.length > 0;
      if (view === "auto") {
        target[cls].shapeIoU = em.matches.map(m => +iou(m.gt, { cx: m.det.cx, cy: m.det.cy, w: m.det.pw, h: m.det.ph }).toFixed(3));
        target[cls].missed = em.missed.map(g => g.id);
        target[cls].spurious = em.spurious.map(d => ({ type: d.type, cx: Math.round(d.cx), cy: Math.round(d.cy) }));
      }
    }
    if (view !== "auto") continue;

    // ---- geometry: position, size, shape, rotation (matched tables) -------
    const centreErr = tm.matches.map(m => m.dist / Math.min(m.gt.w, m.gt.h));
    const sizeErr = tm.matches.map(m => Math.max(Math.abs(m.det.pw - m.gt.w) / m.gt.w, Math.abs(m.det.ph - m.gt.h) / m.gt.h));
    const ious = tm.matches.map(m => iou(m.gt, { cx: m.det.cx, cy: m.det.cy, w: m.det.pw, h: m.det.ph }));
    const typeOk = tm.matches.filter(m => m.det.type === m.gt.type).length;
    const aspectErr = tm.matches.map(m => Math.abs(Math.log((m.det.pw / m.det.ph) / (m.gt.w / m.gt.h))));
    const rotErr = tm.matches.map(m => {
      const fold = m.gt.type === "round" || m.gt.type === "bistro" ? 0 : (m.gt.type === "square" ? 90 : 180);
      if (!fold) return 0;
      const d = Math.abs((((m.det.rotation || 0) - (m.gt.rotation || 0)) % fold + fold) % fold);
      return Math.min(d, fold - d);
    });
    const chairCentreErr = cm.matches.map(m => m.dist / Math.min(m.gt.w, m.gt.h));
    out.geometry = {
      tableCentreErrorMedianShare: r3(median(centreErr)), tableCentreErrorP90Share: r3(pct(centreErr, 0.9)),
      tableSizeErrorMedian: r3(median(sizeErr)), tableSizeErrorP90: r3(pct(sizeErr, 0.9)),
      tableIoUMedian: r3(median(ious)), tableIoUP10: r3(pct(ious, 0.1)),
      tableTypeAccuracy: tm.matches.length ? r3(typeOk / tm.matches.length) : null,
      tableAspectLogErrorP90: r3(pct(aspectErr, 0.9)),
      tableRotationErrorP90Deg: r3(pct(rotErr, 0.9)),
      chairCentreErrorMedianShare: r3(median(chairCentreErr)), chairCentreErrorP90Share: r3(pct(chairCentreErr, 0.9)),
      note: "centre and size errors are a share of the object's own smaller side, so they mean the same on a 17 px chair and a 70 px table",
    };

    // ---- chair -> table links --------------------------------------------
    const chairDet = new Map(cm.matches.map(m => [m.gt.id, m.det]));
    const tableDetToGt = new Map(tm.matches.map(m => [m.det.id, m.gt.id]));
    let correct = 0, wrong = 0, orphan = 0, unscoreable = 0;
    const wrongLinks = [];
    for (const rel of (annotation.relationships || []).filter(r => r.chair && r.belongsTo)) {
      const d = chairDet.get(rel.chair);
      if (!d) { unscoreable++; continue; }
      if (!d.parentId) { orphan++; continue; }
      const g = tableDetToGt.get(d.parentId);
      if (g === undefined) { unscoreable++; continue; }
      if (g === rel.belongsTo) correct++; else { wrong++; wrongLinks.push({ chair: rel.chair, expected: rel.belongsTo, got: g }); }
    }
    const linkScored = correct + wrong + orphan;
    const linkTotal = (annotation.relationships || []).filter(r => r.chair && r.belongsTo).length;
    out.links = { groundTruth: linkTotal, scored: linkScored, correct, wrong, orphan, unscoreable,
      accuracy: linkScored ? r3(correct / linkScored) : null,
      endToEnd: linkTotal ? r3(correct / linkTotal) : null,
      wrongLinks,
      note: "endToEnd = correct links / all annotated links: a chair never found counts against it, which accuracy alone hides" };

    // ---- joined groups ----------------------------------------------------
    const gtGroups = (truth.joinedGroups && truth.joinedGroups.groups) || [];
    const detGroups = (analysis.planIntelligence && analysis.planIntelligence.furnitureGroups || [])
      .map(g => ({ id: g.id, gtMembers: (g.memberIds || []).map(id => tableDetToGt.get(id)).filter(Boolean), raw: g.memberIds || [] }))
      .filter(g => g.raw.length >= 2);
    const key = a => [...a].sort().join(",");
    const detKeys = new Map(detGroups.map(g => [key(g.gtMembers), g]));
    const groupRows = gtGroups.map(g => {
      const exact = detKeys.get(key(g.tables));
      let chairCountDet = null;
      if (exact) {
        chairCountDet = exact.raw.reduce((n, id) => n + ((all.find(c => c.id === id) || {}).chairDetections || []).length, 0);
      }
      const touching = detGroups.filter(dg => dg.gtMembers.some(m => g.tables.includes(m)));
      const verdict = exact ? "EXACT" : touching.length === 0 ? "NOT_GROUPED" : touching.some(dg => dg.gtMembers.some(m => !g.tables.includes(m))) ? "OVER_MERGED" : "SPLIT";
      return { id: g.id, tables: g.tables.length, verdict, chairsTruth: g.chairCount, chairsDetected: chairCountDet };
    });
    const gtKeys = new Set(gtGroups.map(g => key(g.tables)));
    const spuriousGroups = detGroups.filter(dg => !gtKeys.has(key(dg.gtMembers))
      && !gtGroups.some(g => dg.gtMembers.every(m => g.tables.includes(m)) && dg.gtMembers.length)).length;
    const exactN = groupRows.filter(r => r.verdict === "EXACT").length;
    out.groups = { groundTruth: gtGroups.length, exact: exactN,
      accuracy: gtGroups.length ? r3(exactN / gtGroups.length) : null,
      chairCountExact: groupRows.filter(r => r.verdict === "EXACT" && r.chairsDetected === r.chairsTruth).length,
      spuriousGroups, rows: groupRows };

    // ---- observable direction --------------------------------------------
    const facingGt = truth.chairFacing || [];
    let stated = 0, right = 0, wrongDir = 0;
    const errs = [];
    for (const f of facingGt) {
      const d = chairDet.get(f.chair);
      if (!d) continue;
      const o = d.relation && d.relation.orientation;
      if (!o || !o.facingKnown || o.facingAngle == null) continue;
      stated++;
      const e = angDiff(o.facingAngle, f.facingDeg);
      errs.push(e);
      if (e <= 30) right++; else if (e > 45) wrongDir++;
    }
    out.direction = { groundTruth: facingGt.length, stated, correctWithin30: right, wrongOver45: wrongDir,
      coverage: facingGt.length ? r3(right / facingGt.length) : null,
      precision: stated ? r3(right / stated) : null,
      errorP90Deg: r3(pct(errs, 0.9)),
      note: "coverage = chairs whose facing is stated AND within 30 degrees, over every chair whose facing the drawing shows; a facing left unstated is honest but still a gap" };

    // ---- printed numbers and printed capacity -----------------------------
    const numbered = tm.matches.filter(m => m.gt.numberLegible && Number.isFinite(m.gt.number));
    const legible = gtTables.filter(t => t.numberLegible && Number.isFinite(t.number)).length;
    let vRight = 0, vWrong = 0, anyRead = 0;
    for (const m of numbered) {
      const p = m.det.printedNumber;
      if (!p) continue;
      anyRead++;
      if (p.state === "VERIFIED") { if (p.value === m.gt.number) vRight++; else vWrong++; }
    }
    const ca = (analysis.planIntelligence && analysis.planIntelligence.capacityAudit) || {};
    const pc = (truth.printed && truth.printed.capacity) || {};
    out.printed = {
      tableNumbers: { legibleInTruth: legible, verifiedCorrect: vRight, verifiedWrong: vWrong, readAtAll: anyRead,
        recall: legible ? r3(vRight / legible) : null, verifiedPrecision: (vRight + vWrong) ? r3(vRight / (vRight + vWrong)) : null },
      capacityTotal: { truth: pc.total ?? null, read: ca.drawingStated ?? null,
        correct: pc.total != null ? ca.drawingStated === pc.total : null },
      capacityParts: { truth: pc, read: ca.parts || null, rule: ca.rule ? { units: ca.rule.units, perUnit: ca.rule.perUnit, total: ca.rule.total } : null },
    };

    // ---- capacity kept separate --------------------------------------------
    const ct = truth.capacityTruth || {};
    const selectedChairs = detTables.reduce((n, t) => n + (t.chairDetections || []).length, 0)
      + cands.filter(c => c.kind !== "table" && /chair|armchair/.test(c.type || "")).length;
    const physical = ca.physical ? ca.physical.seats : null;
    const heldBackChairs = views.proposed.filter(c => c.kind === "table" && !c.selected)
      .reduce((n, t) => n + (t.chairDetections || []).length, 0);
    out.capacity = {
      drawnChairs: { truth: ct.drawnChairs ?? null, product: physical, offeredAuto: selectedChairs },
      writtenTotal: { truth: ct.writtenTotal ?? null, product: ca.drawingStated ?? null },
      logicalSeats: { product: ca.logical ? ca.logical.seats : null, truthFromRule: ct.logicalSeatsFromRule ?? null },
      unverifiedNamed: (ca.unverified || []).length,
      heldBackChairs,
      heldBackLeak: physical != null && physical > selectedChairs ? physical - selectedChairs : 0,
      note: "heldBackLeak > 0 means the product's drawn-chair figure counts chairs on tables it did not offer",
    };

    // ---- operator corrections needed -------------------------------------
    // Lower bound, one action per object, from the offered result to the
    // truth. A batch action could fix several at once; this does not assume
    // one exists.
    const c = out.classes;
    const elementFix = ["sofa", "stage", "column", "bar", "entrance", "loca"].reduce((n, k) => n + c[k].fp + c[k].fn, 0);
    const typeFix = tm.matches.length - typeOk;
    const groupFix = groupRows.filter(r => r.verdict !== "EXACT").length;
    out.corrections = {
      tables: c.table.fp + c.table.fn, chairs: c.chair.fp + c.chair.fn, tableTypes: typeFix,
      links: wrong + orphan, groups: groupFix, elements: elementFix,
      total: c.table.fp + c.table.fn + c.chair.fp + c.chair.fn + typeFix + wrong + orphan + groupFix + elementFix,
      objectsInTruth: gtTables.length + gtChairs.length + elements.length,
    };
    out.corrections.perHundredObjects = out.corrections.objectsInTruth ? r3(100 * out.corrections.total / out.corrections.objectsInTruth) : null;
  }

  out.digital = scoreDigital(digital, annotation, tol);
  out.run = {
    analysisMs: run.analysisMs ?? null, peakHeapMB: run.peakHeapMB ?? null,
    offOriginRequests: run.offOriginRequests ?? null, engineFetches: run.engineFetches ?? null,
    planDataEgress: run.planDataEgress ? run.planDataEgress.length : null, planDataEgressDetail: run.planDataEgress || [],
    cloudCostUSD: run.cloudCostUSD ?? 0,
    providers: run.providers || null, ocr: analysis.ocr || null,
  };
  return out;
}
