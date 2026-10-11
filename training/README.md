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
