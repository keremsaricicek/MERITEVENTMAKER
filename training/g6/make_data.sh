#!/bin/bash
# generation-6 data, deterministic from seeds (training/synth_styles.py); resumable
S=/tmp/claude-0/-home-user-MERITEVENTMAKER/7b41f49a-1109-57da-b022-838b2499b2be/scratchpad; P=$S/pyenv/bin/python; D=$S/g6/data; cd /home/user/MERITEVENTMAKER
for spec in "train G 160" "train P 120" "val G 20" "val P 20" "exam G 40" "exam P 40"; do set -- $spec
  $P -I training/synth_styles.py plans --split $1 --style $2 --count $3 --out $D/$1 || exit 1; done
[ -f $D/vlm-train/items.jsonl ] || $P -I training/synth_styles.py vlm --plans $D/train --out $D/vlm-train --seed 81 --jitter --every 3 || exit 1
[ -f $D/vlm-exam/items.jsonl ] || $P -I training/synth_styles.py vlm --plans $D/exam --out $D/vlm-exam --seed 83 --split exam --numbers 4 || exit 1
for x in exam vlm-exam; do echo "$x sha $(cd $D/$x && find . -type f ! -name 'index-*' | sort | xargs sha256sum | sha256sum | cut -c1-16)"; done
echo DATA-DONE
