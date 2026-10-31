# benchmarks/plan-understanding

Does the product understand a plan well enough to turn it into an editable
digital plan without a page of manual fixes? `CONTRACT.md` is the answer's
definition — numeric 9/10 thresholds written before the work, with the reason
for each — and `measure.mjs` is the run that checks it.

| file | what |
|---|---|
| `CONTRACT.md` | the thresholds, why each is what it is, the baseline against them |
| `contract.mjs` | the same thresholds as code (`evaluateContract`) |
| `score.mjs` | pure scoring: stored analysis + annotation + truth → numbers |
| `measure.mjs` | runs the real app on both real plans to the END of the analysis, scores, draws overlays |
| `truth/*.json` | venue elements, joined groups, chair facing, printed facts — how each was measured is in the file |
| `baseline-65808d5/` | the starting point: report, overlays, full stored analyses |
| `final-8a30427/` | where the programme ended: `FINAL-REPORT.md`, every row before and after (`BEFORE-AFTER.md`), report, overlays, stored analyses, and the committed digital plan at three viewports |

Overlay colours: green found · amber wrong type · red invented (EXTRA) ·
magenta missed (dashed box / circle) · blue venue element found · red line a
chair seated at the wrong table · dotted outline a joined group (green when the
product grouped it exactly).

## Runners that still read the analysis before OCR finishes

They wait for `state.events[0].analysis`, which exists before OCR, text
suppression, label reading and printed numbers have run, so they measure a
state the operator never sees. `run-benchmark.mjs` was fixed on 2026-10-04
(see CONTRACT.md), `review-order` during this work, and on 2026-10-10 the five
CI runs among them — `contradictions`, `false-positives`, `interpreter/
measure-facts`, `teach-ai/measure-teaching`, `zones` — after running the two
OCR engines side by side made which half-built state an early read saw depend
on the machine (facts failed on CI and passed locally on one commit). Each was
re-measured on the finished analysis: contradictions, teaching and zones still
meet their gates; facts meets its gate once its checker reads the annotation's
structured capacity and the per-chair facing truth; false-positives holds 16
real tables on five renderings, accepted in its `KNOWN-FAILS.json`. Still
reading early, fixed when their own area is worked:

detection/categorize-errors · embedding/measure-descriptor-baseline ·
embedding/measure-separation · heldout/run-heldout ·
teach/bulk-correction-is-undoable · teach/human-decisions-survive-reanalyze ·
teach/unverified-seating
