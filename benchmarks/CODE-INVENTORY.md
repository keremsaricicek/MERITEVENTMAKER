# Dead code and duplication — inventory

**Nothing in this document has been deleted or merged.** It is the recorded
evidence that `.claude/rules/code-health.md` requires *before* a dead-code or
de-duplication pass: "dead code is deleted only with recorded proof of
unreachability, and a shadowed function is not an unused one."

Every entry carries one of five classifications:

| | |
|---|---|
| **SAFE TO REMOVE** | proven unreachable; deleting it changes nothing |
| **SAFE TO EXTRACT** | genuinely duplicated logic, one behaviour, no domain difference |
| **NEEDS TEST FIRST** | probably removable or mergeable, but nothing would fail if the judgement were wrong |
| **DO NOT MERGE** | looks duplicated, is load-bearing, merging it would change behaviour |
| **KEEP — DOMAIN DIFFERENCE** | looks duplicated, encodes two different product facts; merging is a revert |

---

## 1 · Dead code

### 1.1 Unreferenced functions: **zero**

```
node /tmp/…/deadcode.mjs        # method described below
top-level functions defined in app-v8.js: 266
candidates with no code reference beyond their definition: 0
```

Method: strip comments and string literals from every file in `src/` with
`tests/lib/js-scan.mjs`, then require each of `app-v8.js`'s 266 top-level
functions to have at least one reference beyond its own definition — with
`index.html` checked separately, because a handler can be reached from
markup.

**Classification: nothing to remove.**

#### The measurement that was wrong first

An earlier run of exactly this method reported **14 unreferenced functions**:

```
analysisNoticeText  ccReasonHTML  detectionDiagnosticsHTML
difficultQuestionCardHTML  guestPartyCellHTML  impactWords
numberSourceText  planIntelBottomPillHTML  reasonText
reviewCenterPanelHTML  reviewGroupTitle  reviewPoiCardHTML
upcomingLineHTML  wizIssueText
```

All fourteen are live. Every one of them is called from inside a **nested**
template interpolation — `` `${rows.map(r => `<li>${esc(reasonText(r))}</li>`)}` `` —
and the scanner was treating the inner backtick as opening a plain string,
blanking the interpolated code along with the text. `reasonText` is called at
`src/app-v8.js:1911`; `reviewPoiCardHTML` at `:7922`; `impactWords` at
`:7629`; `upcomingLineHTML` at `:1099`.

The scanner was fixed (`tests/lib/js-scan.mjs` now keeps a real template
stack) and the count went from 14 to 0. **A dead-code pass run on the first
measurement would have deleted fourteen working functions and the app would
have thrown on first render.** The nested-template property is now asserted by
`tests/suites/dependency-direction.test.mjs` so the scanner cannot regress
into it silently.

### 1.2 The `original` capture: 21 dead **references**, 0 dead functions

`app-v8.js` opens with `const original = {…}`, capturing 33 pre-v8 function
references so the override layer can still call them. Measured
classification (`tests/suites/boot-contract.test.mjs`):

| Class | Count | What it means |
|---|---|---|
| **delegated** | 12 | v8 overrides the name **and** calls `original.X(…)`. The captured reference is live. |
| **shadowed** | 20 | v8 fully replaces the name. The **captured reference** is unused — the function is not. |
| **untouched** | 1 | v8 never reassigns it (`inspectorHTML`). The `app.js` implementation is the live one. |

**Classification: NEEDS TEST FIRST** — and the test now exists, which is why
this entry can be closed as *do not remove*.

This repo has previously written down the figure "21 unreachable functions."
That is wrong, and the error is the dangerous direction: **21 unreachable
capture entries, not 21 dead functions.** All 21 names are live at runtime —
20 running v8's version, 1 running `app.js`'s. Deleting them would break the
app. `boot-contract` makes the distinction permanent by booting the real app
and reading each function back out of the page.

One of the 20 is worth naming: **`bindCommon` is overridden by *alias*** —
`bindCommon = bindV8Common;` — not by a function literal. A classifier
matching `= function` or `= (` misfiles it as untouched. The suite's positive
control caught exactly that.

### 1.3 Removable, with proof: none found

No unreferenced function, no unreachable branch with recorded proof. The one
category that would qualify — the 21 capture entries — is covered above and is
**not** removable.

---

## 2 · Duplication

Measured by token-shingle Jaccard similarity over every multi-line top-level
function in the three shell files (`app.js`, `app-guests.js`, `app-v8.js`);
210 functions compared, threshold 0.45.

```
pairs with Jaccard >= 0.45: 3
0.65  teachTableNumber      <->  teachSelectedObject
0.54  sameObject            <->  boxIoU
0.47  partyMetaHTML         <->  guestPartyCellHTML
```

Three pairs in 210 functions. The file is long; it is not repetitive.

### 2.1 `teachTableNumber` / `teachSelectedObject` — **SAFE TO EXTRACT**

`src/app-v8.js:7034` and `:7078`. Similarity 0.65.

Both do the same seven steps: refuse if `MeritTeachArea` is absent, gather
live candidates, build a lesson, refuse on `!r.ok` with the module's reason,
push to `state.teachings`, `saveState()`, write an audit entry, toast, then
`applyTeachArea` → `recomputePlanIntelligence` → `touchEvent` → `render`.

What differs is genuinely different and must stay parameterised, not
defaulted:

- **subject** — `{kind:"tableNumber", value:n}` vs
  `{kind:"objectIdentity", objectKind, type, label}`
- **audit action** — `TEACH_AREA_NUMBER_CONFIRMED` vs `TEACH_AREA_LESSON_KEPT`
- **`from.printedNumber`** — `{state:"VERIFIED", value:n}` vs
  `c.printedNumber||null`. **This one is load-bearing.** The number the
  operator is confirming is what identifies the object from then on; if the
  extracted helper defaulted it, a venue-scoped lesson would be refused by the
  very rule the operator has just satisfied.
- **validation** — the number path rejects non-integers before doing anything

Proposed shape: `keepLesson(event, {scope, subject, from, auditAction,
toastFn})`, with `printedNumber` passed in by each caller. Saves ~18 lines and
removes the risk of the two paths drifting on the store/audit/re-apply
sequence.

Covered by `plan-teach-area` and `teach-number`. **A characterization test
asserting the venue-scope refusal through the app path is listed as missing in
`APP-V8-OWNERSHIP-MAP.md` (A23) and should be written before this extraction,
not after.**

### 2.1b Two `otsu` implementations — **NEEDS TEST FIRST**

Found by Split A-1's crossing analysis, which reported that
`src/plan-embedding.js` names `otsu` — and it does, its own:

| | `plan-detection-deskew.js:otsu` | `plan-embedding.js:otsu` |
|---|---|---|
| signature | `otsu(hist, total, sum)` | `otsu(pixels)` |
| input | a histogram the caller already has | raw pixels of a 32×32 crop |
| why | `detect()` builds luma and colour histograms in ONE pass over the image; re-walking it to threshold would undo that | the descriptor reads the same crop the encoder sees, and has no histogram to hand |

Same algorithm, two different input contracts, and each contract exists for a
stated reason. The mergeable shape would be one `otsuFromHistogram` plus a
caller-side histogram build — which is what both already are, differing only
in who builds the histogram.

**Not merged, and not while a structural move is in flight.** The embedding's
copy carries a comment explaining that it deliberately does not reuse the
app's descriptor path, so that "two halves of one vector come from one input";
merging the threshold without re-reading that argument risks changing what the
descriptor measures, and `benchmarks/embedding/descriptor.mjs` is what would
have to say whether it did. **A structural move is not the place to decide a
duplication question**, which is why this is recorded rather than acted on.

### 2.2 `sameObject` / `boxIoU` — **KEEP — DOMAIN DIFFERENCE**

`src/app-v8.js:3923` and `:3931`. Similarity 0.54.

Both compute the same intersection rectangle in their first three lines. They
then answer **different questions**:

```js
sameObject: inter / Math.min(areaA, areaB) > .5
            && Math.max(areaA,areaB) <= Math.min(areaA,areaB) * sizeRatio
boxIoU:     inter / (areaA + areaB - inter)
```

Intersection-over-**minimum** plus a size-ratio guard answers "are these two
detections the same physical object?" — a small box fully inside a large one
scores 1.0 and is then rejected by the ratio guard. Intersection-over-**union**
answers "how much do these two boxes agree?" — the same pair scores low. They
disagree by design, and the detector depends on both.

At most the three-line intersection computation could become
`intersectionArea(a,b)`. That is six lines saved against the risk of someone
later "simplifying" two detector predicates into one. Not worth it.

### 2.3 `partyMetaHTML` / `guestPartyCellHTML` — **KEEP — DOMAIN DIFFERENCE**

`src/app-v8.js:2496` and `:3111`. Similarity 0.47.

Same visual fragment, two screens, **different i18n keys**: `live.partyOf` /
`live.companionsOf` versus `guests.partyOf` / `guests.companions`. The Guests
version additionally renders the note indicator and wraps the result in a name
block; the Live version returns a bare fragment.

Merging them would couple Live's operational copy to the Guests screen's copy,
so a wording change at the door would silently change the guest list. The
shared part that is genuinely identical is the VIP tag and the pax dots —
`paxDotsHTML` is already a shared function, which is the extraction that was
already correctly made.

### 2.4 `occupiedSeatIndexes` / `liveUsedIndexes` — **KEEP — DOMAIN DIFFERENCE**

`src/app.js:46` and `src/app-v8.js:292`.

Not returned by the scan: `occupiedSeatIndexes` is a one-line function and
falls below the scan's multi-line floor. Checked by hand, because it is the
standing example in this codebase and the one most likely to be "cleaned up"
by someone counting lines.

The two functions differ by **one clause**:

```js
occupiedSeatIndexes:  if (g.id !== exceptGuestId && g.assignment?.tableId === tableId) …
liveUsedIndexes:      if (except.has(g.id) || g.arrivalStatus === "No Show") return; …
```

That clause is the product. `occupiedSeatIndexes` is **planned** seating — a
No Show keeps their seat, so the plan and the exported workbook stay correct.
`liveUsedIndexes` is **live** occupancy — a No Show frees the chair tonight.
`CLAUDE.md` and `.claude/rules/product.md` both state this, and
`.claude/skills/merit-product-contract/SKILL.md` names merging them as a
contract violation.

**Merging these is a revert, not a refactor.** They are deliberately two
functions and must stay two functions even when a future extraction puts them
in the same file.

---

## 3 · Table-level writes outside the sanctioned writer — **NEEDS TEST FIRST**

Not duplication, but found by the same sweep and belonging in the same
inventory: `.claude/rules/product.md` says `table.capacity` and `table.chairs`
go through `setTableCapacity`/`syncTableChairs`, never one without the other.
Measured write sites:

| Site | Field | Verdict |
|---|---|---|
| `app-v8.js:126,128` (`syncTableChairs`) | both | the sanctioned writer |
| `app-v8.js:1731` (`duplicateSelection`) | `chairs` | **DO NOT MERGE** — re-ids chairs onto a cloned table; routing through `syncTableChairs` would regenerate geometry and lose a hand-placed layout |
| `app-v8.js:8404` (`duplicateEvent`) | `chairs` | **DO NOT MERGE** — same, for a duplicated event |
| `app-v8.js:8080` (`commitCandidates`) | both | **DO NOT MERGE** — writes detected chair coordinates **verbatim**, then sets `capacity = chairs.length`. `.claude/rules/ai.md`: "Confirmed chair coordinates from a candidate are written verbatim — never regenerated into a synthetic ring." |

All three exceptions are correct, and the problem used to be that **none of
them was protected by a test**: if a future de-duplication pass routed
`commitCandidates` through `syncTableChairs` to "keep capacity and chairs in
sync," every confirmed chair would be replaced by a synthetic ring, the
detector's real coordinates would be lost, and no suite would fail.

**`commitCandidates` is now covered** by
`tests/suites/confirmed-chair-coordinates.test.mjs`, which drives the real
review-screen confirm button and asserts the committed chairs EXACTLY, on
position and rotation, against coordinates derived from the same inputs rather
than copied from a passing run. The chairs it plants are deliberately
irregular — three along one side at uneven spacing, one alone opposite —
because a generator produces four points at 90° on a circle, which is
plausible, tidy, and a fabrication an operator cannot spot on the floor plan.

**The mutation is the exact refactor named above**, and it confirms the whole
claim: routing through `syncTableChairs` replaces the detector's coordinates
with a ring at 0°/90°/180°/270°, the new suite fails eight checks — and
`physical-logical-seat-separation`, the existing suite in this area, **passes**.

The suite also covers the negative half through the same path: a table
committed off a SYMBOLIC plan carries **no chair objects at all**, with
`capacitySource: "UNKNOWN"` rather than a ring flagged as unreal.

`duplicateSelection` and `duplicateEvent` remain uncovered; both are
**DO NOT MERGE** for the same reason and neither is on the detector's path.

---

## 4 · Summary

| Classification | Count | Items |
|---|---|---|
| SAFE TO REMOVE | **0** | — |
| SAFE TO EXTRACT | **1** | `teachTableNumber`/`teachSelectedObject` (2.1) |
| NEEDS TEST FIRST | **3** | the `original` capture (1.2, now covered); verbatim chair writes (3); the two `otsu`s (2.1b) |
| DO NOT MERGE | **3** | the three chair-write exceptions (3) |
| KEEP — DOMAIN DIFFERENCE | **3** | `sameObject`/`boxIoU`; `partyMetaHTML`/`guestPartyCellHTML`; `occupiedSeatIndexes`/`liveUsedIndexes` |

**There is no dead code to delete and one duplicate worth extracting.** The
useful output of this sweep was not a cleanup list — it was two things that
would have looked like cleanups and were not: fourteen live functions a broken
scanner called dead, and four "inconsistent" chair writes that are each
deliberate and unprotected.
