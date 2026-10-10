# Acceptance matrix — audit of `602ba27` and the work that follows it

Opened 2026-10-10 at `602ba27` (the commit the audit was written against;
HEAD at the start of this work). Every row ends in one of three states, and
only these three:

- **1 · DONE** — applied, and the behaviour it is about was exercised and verified (evidence named).
- **2 · READY, BLOCKED** — code is in place; a named external dependency prevents live verification.
- **3 · REJECTED BY EXPERIMENT** — measured to be unsuitable; the chosen alternative and its evidence are named.

A row with no evidence is OPEN, whatever the code looks like.

## 3 · Audit findings (fix with a failing test first)

| id | finding | state | evidence |
|---|---|---|---|
| A1 | one reservation, several billable fallback attempts | 1 · DONE | `vlm-budget` (red on 602ba27: one hold $0.26 vs two billed hops); fallbacks off by default, explicit priced chain held per hop; `VLM_FALLBACKS=default` refused (`UNBOUNDED_FALLBACK`) |
| A2 | chars/3 presented as an upper bound | 1 · DONE | relay counts input with the free `count_tokens` (+5%, +64) per hop model; no count → `inputBasis:"heuristic"`; status names the basis (`vlm-budget`) |
| A3 | connection / 5xx results counted as free; retries not accounted | 1 · DONE | connection error / 5xx / timeout / cancel → `billed:null`, hold kept; each retry reserves anew (`vlm-budget`: cut connection then success = 2 holds, 1 unknown) |
| A4 | reservation identity, day, settlement, release | 1 · DONE | `UsageStore.reserve()` returns an id stored with its day; `settle(id)` once, a second settle throws (`vlm-budget`) |
| A5 | a request across UTC midnight settles against the wrong day | 1 · DONE | reserved 23:59:50 UTC, settled 00:00:10 → settles on the first day (`vlm-budget`) |
| A6 | unreadable `usage.json` opens as zero spend | 1 · DONE | truncated JSON → `CORRUPT`, `reserve` throws `LEDGER_CORRUPT`, file untouched, relay refuses with no upstream call (`vlm-budget`) |
| A7 | crash / restart / concurrent writers | 1 · DONE | pid lock (`LEDGER_LOCKED` for a second relay), fsync + rename, unsettled reservation survives restart (`openReservations`) (`vlm-budget`) |
| A8 | prices verified against the official source; unknown price never guaranteed | 1 · DONE | `PRICES_AS_OF 2026-10-10` against platform.claude.com pricing (fetched 2026-10-10); Haiku 5.5 >100K tier; unknown model or hop → `UNKNOWN_PRICE` |
| B1 | seat-count suggestion overrides a confirmed object | 1 · DONE | `acceptPlan`: seat count on a non-unreviewed object or over a person-typed count → `ALREADY_DECIDED` (`vlm-decisions`, red on 602ba27) |
| B2 | a rejected object re-offered as "missing" at the same place | 1 · DONE | missing where a rejected object of the same family stands → `REJECTED_HERE` (`vlm-decisions`) |
| B3 | protection by identity, region and analysis version, in app logic | 1 · DONE | also against plan memory rejections (survive re-analysis); identity = family + place, analysis via `staleReason`; reopening goes through the review's own controls (`vlm-decisions`) |
| C1 | `heldBack` read as `=== true`; real shape is `{reason}` | 1 · DONE | `heldBack` sent as the `lowEvidence.reason` code (closed set, unknown → `other`); relay refuses anything else (`vlm-decisions`, `vlm-relay`) |
| D1 | VLM add / seat change outside the one decision + undo path | 1 · DONE | `addObject` / `addChair` / `setSeats` are `MeritReviewDecisions` kinds; `decideReview` creates, writes, remembers, labels, audits and sets the finding state in one transaction; `undoReviewDecision(event, id)` reverses all, refusing if a later decision touched the object (`vlm-reading`) |
| D2 | accepted `c.seats` lost when the plan is confirmed | 1 · DONE | person-settled count on a chairless table → capacity, `HUMAN_CONFIRMED`, `capacityEvidence.via` (`vlm-reading`: 10 → 10, survives reload) |
| D3 | physical / printed / person-confirmed capacity kept as separate sources | 1 · DONE | physical = chairs found at the table (the plan verdict alone no longer makes one physical — it fabricated chairs from capacity on load); printed rule stays `DERIVED_PRINTED_RULE`; person count `HUMAN_CONFIRMED` (`physical-logical-seat-separation` tightened, `vlm-reading`) |
| D4 | accept → undo → re-analyse → Confirm → save/load chain | 1 · DONE | accept → undo (object, memory, training label, finding all back) → accept → re-analyse (object restored from memory — failed before: created objects were not remembered as manual) → Confirm → save → reload (`vlm-reading`) |
| D5 | an accepted chair attached to its table | 1 · DONE | missed chair within reach of a table → that table's `chairDetections`; confirmed table not changed; far chair stays free-standing (`vlm-decisions`, `vlm-reading`) |
| E1 | type-blind COVERED blocks a real nested object | 1 · DONE | COVERED only for the same family at the same place (IoU ≥ 0.4, or ≥80% contained with ≥50% area ratio); nested table-in-loca, column-on-table offered (`vlm-decisions`) |
| E2 | local output validator looser than the API schema | 1 · DONE | top level and every finding must have exactly the schema's keys; else `INVALID_OUTPUT` / dropped with a code (`vlm-relay`) |
| E3 | dropped findings and clamped boxes invisible | 1 · DONE | dropped reasons (closed codes), clamped boxes, objects/text not sent over the cap: stored on the reading and listed in the panel in TR/EN (`vlm-reading`, `vlm-relay`) |
| F1 | `xlsx@0.18.5`: advisories, licence, fixed version on CDN and offline | OPEN | |
| F2 | inventory of CDN / model / WASM assets | OPEN | |
| F3 | import/export compatibility, hostile and large files after the change | OPEN | |

## 4 · Plan understanding

| id | item | state | evidence |
|---|---|---|---|
| U1 | measured effect of resolution on small objects | OPEN | |
| U2 | whole-plan reading + overlapping native-resolution tiles, one coordinate system, merged | OPEN | |
| U3 | coverage: what was inspected, what was not, what was cut | OPEN | |
| U4 | structural model: identity, type, geometry, source, confidence, decision, uncertainty per object | OPEN | |
| U5 | relations: chair→table, table→group/loca/zone, merged tables, venue furniture, facing, printed numbers | OPEN | |
| U6 | capacity: printed vs seen vs banquette vs confirmed, and which objects cause the gap | OPEN | |
| U7 | number duplicates and OCR–model disagreement go to review; a model number is never a fact | OPEN | |
| U8 | PDF vector geometry (transforms, clipping, text, paths); raster / vector / mixed | OPEN | |
| U9 | memory under rotation, scale, perspective, colour, quality; twins abstain | OPEN | |

## 5 · Tools

| id | candidate | state | evidence |
|---|---|---|---|
| T1 | SAHI-style sliced scanning | OPEN | |
| T2 | RF-DETR (or licensed alternative) for plan symbols | OPEN | |
| T3 | PP-OCRv5 vs the current OCR | OPEN | |
| T4 | ONNX WebGPU / worker where a bottleneck is measured | OPEN | |
| T5 | PDF.js vector geometry | OPEN | |
| T6 | CVAT / FiftyOne for labelling and error review | OPEN | |
| T7 | LightGlue or a simpler method for plan alignment | OPEN | |
| T8 | Qwen3-VL as a local VLM | OPEN | |
| T9 | GroundingDINO / SAM | OPEN | |

## 6 · New plans

| id | item | state | evidence |
|---|---|---|---|
| N1 | 5–10 real plans from different venues, split by venue | OPEN | |
| N2 | per-class / per-venue precision & recall, misses, phantoms, relations, numbers, capacity, facing, geometry | OPEN | |
| N3 | corrections / 100 objects, operator time, memory keep / wrong-apply, VLM before/after, cost, p50/p95, memory | OPEN | |
| N4 | targets: ≥98% precision, ≥95% recall per class on blind plans; ≤5 corrections/100; zero decision/record loss | OPEN | |

## 7 · Operator experience

| id | item | state | evidence |
|---|---|---|---|
| X1 | one click from a finding to its place on the source image | OPEN | |
| X2 | "why did it think this?" with image and relation evidence | OPEN | |
| X3 | uninspected / unreadable areas visible | OPEN | |
| X4 | capacity contradictions explained | OPEN | |
| X5 | every accept undoable | OPEN | |
| X6 | scene queries ("tables with no number read", "locas next to the stage") | OPEN | |
| X7 | changes between plan versions and kept decisions | OPEN | |
| X8 | TR/EN, viewports, keyboard, error states | OPEN | |
| X9 | send confirmation names personal data printed on the plan | OPEN | |
| X10 | no network / no model: local analysis unaffected | OPEN | |

## 8 · Delivery

| id | item | state | evidence |
|---|---|---|---|
| V1 | targeted suites, then full suite, offline packages, performance, CI | OPEN | |
| V2 | clean-environment install and the Codespaces flow | OPEN | |
| V3 | real-model pilot (needs the owner's secret, balance and approval) | OPEN | |
