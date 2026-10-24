#!/bin/bash
# V5 pipeline, resumable from nothing (developer machine, Linux x86-64, CPU).
# A reset machine runs this once and continues where the work stopped:
#   1. tools: micromamba, llama.cpp 11351 cpu_mkl (linux + win-64), Python + torch CPU
#   2. models: pinned by repository revision and sha256 (Hugging Face)
#   3. data: every set regenerated from its seeds (byte-identical; hashes in training/README.md)
#   4. resume state: the newest checkpoint from branch claude/v5-train-state
#   5. the chain: train 0.8B -> measure -> train 2B -> measure (every step skipped when done,
#      training and benchmarks resume from their own checkpoints)
#
#   S=/path/to/scratch tools/local-vlm/v5/pipeline.sh
set -u
: "${S:?set S to a scratch directory}"
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
mkdir -p "$S/scripts" "$S/models" "$S/v5"
export MAMBA_ROOT_PREFIX=$S/mm/root
if [ ! -x $S/mm/bin/micromamba ]; then mkdir -p $S/mm && (cd $S/mm && curl -sSfL -o mm.tar.bz2 https://conda.anaconda.org/conda-forge/linux-64/micromamba-2.9.0-0.tar.bz2 && tar -xjf mm.tar.bz2 bin/micromamba); fi
MM=$S/mm/bin/micromamba
cd $S
step(){ echo "== $(date +%T) $*"; }
if [ ! -x $S/llama-linux/bin/llama-server ]; then step llama-linux
  $MM create -y -p $S/llama-linux -c conda-forge "llama.cpp=11351=*cpu_mkl*" >/dev/null 2>&1 && echo ok || echo FAIL; fi
if [ ! -x $S/pyenv/bin/python ]; then step pyenv
  $MM create -y -p $S/pyenv -c conda-forge python=3.11 "pytorch=2.14.1=*cpu*" torchvision pip >/dev/null 2>&1 && echo ok || echo FAIL
  $S/pyenv/bin/pip install -q transformers==5.20.1 peft==0.21.2 gguf safetensors pillow numpy huggingface_hub opencv-python-headless sentencepiece 2>&1 | tail -2; fi
dl(){ # repo rev file sha out
  local out=$S/models/$5; [ -f "$out" ] && [ "$(sha256sum "$out"|cut -d' ' -f1)" = "$4" ] && { echo "have $5"; return; }
  mkdir -p "$(dirname "$out")"
  for i in 1 2 3 4; do curl -sSL --fail -o "$out.part" "https://huggingface.co/$1/resolve/$2/$3" && break; sleep $((2**i)); done
  if [ "$4" = "-" ] || [ "$(sha256sum "$out.part"|cut -d' ' -f1)" = "$4" ]; then mv "$out.part" "$out"; echo "got $5"; else echo "SHA MISMATCH $5"; fi; }
step gguf
dl unsloth/Qwen3.5-0.8B-GGUF 6ab461498e2023f6e3c1baea90a8f0fe38ab64d0 Qwen3.5-0.8B-Q8_0.gguf 0ad885ffd4bb022fc4f0d33a3308fa108ef8613159d3b3a67e23abca056b7a6c gguf/Qwen3.5-0.8B-Q8_0.gguf
dl unsloth/Qwen3.5-0.8B-GGUF 6ab461498e2023f6e3c1baea90a8f0fe38ab64d0 mmproj-F16.gguf 56e4c6cfe73b0c82e3e82bc518d7591997e61d81f723fc41a586f4fa69ea2453 gguf/mmproj-0.8B-F16.gguf
dl unsloth/Qwen3.5-2B-GGUF f6d5376be1edb4d416d56da11e5397a961aca8ae Qwen3.5-2B-Q4_K_M.gguf aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223 gguf/Qwen3.5-2B-Q4_K_M.gguf
dl unsloth/Qwen3.5-2B-GGUF f6d5376be1edb4d416d56da11e5397a961aca8ae mmproj-F16.gguf 7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7 gguf/mmproj-2B-F16.gguf
step hf-bases
for f in LICENSE chat_template.jinja config.json merges.txt model.safetensors-00001-of-00001.safetensors model.safetensors.index.json preprocessor_config.json tokenizer.json tokenizer_config.json video_preprocessor_config.json vocab.json; do
  dl Qwen/Qwen3.5-0.8B 2fc06364715b967f1860aea9cf38778875588b17 $f - hf/Qwen3.5-0.8B/$f
  dl Qwen/Qwen3.5-2B 15852e8c16360a2fea060d615a32b45270f8a8fc $f - hf/Qwen3.5-2B/$f
done
# the weights themselves, pinned (0.8B as in training/README.md V4; 2B measured 2026-10-24)
echo "04b1c301231dd422b8860db31311ab2721511346a32cb1e079c4c4e5f1fe4696  $S/models/hf/Qwen3.5-0.8B/model.safetensors-00001-of-00001.safetensors
aa33250c4fc64891ddfaba3a314fd9542ea371843c387178b425fbcc5ed680b1  $S/models/hf/Qwen3.5-2B/model.safetensors-00001-of-00001.safetensors" | sha256sum -c - || exit 1
step quantize-mmproj
for m in 0.8B 2B; do [ -f $S/models/gguf/mmproj-$m-Q8_0.gguf ] || $S/llama-linux/bin/llama-quantize $S/models/gguf/mmproj-$m-F16.gguf $S/models/gguf/mmproj-$m-Q8_0.gguf Q8_0 >/dev/null 2>&1; sha256sum $S/models/gguf/mmproj-$m-Q8_0.gguf; done
step done

# ---- data (seeds; byte-identical) ----
P=$S/pyenv/bin/python; cd $REPO
[ -f $S/v5/test/meta.json ] || $P -I training/synth_vlm.py --split blind --out $S/v5/test --scale 0.1
[ -f $S/v5/dev/meta.json ] || $P -I training/synth_vlm.py --split dev --out $S/v5/dev --scale 0.05
[ -f $S/v5/train/meta.json ] || $P -I training/synth_vlm.py --split train --out $S/v5/train --scale 1.0
[ -d $S/try/seat12 ] || { mkdir -p $S/try/seat12; $P -I training/synth_relations.py --out $S/try/seat12 --count 12 --split blind --furniture; }
[ -d $S/rel2/blind ] || $P -I training/synth_relations.py --out $S/rel2/blind --count 40 --split blind
[ -d $S/synth3/blind ] || for L in 1 2 3 4 5 6 7; do $P -I training/synth_levels.py --out $S/synth3/blind --level $L --count 12 --split blind; done
[ -d $S/s1/blind ] || { $P -I training/synth_relations.py --out $S/s1/blind --count 20 --split blind --s1; $P -I training/synth_relations.py --out $S/s1/blind --count 20 --split blind --s1 --scan; }
[ -d $S/seat/train ] || $P -I training/synth_relations.py --out $S/seat/train --count 400 --split train --furniture
[ -d $S/rel/train ] || $P -I training/synth_relations.py --out $S/rel/train --count 120 --split train
[ -d $S/synth3/train ] || for L in 1 2 3 4 5 6 7; do $P -I training/synth_levels.py --out $S/synth3/train --level $L --count 84 --split train; done
[ -f $S/v4data/meta.json ] || $P -I training/vlm_lora.py data --seat $S/seat/train --syn $S/synth3/train --rel $S/rel/train --out $S/v4data --seed 21
M=$S/models/serve; mkdir -p $M; ln -sf ../gguf/Qwen3.5-0.8B-Q8_0.gguf $M/Qwen3.5-0.8B-Q8_0.gguf; ln -sf ../gguf/mmproj-0.8B-Q8_0.gguf $M/mmproj-Qwen3.5-0.8B-Q8_0-local.gguf; ln -sf ../gguf/Qwen3.5-2B-Q4_K_M.gguf $M/Qwen3.5-2B-Q4_K_M.gguf; ln -sf ../gguf/mmproj-2B-Q8_0.gguf $M/mmproj-Qwen3.5-2B-Q8_0-local.gguf

# ---- resume state from the checkpoint branch ----
if git -C $REPO ls-remote --exit-code origin claude/v5-train-state >/dev/null 2>&1; then
  [ -d $S/ckpt ] || git -C $REPO worktree add -q $S/ckpt claude/v5-train-state 2>/dev/null || { git -C $REPO fetch -q origin claude/v5-train-state && git -C $REPO worktree add -q $S/ckpt origin/claude/v5-train-state; }
  for r in runB run2B; do [ -d $S/ckpt/$r ] && { mkdir -p $S/v5/$r; cp -rn $S/ckpt/$r/. $S/v5/$r/; }; done
  mkdir -p $S/v5/out; cp -n $S/ckpt/out/* $S/v5/out/ 2>/dev/null
fi

# ---- the chain ----
L=$S/llama-linux/bin/llama-server; O=$S/v5/out; mkdir -p $O
[ -f $S/v6/realtest/meta.json ] || $P -I training/synth_real.py test --out $S/v6/realtest
A=$REPO/models/local-vlm/qwen3.5-0.8b-merit-a/adapter.gguf
cd $REPO
log(){ echo "== $(date -u +%FT%TZ) $*"; }
train(){ # name base extra...  (V5 data unless --data is given in extra)
  local n=$1 b=$2; shift 2
  local data="--data $S/v5/train,$S/v4data"; case " $* " in *" --data "*) data="";; esac
  [ -f $S/v5/$n/run.json ] || { log train $n; $P -I training/vlm_lora.py train --base $b $data --out $S/v5/$n --curriculum --threads 4 "$@" >> $S/v5/$n.trainout 2>&1 || exit 1; }
  [ -f $S/v5/$n/adapter.gguf ] || $P -I training/vlm_lora.py gguf --run $S/v5/$n --out $S/v5/$n/adapter.gguf || exit 1; }
bench(){ # out model lora extra...
  local out=$1 model=$2 lora=$3; shift 3
  [ -f $O/$out.json ] && return
  log bench $out
  $P -I benchmarks/offline-intelligence/local-vlm-bench2.py --server $L --models $M --model $model ${lora:+--lora $lora} --looks 2 --ctx 2048 --cache-ram 0 --threads 4 --resume --out $O/$out.json "$@" > $O/$out.log 2>&1 || log FAIL $out; }
V5="--v5 $S/v5/test"
V4R="--seat $S/try/seat12 --rel $S/rel2/blind --syn $S/synth3/blind --seed 5"
S1="--seat $S/try/seat12 --rel $S/rel2/blind --syn $S/synth3/blind --s1 $S/s1/blind --seed 17"
while pgrep -f "^$S/pyenv/bin/python -I training/vlm_lora.py train" >/dev/null; do sleep 60; done
REAL="--v5 $S/v6/realtest"
V6="--data $S/v6/scenes,$S/v5/train --replay-tasks ID,NEG,COUNT,CHAIRS,MERGED,SERVES --replay-max 1200"
[ -f $S/v6/scenes/meta.json ] || $P -I training/synth_real.py scenes --out $S/v6/scenes --scale 1.0 >> $S/v5/chain.log 2>&1
# 0.8B: V5
train runB $S/models/hf/Qwen3.5-0.8B --dtype fp32
bench v5-B qwen3.5-0.8b $S/v5/runB/adapter.gguf $V5
bench real-B qwen3.5-0.8b $S/v5/runB/adapter.gguf $REAL
bench real-A qwen3.5-0.8b $A $REAL
bench v5-base08 qwen3.5-0.8b "" $V5
bench v5-A qwen3.5-0.8b $A $V5
bench s1-B qwen3.5-0.8b $S/v5/runB/adapter.gguf $S1
bench v4r-B qwen3.5-0.8b $S/v5/runB/adapter.gguf $V4R
bench v4r-A qwen3.5-0.8b $A $V4R
bench dev-B qwen3.5-0.8b $S/v5/runB/adapter.gguf --v5 $S/v5/dev
# 0.8B: V6 (continues the V5 adapter)
train runB6 $S/models/hf/Qwen3.5-0.8B --dtype fp32 --init $S/v5/runB $V6
bench real-B6 qwen3.5-0.8b $S/v5/runB6/adapter.gguf $REAL
bench v5-B6 qwen3.5-0.8b $S/v5/runB6/adapter.gguf $V5
bench s1-B6 qwen3.5-0.8b $S/v5/runB6/adapter.gguf $S1
bench dev-B6 qwen3.5-0.8b $S/v5/runB6/adapter.gguf --v5 $S/v5/dev
bench real-base08 qwen3.5-0.8b "" $REAL
# 2B: fp32 if 16 items fit in 12 GB of training memory, else fp32 + gradient checkpointing
if [ ! -f $S/v5/run2B.args ]; then
  log probe 2B memory
  $P -I training/vlm_lora.py train --base $S/models/hf/Qwen3.5-2B --data $S/v5/dev --out $S/v5/probe2B --limit 16 --accum 8 --save-every 0 --dtype fp32 > $S/v5/probe2B.out 2>&1
  pk=$(python3 -c "import json;print(json.load(open('$S/v5/probe2B/run.json'))['peakTrainRssMb'])" 2>/dev/null || echo 99999)
  log probe peak $pk MB
  if [ "$pk" -le 12000 ]; then echo "--dtype fp32" > $S/v5/run2B.args; else echo "--dtype fp32 --grad-ckpt" > $S/v5/run2B.args; fi
fi
train run2B $S/models/hf/Qwen3.5-2B $(cat $S/v5/run2B.args 2>/dev/null || echo --dtype fp32)
bench v5-2B qwen3.5-2b $S/v5/run2B/adapter.gguf $V5
bench v5-base2 qwen3.5-2b "" $V5
bench s1-2B qwen3.5-2b $S/v5/run2B/adapter.gguf $S1
bench dev-2B qwen3.5-2b $S/v5/run2B/adapter.gguf --v5 $S/v5/dev
bench real-2B qwen3.5-2b $S/v5/run2B/adapter.gguf $REAL
train run2B6 $S/models/hf/Qwen3.5-2B $(cat $S/v5/run2B.args) --init $S/v5/run2B $V6
bench real-2B6 qwen3.5-2b $S/v5/run2B6/adapter.gguf $REAL
bench v5-2B6 qwen3.5-2b $S/v5/run2B6/adapter.gguf $V5
bench s1-2B6 qwen3.5-2b $S/v5/run2B6/adapter.gguf $S1
bench dev-2B6 qwen3.5-2b $S/v5/run2B6/adapter.gguf --v5 $S/v5/dev
log CHAIN-DONE
