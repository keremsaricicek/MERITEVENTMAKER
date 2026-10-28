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

**V4 run A (2026-10-18) — trained; dev measured; blind pending.** One epoch,
324 steps, 8,399 s on 4 CPU threads (2.25–3.3 s per crop once the machine was
quiet; the first minutes overlapped a benchmark and were paused). Loss per 10
steps 0.98 → 0.65 → 0.43 → 0.17 → 0.10 → 0.03–0.20 at the end (batch of 8,
noisy). Peak training RSS 4.9 GB (developer machine only).

Conversion check (`vlm_lora.py agree`, 24 crops, llama.cpp `--lora` with the
F16 projector against transformers + PEFT in bf16): **24 / 24 same answer.**

Dev (`local-vlm-bench2.py --seed 11 --limit 100 --no-real`, dev splits, real
crops left out, one look, served Q8_0 + Q8_0 projector + adapter):

| | untrained (60 items, with real) | run A (100 items, no real) |
|---|---|---|
| identify, generated | 0.17 | **0.90** |
| identify, furniture | 0.00 | **1.00** |
| empty crop called an object | 1.00 | **0.00** |
| "yes" on a true negative | 0.00 | 0.00 |
| count exact / over | 1.00 / 0.00 (4 items) | 0.88 / 0.00 |
| chairs exact | 0.43 | 0.88 |
| merged / serves | 0.80 / 0.20 | **1.00 / 1.00** |
| median per crop | 5.5 s | 4.9 s |

Errors left on dev: a table read as a bench (3) or a sofa (1), a count of 5
read as 4, ten chairs read as eight. Peak server RSS 5,010 MB at `-c 8192`;
the final test runs at `-c 2048`, what a closed question needs. The verdict
is the blind run, scored once, below.

**V4 run A — supplementary blind test S1 (pre-registered 2026-10-19, written
before any S1 scene was generated).** The independent audit of run A found three
things the V4 final test could not see: no bench or banquette is ever "not
serving" in training or test (a made-up "yes" for one could never show; the
question word alone scores 19/24 on serves); chairs were trained and tested on
even counts only (2–12), while the second look asks exactly where a count is
unusual; and every merged "no" had a gap of at least 0.9 table sides, while the
product asks where tables nearly touch. S1 adds those cases, from the BLIND
style families and seed bases never used before, with NO retraining (same
adapter, same served config incl. `--cache-ram 0`, two looks, one run):

- chairs: round tables standing alone with 3, 5, 7, 9, 11 chairs (6 each) and
  4, 8, 12 as a control (4 each);
- merged: 20 near-miss separate neighbours (a visible gap of 0.35–0.9 sides,
  the generator's own two-tables rule) and 20 pushed-together groups V4 did not
  ask;
- serves: 20 bench/banquette pieces set apart from a table (10 + 10) and 20
  serving ones.

A type passes S1 only if: chairs exact ≥ 0.80 on the odd items and on all S1
chair items, over-count ≤ 0.10; merged accuracy ≥ 0.85 and "yes" on near-miss
negatives ≤ 0.10; serves accuracy ≥ 0.85 and "yes" on bench/banquette negatives
≤ 0.10. Two-look figures and Wilson 95 % intervals are reported beside each
row, not used to pass. **A type is wired only if it passed V4 (the RSS row
from the disclosed cache-off re-run) AND S1, AND the relay verifies the running
server (adapter loaded, model file, context).** A type that fails is not wired;
no retraining in this step. Independent QA audits S1 before wiring.

**V4 run A — verdict (2026-10-19).** Scored once on the final test (191 items,
trained and untrained on the same items; raw rows in
`benchmarks/offline-intelligence/local-vlm-results/v4-blind-*.json`), then on S1
(122 items, `s1-A.json`):

| question | V4 (bar) | S1 (bar) | wired |
|---|---|---|---|
| identify | generated 0.93, furniture 1.00, **real 0.75** (≥ 0.80), empty 0.00 | — | **no** |
| count | **0.76** (≥ 0.80), over 0.00 | — | no (not a second-look question) |
| chairs | 0.91, over 0.00 | **odd 0.03** (≥ 0.80), all 0.31, **over 0.52** | **no** |
| serves | 1.00, yes-on-no 0.00 | all 0.55, **yes on a set-apart bench/banquette 0.90** (≤ 0.10) | **no** |
| merged | 1.00, yes-on-no 0.00 | **1.00**, yes on near-miss 0.00 | **yes** |

Untrained base on the same V4 items: identify generated 0.17, furniture 0.03,
real 0.19, empty fabricated 0.42, chairs 0.55, count 0.18, merged 0.75, serves
0.50. Median 5.2 s per crop (4 threads, quiet machine). Peak server RSS: 9,448
MB as scored, with llama.cpp's default 8 GiB prompt cache; 1,237 MB with
`--cache-ram 0` on the same items, every answer identical — a disclosed
deviation of procedure, the bar unchanged.

What run A learned: the drawing convention for WHAT a thing is on generated
plans (sofa / bench / banquette / table / chair / column / stage / bar / nothing)
and whether two drawn tables touch. What it did not: counting (it answers even
chair counts only — 3 → 4, 7 → 8, 9 → 10 — because the training set held even
counts only), whether a piece serves a table (training never showed a bench or
banquette that does not, so it learned the word), and the real plans' chair and
banquette symbols. The second independent audit returned SOUND WITH FINDINGS
for wiring merged only, with the claim limited to generated plans and separate
pairs at least 0.35 sides apart (`LOCAL-VLM.md`). In the product, on Golden, the
look asked 12 groups (all rows of touching tables by eye): 10 agreed, 2 unsure,
0 wrong, in 134 s, with no frozen frame. A run B would need odd counts and bench/banquette negatives
in its training set, and new real plans to be judged on — the Golden and ORNEK
crops are no longer a test any choice could be blind to.

## 2026-10-24 — V5: the data fixed, then the 0.8B and the 2B model on the same data (written before the result)

**Why.** Run A failed chairs, serves and real identify because of its data
(above): even chair counts only, every bench/banquette serving, separate
tables never nearer than 0.9 sides, and crops cut from plans drawn for the
detector. V5 draws each crop for the question it answers
(`training/synth_vlm.py`, generation 5): identify over eleven words (adds
`entrance` and `lodge` — `server/local-check-questions.json`), count 1–6,
chairs 1–14 (odd and even, round/oval/square/rectangle, chairs never
overlapping), merged yes/no half and half (row, turned, L, T; "no" gaps
0.2–1.0 sides, near < 0.45), serves yes/no half and half for EACH of sofa,
bench and banquette (set apart facing the table or turned away). Against
learning the wrong thing: a printed "N pax" that does not match the drawn
chairs (25 % of chairs crops: the answer is the drawing), words on empty
crops ("SAHNE", "8 pax", "LOCA"…: the answer is `nothing`), misleading words
beside objects, colours swapped between classes, a chair always drawn at the
table it faces (alone it is a column's drawing too — first contact sheet), a
stage or bar never a bare rectangle (a table's drawing). Difficulty levels
1–4 (clean → line/scale/colour → fade/blur/noise/JPEG → photographed
perspective, shadow, strong JPEG); training runs easy to hard (a soft
curriculum: level plus noise, so every level stays present). A seat count is
never asked of a sofa, bench or banquette. Labels were checked on contact
sheets of the dev split before this was written.

**Splits by drawing family and seed base.** train: families 0–7, 10–13, base
51 (plus a replay of run A's own training crops for identify, empty, count and
merged — not its chairs or serves items, whose bias is the finding above);
dev: families 8, 9, 14, 15, base 52; **V5 test: families 16 and 17 (never
drawn for any vision-language model), base 53, generated once at `--scale
0.1` (≈ 400 items), frozen by sha256 before any V5 adapter exists.** Golden
and ORNEK have been looked at in earlier runs: they are reported as a SEEN
real test, never as blind. If a choice is made on the V5 test's results, a
new test is generated from a new seed base before anything is claimed.

**Models, in this order.** (1) Qwen3.5-0.8B, LoRA as run A (rank 16, MLP
only, one epoch, lr 2e-4, batch 1 × 8); measured. (2) Qwen3.5-2B (Hugging
Face `Qwen/Qwen3.5-2B` at `15852e8c16360a2fea060d615a32b45270f8a8fc`,
Apache-2.0), the SAME data and recipe, served as the published Q4_K_M with a
Q8_0 projector quantized here; trained whatever (1) scores. Training memory
(developer machine) and serving memory are reported apart. Training resumes
from its last checkpoint if cut.

**Final test (one run per model, two looks, `-c 2048 --cache-ram 0`, 4
threads):** the V5 test, plus run A's V4 final test and S1 as regression
(same items as before). Base models answer the V5 test too. Per task:
accuracy, answer coverage (both looks agree), agreed-and-wrong (the most a
wrong suggestion can be), undecided, missed, false yes / fabricated.

**Bars (not lowered from V4/S1):**
- identify: other classes ≥ 0.85, furniture ≥ 0.80, empty crops fabricated ≤
  0.05 (empty crops with a word ≤ 0.10); AND V4 final test generated/furniture
  bars still met; AND the seen real test (Golden/ORNEK) ≥ 0.80, reported as
  seen, not blind.
- chairs: all ≥ 0.80, odd ≥ 0.80, over-count ≤ 0.10, printed counter-examples
  ≥ 0.70; AND S1 chairs bars.
- merged: ≥ 0.85, "yes" on a true "no" ≤ 0.10; AND V4 and S1 merged bars
  (a regression here unwires merged).
- serves: ≥ 0.85, "yes" on a true "no" ≤ 0.10 overall and ≤ 0.15 for each of
  sofa, bench, banquette; AND S1 serves bars.
- count: ≥ 0.80, over ≤ 0.10 (reported; not a product question).
- memory: peak llama-server RSS ≤ 3,000 MB (an 8 GB machine with the
  browser). Seconds per crop are reported; slowness alone eliminates nothing
  this round, but the screen must not freeze.

**Choice between the two models (pre-registered).** The default is the model
with more questions passing; on a tie, the higher mean accuracy over the
passing questions on the V5 test; within 0.02, the smaller serving memory.
The other is offered as an alternative only for the questions it passes,
within the memory bar. A question neither passes stays unwired. Independent
QA (`.claude/agents/model-qa-specialist.md`) audits data and test design
before training and the results after.

**V5 — amendment after the independent pre-training audit (2026-10-24, before
any V5 adapter was trained).** `model-qa-specialist` returned UNSOUND on the
first cut, for a generator bug: the family index stepped by two per item, so
train used 6 of its 12 families and in the test each answer came in one drawing
family (merged "yes" all copy-grey, "no" all ink-wash). Fixed (one family per
item in turn, checked per stratum — the generator refuses an unbalanced
stratum) and every split regenerated; no item of the first cut was ever
answered by a model. Also adopted from the audit, before training:
- identify: every class ≥ 0.70 as well as the pooled bars; unlabelled
  stage/bar/entrance/lodge crops reported apart (`sub` says whether the word
  was drawn); PODYUM, ENTRANCE, LOCA 3 and GIRIS added as words on empty crops;
- chairs: the printed figure now matches the drawing on half the printed crops;
  both kinds ≥ 0.70 (they replace the single printed row);
- serves: negatives with the back against the table (sofa, banquette) added;
  a "near" zone (0.2–0.5 sides, facing) is asked in dev/test and reported on its
  own — never trained, never in a bar, because a person could argue a lounge
  sofa at that distance either way;
- sizes: the test and dev boost empty crops (40), chairs (112), merged (80) and
  serves (40 per piece and answer); a bar whose Wilson upper bound is above it
  is reported as such, not claimed;
- **the choice between the two models is made on dev (families 8 and 9 only —
  14/15, the V4/S1 families, are out of every choice), not on the test**;
- unparsed answers counted per row; a checkpoint is written atomically;
- V4 regression: a V4-style set rebuilt from the generators (the original
  scratch dirs are gone and the original 191 items could not be regenerated
  byte for byte — 189 items here), frozen below; run A is rescored on it beside
  its original numbers, and it is called "V4-style rebuilt", never "the V4
  test". S1 regenerated byte for byte (122 items, same as `s1-A.json`).

Frozen (sha256 of the sorted per-file sha256 list): V5 test (652 items, `cd
test && sha256sum items.jsonl meta.json img/*.png | sha256sum`) `39078daa…1642`,
items.jsonl `db953c61…65a3`; V4-style rebuilt: seat (synth_relations
`--furniture --split blind --count 12`) `fdce846f…c33d`, rel2 (`--split blind
--count 40`) `5239ce13…51c0`, synth3 (synth_levels levels 1–7 `--count 12
--split blind`) `de145eb8…b1e`; S1 `58a6896f…392d`.

## 2026-10-24 — V6: the two real plans' own symbols (written before any V6 adapter exists)

**Why.** The owner's plans come in the two drawing styles of the two real plans
here (owner, 2026-10-24: there will hardly be another symbol set). Run A's
real-plan identify was 0.75 against 0.93 on generated plans: the gap is the
drawing. V6 teaches the drawing itself.

**Data (`training/synth_real.py scenes`).** Every annotated symbol in the TRAIN
part of each plan (object centre x < 0.6 of the plan's width) is cut out with
its own pixels (paper made transparent) and composed into new scenes: real
square tables in rows or columns touching or apart, with the real armchairs
(merged yes/no), the real armchairs and crescent chairs counted around real
square and round tables (chairs 1–8), the real banquette against or away from
a column of real tables (serves), each real symbol alone at the centre with
real neighbours (identify: table, chair, banquette), and real empty paper —
half of it with a real printed word from the plan — for "nothing" (never a
crop of the bar counter, the stage, the loca strip, the T podium or an
entrance label: they are drawn but not annotated, so they are kept out by
hand-read boxes, `AVOID`). Generation-5 photometric levels on top. Labels
checked on a contact sheet (the first cut let the bar counter into "nothing";
fixed before this was written).

**Held-out real test (`synth_real.py test`, frozen):** every object in the TEST
part of both plans (x ≥ 0.6 W, never cut, never composed, never trained on):
236 items — identify (Golden: 20 tables, 47 chairs, 2 banquettes, 1 stage;
ORNEK: 70 numbered tables), 32 empty crops, 20 Golden chair counts, merged (6
touching groups, 38 separate pairs). Both plans were looked at in earlier
evaluations, so this is HELD OUT FROM TRAINING, not blind to a person; it is
the only real-plan measure there is, and it is reported as exactly that.
sha256 of `sha256sum items.jsonl meta.json img/*.png`: `0521f2b0…42f4a`.

**Training.** V6 continues each model's V5 adapter (`vlm_lora.py train --init`):
the V6 scenes plus a replay of 1,200 V5 training crops (every question), one
epoch, fp32, curriculum. 0.8B first; the 2B gets the same two stages (V5,
then V6) on the same data.

**Bars on the held-out real test** (the V5 bars where the test has the items):
identify ≥ 0.85 pooled and every class with n ≥ 10 ≥ 0.70; empty crops
fabricated ≤ 0.05; chairs exact ≥ 0.80, over ≤ 0.10; merged ≥ 0.85 and "yes" on
a separate pair ≤ 0.10. AND no question that passed on the V5 test or S1 may
fall below its bar there (regression). Real serves has no item (the test
part's two banquettes are identify items only): serves stays a generated-plan
result. Run A and the V5 adapters are scored on the same real test first, so
the before/after is on the same 236 items.

## 2026-10-25 — V5 results, 0.8B (run B), scored once against the bars above

Run B: Qwen3.5-0.8B, V5 data + run A replay (5,869 items, one epoch, fp32,
curriculum), 9,927 s of training (resumed twice after machine restarts), peak
training RSS 8,031 MB; served 1,238 MB peak (`--cache-ram 0`), median 5.9 s per
crop at 4 threads. Raw: `benchmarks/offline-intelligence/local-vlm-results/v5-*.json`.

| question | V5 test (bar) | S1 | V4-style rebuilt | held-out real (236) | verdict |
|---|---|---|---|---|---|
| identify | other 0.97, furniture 0.91, every class ≥ 0.80, empty fabricated 0.00 | – | generated 0.97, furniture 1.00, **real 0.69** (≥ 0.80) | 0.83, **chair 0.60**, empty fabricated 0.03 | **no** (V4-style real) |
| chairs | **0.62** (≥ 0.80), odd 0.68, over 0.07, printed-wrong **0.32** | 0.74 (≥ 0.80) | 0.50 | **0 / 20**, over 0.90 | **no** |
| merged | 1.00, yes-on-no 0 / 40 | 1.00, near-miss yes 0 / 20 | 1.00 | 0.89, yes on separate 2 / 38 | **yes** |
| serves | 0.87, **yes-on-no 0.31** (≤ 0.10; banquette 0.50, sofa 0.33) | 1.00, 0 / 20 | 0.88 | (no items) | **no** |
| count | 0.87, over 0.07 | – | – | (no items) | pass (not a product question) |

Same tests, run A (the adapter wired until now): V5 test merged 0.81 with "yes"
on 13 of 40 separate pairs, held-out real merged 0.59 with "yes" on 18 of 38,
empty fabricated 0.19 real / 0.20 V5, chairs 0.46 / 0.20. Run A's merged fails
the V5 bar and is unwired; run B replaces it for merged. Untrained base on the
V5 test: identify 0.18 / 0.00, merged 0.68, chairs 0.41.

Independent audit (`model-qa-specialist`, 2026-10-25): SOUND WITH FINDINGS for
wiring merged only — numbers recomputed from raw rows, test hash matches, no
family or image-hash overlap between training and any test. Findings kept as
limits: the S1 near-miss Wilson upper bound (0.16) is above 0.10 (as for run
A), so the claim stays "generated plans, separate pairs ≥ 0.35 sides apart";
real touching groups are only six (3–4 of 6 recalled), so real recall of a
merged group is not established; `vlm_lora.py agree` for run B was required
before wiring. Conversion check (llama.cpp `--lora` vs transformers + PEFT,
run at low priority during V6 training, never during a benchmark): 24 / 24 on
the test's last 24 items (all serves) and 31 / 31 on 12 merged yes, 12 merged
no and 7 identify/chairs crops (`local-vlm-results/v5-agree-B-*.txt`). Run B
is wired for merged (`tools/local-vlm/manifests/qwen3.5-0.8b-merit-b.json`).
The 0.8B vs 2B choice is made later on dev, as pre-registered.

## 2026-10-25 — Changing the plan by itself: a second, stricter bar (written before any V6 or 2B result)

**Why.** The owner wants the analysis to hand over the corrected plan, not a list
of suggestions: a check the model is good enough at should apply its answer by
itself, marked as the model's and undone in one click; everything else stays a
suggestion or is left alone. A wrong change the person does not notice is worse
than an open suggestion, so passing a question's bar (it may be ASKED) is not
enough to let it CHANGE the plan.

**Bar for applying by itself (per question, per model).** On the held-out real
test (`synth_real.py test`) AND on the V5 test, over that question's items:
the answer both looks agree on is wrong on ≤ 3 % of the items (agreed-and-wrong
— the most an automatic change can get wrong), with at least 30 items on the
real test. The question must also pass its own bars above (V5, and V6 where the
model is a V6 adapter). Nothing else is applied by itself; a printed table
number never is.

**Already seen.** Run B's merged rows were looked at before this was written:
on the real test both looks said "no" on 2 of the 6 touching groups (Golden
group 3) — applied, that would split two real long tables — so agreed-and-wrong
is 2 / 44 = 0.045 > 0.03, and merged is NOT applied by itself for run B. That
verdict is reported as made with the rows in view; the bar is a pre-registration
for every adapter not yet scored (runB6, 2B, 2B6).

**In the product.** A manifest lists what may be applied by itself
(`autoApply`, a subset of `checks`) only with this evidence. An applied change
goes through the same writer as a person's Accept, is marked "applied by the
model" with its run, is never captured as a person's decision for training, and
is undone from the panel or the undo list.

## 2026-10-25 — Two follow-ups, written before runB6's results are complete

(Only runB6's partial real-test rows had been looked at: chair identify up, chair
count still low, merged possibly down.)

**1. One adapter per question.** llama.cpp serves one base model with several
LoRA adapters loaded and chooses each adapter's scale per request. The product
may therefore use, per question, the adapter that passes it. Rule: a question is
served by an adapter only if that adapter passes the question's bars (V5, V6
where it is a V6 adapter, regression rule); when several pass, the one with the
higher accuracy for that question on dev (families 8 and 9), never on a test;
the relay verifies every loaded adapter by sha256 as it does one today. Memory
bar unchanged (peak server RSS ≤ 3,000 MB with all adapters loaded).

**2. Seat counts from chairs, one by one.** Counting chairs around a table is
the question the model fails; telling whether one symbol is a chair is one it
may pass. A table's count then becomes: the chairs the detector found around it
that the model calls `chair` on both looks (identify), counted by geometry — the
model never says a number. Measured on the held-out real test's 20 Golden
chair-count tables, using the detector's own chair candidates on those tables:
exact count ≥ 0.80 and over-count ≤ 0.10 (the chairs bars), reported beside the
detector alone. It is wired only if identify passes for that adapter and this
passes.

## 2026-10-25 — V6 verdict for runB6, and runB6b (written before runB6b exists)

**runB6 (0.8B, V6) — not wired.** Held-out real test: identify 0.964 (table
0.978, chair 0.957), empty fabricated 0.00 — the V6 identify bars pass; chairs
0.20 (over 0.80) and merged 0.841 with "yes" on a separate pair 0.184 fail. V5
test: identify still passes (0.962 / 0.889, every class ≥ 0.73), merged 0.975 /
0.05; S1 merged and serves pass. **But count, which run B passed on the V5 test
(over-count 2 / 30), over-counts 4 / 30 (bar ≤ 0.10): a question that passed fell
below its bar, so by the regression rule nothing of runB6 is wired.** The rule is
applied as written, though the difference is two items.

**runB6b.** The known remedy for a skill lost while learning a new one is more
replay of the old data. runB6b is runB6's recipe with the replay doubled
(`--replay-max 2400`, every question), everything else the same (init run B,
V6 scenes, one epoch, fp32, curriculum, seed 3). Because it was decided with the
V5 test's results in view, it is scored on a FRESH V5 test — `synth_vlm.py
--split blind3` (families 16 and 17, seed base 54, `--scale 0.1`, 652 items),
frozen now: sha256 of `sha256sum items.jsonl meta.json img/*.png` =
`5199eb21…1b63`, items.jsonl `4cc0de05…7a`. The held-out real test and S1 stay
as they are (the real test is the only real one; it is reported as scored a
second time). Bars and the regression rule unchanged; the regression reference
is run B on the V5 test and S1. The 2B follows runB6b, on the original recipe.

## 2026-10-26 — runB6b verdict: not wired (identify regresses on the fresh test)

runB6b: 323.9 min of training (575 steps, 4.2 s per item, peak
training RSS 8,049 MB); served 1,240 MB peak, median 5.9 s per crop; adapter
sha256 `2980ab5e…a457b`. Raw: `local-vlm-results/v5-{real,v5n,s1,dev}-B6b.json`;
run B on the same fresh test `v5-v5n-B.json`; untrained base on the real test
`v5-real-base08.json`; runB6 on dev `v5-dev-B6.json`.

| question | fresh V5 test (blind3): B → **B6b** | S1: B → B6b | held-out real (236): base / B / B6 → **B6b** |
|---|---|---|---|
| identify | pass → **fail**: bench **10 / 15 = 0.67** (< 0.70; B 13 / 15), furniture 0.87, other 0.99, empty fabricated 0 | – | 0.16 / 0.83 / 0.96 → **0.97** (agreed-and-wrong 0 / 140), empty fabricated 0.28 / 0.03 / 0 → 0.03 |
| chairs | fail → fail (0.71 → 0.74, over 0.04 → 0.06) | fail → fail (0.74 → 0.69) | 0.05 / 0 / 0.20 → 0.10 (over 0.90) |
| count | pass → pass (0.90, over 0.03 → 0.07) | – | (no items) |
| merged | pass → pass (1.00 → 0.99, yes-on-no 0 → 1 / 40) | pass → pass | 0.89 / 0.89 / 0.84 → **0.93**, yes on separate 0 / 2 / 7 → **1 / 38**, agreed-and-wrong 1 / 44 |
| serves | fail → fail (yes-on-no 0.27 → 0.17) | pass → pass (1.00 → 0.88, 0 / 20 yes on negatives) | (no items) |

**Verdict.** Doubling the replay fixed what broke runB6 (count over-count back to
2 / 30) and runB6b is the best adapter so far on the real test for identify and
merged. **But identify, which run B passes on the same fresh test, falls below its
bar there (the bench class 10 / 15 < 0.70): by the regression rule nothing of
runB6b is wired.** Applied as written; the difference is three bench crops. Run
B stays wired for merged. Because no adapter now passes identify on both the
V5-style and the real tests, seat counts from per-chair identify (follow-up 2)
cannot be wired yet; it is still measured (with the trainer paused) for the
record. The 2B (V5, then V6) runs next on the original recipe.

## 2026-10-26 — The regression rule, per question from now on (written before any 2B result)

**Why.** The rule as written rejects a whole adapter when any one question falls
below its bar. runB6b was rejected for three bench crops in identify while its
merged answer was the best measured on the real plans. All-or-nothing protects
nothing here: a question is wired on its own evidence and served by its own
adapter (follow-up 1), so a regression in one question says nothing about another.

**Rule from now on (run2B, run2B6 and every later adapter).** An adapter may serve
question Q only if (a) Q passes all its bars (V5 test, S1 where it has items, the
held-out real test where it has items, V6 bars for a V6 adapter) AND (b) Q itself
does not fall below its bar where the reference adapter passed it. A regression
in another question blocks that other question only. Every bar is unchanged.

**Not applied backwards.** runB6b and runB6 keep their verdicts (nothing wired):
this rule was written after their results were seen, and re-judging them by it
would be choosing the rule by the result.

**Owner's decision (2026-10-26): one model, not one adapter per question.** Follow-up
1 (several adapters, per-request scale) is dropped. The product ships ONE adapter:
the best overall by measurement (0.8B line: runB6b; then run2B / run2B6 when
scored), wired for the questions it passes (rule above); the winner is trained
further on its measured weaknesses (bench identify, chair counts), with the same
bars and fresh tests.

**runB6b wired for merged (owner's decision, 2026-10-26, after its results).** The
owner chose one model, the best overall, and asked that it be used: runB6b
replaces run B for **merged**, the one question it passes on every test it has
items in (fresh V5 test 0.99 / yes-on-no 1 / 40; S1 1.00 / 0 / 20; held-out real
0.93 / 1 / 38). Its identify regression (bench 10 / 15) blocks identify only. No
bar was changed; what changed is the all-or-nothing scope of the regression rule,
by the owner's decision after the results were seen, and it is recorded as such.
Run B's manifest keeps its evidence with `checks: []`. Conversion check and audit
before wiring: `local-vlm-results/v5-agree-B6b.txt`.

## 2026-10-27 — Owner: 2B dropped, B6b is the one model; B6b's language test (written before it runs)

**2B stopped (owner's decision).** run2B (V5 stage) on the held-out real test:
identify 0.90 (B 0.83, B6b 0.97), empty crops fabricated **0.156** (B / B6b
0.031), merged 0.864 with "yes" on separate 2 / 38 and 2 of 6 groups found, chairs
0 / 20; median 20.8 s per crop (B6b 5.9 s), peak 1,996 MB. Raw
`local-vlm-results/v5-real-2B.json`. Its fresh-test run was stopped part-way and
run2B6 was not trained: B6b is better on every real-plan row and 3.5× faster.

**Language test (AI planner, step 0).** `training/planner_brief_eval.py` asks the
model to turn each of 40 Turkish briefs (`training/planner_briefs.jsonl`, written
by hand before any model saw them: typos, words for numbers, slang such as
"180'lik", "8er") into a fixed JSON shape (schema-constrained, temperature 0),
and scores every field the brief states; fields it fills that the brief does not
state are reported as invented. Run for the base 0.8B and for B6b (does the plan
LoRA hurt language?). Bar for the model alone, for the planner's parser (the
planner adds a rule parser in front, AI-PLANNER-DESIGN.md §6): fields right
≥ 0.90 and invented ≤ 0.05. Eight everyday chat prompts are answered and kept as
written for the owner to read; they are not scored.

## 2026-10-27 — runB6c: B6b fed further on its weak points (written before any B6c data is made)

**Owner:** one model, B6b, "fed to the maximum". **Data, all from training sources:**
`synth_real.py scenes --plan2 --tuck 0.5 --seed-base 62` (real TRAIN-part symbols;
360 chair crops, half of them TUCKED — drawn half under their table, the crop
centred on what still shows; chair counts with tucked chairs; more serves and
banquettes) and `synth_vlm.py --split train2 --scale 0.6` (training families, new
seed base 55, weighted to sofa / bench / banquette identify and serves). Training:
`vlm_lora.py train --init runB6b`, data = those two + a replay of 1,200 V6 scenes
and 1,200 V5 training crops, one epoch, fp32, curriculum. The V5/V6 generators'
defaults are unchanged (V6 scenes regenerated byte-identical, checked).

**Tests, frozen when generated (before B6c is trained):** a NEW fresh V5 test
`synth_vlm.py --split blind4 --scale 0.1` (families 16 and 17, seed base 56 —
B6b's weaknesses were read off blind3, so blind3 is no longer fresh); a TUCKED
test from the plans' held-out TEST part (`synth_real.py scenes --sprites test
--plan2 --tuck 0.7 --seed-base 63 --scale 0.3`: never-trained symbols); S1; dev
(selection); and the held-out real test, scored a fourth time and reported as
such. B6b is scored on blind4 and the tucked test too, so every comparison is on
the same items.

**Bars.** Every question keeps its V5/V6/S1 bars; the rule is per question (2026-10-26):
B6c serves a question only if it passes that question's bars and does not fall
below a bar B6b passes on the same test. New: tucked chairs identify ≥ 0.80 on
the tucked test (both looks agree), with empty-crop fabrication ≤ 0.05 there.

**Wired (2026-10-27).** Conversion check for runB6b (llama.cpp `--lora` vs
transformers + PEFT, the same 31 crops as run B: 12 merged yes, 12 merged no, 7
others): 31 / 31 (`local-vlm-results/v5-agree-B6b.txt`). Audit (`model-qa-specialist`):
SOUND WITH FINDINGS; kept as a limit: on the real test merged rests on 6 touching
groups and 38 separate pairs — B6b found 4 of the 6 groups on the first look (run
B 3), so its real recall of a long table is not established. `merged` now comes
from `qwen3.5-0.8b-merit-b6b`; run B's manifest lists no check.

**Seat counts from chairs one by one (follow-up 2), runB6b, 2026-10-27.** The
detector's own chairs on the 20 Golden held-out chair-count tables (42 detected
chairs, every table found), each asked `identify` with two looks; a table's count
is the chairs both looks call `chair`. **Model exact 18 / 20 = 0.90, over-count
1 / 20 = 0.05 — passes** the pre-registered bars (exact ≥ 0.80, over ≤ 0.10).
Detector alone: exact 0.85, over 0.10. The model removed one detector extra
(t015), kept one (t020), and cannot add the chair the detector missed (t038:
5 of 6) — it never makes a chair. By the rule written then, it is wired only when
identify passes for that adapter: B6b's identify fails on the fresh V5 test
(bench), so this waits for runB6c. Raw `local-vlm-results/v5-seatcount-B6b*.json`.

**Language test, results (2026-10-27).** Base 0.8B: fields right 0.643, briefs all
right 7 / 40, invented 0.435; B6b: fields right 0.768, all right 13 / 40, invented
**0.771** — both fail (≥ 0.90, ≤ 0.05). The plan LoRA did not hurt reading the
stated numbers (it helped) but it fills unstated fields far more. The everyday
chat answers (kept in the files) are fluent Turkish with wrong facts (e.g.
"kokteylde kişi başı 1 m², bardaklar yüzünden"): a 0.8B model is no source of
facts; the planner and the event-questions assistant must take every fact from
the app's code and data (AI-PLANNER-DESIGN.md §1, §11). Raw
`local-vlm-results/lang-{base08,B6b}.json`.

**runB6c gets language too (added before runB6c is trained).** 1,500 text-only
items from `training/synth_briefs.py` (a grammar written after the 40 test briefs,
never producing one of them; seed 64): brief → the full JSON with nulls.
`vlm_lora.py train` now takes text-only items (no image: the chat template with a
system message, as llama-server builds it; image items unchanged). The 40
hand-written briefs stay the test; the bar is unchanged (fields ≥ 0.90, invented
≤ 0.05), and the vision questions are judged as pre-registered above.

**runB6c tests frozen (2026-10-27 13:20 UTC, before training).** Fresh V5 test
`blind4` (families 16 and 17, seed base 56, scale 0.1): sha256 of
`sha256sum items.jsonl meta.json img/*.png` begins `d24e1a91f38d63f7`; tucked
test (held-out TEST-part symbols, seed base 63, tuck 0.7, scale 0.3): begins
`b35c0da3f7cd477b`. runB6c trains on 7,361 items (921 steps).

**Changing the plan by itself — first question applied (2026-10-28).** By the
bar written 2026-10-25 (before B6b was scored), B6b's merged answers: on the
held-out real test both looks agree and are wrong on 1 / 44 = 0.023 (≤ 0.03,
n ≥ 30), on the fresh V5 test 0 / 80; merged passes its own V6 bars (wired
2026-10-27). So `qwen3.5-0.8b-merit-b6b` lists `autoApply: ["merged"]`: when
both looks say two pushed-together tables are separate, the product writes the
grouping answer "separate" by itself, marked `by: "model"` with its run, audited,
never a training example, undone from its finding (suite `local-auto-apply`;
the manifest's evidence is re-checked by `local-second-look`). An answer that
AGREES with the analysis changes nothing. Limit kept: on the real test B6b's
merged rests on 6 touching groups — and its one agreed-and-wrong answer is a
touching group (Golden group 3, both looks "no"): applied, the product would split
that one real long table into separate tables, marked as the model's and undone
in one click. Within the bar as written; said here so it is not hidden.

**Rules-first brief reader, scored once (2026-10-27).** `MeritAssistantParse.brief()`
(src/assistant-parse.js), written after the 40 hand-written briefs existed but
without running on them, scored on them once: **fields right 0.952, invented
0.002** — passes the bar set for the parser (≥ 0.90, ≤ 0.05; the model-alone
results above were 0.64 base / 0.77 B6b). Same author for rules and briefs, so
this is DEVELOPER-SEEN, not unseen; misses seen (10'ar kişilik, "180lik",
"Ø180" without "yuvarlak", "şirket yemeği", 60 bistro) are NOT tuned on this
set — any rule change is to be measured on a fresh brief set (the owner's own
sentences).

## 2026-10-28 — Chat-model race: the F8 assistant's second reader (written before any candidate runs)

**Question.** Which local chat model reads what the F8 rules cannot — the
owner's own phrasing of questions, commands and event briefs — well enough to
stand behind the rules? The model never states a fact and never changes the
plan itself: it returns the rules' own shape (`parse()`), and the same code
answers from the data and acts through the writers.

**Candidates** (all on this machine, 4 CPU threads, `-c 4096`, temperature 0,
thinking off, schema-constrained JSON): Qwen3.5-4B Q4_K_M (unsloth GGUF);
Gemma 4 E4B-it Q4_K_M; Kara-Kumru v1.0 2B (AlicanKiraz0, Apache-2.0) as the
third-party Q8_0 GGUF `senoleker/Kara-Kumru-v1.0-2B-GGUF` — checked against the
original safetensors before use (6 tensors, correlation ≥ 0.99998, max relative
error ≤ 0.004, i.e. Q8_0 rounding; sha256 begins `e7ccf5fa25292b68`); and
runB6c (0.8B + plan LoRA, trained on 1,500 generated briefs).

**Tests.** (1) The 40 hand-written briefs (`planner_brief_eval.py`, bar
unchanged: fields right ≥ 0.90, invented ≤ 0.05). (2) The F8 sets: the 35
originals (`questions.jsonl` 20, `commands.jsonl` 15 — DEVELOPER-SEEN for the
rules) and **35 new paraphrases** written now, before any candidate or the rules
ran on them (`training/assistant/variants.jsonl`, each with its original's
outcome; sha256 of the file begins `6927290e28a3af3f`): no apostrophes, other
verbs ("yerleştir", "geçsin", "listeden çıkar"), other word order.
`training/assistant_race.mjs` scores each sentence three ways — rules alone,
model alone, rules first then the model where the rules say "unknown" — by the
facts the answer must carry and the exact writer calls (or a question / refusal
with nothing changed). A writer call that is not the expected one is a WRONG
CHANGE.

**Bar for the second reader** (rules + model, on the paraphrases): right ≥ 0.90
and **0 wrong changes** on originals and paraphrases together; and the brief bar
above for the model alone. **Choice:** among those that pass, the most right on
the paraphrases, then the faster (median seconds). If none passes, none is wired;
the rules stay alone and the result is reported. Run order: after the B6c chain
(no other job on the CPU); the rules-alone score on the paraphrases is measured
once and the rules are NOT changed on it.

## 2026-10-28 — runB6d: B6c taught to say "nothing" again (written before any B6d data exists)

**Why.** B6c learned the tucked chair (tucked test: both looks agree on 0.96 of
the tucked chairs, B6b 0.76) but says "chair"/"banquette" on empty paper more
often: empty-crop fabrication on the tucked test 0.229 first look (B6b 0.125),
on the held-out real test 2 / 32 = 0.062 (B6b 1 / 32) — above the 0.05 bar. (Read
off the tucked and real tests, so neither is fresh for B6d.)

**Data, from training sources only.** `synth_real.py scenes --plan3 --tuck 0.5
--seed-base 68 --scale 0.6` (PLAN3: real TRAIN-part paper and symbols; 400 empty
crops — plain or with a printed word — and 240 NEW "edge" empty crops: empty paper
at the centre with a real table or chair cut off by the crop's edge, the identify
question being about the centre; against 240 chairs, half tucked; fewer of the
rest) + 200 of B6c's generated briefs (language kept). Replay: 400 each from B6c's
training set and V5 training crops. `vlm_lora.py train --init runB6c`, one epoch,
fp32, curriculum. Generators' defaults unchanged (PLAN/PLAN2 untouched).

**Tests.** A FRESH tucked test from the plans' held-out TEST part (`synth_real.py
scenes --sprites test --plan2 --tuck 0.7 --seed-base 69 --scale 0.3`, frozen
before B6d data is made; B6c is scored on it too); blind4 (B6c's summary was read,
not its rows; B6d's change was decided from the tucked and real tests); the
held-out real test, scored a fifth time and reported as such; S1; the language
test. **Bars:** B6c's (per question, and not below a bar B6c or B6b passes on the
same test); for identify the empty-crop fabrication ≤ 0.05 on the fresh tucked test
AND on the real test, with tucked chairs ≥ 0.80 (both looks) on the fresh tucked
test. Run after B6c's chain; then the chat-model race (CPU free), then B6d's benches.

**Amended 2026-10-28 ~11:30 Istanbul, before any B6d data exists (owner: the model
is finished today).** scenes3 at `--scale 0.5`, replay 300 per source (shorter
training); B6c's dev run dropped (dev only selects; it is no bar); B6d's benches
run first, in this order — fresh tucked test, real, blind4, S1, language — then the
chat-model race and B6c on the fresh tucked test. Bars unchanged.

**Amendment withdrawn the same hour (owner: "do it fully, not shorter; finished by
06:00 tomorrow"), still before any B6d data exists:** scenes3 back to `--scale 0.6`,
replay 400 per source, B6c's dev run kept. Order: B6d trains → the chat-model race →
B6d's benches (fresh tucked, B6c on it, real, blind4, S1, language). Bars unchanged.

## 2026-10-28 — runB6c verdict (bars as pre-registered; per-question rule)

Raw: `local-vlm-results/v5-{tuck,real,blind4,s1}-B6c.json`, B6b on the same tucked
and blind4 items `v5-{tuck,blind4}-B6b.json`. Two looks, prompt cache off.

| question | blind4 (fresh V5) | S1 | real (4th time) | verdict |
|---|---|---|---|---|
| identify | pass (other 0.93, furniture 0.98, empty 0 / 40, every class ≥ 0.80) — B6b also passes here | – | **fail**: 0.957, empty crops called something on look 1 **2 / 32 = 0.062** (> 0.05; B6b 1 / 32) | not served |
| tucked chairs (new bar) | – | – | – | tucked test: both looks right on **0.96** of 76 tucked chairs (B6b 0.76) — passes ≥ 0.80; empty-crop fabrication on that test 0.229 look 1 / 0.083 both (> 0.05; B6b 0.125 / 0.062) — **fails** |
| chairs | fail (0.72; B6b 0.74) | pass (odd 0.83, all 0.86, over 0.05) | 0.10 (as every run) | not served |
| merged | pass (79 / 80, yes on 1 of 40 separate) | pass (40 / 40, near-miss 0) | pass (42 / 44, yes on 2 / 38 separate — both on one look only; **agreed-and-wrong 0 / 44**) | **served**; B6b passes the same bars, B6c does not fall below any |
| serves | fail (0.88 but yes on separate 0.28) | pass (0.975, 0 / 20) | – | not served |

**Applying merged by itself** (bar of 2026-10-25): real agreed-and-wrong 0 / 44,
blind4 0 / 80 — passes; better than B6b (1 / 44, one real long table split).
**One model** (owner): B6c takes merged and its autoApply from B6b; B6b's manifest
lists no check. Conversion check (llama.cpp `--lora` vs transformers + PEFT, the
31 crops used for B and B6b) before wiring: see below. The language result
(`lang/B6c`) is reported with the chat-model race. runB6d (pre-registered above)
targets the empty-crop fabrication that keeps identify off.
