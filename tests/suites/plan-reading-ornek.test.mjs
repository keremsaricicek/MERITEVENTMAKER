// The plan reading on ORNEK — the real symbolic concert plan, real detection,
// real OCR (src/plan-reading.js on the analysis the app produces).
//
// What this pins, on a plan nobody drew for the product:
//   THE SHEET'S OWN WORDS ARE READ AS WHAT THEY ARE: its title and date, the
//     venue it names, the printed capacity rule, the total, the boxes' share;
//     the service points and the technical desk it only writes; the box list
//     printed beside the drawing as a legend, not as the boxes.
//   WHAT IT DOES NOT NAME STAYS A QUESTION: the T-shaped block in the middle
//     is offered as a possible stage, unsure — the sheet never says "stage".
//   NOTHING IS INVENTED: no merged tables (round symbols are not pushed
//     together), unread numbers are counted as open, never guessed.
// The checks name the categories, not this plan's strings, where they can:
// the title and venue are compared with what OCR read on the same run.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "plan-reading-ornek", tags: ["intelligence", "slow"], timeout: 400000, viewport: { width: 1920, height: 1080 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "ORNEK", date: futureDate() });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/ornek-upright.png")).toString("base64"));
  await runDetection(page, { timeout: 300000 });
  const r = await page.evaluate(() => {
    const a = state.events[0].analysis, x = MeritPlanReading.read(a);
    const all = [...x.headline, ...x.sections.flatMap((s) => s.sentences)];
    return { all: all.map((s) => ({ key: s.key, params: s.params, certainty: s.certainty, refs: s.refs.length, boxes: s.boxes.length })),
      texts: x.texts.map((t) => ({ text: t.text, category: t.category, used: t.used.key })), ocrAvailable: !!(a.ocrModel && a.ocrModel.available) };
  });
  checks.require(r.ocrAvailable, "the OCR model ran on this plan (the reading is measured WITH the plan's words)");
  const s = (k) => r.all.find((x) => x.key === k);
  const ev = s("read.headline.event");
  checks.ok(!!ev && /\d{1,2}\.\d{1,2}\.\d{4}/.test(ev.params.line) && / · .*Salon/i.test(ev.params.line) && ev.certainty === "stated" && ev.boxes >= 1,
    "the first line is the event as the sheet prints it: a title, a date and the venue it names", ev);
  const rule = s("read.capacity.rule"), total = s("read.capacity.stated"), perLoca = s("read.capacity.perLoca");
  checks.ok(rule && rule.params.units === 166 && rule.params.perUnit === 12 && rule.params.seats === 1992 && total && total.params.total === 2064 && total.certainty === "stated",
    "the printed rule (166 × 12 = 1992) and the printed total (2064) are read as the sheet's own statements", { rule, total });
  checks.ok(perLoca && perLoca.params.total === 72 && perLoca.params.locas === 12 && perLoca.params.per === 6 && perLoca.certainty === "inferred",
    "72 people printed for the boxes over 12 boxes found is 6 per box — worked out, and said so", perLoca);
  const maybe = s("read.stage.maybe");
  checks.ok(!!maybe && maybe.certainty === "unsure" && maybe.refs === 1 && !s("read.stage.where"), "the unnamed T-shaped block is a POSSIBLE stage, never a stage", maybe);
  const service = s("read.room.service"), technical = s("read.room.technical");
  checks.ok(service && service.params.n === 4 && service.certainty === "stated" && technical && /kontrol/i.test(technical.params.words.join(" ")),
    "the four service points and the technical desk the sheet only writes are read as places written on the plan", { service, technical });
  const legend = r.texts.filter((t) => t.category === "loca" && t.used === "read.used.legend").length;
  checks.ok(legend >= 10, "the box list printed beside the drawing is a legend, not the boxes", legend);
  checks.ok(!s("read.tables.mergedSummary") && !!s("read.tables.symbolsApart"), "no round symbols are joined into one table");
  const open = s("read.numbers.open"), numbers = s("read.numbers.summary");
  checks.ok(numbers && numbers.params.verified >= 140 && open && open.certainty === "unsure" && numbers.params.verified + open.params.n === numbers.params.tables,
    "read numbers and open numbers add up to the tables found; the open ones are asked, not guessed", { numbers, open });
}
