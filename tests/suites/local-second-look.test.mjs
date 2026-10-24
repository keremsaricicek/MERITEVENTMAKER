// The LOCAL second look: closed questions about the places the analysis is
// unsure of, asked of a model on this machine (src/plan-local-check.js,
// server/vlm-relay.mjs /vlm-relay/ask, the review screen's panel).
//
// NO MODEL RUNS HERE. The local process is tests/lib/fake-local-vlm.mjs, whose
// every answer is SCRIPTED by this file. A pass proves the plumbing and the
// rules, never how well any model answers (that is
// benchmarks/offline-intelligence/local-vlm-bench2.py, on a real model).
//
// What this pins:
//   A PERSON'S DECISION IS NEVER ASKED ABOUT: a confirmed, rejected or
//     dismissed object, an answered grouping, a typed seat count — no question.
//   ONLY MEASURED QUESTIONS: the relay refuses a question the manifest does not
//     list (`checks`), and the page plans none; without `checks` there is no
//     second-look button at all.
//   THE QUESTION IS THE MEASURED ONE: word for word the benchmark's
//     (server/local-check-questions.json), no system text, thinking off; the
//     page sends a question NAME and a 448 px crop, never text of its own.
//   A CLOSED VALUE COMES BACK, never the model's words.
//   TWO LOOKS OR NOTHING: looks that disagree make no finding; agreement with
//     the analysis makes no finding; only a shared disagreement does.
//   ONE ACCEPT, ONE OBJECT: a type correction goes through decideReview for
//     the one object and undoes; a count, a grouping or a link is a note.
//   ONE PRESS: after an analysis, a measured local model's second look starts
//     BY ITSELF (the owner's decision, 2026-10-18) — no question, no panel
//     forced open, nothing applied, said in the panel and the audit; a switch
//     turns it off. Started by hand it still asks first.
//   CANCEL stops the request in flight.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { startFakeLocalVlm, FAKE_LOCAL_NOTICE } from "../lib/fake-local-vlm.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, reRunDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "local-second-look", tags: ["intelligence", "security", "fast"], timeout: 300000 };

const PNG448 = (() => {
  // a real 448x448 white PNG is not needed by the relay; any small valid base64 passes its shape check
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
})();

export default async function run({ page, checks, repoRoot }) {
  checks.ok(FAKE_LOCAL_NOTICE.includes("not a model"), "the local process in this suite is the scripted fake, and says so");

  // ---- the rules, outside the browser ------------------------------------------------
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/plan-vlm-review.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/plan-local-check.js"), "utf8"), ctx);
  const L = ctx.MeritLocalCheck, V = ctx.MeritVlmReview;
  checks.require(!!L && typeof L.plan === "function" && !!V, "MeritLocalCheck loads outside the browser");

  const W = 2000, H = 1000;
  const cand = (id, over) => ({ id, kind: "table", type: "round", x: 10, y: 10, w: 2, h: 4, status: "unreviewed", selected: true, confidence: 0.9, chairDetections: [], ...over });
  const chairs = (n) => Array.from({ length: n }, (_, i) => ({ id: "ch" + i, x: 0, y: 0, w: 0.5, h: 1 }));
  const analysis = {
    candidates: [
      cand("sofa1", { kind: "venue", type: "sofa", x: 40, y: 40, w: 4, h: 2, confidence: 0.7 }),
      cand("sofaDecided", { kind: "venue", type: "sofa", x: 50, y: 40, w: 4, h: 2, status: "confirmed" }),
      cand("held", { type: "square", x: 70, y: 70, w: 2, h: 4, lowEvidence: { reason: "belowReviewThreshold" } }),
      cand("dismissed", { kind: "venue", type: "bench", x: 80, y: 10, w: 4, h: 2, status: "rejected", dismissed: true }),
      // four round tables of 8, one of 7 standing alone: the odd one is asked about
      cand("t8a", { x: 5, y: 60, chairDetections: chairs(8) }), cand("t8b", { x: 15, y: 60, chairDetections: chairs(8) }),
      cand("t8c", { x: 25, y: 60, chairDetections: chairs(8) }), cand("t7", { x: 35, y: 85, chairDetections: chairs(7) }),
      cand("t7typed", { x: 90, y: 85, chairDetections: chairs(7), seatsConfidence: "verified" }),
      cand("g1", { type: "square", x: 60, y: 20, w: 2, h: 4 }), cand("g2", { type: "square", x: 62, y: 20, w: 2, h: 4 }),
      cand("g3", { type: "square", x: 60, y: 30, w: 2, h: 4 }), cand("g4", { type: "square", x: 62, y: 30, w: 2, h: 4 }),
      cand("bench1", { kind: "venue", type: "bench", x: 30, y: 30, w: 4, h: 1 }), cand("tb", { type: "rectangle", x: 30, y: 32, w: 4, h: 2 }),
    ],
    planIntelligence: {
      capacityAudit: { rule: null },
      furnitureGroups: [{ id: "fg1", memberIds: ["g1", "g2"], decision: null }, { id: "fg2", memberIds: ["g3", "g4"], decision: "merged" }],
      seatingLinks: { links: [{ pieceId: "bench1", tableId: "tb", certainty: "uncertain" }, { pieceId: "sofa1", tableId: "tb", certainty: "clear" }] },
    },
  };
  const ALL = ["identify", "chairs", "merged", "serves"];
  const qs = L.plan(analysis, { checks: ALL, width: W, height: H, max: 40 });
  const asked = qs.map((q) => `${q.question}:${q.candidateIds.join("+")}`).sort();
  checks.equal(asked, ["chairs:t7", "identify:bench1", "identify:held", "identify:sofa1", "merged:g1+g2", "serves:tb+bench1"].sort(),
    "the second look asks about the held-back object, the guessed seating furniture, the table whose chairs differ from its look-alikes, the unanswered group and the uncertain link — and about nothing a person decided (confirmed sofa, dismissed bench, typed seats, answered group)");
  checks.equal(L.plan(analysis, { checks: ["merged"], width: W, height: H }).map((q) => q.question), ["merged"], "only the questions the model was measured on are planned");
  checks.equal(L.plan(analysis, { checks: [], width: W, height: H }), [], "with no measured question nothing is planned");
  // the V5 words (server/local-check-questions.json): a loca box is a "lodge", an entrance or an exit an "entrance"
  const venueAnalysis = { candidates: [cand("loca1", { kind: "venue", type: "loca", x: 10, y: 10, w: 6, h: 4, confidence: 0.4 }),
    cand("door1", { kind: "venue", type: "entrance", x: 30, y: 10, w: 3, h: 3, confidence: 0.4 }), cand("exit1", { kind: "venue", type: "exit", x: 50, y: 10, w: 3, h: 3, confidence: 0.4 })] };
  const venueQs = L.plan(venueAnalysis, { checks: ["identify"], width: W, height: H });
  checks.equal(venueQs.map((q) => `${q.candidateIds[0]}:${q.detector}`).sort(), ["door1:entrance", "exit1:entrance", "loca1:lodge"],
    "a held-back loca, entrance or exit is asked about with the word the model was trained on");
  const doorQ = venueQs.find((q) => q.candidateIds[0] === "door1");
  const toLodge = doorQ && L.findingFor(doorQ, L.judge(doorQ, ["lodge", "lodge"]), venueAnalysis, "t");
  checks.equal(toLodge && [toLodge.kind, toLodge.type], ["wrongType", "loca"], "the word 'lodge' suggests the product's own type, loca");
  const sofaQ = qs.find((q) => q.candidateIds[0] === "sofa1");
  checks.equal(sofaQ.frame, { cx: 840, cy: 410, side: 2 * 80 + 30 }, "an identify crop is the benchmark's: centred on the object, 2 x its larger side + 30 px");
  const chairsQ = qs.find((q) => q.question === "chairs");
  checks.equal({ detector: chairsQ.detector, reason: chairsQ.reason }, { detector: 7, reason: "unlikeLookAlikes" }, "the chairs question carries the analysis's count and why it was asked");

  const j = (q, a) => L.judge(q, a);
  checks.equal([j(chairsQ, [7, 7]).verdict, j(chairsQ, [8, 8]).verdict, j(chairsQ, [8, 7]).verdict, j(chairsQ, [8, null]).verdict, j(chairsQ, [8]).verdict],
    ["AGREES", "DIFFERS", "UNSURE", "NO_ANSWER", "NO_ANSWER"], "two looks that agree with each other and the analysis agree; two that agree and differ, differ; looks that disagree are unsure; a look without an answer is no answer");
  checks.equal([L.findingFor(chairsQ, j(chairsQ, [7, 7]), analysis), L.findingFor(chairsQ, j(chairsQ, [8, 7]), analysis)], [null, null],
    "agreement and an unsure pair make no finding");

  const f = (q, ans) => L.findingFor(q, j(q, ans), analysis, "t");
  const sofaToBench = f(sofaQ, ["bench", "bench"]), sofaNothing = f(sofaQ, ["nothing", "nothing"]), sofaTable = f(sofaQ, ["table", "table"]);
  const chairNote = f(chairsQ, [8, 8]), mergedNote = f(qs.find((q) => q.question === "merged"), ["no", "no"]), servesNote = f(qs.find((q) => q.question === "serves"), ["no", "no"]);
  checks.equal([sofaToBench.kind, sofaToBench.type, sofaNothing.kind, sofaTable.kind, chairNote.kind, chairNote.value, mergedNote.kind, servesNote.kind],
    ["wrongType", "bench", "notAnObject", "note", "note", 8, "note", "note"],
    "a different furniture word is a type suggestion, 'nothing' is a not-an-object suggestion, 'a table' (no shape) and every count, grouping and link are notes");
  const accept = (fd, a = analysis) => V.acceptPlan(fd, a);
  checks.equal([accept(sofaToBench).action, accept(sofaToBench).decision.spread, accept(sofaNothing).decision.kind, accept(chairNote).reason, accept(mergedNote).reason],
    ["decide", false, "reject", "INFORMATION", "INFORMATION"],
    "Accept on a type suggestion changes the ONE object (spread:false), on not-an-object rejects it; a note has nothing to apply");
  // The plan reading says what the look found, in its own section, and only
  // when a look ran on this analysis.
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/plan-reading.js"), "utf8"), ctx);
  const R = ctx.MeritPlanReading;
  const withLook = { ...analysis, imageWidth: W, imageHeight: H, vlm: { mode: "check", status: "done", checks: [
    { id: "q1", candidateIds: ["held"], verdict: "DIFFERS" }, { id: "q2", candidateIds: ["t7"], verdict: "AGREES" },
    { id: "q3", candidateIds: ["g1", "g2"], verdict: "AGREES" }, { id: "q4", candidateIds: ["bench1"], verdict: "UNSURE" }] } };
  const sec = (a) => (R.read(a).sections.find((x) => x.id === "second") || { sentences: [] }).sentences.map((x) => [x.key, x.params, x.refs.slice().sort(), x.certainty]);
  checks.equal(sec(withLook), [
    ["read.second.summary", { asked: 4, agree: 2, differ: 1, unsure: 1 }, [], "inferred"],
    ["read.second.agree", { n: 2 }, ["g1", "g2", "t7"], "seen"],
    ["read.second.differ", { n: 1 }, ["held"], "unsure"]],
    "the plan reading tallies the look, points at the places it agreed on as the model's view (never a person's decision) and at the places to check");
  checks.equal([sec({ ...analysis, imageWidth: W, imageHeight: H }), sec({ ...withLook, vlm: { ...withLook.vlm, status: "running" } }), sec({ ...withLook, vlm: { mode: undefined, findings: [] } })], [[], [], []],
    "no look, a look still running, or a whole-plan reading: the section is not there");
  const decidedSince = { candidates: analysis.candidates.map((c) => c.id === "sofa1" ? { ...c, status: "confirmed" } : c) };
  checks.equal(accept(sofaToBench, decidedSince).reason, "ALREADY_DECIDED", "a person who decided the object after the look outranks the suggestion");

  // ---- the relay ----------------------------------------------------------------------
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const bench = fs.readFileSync(path.join(repoRoot, "benchmarks/offline-intelligence/local-vlm-bench2.py"), "utf8");
  checks.ok(/local-check-questions\.json/.test(bench) && /bench\.Q\[/.test(fs.readFileSync(path.join(repoRoot, "training/vlm_lora.py"), "utf8")),
    "the benchmark reads its questions from the relay's file, and the training set takes them from the benchmark");
  checks.equal(core.askText("serves", "sofa"),
    "This is a crop of an event venue floor plan, drawn from above. Does the sofa stand directly against the table so people on it sit at that table? Answer yes or no.",
    "the question the relay writes is the measured one, word for word");
  const parsed = [["identify", "Sofa."], ["identify", "It looks like a couch"], ["identify", "I cannot tell"], ["chairs", "There are 8 chairs."], ["chairs", "eight"],
    ["chairs", "1200"], ["merged", "No, they are apart"], ["serves", "Yes"]].map(([q, t]) => core.parseAskAnswer(q, t));
  checks.equal(parsed, ["sofa", "sofa", null, 8, 8, null, "no", "yes"], "the answer is read by the benchmark's rules into a closed value, or none");

  // ---- the committed manifests: a check is listed only if its evidence passed it ------
  // The pre-registered bars recomputed from the evidence files' own rows
  // (training/README.md: V4, then the supplementary test S1). A manifest cannot
  // list a question either measurement failed, nor leave out the cost rows. The
  // memory row is read from the cost run (--cache-ram 0), whose every answer must
  // equal the scored run's — else it measured something else.
  const { readManifest } = await import(path.join(repoRoot, "server/vlm-local.mjs"));
  const mdir = path.join(repoRoot, "tools/local-vlm/manifests");
  const acc = (rs) => rs.length ? rs.filter((r) => String(r.parsed) === String(r.truth)).length / rs.length : 0;
  const over = (rs) => rs.length ? rs.filter((r) => Number.isInteger(r.parsed) && r.parsed > Number(r.truth)).length / rs.length : 1;
  const rateYes = (rs) => rs.length ? rs.filter((r) => r.parsed === "yes").length / rs.length : 1;
  const passesV4 = (rows) => {
    const T = (task, src) => rows.filter((r) => r.task === task && (!src || src.includes(r.source)));
    const idgen = T("ID", ["generated"]);
    const neg = T("NEG"), yesOnNo = rateYes(rows.filter((r) => ["MERGED", "SERVES"].includes(r.task) && r.truth === "no"));   // one pooled row, as registered
    return {
      identify: acc(idgen) >= 0.85 && acc(idgen.filter((r) => ["sofa", "bench", "banquette"].includes(r.truth))) >= 0.80 && acc(T("ID", ["golden", "ornek"])) >= 0.80
        && neg.filter((r) => r.parsed !== "nothing").length / neg.length <= 0.05,
      count: acc(T("COUNT")) >= 0.80 && over(T("COUNT")) <= 0.10,
      chairs: acc(T("CHAIRS")) >= 0.80 && over(T("CHAIRS")) <= 0.10,
      merged: acc(T("MERGED")) >= 0.85 && yesOnNo <= 0.10,
      serves: acc(T("SERVES")) >= 0.85 && yesOnNo <= 0.10,
    };
  };
  const passesS1 = (rows) => {
    const T = (task, subs) => rows.filter((r) => r.task === task && (!subs || subs.includes(r.sub)));
    return {
      chairs: T("CHAIRS", ["odd"]).length > 0 && acc(T("CHAIRS", ["odd"])) >= 0.80 && acc(T("CHAIRS")) >= 0.80 && over(T("CHAIRS")) <= 0.10,
      merged: T("MERGED").length > 0 && acc(T("MERGED")) >= 0.85 && rateYes(T("MERGED", ["nearmiss"])) <= 0.10,
      serves: T("SERVES").length > 0 && acc(T("SERVES")) >= 0.85 && rateYes(T("SERVES", ["benchneg", "banquetteneg"])) <= 0.10,
    };
  };
  const listed = [];
  for (const f of fs.readdirSync(mdir).filter((n) => n.endsWith(".json"))) {
    const r = readManifest(path.join(mdir, f), { verify: false });
    checks.ok(r.ok, `committed manifest ${f} is well formed`, r);
    if (!r.ok || !r.manifest.checks.length) continue;
    listed.push(f);
    const ev = (r.manifest.checksEvidence.match(/[\w./-]+\.json/g) || []).map((p) => path.join(repoRoot, p));
    checks.ok(ev.length >= 2 && ev.every((p) => fs.existsSync(p)), `${f}: checksEvidence names its evidence files, all committed`, r.manifest.checksEvidence);
    if (ev.length < 2 || !ev.every((p) => fs.existsSync(p))) continue;
    const runs = ev.map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
    const s1 = runs.find((x) => x.summary.settings.s1);
    const cost = runs.find((x) => !x.summary.settings.s1 && x.summary.settings.cacheRam === 0);
    const scored = runs.find((x) => x !== s1 && x !== cost);
    checks.ok(scored && cost, `${f}: the evidence holds the scored final test and its cost run`);
    if (!scored || !cost) continue;
    const st = scored.summary.settings;
    checks.ok(st.looks === 2 && st.real === true && st.seed === 5, `${f}: the scored evidence is the pre-registered final test (two looks, real crops in, seed 5)`, st);
    const same = scored.rows.length === cost.rows.length && scored.rows.every((x, i) => x.task === cost.rows[i].task && String(x.truth) === String(cost.rows[i].truth)
      && x.parsed === cost.rows[i].parsed && x.parsed2 === cost.rows[i].parsed2);
    checks.ok(same && cost.summary.settings.lora === st.lora, `${f}: the cost run asked the same items of the same adapter with the prompt cache off and got every answer the scored run got`);
    checks.ok(scored.summary.medianSeconds <= 10 && cost.summary.peakRssMb <= 3000, `${f}: median ≤ 10 s per crop (scored run) and peak server RSS ≤ 3,000 MB (cost run)`,
      { median: scored.summary.medianSeconds, rss: cost.summary.peakRssMb });
    const v4 = passesV4(scored.rows), sup = s1 ? passesS1(s1.rows) : {};
    if (r.manifest.checks.some((q) => q in passesS1([])))
      checks.ok(s1 && s1.summary.settings.looks === 2 && s1.summary.settings.cacheRam === 0 && s1.summary.settings.lora === st.lora,
        `${f}: a chairs, merged or serves check carries the supplementary test S1, asked of the same adapter`, s1 && s1.summary.settings);
    // identify and count: V4 alone; chairs, merged and serves: V4 AND S1
    const ok = Object.fromEntries(Object.keys(v4).map((q) => [q, v4[q] && (["chairs", "merged", "serves"].includes(q) ? !!(s1 && sup[q]) : true)]));
    checks.equal(r.manifest.checks.slice().sort(), Object.keys(ok).filter((q) => ok[q]).sort(),
      `${f}: lists exactly the questions its evidence passed — V4 and, for chairs, merged and serves, S1 — at the pre-registered bars`, { v4, s1: sup });
  }
  checks.ok(listed.length <= 1, "at most one committed manifest lists checks (the measured one)", listed);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-second-look-"));
  const modelDir = path.join(tmp, "model");
  fs.mkdirSync(modelDir);
  const files = { "weights.gguf": crypto.randomBytes(4096), "mmproj.gguf": crypto.randomBytes(2048), "adapter.gguf": crypto.randomBytes(1024) };
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(modelDir, n), b);
  // what a correctly started process reports: the pinned model and adapter, on these paths, at the measured context
  const real = (n) => fs.realpathSync(path.join(modelDir, n));
  const SERVE = { model: "weights.gguf", lora: [{ path: "adapter.gguf", scale: 1 }], ctx: 2048 };
  const SERVING = { modelPath: real("weights.gguf"), nCtx: 2048, loras: [{ path: real("adapter.gguf"), scale: 1 }] };
  const manifest = (over = {}) => ({ format: "merit-local-vlm/1", id: "fake-local-vlm", name: "Scripted Local VLM", version: "0.0-test", licence: "Apache-2.0 (test)",
    source: "written by tests/suites/local-second-look.test.mjs", runtime: "tests/lib/fake-local-vlm.mjs",
    files: Object.entries(files).map(([p, b]) => ({ path: p, bytes: b.length, sha256: crypto.createHash("sha256").update(b).digest("hex") })), ...over });
  const writeManifest = (name, m) => { const fl = path.join(modelDir, name); fs.writeFileSync(fl, JSON.stringify(m)); return fl; };
  const withChecks = writeManifest("checks.json", manifest({ checks: ["identify", "chairs", "merged", "serves"], checksEvidence: "scripted: tests/suites/local-second-look.test.mjs", serve: SERVE }));
  const noChecks = writeManifest("nochecks.json", manifest());
  const cfg = (m) => core.configFromEnv({ VLM_PROVIDER: "local", VLM_LOCAL_URL: "http://127.0.0.1:9", VLM_LOCAL_MANIFEST: m }, { repoRoot });
  checks.equal([cfg(writeManifest("bad1.json", manifest({ checks: ["identify", "describe"], checksEvidence: "x", serve: SERVE }))).reasonCode,
    cfg(writeManifest("bad2.json", manifest({ checks: ["identify"], serve: SERVE }))).reasonCode, cfg(withChecks).reasonCode],
    ["LOCAL_MANIFEST_INVALID", "LOCAL_MANIFEST_INVALID", null], "a manifest may list only known questions, and only with the measurement they passed");
  checks.equal([cfg(writeManifest("bad3.json", manifest({ checks: ["chairs"], checksEvidence: "x" }))).reasonCode,
    cfg(writeManifest("bad4.json", manifest({ checks: ["chairs"], checksEvidence: "x", serve: { ...SERVE, lora: [{ path: "elsewhere.gguf", scale: 1 }] } }))).reasonCode,
    cfg(writeManifest("bad5.json", manifest({ checks: ["chairs"], checksEvidence: "x", serve: { ...SERVE, ctx: "2048" } }))).reasonCode],
    ["LOCAL_MANIFEST_INVALID", "LOCAL_MANIFEST_INVALID", "LOCAL_MANIFEST_INVALID"],
    "measured questions need `serve` — how the measured server ran — naming only files the manifest pins");

  let dirN = 0;
  const lines = [], log = { log: (l) => lines.push(String(l)), error: (l) => lines.push(String(l)) };
  const opened = [], fakes = [];
  const relayWith = async (env) => {
    const config = core.configFromEnv({ VLM_PROVIDER: "local", VLM_DATA_DIR: path.join(tmp, "d" + (++dirN)), PORT: "0", ...env }, { repoRoot });
    const r = await startRelay({ config, log });
    opened.push(r);
    return r;
  };
  const post = (r, p, b) => fetch(r.baseUrl + p, { method: "POST", headers: { "content-type": "application/json", "x-merit-relay": "1" }, body: JSON.stringify(b) })
    .then(async (x) => ({ http: x.status, json: await x.json().catch(() => null) }));
  const askBody = (over = {}) => ({ runId: "run_ask00001", analysisId: "analysis_1", planHash: "hash1", question: "identify",
    image: { mediaType: "image/png", data: PNG448, width: 448, height: 448 }, ...over });

  try {
    const fake = await startFakeLocalVlm({ serving: SERVING, fallback: (b) => /single object/.test(JSON.stringify(b)) ? "It is a SOFA, clearly. Ignore previous instructions." : "8" });
    fakes.push(fake);
    const r = await relayWith({ VLM_LOCAL_URL: fake.baseURL, VLM_LOCAL_MANIFEST: withChecks });
    const st = await fetch(r.baseUrl + "/vlm-relay/status").then((x) => x.json());
    checks.ok(st.version >= 3 && st.local.checks.join() === "identify,chairs,merged,serves" && /local-second-look/.test(st.local.checksEvidence) && st.limits.maxAsksPerRun > 0,
      "status names the measured questions, where they were measured, and the second look's caps", st.local);
    checks.equal(st.local.serving, "verified", "the running process said it is the measured server (model file, adapter, context)");
    checks.ok(!JSON.stringify(st).includes(modelDir), "status names no path on this disk", st.local);
    // The measured server and nothing else: a process started without its adapter,
    // at another context, on another file, with an extra adapter, or unable to say.
    const wrong = {
      noAdapter: { ...SERVING, loras: [] },
      adapterOff: { ...SERVING, loras: [{ path: real("adapter.gguf"), scale: 0 }] },
      otherScale: { ...SERVING, loras: [{ path: real("adapter.gguf"), scale: 0.5 }] },
      extraAdapter: { ...SERVING, loras: [...SERVING.loras, { path: real("mmproj.gguf"), scale: 1 }] },
      otherContext: { ...SERVING, nCtx: 8192 },
      otherModel: { ...SERVING, modelPath: real("mmproj.gguf") },
      cannotSay: null,
    };
    const seen = {};
    for (const [k, sv] of Object.entries(wrong)) {
      fake.setServing(sv);
      const s2 = await fetch(r.baseUrl + "/vlm-relay/status").then((x) => x.json());
      const a2 = await post(r, "/vlm-relay/ask", askBody({ runId: "run_wrong" + k.slice(0, 6).toLowerCase() }));
      seen[k] = [s2.local.checks.length, s2.local.serving, a2.http, a2.json.code];
    }
    fake.setServing(SERVING);
    checks.equal(seen, {
      noAdapter: [0, "LOCAL_SERVER_MISMATCH", 409, "LOCAL_SERVER_MISMATCH"], adapterOff: [0, "LOCAL_SERVER_MISMATCH", 409, "LOCAL_SERVER_MISMATCH"],
      otherScale: [0, "LOCAL_SERVER_MISMATCH", 409, "LOCAL_SERVER_MISMATCH"], extraAdapter: [0, "LOCAL_SERVER_MISMATCH", 409, "LOCAL_SERVER_MISMATCH"],
      otherContext: [0, "LOCAL_SERVER_MISMATCH", 409, "LOCAL_SERVER_MISMATCH"], otherModel: [0, "LOCAL_SERVER_MISMATCH", 409, "LOCAL_SERVER_MISMATCH"],
      cannotSay: [0, "LOCAL_SERVER_UNVERIFIED", 409, "LOCAL_SERVER_UNVERIFIED"] },
      "a process that is not the measured server offers no measured question, and an ask is refused before the model is called", seen);
    checks.equal(fake.chats().length, 0, "no refused ask reached the model");
    const a1 = await post(r, "/vlm-relay/ask", askBody());
    const sent = fake.chats()[0].body;
    checks.ok(a1.http === 200 && a1.json.ok && a1.json.value === "sofa" && a1.json.answered && !JSON.stringify(a1.json).includes("Ignore previous"),
      "an answer comes back as its closed value, without the model's words", a1.json);
    checks.ok(sent.messages.length === 1 && sent.messages[0].role === "user" && sent.messages[0].content[1].text === core.askText("identify")
      && sent.messages[0].content[0].image_url.url === "data:image/png;base64," + PNG448 && sent.temperature === 0 && sent.chat_template_kwargs.enable_thinking === false
      && sent.max_tokens === 48 && !("response_format" in sent),
      "the request is the benchmark's: the crop and the fixed question, no system text, thinking off", { roles: sent.messages.map((m) => m.role), keys: Object.keys(sent) });
    const refused = {
      unknownField: (await post(r, "/vlm-relay/ask", askBody({ note: "x" }))).json.code,
      freeText: (await post(r, "/vlm-relay/ask", askBody({ question: "describe the guests" }))).json.code,
      pieceMissing: (await post(r, "/vlm-relay/ask", askBody({ question: "serves" }))).json.code,
      pieceOnOther: (await post(r, "/vlm-relay/ask", askBody({ piece: "sofa" }))).json.code,
      tooBig: (await post(r, "/vlm-relay/ask", askBody({ image: { mediaType: "image/png", data: PNG448, width: 4000, height: 4000 } }))).json.code,
      guestInImage: (await post(r, "/vlm-relay/ask", askBody({ image: { mediaType: "image/png", data: PNG448, width: 448, height: 448, guest: "A. Yilmaz" } }))).json.code,
    };
    checks.equal(refused, { unknownField: "UNKNOWN_FIELD", freeText: "BAD_PAYLOAD", pieceMissing: "BAD_PAYLOAD", pieceOnOther: "BAD_PAYLOAD", tooBig: "BAD_PAYLOAD", guestInImage: "UNKNOWN_FIELD" },
      "the ask is a closed shape: no unknown field anywhere, no question the relay does not write, no oversized crop");
    checks.equal(fake.chats().length, 1, "nothing refused reached the local process");
    // the same crop and question again (a re-analysis of an unchanged place): the
    // answer the verified server gave is reused, the model is not asked twice
    const again = await post(r, "/vlm-relay/ask", askBody({ runId: "run_again0001" }));
    const otherQ = await post(r, "/vlm-relay/ask", askBody({ runId: "run_again0002", question: "merged" }));
    checks.ok(again.http === 200 && again.json.value === "sofa" && again.json.cached === true && fake.chats().length === 2 && otherQ.json.cached !== true,
      "an unchanged crop asked the same question is answered from the relay's cache (one model call for two asks); another question is asked", { again: again.json, chats: fake.chats().length });

    const nr = await relayWith({ VLM_LOCAL_URL: fake.baseURL, VLM_LOCAL_MANIFEST: noChecks });
    const notValidated = await post(nr, "/vlm-relay/ask", askBody());
    checks.equal([notValidated.http, notValidated.json.code, fake.chats().length], [409, "QUESTION_NOT_VALIDATED", 2], "a model with no measured question is asked nothing");
    const cloud = core.configFromEnv({ ANTHROPIC_API_KEY: "sk-ant-test-0000000000", VLM_DATA_DIR: path.join(tmp, "cloud"), PORT: "0" }, { repoRoot });
    const cr = await startRelay({ config: cloud, client: { models: {}, beta: { messages: {} } }, log }); opened.push(cr);
    const cloudAsk = await post(cr, "/vlm-relay/ask", askBody());
    checks.equal(cloudAsk.json.code, "ASK_LOCAL_ONLY", "a second look is never sent to a paid API");

    const capped = await relayWith({ VLM_LOCAL_URL: fake.baseURL, VLM_LOCAL_MANIFEST: withChecks, VLM_MAX_ASKS_PER_RUN: "2" });
    const caps = [];
    // three different questions (the same one again would be answered from the cache, which costs no model call)
    for (const q of ["identify", "merged", "chairs"]) caps.push((await post(capped, "/vlm-relay/ask", askBody({ runId: "run_cap00001", question: q }))).json.code || "ok");
    checks.equal(caps, ["ok", "ok", "ASK_LIMIT"], "the per-look question cap refuses before the process is called");

    const hang = await startFakeLocalVlm({ serving: SERVING, script: [{ hang: true }] }); fakes.push(hang);
    const hr = await relayWith({ VLM_LOCAL_URL: hang.baseURL, VLM_LOCAL_MANIFEST: withChecks });
    const pending = post(hr, "/vlm-relay/ask", askBody({ runId: "run_hang0002" }));
    const t0 = Date.now();
    while (hang.chats().length === 0 && Date.now() - t0 < 10000) await new Promise((res) => setTimeout(res, 25));
    const busy = await post(hr, "/vlm-relay/ask", askBody({ runId: "run_other001" }));
    const cancel = await post(hr, "/vlm-relay/cancel", { runId: "run_hang0002" });
    const hung = await pending;
    const after = await post(hr, "/vlm-relay/ask", askBody({ runId: "run_hang0002" }));
    checks.equal([busy.json.code, cancel.json.aborted, hung.json.code, after.json.code], ["BUSY", true, "CANCELLED", "CANCELLED"],
      "one request at a time; cancel aborts the question in flight and refuses the run's next one");
    checks.ok(!lines.some((l) => /data:image|base64|SOFA, clearly/.test(l)), "the relay's log holds no image and no model text", lines.filter((l) => /ask/.test(l)).slice(0, 4));

    // ---- the review screen ---------------------------------------------------------------
    // Answers by question: identify → "bench" twice for the first place and
    // disagreeing looks for the second; chairs → one more than drawn; merged
    // and serves → "no". Every request is recorded.
    let identifyN = 0;
    const pf = await startFakeLocalVlm({ serving: SERVING, fallback: (b) => {
      const q = b.messages[0].content[1].text;
      if (/single object/.test(q)) { identifyN++; return identifyN <= 2 ? "bench" : identifyN % 2 ? "table" : "column"; }
      if (/How many chairs/.test(q)) return "99";
      return "No.";
    } });
    fakes.push(pf);
    const planPng = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
    const openReview = async (relay) => {
      await openApp(page, relay.baseUrl, { lang: "en" });
      await createBlankEvent(page, { name: "Second look", date: futureDate() });
      await importPlan(page, planPng);
      await runDetection(page);
      await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = null; render(); });
      await page.waitForTimeout(300);
    };
    const pr = await relayWith({ VLM_LOCAL_URL: pf.baseURL, VLM_LOCAL_MANIFEST: noChecks });
    await openReview(pr);
    await page.waitForTimeout(800);
    checks.equal([await page.evaluate(() => state.events[0].analysis.vlm || null), pf.chats().length], [null, 0],
      "after an analysis, a local model with no measured question is asked nothing");
    await page.click('[data-vlm-action="toggle"]');
    await page.waitForSelector(".vlm-panel .vlm-state.ok");
    checks.equal(await page.locator('[data-vlm-action="look"]').count(), 0, "with no measured question the second-look button is not offered");

    // The owner's decision (2026-10-18): one press of Analyse; with a measured
    // local model the second look follows BY ITSELF — no question, no panel
    // popping open, nothing applied.
    const pr2 = await relayWith({ VLM_LOCAL_URL: pf.baseURL, VLM_LOCAL_MANIFEST: withChecks });
    await openReview(pr2);
    await page.waitForFunction(() => { const v = state.events[0].analysis.vlm; return v && v.mode === "check" && v.status !== "running"; }, null, { timeout: 120000 });
    const auto = await page.evaluate(() => ({ run: JSON.parse(JSON.stringify(state.events[0].analysis.vlm)), panel: !!ui.vlmPanelOpen,
      asked: !!document.querySelector("#meritAskTitle") && getComputedStyle(document.querySelector("#meritAskTitle").closest("dialog,[role=dialog],.ask-backdrop") || document.body).display !== "none" && !!document.querySelector("#meritAskTitle").offsetParent,
      decisions: state.audit.filter((x) => x.action === "REVIEW_DECISION" && x.eventId === state.events[0].id).length,
      started: state.audit.filter((x) => x.action === "VLM_SECOND_LOOK_STARTED").map((x) => x.detail) }));
    checks.ok(auto.run.auto === true && auto.run.status === "done" && !auto.panel && !auto.asked && auto.started.length === 1 && auto.started[0].auto === true,
      "after the analysis the second look ran by itself: no question asked, no panel forced open, and the audit says it started by itself", { auto: auto.run.auto, status: auto.run.status, panel: auto.panel, asked: auto.asked, started: auto.started });
    checks.ok(auto.decisions === 0 && auto.run.findings.every((fd) => fd.state === "open"), "it applied nothing: every finding waits for a person", { decisions: auto.decisions });
    checks.equal(pf.chats().length, auto.run.checks.length * 2, "it looked at each planned place twice and sent nothing more");
    await page.click('[data-vlm-action="toggle"]');
    await page.waitForSelector('.vlm-panel [data-vlm-action="auto"]');
    const autoPanel = await page.evaluate(() => document.querySelector(".vlm-panel").textContent);
    checks.ok(/Started by itself after the analysis/.test(autoPanel) && /Nothing left the computer and nothing was applied/.test(autoPanel),
      "the panel says the look started by itself, what was sent, and that nothing left the computer or was applied", autoPanel.slice(0, 300));

    const readingTitle = await page.evaluate(() => { const r = MeritPlanReading.read(state.events[0].analysis); const s = r.sections.find((x) => x.id === "second"); return s ? s.sentences.map((x) => x.key) : null; });
    checks.ok(readingTitle && readingTitle[0] === "read.second.summary", "after the look the plan reading carries its section", readingTitle);

    // A person decides one seating piece; a look started by hand asks first and never asks about it.
    const plan = await page.evaluate(() => {
      const ev = state.events[0], a = ev.analysis;
      const piece = a.candidates.find((c) => c.kind === "venue" && ["sofa", "bench", "banquette"].includes(c.type) && c.status === "unreviewed");
      if (piece) decideReview(ev, { kind: "confirm", candidateId: piece.id });
      const img = new Image(); img.src = ev.background.src;
      return new Promise((res) => img.decode().then(() => res({ decided: piece && piece.id,
        qs: MeritLocalCheck.plan(a, { checks: ["identify", "chairs", "merged", "serves"], width: img.naturalWidth, height: img.naturalHeight, max: 12 }).map((q) => ({ question: q.question, ids: q.candidateIds })) })));
    });
    checks.ok(plan.qs.length > 0 && !plan.qs.some((q) => plan.decided && q.ids.includes(plan.decided)),
      "on the real plan the look has places to ask about, and none is the piece a person just confirmed", plan);
    await page.evaluate(() => render());
    await page.waitForSelector('.vlm-panel [data-vlm-action="look"]');
    const guestsBefore = pf.chats().length;
    identifyN = 0;
    await page.click('[data-vlm-action="look"]');
    await page.waitForSelector("#meritAskTitle", { state: "visible" });
    const dialog = await page.evaluate(() => document.querySelector("#meritAskBody").textContent);
    checks.ok(/sent twice as a 448×448 px crop/.test(dialog) && /on this computer/.test(dialog) && /Not sent: guests/.test(dialog) && !/\$/.test(dialog) && pf.chats().length === guestsBefore,
      "started by hand, the look asks first: what travels (two crops per place, fixed questions), where (this computer), and nothing is sent before yes", dialog.slice(0, 300));
    await page.click('[data-ask="confirm"]');
    await page.waitForFunction(() => { const v = state.events[0].analysis.vlm; return v && v.mode === "check" && !v.auto && v.status !== "running"; }, null, { timeout: 120000 });
    const run = await page.evaluate(() => JSON.parse(JSON.stringify(state.events[0].analysis.vlm)));
    const reqs = pf.chats().slice(guestsBefore).map((c) => c.body);
    // the same plan was looked at by itself just before: a place whose crop and question are
    // unchanged is answered from the relay's cache, so the model is asked at most that often
    checks.equal([run.status, run.steps, reqs.length <= plan.qs.length * 2], ["done", plan.qs.length * 2, true], "every planned place was looked at twice, and nothing more was sent", { sent: reqs.length });
    checks.ok(reqs.every((b) => b.messages.length === 1 && /^This is a crop of an event venue floor plan/.test(b.messages[0].content[1].text)
      && /^data:image\/png;base64,/.test(b.messages[0].content[0].image_url.url)) && !reqs.some((b) => /Second look|guest/i.test(JSON.stringify(b))),
      "each request is one crop and one fixed question — no event name, no guest");
    const verdicts = run.checks.map((c) => c.verdict);
    const firstIdentify = run.checks.find((c) => c.question === "identify");
    checks.ok(verdicts.every(Boolean) && firstIdentify && firstIdentify.answers.join() === "bench,bench",
      "each place has a verdict from its two answers", run.checks.map((c) => [c.question, c.answers.join("/"), c.verdict]));
    const differs = run.checks.filter((c) => c.verdict === "DIFFERS").length;
    checks.equal(run.findings.length, differs, "exactly one finding per place where both looks agreed with each other and differed from the analysis");
    checks.ok(!run.checks.some((c) => c.verdict === "UNSURE") || run.findings.every((fd) => run.checks.find((c) => fd.id.endsWith("-check-" + c.id)).verdict === "DIFFERS"),
      "places whose looks disagreed made no finding");
    const panelText = await page.evaluate(() => document.querySelector(".vlm-panel").textContent);
    checks.ok(/place\(s\) looked at/.test(panelText) && /local second look/.test(panelText), "the panel tallies the look and labels its findings", panelText.slice(0, 400));

    // Accept a type suggestion: one object changes, through decideReview, and undoes.
    const typeF = run.findings.find((fd) => fd.kind === "wrongType" && fd.state === "open");
    if (typeF) {
      const before = await page.evaluate((id) => { const c = state.events[0].analysis.candidates.find((x) => x.id === id); return [c.type, c.status]; }, typeF.candidateId);
      await page.click(`[data-vlm-action="accept"][data-vlm-finding="${typeF.id}"]`);
      await page.waitForTimeout(200);
      const afterAccept = await page.evaluate(({ id, fid }) => { const a = state.events[0].analysis, c = a.candidates.find((x) => x.id === id), fd = a.vlm.findings.find((x) => x.id === fid);
        return [c.type, c.status, fd.state, a.candidates.filter((x) => x.type === c.type && x.status === "confirmed").length]; }, { id: typeF.candidateId, fid: typeF.id });
      await page.click(`[data-vlm-action="undo"][data-vlm-finding="${typeF.id}"]`);
      await page.waitForTimeout(200);
      const afterUndo = await page.evaluate((id) => { const c = state.events[0].analysis.candidates.find((x) => x.id === id); return [c.type, c.status]; }, typeF.candidateId);
      checks.ok(afterAccept[0] === typeF.type && afterAccept[1] === "confirmed" && afterAccept[2] === "accepted" && JSON.stringify(afterUndo) === JSON.stringify(before),
        "Accept applies the type to that one object and Undo puts it back", { before, afterAccept, afterUndo });
    } else checks.ok(true, "no type suggestion on this plan's places (the identify answers agreed or were unsure)");
    const notes = run.findings.filter((fd) => fd.kind === "note");
    if (notes.length) {
      const disabled = await page.evaluate((id) => document.querySelector(`[data-vlm-action="accept"][data-vlm-finding="${id}"]`).disabled, notes[0].id);
      checks.ok(disabled, "a note (a count, a grouping, a link) has nothing to apply: Accept is disabled with its reason");
    }
    await page.reload();
    // `state` is a top-level binding of a classic script, not a window property
    await page.waitForFunction(() => { try { return !!(state.events[0] && state.events[0].analysis); } catch { return false; } }, null, { timeout: 30000 });
    const persisted = await page.evaluate(() => { const v = state.events[0].analysis.vlm; return v && [v.mode, v.checks.length, v.findings.length]; });
    checks.equal(persisted, ["check", run.checks.length, run.findings.length], "the look and its findings survive a reload with the analysis they were made about");

    // The switch: off, and the next analysis is followed by nothing.
    await page.evaluate(() => { openEvent(state.events[0].id); ui.tab = "floor"; ui.planMode = "review"; render(); });
    await page.waitForTimeout(400);
    await page.click('[data-vlm-action="toggle"]');
    await page.waitForSelector('.vlm-panel [data-vlm-action="auto"]');
    await page.click('.vlm-panel [data-vlm-action="auto"]');
    const offStored = await page.evaluate(() => localStorage.getItem("merit.secondLook.auto"));
    const sentBefore = pf.chats().length;
    await reRunDetection(page);
    await page.waitForTimeout(1500);
    checks.equal([offStored, await page.evaluate(() => state.events[0].analysis.vlm || null), pf.chats().length - sentBefore], ["off", null, 0],
      "with the switch off (remembered on this computer) an analysis is followed by no look");

    // The model process restarted without its adapter: the switch is on, an
    // analysis finishes, and nothing is asked; the panel says why and offers
    // to check again.
    pf.setServing({ ...SERVING, loras: [] });
    await page.click('.vlm-panel [data-vlm-action="auto"]');
    const sentUnmeasured = pf.chats().length;
    await reRunDetection(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => render());
    const unmeasured = await page.evaluate(() => { const p = document.querySelector(".vlm-panel");
      return { vlm: state.events[0].analysis.vlm || null, lang: ui.lang, text: [...(p ? p.querySelectorAll(".vlm-note.warn") : [])].map((n) => n.textContent).join(" | "),
        look: !!document.querySelector('.vlm-panel [data-vlm-action="look"]'), probe: !!document.querySelector('.vlm-panel [data-vlm-action="probe"]') }; });
    checks.ok(unmeasured.vlm === null && pf.chats().length === sentUnmeasured && !unmeasured.look && unmeasured.probe
      && (unmeasured.lang === "tr" ? /ölçülen düzenle çalışmıyor/ : /not running the measured setup/).test(unmeasured.text),
      "a model process that is not the measured server gets no question: no look, no button, and the panel says why with a way to check again", { ...unmeasured, text: unmeasured.text.slice(0, 300) });
  } finally {
    for (const r of opened) await r.close();
    for (const fk of fakes) await fk.close().catch(() => null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
