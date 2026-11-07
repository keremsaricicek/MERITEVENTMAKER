#!/usr/bin/env bash
# Developer-time model tools (ONNX Runtime, Microsoft Olive, FiftyOne) in their
# own virtual environment: .venv-model-dev/ at the repository root.
#
# This is NOT part of the product. index.html, src/ and both offline packages
# load none of it, and nothing here is ever asked of an end user. It exists so a
# developer can optimise, inspect and evaluate the plan-symbol detector on CPU.
#
#   bash tools/model-dev/setup.sh               # base: ORT, FiftyOne, pycocotools, Olive (files only)
#   bash tools/model-dev/setup.sh --with-olive  # plus CPU torch, which `import olive` needs
#   bash tools/model-dev/setup.sh --with-olive-pypi
#        # the same, where download.pytorch.org is refused: torch from PyPI,
#        # every file pinned by sha256 in requirements-olive-pypi.lock.txt
#        # (the CUDA build, ~4.5 GB with its nvidia libraries; it runs on CPU)
#   .venv-model-dev/bin/python -I tools/model-dev/check.py
#
# Free and local only: no Hugging Face Jobs, no Hub upload, no paid service.
# What was installed, measured and refused here: tools/model-dev/README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VENV="$ROOT/.venv-model-dev"
OLIVE_VERSION="0.13.0"
TORCH_VERSION="2.14.1"
TORCH_INDEX_URL="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}"

command -v uv >/dev/null || { echo "uv is required (https://docs.astral.sh/uv/)"; exit 1; }
uv venv "$VENV" -p 3.11 --allow-existing -q
VIRTUAL_ENV="$VENV" uv pip install -q -r "$HERE/requirements.lock.txt"
# Olive's files without its declared dependencies. Olive 0.13.0 imports torch
# at module level (olive/model/config/hf_config.py and ~40 others), so without
# torch `import olive` FAILS — measured, not assumed. The base environment still
# carries Olive so that --with-olive only has to add torch; everything Olive is
# used for here (dynamic INT8 quantization) has a torch-free equivalent in
# onnxruntime.quantization, which examples/quantize_detector.py --engine ort runs.
VIRTUAL_ENV="$VENV" uv pip install -q --no-deps "olive-ai==$OLIVE_VERSION"

if [[ "${1:-}" == "--with-olive-pypi" ]]; then
  # Reproducible from an index this session CAN reach (pypi.org), hash-checked:
  # a file whose sha256 is not the locked one is refused, not installed.
  # Resolved against requirements.lock.txt as a constraint, so nothing the base
  # environment pinned moves. Regenerate with the command at the top of the lock.
  VIRTUAL_ENV="$VENV" uv pip install -q --require-hashes --index-url https://pypi.org/simple \
    -r "$HERE/requirements-olive-pypi.lock.txt"
elif [[ "${1:-}" == "--with-olive" ]]; then
  # CPU-only torch from the PyTorch index. PyPI's Linux torch is the CUDA build
  # (~4.5 GB with its nvidia libraries, and it does not import without them).
  # If this index is unreachable, the reason is printed and nothing is changed.
  if ! VIRTUAL_ENV="$VENV" uv pip install -q --index-url "$TORCH_INDEX_URL" "torch==$TORCH_VERSION"; then
    echo "torch could not be installed from $TORCH_INDEX_URL." >&2
    echo "Olive stays NOT IMPORTABLE; use quantize_detector.py --engine ort, or see README.md (Olive)." >&2
    exit 2
  fi
  VIRTUAL_ENV="$VENV" uv pip install -q "torchmetrics==1.9.0" "lightning-utilities==0.15.3"
fi

echo "ready: $VENV"
"$VENV/bin/python" -I "$HERE/check.py" $([[ "${1:-}" == --with-olive* ]] && echo --require-olive)
