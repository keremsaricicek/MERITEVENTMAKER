// Section 19: the app.js/app-guests.js -> app-v8.js override boundary,
// checked rather than trusted.
//
// app-v8.js's own `const original = {...}` (near the top of the file)
// captures a name from EVERY bare identifier it is about to reassign --
// render, saveState, touchEvent, and ~30 others originally declared as
// plain top-level functions in src/app.js/src/app-guests.js. Some of
// those captured originals are genuinely called later in the file
// (`original.startResize(...)`, etc. -- real delegation to the pre-V8
// behaviour); most are captured and then never referenced again, because
// app-v8.js's own version fully replaces them and nothing needs the old
// body. Both are legitimate, but which is which was previously an
// undocumented, unenforced fact -- exactly the trap CLAUDE.md warns
// about, since a function that LOOKS unused because it's shadowed by an
// override is a different thing from a function that IS unused, and
// mistaking one for the other (in either direction) risks either dead
// code drifting further or a real delegation being deleted by accident.
//
// This suite does not restructure anything -- it makes the current split
// an explicit, checked fact: every name in `original` is either found in
// a real `original.<name>` call site elsewhere in the file, or is on this
// suite's own reviewed allowlist of names confirmed (this session) to be
// captured-but-never-delegated-to. A name that moves from one bucket to
// the other -- someone wires in a real delegation, or someone adds a new
// override without deciding what kind it is -- fails this suite loudly,
// on purpose: silence here is exactly what let the boundary go unverified
// this long.
import fs from "node:fs";
import path from "node:path";

export const meta = { name: "override-boundary", tags: ["business", "fast"], timeout: 15000 };

// Reviewed and independently confirmed (grep, zero call sites of
// `original.<name>` anywhere in app-v8.js) as of Section 19/21's audit.
// Every one of these is captured only because app-v8.js reassigns the
// bare identifier -- none is currently delegated to. If a future change
// wires a real `original.<name>(...)` call for one of these, REMOVE it
// from this list rather than leaving a stale entry; the suite's own
// exact-match check (not just "allowlist covers it") requires that.
const KNOWN_UNREFERENCED = new Set([
  "render", "bindCommon", "bindCanvas", "bindSeating", "bindLive", "bindReports",
  "floorPlanHTML", "seatingHTML", "guestsHTML", "reportsHTML", "inspectorHTML",
  "setTableCapacity", "deleteSelectedObject", "startObjectDrag",
  "deleteGuest", "assignGuestToTable", "unassignGuest",
  "loadXLSX", "saveState", "touchEvent", "openGuide",
]);

export default async function run({ checks, repoRoot }) {
  const text = fs.readFileSync(path.join(repoRoot, "src", "app-v8.js"), "utf8");

  const originalMatch = text.match(/const\s+original\s*=\s*\{([^}]*)\}/);
  checks.require(originalMatch, "app-v8.js still defines a single `const original = {...}` capture object");

  const names = originalMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  checks.ok(names.length >= 20, "the capture object still lists a real, substantial set of names", names.length);

  // Everything after the capture object's own closing brace -- so a name
  // merely appearing INSIDE the object literal itself never counts as its
  // own reference.
  const afterCapture = text.slice(originalMatch.index + originalMatch[0].length);
  const referenced = new Set();
  const unreferenced = new Set();
  for (const name of names) {
    const hasCall = new RegExp(`original\\.${name}\\b`).test(afterCapture);
    (hasCall ? referenced : unreferenced).add(name);
  }

  const missingFromAllowlist = [...unreferenced].filter((n) => !KNOWN_UNREFERENCED.has(n));
  checks.equal(missingFromAllowlist.length, 0,
    "every captured-but-unreferenced original is a REVIEWED one, not a new override nobody has looked at yet",
    missingFromAllowlist);

  const staleInAllowlist = [...KNOWN_UNREFERENCED].filter((n) => referenced.has(n));
  checks.equal(staleInAllowlist.length, 0,
    "nothing on the allowlist has quietly become a real delegation since it was reviewed -- update the allowlist deliberately if so",
    staleInAllowlist);

  const allowlistNotCaptured = [...KNOWN_UNREFERENCED].filter((n) => !names.includes(n));
  checks.equal(allowlistNotCaptured.length, 0,
    "every allowlisted name is still actually captured by `original` -- the allowlist tracks a real, current fact, not a historical one",
    allowlistNotCaptured);

  // The guard must be able to tell the two buckets apart at all -- prove it
  // against synthetic text, so a regex typo can't make every name land in
  // the same bucket silently.
  const syntheticAfter = "if (x) { original.realCall(1,2); }";
  checks.ok(new RegExp(`original\\.realCall\\b`).test(syntheticAfter),
    "the reference check actually matches a real original.<name>(...) call site");
  checks.ok(!new RegExp(`original\\.neverCalled\\b`).test(syntheticAfter),
    "and correctly reports no match when there genuinely is none");
}
