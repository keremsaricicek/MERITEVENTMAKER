// Section 25 (error messages): every t() key in the source exists, in both
// languages -- checked statically, because the strings this matters most for
// are the ones no rendering test can reach.
//
// t() falls back to returning the key itself when a string is missing
// (src/i18n.js), which is the right behaviour: the gap stays visible instead
// of showing an empty box. The existing `i18n` suite hunts for exactly that
// shape by walking the rendered DOM of all five screens in both languages --
// and it is a good check, but it can only see strings that something actually
// rendered during the pass.
//
// Error messages are, by definition, the strings nothing renders. "Bu yedek
// dosyasındaki bağlantılar bozuk" (backup.badReference) appears only when a
// restore file has broken references; teachArea.refused only when a lesson is
// refused; recovery.none only when automatic recovery finds no snapshot;
// eventPackage.invalidFile only on a malformed package. No suite drives those
// failure paths, so deleting or mistyping one of those keys today ships a raw
// dotted identifier -- "backup.badReference" -- to an operator at the exact
// moment they are least able to work out what it meant. That is the gap this
// suite closes, and it closes it for every key, not just a listed few.
//
// The second half of the check is the language fallback. t() resolves
// entry[currentLang()] || entry.en, so a key defined with `en` but no `tr`
// resolves SILENTLY to English -- no raw key, nothing for the DOM-walking
// suite to catch -- and the product's default language is Turkish. An
// English-only error message on a Turkish-default product is the same defect
// one step quieter.
//
// Static, not browser-driven, on purpose: the point is coverage of every call
// site in the tree, including the ones that only run when something has
// already gone wrong.
import fs from "node:fs";
import path from "node:path";

export const meta = { name: "i18n-key-integrity", tags: ["business", "fast"], timeout: 15000 };

const SRC = path.join(process.cwd(), "src");

// src/app.js's demo-seed data is built by a LOCAL helper that happens to be
// named t -- t("T01","rectangle",607,285,...) builds a table, it does not
// look up a string. Those are the only false positives in the tree and they
// are excluded by shape (a table number, not a dotted key) rather than by
// file, so a genuine one-word key would still be caught.
const looksLikeKey = (k) => k.includes(".");

export default async function run({ checks }) {
  const i18nSource = fs.readFileSync(path.join(SRC, "i18n.js"), "utf8");

  // --- what the string table defines ---------------------------------------
  const defined = new Map();
  const defRe = /"([a-zA-Z0-9_.\-]+)":\s*\{/g;
  let m;
  while ((m = defRe.exec(i18nSource))) {
    const open = i18nSource.indexOf("{", m.index);
    let depth = 0, end = open;
    for (let i = open; i < i18nSource.length; i++) {
      if (i18nSource[i] === "{") depth++;
      else if (i18nSource[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = i18nSource.slice(open, end + 1);
    const hasEn = /\ben:\s*"/.test(body);
    const hasTr = /\btr:\s*"/.test(body);
    if (!hasEn && !hasTr) continue;   // a nested object that is not a string entry
    defined.set(m[1], { en: hasEn, tr: hasTr });
  }

  checks.require(defined.size > 1000,
    "the string table parsed into a real, complete set of entries (a parse that silently found nothing would make every check below vacuously pass)",
    defined.size);

  // --- what the source asks for --------------------------------------------
  // Only COMPLETE literals: t("key") or t("key", vars). A key assembled by
  // concatenation -- t("status.planning." + g.planningStatus) -- has its
  // closing quote followed by +, and is excluded: its full key is not
  // knowable statically, and guessing at the enum values would be a check
  // that asserts this suite's idea of the domain rather than the product's.
  const used = new Map();
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".js") && f !== "i18n.js")) {
    fs.readFileSync(path.join(SRC, file), "utf8").split("\n").forEach((line, idx) => {
      const re = /\bt\(\s*"([a-zA-Z0-9_.\-]+)"\s*(\)|,)/g;
      let mm;
      while ((mm = re.exec(line))) {
        if (!looksLikeKey(mm[1])) continue;
        if (!used.has(mm[1])) used.set(mm[1], []);
        used.get(mm[1]).push(`${file}:${idx + 1}`);
      }
    });
  }

  checks.require(used.size > 400,
    "the source scan found the app's real body of t() call sites, across every module",
    used.size);

  // --- 1. no key resolves to itself ----------------------------------------
  const undefinedKeys = [...used.keys()]
    .filter((k) => !defined.has(k))
    .map((k) => `${k} (${used.get(k).join(", ")})`);
  checks.equal(undefinedKeys.length, 0,
    "every t() key used anywhere in src/ exists in the string table — a missing one renders its own raw identifier to the operator, and error-path keys are never rendered by any other suite",
    undefinedKeys);

  // --- 2. no key is English-only on a Turkish-default product --------------
  const trMissing = [...used.keys()]
    .filter((k) => defined.has(k) && !defined.get(k).tr)
    .map((k) => `${k} (${used.get(k).join(", ")})`);
  checks.equal(trMissing.length, 0,
    "every used key carries a Turkish string — t() falls back to English silently, so a missing tr is invisible to the DOM-walking i18n suite",
    trMissing);

  // --- 3. and none is Turkish-only ----------------------------------------
  const enMissing = [...used.keys()]
    .filter((k) => defined.has(k) && !defined.get(k).en)
    .map((k) => `${k} (${used.get(k).join(", ")})`);
  checks.equal(enMissing.length, 0,
    "every used key carries an English string — en is the fallback t() reaches for when a language is missing, so a key without one has no fallback at all",
    enMissing);

  // --- 4. the two error paths this section actually fixed ------------------
  // Named explicitly rather than left to the sweep above, because the defect
  // they close is not a missing key but a message that had no key at all:
  // both sites used to toast a bare library exception ("Invalid PDF
  // structure.") with no action named, no next step, and no translation.
  const appV8 = fs.readFileSync(path.join(SRC, "app-v8.js"), "utf8");
  for (const key of ["setup.planReadFailed", "plan.replaceFailed"]) {
    checks.ok(defined.has(key) && defined.get(key).en && defined.get(key).tr,
      `${key} is defined in both languages`, defined.get(key));
    checks.ok(appV8.includes(`t("${key}"`),
      `the plan-import failure path builds its message from ${key} rather than toasting a raw exception`);
  }

  // Both messages must still carry the library's own reason -- the fix was to
  // give the operator an action and a next step, not to throw away the one
  // piece of text that says why it failed.
  for (const key of ["setup.planReadFailed", "plan.replaceFailed"]) {
    const row = i18nSource.match(new RegExp(`"${key.replace(".", "\\.")}":\\s*\\{[^\\n]*`));
    checks.ok(row && row[0].includes("{reason}"),
      `${key} still substitutes the underlying {reason}, so the technical detail is kept alongside the instruction`, row && row[0].slice(0, 120));
  }

  const bareExceptionToasts = appV8.split("\n")
    .map((line, idx) => ({ line, idx: idx + 1 }))
    .filter(({ line }) => /toast\(\s*error\.message\s*,/.test(line))
    .map(({ idx }) => `app-v8.js:${idx}`);
  checks.equal(bareExceptionToasts.length, 0,
    "no toast in app-v8.js shows a bare error.message — an operator needs the action that failed and what to do next, not only the library's own wording",
    bareExceptionToasts);
}
