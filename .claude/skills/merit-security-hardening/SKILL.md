---
name: merit-security-hardening
description: The security and privacy contract for MERIT ENTERTAINMENT — EVENT MAKER — XSS and DOM injection from imported or typed content, file-parsing boundaries, object-URL lifecycle, package and backup import trust, prototype pollution, CSP readiness, and guest-data privacy. Use for any security review, before trusting imported data, and before claiming a security score. Requires hostile-input fixtures, not a count of escape calls.
---

# MERIT Security Hardening

This is internal, browser-only software with no backend and no
authentication. That removes whole categories of risk and concentrates
what remains into one place: **everything dangerous arrives as content.**

A guest name typed by a coordinator. A venue name in an imported XLSX. OCR
text read off a customer's plan. A backup file from another machine. An
event package emailed between staff. None of it is attacker-controlled in
the classic sense — and all of it is untrusted input that reaches the DOM.

The realistic threat is not a hacker. It is a malformed or hostile
spreadsheet breaking the evening, or a guest list quietly corrupting the
room an hour before doors.

## Where this dimension actually stands

Measured at `65ea956`:

| | |
|---|---|
| `esc()` calls in `src/` | **331** |
| `innerHTML =` assignments in `src/` | **13** |
| `eval` / `new Function` | **0** |
| `createObjectURL` / `revokeObjectURL` | **4 / 4** (balanced) |
| Security test suites (of 65) | **0** |

The escaping discipline is clearly real. The coverage is unproven.

## THE RULE THAT DECIDES THIS DIMENSION

> **"We use `esc()`" is not evidence. A hostile-input fixture that passes is.**

331 escape calls prove a habit, not completeness. One unescaped
interpolation among them is the whole vulnerability, and counting cannot
find it. The evidence here is a test that feeds a payload through a real
operator path and asserts it did not execute.

## Attack surface, by entry point

Every one of these is a place operator or file content becomes DOM:

**Typed by a person** — guest name · notes · invited-by · event name ·
venue/salon name · table number and label · zone name · freeze reason ·
unavailable reason · handover note · Teach Area lesson text.

**Imported from a file** — XLSX/CSV cell values (every column, including
ones mapped to numbers) · column headers · sheet names · backup JSON ·
event package JSON · plan image metadata · PDF text.

**Derived by the product** — OCR text read off a plan · detected object
labels · printed table numbers.

OCR deserves particular attention: it is the one input that is neither typed
nor imported, and it is easy to forget it reaches the UI as a string.

## What must be true

### Injection
- Every one of the 13 `innerHTML` assignments has its inputs traced to
  either a literal, a number, or an escaped string. Trace all 13 and write
  down what each interpolates; do not sample.
- Template literals building markup escape every interpolated value.
  A nested template is where this is missed —
  `` `${rows.map(r => `<td>${r.name}</td>`)}` `` — because the inner one
  reads as data at a glance.
- `textContent` preferred wherever markup is not actually needed.
- No `eval`, `new Function`, or string-bodied `setTimeout`. Currently zero —
  keep it there.
- No `javascript:` or `data:text/html` URL ever built from content.

### File parsing
- A malformed XLSX/CSV/PDF/JSON is **rejected with a message**, never
  half-applied. Partial application of a corrupt import is worse than
  refusing it.
- Numeric fields coming from a sheet are validated, not coerced and trusted.
  A pax value of `"1e9"` or `"-3"` is a rejection, not a table.
- Deeply nested or enormous JSON does not hang the UI.
- Import size and row count have limits, and hitting one is an honest
  message.

### Prototype pollution
Backup and package import merge external JSON into application state. Keys
`__proto__`, `constructor`, `prototype` must never be assigned from parsed
input. This is the single highest-severity realistic bug in this codebase's
shape, because those importers walk arbitrary object trees.

### Object URLs and memory
- Every `createObjectURL` has a matching `revokeObjectURL` on every path,
  including the error path. Currently balanced 4/4 — a new one must keep it.

### Trust boundaries
- An imported **event package** adds an event; it never replaces or mutates
  an existing one (`event-package` suite).
- An imported **backup** is validated before it replaces anything, and a
  failed restore leaves the previous state intact.
- Neither may carry executable content or set fields the schema does not
  define.

### Network and CSP
- The product must work with zero off-origin requests — already asserted by
  `verify:offline` (27 checks).
- Track what a CSP would break: inline handlers, inline styles, `blob:`
  workers. The goal is to be CSP-ready before desktop packaging, where it
  matters most.

### Privacy
- Guest names, notes and contact-like fields must not appear in console
  logs, error messages, or telemetry of any kind.
- An error shown to an operator must not echo a raw record.
- Exports contain what the report contract says and nothing more.

## Required evidence

A suite — none exists today, and creating it is the first task.

1. **Hostile-input fixtures.** A shared payload list —
   `<script>`, `<img onerror>`, `"><svg onload>`, `javascript:`,
   `{{}}`, `__proto__`, very long strings, RTL overrides, null bytes — fed
   through **each entry point above**, asserting: no script executes, no
   unexpected element is created, and the text renders as text.
2. **Prototype-pollution fixtures** for backup and package import, asserting
   `Object.prototype` is unpolluted afterwards.
3. **Malformed-file fixtures**: truncated XLSX, wrong-type cells, corrupt
   JSON, broken PDF — each rejected cleanly with state intact.
4. **An `innerHTML` inventory test** that fails when a new assignment
   appears without review, so the count cannot grow silently.

## Scoring (from `merit-quality-program` §15)

- **Minimum gate** — no XSS from any imported or typed string.
- **9** — fixtures for guest names, notes, venue/event names, OCR text and
  Teach AI input all pass, and each of the 13 `innerHTML` sites is accounted
  for.
- **10** — plus CSP-ready and no guest data in logs or exports that should
  not carry it.

Until fixtures 1–3 exist and pass, this dimension cannot be scored above
**5**, however clean the code reads.
