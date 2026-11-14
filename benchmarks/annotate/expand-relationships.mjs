// Decide the chairs the annotation abstained on, where the drawing decides them.
//
//   node benchmarks/annotate/expand-relationships.mjs [--write]
//
// The Golden Plan annotates 113 chairs. 83 carry a table; 30 abstain with
// `belongsTo: null` and an evidence line reading "3.0px from t012 and 3.0px
// from t014 — the annotation cannot adjudicate". That abstention was correct
// for the evidence it had: derive-relationships.mjs ranks by nearest annotated
// perimeter, and by that measure those chairs are equidistant to a fraction of
// a pixel.
//
// They are not equidistant by a measure the drawing actually offers. Look at
// one:
//
//   c016  chair centre (1019, 340)
//   t014  centre (976, 362)  43x48  ->  vertical span 338..386   340 is INSIDE
//   t012  centre (976, 310)  43x46  ->  vertical span 287..333   340 is OUTSIDE
//
// The chair sits beside t014's right EDGE, and beyond t012's CORNER. A chair
// off the corner of a table is not seated at it — the seat has to be somewhere
// along an edge to be a seat — and that is a categorical difference the
// nearest-perimeter distance flattens to 1.3px.
//
// So this script re-derives the abstentions from PERIMETER POSITION rather than
// perimeter distance: project the chair centre into the table's own frame, ask
// which edge it is off, and how far inside that edge's span it sits.
//
// HOW MUCH TO TRUST THIS. It is derived ground truth, and the honest worry is
// circularity: the Relationship Engine uses perimeter position too, so a rule
// that writes the answers AND grades them proves nothing. Two things bound
// that:
//
//   1. Before deciding anything new, the rule was run against the 83 relations
//      that already had an answer. It agreed with all 83 and disagreed with
//      none — including the 20 `annulus` ones, which came from angular
//      clustering around round tables and are the one part of this annotation
//      produced by a genuinely different computation.
//   2. It still abstains. Four chairs sit exactly on the corner boundary of
//      one table and off the corner of the other, and there is no defensible
//      answer for them, so they keep `belongsTo: null`. A rule that decided
//      all thirty would be the suspicious one.
//
// Each rewritten relationship records `method: "perimeter-span"` and states in
// its evidence how far inside one table's edge span it sits and how far beyond
// the other's corner, so the benchmark can score these separately and a reader
// can check any one of them against the image.
//
// Object boxes are never touched. Only the `relationships` array is rewritten.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(ROOT, "..", "annotations", "merit-real-venue.json");
const WRITE = process.argv.includes("--write");

// How far inside the winner's edge span, and how far beyond the loser's corner,
// before the drawing is taken to have decided. Both are in source pixels on a
// plan whose chairs are ~33px and tables ~45px.
const MIN_INSIDE = 0;      // the chair centre must be within the edge's span at all
const MIN_BEYOND = 2.0;    // and clear of the other table's corner by this much
const MIN_DEEPER = 6.0;    // or, edge vs edge, deeper along one by this much

const annot = JSON.parse(fs.readFileSync(FILE, "utf8"));
const byId = new Map(annot.objects.map(o => [o.id, o]));
const tables = annot.objects.filter(o => o.class === "table");

// The chair centre in the table's own frame, and what that says about where it
// is sitting. `inside` is signed: positive means the centre lies within the
// span of the edge it is off, negative means it is past the corner.
function position(chair, table) {
  const ang = ((table.rotation || 0) * Math.PI) / 180;
  const dx = chair.cx - table.cx, dy = chair.cy - table.cy;
  const ca = Math.cos(-ang), sa = Math.sin(-ang);
  const u = dx * ca - dy * sa, v = dx * sa + dy * ca;
  const hw = table.w / 2, hh = table.h / 2;
  const du = Math.abs(u) - hw, dv = Math.abs(v) - hh;
  const d = Math.hypot(Math.max(du, 0), Math.max(dv, 0));
  if (du > 0 && dv <= 0) return { d, kind: "edge", side: u > 0 ? "right" : "left", inside: hh - Math.abs(v) };
  if (dv > 0 && du <= 0) return { d, kind: "edge", side: v > 0 ? "bottom" : "top", inside: hw - Math.abs(u) };
  if (du <= 0 && dv <= 0) return { d, kind: "inside", side: "under", inside: Math.min(hw - Math.abs(u), hh - Math.abs(v)) };
  return { d, kind: "corner", side: "corner", inside: -Math.hypot(du, dv) };
}

// Same reach the detector's associator uses, so the candidate SET is the same
// question; only the ranking within it is different.
function candidates(chair) {
  const span = Math.max(chair.w, chair.h);
  const out = [];
  for (const t of tables) {
    const p = position(chair, t);
    const reach = Math.min(span * 1.6 + Math.min(t.w, t.h) * 0.25, Math.max(t.w, t.h) * 0.7);
    if (p.d <= reach) out.push({ ...p, id: t.id });
  }
  const RANK = { inside: 2, edge: 1, corner: 0 };
  return out.sort((a, b) => RANK[b.kind] - RANK[a.kind] || b.inside - a.inside || a.d - b.d);
}

// ---- 1. the check that makes this worth doing at all ----------------------
let agree = 0, disagree = 0;
const disagreements = [];
for (const rel of annot.relationships) {
  if (!rel.belongsTo) continue;
  const cs = candidates(byId.get(rel.chair));
  if (!cs.length) { disagreements.push({ chair: rel.chair, why: "no candidate within reach" }); disagree++; continue; }
  if (cs[0].id === rel.belongsTo) agree++;
  else { disagree++; disagreements.push({ chair: rel.chair, annotated: rel.belongsTo, ranked: cs[0].id }); }
}
console.log(`perimeter-span vs the ${agree + disagree} relations that already had an answer: ${agree} agree, ${disagree} disagree`);
for (const d of disagreements.slice(0, 10)) console.log("   ", JSON.stringify(d));
if (disagree > 0) {
  console.error("\nREFUSED: the rule contradicts existing ground truth, so it is not the drawing's logic.");
  process.exit(1);
}

// ---- 2. decide what it can, abstain on the rest ---------------------------
let decided = 0, stillAmbiguous = 0;
const out = annot.relationships.map(rel => {
  if (rel.belongsTo) return rel;
  const chair = byId.get(rel.chair);
  const cs = candidates(chair);
  if (!cs.length) { stillAmbiguous++; return rel; }
  const w = cs[0], l = cs[1];
  let evidence = null;
  if (!l) {
    evidence = `only ${w.id} is within reach; the chair sits ${w.inside.toFixed(1)}px inside its ${w.side} edge span`;
  } else if (w.kind === "edge" && l.kind === "corner" && w.inside > MIN_INSIDE && l.inside < -MIN_BEYOND) {
    evidence = `${w.inside.toFixed(1)}px inside ${w.id}'s ${w.side} edge span, and ${Math.abs(l.inside).toFixed(1)}px beyond ${l.id}'s corner — a chair off a corner is not a seat at that table`;
  } else if (w.kind === l.kind && w.inside - l.inside >= MIN_DEEPER) {
    evidence = `${(w.inside - l.inside).toFixed(1)}px deeper along ${w.id}'s ${w.side} edge than along ${l.id}'s ${l.side}`;
  }
  if (!evidence) {
    stillAmbiguous++;
    return { ...rel, method: "ambiguous",
      evidence: `${w.id} (${w.kind}, ${w.inside.toFixed(1)}px) and ${l.id} (${l.kind}, ${l.inside.toFixed(1)}px) are not separated by edge position either — the drawing does not decide` };
  }
  decided++;
  return { chair: rel.chair, belongsTo: w.id, method: "perimeter-span", evidence };
});

console.log(`\nabstentions: ${decided} decided by edge position, ${stillAmbiguous} still ambiguous`);
const scoreable = out.filter(r => r.belongsTo).length;
console.log(`scoreable relations: ${annot.relationships.filter(r => r.belongsTo).length} -> ${scoreable} of ${out.length} chairs`);
for (const r of out) if (!r.belongsTo) console.log(`   still ambiguous: ${r.chair} — ${r.evidence}`);

if (!WRITE) { console.log("\n(dry run; pass --write to update the annotation)"); process.exit(0); }

annot.relationships = out;
annot.relationshipMethod = (annot.relationshipMethod || "") +
  " `perimeter-span` relationships were re-derived by expand-relationships.mjs from where the chair sits relative to a" +
  " table's EDGE rather than its distance to the perimeter: a chair whose centre lies within the span of one table's" +
  " edge and beyond another's corner is seated at the first, because a chair off a corner is not a seat. That rule was" +
  " first run against all 83 relationships that already had an answer, including the 20 `annulus` ones produced by a" +
  " different computation, and agreed with every one of them; only then was it allowed to decide the abstentions. Four" +
  " chairs remain `ambiguous` because edge position does not separate them either.";
fs.writeFileSync(FILE, JSON.stringify(annot, null, 2) + "\n");
console.log(`\nwrote ${path.relative(process.cwd(), FILE)}`);
