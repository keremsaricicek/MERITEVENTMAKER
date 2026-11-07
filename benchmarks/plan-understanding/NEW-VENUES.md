# New venues — what is needed and how they will be measured

Today two real venues are measured: the Golden Plan and ORNEK. Both stay as
regression. Two venues cannot show that the product works on venues it has
not seen, so every per-class figure in this repository is a two-venue figure.

## What to send (once)

**5–10 floor plans, each from a DIFFERENT venue.** For each plan:

| | |
|---|---|
| file | the original as received: PDF exported from CAD (best), PDF of a scan, PNG or JPG. Not a screenshot of a screenshot |
| at least | 2 vector PDFs (exported from CAD, text selectable) and 2 scans/photos |
| variety | round + square/rectangular tables, at least one plan with drawn chairs and one with numbered circles only, at least one with locas/boxes, banquettes or a bar |
| per plan, if known | the venue's real capacity for that layout and how the tables are numbered (to check numbers and capacity against something that is not the drawing) |
| not | a colour or crop variant of a plan already sent (it is the same venue); personal data — if a guest list is printed on the plan, remove it first |

Put them anywhere this repository can be reached (a folder in a branch or an
attached archive). The files are used for measurement only and are never sent
to a model without a separate, explicit approval.

## How they are split

- **By venue, never by plan or object.** Each venue is either in the
  development set (rules may be inspected against it) or in the blind set
  (scored once per release, never looked at while changing the detector).
  With 6 venues: 3 dev / 3 blind. With 10: 5 / 5.
- No rule may name, size-tune or special-case a blind plan
  (`no-sample-specific-runtime-logic` already fails on a filename or a
  plan-specific constant in `src/`).
- Synthetic and transformed plans are reported in their own rows and never
  counted as venues.

## Labelling

One annotation file per plan in `benchmarks/annotations/`, in the existing
format: `source {file, width, height}`, and `objects[]` with `class`, `type`,
a box, `number` and `numberLegible` for tables, and chairs as objects.
Relations (chair → table, table → zone/loca) are labelled as ids. A person
labels; the detector's output is never copied in as ground truth.

## What is measured (per class, per venue, dev and blind separately)

| measure | target (not lowered) |
|---|---|
| precision, recall per class (table, chair, banquette, stage, loca, bar) | ≥ 98% / ≥ 95% on blind |
| misses and phantoms, named per object | listed, not just counted |
| chair → table and table → zone relations | precision / recall |
| printed numbers: right / wrong / unread | **wrong = 0** |
| capacity: printed vs seen vs confirmed, and the objects causing the gap | gap explained |
| facing (where the drawing shows it) | right / wrong / "unknown" stated |
| geometry: centre error and rotation error | median and p95 |
| corrections per 100 objects to reach a correct plan | ≤ 5 |
| operator time to a confirmed plan | measured with a real person only — never simulated |
| plan memory: retained / wrong-applied / lost on the next version | wrong-applied ≤ 1%, retention ≥ 98% |
| model reading before/after, cost per plan | only after the pilot is approved |
| time p50/p95 and peak memory per plan | recorded |

Runners: `npm run benchmark` (object-level), `benchmarks/resolution`
(resolution effect), `benchmarks/memory` (memory), and
`benchmarks/heldout/ornek-stage-walk.mjs` for "where did each miss die".

## Status

**Blocked on the files.** Nothing in this table has been measured on a third
venue, and nothing will be invented in its place.
