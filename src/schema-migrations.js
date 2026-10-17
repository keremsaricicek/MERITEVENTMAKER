// WHAT VERSION IS THIS RECORD, AND WHAT HAS TO HAPPEN TO IT?
//
// `parseRoot()` used to open with:
//
//     const parsed = JSON.parse(raw); parsed.version = 8; parsed.schemaVersion = 8;
//
// It STAMPED the version rather than reading it, and everything after was one
// unconditional pass of "fill in a sane default if missing". That is safe
// while every change is additive, and silently wrong the moment one is not.
// Three consequences, in rising order of damage:
//
//   A RECORD FROM A NEWER BUILD WAS SILENTLY DOWNGRADED. Open this build
//   against data written by the next one: its version is overwritten with 8,
//   its unknown fields are ignored, and the first mutation saves over it. The
//   newer install's data is not misread — it is destroyed, by a build that
//   never knew it was looking at something it could not read. The destructive
//   half is the WRITE, which is why refusing to read also has to refuse to
//   write.
//
//   NOTHING COULD BE VERSION-GATED. A step that changes what a field MEANS,
//   rather than adding one, has nowhere to live: no code can tell a record
//   that has had it applied from one that has not.
//
//   CORRUPTION LOOKED LIKE AGE. `{}`, a string, an array, a root whose
//   `events` is not a list — all of them were "version 8" as far as the
//   loader was concerned.
//
// This module reads the version, runs a SEQUENTIAL chain of named steps from
// there to CURRENT_VERSION, and contains what it cannot handle. It is pure:
// no state, no ui, no storage, no render. A root goes in, a verdict and a
// root come out.
//
// ADDING A STEP. Append to STEPS with `from: CURRENT_VERSION`,
// `to: CURRENT_VERSION + 1`, raise CURRENT_VERSION to match, and write what
// it does in `describe`. A step must be IDEMPOTENT in effect — running the
// chain on an already-current record must change nothing — and must never
// throw on a shape it does not recognise; a record that reaches it having
// survived earlier steps is by definition one this build claims to
// understand.
(function () {
  "use strict";

  // Raised by the step below. Version 8 was every record this product had
  // ever written, because nothing read the number.
  const CURRENT_VERSION = 9;

  const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  // Verdicts. Deliberately named rather than boolean: "cannot read this" and
  // "this is older than me" are different situations with opposite correct
  // responses, and one flag cannot carry both.
  const STATUS = {
    OK: "OK",                 // at, or brought up to, the current version
    FUTURE: "FUTURE",         // written by a newer build — refuse, do not touch
    UNREADABLE: "UNREADABLE", // not a root this product could have written
  };

  const STEPS = [
    {
      from: 8, to: 9,
      describe: "Physical chairs are no longer synthesised from capacity: a table whose plan drew none carries an empty chairs array, and the retired per-chair `physical` flag is dropped. Logical seats stay in table.capacity and are untouched.",
      migrate(root) {
        for (const event of root.events) {
          if (!isPlainObject(event) || !Array.isArray(event.tables)) continue;
          for (const table of event.tables) {
            if (!isPlainObject(table)) continue;
            if (table.hasPhysicalSeats === false) {
              // A symbolic table's chairs were always fabricated from its
              // capacity number. Dropping them loses no operational fact:
              // capacity, assignments and seat indexes live elsewhere.
              table.chairs = [];
              continue;
            }
            if (!Array.isArray(table.chairs)) continue;
            table.chairs = table.chairs
              // A chair explicitly marked not-physical was a placeholder, on
              // a table that has since been corrected to physical. It is not
              // evidence of a chair and does not survive as one.
              .filter((chair) => !(isPlainObject(chair) && chair.physical === false))
              .map((chair) => {
                if (!isPlainObject(chair)) return chair;
                const { physical, ...rest } = chair;   // the flag is retired
                return rest;
              });
          }
        }
        return root;
      },
    },
  ];

  // The version a record DECLARES. A root with no version at all predates the
  // field and is the oldest the chain knows how to start from; so is one
  // whose version is not a number, because guessing forward would skip steps
  // while guessing backward only re-runs idempotent ones.
  function versionOf(root) {
    if (!isPlainObject(root)) return null;
    const oldest = STEPS.length ? STEPS[0].from : CURRENT_VERSION;
    const raw = root.schemaVersion !== undefined ? root.schemaVersion : root.version;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return oldest;
    return Math.trunc(n);
  }

  // Which steps a record at this version would run. Exposed so a caller can
  // report what is about to happen before it happens.
  function plan(fromVersion) {
    return STEPS.filter((s) => s.from >= fromVersion);
  }

  // Is this shaped like something this product wrote? Deliberately shallow:
  // per-field repair belongs to the app's own normalization, and a stricter
  // check here would reject records the chain is meant to fix.
  function readable(root) {
    if (!isPlainObject(root)) return false;
    if (root.events !== undefined && !Array.isArray(root.events)) return false;
    if (root.audit !== undefined && !Array.isArray(root.audit)) return false;
    if (root.venues !== undefined && !Array.isArray(root.venues)) return false;
    return true;
  }

  // THE ONE JSON READER FOR A RECORD FROM OUTSIDE THIS PAGE'S MEMORY — the
  // stored root on boot, a recovery snapshot, a backup or an event package
  // picked by an operator. Identical to JSON.parse except that three keys are
  // dropped wherever they occur: `__proto__`, `constructor`, `prototype`.
  //
  // JSON.parse alone never pollutes anything: it creates `__proto__` as an
  // ordinary own property. The danger is one copy later. Every copy in this
  // codebase today spreads or defines, which is safe, and
  // `tests/suites/prototype-pollution.test.mjs` proves it — but the keys used
  // to ride along anyway: restored, saved to disk, exported in the next
  // backup, waiting for the first `Object.assign(existing, imported)` to turn
  // a dormant own `__proto__` into a live prototype swap. A defence that
  // depends on every future copy being written carefully is not a boundary.
  // This is. No record this product writes uses any of the three names, so
  // nothing legitimate is lost.
  //
  // COST, measured rather than assumed: a reviver visits every value, and on a
  // 4.2 MB record (420 tables × 10 chairs, 4,200 guests, 5,000 audit entries,
  // a 3 MB plan image) it took the parse from 13 ms to 75 ms. So the reviver
  // only runs when the text COULD produce one of the keys. Inside a JSON
  // string a letter is written either literally or as a `\u` escape — there is
  // no third spelling — so text that contains none of the three names and no
  // `\u` at all cannot yield any of them, and the plain parse is exact.
  const FORBIDDEN_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);
  const COULD_NAME_FORBIDDEN = /__proto__|constructor|prototype|\\u/;
  function parseRecord(text) {
    if (typeof text === "string" && !COULD_NAME_FORBIDDEN.test(text)) return JSON.parse(text);
    return JSON.parse(text, (key, value) => (FORBIDDEN_KEYS.includes(key) ? undefined : value));
  }

  function migrate(root) {
    if (!readable(root)) {
      return { status: STATUS.UNREADABLE, root: null, from: null, to: null, applied: [] };
    }
    const from = versionOf(root);
    if (from > CURRENT_VERSION) {
      // Handed BACK UNCHANGED, on purpose. The caller must not load it, and
      // must not write over it: the fields this build cannot read are the
      // only copy of somebody's work.
      return { status: STATUS.FUTURE, root, from, to: CURRENT_VERSION, applied: [] };
    }
    const applied = [];
    let out = root;
    if (!Array.isArray(out.events)) out.events = [];
    for (const step of plan(from)) {
      out = step.migrate(out) || out;
      applied.push({ from: step.from, to: step.to, describe: step.describe });
    }
    out.schemaVersion = CURRENT_VERSION;
    out.version = CURRENT_VERSION;
    return { status: STATUS.OK, root: out, from, to: CURRENT_VERSION, applied };
  }

  globalThis.MeritSchemaMigrations = {
    version: 1, CURRENT_VERSION, STATUS, STEPS, FORBIDDEN_KEYS,
    versionOf, plan, readable, migrate, parseRecord,
  };
})();
