---
name: merit-resilience-hardening
description: The failure-handling contract for MERIT ENTERTAINMENT — EVENT MAKER — storage exhaustion, IndexedDB failure, corrupted persisted data, malformed imports, detector and OCR failure, async races, and save/restore failure. Defines the DETECT / CONTAIN / INFORM / RECOVER / PRESERVE model every failure path must satisfy. Use for any error-handling work and before claiming a resilience score.
---

# MERIT Resilience Hardening

This product runs at an event. When something fails, the operator is
standing in front of a queue, not at a desk with a debugger. The measure of
resilience here is not whether the app avoids errors — it is whether the
evening continues.

**The data is the event.** A guest list rebuilt from scratch at 21:00
because a save failed silently is the worst outcome this product can
produce, worse than a crash, because a crash is at least visible.

## Where this dimension actually stands

Measured at `65ea956`: **zero suites named for resilience.**
`offline-recovery` and `backup-restore` cover two real paths well. Every
other failure mode in the table below is unmeasured.

## THE MODEL — five things, every failure path

| | |
|---|---|
| **DETECT** | The failure is noticed where it happens. No silent `catch {}`. |
| **CONTAIN** | It does not cascade. One broken event does not take down the app; one bad row does not abort the import mid-write. |
| **INFORM** | The operator is told, in Turkish, what happened and what to do — never a raw `error.message`. |
| **RECOVER** | There is a path forward: retry, restore, skip, or continue read-only. |
| **PRESERVE** | Data that was correct before is still correct after. |

A path satisfying four of five is not resilient. The one most often missing
is **INFORM**, and the one that matters most is **PRESERVE**.

### Silent catch is forbidden
`catch {}` and `catch (e) {}` with an empty or comment-only body hide the
failure from everyone, including the next engineer.

The one legitimate exception is **expected abstention** — a path where
failure is a normal outcome, already modelled, and reported through the
product's own vocabulary. `plan-ocr.js` reporting OCR unavailable rather
than faking a result is the reference example: the failure is detected,
contained, and surfaced honestly as "not available". That is a designed
answer, not a swallowed error, and it must carry a comment saying so.

### Raw `error.message` never reaches the operator
It is untranslated, often meaningless (`QuotaExceededError`), and sometimes
leaks internals. `i18n-key-integrity` already guards toasts against this —
extend the same discipline to dialogs, inline errors and status text.

## The failure modes

Each needs a test. None has one today unless marked.

**Storage**
- storage quota exhausted mid-save
- IndexedDB unavailable (private mode, blocked, corrupted)
- IndexedDB open succeeds, transaction fails
- write succeeds, read-back returns something different
- save during unload

**Persisted data**
- malformed JSON in the state record
- a schema version from the *future* (a newer build wrote it)
- a guest referencing a table that no longer exists
- an assignment referencing a seat index beyond capacity
- audit log at its cap *(partially covered — `audit-trail`)*
- corrupted primary record *(covered — `offline-recovery`)*

**Import / export**
- corrupt or truncated event package
- corrupt backup *(covered — `backup-restore`)*
- XLSX with wrong types, missing columns, or 50k rows
- CSV with a broken quote run
- PDF that fails to render, or renders one page of forty
- export while storage is failing

**Plan Intelligence**
- detector throws mid-analysis
- detector returns partial results
- OCR unavailable *(covered by design — `plan-ocr.js`)*
- analysis of an image too large to decode
- re-analyze while a previous analysis is still running

**Async and ordering**
- two saves racing
- operator acts during an in-flight analysis
- browser refresh mid-write
- operations arriving out of order
- a render that throws mid-screen

## Required evidence

1. A **fault-injection helper** in `tests/lib/` that can make storage fail,
   return corrupt data, and throw from a named boundary.
2. A suite per group above, asserting all five model steps — in particular
   that **state before == state after** for every failed operation.
3. A **static check** that no new empty `catch` appears without an
   expected-abstention comment.
4. Evidence that no raw `error.message` reaches any surface.

Write the test so it fails against today's code first. A resilience test
that passes before the handling exists is asserting nothing.

## Scoring (from `merit-quality-program` §12)

- **Minimum gate** — no raw `error.message` to an operator; no silent catch
  outside a documented expected-abstention.
- **9** — every failure mode above verified against all five model steps.
- **10** — plus fault injection running in CI.

With zero suites, this dimension cannot currently exceed **4**: two paths
are genuinely covered and the rest is unmeasured.
