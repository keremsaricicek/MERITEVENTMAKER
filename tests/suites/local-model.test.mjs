// The local plan-symbol detector (src/plan-model.js) and its fusion with the
// classical candidates (src/plan-model-fusion.js).
//
// What must hold, whatever the model's accuracy:
//   · the shipped model loads from its pinned file and says what it is;
//   · a missing, corrupt or disabled model leaves an analysis that completes
//     on the classical path, says why in plain fields, and is not half-applied;
//   · fusion only ADDS (unreviewed, source "local-model", never selected for
//     Confirm) and marks; it removes or moves no classical candidate;
//   · on a plan that draws no chairs it attaches no chair;
//   · the analysis says a trained model ran only when one did.
// Its QUALITY is measured in benchmarks/offline-intelligence/, per fold and
// per venue, not here.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";
import { routeVendorFromCache } from "../lib/vendor.mjs";

export const meta = { name: "local-model", tags: ["intelligence", "resilience", "fast"], timeout: 420000 };

export default async function run({ page, context, checks, baseUrl, repoRoot }) {
  const newPage = async () => { const p = await context.newPage(); await routeVendorFromCache(p); return p; };
  const planPath = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  const planUrl = "data:image/png;base64," + fs.readFileSync(planPath).toString("base64");
  const src = fs.readFileSync(path.join(repoRoot, "src/plan-model.js"), "utf8");
  const pinFile = /file: "([^"]+)"/.exec(src)[1], pinBytes = Number(/bytes: (\d+)/.exec(src)[1]);
  checks.require(pinBytes > 0 && fs.existsSync(path.join(repoRoot, pinFile)), "a model is pinned and its file is in the repository", { pinFile, pinBytes });

  const analyse = async (p, label) => {
    await openApp(p, baseUrl, { lang: "en" });
    await createBlankEvent(p, { name: "Model " + label, date: futureDate() });
    await importPlan(p, planUrl);
    await runDetection(p, { timeout: 300000 });
    return p.evaluate(() => {
      const a = state.events[0].analysis;
      const live = a.candidates.filter(c => c.status !== "rejected");
      return { trainedModel: a.trainedModel, notice: a.notice, localModel: a.localModel,
        classicalTables: live.filter(c => c.kind === "table" && c.source !== "local-model").map(c => [c.id ? 1 : 0, +c.x.toFixed(3), +c.y.toFixed(3), +c.w.toFixed(3), +c.h.toFixed(3)]),
        modelAdded: a.candidates.filter(c => c.source === "local-model").map(c => ({ kind: c.kind, status: c.status, selected: c.selected, missed: !!c.missed, fromMemory: !!c.fromMemory,
          confidence: c.confidence, consistent: !!(c.evidence && c.evidence.consistentSize), score: c.evidence && c.evidence.modelScore })),
        modelChairs: a.candidates.flatMap(c => (c.chairDetections || []).filter(ch => ch.source === "local-model")).length };
    });
  };

  // ---- 1. the shipped model runs and says what it is ------------------------------
  const on = await analyse(page, "on");
  checks.ok(on.localModel && on.localModel.available === true && on.localModel.model && on.localModel.model.trainedModel === true && on.localModel.model.integrity === "sha256",
    "the pinned model loads, its bytes are checked by sha256, and the analysis records that it ran", on.localModel);
  checks.ok(on.trainedModel === true && /local plan-symbol detector/.test(on.notice),
    "the analysis says a trained model of plan symbols ran — and only because it did", { trainedModel: on.trainedModel, notice: on.notice });
  checks.ok(on.modelAdded.every(c => c.status === "unreviewed" && !c.missed && !c.fromMemory),
    "what the model adds is unreviewed and never dressed as a person's decision", on.modelAdded.slice(0, 5));
  checks.ok(on.modelAdded.every(c => c.selected ? (c.consistent && c.score >= 0.7) : c.confidence <= 0.7),
    "an addition goes to Confirm only when the model is confident and it is drawn at the plan's table size; every other one is held under the review line so it is asked about, not dropped",
    on.modelAdded.slice(0, 8));

  // ---- 2. disabled / missing / corrupt: the classical path completes alone ----------
  const variants = [
    ["disabled", p => p.addInitScript(() => { globalThis.MERIT_PLAN_MODEL_DISABLED = "suite: classical only"; }), "MODEL_DISABLED"],
    ["missing", p => p.route("**/" + pinFile, r => r.fulfill({ status: 404, body: "" })), "MODEL_MISSING"],
    ["corrupt", p => p.route("**/" + pinFile, async r => {
      const real = fs.readFileSync(path.join(repoRoot, pinFile), "utf8");
      const body = real.replace(/("b64":\s*")(.)/, (m, k, c) => k + (c === "A" ? "B" : "A"));
      if (body === real) throw new Error("the corrupt variant changed nothing — the model file's format moved");
      await r.fulfill({ status: 200, contentType: "text/javascript", body });
    }), "MODEL_INTEGRITY"],
  ];
  let offTables = null;
  for (const [label, arm, code] of variants) {
    const p = await newPage();
    await arm(p);
    const r = await analyse(p, label);
    if (label === "disabled") offTables = r.classicalTables;
    checks.ok(r.localModel && r.localModel.available === false && r.localModel.reasonCode === code && r.trainedModel === false && r.modelAdded.length === 0 && r.modelChairs === 0,
      `a ${label} model: the analysis completes on the classical path, records ${code}, adds nothing, and does not claim a trained model ran`,
      { localModel: r.localModel, trainedModel: r.trainedModel, added: r.modelAdded.length });
    if (label !== "disabled") checks.equal(JSON.stringify(r.classicalTables), JSON.stringify(offTables), `a ${label} model leaves the classical candidates exactly as with no model`);
    await p.close();
  }
  checks.equal(JSON.stringify(on.classicalTables), JSON.stringify(offTables),
    "with the model ON, every classical table candidate is still there, unmoved — fusion removes and moves nothing");

  // ---- 3. fusion rules, on constructed inputs ------------------------------------------
  const rules = await page.evaluate(() => {
    let n = 0; const uid = p => p + "_" + (++n);
    const cand = (x, y, w, h) => ({ id: uid("c"), kind: "table", type: "square", x, y, w, h, chairDetections: [], status: "unreviewed" });
    const frame = rep => ({ width: 1000, height: 1000, uid, representation: rep });
    const model = dets => ({ available: true, detections: dets });
    const a = [cand(10, 10, 5, 5)];
    const r1 = MeritPlanModelFusion.fuse(a, [], model([{ cls: "table_rect", score: 0.9, cx: 125, cy: 125, w: 50, h: 50 }, { cls: "table_round", score: 0.9, cx: 600, cy: 600, w: 60, h: 60 }, { cls: "table_round", score: 0.2, cx: 800, cy: 800, w: 60, h: 60 }]), frame("PHYSICAL"));
    const b = [cand(10, 10, 5, 5)];
    // chairs are off by default in v1; the rules below are checked with them on
    const chairsOn = { addChair: 0.45 };
    const r2 = MeritPlanModelFusion.fuse(b, [], model([{ cls: "chair", score: 0.9, cx: 125, cy: 92, w: 20, h: 20 }]), frame("SYMBOLIC"), chairsOn);
    const c = [cand(10, 10, 5, 5)];
    const seen = { cls: "table_rect", score: 0.9, cx: 125, cy: 125, w: 50, h: 50 };
    const r3 = MeritPlanModelFusion.fuse(c, [], model([seen, { cls: "chair", score: 0.9, cx: 125, cy: 92, w: 20, h: 20 }, { cls: "chair", score: 0.9, cx: 900, cy: 120, w: 20, h: 20 }]), frame("PHYSICAL"), chairsOn);
    const g = [cand(10, 10, 5, 5)];
    const rDefault = MeritPlanModelFusion.fuse(g, [], model([seen, { cls: "chair", score: 0.9, cx: 125, cy: 92, w: 20, h: 20 }]), frame("PHYSICAL"));
    // the same chair beside a table the model does NOT see is not attached:
    // a seat at a table is what exempts it from text suppression downstream
    const e = [cand(10, 10, 5, 5)];
    const r6 = MeritPlanModelFusion.fuse(e, [], model([{ cls: "chair", score: 0.9, cx: 125, cy: 92, w: 20, h: 20 }]), frame("PHYSICAL"), chairsOn);
    // a model "table" on a classical column is a disagreement about a class
    const col = { id: uid("v"), kind: "venue", type: "column", x: 60, y: 60, w: 5, h: 5 };
    const r7 = MeritPlanModelFusion.fuse([cand(10, 10, 5, 5)], [col], model([{ cls: "table_round", score: 0.95, cx: 625, cy: 625, w: 50, h: 50 }]), frame("PHYSICAL"));
    // a model chair whose centre is inside a printed-text line is not a seat
    const f = [cand(10, 10, 5, 5)];
    const r8 = MeritPlanModelFusion.fuse(f, [], model([seen, { cls: "chair", score: 0.9, cx: 125, cy: 160, w: 20, h: 20 }]),
      Object.assign(frame("PHYSICAL"), { textRegions: [{ x0: 100, y0: 150, x1: 160, y1: 170 }] }), chairsOn);
    // model columns: off by default in v1, the code path kept for a measured re-enable
    const colDet = [{ cls: "column", score: 0.9, cx: 900, cy: 900, w: 30, h: 30 }];
    const r9 = MeritPlanModelFusion.fuse([cand(10, 10, 5, 5)], [], model(colDet), frame("PHYSICAL"));
    const r10 = MeritPlanModelFusion.fuse([cand(10, 10, 5, 5)], [], model(colDet), frame("PHYSICAL"), { addColumn: 0.55 });
    const d = [cand(10, 10, 5, 5)];
    const r4 = MeritPlanModelFusion.fuse(d, [], model([]), frame("PHYSICAL"));
    const r5 = MeritPlanModelFusion.fuse([cand(10, 10, 5, 5)], [], { available: false, detections: [] }, frame("PHYSICAL"));
    return { addedOne: r1.added.length, addedType: r1.added[0] && r1.added[0].type, lowScoreSkipped: !r1.added.some(x => x.x > 70),
      symbolicChairs: r2.chairsAttached, physicalChairs: r3.chairsAttached, farChairDropped: r3.chairsDropped, chairsOnTable: c[0].chairDetections.length,
      unsupported: r4.unsupported, flagged: d[0].modelSupport, kept: d.length, unavailableAdds: r5.added.length,
      unseenTableChairs: r6.chairsAttached, unseenTableSeats: e[0].chairDetections.length,
      chairsDefault: rDefault.chairsAttached + g[0].chairDetections.length, onColumn: r7.added.length, textChairs: r8.chairsAttached, textSkipped: r8.chairsInText, textSeats: f[0].chairDetections.length,
      columnsDefault: r9.addedVenues.length, columnsEnabled: r10.addedVenues.length,
      attachedRelation: c[0].chairDetections[0] && c[0].chairDetections[0].relation && c[0].chairDetections[0].relation.evidence };
  });
  checks.ok(rules.addedOne === 1 && rules.addedType === "round" && rules.lowScoreSkipped,
    "a model table near a classical one adds nothing; a confident one where nothing was proposed is added; a weak one is not", rules);
  checks.ok(rules.symbolicChairs === 0 && rules.physicalChairs === 1 && rules.farChairDropped === 1 && rules.chairsOnTable === 1,
    "a model chair is attached to the table it sits beside; one far from every table is dropped; on a plan that draws no chairs none is attached", rules);
  checks.ok(rules.unseenTableChairs === 0 && rules.unseenTableSeats === 0,
    "a model chair is never attached to a table the model itself does not see — that seat would exempt a phantom from text suppression", rules);
  checks.ok(rules.chairsDefault === 0,
    "model chairs are not attached by default in v1 (on the Golden Plan the chairs only the model saw were 4 right, 3 wrong); the rules below hold for a measured re-enable", rules);
  checks.ok(rules.onColumn === 0, "a model table centred on a classical column is not added — the two disagree about a class; nothing was missed", rules);
  checks.ok(rules.textChairs === 0 && rules.textSkipped === 1 && rules.textSeats === 0,
    "a model chair whose centre lies in a line of printed text is not added — the classical chair stage's own rule (on the Golden Plan two labels read as chairs)", rules);
  checks.ok(rules.columnsDefault === 0 && rules.columnsEnabled === 1,
    "model columns are not added by default in v1 (0 real of 23 added on the regression set); the path still works when a measurement turns it on", rules);
  checks.ok(rules.attachedRelation && rules.attachedRelation.positionKind === "edge" && rules.attachedRelation.positionSide === "top",
    "an attached chair carries where it sits against the table in the relationship engine's own terms, so the scene graph can explain it", rules);
  checks.ok(rules.unsupported === 1 && rules.flagged === false && rules.kept === 1 && rules.unavailableAdds === 0,
    "a classical table the model does not see is marked, never removed; an unavailable model changes nothing", rules);
}
