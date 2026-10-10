// ONE WRITER FOR WHAT A PERSON DECIDES ABOUT A DETECTED OBJECT.
//
// Confirm, reject, "not important", a type change and the family it spreads
// to, a bulk confirmation, switching a held-back candidate on or off, and
// undo — each used to be written inline where its button was handled, and
// each kept a different subset of the four records a decision has to keep in
// step: plan memory (so Re-Analyze keeps it), the training example (what the
// detector said and what the person answered), the audit trail, and the
// observation that says a person — not the detector — decided.
//
// Written first as a CHARACTERIZATION: run against the code before the writer
// existed, it failed on these (2026-10-04):
//   - undo withdrew plan memory but left the training example in the dataset,
//     a label for a decision that no longer stands;
//   - undo of a correction that had REPLACED an earlier memory entry deleted
//     that earlier decision too;
//   - "not important" deleted the candidate from the analysis (no undo, and it
//     came straight back on Re-Analyze as an open question);
//   - a family spread's labels said "not individually reviewed" only in a
//     free-text note;
//   - no decision wrote an audit entry; none recorded a human observation;
//   - confirm, reject, "not important" and the include checkbox did not refuse
//     a historical event themselves.
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings } from "../lib/js-scan.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, reRunDetection, futureDate, click } from "../lib/app-actions.mjs";

export const meta = { name: "review-decisions", tags: ["intelligence"], timeout: 420000, viewport: { width: 1600, height: 1000 } };

function enclosingFunction(lines, index) {
  for (let i = index; i >= 0; i--) {
    const m = lines[i].match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/) ||
      lines[i].match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/);
    if (m) return m[1];
  }
  return "(top level)";
}

export default async function run({ page, checks, baseUrl, repoRoot }) {
  // ---- 1. the static boundary -------------------------------------------------
  // A candidate's decision fields (status, selected, kind, type) are written by
  // the review writer and, at analysis time, by the stages that BUILD the
  // analysis — never inline beside a button.
  const ALLOWED = new Set([
    "app-v8.js:applyReviewWrites",    // the writer
    "app-v8.js:undoReviewDecision",   // its undo
    "app-v8.js:applyPlanMemory",      // analysis time: earlier human decisions re-applied
    "app-v8.js:identifyLabelledVenueObjects", // analysis time: a printed label names an object
    "app-v8.js:placeNamedVenueElements", // analysis time: a printed label or a wall-column family offers an element
    "app-v8.js:holdBackOverlappingTables", // analysis time: two tables cannot stand in one place
    "app-v8.js:applyTeachArea",       // analysis time: a kept lesson applied within its scope
    "app-v8.js:commitCandidates",     // marks what Confirm wrote to the floor plan
  ]);
  const shell = ["app-v8.js", "app.js", ...fs.readdirSync(path.join(repoRoot, "src")).filter(f => /^screen-.*\.js$/.test(f))];
  const offenders = [];
  for (const f of shell) {
    const lines = stripCommentsAndStrings(fs.readFileSync(path.join(repoRoot, "src", f), "utf8")).split("\n");
    const raw = fs.readFileSync(path.join(repoRoot, "src", f), "utf8").split("\n");
    lines.forEach((l, i) => {
      const hits = [];
      if (/\.selected\s*=(?!=)/.test(l)) hits.push("selected");
      if (/\.status\s*=(?!=)/.test(l) && /\.status\s*=\s*("(confirmed|rejected|unreviewed)"|[\w.]+\.status\b)/.test(raw[i])) hits.push("status");
      if (/\b(c|other|cand|candidate|obj|target)\.(kind|type)\s*=(?!=)/.test(l)) hits.push("kind/type");
      if (!hits.length) return;
      const where = `${f}:${enclosingFunction(lines, i)}`;
      if (!ALLOWED.has(where)) offenders.push(`${where} (line ${i + 1}): ${hits.join(",")}`);
    });
  }
  checks.equal(offenders, [], "a candidate's status/selected/kind/type is written only by the review writer (and the analysis stages that build it)");

  // ---- 2. a real analysis --------------------------------------------------------
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Decisions", hotel: "Merit", date: futureDate() });
  const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
  await importPlan(page, "data:image/png;base64," + plan);
  await runDetection(page);

  const snap = () => page.evaluate(() => {
    const e = state.events[0], a = e.analysis;
    return {
      cands: a.candidates.map(c => ({ id: c.id, kind: c.kind, type: c.type, status: c.status, selected: c.selected, dismissed: !!c.dismissed,
        human: (a.observations || []).filter(o => (c.observationIds || []).includes(o.id) && o.source.kind === "human").map(o => o.claim && o.claim.decisionId) })),
      memory: (e.planMemory || []).map(m => ({ id: m.id, src: m.sourceCandidateId, status: m.status, kind: m.kind, type: m.type, dismissed: !!m.dismissed })),
      training: (state.trainingData || []).map(r => ({ id: r.id, type: r.decisionType, decisionId: r.decisionId || null, retracted: !!r.retracted,
        individual: r.reviewedIndividually !== false, from: r.propagatedFrom || null, cand: r.predictionBefore && r.predictionBefore.candidateId })),
      audit: (state.audit || []).filter(x => x.eventId === e.id && /^REVIEW_/.test(x.action)).map(x => ({ action: x.action, decisionId: x.detail && x.detail.decisionId, kind: x.detail && x.detail.kind })),
      undo: (ui.correctionUndo || []).length,
    };
  });
  const select = (id) => page.evaluate((id) => { ui.tab = "floor"; ui.planMode = "review"; ui.reviewCenterOpen = false; ui.selectedCandidateId = id; ui.activeReviewGroupId = null; ui.activeQuestionId = null; render(); }, id);
  const waitTraining = (n) => page.waitForFunction((n) => (state.trainingData || []).length >= n, n, { timeout: 30000 }).catch(() => {});
  const s0 = await snap();
  const tables = s0.cands.filter(c => c.kind === "table" && c.status === "unreviewed");
  checks.require(tables.length > 20, "the Golden Plan was analysed", tables.length);
  const [A, B, C] = [tables[0], tables[1], tables[2]];

  // ---- confirm ----------------------------------------------------------------
  await select(A.id);
  await click(page, '[data-review-action="confirm"]');
  await waitTraining(s0.training.length + 1);
  const s1 = await snap();
  const a1 = s1.cands.find(c => c.id === A.id);
  const t1 = s1.training.find(r => r.cand === A.id && r.type === "confirmation");
  checks.ok(a1.status === "confirmed" && a1.selected, "confirm: the candidate is confirmed and included");
  checks.ok(s1.memory.some(m => m.src === A.id && m.status === "confirmed"), "confirm: plan memory keeps it");
  checks.ok(t1 && t1.decisionId && t1.individual, "confirm: a training example carries the decision id and says a person reviewed this object", t1);
  checks.ok(s1.audit.some(x => x.action === "REVIEW_DECISION" && x.kind === "confirm" && x.decisionId === (t1 && t1.decisionId)), "confirm: the audit trail records the decision under the same id", s1.audit);
  checks.ok(a1.human.includes(t1 && t1.decisionId), "confirm: the candidate carries a HUMAN observation for the decision", a1.human);

  // ---- undo: every record withdrawn together -------------------------------
  await page.evaluate(() => { ui.reviewCenterOpen = true; render(); });
  await click(page, "[data-review-decision-action='undo-correction']");
  await page.waitForTimeout(400);
  const s2 = await snap();
  const a2 = s2.cands.find(c => c.id === A.id);
  checks.ok(a2.status === "unreviewed", "undo: the candidate is back to what the detector said", a2);
  checks.ok(!s2.memory.some(m => m.src === A.id), "undo: plan memory withdrawn");
  const t2 = s2.training.find(r => r.id === (t1 && t1.id));
  checks.ok(t2 && t2.retracted, "undo: the training example is RETRACTED — kept for the record, out of every dataset", t2);
  checks.ok(s2.audit.some(x => x.action === "REVIEW_DECISION_UNDONE" && x.decisionId === (t1 && t1.decisionId)), "undo: the audit trail records the undo under the same id");
  checks.ok(!a2.human.length, "undo: the human observation goes with the decision");

  // ---- reject, and "not important" -------------------------------------------
  await select(B.id);
  await click(page, '[data-review-action="reject"]');
  await select(C.id);
  await click(page, '[data-review-action="dismiss"]');
  await waitTraining(s2.training.length + 2);
  const s3 = await snap();
  const b3 = s3.cands.find(c => c.id === B.id), c3 = s3.cands.find(c => c.id === C.id);
  checks.ok(b3.status === "rejected" && !b3.selected && s3.training.some(r => r.cand === B.id && r.type === "falsePositive"), "reject: rejected, excluded, captured as a false positive");
  checks.ok(c3 && c3.status === "rejected" && c3.dismissed && !c3.selected, "not important: the candidate STAYS in the analysis, rejected and marked dismissed — never deleted", c3);
  checks.ok(s3.training.some(r => r.cand === C.id && r.type === "negative"), "not important: captured as a negative example");
  checks.ok(s3.memory.some(m => m.src === C.id && m.status === "rejected" && m.dismissed), "not important: plan memory keeps it, so Re-Analyze does not ask again");

  // ---- reclassify, spreading to the family --------------------------------------
  // An object whose visual family has other unreviewed members to spread to.
  const dId = await page.evaluate((skip) => {
    const a = state.events[0].analysis, byId = new Map(a.candidates.map(c => [c.id, c]));
    const fams = (a.planIntelligence.similarityGroups || [])
      .filter(g => g.kind === "table" && (g.memberIds || []).filter(id => byId.get(id) && byId.get(id).status === "unreviewed" && !skip.includes(id)).length >= 3)
      .sort((x, y) => y.memberIds.length - x.memberIds.length);
    return fams.length ? fams[0].memberIds.find(id => !skip.includes(id) && byId.get(id).status === "unreviewed") : null;
  }, [A.id, B.id, C.id]);
  checks.require(!!dId, "a family with unreviewed members exists to spread a correction to");
  const D = s3.cands.find(c => c.id === dId);
  const before = await snap();
  await select(D.id);
  await page.selectOption('[data-candidate-edit="kindtype"]', "table:round");
  await page.waitForTimeout(600);
  await page.waitForFunction((n) => (state.trainingData || []).length > n, before.training.length, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const s4 = await snap();
  const spreadTo = s4.cands.filter(c => c.id !== D.id && c.type === "round" && before.cands.find(b => b.id === c.id).type === D.type);
  const d4 = s4.cands.find(c => c.id === D.id);
  const own = s4.training.filter(r => r.cand === D.id && r.type === "correction");
  const propagated = s4.training.filter(r => r.from === D.id);
  checks.ok(d4.type === "round" && d4.status === "confirmed", "reclassify: the object takes the person's type", d4);
  checks.ok(spreadTo.length > 0 && spreadTo.every(c => c.status === "confirmed"), "the correction spreads to the unreviewed members of its family", spreadTo.length);
  checks.ok(own.length === 1 && own[0].individual, "the object the person looked at is ONE individually reviewed label");
  checks.ok(propagated.length === spreadTo.length && propagated.every(r => !r.individual), "each spread label is marked structurally as NOT individually reviewed, with the object it came from", { propagated: propagated.length, spread: spreadTo.length });
  checks.equal(s4.audit.filter(x => x.action === "REVIEW_DECISION" && x.kind === "reclassify").length, 1, "one decision, one audit entry — however many objects it reached");
  await page.evaluate(() => { ui.reviewCenterOpen = true; render(); });
  await click(page, "[data-review-decision-action='undo-correction']");
  await page.waitForTimeout(500);
  const s5a = await snap();
  checks.ok(s5a.cands.find(c => c.id === D.id).type === D.type && spreadTo.every(c => s5a.cands.find(x => x.id === c.id).status === "unreviewed"), "undo: the object and its whole family go back together");
  checks.ok(propagated.concat(own).every(r => s5a.training.find(x => x.id === r.id).retracted), "undo retracts the spread's labels as well as the person's own");

  // ---- a correction over an earlier decision, undone ----------------------------
  const F = s5a.cands.find(c => c.kind === "table" && c.status === "unreviewed" && ![A.id, B.id, C.id, D.id].includes(c.id) && !spreadTo.some(x => x.id === c.id));
  await select(F.id);
  await click(page, '[data-review-action="confirm"]');
  await page.waitForTimeout(400);
  const fBefore = (await snap()).memory.find(m => m.src === F.id);
  await select(F.id);
  await page.selectOption('[data-candidate-edit="kindtype"]', "table:rectangle");
  await page.waitForTimeout(800);
  const fMid = (await snap()).memory.find(m => m.src === F.id);
  await page.evaluate(() => { ui.reviewCenterOpen = true; render(); });
  await click(page, "[data-review-decision-action='undo-correction']");
  await page.waitForTimeout(500);
  const s5 = await snap();
  const fAfter = s5.memory.find(m => m.src === F.id);
  checks.ok(fMid && fMid.type === "rectangle", "the correction replaced the object's earlier memory entry", fMid);
  checks.ok(fAfter && fBefore && fAfter.id === fBefore.id && fAfter.status === "confirmed" && fAfter.type === fBefore.type, "undo restores the EARLIER memory entry the correction had replaced, rather than deleting both", { before: fBefore, after: fAfter });
  checks.ok(s5.cands.find(c => c.id === F.id).status === "confirmed", "and the object is back to the earlier, still-standing confirmation");

  // ---- switching a candidate out of what Confirm writes -------------------------
  // No control renders this today (the pre-v8 checkbox's binder was dead and is
  // gone); the writer still owns it, so whatever offers it next records it.
  const E = s5.cands.find(c => c.kind === "table" && c.status === "unreviewed" && c.selected);
  const ex = await page.evaluate((id) => {
    const e = state.events[0], r = globalThis.decideReview(e, { kind: "exclude", candidateId: id });
    const c = e.analysis.candidates.find(x => x.id === id);
    const out = { r: !!r, selected: c.selected, audit: (state.audit || []).some(x => x.action === "REVIEW_DECISION" && x.detail && x.detail.kind === "exclude"),
      labels: (state.trainingData || []).filter(t => t.decisionId === (r && r.decisionId)).length };
    return out;
  }, E.id);
  checks.ok(ex.r && ex.selected === false && ex.audit && ex.labels === 0, "excluding a candidate from Confirm is a recorded decision — and not a label about what the object is", ex);

  // ---- re-analysis keeps decisions, including "not important" -----------------
  await page.evaluate(() => { ui.reviewCenterOpen = false; render(); });
  await reRunDetection(page);
  const s6 = await snap();
  checks.ok(s6.cands.some(c => c.status === "rejected" && c.dismissed), "after Re-Analyze the dismissed object is still dismissed, not a fresh question");

  // ---- historical events refuse every decision ----------------------------------
  const hist = await page.evaluate(() => {
    const e = state.events[0];
    e.date = "2020-01-01";
    const a = e.analysis, c = a.candidates.find(x => x.status === "unreviewed" && x.kind === "table");
    const was = { status: c.status, selected: c.selected, type: c.type };
    const mem = (e.planMemory || []).length, tr = (state.trainingData || []).length, au = (state.audit || []).length;
    const tried = [];
    for (const kind of ["confirm", "reject", "notImportant", "reclassify", "exclude"]) {
      const r = globalThis.decideReview ? globalThis.decideReview(e, { kind, candidateId: c.id, to: { kind: "table", type: "round" } }) : "no writer";
      tried.push(r);
    }
    return { unchanged: c.status === was.status && c.selected === was.selected && c.type === was.type,
      memory: (e.planMemory || []).length === mem, training: (state.trainingData || []).length === tr,
      audit: (state.audit || []).filter(x => /^REVIEW_DECISION/.test(x.action)).length === 0 || (state.audit || []).length === au, tried };
  });
  checks.ok(hist.unchanged && hist.memory && hist.training, "a historical event refuses every review decision at the writer — nothing about the object, its memory or the dataset changes", hist);

  // ---- the dataset sees only decisions that stand ------------------------------
  const ds = await page.evaluate(() => {
    const T = globalThis.MeritTrainingData, all = state.trainingData || [];
    return { total: all.length, retracted: all.filter(r => r.retracted).length, summarised: T.summarise(all).total,
      split: (() => { const s = T.splitByPlan(all); return s.train.length + s.val.length + s.test.length; })() };
  });
  checks.ok(ds.retracted > 0 && ds.summarised === ds.total - ds.retracted && ds.split === ds.total - ds.retracted, "summaries and splits count only examples that were not retracted", ds);
}
