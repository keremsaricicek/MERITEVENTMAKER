# Teacher and student: moving what a large model or a person knows into the local model

Recorded 2026-10-11. Three kinds of learning are kept apart, in code and in
wording:

| Kind | What it does | Where | What it is NOT |
|---|---|---|---|
| **Decision memory** | the same object on the same plan keeps a person's decision on a re-analysis or a re-scan | `src/plan-memory.js` | not learning; it recalls decisions |
| **Local examples** | a symbol a person confirmed is used to search for other drawings of the same symbol | `src/plan-exemplar.js` | not training; it matches |
| **Model training** | verified labels produce a new detector version | `training/` | not automatic; a version is built, measured, then activated by a commit |

## The pipeline

1. **A plan is read.** The local model, the classical detector and (optionally,
   with the key in the relay's environment and a person's confirmation) the
   hosted model reading all contribute suggestions.
2. **A person decides.** A teacher's suggestion becomes a label only when a
   person accepts it. Accept runs through the review's single writer
   (`decideReview`), which also captures a training record with the crop and
   full provenance (`benchmarks/TRAINING-DATA.md`).
3. **Export with verification states.** `training/export_plans.py` turns an app
   backup into a dataset version. Every label keeps how it was made:
   - `human-confirmed` and `accepted-on-confirm` are kept apart;
   - `teacher-suggested` and `unreviewed` are never training targets;
   - the split unit is the venue.
4. **Train a candidate model.** Run `training/detector.py train` with the new
   dataset plus synthetic data, on a developer machine, in the background.
   Nothing trains on the operator's machine while it is in use.
5. **Regression before activation.**
   - **Must not fall:** the new version is measured with
     `benchmarks/offline-intelligence/run.mjs` on the regression set and the
     cross-venue folds. A guarded field that gets worse blocks activation.
   - **Must rise:** its score on the new venue's held-out plans.
6. **Activate or roll back.** `training/package.py --activate` pins the new
   version (size + sha256) in `src/plan-model.js`. Every version's files stay
   in `models/plan-detector/`, so rolling back is re-pinning the previous one
   (one commit). The app refuses a model whose bytes do not match the pin.

## Tested without a key

The hosted reading is exercised against `tests/lib/fake-anthropic.mjs`, whose
answers are scripted. A green run proves the plumbing:
suggestion → person → label → export → train → package → load. It **never**
proves a model's quality, and no number from it is reported as accuracy.

## Using a provider's outputs to train the local model

From Anthropic's Commercial Terms, as the web search returned them on
2026-10-11:

- the customer owns its outputs;
- Anthropic does not train on customer content;
- the customer may not access the Services "to build a competing product or
  service, including to train competing AI models", unless Anthropic approves.

A plan-symbol detector inside an event-operations product is not a
general-purpose AI model. Whether that clause reaches it is a legal judgement
for you, not something this repository decides. Until you confirm it, teacher
outputs are only used after a person accepts them, as that person's labels.
No unreviewed teacher output is ever used as a training target.
