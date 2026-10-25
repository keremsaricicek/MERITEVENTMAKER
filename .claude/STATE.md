# Current state (read this first; update at every milestone)

Last updated: 2026-10-24 (Istanbul evening). Branch: `claude/merit-concept3-plan-intelligence-rebirth` (PR #5 — never merge, never force-push). Owner talks Turkish, non-technical: short, simple answers; times in Istanbul time (UTC+3).

## Owner's standing constraints
No EXE (one-click `.cmd` launcher allowed). No paid API/GPU/service, no private data uploaded. No merge/force-push. No invented plans or human tests. Don't lower bars to pass. Train 0.8B first, then 2B on the same data (mandatory). Save tokens (2026-10-24): short replies, few subagents, sparse checks.

## Local VLM programme (where the work is)
- Pre-registrations and verdicts: `training/README.md` sections "V5" and "V6" (bars, splits, frozen-test hashes, QA amendment). Never change a bar after a result.
- Generators: `training/synth_vlm.py` (V5 question crops), `training/synth_real.py` (V6: the two real plans' own symbols; test = right 40% of each plan, 236 items).
- Training: `training/vlm_lora.py train` (fp32 on this CPU, `--curriculum`, `--init`, resume every 25 steps). Bench: `benchmarks/offline-intelligence/local-vlm-bench2.py --v5 DIR` (summary.v5, summary.tasks).
- Run order and recovery: `tools/local-vlm/v5/README.md`, `tools/local-vlm/v5/pipeline.sh`. Checkpoints pushed every 2 h to branch `claude/v5-train-state` (owner's permission).
- Scratch (this container only): `S=/tmp/claude-0/-home-user-MERITEVENTMAKER/7b41f49a-1109-57da-b022-838b2499b2be/scratchpad`; chain log `$S/v5/chain.log`; results `$S/v5/out/*.json`; `$S/scripts/ensure.sh` restarts chain + backup after a machine restart.
- The cloud machine stops when the session is idle; a background task/monitor keeps it up; everything resumes from checkpoints.

## Status (2026-10-24 ~21:30 Istanbul)
- 0.8B V5 training (runB): ~step 700/734, then automatic benches (V5 test, real held-out, base, run A, S1, V4-style, dev), then V6 fine-tune (runB6) + benches, then 2B probe → 2B V5 → 2B V6 + benches.
- Wired in product today: run A, `merged` only (manifest `tools/local-vlm/manifests/qwen3.5-0.8b-merit-a.json`).
- Third real plan: owner may send one → keep it as the never-seen blind test (label first, owner confirms counts, score once at the end).
- ViT idea: after 2B, a small ViT classifier on the same data/test (pre-register first).

## Results so far (2026-10-25 ~02:45 Istanbul; raw in `benchmarks/offline-intelligence/local-vlm-results/v5-*.json`)
- run B (0.8B V5) on V5 test: passes identify, count, merged (1.00, yesOnNo 0); fails chairs (0.62; printedWrong 0.32), serves (0.87 but yesOnNo 0.31; banquette 0.50).
- Real held-out: B merged 0.886 / yesOnNo 0.053 (pass), empty fabricated 0.031, identify 0.83 (chair 0.60), chairs 0/20 (over 0.90). Run A: merged 0.59 / yesOnNo 0.47 (the wired check is unreliable on real plans), empty fabricated 0.19, chairs 0.20.
- DONE 2026-10-25 ~09:55: run B wired for merged (manifest `qwen3.5-0.8b-merit-b.json`, adapter in `models/local-vlm/qwen3.5-0.8b-merit-b/`); run A's merged unwired (fails V5 bar). QA SOUND WITH FINDINGS; agree 55/55. Verdicts in `training/README.md` "V5 results". Windows package must use manifest B (or the later winner).
- runB6 (V6) training started 05:19 UTC.
- Owner (2026-10-25): wants the analysis to hand over the CORRECTED plan (AI applies fixes itself, marked + one-click undo) and a progress bar. Progress bar DONE (analysis + second look). Auto-apply: stricter bar pre-registered in `training/README.md` ("Changing the plan by itself", agreed-and-wrong ≤ 3 % on real + V5, n ≥ 30); run B merged fails it (would split 2/6 real long tables). Build the mechanism (manifest `autoApply`, apply via the same writer, never a training label) when a question passes it.
- Owner: GPU auto-use in the Windows package (Vulkan llama.cpp + CPU fallback + first-run answer check against CPU answers); EXE only after "EXE YAP".
- runB6 real test (2026-10-25): identify 0.964 (chair 0.957, table 0.978), empty fab 0, chairs 0.20, merged 0.841 / yes-on-no 0.184 (agreed-wrong 1/44; all 6 real groups found). Waiting v5-B6, s1-B6, dev-B6 for the regression rule before wiring identify from B6.
- Pre-registered (before full B6 results): per-question adapters (dev picks; relay loads several LoRA, per-request scale) and seat counts from per-chair identify (`training/seat_count_eval.py`; needs `node benchmarks/run-benchmark.mjs merit-real-venue --dump DIR` then bench2 `--v5 DIR` with the B6 adapter, then `score`). Run during 2B training with the trainer paused.
- Owner (2026-10-25): chairs are sometimes drawn half UNDER the table (tucked), round tables too — only a sliver shows. Next data/eval round must include tucked chairs (real sprites drawn under the table edge) and the per-chair/symbol-family path must handle slivers; round tables: evenly spaced pattern around the rim as a check (never to synthesise chairs).
- Running tests during training: pause the trainer with SIGSTOP, resume with SIGCONT (logged in chain.log); never during a benchmark.
- Owner asleep, gave every permission (2026-10-25 ~02:50): continue without asking; 2B takes ~2 more days — say so honestly.

## Next actions when results arrive
1. Read `$S/v5/out/*.json` summaries (`summary.v5.passes`, `summary.tasks`); compare against the pre-registered bars; QA audit (`model-qa-specialist`, narrow brief).
2. Commit raw results to `benchmarks/offline-intelligence/local-vlm-results/`; write verdicts in `training/README.md`.
3. Wire only passing questions (manifest `checks` + `checksEvidence` + `serve`); add model files to `models/local-vlm/`.
4. Windows package: `tools/local-vlm/windows/build-package.sh` (+ `MERIT-Baslat.cmd`, `BENIOKU.txt`); sample plan `$S/sample/pkg/ornek-plan.png` (generated, ours); verify offline on Linux (say it is a Linux simulation).
5. Final: full `npm test`, both offline builds + verify, CI green; short Turkish report with tables (old/new, 0.8B/2B, time, RAM, remaining corrections).

## Token economy decisions (2026-10-24, owner approved)
- CLAUDE.md short; full text in `.claude/PROJECT-GUIDE.md`. Owner compacts this long chat with `/compact`; nothing may be lost: this file + `training/README.md` + `tools/local-vlm/v5/README.md` carry the state.
- Rejected after research/measurement: OmniRoute (critical RCE CVE-2026-88062, ToS/MITM risk), Caveman (≈ "be concise", +1.2k tokens/request, worse Turkish clarity), RTK (small gain here, hides output), Graphify (measured on 3 real questions: 25–70x larger answers, pointed at the shadowed pre-v8 `saveState`, skipped `seat-model.js`; uninstalled, nothing added to the repo), auto-fallback to other AIs (security/ToS/quality).
- Keep-alive: one background Bash loop (~100 min, exits by itself, re-armed on completion; it runs `$S/scripts/ensure.sh` every 2 min). No hourly check-in reminders.
- Owner: Turkish only, no routine status messages.

## Done this round (all pushed)
- Storage: unload snapshot fixes "change just before closing is lost" (resilience-records).
- Relay: serves the offline build's `assets/` (`MERIT_APP_ROOT`); per-crop answer cache.
- Second look: loca/entrance/exit words (planned only when identify is measured).
- CLAUDE.md shortened to the essentials; full text in `.claude/PROJECT-GUIDE.md`.
