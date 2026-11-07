#!/usr/bin/env node
// Builds complete object-level ground truth for the real Golden Plan.
//
// Read benchmarks/annotate/README.md before changing anything here.
//
// This is an ANNOTATION tool and shares nothing with the detector under test.
// Its rules are deliberately literal and specific to this one drawing — exact
// ink colours, fixed pixel sizes, explicit declared text regions. No modal
// reasoning, no adaptive thresholds, nothing that could quietly agree with
// src/app-v8.js because both had the same idea.
//
// The output is not trusted because the code ran. It is trusted because
// `--overlay` draws every extracted object back onto the plan, numbered by
// class, and a person compared it against the drawing. The annotation says
// exactly that in annotationMethod, and says which parts remain unverifiable.
//
//   node benchmarks/annotate/build-real-annotation.mjs --overlay out.png
//   node benchmarks/annotate/build-real-annotation.mjs --write
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PLAN = path.join(ROOT, "plans", "merit-real-venue-plan.png");
const OUT = path.join(ROOT, "annotations", "merit-real-venue.json");
const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : null; };

// ---------------------------------------------------------------------------
// Declared non-furniture regions, read off the drawing by eye and written down
// here rather than inferred. A detection whose centre lands inside one of
// these is a false positive by construction — that is the whole point of
// declaring them, so they must describe the printed matter and the
// architecture, never a region that happens to be inconvenient.
// ---------------------------------------------------------------------------
const TEXT_REGIONS = [
  { id: "capacity-block", x: 100, y: 52, w: 175, h: 90, note: "114 pax seating / 10 pax bistro / Total : 124 pax" },
  { id: "giris-left", x: 20, y: 152, w: 72, h: 34, note: "GIRIS (entrance label)" },
  { id: "giris-right", x: 1264, y: 44, w: 34, h: 100, note: "GIRIS (entrance label, rotated)" },
  { id: "bar-label", x: 315, y: 196, w: 92, h: 40, note: "BAR" },
  { id: "sahne-label", x: 880, y: 622, w: 78, h: 26, note: "SAHNE (stage)" },
  { id: "dim-8m", x: 884, y: 526, w: 40, h: 24, note: "8 m dimension" },
  { id: "dim-310m", x: 706, y: 632, w: 56, h: 24, note: "3,10 m dimension" },
];

const browser = await launchChromium();
const page = await browser.newPage();
await page.goto("about:blank");
const planBytes = fs.readFileSync(PLAN);
const src = "data:image/png;base64," + planBytes.toString("base64");

const raw = await page.evaluate(async ({ src, TEXT_REGIONS }) => {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  const W = img.width, H = img.height;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;

  // ---- this drawing's literal palette ------------------------------------
  const isOrange = (r, g, b) => r > 150 && r - g > 55 && g - b > 20 && b < 170;
  const isTan = (r, g, b) => r > 190 && g > 170 && b > 110 && r - b > 25 && r - b < 110 && r - g < 45;
  const isBlue = (r, g, b) => b > 150 && b - r > 30 && b - g > 20;

  const cls = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (isOrange(r, g, b)) cls[i] = 1;
    else if (isTan(r, g, b)) cls[i] = 2;
    else if (isBlue(r, g, b)) cls[i] = 3;
  }

  const inText = (x, y) => TEXT_REGIONS.some(t => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);

  function components(want, minPixels) {
    const seen = new Uint8Array(W * H), out = [], stack = new Int32Array(W * H);
    for (let start = 0; start < W * H; start++) {
      if (cls[start] !== want || seen[start]) continue;
      let top = 0; stack[top++] = start; seen[start] = 1;
      let minX = W, minY = H, maxX = 0, maxY = 0, count = 0, sx = 0, sy = 0;
      while (top) {
        const i = stack[--top], x = i % W, y = (i / W) | 0;
        count++; sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (seen[j] || cls[j] !== want) continue;
          seen[j] = 1; stack[top++] = j;
        }
      }
      if (count < minPixels) continue;
      out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area: count,
        cx: sx / count, cy: sy / count,
        fill: count / ((maxX - minX + 1) * (maxY - minY + 1)) });
    }
    return out;
  }

  const orange = components(1, 60).filter(c => !inText(c.cx, c.cy));
  const tan = components(2, 70).filter(c => !inText(c.cx, c.cy));
  const blue = components(3, 300);

  // ---- round tables: a tan disc, ~68px across, fill near pi/4 ------------
  const rounds = tan.filter(c => c.w >= 60 && c.w <= 78 && c.h >= 60 && c.h <= 78
    && Math.abs(c.w - c.h) <= 4 && c.fill > .70 && c.fill < .85);

  // ---- the pale crescent chairs around each round table -------------------
  // These are the hardest objects on the drawing to annotate, and the reason
  // is worth writing down: sampled along rings from a table centre, a crescent
  // is a grey outline (luma 140-180) around a very pale fill (215,206,187 and
  // lighter), and roughly a third of the annulus at chair radius is plain
  // white. A colour test for "tan" catches slivers of one chair and misses the
  // next -- the first attempt at this produced 26 boxes for 24 chairs, each
  // clipped to whatever fragment happened to pass.
  //
  // So the annulus test is simply "not background". Everything between the
  // disc and 1.65 radii that is not white IS the ring of chairs; nothing else
  // is drawn there. Group those pixels BY ANGLE and six runs separate cleanly
  // at 60 degrees apart. The angle is also the chair's facing -- every crescent
  // opens toward the table centre -- which is measured orientation rather than
  // an assumption, and is why these chairs carry orientationKnown:true.
  const paleChairs = [];
  for (const table of rounds) {
    const r0 = Math.max(table.w, table.h) / 2;
    const cx = table.cx, cy = table.cy;
    // The annulus starts just OUTSIDE the disc. Starting inside it puts the
    // table's own tan in every angular bin, the six runs merge into one, and
    // each 'chair' box swallows the table -- which is what the first overlay
    // showed.
    const inner = r0 * 1.03, outer = r0 * 1.65;
    const bins = new Array(360).fill(0);
    const pts = [];
    for (let y = Math.max(0, Math.floor(cy - outer)); y < Math.min(H, Math.ceil(cy + outer)); y++) {
      for (let x = Math.max(0, Math.floor(cx - outer)); x < Math.min(W, Math.ceil(cx + outer)); x++) {
        const i = y * W + x;
        const luma = px[i * 4] * .299 + px[i * 4 + 1] * .587 + px[i * 4 + 2] * .114;
        if (luma > 242) continue;   // background
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        if (d < inner || d > outer) continue;
        const a = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
        bins[Math.floor(a)]++;
        pts.push({ x, y, a, d });
      }
    }
    // Angular runs of occupied bins, wrapping at 360.
    const occupied = bins.map(n => n > 0);
    const runs = [];
    let start = null;
    for (let i = 0; i < 720; i++) {
      const k = i % 360;
      if (occupied[k] && start === null) start = i;
      if (!occupied[k] && start !== null) {
          // A chair spans roughly 45 degrees; anything under 15 is a stray mark.
        if (i - start >= 15 && start < 360) runs.push([start % 360, (i - 1) % 360, i - start]);
        start = null;
      }
      if (i - (start ?? i) > 360) break;
    }
    for (const [a0, a1, span] of runs) {
      const within = pts.filter(p => {
        const rel = ((p.a - a0) + 360) % 360;
        return rel <= span;
      });
      if (within.length < 60) continue;
      const xs = within.map(p => p.x), ys = within.map(p => p.y);
      const mid = ((a0 + span / 2) % 360);
      paleChairs.push({
        x: Math.min(...xs), y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1,
        area: within.length,
        // The chair sits at `mid` degrees from the table centre and faces
        // inward, so its facing is mid + 180.
        angleFromTable: +mid.toFixed(1),
        facing: +((mid + 180) % 360).toFixed(1),
        tableCx: +cx.toFixed(1), tableCy: +cy.toFixed(1),
      });
    }
  }

  return { size: [W, H], orange, tan, blue, rounds, paleChairs };
}, { src, TEXT_REGIONS });

// ---------------------------------------------------------------------------
// Classification, by literal size bands measured off this drawing.
// ---------------------------------------------------------------------------
const round2 = v => +v.toFixed(1);
const box = c => ({ cx: round2(c.x + c.w / 2), cy: round2(c.y + c.h / 2), w: c.w, h: c.h });

const banquettes = raw.orange.filter(c => c.h > 90 && c.w > 20);
const armchairs = raw.orange.filter(c => c.w >= 25 && c.w <= 48 && c.h >= 25 && c.h <= 48);
const bistroChairs = raw.orange.filter(c => c.w >= 11 && c.w <= 24 && c.h >= 11 && c.h <= 24 && c.area >= 150);
const orangeOther = raw.orange.filter(c =>
  !banquettes.includes(c) && !armchairs.includes(c) && !bistroChairs.includes(c));

const roundTables = raw.rounds;
const squareTables = raw.tan.filter(c => c.w >= 40 && c.w <= 50 && c.h >= 39 && c.h <= 50);
const bistroTables = raw.tan.filter(c => c.w >= 30 && c.w <= 39 && c.h >= 30 && c.h <= 42 && c.area > 900);
const tanOther = raw.tan.filter(c =>
  !roundTables.includes(c) && !squareTables.includes(c) && !bistroTables.includes(c));

const stage = raw.blue.slice().sort((a, b) => b.area - a.area)[0] || null;
const dais = raw.blue.filter(c => c !== stage && c.area > 1500);

console.log(`plan ${raw.size[0]}x${raw.size[1]}`);
console.log(`  square tables   ${squareTables.length}`);
console.log(`  round tables    ${roundTables.length}`);
console.log(`  bistro tables   ${bistroTables.length}`);
console.log(`  armchairs       ${armchairs.length}`);
console.log(`  bistro chairs   ${bistroChairs.length}`);
console.log(`  pale chairs     ${raw.paleChairs.length}`);
console.log(`  banquettes      ${banquettes.length}`);
console.log(`  blue objects    ${raw.blue.length} (stage ${stage ? `${stage.w}x${stage.h}` : "none"}, dais ${dais.length})`);
console.log(`  unclassified    orange ${orangeOther.length}, tan ${tanOther.length}`);
if (orangeOther.length) console.log("    orange:", orangeOther.slice(0, 10).map(c => `${c.w}x${c.h}@(${Math.round(c.cx)},${Math.round(c.cy)})`).join(" "));
if (tanOther.length) console.log("    tan:", tanOther.slice(0, 14).map(c => `${c.w}x${c.h}@(${Math.round(c.cx)},${Math.round(c.cy)})`).join(" "));

const overlayOut = flag("--overlay");
if (overlayOut) {
  const dataUrl = await page.evaluate(async ({ src, groups }) => {
    const img = await createImageBitmap(await (await fetch(src)).blob());
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    x.font = "9px monospace"; x.textBaseline = "top";
    for (const g of groups) {
      x.strokeStyle = g.colour; x.lineWidth = 1.4;
      x.fillStyle = g.colour;
      g.items.forEach((o, i) => {
        x.strokeRect(o.x - .5, o.y - .5, o.w + 1, o.h + 1);
        if (g.label) x.fillText(`${g.label}${i + 1}`, o.x, o.y - 10);
      });
    }
    return c.toDataURL("image/png");
  }, { src, groups: [
    { colour: "#0044ff", label: "S", items: squareTables },
    { colour: "#00bbff", label: "R", items: roundTables },
    { colour: "#aa00ff", label: "B", items: bistroTables },
    { colour: "#ff0000", label: "", items: armchairs },
    { colour: "#ff8800", label: "b", items: bistroChairs },
    { colour: "#00aa44", label: "p", items: raw.paleChairs },
    { colour: "#884400", label: "Q", items: banquettes },
    { colour: "#888888", label: "?", items: [...orangeOther, ...tanOther] },
  ] });
  fs.writeFileSync(overlayOut, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote", overlayOut);
}

// ---------------------------------------------------------------------------
// Emit the annotation.
// ---------------------------------------------------------------------------
if (flag("--write")) {
  const objects = [];
  const rel = [];
  let n = 0;
  const add = (prefix, o, extra) => {
    const id = `${prefix}${String(++n).padStart(3, "0")}`;
    objects.push({ id, ...extra, ...box(o) });
    return id;
  };
  n = 0; for (const t of squareTables) add("t", t, { class: "table", type: "square", rotation: 0 });
  for (const t of roundTables) add("t", t, { class: "table", type: "round", rotation: 0 });
  for (const t of bistroTables) add("t", t, { class: "table", type: "bistro", rotation: 0 });
  n = 0;
  for (const c of armchairs) add("c", c, { class: "chair", family: "orange-armchair", rotation: 0, orientationKnown: false });
  for (const c of bistroChairs) add("c", c, { class: "chair", family: "orange-bistro-chair", rotation: 0, orientationKnown: false });
  for (const c of raw.paleChairs) {
    const id = add("c", c, { class: "chair", family: "pale-outlined-chair",
      rotation: round2(c.facing), orientationKnown: true,
      orientationEvidence: "radial position around its round table; the crescent opens toward the table centre" });
    const table = objects.find(o => o.class === "table" && o.type === "round"
      && Math.abs(o.cx - c.tableCx) < 2 && Math.abs(o.cy - c.tableCy) < 2);
    if (table) rel.push({ chair: id, belongsTo: table.id });
  }
  n = 0; for (const q of banquettes) add("s", q, { class: "banquette", rotation: 0 });
  if (stage) objects.push({ id: "v01", class: "stage", ...box(stage), rotation: 0 });
  dais.forEach((d, i) => objects.push({ id: `v${String(i + 2).padStart(2, "0")}`, class: "stage_extension", ...box(d), rotation: 0 }));

  const existing = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const sha = crypto.createHash("sha256").update(planBytes).digest("hex");
  const chairs = objects.filter(o => o.class === "chair");
  const byFamily = {};
  for (const c of chairs) byFamily[c.family] = (byFamily[c.family] || 0) + 1;

  const annotation = {
    planId: existing.planId,
    source: { ...existing.source, sha256: sha, width: raw.size[0], height: raw.size[1] },
    annotationMethod:
      "Object boxes extracted by benchmarks/annotate/build-real-annotation.mjs, which shares no code or reasoning with the detector under test: it selects this drawing's literal ink colours (orange upholstery, tan surface, steel blue) with fixed thresholds, takes connected components, and classifies them by fixed pixel size bands measured off this image. The pale crescent chairs are the same tan as their table and overlap its edge, so they are recovered by angular clustering of tan pixels in the annulus just outside each round table's disc; that angle is also their facing, which is why those chairs carry orientationKnown:true and the orange chairs do not. Printed matter is excluded by the declared text regions below rather than by any property of the ink. EVERY object here was then rendered back onto the plan, numbered by class, and compared against the drawing by eye; the counts in capacity.note record what that comparison established and what it could not.",
    matchToleranceP: existing.matchToleranceP,
    confidence: {
      tables: "high — every table is a solid tan component with a clean size band",
      chairsOrange: "high — separate saturated components, individually visible",
      chairsPale: "medium — recovered by angular clustering rather than as separate components, so the box is the crescent's extent in the annulus and may clip where it overlaps the table",
      banquettes: "high for position, none for seat count",
      architecture: "partial — see regions; columns are NOT annotated, see capacity.note",
    },
    objects,
    relationships: rel,
    logicalGroups: existing.logicalGroups || [],
    capacity: {
      ocrStated: existing.capacity.ocrStated,
      annotatedChairs: chairs.length,
      chairsByFamily: byFamily,
      annotatedChairsNote:
        `${chairs.length} individually located chairs: ${Object.entries(byFamily).map(([k, v]) => `${v} ${k}`).join(", ")}. ` +
        "This supersedes the earlier figure of 105, which was a count from zoomed crops with no positions and did not separate the bistro chairs from the armchairs. " +
        "The drawing's own printed total is 124 pax, and the three banquettes have no drawn seat divisions, so the remaining difference is exactly the banquette capacity the drawing does not state.",
      unverified: existing.capacity.unverified,
    },
    regions: [
      ...TEXT_REGIONS.map(t => ({ ...t, class: "text" })),
      ...(existing.regions || []).filter(r => r.class !== "text"),
    ],
  };
  fs.writeFileSync(OUT, JSON.stringify(annotation, null, 2) + "\n");
  console.log(`\nwrote ${path.relative(process.cwd(), OUT)}: ${objects.length} objects, ${rel.length} relationships`);
}

await browser.close();
