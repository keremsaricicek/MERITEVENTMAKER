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

Overlay colours: green found · amber wrong type · red invented (EXTRA) ·
magenta missed (dashed box / circle) · blue venue element found · red line a
chair seated at the wrong table · dotted outline a joined group (green when the
product grouped it exactly).

## Runners that still read the analysis before OCR finishes

They wait for `state.events[0].analysis`, which exists before OCR, text
suppression, label reading and printed numbers have run, so they measure a
state the operator never sees. `run-benchmark.mjs` was fixed on 2026-10-04
(see CONTRACT.md); these are fixed when their own area is worked, with their
own baselines re-checked, rather than silently all at once:

contradictions/measure-contradictions · detection/categorize-errors ·
embedding/measure-descriptor-baseline · embedding/measure-separation ·
false-positives/measure-false-positives · heldout/run-heldout ·
interpreter/measure-facts · review-order/measure-review-order ·
teach-ai/measure-teaching · teach/bulk-correction-is-undoable ·
teach/human-decisions-survive-reanalyze · teach/unverified-seating ·
zones/measure-zones
