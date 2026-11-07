# Acceptance matrix — audit of `602ba27` and the work that follows it

Opened 2026-10-10 at `602ba27` (the commit the audit was written against;
HEAD at the start of this work). Every row ends in one of three states, and
only these three:

- **1 · DONE** — applied, and the behaviour it is about was exercised and verified (evidence named).
- **2 · READY, BLOCKED** — code is in place; a named external dependency prevents live verification.
- **3 · REJECTED BY EXPERIMENT** — measured to be unsuitable; the chosen alternative and its evidence are named.

A row with no evidence is OPEN, whatever the code looks like. A row whose
measurement falls short of its target is also OPEN, with the number. A
shortfall is not called accepted.

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
| F1 | `xlsx@0.18.5`: advisories, licence, fixed version on CDN and offline | 2 · READY, BLOCKED | advisories verified (CVE-2023-30533 fixed 0.19.3; CVE-2024-22363 fixed 0.20.2; npm stops at 0.18.5, fixed builds only on cdn.sheetjs.com, Apache-2.0). This environment refuses cdn.sheetjs.com and git.sheetjs.com (proxy 403): the tarball cannot be fetched, hashed and pinned here. Recorded OPEN in the inventory with the block |
| F2 | inventory of CDN / model / WASM assets | 1 · DONE | `benchmarks/dependencies/INVENTORY.json` (10 runtime assets incl. CDN, WASM, OCR data, model weights; advisories with status) + `dependency-inventory` suite (bites on a bumped pin); pdf.js `isEvalSupported:false` added (5.7.284 already past CVE-2024-4367) |
| F3 | import/export compatibility, hostile and large files after the change | 2 · READY, BLOCKED | on the current 0.18.5: `xlsx-contract`, `malformed-import`, `hostile-input`, `import-scale` (in the full suite); after the upgrade the same suites plus a before/after TABLE PLAN / GUEST LIST / UNASSIGNED diff are the gate |

## 4 · Plan understanding

| id | item | state | evidence |
|---|---|---|---|
| U1 | measured effect of resolution on small objects | 1 · DONE | `benchmarks/resolution` (real detector, pinned OCR, network refused). Golden at 0.66×: tables R 1.000 → 0.261, chairs 109 → 39 of 113. ORNEK above the 1920 cap: F1 0.985 → 0.967 at native. Printed numbers: 0 wrong at every cap. The cap stays 1920 |
| U2 | whole-plan reading + overlapping native-resolution tiles, one coordinate system, merged | 2 · READY, BLOCKED | `tilePlan` adds tiles only when the overview would shrink the smallest detected object below 12 px. Tiles overlap 12%, are sent at native scale, and their findings map into plan coordinates. A tile beats the overview on a tie (`vlm-decisions`, `vlm-reading`: 4 tiles at scale ≥ 0.99, finding inside its tile). Plumbing verified against a SCRIPTED model. Whether tiles improve a real model's reading needs the pilot (V3) |
| U3 | coverage: what was inspected, what was not, what was cut | 1 · DONE | `coverage()` reports the share seen in detail. Every tile or region not sent, failed or cancelled is named with its reason and hatched on the map. The model's regions over the step limit were silently sliced off before; they are now listed (`vlm-reading`, mutation-checked in `vlm-decisions`) |
| U4 | structural model: identity, type, geometry, source, confidence, decision, uncertainty per object | 1 · DONE | earlier phases: sourced observations per object (`plan-observations`), drawing kind with abstention (`plan-representation`), decisions through one writer with undo (`review-decisions`, `undo-operations`), provenance per table (`table-provenance`), held-back reasons (`held-back-capacity`) |
| U5 | relations: chair→table, table→group/loca/zone, merged tables, venue furniture, facing, printed numbers | 1 · DONE on the two real venues | `relationship-engine` (evidence terms that a benchmark cannot see), `chair-facing` (unknown stays unknown), `plan-number-integrity`, accepted VLM chairs join their table (`vlm-decisions` D5). Per-venue relation P/R on new venues: N2 |
| U6 | capacity: printed vs seen vs banquette vs confirmed, and which objects cause the gap | 1 · DONE | the capacity audit ranks suspect regions for a gap; held-back seats are reported apart, rejected objects excluded (`symbolic-plan-capacity`, `held-back-capacity`, `capacity-provenance`); person-confirmed counts are kept as `HUMAN_CONFIRMED` (D2/D3) |
| U7 | number duplicates and OCR–model disagreement go to review; a model number is never a fact | 1 · DONE | duplicates: `plan-number-integrity` (a person's duplicate is BLOCKING, a reading's is NEEDS REVIEW). Model vs OCR: `numberCheck` gives AGREES / DISAGREES / DUPLICATE / NO_READING on the finding's row, and the number is never applied (`vlm-decisions`, `vlm-reading`). Scene query "tables sharing a number" opens them as a queue (`scene-queries`) |
| U8 | PDF vector geometry (transforms, clipping, text, paths); raster / vector / mixed | 1 · DONE (extraction) · 2 · BLOCKED (use as detection) | `vectorShapes` follows save/restore/cm and the clip. A rotated rect keeps 104×52 px at 30°, a Bézier circle is placed with the y flip, the clip cuts and hides and ends at restore, and an inline image makes the page MIXED (`pdf-text-layer`, SYNTHETIC PDF, clip-restore mutation turns it red). Turning shapes into objects needs a real CAD PDF (N1) |
| U9 | memory under rotation, scale, perspective, colour, quality; twins abstain | OPEN — target not met, improved | 7 transforms of one venue. Identity precision **0.9927**, wrong application **0.0073** (targets met). Retention **0.8012 → 0.8447** after the global transform became affine: rotate-2 went from 14/23 to 21/23 with 0 wrong (`benchmarks/memory/README.md`, baseline re-recorded with its reason). Target 0.98 **not met**: jpeg-q20 (11/23) and blur (19/23) lose objects in re-detection, not in alignment. Twins abstain (`plan-memory`) |

## 5 · Tools

Decisions, licences and evidence: `TOOLS.md`.

| id | candidate | state |
|---|---|---|
| T1 | SAHI-style sliced scanning | 1 · DONE for the model reading · 3 · REJECTED for the detector on today's plans (U1) |
| T2 | RF-DETR (Apache-2.0 N/S/M) | 2 · BLOCKED — labelled plans from ≥5 venues (N1) and a GPU |
| T3 | PP-OCRv5 vs PP-OCRv4 in use | 3 · REJECTED BY EXPERIMENT — ORNEK numbers 145 → 120 right (0 wrong both), Golden identical; v4 kept (`benchmarks/ocr/README.md`) |
| T4 | ONNX WebGPU / worker | 3 · REJECTED — no measured bottleneck it removes; WebGPU absent here and on many laptops |
| T5 | PDF.js vector geometry | 1 · DONE (U8) |
| T6 | CVAT / FiftyOne | 2 · BLOCKED — for labelling N1 |
| T7 | LightGlue or simpler for alignment | 1 · DONE (simpler method) — an affine fit over matched objects recovered the rotated scan (14 → 21 of 23, 0 wrong); LightGlue not needed for the losses that remain, which are detection losses |
| T8 | Qwen3-VL local | 3 · REJECTED for the browser product — 1.9 GB weights, minutes per plan on CPU |
| T9 | GroundingDINO / SAM | 2 · BLOCKED — needs labelled outlines (N1) |

## 6 · New plans

What to send, the venue split, and every metric with its target: `NEW-VENUES.md`.

| id | item | state | evidence |
|---|---|---|---|
| N1 | 5–10 real plans from different venues, split by venue | 2 · BLOCKED | needs the files (NEW-VENUES.md). No third venue is measured, and none is invented |
| N2 | per-class / per-venue precision & recall, misses, phantoms, relations, numbers, capacity, facing, geometry | 2 · BLOCKED | runners exist (`npm run benchmark`, `benchmarks/resolution`, `ornek-stage-walk`); on the two venues: `benchmarks/BASELINE.json` |
| N3 | corrections / 100 objects, operator time, memory keep / wrong-apply, VLM before/after, cost, p50/p95, memory | 2 · BLOCKED | operator time needs a real person; VLM before/after needs the pilot. Neither is simulated |
| N4 | targets: ≥98% precision, ≥95% recall per class on blind plans; ≤5 corrections/100; zero decision/record loss | 2 · BLOCKED | blind venues are required. Zero decision loss holds by test (D1–D4, `vlm-reading` save/reload) |

## 7 · Operator experience

| id | item | state | evidence |
|---|---|---|---|
| X1 | one click from a finding to its place on the source image | 1 · DONE | a model finding focuses its box on the map (`vlm-reading`); a ranked review row and a scene question open a queue with the object selected and zoomed (`review-queue`, `scene-queries`) |
| X2 | "why did it think this?" with image and relation evidence | 1 · DONE | table provenance and printed-number evidence (`table-provenance`), visual check (`visual-second-opinion`), the model's quoted evidence and the OCR comparison on each finding (`vlm-reading`) |
| X3 | uninspected / unreadable areas visible | 1 · DONE | hatched tiles/regions and a coverage line (U3); unread numbers as one finding (`plan-number-integrity`) |
| X4 | capacity contradictions explained | 1 · DONE | U6 |
| X5 | every accept undoable | 1 · DONE | D1, per-row Undo (`vlm-reading`) |
| X6 | scene queries ("tables with no number read", "locas next to the stage") | 1 · DONE | `MeritSceneQuery`, closed set, TR/EN, pixel-measured "next to", unknown → the list of questions, never a guess (`scene-queries`, screenshots in `screens/`) |
| X7 | changes between plan versions and kept decisions | 1 · DONE | `layout-changes` (identity by verified number first), memory survives re-analysis (D4) |
| X8 | TR/EN, viewports, keyboard, error states | 1 · DONE | `i18n`, `i18n-hardcoded-english`, `a11y-*`; new screens rendered at 1920×1080 / 2560×1440 / 1440×900 with no console errors (`screens/`) |
| X9 | send confirmation names personal data printed on the plan | 1 · DONE | `vlm.ask.printed` in the confirmation (`vlm-reading` asserts it) |
| X10 | no network / no model: local analysis unaffected | 1 · DONE | without a relay the panel says so and detection runs (`vlm-reading`), offline packages verified (`verify:offline`) |

## 8 · Delivery

| id | item | state | evidence |
|---|---|---|---|
| V1 | targeted suites, then full suite, offline packages, performance, CI | see the PR | full suite, both offline builds and `verify:offline` run on the final commit; CI on the PR |
| V2 | clean-environment install and the Codespaces flow | 1 · DONE (documented, key-less path run here) | `server/CALISTIRMA.md`; `npm ci` then `npm run serve:vlm` with no key reports NOT CONFIGURED and serves the app |
| V3 | real-model pilot (needs the owner's secret, balance and approval) | 2 · BLOCKED | the owner's secret, a balance and an explicit approval; plan and budget in `server/CALISTIRMA.md` |
