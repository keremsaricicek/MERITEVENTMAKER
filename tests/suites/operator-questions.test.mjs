// What the product asks a person, and whether it ever asks the same thing twice.
//
// The sprint's operator phase names "unnecessary or repeated questions" as
// something to measure. Consolidation already handles the crude case: an
// earlier sprint took the Golden Plan from thirteen questions to five by
// asking once per repeated ARRANGEMENT rather than once per group.
//
// What it did not handle is subtler and only visible when the questions are
// read together. Two arrangements that differ only in the KIND of table
// produced the identical sentence:
//
//   "Do these 2 connected tables operate as one seating group?"   (2 square)
//   "Do these 2 connected tables operate as one seating group?"   (2 bistro)
//
// The product knew they were different questions. The person reading them
// could not, and had no way to tell which answer belonged to which. Measured
// on the real plan through the offline build: 1 of 5 questions repeated
// another's exact wording before this, 0 of 5 after.
//
// The rule: TWO QUESTIONS THAT ARE ABOUT DIFFERENT THINGS MUST NOT READ THE
// SAME. Checking it needs several questions rendered together, which is why
// reviewing one string at a time never caught it.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "operator-questions",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

// The five arrangements the Golden Plan actually produces, plus ORNEK's one.
const REAL = [
  { arrangement: "3:square+square+square", coversGroups: 8, questionParams: { memberCount: 3 } },
  { arrangement: "4:square+square+square+square", coversGroups: 2, questionParams: { memberCount: 4 } },
  { arrangement: "2:square+square", coversGroups: 1, questionParams: { memberCount: 2 } },
  { arrangement: "4:rectangle+square+square+square", coversGroups: 1, questionParams: { memberCount: 4 } },
  { arrangement: "2:bistro+bistro", coversGroups: 1, questionParams: { memberCount: 2 } },
  { arrangement: "2:round+round", coversGroups: 1, questionParams: { memberCount: 2 } },
].map((q, i) => ({ id: `q${i}`, questionType: "combinedDiningGroup", ...q }));

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const present = await page.evaluate(() => typeof globalThis.MeritOperatorQuestions === "object");
  checks.require(present, "the question wording is reachable from the suite");

  const render = (qs, lang) => page.evaluate(([list, l]) => {
    const was = ui.lang; if (l) ui.lang = l;
    const out = list.map((q) => globalThis.MeritOperatorQuestions.questionText(q));
    ui.lang = was;
    return out;
  }, [qs, lang || null]);

  for (const lang of ["en", "tr"]) {
    const lines = await render(REAL, lang);
    const unique = new Set(lines);
    checks.equal(unique.size, REAL.length,
      `in ${lang}, six arrangements produce six different sentences`, lines);
    checks.ok(lines.every((l) => l && l.length > 10), `and none of them is empty in ${lang}`, lines);
  }

  {
    // The exact pair that used to collide.
    const [square, bistro] = await render([REAL[2], REAL[4]]);
    checks.ok(square !== bistro,
      "two connected tables of one kind and two of another are not the same question", [square, bistro]);
    checks.ok(/Square/.test(square), "the kind is what tells them apart", square);
    checks.ok(/Bistro/.test(bistro), "for both of them", bistro);
  }
  {
    const [mixed] = await render([REAL[3]]);
    checks.ok(/mixed kinds/.test(mixed),
      "an arrangement of several kinds says so rather than naming one of them", mixed);
  }
  {
    // A question standing for eight identical arrangements must still say so —
    // the kind is added to that sentence, not instead of it.
    const [repeated] = await render([REAL[0]]);
    checks.ok(/appears 8 times/.test(repeated),
      "a consolidated question still says how many arrangements it stands for", repeated);
    checks.ok(/Square/.test(repeated), "and which kind they are", repeated);
  }
  {
    // An analysis stored before arrangements were recorded keeps its original
    // wording rather than rendering "(undefined)".
    const [old] = await render([{ id: "old", questionType: "combinedDiningGroup",
      coversGroups: 1, questionParams: { memberCount: 2 } }]);
    checks.ok(!/undefined|\(\)/.test(old),
      "a question with no recorded arrangement degrades to the plain wording", old);
    checks.ok(/2 connected tables/.test(old), "which is still a readable question", old);
  }
  {
    const label = await page.evaluate(() =>
      globalThis.MeritOperatorQuestions.arrangementTypeLabel("not-an-arrangement"));
    checks.equal(label, null, "an unparseable arrangement names no kind rather than inventing one");
  }
}
