// The local second look on zones and table numbers (src/plan-zone-number-check.js).
//
// Guards the rules, never how well any model answers: only measured questions are
// planned; a place a person decided is never asked; two looks that disagree say
// nothing; "seating"/"none" never create a zone; a zone is an OPEN suggestion a person
// accepts; a number answer never carries a value that could be written into a table
// (a dispute only marks the OCR reading CHECK); the answer parser and the crop rule are
// the benchmark's and the generator's (one source).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const meta = { name: "zone-number-check", tags: ["plan-intelligence", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  const ctx = vm.createContext({});
  const file = path.join(repoRoot, "src", "plan-zone-number-check.js");
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  const Z = ctx.MeritZoneNumberCheck;
  checks.require(!!Z && typeof Z.plan === "function" && typeof Z.judge === "function" && typeof Z.findingFor === "function",
    "MeritZoneNumberCheck loads outside the browser");

  // one source for the words and the questions
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, "server/local-check-questions.json"), "utf8"));
  checks.equal([...Z.ZONE_WORDS].join(), spec.zoneWords.join(), "the zone words are the question spec's");
  checks.ok(typeof spec.questions.zone === "string" && typeof spec.questions.number === "string", "the spec carries the zone and number questions");
  const gen = fs.readFileSync(path.join(repoRoot, "training/synth_styles.py"), "utf8");
  checks.ok(/1\.3 \* max\(z\["w"\], z\["h"\]\), 0\.2 \* S/.test(gen) && /2\.4 \* max\(o\["w"\], o\["h"\]\), 56/.test(gen),
    "the crop rule is the one the training crops were cut by");

  const W = 2000, H = 1000;
  const places = [
    { id: "v1", box: { x: 10, y: 5, w: 30, h: 15 }, current: "stage" },
    { id: "v2", box: { x: 60, y: 60, w: 10, h: 10 }, current: null },
    { id: "v3", box: { x: 80, y: 10, w: 5, h: 5 }, current: "bar", decided: true },
  ];
  const tables = [
    { id: "t1", box: { x: 40, y: 40, w: 3, h: 6 }, printed: { state: "VERIFIED", value: 41 } },
    { id: "t2", box: { x: 50, y: 40, w: 3, h: 6 }, printed: null },
  ];
  checks.equal(Z.plan({ places, tables, W, H, validated: [] }).length, 0, "no measured question: nothing is planned");
  checks.equal(Z.plan({ places, tables, W, H, validated: ["merged"] }).length, 0, "other questions plan nothing here");
  const qs = Z.plan({ places, tables, W, H, validated: ["zone", "number"] });
  checks.equal(qs.length, 4, "two undecided places and two tables are planned", qs.map(q => q.question + ":" + (q.placeId || q.tableId)));
  checks.ok(!qs.some(q => q.placeId === "v3"), "a place a person decided is never asked again");
  const qStage = qs.find(q => q.placeId === "v1"), qOpen = qs.find(q => q.placeId === "v2");
  const qT1 = qs.find(q => q.tableId === "t1"), qT2 = qs.find(q => q.tableId === "t2");
  checks.equal(qStage.frame.side, 780, "zone frame: 1.3x the area", qStage.frame);
  checks.equal(qOpen.frame.side, 260, "zone frame: 1.3x the area when that exceeds a fifth of the short side", qOpen.frame);
  checks.equal(qT1.frame.side, 144, "number frame: 2.4x the table", qT1.frame);
  checks.equal(qT1.detector, "41", "a verified OCR number is what the model is checked against");

  // two looks
  checks.equal(Z.judge(qOpen, ["dancefloor", "bar"]).verdict, "UNSURE", "looks that disagree are UNSURE");
  checks.equal(Z.findingFor(qOpen, Z.judge(qOpen, ["dancefloor", "bar"])), null, "and say nothing");
  checks.equal(Z.judge(qOpen, ["dancefloor", null]).verdict, "NO_ANSWER", "a look without a closed answer is NO_ANSWER");
  checks.equal(Z.judge(qStage, ["stage", "stage"]).verdict, "AGREES", "agreeing with the analysis is evidence");
  checks.equal(Z.findingFor(qStage, Z.judge(qStage, ["stage", "stage"])), null, "and offers nothing");

  const fz = Z.findingFor(qOpen, Z.judge(qOpen, ["dancefloor", "dancefloor"]));
  checks.ok(fz && fz.kind === "zone" && fz.type === "dancefloor" && fz.state === "open" && fz.appliesBy === "person",
    "an agreed zone where the analysis has none is an OPEN suggestion a person accepts", fz);
  for (const w of ["seating", "none"]) {
    checks.equal(Z.findingFor(qOpen, Z.judge(qOpen, [w, w])), null, `"${w}" never creates a zone`);
  }
  const fNote = Z.findingFor(qStage, Z.judge(qStage, ["none", "none"]));
  checks.ok(fNote && fNote.kind === "note" && fNote.type === null, "no zone where the analysis has a stage: a note, nothing removed", fNote);

  // numbers are never taken from the model
  const dispute = Z.findingFor(qT1, Z.judge(qT1, ["14", "14"]));
  checks.ok(dispute && dispute.kind === "numberCheck" && dispute.value === null && dispute.check.disputed === true,
    "a number the model reads differently is a CHECK note with no value to write", dispute);
  checks.ok(!JSON.stringify(dispute).includes('"14"'), "the model's number is not carried anywhere a writer could copy it", dispute);
  checks.equal(Z.numberStatus("VERIFIED", Z.judge(qT1, ["14", "14"])).state, "CHECK", "a dispute turns a verified OCR number into CHECK (UNKNOWN)");
  checks.equal(Z.numberStatus("VERIFIED", Z.judge(qT1, ["41", "41"])).secondLook, "agrees", "an agreement is evidence");
  checks.equal(Z.numberStatus("VERIFIED", Z.judge(qT1, ["41", "14"])).state, "VERIFIED", "an unsure second look changes nothing");
  checks.equal(Z.findingFor(qT2, Z.judge(qT2, ["none", "none"])), null, "no number read by either: nothing to say");
  const unread = Z.findingFor(qT2, Z.judge(qT2, ["7", "7"]));
  checks.ok(unread && unread.kind === "numberCheck" && unread.value === null && unread.check.modelSawNumber === true && unread.check.ocr === null,
    "a number OCR did not read is pointed out for a person, never filled in", unread);

  // the parser is the benchmark's
  const bench = fs.readFileSync(path.join(repoRoot, "benchmarks/offline-intelligence/local-vlm-bench2.py"), "utf8");
  checks.ok(/def answer_zone/.test(bench) && /def answer_label/.test(bench), "the benchmark parses the same two answer kinds");
  const cases = [["zone", "Dance floor", "dancefloor"], ["zone", "stage.", "stage"], ["zone", "Seating area", "seating"], ["zone", "maybe", null],
    ["number", "T-12", "T12"], ["number", "None", "none"], ["number", "The number is 105.", "105"], ["number", "3A", "3A"], ["number", "?", null]];
  for (const [q, raw, want] of cases) checks.equal(Z.parseAnswer(q, raw), want, `parse ${q} "${raw}"`);
  checks.equal(Z.tally([{ verdict: "AGREES" }, { verdict: "UNSURE" }, {}]).asked, 2, "the tally counts asked places only");
}
