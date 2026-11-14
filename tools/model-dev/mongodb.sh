#!/usr/bin/env bash
# A local MongoDB for FiftyOne's Dataset / App / evaluate_detections — the one
# part of FiftyOne that needs a database. fiftyone-db downloads mongod from
# fastdl.mongodb.org, which this project's cloud sessions refuse (403); the
# same server is published on conda-forge, which they reach.
#
#   bash tools/model-dev/mongodb.sh          # install (once) and start on 127.0.0.1:27417
#   bash tools/model-dev/mongodb.sh stop
#   export FIFTYONE_DATABASE_URI=mongodb://127.0.0.1:27417
#
# Developer-time only, like everything under tools/model-dev: the product never
# loads it and no end user is asked to run it. Loopback only. micromamba is
# checked against its sha256 and every package in mongodb-explicit.txt against
# its md5 before it is installed. mongodb is SSPL-1.0 — used locally, not
# distributed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BASE="$ROOT/.mongo-model-dev"
PORT="${MONGO_PORT:-27417}"
MM_URL="https://conda.anaconda.org/conda-forge/linux-64/micromamba-2.9.0-0.tar.bz2"
MM_SHA256="8761c382127e6363bd9e0a2451aa3ef90d071a79133f736e2f759a3bf13040dd"

if [[ "${1:-}" == "stop" ]]; then
  "$BASE/env/bin/mongod" --dbpath "$BASE/data" --shutdown
  exit 0
fi
mkdir -p "$BASE/data"
if [[ ! -x "$BASE/env/bin/mongod" ]]; then
  if [[ ! -x "$BASE/micromamba/bin/micromamba" ]]; then
    mkdir -p "$BASE/micromamba"
    curl -sSfL -o "$BASE/micromamba/mm.tar.bz2" "$MM_URL"
    echo "$MM_SHA256  $BASE/micromamba/mm.tar.bz2" | sha256sum -c -
    tar -xjf "$BASE/micromamba/mm.tar.bz2" -C "$BASE/micromamba" bin/micromamba
  fi
  MAMBA_ROOT_PREFIX="$BASE/mamba-root" "$BASE/micromamba/bin/micromamba" create -y -q -p "$BASE/env" \
    --override-channels -c conda-forge --file "$HERE/mongodb-explicit.txt"
fi
"$BASE/env/bin/mongod" --dbpath "$BASE/data" --bind_ip 127.0.0.1 --port "$PORT" --fork --logpath "$BASE/mongod.log"
echo "export FIFTYONE_DATABASE_URI=mongodb://127.0.0.1:$PORT"
