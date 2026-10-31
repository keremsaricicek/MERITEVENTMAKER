#!/bin/bash
# Developer-only (Linux): assembles the portable Windows folder of MERIT Event
# Maker with the local second look — nothing for the end user to install:
#
#   app/       the offline folder build (dist/merit-offline) + server/ (the relay)
#   runtime/   llama.cpp llama-server for win-64 (conda-forge llama.cpp, cpu_mkl,
#              with its DLLs) and node.exe (nodejs.org win-x64 zip), with licences
#   models/    local-vlm: the pinned plan model, its adapter, its manifest and the
#              first-run GPU check (a dozen crops with the processor's answers);
#              local-chat: the assistant's pinned language model and its manifest
#   sample/    a generated sample plan (this repository's own, no third-party rights)
#   MERIT-Baslat.cmd, BENIOKU.txt
#
#   tools/local-vlm/windows/build-package.sh OUT LLAMA_WIN_ENV NODE_WIN_ZIP MODEL_DIR MANIFEST SAMPLE_DIR \
#       LLAMA_LINUX_SERVER CHECK_SRC [CHAT_DIR CHAT_MANIFEST]
#
# CHECK_SRC holds items.json ({image, question, piece}) and its crops; their
# answers are recorded here on the processor (server/gpu-check.mjs --record) —
# the answers a graphics card must give before the package uses it.
#
# MODEL_DIR holds the files MANIFEST pins; every one is checked by size and
# sha256 before it is copied. Run `node scripts/build-offline-full.mjs` first.
set -euo pipefail
OUT=$1 LW=$2 NZ=$3 MD=$4 MAN=$5 SAMPLE=$6 LL=$7 CHECK=$8 CD=${9:-} CMAN=${10:-}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$MAN")
P="$OUT/MERIT-EventMaker"
[ -e "$P" ] && { echo "$P exists"; exit 1; }
mkdir -p "$P/app" "$P/runtime/llama/Library/bin" "$P/runtime/node" "$P/runtime/licenses" "$P/models/local-vlm/$ID" "$P/sample" "$P/data"
cp -r "$ROOT/dist/merit-offline/." "$P/app/"
mkdir -p "$P/app/server" && cp "$ROOT"/server/*.mjs "$ROOT"/server/*.json "$P/app/server/"
# the relay's F8 reader takes its instruction from the page's own source (one source, as measured)
mkdir -p "$P/app/src" && cp "$ROOT/src/assistant-reading.js" "$P/app/src/"
cp "$LW/Library/bin/"*.dll "$LW/Library/bin/llama-server.exe" "$P/runtime/llama/Library/bin/"
cp "$LW/"*.dll "$P/runtime/llama/" 2>/dev/null || true
for d in "$LW"/conda-meta/*.json; do
  pkg=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['name'])" "$d")
  src=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('extracted_package_dir',''))" "$d")
  [ -d "$src/info/licenses" ] && { mkdir -p "$P/runtime/licenses/$pkg"; cp -r "$src/info/licenses/." "$P/runtime/licenses/$pkg/"; }
done
T=$(mktemp -d); unzip -q "$NZ" -d "$T"; cp "$T"/node-*/node.exe "$P/runtime/node/"; cp "$T"/node-*/LICENSE "$P/runtime/licenses/node-LICENSE"; rm -r "$T"
python3 - "$MAN" "$MD" "$P/models/local-vlm/$ID" <<'EOF'
import hashlib, json, os, shutil, sys
man, src, dst = sys.argv[1:4]
m = json.load(open(man))
for f in m["files"]:
    p = os.path.join(src, f["path"])
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    assert os.path.getsize(p) == f["bytes"] and h.hexdigest() == f["sha256"], f"{f['path']} does not match the manifest"
    shutil.copyfile(p, os.path.join(dst, f["path"]))
json.dump(m, open(os.path.join(dst, "manifest.json"), "w"), indent=1)
open(os.path.join(dst, "MODEL.txt"), "w").write(f"{m['name']}\n{m['licence']}\n{m['source']}\n")
EOF
cp -r "$SAMPLE/." "$P/sample/"
# the first-run GPU check: the crops, and the processor's answers recorded with these very files
V="$P/models/local-vlm/$ID"
mkdir -p "$V/gpu-check" && cp -r "$CHECK/." "$V/gpu-check/"
MF0=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['serve']['model'])" "$MAN")
MP0=$(python3 -c "import json,sys;f=[x['path'] for x in json.load(open(sys.argv[1]))['files'] if 'mmproj' in x['path']];print(f[0])" "$MAN")
node "$ROOT/server/gpu-check.mjs" "$LL" "$V/$MF0" "$V/$MP0" "$V/adapter.gguf" "$V/gpu-check" --record
# the assistant's language model (optional): pinned files checked, manifest beside them
CID="" CF=""
if [ -n "$CD" ]; then
  CID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$CMAN")
  CF=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['serve']['model'])" "$CMAN")
  mkdir -p "$P/models/local-chat/$CID"
  python3 - "$CMAN" "$CD" "$P/models/local-chat/$CID" <<'EOF2'
import hashlib, json, os, shutil, sys
man, src, dst = sys.argv[1:4]
m = json.load(open(man))
for f in m["files"]:
    p = os.path.join(src, f["path"])
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    assert os.path.getsize(p) == f["bytes"] and h.hexdigest() == f["sha256"], f"{f['path']} does not match the manifest"
    shutil.copyfile(p, os.path.join(dst, f["path"]))
json.dump(m, open(os.path.join(dst, "manifest.json"), "w"), indent=1)
EOF2
fi
MF=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['serve']['model'])" "$MAN")
MP=$(python3 -c "import json,sys;f=[x['path'] for x in json.load(open(sys.argv[1]))['files'] if 'mmproj' in x['path']];print(f[0])" "$MAN")
sed -e "s/@MODEL_ID@/$ID/" -e "s/@MODEL_FILE@/$MF/" -e "s/@MMPROJ_FILE@/$MP/" -e "s/@CHAT_ID@/${CID:-none}/" -e "s/@CHAT_FILE@/${CF:-none}/" "$ROOT/tools/local-vlm/windows/MERIT-Baslat.cmd" | sed 's/$/\r/' > "$P/MERIT-Baslat.cmd"
sed 's/$/\r/' "$ROOT/tools/local-vlm/windows/BENIOKU.txt" > "$P/BENIOKU.txt"
du -sh "$P"
