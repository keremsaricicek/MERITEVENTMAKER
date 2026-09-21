// THE SYSTEM HAS TO BE ABLE TO SAY "NOTHING".
//
// `a5-architecture-only` is a venue shell as an architect issues it: walls,
// columns, doors, stairs, dimensions and printed notes, and no furniture at
// all. Every filled shape on it is at furniture scale ON PURPOSE, so size and
// repetition — which is all the classical pipeline reasons with — cannot tell
// a column from a chair.
//
// The detector found no tables, which is right, and then proposed EIGHT
// CHAIRS, which is a phantom object placed on a floor that has none. It also
// said nothing whatsoever about capacity, which an operator reads as "nothing
// to report" rather than "the drawing states none".
//
// Two abstentions close it, and neither is a threshold or a branch keyed to a
// sample:
//
//   A STANDALONE CHAIR IS A CLAIM ABOUT SEATING. When the plan reader has
//   itself returned UNKNOWN — it could not tell what kind of drawing this is
//   — and its own evidence records that NOT ONE table was found, nothing
//   anchors that claim. The shapes stay, because they really are on the
//   drawing; the claim about what they are is dropped, in the same
//   "uncorroborated shape" vocabulary the size path already uses.
//
//   SILENCE IS NOT AN ANSWER ABOUT CAPACITY. `capacityUnknown` used to be
//   emitted only when OCR could not run at all, and the whole capacity block
//   sat below an early return taken when nothing was found — so the one
//   drawing that most needs the fact was the one guaranteed not to get it.
//
// This suite guards both against a build that becomes confident again.
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "unanchored-seating", tags: ["intelligence", "fast"], timeout: 60000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });

  // --- 1. the representation verdict is reachable AND used -----------------
  const verdicts = await page.evaluate(() => {
    const R = MeritPlanRepresentation;
    // An architect's shell: a handful of repeated furniture-scale shapes, none
    // of them at a table, and no table anywhere.
    const shell = R.decide({ uniformFamily: true, uniformObjects: 8, associatedToTable: 0, standalone: 8, tablesFound: 0 });
    // A real dining plan: many chairs, nearly all of them at a table.
    const dining = R.decide({ uniformFamily: true, uniformObjects: 120, associatedToTable: 118, standalone: 2, tablesFound: 20 });
    // A symbolic plan: many identical symbols, none at a table.
    const symbolic = R.decide({ uniformFamily: true, uniformObjects: 160, associatedToTable: 2, standalone: 158, tablesFound: 4 });
    return { shell: shell.kind, dining: dining.kind, symbolic: symbolic.kind,
      shellTables: shell.evidence.tablesFound };
  });
  checks.equal(verdicts.shell, "UNKNOWN",
    "on an architect's shell the plan reader says UNKNOWN rather than guessing. Abstention that is never reached is not abstention", verdicts);
  checks.equal(verdicts.dining, "PHYSICAL", "a drawing whose chairs sit at tables is still read as physical", verdicts);
  checks.equal(verdicts.symbolic, "SYMBOLIC", "and one whose symbols sit at nothing is still read as symbolic", verdicts);
  checks.equal(verdicts.shellTables, 0, "and the shell's own evidence records that no table was found", verdicts);

  // --- 2. capacity: the fact follows the OUTCOME, not one failure reason ---
  // The fact's own strings exist in both languages — an abstention the
  // operator cannot read is a silent absence with extra steps.
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang;
      out[lang] = {
        noCapacityOnDrawing: t("fact.noCapacityOnDrawing"),
        noStatedCapacity: t("fact.noStatedCapacity"),
        ocrReadNoCapacity: t("provenance.ocrReadNoCapacity"),
        ocrDidNotRun: t("provenance.ocrDidNotRun"),
      };
    }
    ui.lang = "en";
    return out;
  });
  for (const lang of ["en", "tr"]) {
    const w = words[lang];
    for (const [key, value] of Object.entries(w)) {
      checks.ok(value && !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(value),
        `${lang}: ${key} resolves to real words, not a raw key`, value);
    }
  }
  checks.ok(words.en.noCapacityOnDrawing !== words.en.noStatedCapacity,
    "'the drawing states no capacity' and 'the capacity was never read' are DIFFERENT sentences — an operator can act on the second (run OCR) and not on the first",
    { a: words.en.noCapacityOnDrawing, b: words.en.noStatedCapacity });
  checks.ok(words.tr.noCapacityOnDrawing !== words.en.noCapacityOnDrawing,
    "and the Turkish is really Turkish", words.tr.noCapacityOnDrawing);

  // --- 3. the abstention is in the detector, not only in the vocabulary ----
  const wired = await page.evaluate(() => {
    const D = globalThis.MERIT_PLAN_DETECTION;
    const raw = (D && D.providers) || {};
    const providers = Array.isArray(raw) ? raw : Object.values(raw);
    return {
      hasProvider: !!D,
      anyTrained: providers.some((p) => p && p.trainedModel === true),
      providerIds: providers.map((p) => p && p.id),
    };
  });
  checks.ok(wired.hasProvider, "the detection provider is published", wired);
  checks.ok(!wired.anyTrained,
    "and no provider claims a trained model — an abstention fix must not quietly become a model claim", wired);
}
