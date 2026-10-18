# training/ — the local plan-symbol detector (developer-time only)

Nothing here runs on the operator's machine. The app ships the exported ONNX
file and runs it in the browser with the onnxruntime-web build it already
pins for OCR. The operator never installs Python, PyTorch, a model server or
anything else.

## Pipeline, end to end

```
python training/synth.py --out D/train   --count 600 --families 0,1,2,3,4,5,6,7 --seed 11
python training/synth.py --out D/val     --count 80  --families 0,1,2,3,4,5,6,7 --seed 23
python training/synth.py --out D/heldout --count 80  --families 8,9            --seed 37

# v1 exactly as shipped: synthetic only, styles 8 and 9 held out, no real plan
python training/detector.py train  --synthetic D/train --exclude-families 8,9 --steps 4000 --out runs/v1
python training/detector.py eval   --model runs/v1/model.pt --plans golden,ornek --report runs/v1/eval-real.json
python training/detector.py eval   --model runs/v1/model.pt --plans D/heldout --report runs/v1/eval-heldout-styles.json
python training/detector.py export --model runs/v1/model.pt --onnx runs/v1/model.onnx
python training/package.py --run runs/v1 --version v1 --activate   # -> models/plan-detector/v1/ + the PIN in src/plan-model.js

# a cross-venue fold: warm-started from v1, plus ONE real venue, scored on the other
python training/detector.py train --synthetic D/train --real golden --init runs/v1/model.pt --steps 1500 --out runs/foldA
```

Environment used (2026-10-11): Python 3.11, `torch==2.14.1` from PyPI (CPU
use; its CUDA libraries are installed but no GPU exists), `onnx`, `numpy`,
`pillow`. Four CPU cores, no GPU. v1's 4 000-step run took 2 317 s (39 min).
Never run a browser benchmark while training: both use every core, and
training slowed about threefold when they overlapped.

## Data and splits

- **Label schema**: the repository's annotation format
  (`benchmarks/annotations/*.json`). Each object has `class`, `type`, centre,
  size and `rotation`, an optional printed `number` and `seats`.
  Relationships are `{chair, belongsTo}`; merged tables are
  `logicalGroups[{members, seats}]`. Every file says how its labels were made:
  - `annotationMethod` and `verification` record the method;
  - `synthetic-exact` means generated;
  - human-verified real plans say so;
  - model-assisted labels are never used as training targets.
- **Split unit**: synthetic plans split by *style family*: families 8 and 9 are
  never trained on. Real plans split by *venue*: a venue's crops never
  appear on both sides. The cross-venue folds are:
  - `foldS`: synthetic only → scored on Golden and ORNEK (zero real data).
    **This is v1, the shipped model**, so its Golden and ORNEK scores are
    scores on venues it never saw;
  - `foldA`: synthetic + Golden → scored on ORNEK;
  - `foldB`: synthetic + ORNEK → scored on Golden.
  - A model trained on both venues would have NO unseen real venue left to be
    scored on; its new-venue estimate would be foldA/foldB, never its own
    score on plans it trained on.
- **Missing labels are not negatives**: a real annotation that does not label
  a class (no columns on either real plan) masks that class out of the loss.

## Generation 3: seven levels (`synth_levels.py`)

```
python training/synth_levels.py --out D3/train   --level L --count 84 --split train     # L = 1..7
python training/synth_levels.py --out D3/val     --level L --count 24 --split val
python training/synth_levels.py --out D3/heldout --level L --count 10 --split heldout   # families 8, 9
python training/synth_levels.py --out D3/blind   --level L --count 12 --split blind     # families 14, 15 + u-shape layout
```

| Level | Adds |
|---|---|
| L1 | clean line drawing, round tables with chairs or bare symbols |
| L2 | square / rectangular / long / pushed-together tables, printed numbers, stage, bar, columns |
| L3 | armchairs, sofas, benches, banquettes, loca boxes, entrances, exits, service areas, titles, capacity lines |
| L4 | scale 0.5–2.2×, rotated groups, colour and fill, thin and thick lines, crowding, touching tables |
| L5 | look-alikes: big letters and digits, round planters the size of a table, stamps, legends; the sheet cut by its edge; text over objects |
| L6 | a scan: blur, JPEG, noise, paper tone, low contrast, a slight skew, a fold line |
| L7 | a photograph: perspective, rotation, a shadow, glare, uneven light, strong compression |

- **Style, not layout.** Families 10 and 11 take the drawing style of the
  Golden and ORNEK sheets; no layout, count, position or text block of either
  is copied. Both sheets stay the regression set.
- **Labels are what the picture shows.** A sofa's or bench's seats are counted
  only when the drawing divides them (otherwise `seats: null` — never three by
  default). An object more than 40 % outside the sheet, under glare, below six
  pixels, or a legend's sample symbol carries `ignore: true`: `detector.py`
  neither teaches nor scores it.
- **Splits.** Train and val: families 0–7 and 10–13 with the layouts rounds,
  staggered, rows, mixed and cabaret. Families 8 and 9 shaped earlier work, so
  they are *held out*, not blind. **Blind**: families 14 and 15 and the u-shape
  layout, which no training or tuning run sees; generated once, scored once.
- **Generation 2 stays in the mix** (`--synthetic gen2,gen3`), and every level
  is reported for the previous model and the new one side by side, so a hard-
  case gain cannot hide an easy-case loss.

### 2026-10-11 — v3 trained on generation 2 + 3, measured, NOT packaged

v3 was warm-started from v2 and trained for 3000 steps on generation-2 train
plus generation-3 train: 588 plans, families 0–7 and 10–13. Families 8, 9, 14
and 15 were excluded, and no real plan was used. It was then scored level by
level against v2. v2 stays the active model, which is the rollback, exercised.

**Thresholds decide the comparison.** v2 is scored at 0.5 for every class,
fixed in advance (its `thresholds.json` says why: synthetic calibration did not
transfer). Calibrated on generation-3 val at a 0.95 precision target, v3 picked
0.2 for round tables and chairs. At those thresholds it looked like a large
recall gain and lost table precision on the real regression set: Golden 0.978
→ **0.821**, 10 false tables. That is a threshold change dressed as a model
change. So v3 is judged at the same pre-fixed 0.5:

| set | v2 → v3 at 0.5 |
|---|---|
| val, held-out, blind: tables and chairs | recall up or equal at almost every level (e.g. val L4 tables 0.95 → 0.99, held-out L7 chairs 0.83 → 0.94); held-out L5 table precision **0.97 → 0.94**; blind L4–L6 table precision down 0.01–0.02 |
| columns | recall **down** on blind L2–L5 (0.94 → 0.91, 0.94 → 0.89, 0.24 → 0.20, 0.54 → 0.46), held-out L7 (0.52 → 0.35) and val L5–L6; up elsewhere |
| generation-2 val (the easy cases) | equal: tables P 0.996 → 0.993, R 0.974 → 0.974 |
| Golden (never trained on) | tables equal (44 of 46, 1 false); chairs recall **0.920 → 0.894** |
| ORNEK (never trained on) | tables 166 of 166 both; **one new false table** (P 1.000 → 0.994) |

The local model's tables are the only thing fusion adds to an analysis, and
v3 adds a false one on ORNEK that v2 does not. Several levels regress (pooled numbers: `benchmarks/offline-intelligence/v3-candidate-2026-10-11.json`). The
rule fixed before training was "package only if no level regresses", so v3 is
not packaged. What the comparison points at: columns at the style extremes
(L4–L5) and table precision on scans (L5–L6) are where generation 3 pulled
the model the wrong way. Those levels are where the next data change goes,
measured the same way.

## Versions

Every packaged model has a manifest under `models/plan-detector/vN/manifest.json`
with:

- the sha256 of the model bytes;
- training data and folds, commit and parameters;
- its measured results.

The app refuses a model whose bytes do not match the PIN in
`src/plan-model.js` (size + sha256, written by `package.py --activate`). A new
version is activated only after `benchmarks/offline-intelligence/run.mjs
--set regression` and `npm run benchmark:baseline` show no regression against
the active one. Versions sit side by side under `models/plan-detector/`;
rolling back is `package.py --run <the old run> --version <old> --activate`,
or reverting the activation commit. The offline folder package carries the
pinned version only. "Trained once is enough forever" is not assumed: each
new verified-label batch is a new dataset version and a new candidate model.

## 2026-10-17 — programme v4: written before any candidate was scored

**Blind-2 (new evaluation set).** Families 14–15 and the u-shape layout were
scored during the 2026-10-11 work, so they are no longer blind. Blind-2 is
families **16 `ink-wash`** and **17 `copy-grey`** (`synth_levels.py --split
blind2`, seed base 5), on the training layouts, 12 plans per level × 7 levels =
84 plans, generated once on 2026-10-17 and scored once at the end, for the final
candidate only. No run, rule or threshold has seen them. `inspect_dataset.py
--heldout`: no leakage against generation 2 + 3 train; 6 of 24,534 chairs on
one L6 plan have their centre a few pixels outside the sheet (scan skew) —
recorded, not edited. The generator now drops relationships and groups whose
objects the edge crop or visibility pass removed (4,196 dangling references in
the generation-3 sets made before this date; the detector never read them).

**Why v3 regressed** (`benchmarks/offline-intelligence/v3-candidate-2026-10-11.json`,
fixed threshold 0.5): v3 raised recall almost everywhere — chairs on pastel-arch
0.290 → 0.936 and bold-black 0.764 → 0.980, both families it was the first to
train on — and paid in table PRECISION exactly on the levels where look-alikes
and scan damage live: val L4 0.991 → 0.977, val L6 0.985 → 0.977, held-out L5
0.973 → 0.940, held-out L6 0.934 → 0.915, blind L3–L6 −0.006 to −0.025, and
families cad-line, symbolic-num, mono-num-chairs, sepia-scan. Column recall fell
on most sets (columns are 1–2 % of objects). It is a precision-for-recall trade,
concentrated in L4–L6, not a general loss.

**Experiments, each with its hypothesis and failure condition stated first.**
Both use generation 2 + 3 train (families 8, 9, 14–17 excluded), batch 16,
3 threads, `--size-weight 0.5` (log-size L1 at 0.1 left chair boxes wrong-sized:
v2 Golden chairs 104/9/9 by centre but 82/31/31 at IoU 0.5) and
`--oversample 4=1.5,5=2,6=2`.

- **E1 `v4a`**: fine-tune from v3, 1,500 steps, lr 1e-3. *Hypothesis*: the levels
  where v3's false tables arise, seen twice as often while the learning rate is
  low, recover table precision to v2's while keeping v3's recall; the stronger
  size loss raises box IoU. *Fails if* any level or family with ≥ 100 tables has
  table precision below v2's by > 0.005, or a new false table appears on Golden
  or ORNEK, or chair box AP50 on Golden does not improve.
- **E2 `v4b`**: from v2, 3,000 steps, lr 2e-3. *Hypothesis*: starting from v2
  rather than v3 with the same data avoids v3's precision shift altogether.
  *Fails* on the same conditions as E1.

Each is reported at the fixed 0.5 against v2 per level, family and class, on
Golden and ORNEK model-alone and with COCO box metrics, and SEPARATELY at
thresholds chosen on generation-3 val. Blind-2 is scored once, for the candidate
chosen without it.

**E1 result — `v4a` FAILS** (2026-10-17; `training/compare_candidates.py`, pooled
numbers in `benchmarks/offline-intelligence/v4a-candidate-2026-10-17.json`). Recall
rose almost everywhere (val chairs 0.925 → 0.990; pastel-arch chairs 0.290 →
0.957), but at the fixed 0.5 table precision is below v2's by more than 0.005 in
eight groups of ≥ 100 tables — val L4 0.991 → 0.985, val symbolic-num 0.994 →
0.987, held-out L6 0.934 → 0.926, generation-2 val blue-print, cad-grey,
colour-arm (0.988 → 0.966) and green-event (1.000 → 0.976), and ORNEK, where v4a
adds one false table (1.000 → 0.994). Golden table type accuracy fell 1.000 →
0.956. Oversampling L4–L6 at a low learning rate did not undo v3's precision
shift: a fine-tune from v3 keeps it. Not packaged; blind-2 not scored.

**E2 result — `v4b` FAILS** (2026-10-17, same tool; pooled numbers in
`benchmarks/offline-intelligence/v4b-candidate-2026-10-17.json`). From v2 the
trade is larger, not smaller: 22 regressions in groups of ≥ 100, 18 of them table
precision (held-out L6 0.934 → 0.866, val L4 0.991 → 0.968), and one new false
table on ORNEK.

**Why — measured, not guessed** (`training/diagnose_fp.py`, val + held-out L4–L7,
136 plans, threshold 0.5). Every false table is put in one bucket by what lies
under it:

| | false tables | duplicate peak on a matched table | on a decoration | on a chair | other |
|---|--:|--:|--:|--:|--:|
| v2 | 80 | 43 | 22 | 8 | 7 |
| v4b | 148 | **132** | 14 | 0 | 2 |

v4b reads FEWER look-alikes as tables than v2. Its precision loss is a second
peak on a table it already found: same class (199 of 201 pairs), 147 of them
within a quarter of a table side. The decoder keeps every 3×3 local maximum
above the threshold, in `training/detector.py` and `src/plan-model.js` alike, so
a broader peak on a large table yields two boxes. That is a decoding defect
shared by every model, not something a training run can fix.

- **E3 (decode, written before any number under it)**: a detection whose centre
  lies within half the short side of a STRONGER detection of the same group
  (round and rectangular tables together; chairs; columns) is dropped. Two real
  tables cannot stand that close — they would overlap. Applied identically in
  `training/detector.py`, `tools/model-dev/examples/detector_io.py` and
  `src/plan-model.js`, for every model, v2 included. *Hypothesis*: scored under
  the same decode, v4b's table precision is no lower than v2's while its recall
  gain stays. *Fails* on E1's conditions, both models re-scored with the new
  decode. The decode change itself is a product change and is judged on its own:
  the regression, adversarial, false-positive and robustness gates must be
  unchanged or better with v2.

**E3 result.** The decode change on v2 alone loses no true detection on any set
and class, and removes false tables: val 57 → 28, held-out 29 → 10, generation-2
val 16 → 3, Golden + ORNEK 1 → 1 (`e3-v2-*.json` against `v2-*.json`). With both
models scored under it, v4b has 0 regressions on val and only column recall on
held-out (0.748 → 0.729, n = 155), but still 6 on generation-2 val
(green-event table precision 1.000 → 0.980, colour-arm, scan-dark, cad-grey) and
the one new false table on ORNEK. **v4b still FAILS** E1's conditions; not
packaged, blind-2 not scored. The decode is kept as a product change, judged by
the app gates. The remaining pairs a full table side apart are pushed-together
neighbours, which the rule keeps on purpose; the decode was not tuned further on
the sets that judge it.

- **E4 `v5a` — seating furniture as classes of their own (written before the run).**
  The product reads a sofa, a bench or a banquette as a table or its cushions as
  chairs (`benchmarks/relations/measure-seating-furniture.mjs`, four trial scenes:
  24 of 83 pieces read as tables, 26 cushions as chairs, 1 named). The
  four-class model has no word for them. *Change*: three classes added —
  `sofa`, `bench`, `banquette`, the generator's own labels — so K = 7; the heat
  head's first four channels are copied from the starting model, the new three
  start from the usual prior bias. *Data*: E2's (generation 2 + 3 train, same
  exclusions and oversampling) plus 400 furniture scenes
  (`synth_relations.py --furniture --split train`, seed base 11, training
  families); generation 2 draws no furniture, so its plans teach "no furniture"
  honestly. From v4b (the best recall), 2,000 steps, lr 1e-3, size-weight 0.5.
  *Measured on*: the furniture dev split (24 scenes, seed base 9) at the fixed
  0.5, and E1's sets under the E3 decode. *Hypothesis*: per furniture class
  recall ≥ 0.85 and precision ≥ 0.9; tables the model puts on a furniture piece
  fall by at least half against v2. *Activation* still needs E1's conditions
  against v2 — a furniture class is not a reason to accept a table regression.
  The furniture blind split (seed base 10) is scored once, at the end.

**E4 result — `v5a` FAILS** (2026-10-17; 2,000 steps, 1,180 s; pooled numbers
in `benchmarks/offline-intelligence/v5a-candidate-2026-10-17.json`). The furniture
labels reached training (5 sampled scenes: 41 sofas, 28 benches, 21 banquettes)
and the three channels did learn — their heat peaks at 0.43–0.47 on a furniture
dev plan — but never reached the fixed 0.5: furniture recall 0 of 436 on the
furniture dev split. The threshold was NOT lowered after seeing this. What did
change: on the furniture scenes the model's own tables went 97 → 350 of 436 found
and chair precision 0.344 → 0.971 (v2 read cushions as chairs: 828 false), and
the 11 false tables that remain all stand on sofas (`diagnose_fp.py`). Against
v2 under the E3 decode: val 0 regressions, held-out column recall only,
generation-2 val 9 (chair recall on colour-arm 0.982 → 0.935, column recall
0.855 → 0.788, table recall on cad-grey), ORNEK one new false table. Not
packaged; the furniture blind split not scored. A next run would need the new
heads trained longer or at a higher rate with generation-2 replay kept — a new
experiment, written before it runs.

**Why E4 failed — measured (2026-10-17).** Over 800 crops drawn by the
training sampler, furniture was **1.3 %** of the heat positives (sofa 99, bench
104, banquette 47 against 19,336 tables, chairs and columns; 136 of 800 crops held
any). The focal loss is normalised by ALL positives, so the three new channels
received about one gradient in eighty; training the whole network on that mix
is also what moved chair and column recall on generation-2 families.

- **E5 `v5b` — a seating branch on a frozen v2 (written before the run).** The
  four-class v2 is loaded and frozen, batch-norm statistics included, so its
  table, chair and column outputs are bit-identical by construction. A separate
  branch on the same stride-4 features (two conv blocks, its own heat for sofa /
  bench / banquette, its own size and offset) is the only thing trained. Its
  focal loss is normalised by FURNITURE positives only; size and offset are
  learned at furniture centres only. Sampling: furniture scenes and every
  generation-3 plan that draws furniture weighted ×4, the rest kept as negatives.
  3,000 steps, lr 2e-3. At decode a seating box and a table box on the same spot
  are one object and the stronger is kept (the E3 rule, across the two groups).
  *Passes if*, at the fixed 0.5 on the furniture dev split: each furniture class
  recall ≥ 0.85 and precision ≥ 0.9; and on E1's sets the table, chair and column
  numbers equal v2's except where a table box gave way to a stronger furniture
  box, each such case counted and none on Golden or ORNEK. Blind-2 and the
  furniture blind split are scored once, only if it passes.

**E5 result — FAILS its condition (2026-10-17).** Furniture dev at 0.5: sofa
P 1.000 / R 0.452, bench 1.000 / 0.006, banquette 0.714 / 0.060 (`e5-v5b-seatdev`).
Tables, chairs and columns are v2's by construction (frozen); no regression on
the furniture dev split (`compare_candidates.py`: 0). Not packaged; the blind
splits not scored.

**Why E5 failed — measured, not guessed.** The branch FINDS the pieces but is
not sure of them: at each true centre the strongest of the seven channels is
the right seating class for 166 / 197 sofas, 127 / 156 benches and 36 / 83
banquettes, while the class's own peak has a median of 0.483, 0.287 and 0.300
(`heat_at_gt.py`); ≥ 0.3 holds for 0.87 / 0.43 / 0.48. So the threshold is not
the problem to solve — lowering it would trade the precision the pre-registration
fixed for half the recall it asks for. The cause is in the LABELS: training draws
256 px crops, and a piece whose centre falls outside the crop but whose body is
visible inside it was taught as BACKGROUND. Counted over 3,000 crops of the
sampler on seat/train: for every positive, 0.55 more banquettes were visible-but-
cut (bench 0.46, sofa 0.44, table 0.32, chair 0.17). The longer the class, the
more often its visible half was a negative example of itself — the same order as
the peaks. Banquette, the rarest class, also confuses with bench and chair (bench
or chair is the strongest channel at 47 of 83 banquette centres).

- **E6 `v6a` — the cut-object label fixed, the classes balanced (written before
  the run).** E5's model, data, seed, 3,000 steps and lr unchanged, with two
  changes and nothing else: (1) `--ignore-cut` — an object the crop shows only
  part of, its centre outside, is IGNORED in the heat target (held at 0.999 like
  an annotated ignore box) instead of taught as background; (2)
  `--balance-classes` — in the branch's focal loss each seating class's positives
  weigh equally in total (inverse of its share of the batch's positives);
  negatives and the normaliser unchanged. *Passes on the same condition as E5*:
  at the fixed 0.5 on the furniture dev split each furniture class recall ≥ 0.85
  and precision ≥ 0.9; E1's sets equal v2's except tables that gave way to a
  stronger furniture box, counted, none on Golden or ORNEK. If it fails, the
  measured per-class peak at true centres says which of the two changes did not
  carry; it is not re-run longer.

**E6 result — FAILS its condition (2026-10-17).** Furniture dev at 0.5: sofa
P 1.000 / R 0.315, bench 1.000 / 0.006, banquette 0.684 / 0.157
(`e6-v6a-seatdev`). Peaks at the true centres (`heat_at_gt.py`): sofa median
0.483 → 0.422, bench 0.287 → 0.256, banquette 0.300 → 0.367 (≥ 0.3: 0.48 → 0.74);
bench or chair now wins at 38 of 83 banquette centres (47 before). What this
settles: the cut-object label was real (it is fixed and stays available as
`--ignore-cut`) but it was NOT why benches stay below the threshold — their peak
did not move; balancing the classes moved weight from sofas to banquettes, as a
re-weighting does, and lifted neither enough. Every bench sits 0.08 table sides
from a long table, closer than any other piece, and the frozen v2 features under
a two-layer branch do not separate the two. Not re-run longer. Not packaged;
blind splits not scored. The next experiment, if one is run, changes what the
branch can see (its depth and reach, or features that may adapt under a
distillation term that holds v2's own outputs), not the schedule.

**Why benches stay low — one more measurement before E7.** On 24 of E6's own
TRAINING scenes the bench peak is a median 0.269 (0.013 at ≥ 0.5): the branch
does not fit its training data, so this is not a gap between seen and unseen
plans. Nor is it scale: benches are 19 px deep at inference and 7–30 px across
the training crops. What is left is what the branch can represent on features
frozen for four classes.

- **E7 `v7a` — the features may adapt, held by distillation (written before the
  run).** E6's data, labels, balance, seed, 3,000 steps and lr, with the base no
  longer frozen: its weights train at 0.1 × the rate (`--base-lr-scale 0.1`;
  batch-norm statistics stay v2's), and a frozen copy of v2 is a teacher — the
  base's four channels are held to the teacher's on every pixel of every crop by
  KL divergence, normalised like the focal loss (`--distill 1.0`). This is the
  answer to E4's measured failure (whole-network training moved chair and column
  recall on generation-2 families): the base may change only as far as the
  teacher allows. *Passes on E5's condition* (each furniture class recall ≥ 0.85,
  precision ≥ 0.9 at 0.5 on the furniture dev split) AND, because the base now
  changes, `compare_candidates.py` against v2 under the E3 decode reports no
  regression (n ≥ 100, drop > 0.005) on val, held-out and generation-2 val, and
  Golden / ORNEK keep their table and chair counts with no new false table.

**E7 result — FAILS its condition (2026-10-18).** Furniture dev at 0.5: sofa
P 1.000 / R **0.777** (E6 0.315), bench 0.903 / **0.179** (0.006), banquette
0.906 / **0.578** (0.157). Letting the base adapt moved all three, which
confirms E6's reading that frozen four-class features were the limit for sofas
and banquettes. It also cost the base, and the KL term at 1.0 did not hold it.
`compare_candidates` against v2 (E3 decode) lists regressions:
- val, 5: columns P 0.959 → 0.938, R 0.691 → 0.680; level-4 tables R;
  bold-black chairs R 0.764 → 0.730; office-graphic chairs R 0.948 → 0.932.
- held-out, 8: chair recall at levels 3–7, level-5/6 tables.
- generation-2 val, 2: columns R 0.855 → 0.791, cad-line tables.
On the real set nothing regressed (Golden chairs P 0.920 → 0.955,
R 0.920 → 0.929).

Measured at the true centres (`heat_at_gt.py`): bench is now the STRONGEST
class at 132 of 156 bench centres, but its peak sits at a median 0.391 (≥ 0.5:
13.5 %, ≥ 0.3: 82.7 %). Sofa median 0.634, banquette 0.525. Not packaged.
Blind splits not scored.

**E7cal — the same weights, seating thresholds calibrated (pre-registered
2026-10-18, FAILS).** The question: is the bench shortfall only the peak's
scale? Base classes stayed at 0.5. Sofa, bench and banquette got thresholds
from `detector.py calibrate` on 200 TRAINING scenes of the furniture split, at
precision 0.95; never on dev or blind. Calibration picked sofa 0.208, bench
**0.543**, banquette **0.551**: on its own training scenes a bench reaches
precision 0.95 only at 0.543, with recall 0.076, because below 0.5 bench peaks
appear where no bench is. On dev: sofa P 0.876 / R 0.970, bench 1.000 / 0.083,
banquette 0.925 / 0.446.

So it is not calibration. Benches are told apart from benches, not from what
looks like them. The E8 that was pre-registered behind this question (the
same run with the base held harder, `--distill 3.0 --base-lr-scale 0.05`) was
**not run**: its premise was that calibration closes the furniture part.

What stays true for the product: v2 remains active. The classical pipeline
already names one bench form directly (a solid bar in the seats' own colour
standing against a table, `seat-colour-bench`). The R2 relations are measured
on true boxes (dev 363/363, blind 163/163) and wait for a furniture detector
that passes.

**E9 — the merge of a long piece's peaks (decode only, pre-registered
2026-10-18).** E7cal read its result as "below 0.5 bench peaks appear where no
bench is". A census of E7's bench peaks on 120 TRAINING scenes of the furniture
split (thr 0.3, the E3 decode) says otherwise: of 413 unmatched peaks, **280
stand inside a true bench**, 48 inside a banquette, 47 inside a long table, 38
on paper. E3 merges a weaker peak within half the SHORT side of a stronger one;
a bench is ~19 px deep, so two peaks 30 px apart along it both survived, and the
second was scored false. That forced the calibrated threshold up.

E3b, the only change (no training): within the seating group and its table
conflict, a weaker centre inside the stronger box is the same piece; tables,
chairs and columns keep E3, so v2 decodes exactly as before. On the same 120
scenes: unmatched bench peaks 413 → 101 (inside a true bench 280 → 43), matched
639 → 629. Calibrated the E7cal way (200 training scenes, precision 0.95, base
classes at 0.5): sofa 0.200, bench **0.398** (E7cal 0.543), banquette 0.491
(0.551). Furniture dev:

| | E7cal (E3) | E9 (E3b) |
|---|---|---|
| sofa P / R | 0.876 / 0.970 | 0.868 / 0.970 |
| bench P / R | 1.000 / 0.083 | 0.911 / **0.526** |
| banquette P / R | 0.925 / 0.446 | 0.906 / 0.578 |

**FAILS** the condition (each furniture class R ≥ 0.85 and P ≥ 0.9). Half of the
bench shortfall was the merge, and it is fixed in the decoder for every later
candidate (`suppress_close`, `src/plan-model.js`, suite `model-decode`); the other
half is the model's own peak height (TP median 0.40). The pre-registered E8
(the base held harder) was conditional on calibration closing the furniture
part; it does not, so E8 was **not run**, and v2 stays active. The next model
experiment starts from a decoder that no longer penalises long pieces.

### 2026-10-18 — independent audit, then E10 (written before the run)

`model-qa-specialist` audited the code, the failed runs E4–E9, the labels, the
splits and the decode, without waiting for a passing candidate. Verdicts: v2
**SOUND WITH FINDINGS**; the decoder (E3 + E3b) SOUND WITH FINDINGS for v2; any
seating candidate trained on the current targets **UNSOUND**. It reproduced
E7 and E9 from the raw files, found no leakage (no shared image or seed across
train/dev/blind, no real plan in any run) and confirmed the pins. Findings:

- **F1 (HIGH) training ignored `rotation`.** Synthetic labels store a piece's
  own length × depth and its rotation; the targets used them as an
  axis-aligned box, so a 90° bench was taught transposed (62 % of benches are
  turned) while the decoder, E3b, fusion and the evaluator all assume the
  enclosing box.
- **F2 (HIGH)** as a result E3b fails on turned pieces: 23 % of turned benches
  keep ≥ 2 peaks (3 % axis-aligned); turned benches reach the E9 threshold
  14 % of the time against 59 %.
- **F3** `--ignore-cut` tested an axis-aligned own-size box (misses 29 % of cut
  benches), so E6's "cut labels are not why benches stay low" is not established.
- **F4** `calibrate` suppressed at 0.1 and thresholded after; eval and the app
  threshold first. Sofa precision 0.971 in calibrate order, 0.912 in the app's.
- **F5–F12** (medium/low): v2's turned Golden chairs fail IoU for the same
  reason (the product does not use v2's sizes); family 13 (bold-black) labels
  divisions nobody can see; the bench target's sigma comes from the short
  side only; small Python/JS decode differences; dev judged five times — blind
  stays untouched.

Tooling fixed first (no training): `calibrate --fixed` decodes in the app's
order; `training/check_targets.py` checks that a 0°, 30° and 90° piece teaches
its enclosing box and a seating peak streaks along the piece (it fails on
either fix reverted).

**E10 `v10a` — targets that use each label's true shape.** The only change is
`--true-shape`: a turned synthetic label teaches the enclosing box of its
rotated corners (size target and the ignore-cut test), and sofa, bench and
banquette an oriented Gaussian (across the piece today's sigma from its depth,
along it the same rule from its length). Tables, chairs and columns keep their
Gaussian. Everything else is E7's command word for word (data, exclusions,
seed 1, 3,000 steps, batch 16, lr 2e-3, size-weight 0.5, `--ignore-cut`,
`--balance-classes`, `--distill 1.0`, `--base-lr-scale 0.1`, init v2, E3b
decode), so the furniture result is attributable to the targets.
Comparison row: E9's weights calibrated in the app's order.

Hypotheses, on 40 TRAINING scenes: 0° bench peak median ≥ 0.6 (E7 0.42);
turned benches reach the threshold within 0.10 of axis-aligned ones (E7 0.14
vs 0.59); ≥ 2 peaks inside a turned bench ≤ 0.05 (E7 0.23); size loss over the
last 500 steps ≤ 0.4 (E7 0.87).

**Pass condition (the existing bar, unchanged):** on furniture dev each
furniture class R ≥ 0.85 and P ≥ 0.9, thresholds from `calibrate --fixed` on
the first 200 seat/train scenes at precision 0.95 with the base classes at 0.5;
`compare_candidates` against v2 shows no regression (n ≥ 100, drop > 0.005) on
val, held-out and generation-2 val at the same thread count; Golden and ORNEK
keep their table and chair counts with no new false table. Blind is scored once,
only if it passes. A candidate that passes furniture and regresses the base is
recorded and NOT activated; the next step is then E8's stronger base hold on
these targets.

**E10 result (2026-10-18) — furniture PASSES, the base regresses: NOT activated.**
Training 2,826 s on 3 threads. Furniture dev, thresholds from `calibrate
--fixed` (app order) on 200 seat/train scenes — sofa 0.24, bench 0.14,
banquette 0.14, base classes 0.5:

| | E9 weights, app-order calibration | E10 `v10a` |
|---|---|---|
| sofa P / R | 0.935 / 0.949 | **0.956 / 0.995** |
| bench P / R | 0.919 / 0.506 | **0.940 / 1.000** |
| banquette P / R | 0.906 / 0.578 | **1.000 / 1.000** |

Hypotheses on 40 training scenes: 0° bench peak median 0.785 (≥ 0.6, met);
turned benches reach 0.5 at 0.87–0.97 against 0.95 axis-aligned (within 0.10,
met); ≥ 2 peaks inside a turned bench 0.07 (≤ 0.05, **not met**; sofa 0.01,
banquette 0.04); size loss over the last steps 0.19–0.35 (≤ 0.4, met). The
size head now predicts the enclosing box at 90° and 30° (log error 0.13–0.22
against it). The targets were the cause the audit named.

`compare_candidates` against v2 (thr 0.5, 4 threads, E3b), n ≥ 100, drop > 0.005:
- val, 4: columns P 0.959 → 0.927, R 0.691 → 0.640; bold-black chairs R
  0.764 → 0.738; office-graphic chairs R 0.948 → 0.941.
- held-out, 2: columns R 0.748 → 0.690; level-6 tables P 0.973 → 0.966.
- generation-2 val, 3: columns R 0.855 → 0.778; cad-line tables R 0.901 →
  0.896; scan-dark tables R 0.906 → 0.896.
- real: none (Golden tables 44/0/2 against v2's 44/1/2, chairs P 0.920 →
  0.963, R 0.920 → 0.929; ORNEK 166/0/0 both).

The same base regressions as E7, from the same base settings: distillation at
1.0 with the base at 0.1 × the rate does not hold columns. As pre-registered,
v10a is recorded and **not activated**; v2 stays active; blind is not scored.
The next experiment is E8's stronger base hold (`--distill 3.0
--base-lr-scale 0.05`) on these targets, nothing else changed.

## 2026-10-18 — V4: a plan-specific LoRA for the local vision-language model (written before the result)

Not the plan-symbol detector: this trains the small VLM the relay's second
look asks closed questions of (`server/local-check-questions.json`,
`src/plan-local-check.js`). On the fair harness (`local-vlm-bench2.py`) every
zero-shot model failed on knowledge, not settings — Qwen3.5-0.8B named a sofa
"table" or "nothing" and called every empty crop a table — so the drawing
convention is taught with labelled examples (`training/vlm_lora.py`).

- **Base:** Qwen3.5-0.8B (Hugging Face `Qwen/Qwen3.5-0.8B` at
  `2fc06364715b967f1860aea9cf38778875588b17`, Apache-2.0, safetensors sha256
  `04b1c301…e4696`), served for evaluation as the Q8_0 GGUF with a Q8_0
  projector quantized here (`benchmarks/offline-intelligence/LOCAL-VLM.md`).
- **What is trained:** a LoRA (rank 16, alpha 32, dropout 0.05) on the
  language model's MLP `gate/up/down` in all 24 blocks — 5,308,416 parameters.
  Vision encoder and projector frozen. Only the MLP, because those three map
  one-to-one onto llama.cpp's `ffn_gate/ffn_up/ffn_down`; this hybrid model's
  attention projections are reordered by the GGUF conversion.
- **Data (`vlm_lora.py data`, seed 21):** 2,587 crops, ONLY from training
  splits — 400 furniture scenes (`synth_relations.py --furniture --split
  train`), 588 generation-3 plans (`synth_levels.py`, train), 120 relation
  scenes (`synth_relations.py --split train`, new seed base 12) — refused if
  any annotation names another split. 140 per identify class (table, chair,
  sofa, bench, banquette, column, stage, bar) and 140 empty crops; 220 + 220
  serves; 220 + 216 merged; chairs and count stratified (≤ 40 / ≤ 45 per
  true value). Quarter turns and framing jitter, kept label-safe: a first cut
  of the set moved a bench crop's centre onto its table and let a half table
  into a count crop (seen on a contact sheet); an identify crop's centre now
  stays on its object and a count crop is re-checked after the jitter.
- **Training (`vlm_lora.py train`):** one epoch, batch 1 × accumulation 8 (324
  steps), AdamW 2e-4, 20-step warm-up then linear decay, bf16 autocast, loss
  on the answer tokens only, CPU, 4 threads.
- **Conversion (`vlm_lora.py gguf`):** a llama.cpp LoRA adapter
  (`general.type=adapter`, `adapter.lora.alpha`), served with `llama-server
  --lora`; `vlm_lora.py agree` must show llama.cpp + adapter answering what
  transformers + PEFT answer on ≥ 90 % of 24 crops.

**Pass condition (pre-registered before any trained adapter was scored).** The
final test is ONE run of `local-vlm-bench2.py --seed 5 --looks 2` on the BLIND
splits (style families 14/15, never trained on) plus the Golden and ORNEK
crops; the untrained base answers the same items. A question type is wired —
listed in the manifest's `checks`, the only way the relay will ask it — only
if on that run: identify generated ≥ 0.85, furniture ≥ 0.80, real ≥ 0.80;
empty crops fabricated ≤ 0.05; "yes" on true negatives ≤ 0.10; chairs exact ≥
0.80 with over-count ≤ 0.10; count exact ≥ 0.80 with over-count ≤ 0.10;
merged and serves ≥ 0.85 each; median ≤ 10 s per crop at 4 threads; peak
server RSS ≤ 3,000 MB. Each row is judged on its own. Real-plan rows with
fewer than 8 items are reported, never used to pass. Choices are made on dev
with the real crops left out (`--no-real`); blind is scored once.
`model-qa-specialist` audits the run before anything is wired.
