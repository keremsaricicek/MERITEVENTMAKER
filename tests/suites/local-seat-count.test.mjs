// Seat counts from chairs one by one (training/README.md "Seat counts from
// chairs one by one (follow-up 2)"): where a table's chair count is in doubt and
// the pinned local model is measured on `identify` but not on `chairs`, the
// second look asks identify of EACH detected chair of that table; a chair both
// looks call something else becomes ONE suggestion — remove that chair — which a
// person accepts through decideReview (one object, one undo). The model never
// adds a chair and never types a number.
//
// Pure: the planner, the judge, the finding, the accept plan and the decision
// plan, outside the browser. NO MODEL RUNS HERE.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const meta = { name: "local-seat-count", tags: ["intelligence", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  const ctx = vm.createContext({});
  for (const f of ["src/plan-vlm-review.js", "src/plan-local-check.js", "src/review-decisions.js"]) vm.runInContext(fs.readFileSync(path.join(repoRoot, f), "utf8"), ctx);
  const L = ctx.MeritLocalCheck, V = ctx.MeritVlmReview, D = ctx.MeritReviewDecisions;
  const chairs = (n, x0) => Array.from({ length: n }, (_, i) => ({ id: `ch${x0}-${i}`, x: x0 + i * 1.2, y: 30, w: 0.8, h: 0.8 }));
  const table = (id, x, n, over) => ({ id, kind: "table", type: "square", x, y: 31, w: 4, h: 4, status: "unreviewed", selected: true, confidence: 0.9, chairDetections: chairs(n, x), ...over });
  const analysis = { candidates: [table("t1", 10, 4), table("t2", 30, 4), table("t3", 50, 4), table("odd", 70, 5)], planIntelligence: {} };
  const W = 4000, H = 2000;

  // ---- what is asked ---------------------------------------------------------------
  const qs = L.plan(analysis, { checks: ["identify"], width: W, height: H, max: 12 });
  const per = qs.filter((q) => q.reason === "chairOfTable");
  checks.equal(per.map((q) => [q.question, q.focusId, q.chairId, q.detector]), analysis.candidates[3].chairDetections.map((c) => ["identify", "odd", c.id, "chair"]),
    "a table whose chair count is unlike its look-alikes: identify is asked of each of its chairs, and of no other table's");
  const c0 = analysis.candidates[3].chairDetections[0];
  checks.ok(Math.abs(per[0].frame.cx - c0.x / 100 * W) < 0.2 && Math.abs(per[0].frame.cy - c0.y / 100 * H) < 0.2, "each look is centred on that chair, cut by the benchmark's identify rule", per[0].frame);
  checks.equal(L.plan(analysis, { checks: ["identify", "chairs"], width: W, height: H, max: 12 }).filter((q) => q.reason === "chairOfTable").length, 0,
    "a model measured on chairs is asked the chairs question instead");
  const decided = { ...analysis, candidates: analysis.candidates.map((c) => c.id === "odd" ? { ...c, status: "confirmed" } : c) };
  checks.equal(L.plan(decided, { checks: ["identify"], width: W, height: H, max: 12 }).filter((q) => q.reason === "chairOfTable").length, 0,
    "a table a person confirmed is never asked about");

  // ---- what an answer makes ----------------------------------------------------------
  const q = per[0], f = (a) => L.findingFor(q, L.judge(q, a), analysis, "t");
  const extra = f(["nothing", "nothing"]);
  checks.ok(extra && extra.kind === "extraChair" && extra.candidateId === "odd" && extra.chairId === c0.id && extra.state === "open",
    "both looks call the chair something else: one suggestion — remove that chair from its table", extra);
  checks.equal([f(["chair", "chair"]), f(["nothing", "chair"]), f(["sofa", "sofa"]) && f(["sofa", "sofa"]).kind], [null, null, "extraChair"],
    "a chair both looks call a chair, or looks that disagree, make nothing; any other shared word is not a chair");

  // ---- accepting it: one chair, through the review's one writer ---------------------
  const p = V.acceptPlan(extra, analysis, {});
  checks.equal([p.ok, p.action, p.decision && p.decision.kind, p.decision && p.decision.chairId], [true, "decide", "removeChair", c0.id], "Accept is a removeChair decision for that one chair");
  checks.equal(V.acceptPlan(extra, decided, {}).reason, "ALREADY_DECIDED", "not on a table a person confirmed");
  const gone = { ...analysis, candidates: analysis.candidates.map((c) => c.id === "odd" ? { ...c, chairDetections: c.chairDetections.slice(1) } : c) };
  checks.equal(V.acceptPlan(extra, gone, {}).reason, "GONE", "not when that chair is no longer there");
  const dp = D.plan(p.decision, { candidates: analysis.candidates });
  checks.ok(dp.ok && dp.writes.length === 1 && dp.writes[0].id === "odd" && dp.writes[0].set.chairDetections.length === 4 && !dp.writes[0].set.chairDetections.some((c) => c.id === c0.id),
    "the decision removes exactly that chair from the table's own list (undo restores the list)", dp.writes);
  checks.ok(!D.plan({ kind: "removeChair", candidateId: "odd", chairId: "nope" }, { candidates: analysis.candidates }).ok, "an unknown chair is no decision");
}
