"""Turn an app backup into a versioned training dataset — with every label's
verification state kept, never upgraded.

    python training/export_plans.py --backup merit-event-maker-yedek-....json --out data/vN [--version vN]

Developer-time only. The backup is the file the app's own "Backup" button
writes; nothing is read from the browser directly and nothing leaves the
machine.

For each event that has a plan image and an analysis, one plan is written in the
repository's annotation schema. Each object carries `verification`:

  human-confirmed   a person confirmed or corrected this object, or added it
  accepted-on-confirm  selected when the person pressed Confirm Plan without
                    reviewing it one by one — weaker, and kept apart
  teacher-suggested a model reading's suggestion nobody accepted — NEVER a
                    training target; listed for review only
  rejected          a person said "not an object" — a negative region

A label is never promoted: a teacher suggestion becomes a target only when a
person accepted it (it is then human-confirmed through the review's own
writer). Splits are by VENUE (event.venueRef.venueId, else the plan hash), so
one venue's plans never sit on both sides.
"""
import argparse
import base64
import hashlib
import io
import json
import os

from PIL import Image


def decode_data_url(src):
    if not src or not src.startswith("data:"):
        return None
    head, b64 = src.split(",", 1)
    return base64.b64decode(b64)


def suggested_by(c):
    """Which machine first proposed an object, kept beside the verification."""
    ev = c.get("evidence") or {}
    if ev.get("geometry") == "vlm-suggestion" or c.get("source") == "vlm-suggestion":
        return "vlm"
    return c.get("source") or "classical"


def verification(c):
    if c.get("source") in ("vlm", "teacher") and c.get("status") != "confirmed":
        return "teacher-suggested"
    if c.get("status") == "rejected":
        return "rejected"
    if c.get("status") == "confirmed" or c.get("missed") or c.get("fromMemory"):
        return "human-confirmed"
    if c.get("selected"):
        return "accepted-on-confirm"
    return "unreviewed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backup", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--version", default="v1")
    a = ap.parse_args()
    data = json.load(open(a.backup))
    # The app's own backup file: {format: "merit-event-maker-backup", payload: state}
    # (buildBackupPayload in src/app-v8.js). Anything else is refused, not guessed at.
    if not isinstance(data, dict) or data.get("format") != "merit-event-maker-backup" or not isinstance(data.get("payload"), dict):
        raise SystemExit("not a MERIT EVENT MAKER backup file (format merit-event-maker-backup with a payload)")
    state = data["payload"]
    os.makedirs(a.out, exist_ok=True)
    plans, counts = [], {}
    for ev in state.get("events", []):
        an, bg = ev.get("analysis"), ev.get("background") or {}
        raw = decode_data_url(bg.get("src"))
        if not an or not raw:
            continue
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        W, H = img.size
        plan_hash = hashlib.sha256(raw).hexdigest()
        venue = (ev.get("venueRef") or {}).get("venueId") or ("plan:" + plan_hash[:16])
        pid = "exp-" + plan_hash[:12]
        img.save(os.path.join(a.out, pid + ".png"))
        objs, rels = [], []
        for c in an.get("candidates", []):
            v = verification(c)
            counts[v] = counts.get(v, 0) + 1
            if c.get("kind") not in ("table", "venue"):
                continue
            o = {"id": c["id"], "class": "table" if c["kind"] == "table" else c.get("type"), "type": c.get("type"),
                 "cx": round((c["x"] + c["w"] / 2) / 100 * W, 1), "cy": round((c["y"] + c["h"] / 2) / 100 * H, 1),
                 "w": round(c["w"] / 100 * W, 1), "h": round(c["h"] / 100 * H, 1), "rotation": c.get("rotation", 0), "verification": v,
                 "suggestedBy": suggested_by(c)}
            objs.append(o)
            for ch in c.get("chairDetections") or []:
                cid = ch.get("id") or (c["id"] + "-s" + str(len(objs)))
                # A model reading's chair enters a table only through a
                # person's Accept (decideReview addChair): that chair is the
                # person's decision, whatever the table's own state.
                cv = "human-confirmed" if ch.get("source") == "vlm-suggestion" and v != "rejected" else v
                counts["chair:" + cv] = counts.get("chair:" + cv, 0) + 1
                objs.append({"id": cid, "class": "chair", "cx": round(ch["x"] / 100 * W, 1), "cy": round(ch["y"] / 100 * H, 1),
                             "w": round(ch["w"] / 100 * W, 1), "h": round(ch["h"] / 100 * H, 1), "rotation": ch.get("rotation", 0),
                             "verification": cv, "suggestedBy": suggested_by(ch)})
                rels.append({"chair": cid, "belongsTo": c["id"], "method": "detector-association"})
        # A model reading's findings nobody accepted: listed so a person can
        # review them, never written as objects and never a training target.
        unaccepted = [{"id": f.get("id"), "kind": f.get("kind"), "type": f.get("type"), "state": f.get("state"),
                       "verification": "teacher-suggested"}
                      for f in ((an.get("vlm") or {}).get("findings") or []) if f.get("state") != "accepted"]
        counts["teacher-suggested"] = counts.get("teacher-suggested", 0) + len(unaccepted)
        ann = {"planId": pid, "source": {"file": pid + ".png", "width": W, "height": H, "sha256": plan_hash, "venue": venue},
               "annotationMethod": "exported from the app's analysis and the person's review decisions (training/export_plans.py)",
               "verification": "per object", "split": {"unit": "venue", "venue": venue},
               "objects": objs, "relationships": rels, "teacherSuggestions": unaccepted}
        json.dump(ann, open(os.path.join(a.out, pid + ".json"), "w"))
        plans.append({"planId": pid, "venue": venue, "objects": len(objs)})
    manifest = {"dataset": "merit-plans", "version": a.version, "from": os.path.basename(a.backup), "plans": plans,
                "labelCounts": counts, "trainingTargets": ["human-confirmed", "accepted-on-confirm (weighted lower, reported separately)"],
                "neverTargets": ["teacher-suggested", "unreviewed"], "splitUnit": "venue"}
    json.dump(manifest, open(os.path.join(a.out, "manifest.json"), "w"), indent=1)
    print(f"exported {len(plans)} plans, labels by verification: {counts}")


if __name__ == "__main__":
    main()
