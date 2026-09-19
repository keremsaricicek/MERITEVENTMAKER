// The offline build's two structural assumptions, guarded where they are made.
//
// Both builders take `index.html` apart with two string indexes:
//
//     const bodyStart = shell.indexOf("<body>");
//     const bodyEnd   = shell.indexOf("<script");
//     const bodyMarkup = shell.slice(bodyStart, bodyEnd);
//
// and then concatenate every `src/*.js` into ONE <script>. Two things can go
// wrong, and one of them already shipped:
//
//  1. THE SLICE SILENTLY DROPS MARKUP. Anything with an id that sits after
//     the first <script> tag is not in the artifact. `build-offline-full.mjs`
//     used to cut at the first HTML COMMENT instead, which dropped
//     #guestDialog, which made app-guests.js throw, which — because all
//     sources share one <script> — killed every file after it. The package
//     booted to a dead shell with no OCR at all, and the build printed
//     success.
//
//  2. THE CONCATENATION ORDER BREAKS. These are classic scripts sharing one
//     global scope and app-v8.js is the override layer. If the bundle ever
//     emitted them in a different order — a "tidy-up" that sorted or deduped
//     the file list — every file would still be present, the build would
//     still succeed, and app-v8.js's reassignments would be overwritten by
//     the files they exist to override. Nothing would look wrong.
//
// WHAT `npm run verify:offline` ALREADY COVERS, and this suite therefore
// does NOT repeat: it boots both built artifacts in a real browser and
// asserts no page errors, zero off-origin requests, SheetJS/OCR inlined,
// real OCR running in the folder build, and — for the LIGHT build — that
// every script index.html loads is bundled, by finding a verbatim slice of
// each file's real content. That is the completeness half of hazard 2, and
// it is not re-asserted here.
//
// WHAT IT DOES NOT COVER, which is what this suite adds:
//   · ORDER. Presence is checked; sequence never is.
//   · The slice boundary itself. Both builders check eight HARDCODED ids
//     (and the verifier a third copy of the same eight). A dialog added
//     below the script block, or a new one added above it, is invisible to
//     all three lists. This suite derives the required set from the app's
//     own `getElementById` calls instead, so an element added tomorrow is
//     covered the day it is added.
//
// Both builders carry the same two anchors, so guarding the algorithm once
// guards both artifacts; check 1 is what keeps that claim true.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { appSourceFiles } from "../../scripts/lib/app-sources.mjs";

export const meta = { name: "offline-bundle-contract", tags: ["business", "fast"], timeout: 60000 };

const BUILDERS = ["scripts/build-offline.mjs", "scripts/build-offline-full.mjs"];

export default async function run({ checks, repoRoot }) {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

  // --- 1. this suite's model of the builders is still the builders' -------
  // Everything below reasons about a slice THIS FILE computes. If a builder
  // changes its anchors, that reasoning becomes fiction — so the model is
  // checked against the real scripts before it is used.
  for (const rel of BUILDERS) {
    const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    const usesBody = src.includes('shell.indexOf("<body>")');
    const usesScript = src.includes('shell.indexOf("<script")');
    checks.ok(usesBody && usesScript,
      `${rel} still slices index.html with the two anchors this suite models — if it stops, these checks are reasoning about the wrong boundary and must be updated, not trusted`,
      { usesBody, usesScript });
  }

  // --- 2. the boundary, computed exactly as the builders compute it -------
  const bodyStart = html.indexOf("<body>");
  const bodyEnd = html.indexOf("<script");
  checks.require(bodyStart >= 0 && bodyEnd > bodyStart,
    "the body markup range resolves in index.html", { bodyStart, bodyEnd });

  const bodyMarkup = html.slice(bodyStart, bodyEnd);
  const afterSlice = html.slice(bodyEnd);

  // --- 3. the required element set, derived rather than listed ------------
  // An element is required if the app looks it up by id AND index.html
  // declares it in markup. Ids the app creates at runtime are excluded —
  // they are not the build's problem. This is the drift-proof replacement
  // for the eight-id list the two builders and the verifier each keep their
  // own copy of.
  const lookedUp = new Set();
  for (const file of fs.readdirSync(path.join(repoRoot, "src")).filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(repoRoot, "src", file), "utf8");
    for (const m of src.matchAll(/getElementById\(\s*["'`]([A-Za-z0-9_-]+)["'`]\s*\)/g)) lookedUp.add(m[1]);
  }
  const declared = new Set([...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  const required = [...lookedUp].filter((id) => declared.has(id)).sort();

  checks.ok(required.length >= 14,
    "the required-element set was derived from the app's own getElementById calls, not from a hand-kept list", required.length);

  const dropped = required.filter((id) => !bodyMarkup.includes(`id="${id}"`));
  checks.equal(dropped.length, 0,
    "every element the app looks up by id survives the body slice — an element added BELOW the first <script> tag would be silently absent from both offline artifacts while both builds report success, which is the exact failure that already shipped once",
    dropped);

  // The forward-looking half: the region the slice throws away must contain
  // no markup at all. Today it is scripts and the closing tags. The moment
  // somebody appends a dialog at the end of <body> — the natural place to
  // put one — this fires, before the artifact is built rather than after it
  // is shipped.
  const strandedIds = [...afterSlice.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
  checks.equal(strandedIds.length, 0,
    "no element carrying an id sits after the first <script> tag — that region is discarded by both builders, so anything there exists in the app and not in the offline build",
    strandedIds);

  // --- 4. the derived set really is a superset of the hardcoded lists -----
  // Not a divergent second opinion: it must contain everything the builders
  // already guard, plus more. If it ever contained LESS, this suite would be
  // weaker than the thing it is meant to strengthen.
  for (const rel of BUILDERS) {
    const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    const hard = [...src.matchAll(/'id="([A-Za-z0-9_-]+)"'/g)].map((m) => m[1]);
    checks.require(hard.length > 0, `${rel}'s hardcoded required list was found`, hard.length);
    const missed = hard.filter((id) => !required.includes(id));
    checks.ok(missed.length === 0 && required.length > hard.length,
      `${rel} guards ${hard.length} ids by hand; the derived set covers all of them and ${required.length - hard.length} more`,
      { hardcoded: hard.length, derived: required.length, notCovered: missed });
  }

  // --- 5. the bundle's ORDER, in the real artifact ------------------------
  // CI's fast job builds this before running the suite; locally it is built
  // on demand and takes well under a second against the vendor cache.
  const artifactPath = path.join(repoRoot, "dist", "index-offline.html");
  if (!fs.existsSync(artifactPath)) {
    execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-offline.mjs")], {
      cwd: repoRoot, stdio: "ignore",
    });
  }
  checks.require(fs.existsSync(artifactPath), "the single-file offline artifact exists to inspect", artifactPath);
  const artifact = fs.readFileSync(artifactPath, "utf8");

  const files = appSourceFiles(repoRoot);
  checks.require(files.length > 25, "index.html's script list was read for ordering", files.length);

  // One probe per file: a slice from the middle, clear of the header comment
  // every file starts with, long enough to be unique to that file.
  const probes = files.map((rel) => {
    const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    const mid = Math.floor(src.length / 2);
    return { rel, probe: src.slice(mid, mid + 160) };
  });

  // Positive control: comparing positions is only meaningful if each probe
  // occurs exactly once. A probe appearing twice would make the ordering
  // check quietly arbitrary.
  const ambiguous = probes.filter((p) => artifact.split(p.probe).length - 1 !== 1).map((p) => p.rel);
  checks.equal(ambiguous.length, 0,
    "each source file's probe occurs exactly once in the artifact, so a position comparison between them means something",
    ambiguous);

  const positions = probes.map((p) => ({ rel: p.rel, at: artifact.indexOf(p.probe) }));
  const outOfOrder = [];
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].at <= positions[i - 1].at) {
      outOfOrder.push(`${positions[i - 1].rel} → ${positions[i].rel}`);
    }
  }
  checks.equal(outOfOrder.length, 0,
    "the bundle concatenates the sources in index.html's document order — these are classic scripts in one shared scope, so a reordering keeps every file present and still breaks the app silently",
    outOfOrder);

  checks.equal(positions[positions.length - 1].rel, "src/app-v8.js",
    "app-v8.js is last in the bundle, as it is in index.html — it is the override layer, and anything concatenated after it would run later and win",
    positions[positions.length - 1].rel);

  // --- 6. the slice actually survived into the product -------------------
  const absentFromArtifact = required.filter((id) => !artifact.includes(`id="${id}"`));
  checks.equal(absentFromArtifact.length, 0,
    "every required element reached the built artifact — the end-to-end confirmation that the markup slice above is what actually shipped",
    absentFromArtifact);
}
