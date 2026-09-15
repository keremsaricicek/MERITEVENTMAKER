// The same frozen ground truth, expressed in the raw document's own frame.
//
//   node benchmarks/annotate/ornek-raw-frame.mjs
//
// ORNEK.pdf stores its page portrait, with the plan lying on its side. The
// annotation was made on the upright rendering because that is how a human
// reads the drawing — but that means every measurement so far has been taken
// on a plan that was turned the right way up FOR the system.
//
// Whether that mattered is a question to measure, not to assume, and the
// cheapest honest way to measure it is to score the untouched system on the
// document exactly as it arrives. This does not create new ground truth and
// does not touch the frozen file: it applies the rotation the annotation
// itself records to every box, so the two runs are scored against the same
// human review, only in different coordinates.
//
//     raw(x,y) = ( rawWidth - upright.y , upright.x )       rawWidth = 1719
//
// A 90-degree turn also swaps each box's width and height.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const src = JSON.parse(fs.readFileSync(path.join(repo, "annotations/ornek-symbolic.json"), "utf8"));

const RAW_W = src.source.document.rasterWidth;
const RAW_H = src.source.document.rasterHeight;
if (src.source.width !== RAW_H || src.source.height !== RAW_W) {
  throw new Error("ornek-raw-frame: the upright and raw dimensions are not a 90-degree pair");
}

// centre point: a plain coordinate change
const point = (cx, cy) => ({ cx: RAW_W - cy, cy: cx });
// box: transform the corner, then swap the extents
const box = (x, y, w, h) => ({ x: RAW_W - (y + h), y: x, w: h, h: w });

const out = {
  ...src,
  planId: "ornek-symbolic-raw",
  source: {
    ...src.source,
    file: "plans/ornek-raw.jpg",
    sha256: src.source.document.rasterSha256,
    width: RAW_W,
    height: RAW_H,
    note: "The document exactly as it arrives: the page as stored, with the plan on its side. Nothing is corrected.",
  },
  annotationMethod:
    "DERIVED, not re-reviewed. Every box is annotations/ornek-symbolic.json's own human-reviewed geometry, "
    + "turned by the 90-degree rotation that file records between the upright rendering and the raw page. "
    + "It exists to answer one question — does the system's result depend on the page having been turned the "
    + "right way up first? — and it must never be edited independently of the frozen file it is derived from.\n\n"
    + "Regenerate with: node benchmarks/annotate/ornek-raw-frame.mjs",
  objects: src.objects.map((o) => ({ ...o, ...point(o.cx, o.cy), w: o.h, h: o.w })),
  regions: (src.regions || []).map((r) => ({ ...r, ...box(r.x, r.y, r.w, r.h) })),
};

const dest = path.join(repo, "rotation/annotations/ornek-symbolic-raw.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");
const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, "plans/ornek-raw.jpg"))).digest("hex");
if (sha !== out.source.sha256) throw new Error("ornek-raw-frame: plans/ornek-raw.jpg does not match the recorded hash");
console.log("wrote benchmarks/rotation/annotations/ornek-symbolic-raw.json");
console.log(`  ${out.objects.length} tables, ${out.regions.length} regions, rotated into ${RAW_W}x${RAW_H}`);
const xs = out.objects.map((o) => o.cx), ys = out.objects.map((o) => o.cy);
console.log(`  table centres span x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)}`);
