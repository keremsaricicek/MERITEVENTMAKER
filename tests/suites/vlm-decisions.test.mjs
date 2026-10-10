// What Accept may do with a model's finding (src/plan-vlm-review.js
// MeritVlmReview.acceptPlan / candidatesPayload), against the analysis as it is
// and the decisions a person already made. Written against the audit of
// 602ba27 (ACCEPTANCE-602ba27.md B1–B3, C1, E1, D5) and red on that commit:
//   MERIT_VLM_REVIEW_SRC=<file> node tests/run.mjs vlm-decisions
// runs it against any other copy of the module.
//
// What this pins:
//   A PERSON'S DECISION OUTRANKS A SUGGESTION, in app logic, not in the prompt:
//     no seat count over a confirmed object or a count a person typed; no
//     "missing" object where a person rejected one — in this analysis or in the
//     plan memory that survives a re-analysis.
//   HELD BACK IS READ FROM ITS REAL SHAPE: lowEvidence is {reason} or null.
//   SAME PLACE, SAME FAMILY IS A DUPLICATE; NESTED IS NOT: a chair at a table,
//     a table inside a loca are offered; a second table on a table is not.
//   A MISSED CHAIR BELONGS TO ITS TABLE: offered as a chair on the nearest
//     table within reach, and a table a person confirmed is not changed.
//   A TABLE COUNTED BY ITS DRAWN CHAIRS IS NOT GIVEN A NUMBER.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const meta = { name: "vlm-decisions", tags: ["intelligence", "business", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  const file = process.env.MERIT_VLM_REVIEW_SRC || path.join(repoRoot, "src/plan-vlm-review.js");
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx);
  const V = ctx.globalThis ? ctx.globalThis.MeritVlmReview : ctx.MeritVlmReview;
  checks.require(!!V && typeof V.acceptPlan === "function", "MeritVlmReview loads outside the browser");
  const open = (over) => ({ id: "f", state: "open", confidence: "high", evidence: "", value: null, type: null, box: null, candidateId: null, ...over });
  const cand = (id, over) => ({ id, kind: "table", type: "round", x: 10, y: 10, w: 6, h: 6, status: "unreviewed", chairDetections: [], ...over });

  // ---- B1: a seat count never overrides a decision ------------------------------------
  const bench = (status, over) => ({ candidates: [cand("b", { kind: "venue", type: "bench", status, seats: null, ...over })] });
  const seat = (a) => V.acceptPlan(open({ kind: "seatCount", candidateId: "b", value: 4 }), a);
  checks.equal({ confirmed: seat(bench("confirmed")).reason, typed: seat(bench("unreviewed", { seats: 3, seatsConfidence: "verified" })).reason, open: seat(bench("unreviewed")).action },
    { confirmed: "ALREADY_DECIDED", typed: "ALREADY_DECIDED", open: "seats" },
    "a seat count is not offered over a confirmed object or over a count a person typed; on an unreviewed bench it is");
  const chairsTable = { candidates: [cand("t", { chairDetections: [{ x: 9, y: 9, w: 1, h: 1 }] })] };
  checks.equal(V.acceptPlan(open({ kind: "seatCount", candidateId: "t", value: 8 }), chairsTable).reason, "SEATS_ARE_CHAIRS",
    "a table that draws its chairs is counted by its chairs, never given a number");

  // ---- B2 / B3: no "missing" where a person rejected one --------------------------------
  const missingAt = (box, type = "round") => open({ kind: "missing", type, box });
  const rejectedHere = { candidates: [cand("r", { status: "rejected", x: 40, y: 40, w: 6, h: 6 })] };
  checks.equal(V.acceptPlan(missingAt({ x: 40.5, y: 40.2, w: 5.8, h: 6 }), rejectedHere).reason, "REJECTED_HERE",
    "a missing table is not offered where a person rejected a table in this analysis");
  const memory = [{ status: "rejected", kind: "table", type: "round", geometry: { x: 70, y: 20, w: 5, h: 5 } }];
  checks.equal(V.acceptPlan(missingAt({ x: 70.3, y: 20.1, w: 5, h: 5 }), { candidates: [] }, { memory }).reason, "REJECTED_HERE",
    "…nor where the plan memory carries a person's rejection across a re-analysis");
  checks.equal(V.acceptPlan(missingAt({ x: 30, y: 30, w: 5, h: 5 }), { candidates: [] }, { memory }).action, "add",
    "a missing table elsewhere is still offered");

  // ---- E1: duplicates vs nested objects --------------------------------------------------
  const loca = { candidates: [cand("L", { kind: "venue", type: "loca", x: 50, y: 50, w: 20, h: 20 })] };
  checks.equal(V.acceptPlan(missingAt({ x: 55, y: 55, w: 6, h: 6 }), loca).action, "add", "a table inside a loca is a nested object and is offered");
  const tableHere = { candidates: [cand("T", { x: 50, y: 50, w: 8, h: 8 })] };
  checks.equal(V.acceptPlan(missingAt({ x: 50.5, y: 50.5, w: 7.5, h: 7.5 }), tableHere).reason, "COVERED", "a second table on a table is a duplicate");
  checks.equal(V.acceptPlan(missingAt({ x: 50.5, y: 50.5, w: 7.5, h: 7.5 }, "column"), tableHere).action, "add", "a column at the same place as a table is a different object");

  // ---- D5: a missed chair goes to its table ----------------------------------------------
  const nearTable = { candidates: [cand("T1", { x: 20, y: 20, w: 8, h: 8 }), cand("T2", { x: 60, y: 60, w: 8, h: 8 })] };
  const chair = V.acceptPlan(missingAt({ x: 28.4, y: 23, w: 1.4, h: 1.4 }, "chair"), nearTable);
  checks.ok(chair.action === "addChair" && chair.tableId === "T1" && Math.abs(chair.chair.x - 29.1) < 0.01,
    "a missed chair at a table's edge is offered as that table's chair, at its centre", chair);
  const lone = V.acceptPlan(missingAt({ x: 90, y: 5, w: 1.4, h: 1.4 }, "chair"), nearTable);
  checks.equal(lone.action, "add", "a chair far from any table is offered as a free-standing chair");
  const confirmedTable = { candidates: [cand("T1", { x: 20, y: 20, w: 8, h: 8, status: "confirmed" })] };
  checks.equal(V.acceptPlan(missingAt({ x: 28.4, y: 23, w: 1.4, h: 1.4 }, "chair"), confirmedTable).reason, "ALREADY_DECIDED",
    "a chair is not added to a table a person confirmed");
  const seatedHere = { candidates: [cand("T1", { x: 20, y: 20, w: 8, h: 8, chairDetections: [{ x: 29.1, y: 23.7, w: 1.4, h: 1.4 }] })] };
  checks.equal(V.acceptPlan(missingAt({ x: 28.4, y: 23, w: 1.4, h: 1.4 }, "chair"), seatedHere).reason, "COVERED", "a chair the table already has is a duplicate");

  // ---- C1: held back, in its real shape -------------------------------------------------
  const frame = { x: 0, y: 0, w: 100, h: 100 }, size = { width: 1000, height: 1000 };
  const shapes = { candidates: [cand("a", { lowEvidence: { reason: "overlapsAnotherTable", with: "b", share: 0.4 } }), cand("b", { x: 30, lowEvidence: null }),
    cand("c", { x: 50, lowEvidence: { reason: "somethingNew" } })] };
  const sent = V.candidatesPayload(shapes, frame, size).candidates.map((c) => c.heldBack);
  checks.equal(sent, ["overlapsAnotherTable", null, "other"],
    "lowEvidence:{reason} is sent as its reason, null as null, and an unknown reason as \"other\" — never read as === true");
}
