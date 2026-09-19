# What happens after a real person has used it

Section 27. The rules that bind the *result* of an operator session, written
down **before** any session has happened — which is the only time they can be
written honestly, because nobody yet knows what the result will be.

A test whose consequences are decided after seeing its outcome is not a test.
This file fixes, in advance: what counts as a finding, which findings oblige
work, what the session may and may not be reported as, and when it must be run
again.

## Status: **NO SESSION HAS BEEN RUN.** This contract is unexercised.

---

## 1. Every observation is classified, and the classes are fixed

Each thing written on the observer sheet or given as an answer lands in exactly
one class. The class determines the obligation. Nothing is "noted for later"
without a class — that is where findings go to die.

| class | what it means | obligation |
|---|---|---|
| **DEFECT** | The product did something incorrect, or lost/altered data, or said something untrue. | Fix before the desktop build. Non-negotiable, regardless of how the operator felt about it. |
| **BLOCKER** | They could not complete the task, or completed it wrongly without noticing. | Fix before the desktop build. |
| **FRICTION** | They completed it, but slowly, by the wrong route, or after visible confusion. | Triage. Fix, or record as accepted with a reason. Never silently dropped. |
| **VOCABULARY** | A word the product uses that they had to ask about, or renamed in their own words. | Change the word, or write down why the product's word must stay. |
| **MISSING** | Something they looked for that does not exist. | Record in the backlog with their exact wording. Not necessarily built. |
| **PREFERENCE** | They would rather it looked/worked differently, with no cost to correctness or speed. | Record. No obligation. |
| **CONTAMINATED** | Happened after the facilitator broke script, or after a product defect had already derailed the session. | Excluded from conclusions, and the exclusion is stated. |

**One operator's PREFERENCE is not a mandate and one operator's BLOCKER is not
a statistic.** A single session finds real defects reliably and measures
nothing reliably. Both halves of that matter: do not dismiss a blocker as
anecdote, and do not promote a timing to a benchmark.

## 2. What obliges a change, and what does not

Obliges work before the desktop build:

- Any **DEFECT** or **BLOCKER**, always.
- Any **FRICTION** on the *first* two minutes of either session. What the
  product does to somebody who has just opened it is not a matter of taste.
- Any **VOCABULARY** finding on a term that appears in a destructive or
  irreversible control.

Does not oblige work:

- A **PREFERENCE**, however strongly expressed.
- A **MISSING** item that is out of the product's stated scope.
- Anything the operator did faster the second time. That is learning, and the
  second session was always going to be faster.

**Speed is not a finding on its own.** There is no baseline for a good review
time and this project refuses to invent one. A timing becomes a finding only
when it is attached to an observation — "spent 4 minutes on the disagreement
list and then ignored all of it" is a finding; "review took 11 minutes" is a
number.

## 3. Findings that contradict a measured internal result win

`benchmarks/review-order/` measured that ordering the queue by what one answer
settles is worth 40% over ranking by cost class. If the operator works entirely
off-queue, **the operator is right and the measurement is irrelevant** — an
improvement to an artefact nobody reads is worth zero, and the 40% figure must
not be quoted afterwards as though the session had not happened.

The same applies to the interpreter's 0.9130, the consolidation from thirteen
questions to five, and every other internal number. They measure the
information. The session measures whether a person can use it. When they
disagree, the session is the one about the product.

This clause exists because the opposite is the natural instinct: to explain the
operator's behaviour in terms of the metric rather than re-reading the metric in
terms of the operator.

## 4. What may be reported afterwards

After one completed session, on both plans, with the report and the 14 answers
in hand, exactly this may be written:

> REAL OPERATOR SESSION: COMPLETED (1 operator, 2 plans, [date]).
> FINDINGS: n DEFECT, n BLOCKER, n FRICTION, n VOCABULARY, n MISSING.

What may **never** be written on the basis of one session:

- ~~REAL OPERATOR USABILITY: PASS~~ — one person is not a usability verdict.
- ~~VERIFIED~~, against anything.
- Any percentage, success rate, or time that is presented as characteristic
  rather than as what one person did once.
- "Operators find…" / "Operators prefer…" — one person is not *operators*.

If every finding is fixed and nothing was a DEFECT or a BLOCKER, the honest
line is still only:

> REAL OPERATOR SESSION: COMPLETED. NO BLOCKING FINDINGS. USABILITY: MEASURED ONCE.

**MEASURED ONCE is a status, not a stepping stone to VERIFIED.** Reaching
VERIFIED needs more sessions with more people, and this contract does not
define that threshold, because defining it now — before knowing what one
session even looks like — would be inventing rigour rather than having it.

## 5. What obliges a re-run

The session must be run again, with a person who has not seen the screen, when
any of these is true:

- A **BLOCKER** was fixed. The fix has not been tested on a fresh person, and
  the original operator can never be fresh again.
- The review screen's ordering, wording, or its Worth deciding / disagreement
  presentation changed materially.
- A third plan family arrives (see `../heldout/THIRD-PLAN-PROCEDURE.md`). The
  two sessions cover PHYSICAL and SYMBOLIC; a new representation is a new
  session.
- More than one full programme phase has landed since the last session.

A re-run uses a **new operator**. Re-running on the same person measures how
well they remember the previous session.

## 6. Where the result lives

- The raw report and observer sheets: attached to the PR or issue that
  commissions the session, verbatim, including the contaminated parts.
- The classified findings: one row each, with their class, in that same place.
- The status line: `README.md`'s status block in this directory, updated to
  exactly one of the permitted strings in §4.
- Any obliged fix: a real commit with a real test, per the project's normal
  rules. **A finding closed by editing this documentation is not closed.**

## 7. The clause this file exists for

The pressure after a session is to summarise it into something that sounds like
progress. Resist specifically these:

- Reporting the count of findings without the classes, so BLOCKER and
  PREFERENCE weigh the same.
- Reclassifying a BLOCKER as FRICTION because it was fixed quickly.
- Quoting the operator's most favourable sentence and omitting question 10's
  reason.
- Treating "they finished the task" as the headline when the observer sheet
  says they finished it by a route the product did not intend.
- Letting the *existence* of this contract, or of the test kit, stand in for
  having run the session. Infrastructure being ready has never been the same
  thing as a person having used the product, and the whole point of writing
  this down in advance is that it stays true when it is inconvenient.
