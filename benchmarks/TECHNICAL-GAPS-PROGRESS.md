# Technical gaps — progress

The one short progress file for closing the gaps `FINAL-COMPLETION-MATRIX.md`
lists. Fixed test copy: commit `3bfb246` (packages delivered from it; the
`test-kopya-3bfb246` tag could not be pushed through this session's git proxy).

| # | area | state | evidence |
|---|---|---|---|
| 4 | offline packages | OCR now runs when the folder package is opened by double-click (it did not: Chrome refused the OCR worker from `file://`). Verifier opens it from disk: OCR reads the text, a PDF renders, zero off-origin requests; folder build source completeness asserted. The single-file build stays OCR-less by design and says so. | `verify-offline-package` 33/33; the old delivered package fails 4 of the new checks |
| 1 | critical changes through one gate | Each single writer (arrival, availability, handover, freeze create/lift) now refuses a historical event itself. Found and fixed: a duplicated event kept each guest's check-in moment; a second raw arrival writer (dead Live binder) removed; **a guest import from a wizard left open landed on a historical event** — the import now refuses; three dead assignment writers stubbed. | `domain-writers` 18/18; the previous code fails 5 checks; writer-guard and caller-guard mutations each caught |
| — | naming | "Teach AI" → "Teach the Plan" / "Plan Öğretimi"; the AI-wording check has no exemption left | `1074c2e` |
| 3 | stored records | **One bad record no longer takes every event away**: a non-list `guests`/`tables`/`audit`/`venues`, a null guest or a non-record venue used to make the whole store unreadable (the operator met an empty app); a null/text event became a fabricated "Untitled Event". Now the unreadable part is set aside unchanged (persisted, in every backup, downloadable), the rest opens, a banner says so; imports stay all-or-nothing. Every save is read back; a mismatch raises its own notice. Availability survives save→reload; a change made just before closing survives. | `resilience-records` 37 checks; the previous code fails 30; save-queue drain unchanged within noise (224/265 ms vs 235/303) |
