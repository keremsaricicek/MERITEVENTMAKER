// The classic-script boot contract, verified where it actually happens.
//
// `override-boundary.test.mjs` parses `app-v8.js`'s `const original = {...}`
// capture and checks which names are delegated to. That is a real check and
// it stays — but it is PURELY STATIC. It cannot see the thing that actually
// breaks during modularization: a function silently resolving to its pre-v8
// body at runtime because a script moved, a tag was reordered, or an
// extraction dropped a reassignment.
//
// That failure does not look wrong in a diff. The app boots, the screen
// renders, and an older implementation quietly runs instead of the current
// one. This suite is the guard for it, and it works by booting the REAL app
// in a REAL browser and asking each overridden name what it actually is.
//
// The trick: `app.js` / `app-guests.js` declare these as top-level
// `function` declarations, so they land on `window`. `app-v8.js` then
// reassigns them. At runtime, `window.render.toString()` is either the v8
// body or the pre-v8 body — and the pre-v8 body can be found verbatim in
// app.js/app-guests.js source. So a silent revert is detectable by reading
// the live function back out of the page and comparing it to the file it
// would have come from.
import fs from "node:fs";
import path from "node:path";
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "boot-contract", tags: ["business", "fast"], timeout: 60000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const v8Source = fs.readFileSync(path.join(repoRoot, "src", "app-v8.js"), "utf8");

  // --- 1. the load order itself -------------------------------------------
  const scripts = [...html.matchAll(/src="src\/([a-z0-9-]+\.js)"/g)].map((m) => m[1]);
  checks.require(scripts.length > 25, "index.html still loads the full classic-script set", scripts.length);

  checks.equal(scripts[0], "storage-provider.js",
    "the first script is the storage provider — the shell's persistence boundary loads before anything that uses it", scripts[0]);
  checks.equal(scripts[scripts.length - 1], "app-v8.js",
    "app-v8.js is LAST. It is the override layer; anything loading after it would run before its reassignments and silently win", scripts[scripts.length - 1]);

  const iApp = scripts.indexOf("app.js");
  const iGuests = scripts.indexOf("app-guests.js");
  const iV8 = scripts.indexOf("app-v8.js");
  checks.ok(iApp >= 0 && iGuests > iApp && iV8 > iGuests,
    "the shell order holds: app.js → app-guests.js → … → app-v8.js",
    { "app.js": iApp, "app-guests.js": iGuests, "app-v8.js": iV8 });

  checks.equal(new Set(scripts).size, scripts.length,
    "no script is loaded twice — a duplicate tag re-runs a file and can undo a later override", scripts.length);

  // --- 2. the capture, classified ------------------------------------------
  // Three different things have been called "unreachable" in this repo, and
  // they are not the same. This check writes the distinction down so a
  // future dead-code pass cannot delete a live function by reading a count.
  const captureMatch = v8Source.match(/const\s+original\s*=\s*\{([^}]*)\}/);
  checks.require(captureMatch, "the `original` capture object is still there to classify");
  const names = captureMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  const after = v8Source.slice(v8Source.indexOf(captureMatch[0]) + captureMatch[0].length);

  // Assignment in ANY form, not just `= function` / `= (`. app-v8.js also
  // overrides by ALIAS -- `bindCommon = bindV8Common;` -- which a
  // function-literal-only pattern misses, silently misclassifying an
  // overridden name as untouched. The positive control below is what
  // caught that; keep both.
  const isReassigned = (n) => new RegExp(`(^|[^\\w.])${n}\\s*=[^=>]`, "m").test(after);
  const isDelegated = (n) => new RegExp(`original\\.${n}\\s*\\(`).test(after);

  const delegated = names.filter((n) => isDelegated(n));
  const shadowed = names.filter((n) => isReassigned(n) && !isDelegated(n));
  const untouched = names.filter((n) => !isReassigned(n) && !isDelegated(n));

  checks.equal(delegated.length + shadowed.length + untouched.length, names.length,
    "every captured name falls into exactly one class — delegated, shadowed, or untouched", names.length);
  checks.equal(delegated.length, 12,
    "12 names are genuinely delegated to (`original.X(...)`) — v8 overrides them AND still calls the pre-v8 body. Deleting any of these breaks the app", delegated);
  checks.equal(shadowed.length, 20,
    "20 names are SHADOWED: v8 fully replaces them, so the CAPTURED REFERENCE is dead — but the function name itself is live and running v8's version. `bindCommon` belongs here: it is overridden by ALIAS (`bindCommon = bindV8Common`), which is why a `= function`-shaped detector misfiled it as untouched", shadowed.length);
  checks.equal(untouched.length, 1,
    "exactly 1 name is UNTOUCHED by v8 (`inspectorHTML`): the capture entry is dead weight, but the original app.js implementation is still the live one", untouched);

  // The correction this classification exists to make permanent.
  checks.ok(shadowed.length + untouched.length === 21,
    "the figure previously written down as '21 unreachable functions' is 21 unreachable CAPTURE ENTRIES — not 21 dead functions. All 21 names are live at runtime; only the `original.X` references are unused",
    { shadowed: shadowed.length, untouched: untouched.length });

  // --- 3. the runtime contract — the part static analysis cannot do --------
  await openApp(page, baseUrl);

  const baseSource =
    fs.readFileSync(path.join(repoRoot, "src", "app.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(repoRoot, "src", "app-guests.js"), "utf8");

  const live = await page.evaluate((list) => {
    const out = {};
    for (const n of list) {
      const f = globalThis[n];
      out[n] = typeof f === "function" ? f.toString() : null;
    }
    return out;
  }, names);

  const missing = names.filter((n) => live[n] === null);
  checks.equal(missing.length, 0,
    "every captured name is a live function on the page after boot — a missing one means the declaring script never ran", missing);

  // A body is "pre-v8" if it appears verbatim in app.js/app-guests.js. For
  // the 31 names v8 reassigns, finding the pre-v8 body live means the
  // override silently did not take.
  const reverted = [];
  for (const n of names) {
    if (!isReassigned(n)) continue;              // v8 never overrode it: pre-v8 IS correct
    const body = live[n];
    if (body && baseSource.includes(body)) reverted.push(n);
  }
  checks.equal(reverted.length, 0,
    "no overridden function silently resolved to its pre-v8 body at runtime — this is the failure mode that does NOT look wrong in a diff, and the one extraction from app-v8.js is most likely to cause",
    reverted);

  // Positive control: the check above would be vacuous if NO live body ever
  // matched the base source. The two untouched names must match, because v8
  // genuinely does not override them.
  const untouchedMatch = untouched.filter((n) => live[n] && baseSource.includes(live[n]));
  checks.equal(untouchedMatch.length, untouched.length,
    "the untouched names DO resolve to their app.js bodies — proving the comparison above can actually detect a pre-v8 body and is not silently always-true",
    { expected: untouched, matched: untouchedMatch });

  // --- 4. the app is actually alive, not just defined ---------------------
  const alive = await page.evaluate(() => ({
    hasState: typeof state === "object" && Array.isArray(state.events),
    hasUi: typeof ui === "object",
    modules: Object.keys(globalThis).filter((k) => k.startsWith("Merit")).length,
    rendered: !!document.querySelector(".app, .appbar, .mx-head"),
  }));
  checks.ok(alive.hasState && alive.hasUi && alive.rendered,
    "the shell booted: state and ui exist and something rendered", alive);
  checks.ok(alive.modules >= 25,
    "the pure Merit* module layer is present on the page — a dropped script tag would show up here", alive.modules);
}
