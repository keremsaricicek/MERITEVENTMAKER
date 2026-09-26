// Two failures a symbolic plan caused, pinned where they can be seen quickly.
//
// Neither was caught by anything in this repo, for the same reason: both need
// OCR to be running. This sandbox has no network, so the normal build silently
// has no OCR and every benchmark number for ORNEK was measured on the no-OCR
// path — while the offline package, the one that actually ships Tesseract, was
// the broken one. A benchmark that cannot reach a code path cannot guard it.
//
//   1. Text suppression deleted the tables.
//      The rule "drop a candidate that is mostly covered by OCR text, unless
//      it has chairs at it" is sound on a plan that draws chairs. On a plan
//      whose tables are numbered circles, no table has chairs and every table
//      has a number printed inside it, so the exemption never applies and the
//      rule removed 117 of 132 tables.
//
//   2. The capacity rule has to survive OCR that cannot read punctuation.
//      ORNEK prints "SALON : 166 * 12 : 1992 PAX". Tesseract returned
//      "1166 * 12: 1992" on one run and "1166 * 121992" on the next: the
//      colon became a 1, and then vanished and fused two numbers. The parser
//      is not allowed to repair characters — that is how OCR output becomes
//      fiction — so the arithmetic and the drawing's own other figures decide
//      the reading, and where nothing corroborates, nothing is claimed.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "symbolic-plan-capacity",
  tags: ["intelligence"],
  timeout: 90000,
  viewport: { width: 1200, height: 800 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  // ---- 1. a numbered symbol is not printed text -----------------------------
  const suppress = (candidates, words) =>
    page.evaluate(({ c, w }) => {
      const r = globalThis.MeritSuppressTextFalsePositives(c, w, 1000, 1000);
      return { kept: r.kept.map((x) => x.id), removed: r.removedCount };
    }, { c: candidates, w: words });

  const present = await page.evaluate(() => typeof globalThis.MeritSuppressTextFalsePositives === "function");
  checks.require(present, "the text-suppression rule is reachable from the suite");

  // A word box sitting right across the object, which is what a printed table
  // number does, and what OCR of a photographed printout does even harder.
  const word = (x, y, w, h, text) => ({ text, bbox: { x0: x * 10, y0: y * 10, x1: (x + w) * 10, y1: (y + h) * 10 } });
  const box = (id, x, y, w, h, extra = {}) => ({ id, kind: "table", type: "round", x, y, w, h, chairDetections: [], ...extra });

  {
    // The case the rule is FOR: a candidate that is really just a word.
    const r = await suppress([box("caption", 10, 10, 6, 3)], [word(10, 10, 6, 3, "SYSTEM KONTROL")]);
    checks.equal(r.removed, 1, "a candidate that is entirely a word is still dropped");
    checks.equal(r.kept.length, 0, "and does not survive");
  }
  {
    // The case that broke: a table drawn as a numbered symbol. Same overlap,
    // no chairs — because this plan draws none — and it must survive.
    const r = await suppress([box("symbol", 10, 10, 6, 6, { symbolFamily: true })], [word(10, 10, 6, 6, "137")]);
    checks.equal(r.removed, 0, "a member of the plan's symbol family is not deleted as text");
    checks.equal(r.kept.length, 1, "it survives with the number printed across it");
  }
  {
    // Without the family flag the same geometry is still dropped, so the
    // exemption is doing real work and is not a blanket disabling of the rule.
    const r = await suppress([box("plain", 10, 10, 6, 6)], [word(10, 10, 6, 6, "137")]);
    checks.equal(r.removed, 1, "an unflagged candidate under the same word is still dropped");
  }
  {
    // A table that does have chairs keeps its original exemption.
    const withChairs = box("seated", 10, 10, 6, 6);
    withChairs.chairDetections = [{ id: "c1" }];
    const r = await suppress([withChairs], [word(10, 10, 6, 6, "12")]);
    checks.equal(r.removed, 0, "a table with chairs at it keeps the exemption it always had");
  }

  // ---- 2. the printed capacity rule, through real OCR noise -----------------
  //
  // Driven through buildPlanIntelligence rather than a private parser, so what
  // is pinned is what an operator would actually be shown.
  const facts = (ocrText, tables) =>
    page.evaluate(({ txt, n }) => {
      const candidates = [];
      for (let i = 0; i < n; i++)
        candidates.push({ id: `t${i}`, kind: "table", type: "round", status: "unreviewed",
          x: 5 + (i % 10) * 8, y: 5 + Math.floor(i / 10) * 8, w: 4, h: 4,
          chairDetections: [], seatsUnknown: true, symbolFamily: true });
      const event = {
        id: "e", background: { src: "" },
        analysis: {
          candidates, ocrText: txt,
          diagnostics: { representation: { kind: "SYMBOLIC", associationRate: 0.07, evidence: {} } },
        },
      };
      const pi = globalThis.buildPlanIntelligence(event, txt);
      return {
        facts: (pi.facts || []).map((f) => ({ key: f.key, strength: f.strength, params: f.params })),
        rule: (pi.capacityAudit || {}).rule || null,
      };
    }, { txt: ocrText, n: tables });

  // Both readings Tesseract actually returned for this line, on consecutive
  // runs over the same image.
  const OCR_RUNS = {
    "colon read as a 1": "servant SILA 29.08.2026\nSALON 1166 * 12: 1992 PAX\nLOCALAR  :72 pax\nTOPLAM : 2064 pax",
    "colon lost entirely": "Be ©) SALON 1166 * 121992 PAX GD\nfe LOCALAR  :72 pax\nka İTOPLAM : 2064 pax",
  };
  for (const [name, text] of Object.entries(OCR_RUNS)) {
    const r = await facts(text, 132);
    checks.ok(!!r.rule, `${name}: a capacity rule is still read`, r.rule);
    if (!r.rule) continue;
    checks.equal(r.rule.units, 166, `${name}: 166 tables`);
    checks.equal(r.rule.perUnit, 12, `${name}: 12 pax at each`);
    checks.equal(r.rule.total, 1992, `${name}: 1992 seats`);
    checks.equal(r.rule.unitsSource, "derived", `${name}: the count is derived, not the misread token`);
    checks.ok(r.rule.unitsAsRead === 1166, `${name}: and what OCR actually read is kept beside it`, r.rule.unitsAsRead);

    const vs = r.facts.find((f) => f.key === "fact.tablesVsStated");
    checks.ok(!!vs, `${name}: the drawing's own count is compared against what was found`, r.facts.map((f) => f.key));
    if (vs) {
      checks.equal(vs.params.stated, 166, `${name}: stated 166`);
      checks.equal(vs.params.found, 132, `${name}: found 132`);
      checks.equal(vs.params.difference, 34, `${name}: 34 unaccounted for`);
    }
    // The seat-count comparison must NOT appear: there are no seats to count.
    checks.ok(!r.facts.some((f) => f.key === "fact.capacityDiffers" || f.key === "fact.capacityAgrees"),
      `${name}: no claim comparing a printed pax figure against a seat count`,
      r.facts.map((f) => f.key));
    checks.ok(!r.facts.some((f) => f.key === "fact.seats"),
      `${name}: and no "0 seats detected" on a plan that draws none`);
  }

  // ---- nothing to corroborate means nothing is claimed ----------------------
  {
    // The same mangled line with no totals printed anywhere to check it
    // against. Some split of "121992" always divides; without corroboration
    // the parser must refuse rather than pick one.
    const r = await facts("SALON 1166 * 121992 PAX", 40);
    checks.ok(!r.rule, "with nothing on the page to corroborate it, no rule is claimed", r.rule);
  }
  {
    const r = await facts("the room holds 12 * 7 tables and about 900 chairs", 40);
    checks.ok(!r.rule, "and a multiplication that is not a capacity rule is not read as one", r.rule);
  }
}
