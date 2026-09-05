// Extend the chair->table ground truth, without touching the object boxes.
//
//   node benchmarks/annotate/derive-relationships.mjs [--write]
//
// The Golden Plan annotates 113 chairs and carries 24 relationships, so
// association was being scored over a fifth of the plan. All 24 are pale
// crescent chairs, whose parent table is known from the way they were
// RECOVERED: build-real-annotation.mjs finds them by angular clustering in the
// annulus just outside each round table's disc, so the table is part of the
// finding rather than an interpretation of it. That is the strongest kind of
// relationship ground truth this plan has, and it only exists for one family.
//
// The other 89 chairs were extracted as free-standing colour components with no
// table in the process at all. Their parent can only be derived from the
// annotated geometry, and this file does that — deliberately as a SEPARATE
// script that rewrites only the `relationships` array, so the frozen object
// boxes every detector number is measured against cannot move.
//
// HOW HONEST IS A DERIVED RELATIONSHIP. Less honest than an annulus one, and
// the annotation says so per relationship via `method`, so the benchmark can
// report them apart. A derived relation is nearest-perimeter over
// human-verified boxes; the detector associates by distance to its own detected
// OBB within a size-derived margin. Those are not the same computation, but
// they are the same idea, so agreement between them is weaker evidence than a
// score alone suggests. What the derived set genuinely catches is a detector
// that seats a chair at a table on the other side of the room, that leaves
// seats orphaned, or that piles a table's whole ring onto its neighbour.
//
// AND IT ABSTAINS. A chair that is nearly equidistant from two tables has no
// derivable answer, and guessing one would manufacture a disagreement the
// annotation cannot adjudicate. Those are recorded as ambiguous with both
// candidates named, and the benchmark does not score them either way.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANNOT = path.join(path.dirname(HERE), "annotations", "merit-real-venue.json");
const WRITE = process.argv.includes("--write");

// A chair is claimed by a table only if it is CLEARLY nearer to that table than
// to any other, and near enough to be seating rather than a passer-by.
const CLEAR_MARGIN = 0.7;      // runner-up must be at least this much further
const REACH_IN_CHAIRS = 1.6;   // and the winner within this many chair-widths

const edgeDistance = (c, t) => {
  const dx = Math.max(Math.abs(c.cx - t.cx) - (c.w + t.w) / 2, 0);
  const dy = Math.max(Math.abs(c.cy - t.cy) - (c.h + t.h) / 2, 0);
  return Math.hypot(dx, dy);
};

const annot = JSON.parse(fs.readFileSync(ANNOT, "utf8"));
const tables = annot.objects.filter(o => o.class === "table");
const chairs = annot.objects.filter(o => o.class === "chair");
if (!tables.length || !chairs.length) { console.error("annotation has no tables or no chairs"); process.exit(2); }

// The relationships already present were established by the recovery method
// itself. They are kept verbatim and simply labelled.
const existing = new Map((annot.relationships || []).map(r => [r.chair, r.belongsTo]));

const out = [];
const stats = { annulus: 0, derived: 0, ambiguous: 0, outOfReach: 0, disagreesWithAnnulus: 0 };
for (const c of chairs) {
  const ranked = tables
    .map(t => ({ t, d: edgeDistance(c, t) }))
    .sort((a, b) => a.d - b.d);
  const best = ranked[0], next = ranked[1];
  const reach = Math.sqrt(c.w * c.h) * REACH_IN_CHAIRS;

  if (existing.has(c.id)) {
    // Recorded as-is. Whether the geometric derivation agrees is reported, not
    // acted on: where the two disagree the annulus answer is the correct one,
    // and a disagreement is a useful signal about how far the derived rule can
    // be trusted on the rest of the plan.
    const agrees = best && best.t.id === existing.get(c.id);
    if (!agrees) stats.disagreesWithAnnulus++;
    out.push({ chair: c.id, belongsTo: existing.get(c.id), method: "annulus",
      evidence: "recovered by angular clustering in the annulus just outside this table's disc, so the table is part of the finding",
      ...(agrees ? {} : { note: "nearest-perimeter derivation would have chosen " + (best ? best.t.id : "nothing") }) });
    stats.annulus++;
    continue;
  }

  if (!best || best.d > reach) {
    out.push({ chair: c.id, belongsTo: null, method: "unassigned",
      evidence: `nearest table ${best ? best.t.id : "n/a"} is ${best ? best.d.toFixed(1) : "-"}px away, beyond ${reach.toFixed(1)}px of seating reach` });
    stats.outOfReach++;
    continue;
  }
  if (next && best.d > next.d * CLEAR_MARGIN) {
    out.push({ chair: c.id, belongsTo: null, method: "ambiguous",
      candidates: [best.t.id, next.t.id],
      evidence: `${best.d.toFixed(1)}px from ${best.t.id} and ${next.d.toFixed(1)}px from ${next.t.id} — the annotation cannot say which`,
    });
    stats.ambiguous++;
    continue;
  }
  out.push({ chair: c.id, belongsTo: best.t.id, method: "derived",
    evidence: `nearest annotated table perimeter at ${best.d.toFixed(1)}px; next is ${next ? next.t.id + " at " + next.d.toFixed(1) + "px" : "none"}`,
  });
  stats.derived++;
}

const scoreable = stats.annulus + stats.derived;
console.log(`chairs                 ${chairs.length}`);
console.log(`  annulus (verified)   ${stats.annulus}`);
console.log(`  derived              ${stats.derived}`);
console.log(`  ambiguous (unscored) ${stats.ambiguous}`);
console.log(`  out of reach         ${stats.outOfReach}`);
console.log(`  SCOREABLE            ${scoreable}  (was ${(annot.relationships || []).length})`);
console.log(`  derivation disagrees with an annulus relationship on ${stats.disagreesWithAnnulus} of ${stats.annulus}`);

const byTable = new Map();
for (const r of out) if (r.belongsTo) byTable.set(r.belongsTo, (byTable.get(r.belongsTo) || 0) + 1);
const seated = [...byTable.entries()].sort((a, b) => b[1] - a[1]);
console.log(`  tables with seats    ${byTable.size} of ${tables.length}; busiest ${seated.slice(0, 5).map(([t, n]) => `${t}:${n}`).join(" ")}`);

if (!WRITE) { console.log("\nDry run. Pass --write to update the annotation's relationships array."); process.exit(0); }
annot.relationships = out;
annot.relationshipMethod =
  "Chair-to-table relationships carry a `method`. `annulus` relationships come from build-real-annotation.mjs, which recovered those chairs by angular clustering just outside their table's disc, so the table is part of the finding. `derived` relationships are nearest-annotated-perimeter over the human-verified boxes, added by derive-relationships.mjs; they are weaker evidence than annulus ones because the detector's associator, while not the same computation, is the same idea. `ambiguous` and `unassigned` entries carry belongsTo:null and are never scored — a chair nearly equidistant from two tables has no derivable answer and guessing one would manufacture a disagreement the annotation cannot adjudicate.";
fs.writeFileSync(ANNOT, JSON.stringify(annot, null, 2) + "\n");
console.log(`\nwrote ${path.relative(process.cwd(), ANNOT)} — objects untouched, relationships replaced`);
