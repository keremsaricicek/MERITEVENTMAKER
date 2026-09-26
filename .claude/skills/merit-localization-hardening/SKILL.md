---
name: merit-localization-hardening
description: The localization contract for MERIT ENTERTAINMENT — EVENT MAKER — Turkish-first UI, complete second language, and zero hardcoded user-facing English in source. Covers toasts, dialogs, validation, errors, aria-labels, titles, placeholders, Plan Intelligence findings and export UI. Use for any i18n work and before claiming a localization score. Key integrity is necessary but not sufficient.
---

# MERIT Localization Hardening

Turkish is the **default and primary** language. English is secondary. The
operators are Turkish-speaking hospitality staff working at speed; an
English sentence in the middle of a Turkish screen is not a cosmetic flaw,
it is a hesitation at a door with a queue.

## Where this dimension actually stands

Measured at `65ea956`:

| | |
|---|---|
| `t()` call sites in `src/` | **838** |
| Translation keys | **1,164** |
| Suites | `i18n`, `i18n-key-integrity` |

`i18n-key-integrity` is genuinely strong: it checks statically, across every
call site, that each key exists and carries both languages — including the
error paths no rendering test reaches. It also guards against a bare
`error.message` reaching a toast.

## THE RULE THAT DECIDES THIS DIMENSION

> **Key integrity proves the keys are complete. It does not prove the
> strings went through keys at all.**

`t("guests.empty")` is checked. `"No guests yet"` written directly into a
template is invisible to every existing check — the key set stays perfect
while English reaches the screen. **That gap is the whole remaining work in
this dimension**, and closing it needs a different check, not a better
version of the existing one.

## What must be true

### Everything user-facing goes through `t()`
Not only visible body text:

- toast messages, of every severity
- dialog titles, bodies, and button labels
- validation messages, and errors linked to fields
- confirmation text
- empty, loading and error states
- **`aria-label` and `title` attributes** — an English accessible name in a
  Turkish UI is both a localization and an accessibility defect
- `placeholder` text
- Plan Intelligence findings, review questions, and detector status
- Plan Doctor / Risk Radar finding text and their "where to go" labels
- export and report UI (sheet *contract* names are a separate matter, below)
- onboarding callouts
- historical / read-only mode explanations
- storage, offline-recovery and import/export error text

### Domain identifiers are not user-facing text
This distinction is load-bearing and easy to get backwards.

**Never translate** — these are data, and translating them corrupts records
or breaks the report contract:
- zone identifiers (`VIP FRONT`, `MAIN FLOOR`, `BISTRO`, …)
- table type identifiers (`round`, `square`, `rectangle`, `bistro`)
- planning / arrival status values as **stored**
  (`Confirmed`, `Tentative`, `Not Arrived`, `Checked In`, `No Show`)
- table number prefixes (`T`, `B`, `VIP`)
- XLSX sheet names and the `GUEST OF [NAME]` export format, which the
  reports contract fixes
- audit action codes, schema field names, provider ids

**Always translate** — the *label shown for* each of the above. The stored
value is `No Show`; what the operator reads is Turkish. Keep the mapping in
one place so a label change never becomes a data change.

If you are unsure which side something is on, ask: *would changing this
string change a stored record or an exported file?* If yes, it is an
identifier.

### Turkish quality, not translated English
- Turkish is the source language for new strings, not an afterthought.
- Respect Turkish suffixation in interpolated strings — build a whole phrase
  per case rather than concatenating a suffix onto a variable.
- Pluralisation handled per language, not by appending "s".
- Dates, times and numbers formatted per locale.
- Longer Turkish strings must not break layout — this is a
  `visual-qa-reviewer` handoff, at both viewports.

## Required evidence

1. **`i18n-key-integrity`** — exists and passes. Keep it.
2. **`i18n`** — no raw key reaches the screen; both languages render. Keep it.
3. **A hardcoded-English scan** of `src/` — **does not exist; build it.**
   It must find a user-facing English literal that never passes through
   `t()`, while not firing on: identifiers from the list above, code
   comments, `console` messages, test fixtures, CSS class names, data
   attributes, and `globalThis.Merit*` names.
   Use `tests/lib/js-scan.mjs` so comments and non-code strings are handled
   correctly — and note that most of this product's user-facing strings sit
   inside **nested template literals**, which a naive scan drops.
   Expect an allowlist. Keep it short, and justify each entry in the file.
4. **Rendered TR + EN screenshots** at 1920×1080 / 2560×1440 / ~1440px, via
   `visual-qa-reviewer`, confirming Turkish default and no layout break.

## Scoring (from `merit-quality-program` §11)

- **Minimum gate** — no raw key reaches the screen; both languages complete.
- **9** — plus zero hardcoded user-facing English in `src/`, including
  `aria-label`, `title`, placeholders and error text.
- **10** — plus TR-first verified in rendered screenshots at both viewports.

Without evidence 3, this dimension cannot exceed **7**: the keys are proven
complete, and nothing proves the strings use them.
