// UNDERSTAND THE LANGUAGE OF THE PLAN, NOT THE IDENTITY OF THE IMAGE.
//
// Golden Plan and ORNEK are regression evidence — real venue plans this
// product measures itself against — never production concepts. A rule this
// codebase ships is always a GENERALIZED, measured threshold ("the family's
// size agreement is 0.89-0.94 on the nine filled discs"), never a branch on
// which specific file was uploaded. This suite is pure static analysis: it
// finds every line in `src/*.js` that names Golden/ORNEK/a sample filename,
// and fails if any of them is anything other than a documentation comment
// explaining what was measured — never a runtime conditional.
//
// This is a fast, non-browser suite: it never touches `page`, so a fresh
// violation shows up in seconds, not in a 30-second Playwright timeout.
import fs from "node:fs";
import path from "node:path";

export const meta = { name: "no-sample-specific-runtime-logic", tags: ["business", "fast"], timeout: 15000 };

// Every comment in src/*.js is either `// to end of line` or a `/* ... */`
// block fully contained on one line (confirmed by inspection — there are no
// multi-line block comments in this codebase). A line is a comment line if,
// once trimmed, it starts with one of these two markers.
function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("/*");
}

// Sample identifiers that must never drive a runtime decision: the two real
// benchmark plans by name, and known sample/fixture filenames. Deliberately
// NOT matching generic words a real plan's own OCR text might legitimately
// contain (e.g. "SAHNE") — this guard is about identity, not vocabulary.
const SAMPLE_IDENTIFIERS = [/\bgolden\b/i, /\bornek\b/i, /merit-real-venue/i];

// plan-encoder-weights.js is a DATA file (the shipped encoder's weights),
// not application logic — its one match is `"trainedOn":{"plans":
// ["merit-real-venue"]}`, honest metadata about which real plan produced
// this encoder's training data. Removing or hiding that would make the
// model's own provenance LESS honest, not more — the opposite of what this
// guard exists to enforce. Nothing in this file branches on plan identity;
// it is excluded from the line-level scan on that basis, not exempted from
// the rule itself.
const DATA_FILE_EXCEPTIONS = new Set(["plan-encoder-weights.js"]);

export default async function run({ checks, repoRoot }) {
  const srcDir = path.join(repoRoot, "src");
  const files = fs.readdirSync(srcDir)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => !DATA_FILE_EXCEPTIONS.has(f));
  checks.require(files.length > 0, "src/*.js is readable and non-empty", files.length);

  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(srcDir, file), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!SAMPLE_IDENTIFIERS.some((re) => re.test(line))) return;
      if (isCommentLine(line)) return;
      violations.push({ file, line: i + 1, text: line.trim().slice(0, 160) });
    });
  }

  checks.equal(violations.length, 0,
    "no src/*.js line naming Golden/ORNEK/merit-real-venue is anything but a documentation comment",
    violations);

  // The one excepted file must still contain ONLY comments and the honest
  // trainedOn provenance field this exception was written for — if it ever
  // grows actual conditional logic keyed on plan identity, this catches it
  // even though the file is skipped by the main scan above. Each mention of
  // a sample identifier must be either a comment line (the header explains
  // what the weights were trained on in prose) or a line carrying the exact
  // `"trainedOn":{...,"plans":[...,"merit-real-venue",...]}` JSON shape.
  const weightsFile = "plan-encoder-weights.js";
  const weightsText = fs.readFileSync(path.join(srcDir, weightsFile), "utf8");
  const provenanceShape = /"trainedOn"\s*:\s*\{[^}]*"plans"\s*:\s*\[[^\]]*"merit-real-venue"[^\]]*\]/i;
  const unexplainedHits = [];
  weightsText.split("\n").forEach((line, i) => {
    if (!SAMPLE_IDENTIFIERS.some((re) => re.test(line))) return;
    if (isCommentLine(line)) return;
    if (provenanceShape.test(line)) return;
    unexplainedHits.push({ line: i + 1, text: line.slice(0, 160) });
  });
  checks.equal(unexplainedHits.length, 0,
    "plan-encoder-weights.js's only sample references are a documentation comment and the honest trainedOn provenance field — nothing else",
    unexplainedHits);

  // The guard itself must be capable of catching a real violation — prove it
  // against a synthetic line, so a change to isCommentLine() that made it
  // vacuously true (e.g. always returning true) cannot pass silently.
  const syntheticViolation = 'if (planName === "ornek-symbolic") return FAST_PATH;';
  checks.ok(!isCommentLine(syntheticViolation) && SAMPLE_IDENTIFIERS.some((re) => re.test(syntheticViolation)),
    "the guard's own detection logic actually flags a sample-identity branch, not just comments",
    syntheticViolation);

  // And a genuine documentation comment must NOT be flagged, so the guard
  // cannot "pass" by rejecting everything including legitimate comments.
  const syntheticComment = "// Measured on the Golden Plan: 46 tables, F1 0.958.";
  checks.ok(isCommentLine(syntheticComment) && SAMPLE_IDENTIFIERS.some((re) => re.test(syntheticComment)),
    "the guard recognizes a real documentation comment as allowed, not as a false positive",
    syntheticComment);
}
