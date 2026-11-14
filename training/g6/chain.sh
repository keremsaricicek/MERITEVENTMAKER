#!/bin/bash
# runS + detector v5-s (training/README.md 2026-11-08 pre-registration). Resumable: each step leaves a mark.
S=/tmp/claude-0/-home-user-MERITEVENTMAKER/7b41f49a-1109-57da-b022-838b2499b2be/scratchpad
R=/home/user/MERITEVENTMAKER; P=$S/pyenv/bin/python; D=$S/g6/data; DD=$S/det/data; RUNS=$R/runs; LOG=$S/g6/chain.log; O=$S/g6/out
WT=$S/wt-s; L=$S/llama-linux/bin/llama-server; M=$S/models/serve
export PYTHONDONTWRITEBYTECODE=1
mkdir -p $S/g6/marks $O $RUNS/v2ref-s $RUNS/v5-s
say() { echo "== $(date -u +%FT%TZ) $*" >> $LOG; }
mark() { touch $S/g6/marks/$1; }
done_() { [ -f $S/g6/marks/$1 ]; }
lock() { flock $S/cpu.lock nice -n 5 "$@"; }
cd $R
grep -q DATA-DONE $S/g6/make_data.log || { say "data not done"; exit 1; }
THR=$S/det/thr05.json
EXAM_G="exam-G:$D/exam:23,20,21,22"; EXAM_P="exam-P:$D/exam:26,24,25"
OLD="gen3val:$DD/gen3val: gen3heldout:$DD/gen3heldout: gen3blind:$DD/gen3blind: gen3blind2:$DD/gen3blind2: g18val:$DD/g18val: g10Lval:$DD/g10Lval:"
evals() { # run model
  for es in $EXAM_G $EXAM_P $OLD; do
    IFS=: read set dir fams <<< "$es"
    [ -f $RUNS/$1/eval-$set.json ] && continue
    lock $P -I training/detector.py eval --model $2 --plans $dir ${fams:+--families $fams} --thresholds $THR --report $RUNS/$1/eval-$set.json > /dev/null 2>> $LOG || say "eval $1 $set FAILED"
  done
}
# 1. detector
if ! done_ det-train; then
  say "v5-s train start"; t0=$(date +%s)
  SYN=$DD/gen2train,$DD/gen3train,$DD/g18train,$DD/g10Ltrain,$D/train,$D/train
  lock $P -I training/detector.py train --synthetic $SYN --exclude-families 8,9 --init $S/det/v2src/model.pt --steps 4000 --out $RUNS/v5-s > $RUNS/v5-s/stdout.log 2>&1 || { say "v5-s train FAILED"; exit 1; }
  echo $(( $(date +%s) - t0 )) > $RUNS/v5-s/wall-seconds; mark det-train; say "v5-s trained in $(cat $RUNS/v5-s/wall-seconds) s"
fi
done_ det-eval || { evals v2ref-s $S/det/v2src/model.pt; evals v5-s $RUNS/v5-s/model.pt; mark det-eval; say "detector evals done"; }
if ! done_ det-pkg; then
  PYTHONPATH=$S/det/pylib lock $P training/detector.py export --model $RUNS/v5-s/model.pt --onnx $RUNS/v5-s/model.onnx >> $LOG 2>&1
  $P training/package.py --run $RUNS/v5-s --version v5-s --parent v2 --models-dir $S/det/pkg >> $LOG 2>&1 || say "package FAILED"
  $P -I -c "
import json; S='$S'; m=json.load(open(S+'/det/pkg/v5-s/manifest.json'))
json.dump({'version':'v5-s','file':'models/plan-detector/v5-s/model.js','bytes':m['bytes'],'sha256':m['sha256'],'path':S+'/det/pkg/v5-s/model.js','fold':'v5-s','testPlan':''},open(S+'/det/pkg/v5-s/pin.json','w'))" && mark det-pkg
fi
# 2. real plans through the product, in a clean worktree at the pre-registration commit
[ -d $WT ] || { git worktree add --detach $WT HEAD >> $LOG 2>&1; ln -s $R/node_modules $WT/node_modules; ln -s $R/.vendor-cache $WT/.vendor-cache; }
bench() { # name pin
  local name=$1 pin=$2 envs=(); [ -n "$pin" ] && envs=(MERIT_BENCH_MODEL_PIN=$pin)
  if [ ! -f $RUNS/$name/bench-real.json ]; then
    (cd $WT && env "${envs[@]}" flock $S/cpu.lock node benchmarks/run-benchmark.mjs --out $RUNS/$name/bench-real.json --dump $RUNS/$name/dump-real >> $LOG 2>&1) || say "bench-real $name FAILED"
    (cd $WT && node benchmarks/record-baseline.mjs --latest $RUNS/$name/bench-real.json > $RUNS/$name/baseline-compare.txt 2>&1; echo "exit $?" >> $RUNS/$name/baseline-compare.txt)
  fi
  if [ ! -f $RUNS/$name/golden2-score.json ]; then
    (cd $WT && env "${envs[@]}" flock $S/cpu.lock node benchmarks/run-benchmark.mjs --annotations $S/det/g2annot --out $RUNS/$name/bench-golden2.json --dump $RUNS/$name/dump-g2 >> $LOG 2>&1) || say "bench-golden2 $name FAILED"
    $P -I $S/scripts/g2score.py $R/benchmarks/plans/blind/golden2-table-centres.json $RUNS/$name/dump-g2/golden2.detections.json $RUNS/$name/golden2-score.json >> $LOG 2>&1
  fi
  say "bench $name: $(tail -2 $RUNS/$name/baseline-compare.txt | tr '\n' ' ')"
}
done_ bench-v2 || { bench v2ref-s ""; mark bench-v2; }
done_ bench-v5s || { bench v5-s $S/det/pkg/v5-s/pin.json; mark bench-v5s; }
if ! done_ det-cmp; then
  for es in $OLD; do set=${es%%:*}
    $P -I training/compare_candidates.py --base $RUNS/v2ref-s/eval-$set.json --cand $RUNS/v5-s/eval-$set.json --min 1 --tol 0.0099 > $RUNS/v5-s/compare-$set-prereg.txt 2>&1
  done; mark det-cmp; say "DETECTOR-DONE"
fi
# 3. VLM runS
if [ ! -f $S/v5/runS/run.json ]; then say "runS train start"
  lock $P -I training/vlm_lora.py train --base $S/models/hf/Qwen3.5-0.8B --dtype fp32 --init $S/v5/runB6d --data $D/vlm-train,$S/v6/d6,$S/v6/c6,$S/v5/train \
     --replay-tasks ID,NEG,CHAIRS,MERGED,SERVES --replay-max 200 --curriculum --threads 4 --out $S/v5/runS >> $S/g6/runS.trainout 2>&1 || { say "runS train FAILED (resumable)"; exit 1; }
  say "runS trained"; fi
[ -f $S/v5/runS/adapter.gguf ] || lock $P -I training/vlm_lora.py gguf --run $S/v5/runS --out $S/v5/runS/adapter.gguf >> $LOG 2>&1 || { say "gguf FAILED"; exit 1; }
vbench() { local out=$1 lora=$2; shift 2; [ -f $O/$out.json ] && return; say "vbench $out"
  lock $P -I benchmarks/offline-intelligence/local-vlm-bench2.py --server $L --models $M --model qwen3.5-0.8b --lora $lora --looks 2 --ctx 2048 --cache-ram 0 --threads 4 --resume --out $O/$out.json "$@" > $O/$out.log 2>&1 || say "FAIL $out"; }
RS=$S/v5/runS/adapter.gguf; B6D=$S/v5/runB6d/adapter.gguf
S1="--seat $S/try/seat12 --rel $S/rel2/blind --syn $S/synth3/blind --s1 $S/s1/blind --seed 17"
vbench g6exam-S $RS --v5 $D/vlm-exam
vbench real-S $RS --v5 $S/v6/realtest
vbench tuck2-S $RS --v5 $S/v6/tucktest2
vbench blind4-S $RS --v5 $S/v5/test4
vbench s1-S $RS $S1
vbench g6exam-B6d $B6D --v5 $D/vlm-exam
say "CHAIN-S-DONE"
