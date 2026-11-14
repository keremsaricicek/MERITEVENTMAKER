"""Is the developer model-tools environment usable? (tools/model-dev/setup.sh)

    .venv-model-dev/bin/python -I tools/model-dev/check.py --versions

Imports each tool and prints its version as JSON. Exits non-zero when one is
missing, so a broken environment is never mistaken for a working one.

olive is the exception the output names rather than hides: Olive 0.13.0
imports torch at module level, and torch is not in the base environment (see
requirements.in). Without torch, olive is reported as NOT IMPORTABLE and the
check still passes, because the torch-free path (onnxruntime's own quantizer)
covers the same job; --require-olive makes it a failure instead.

Nothing here reaches the network: onnxruntime's, Olive's and FiftyOne's
telemetry are switched off before any of them is imported
(examples/offline_env.py says which switch each one actually honours, measured).
"""
import importlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples"))
import offline_env  # noqa: E402

TOOLS = ["onnx", "onnxruntime", "olive", "fiftyone", "pycocotools", "numpy", "PIL"]


def version_of(name):
    mod = importlib.import_module(name)
    for attr in ("__version__", "VERSION", "version"):
        v = getattr(mod, attr, None)
        if isinstance(v, str):
            return v
    try:
        from importlib.metadata import version
        return version({"olive": "olive-ai", "PIL": "pillow"}.get(name, name))
    except Exception:  # noqa: BLE001 - reported, not hidden
        return "imported (version unknown)"


def main():
    require_olive = "--require-olive" in sys.argv
    out, failed = {"python": sys.version.split()[0]}, []
    for name in TOOLS:
        try:
            out[name] = version_of(name)
        except Exception as e:  # noqa: BLE001 - the failure is the result
            out[name] = f"NOT IMPORTABLE: {type(e).__name__}: {e}"
            if name != "olive" or require_olive:
                failed.append(name)
    try:
        import torch
        out["torch"] = f"{torch.__version__} (supplied from {os.path.dirname(os.path.dirname(torch.__file__))})"
    except ImportError:
        out["torch"] = "absent (base environment carries none; see setup.sh --with-olive)"
    import onnxruntime as ort
    out["onnxruntimeProviders"] = ort.get_available_providers()
    out["telemetrySwitches"] = {k: os.environ.get(k) for k in offline_env.SWITCHES}
    out["failed"] = failed
    print(json.dumps(out, indent=1))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
