"""Import FIRST, before onnxruntime, olive or fiftyone: nothing these tools do
here may leave the machine.

Each switch below was MEASURED in this environment (2026-10-12) by counting the
outbound connections the session proxy refused while a process ran:

- onnxruntime 1.31.0 (Python, Linux) carries a 1DS telemetry client in its
  native library (core/platform/posix/telemetry_1ds.cc) and contacts
  mobile.events.data.microsoft.com when InferenceSessions run: 3 attempts for
  two sessions. ORT_DISABLE_TELEMETRY=1 -> 0. onnxruntime.disable_telemetry_events()
  -> still 3, so the API call is NOT the switch on this build. The variable works
  set from Python before `import onnxruntime`.
  (The product's onnxruntime-web 1.30.0 bundle carries no such host.)
- Olive 0.13.0 sends a heartbeat from olive.telemetry.Telemetry. Its documented
  OLIVE_DISABLE_TELEMETRY=1 is read only after the heartbeat is queued
  (Telemetry.__init__): 8 attempts with it, the same as without. Its CI check
  runs first and skips the heartbeat: CI=1 -> 0. Both are set, so a later Olive
  that fixes the order still has its own switch.
- FiftyOne: FIFTYONE_DO_NOT_TRACK=true -> 0 attempts.

Everything else the tools try to fetch (fiftyone-db's mongod download, the
PyTorch CPU index) is refused here by the network, and the scripts report that
as a result instead of retrying.
"""
import os

SWITCHES = {
    "ORT_DISABLE_TELEMETRY": "1",
    "OLIVE_DISABLE_TELEMETRY": "1",
    "CI": "1",
    "FIFTYONE_DO_NOT_TRACK": "true",
}
os.environ.update(SWITCHES)
