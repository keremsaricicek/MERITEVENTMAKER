// A second opinion that is allowed to be wrong, and never allowed to delete.
//
// The learned encoder now answers a question the classical pipeline never
// asks: does this crop LOOK like the things we already believe are real? That
// is genuinely new evidence, and it is also the most dangerous kind of feature
// to ship carelessly, for three reasons this suite pins down:
//
//   1. It must not become a filter. Every suppression rule built on this
//      channel was simulated against ground truth first
//      (benchmarks/embedding/measure-separation.mjs) and every one of them
//      also removed REAL tables on at least one rendering. So the shipped
//      contract is evidence-only, and "evidence-only" has to be enforced by a
//      test, not by a comment that a later change can quietly outgrow.
//
//   2. It must not grade its own homework. On a plan where nobody has
//      confirmed anything, the reference library is built from the detector's
//      own candidates. If a candidate could match ITSELF, every object would
//      score 1.000 and the feature would be a machine agreeing with itself.
//
//   3. It must not turn a similarity into a probability. Cosine distance
//      against this plan's own objects is a visual match strength. Rendering
//      it as "97% certain" would be a fabricated confidence number, which is
//      exactly what .claude/rules/ai.md forbids.
//
// The first half runs against synthetic vectors so the reasoning is checked
// exactly, with no dependence on what the detector happens to find. The second
// half runs a real detection on the real plan and checks what the shipped
// build actually wrote.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = {
  name: "visual-second-opinion",
  // Deliberately NOT slow-tagged. It runs one real detection and finishes in
  // seconds, and "the visual channel must never delete anything" is a contract
  // that has to be guarded on every `npm test`, not only on --all.
  tags: ["intelligence"],
  timeout: 180000,
  viewport: { width: 1800, height: 1000 },
};

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl);

  checks.require(await page.evaluate(() => typeof globalThis.MeritVisualSecondOpinion?.build === "function"),
    "the visual second opinion module is loaded in the browser");

  // ---- part one: the reasoning, on vectors we control ----------------------
  const logic = await page.evaluate(() => {
    const API = globalThis.MeritVisualSecondOpinion;
    // Unit vectors in a tiny space, so "nearest" is decidable by hand.
    const v = (a, b, c) => { const n = Math.hypot(a, b, c) || 1; return [a / n, b / n, c / n]; };
    const ref = (id, cls, tier, vec) => ({ id, cls, tier, vector: vec });

    // Three tables clustered on x, three chairs clustered on y. Deliberately
    // spread WITHIN each cluster: if the references sat on top of each other,
    // excluding a reference from its own comparison would be invisible,
    // because its neighbour would answer 1.000 in its place.
    const refs = [
      ref("t1", "table", "provisional", v(1, 0, 0)),
      ref("t2", "table", "provisional", v(0.9, 0.3, 0)),
      ref("t3", "table", "provisional", v(0.9, 0, 0.3)),
      ref("c1", "venue:chair", "provisional", v(0, 1, 0)),
      ref("c2", "venue:chair", "provisional", v(0.3, 0.9, 0)),
      ref("c3", "venue:chair", "provisional", v(0, 0.9, 0.3)),
      // A class with too few examples to be a library.
      ref("s1", "venue:stage", "provisional", v(0, 0, 1)),
      ref("s2", "venue:stage", "provisional", v(0.02, 0, 1)),
      // A tier nobody defined must be ignored rather than trusted.
      ref("x1", "table", "made-up-tier", v(1, 0, 0)),
    ];
    const lib = API.build(refs);

    // Self-exclusion: assess a reference AS a candidate, by its own id.
    const selfExcluded = lib.assess(refs[0].vector, "table", [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1, 1], "t1");
    const notExcluded = lib.assess(refs[0].vector, "table", [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1, 1], null);

    // A table-shaped candidate that actually points along the chair axis.
    const items = [
      { id: "q1", cvClass: "table", vector: v(1, 0.07, 0) },     // really a table
      { id: "q2", cvClass: "table", vector: v(0.06, 1, 0) },     // looks like a chair
      { id: "q3", cvClass: "table", vector: v(0.7, 0.7, 0.1) },  // between the two
      { id: "q4", cvClass: "table", vector: v(1, 0.06, 0) },
      { id: "q5", cvClass: "table", vector: v(1, 0.09, 0) },
      { id: "q6", cvClass: "table", vector: v(0.99, 0.02, 0) },
      { id: "q7", cvClass: "table", vector: v(0.97, 0.15, 0) },
      { id: "q8", cvClass: "table", vector: v(0.95, 0.2, 0.1) },
      // Matches nothing well, and what it matches least badly is a chair —
      // the case the old strength gate silently swallowed.
      { id: "q9", cvClass: "table", vector: v(0.2, 0.5, 0.84) },
    ];
    const many = lib.assessMany(items);

    // Too few items to have a distribution at all.
    const tiny = API.build(refs).assessMany([items[0], items[1]]);

    // A library with a verified reference reports the better tier.
    const withVerified = API.build(refs.concat([ref("t4", "table", "verified", v(1, 0.04, 0))]));

    return {
      classes: lib.classes.slice().sort(),
      referenceCount: lib.referenceCount,
      tiers: lib.tiers,
      bestTier: lib.bestTier,
      bestTierWithVerified: withVerified.bestTier,
      selfExcluded, notExcluded,
      many, weakDisagree: many[8], tinyStrengths: tiny.map(a => a && a.strength),
      keys: Object.keys(many.find(Boolean) || {}).sort(),
    };
  });

  checks.equal(logic.classes.join(","), "table,venue:chair",
    "a class with fewer than three references is not a reference library and is dropped",
    { got: logic.classes, dropped: "venue:stage (2 examples)" });
  checks.ok(!("made-up-tier" in (logic.tiers || {})),
    "a reference carrying an unrecognised tier is ignored, not trusted", logic.tiers);
  checks.equal(logic.referenceCount, 6, "only the usable references are counted", logic.referenceCount);
  checks.equal(logic.bestTier, "provisional",
    "with no human decisions the library reports the provisional tier, not a better one", logic.bestTier);
  checks.equal(logic.bestTierWithVerified, "verified",
    "one confirmed object is enough to raise the reported tier", logic.bestTierWithVerified);

  checks.ok(logic.notExcluded.similarity > 0.999,
    "sanity: without self-exclusion a reference matches itself perfectly", logic.notExcluded);
  checks.ok(logic.selfExcluded.similarity < 0.999,
    "a candidate is never compared against itself — the detector cannot grade its own homework",
    logic.selfExcluded);

  const [q1, q2, q3] = logic.many;
  checks.equal(q1.nearestClass, "table",
    "a table-like crop matches the table references", q1);
  checks.equal(q1.agreement, "agree",
    "and that is reported as agreement with the classical pipeline", q1);
  checks.equal(q2.nearestClass, "venue:chair",
    "a chair-like crop the detector called a table matches the chair references", q2);
  checks.equal(q2.agreement, "disagree",
    "and that is reported as a disagreement, which is the whole point of a second opinion", q2);
  checks.ok(["strong", "moderate", "weak", "unknown"].includes(q3.strength),
    "a crop between the two classes still gets a strength, and is allowed to be weak", q3);
  // The two axes are independent, the way planning status and arrival status
  // are. Gating one behind the other threw away the useful half.
  checks.ok(logic.many.every(a => ["agree", "disagree"].includes(a.agreement)),
    "agreement is a class comparison and is reported at every strength, never suppressed by it",
    logic.many.map(a => `${a.strength}/${a.agreement}`));
  checks.ok(logic.weakDisagree && logic.weakDisagree.agreement === "disagree"
    && (logic.weakDisagree.strength === "weak" || logic.weakDisagree.strength === "unknown"),
    "a poor match in the wrong class reports BOTH facts, not just the poor match",
    logic.weakDisagree);

  checks.ok(logic.tinyStrengths.every(s => s === "unknown"),
    "with too few items to form a distribution the strength is `unknown`, not a confident-looking grade",
    logic.tinyStrengths);

  // §15: a similarity is a visual match strength, never a probability.
  checks.ok(!logic.keys.some(k => /probab|percent|certain/i.test(k)),
    "the answer carries no field claiming a probability or a certainty", logic.keys);
  checks.ok(logic.many.every(a => ["strong", "moderate", "weak", "unknown"].includes(a.strength)),
    "strength is one of four words, not a number dressed as one",
    logic.many.map(a => a.strength));

  // ---- part two: what the shipped build writes on a real plan --------------
  const plan = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  checks.require(fs.existsSync(plan), "the real venue plan fixture is present", plan);

  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Second opinion", hotel: "Merit", date: "2026-10-02" });
  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, "data:image/png;base64," + fs.readFileSync(plan).toString("base64"));
  await page.waitForTimeout(500);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(800);

  const shipped = await page.evaluate(() => {
    const a = state.events[0].analysis;
    const so = a.diagnostics?.embedding?.secondOpinion || null;
    const cands = a.candidates;
    const graded = cands.filter(c => c.visualEvidence);
    return {
      secondOpinion: so,
      candidates: cands.length,
      graded: graded.length,
      // Nothing may be rejected or deselected by the visual channel: a fresh
      // analysis has made no decisions.
      rejected: cands.filter(c => c.status === "rejected").length,
      missingTier: graded.filter(c => !c.visualEvidence.nearestTier).length,
      badStrength: graded.filter(c => !["strong", "moderate", "weak", "unknown"].includes(c.visualEvidence.strength)).length,
      badAgreement: graded.filter(c => !["agree", "disagree"].includes(c.visualEvidence.agreement)).length,
      outOfRange: graded.filter(c => !(c.visualEvidence.similarity >= -1.001 && c.visualEvidence.similarity <= 1.001)).length,
      selfMatched: graded.filter(c => c.visualEvidence.similarity > 0.9999).length,
      // The seat vectors that back the chair references must not be persisted
      // onto the stored objects: they are recomputed on every analysis and
      // would otherwise cost real storage in every saved event.
      seatsCarryingVectors: cands.reduce((n, c) =>
        n + (c.chairDetections || []).filter(ch => ch.visualDescriptor || ch.vector).length, 0),
      trainedModel: a.trainedModel,
    };
  });

  checks.require(shipped.secondOpinion, "the analysis reports what the second opinion did",
    shipped.secondOpinion);
  checks.ok(shipped.secondOpinion.available,
    "on the real plan it finds enough trusted references to have an opinion", shipped.secondOpinion);
  checks.equal(shipped.secondOpinion.role, "evidence-only",
    "the channel declares itself evidence-only", shipped.secondOpinion.role);
  checks.equal(shipped.secondOpinion.suppresses, false,
    "and declares that it suppresses nothing — measured, not assumed: every simulated "
    + "suppression rule also removed real tables (benchmarks/embedding/separation.json)",
    shipped.secondOpinion.suppresses);
  checks.equal(shipped.rejected, 0,
    "a fresh analysis rejects nothing: the visual opinion never deletes a candidate", shipped.rejected);
  checks.ok(shipped.graded > 20,
    "most candidates actually receive an opinion rather than the feature silently no-opping",
    { graded: shipped.graded, candidates: shipped.candidates });
  checks.equal(shipped.missingTier, 0,
    "every opinion carries the tier it was drawn from — 'compared against what' travels with the answer",
    shipped.missingTier);
  checks.equal(shipped.badStrength + shipped.badAgreement + shipped.outOfRange, 0,
    "every opinion is well-formed", shipped);
  checks.equal(shipped.selfMatched, 0,
    "no candidate matched itself, on the real plan too", shipped.selfMatched);
  checks.equal(shipped.seatsCarryingVectors, 0,
    "seat vectors back the chair references but are not persisted onto stored objects",
    shipped.seatsCarryingVectors);
  checks.equal(shipped.trainedModel, false,
    "a learned encoder giving a second opinion is still not a trained domain model",
    shipped.trainedModel);

  // ---- part three: what the operator reads ---------------------------------
  const card = await page.evaluate(() => {
    const a = state.events[0].analysis;
    const c = a.candidates.find(x => x.visualEvidence);
    const out = { id: c ? c.id : null, en: null, tr: null };
    if (!c) return out;
    const was = ui.lang;
    for (const lang of ["en", "tr"]) {
      ui.lang = lang;
      ui.selectedCandidateId = c.id;
      ui.reviewDrawMode = false;
      render();
      const node = document.querySelector(".poi-card .poi-visual-note");
      out[lang] = node ? node.innerText.replace(/\s+/g, " ").trim() : null;
    }
    ui.lang = was;
    render();
    return out;
  });

  checks.require(card.id, "a candidate with an opinion exists to select");
  for (const lang of ["en", "tr"]) {
    checks.ok(card[lang], `the review card shows the visual check in ${lang.toUpperCase()}`, card[lang]);
    checks.ok(!/visual\.|\{[a-z]+\}/i.test(card[lang] || ""),
      `no raw key or unfilled placeholder reaches the operator in ${lang.toUpperCase()}`, card[lang]);
    checks.ok(!/\d+\s*%/.test(card[lang] || ""),
      `no percentage is shown in ${lang.toUpperCase()} — a similarity is not a probability`, card[lang]);
  }
  checks.ok(/plan/i.test(card.en) && /plan/i.test(card.tr),
    "the sentence says what it was compared against, in both languages",
    { en: card.en, tr: card.tr });
}
