// Generates the Gate C/D adversarial fixtures and their ground truth.
//
// The real venue plan's annotation was produced by extracting printed markers
// and checking them by eye, which is honest but bounded by what a human can
// verify. These two fixtures are the opposite trade: synthetic, so every
// object's exact pixel box is known by construction and the ground truth is
// EMITTED rather than measured. That makes false positives unambiguous — a
// detection centred inside a text or architecture region is wrong, with no
// judgement call about whether the annotator missed something.
//
// They are adversarial on purpose. Both carry real, detectable furniture, and
// both bury it in the things a threshold-based detector reliably mistakes for
// furniture: printed labels, legends and scale bars in the first; walls,
// columns, door swings, stair treads and hatching in the second. A change that
// suppresses the noise by also losing the furniture shows up immediately,
// because furniture recall is scored on the same image.
//
// Usage: node benchmarks/make-adversarial-fixtures.mjs
// Writes benchmarks/fixtures/*.png and benchmarks/annotations/*.json.

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// ---------------------------------------------------------------------------
// Fixture A: real furniture buried in printed text.
// ---------------------------------------------------------------------------
function textFixtureSpec() {
  const W = 1400, H = 900;
  const objects = [], regions = [];
  const CHAIRS_PER = 6;

  // 12 square tables, 4 x 3, generous spacing so nothing merges.
  const T = 76, gapX = 300, gapY = 240, x0 = 200, y0 = 250;
  let n = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    n++;
    const cx = x0 + c * gapX, cy = y0 + r * gapY;
    objects.push({ id: `T${String(n).padStart(2, "0")}`, class: "table", type: "square",
      cx, cy, w: T, h: T, seats: CHAIRS_PER, seatsConfidence: "constructed" });
  }

  // Printed matter. Every block is a text region: a detection whose centre
  // lands inside one is a text false positive, by construction.
  const texts = [
    { id: "title",     x: 40,  y: 30,  w: 560, h: 34, size: 30, weight: "bold",   s: "MERIT ARENA - MAIN BALLROOM" },
    { id: "subtitle",  x: 40,  y: 74,  w: 430, h: 20, size: 17, weight: "normal", s: "SEATING LAYOUT / REV 4 / 2026-08-30" },
    { id: "capacity",  x: 900, y: 30,  w: 420, h: 30, size: 26, weight: "bold",   s: "TOTAL 72 PAX" },
    { id: "capacity2", x: 900, y: 70,  w: 420, h: 22, size: 19, weight: "normal", s: "12 TABLES x 6 SEATS" },
    { id: "scalebar",  x: 40,  y: 830, w: 250, h: 22, size: 18, weight: "normal", s: "0    5    10 m" },
    { id: "north",     x: 1330, y: 830, w: 40, h: 34, size: 30, weight: "bold",   s: "N" },
    { id: "legend1",   x: 1050, y: 760, w: 300, h: 18, size: 15, weight: "normal", s: "SQUARE TABLE - 6 SEATS" },
    { id: "legend2",   x: 1050, y: 786, w: 300, h: 18, size: 15, weight: "normal", s: "SERVICE ACCESS - KEEP CLEAR" },
    { id: "note1",     x: 40,  y: 760, w: 520, h: 16, size: 13, weight: "normal", s: "Note: final seat count subject to fire officer approval." },
    { id: "note2",     x: 40,  y: 782, w: 520, h: 16, size: 13, weight: "normal", s: "All dimensions in millimetres unless noted otherwise." },
    { id: "note3",     x: 40,  y: 804, w: 520, h: 16, size: 13, weight: "normal", s: "Do not scale from this drawing. Refer to schedule 4B." },
  ];
  // Per-table printed numbers, the hardest case: small text right beside real
  // furniture, where a naive "text is far from tables" rule would fail.
  objects.forEach((o, i) => {
    texts.push({ id: `label-${o.id}`, x: Math.round(o.cx - 24), y: Math.round(o.cy + T / 2 + 12),
      w: 48, h: 18, size: 16, weight: "bold", s: o.id });
  });
  texts.forEach(t => regions.push({ id: t.id, class: "text", x: t.x, y: t.y, w: t.w, h: t.h }));

  return { W, H, objects, regions, texts, chairsPer: CHAIRS_PER, tableSize: T };
}

// ---------------------------------------------------------------------------
// Fixture B: real furniture buried in architecture.
// ---------------------------------------------------------------------------
function archFixtureSpec() {
  const W = 1400, H = 900;
  const objects = [], regions = [];
  const CHAIRS_PER = 8, D = 84;

  // 10 round tables, 5 x 2, inside the room.
  const gapX = 230, gapY = 260, x0 = 250, y0 = 330;
  let n = 0;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
    n++;
    objects.push({ id: `R${String(n).padStart(2, "0")}`, class: "table", type: "round",
      cx: x0 + c * gapX, cy: y0 + r * gapY, w: D, h: D, seats: CHAIRS_PER, seatsConfidence: "constructed" });
  }

  // Columns are legitimate venue objects, so they are annotated as OBJECTS,
  // not as noise. Detecting one as a TABLE is still a false positive, and the
  // report scores that separately from detecting one as a venue column.
  const columns = [
    { id: "C1", cx: 160,  cy: 200, w: 46, h: 46, shape: "square" },
    { id: "C2", cx: 700,  cy: 200, w: 46, h: 46, shape: "square" },
    { id: "C3", cx: 1240, cy: 200, w: 46, h: 46, shape: "square" },
    { id: "C4", cx: 160,  cy: 700, w: 46, h: 46, shape: "square" },
    { id: "C5", cx: 700,  cy: 700, w: 44, h: 44, shape: "round" },
    { id: "C6", cx: 1240, cy: 700, w: 44, h: 44, shape: "round" },
  ];
  columns.forEach(c => objects.push({ id: c.id, class: "column", cx: c.cx, cy: c.cy, w: c.w, h: c.h }));

  // Pure architecture: nothing here is furniture, and any detection centred in
  // one of these boxes is an architectural false positive.
  const walls = [
    { id: "wall-n", x: 60,   y: 60,  w: 1280, h: 16 },
    { id: "wall-s", x: 60,   y: 824, w: 1280, h: 16 },
    { id: "wall-w", x: 60,   y: 60,  w: 16,   h: 780 },
    { id: "wall-e", x: 1324, y: 60,  w: 16,   h: 780 },
    { id: "partition-1", x: 420, y: 60,  w: 14, h: 150 },
    { id: "partition-2", x: 980, y: 690, w: 14, h: 150 },
  ];
  const doors = [
    { id: "door-w", hx: 76,   hy: 380, size: 90, dir: "e" },
    { id: "door-e", hx: 1324, hy: 500, size: 90, dir: "w" },
  ];
  const stairs = { id: "stairs", x: 1080, y: 100, w: 200, h: 150, treads: 8 };
  const hatch = { id: "service-hatch", x: 120, y: 100, w: 240, h: 110 };
  const mullions = { id: "window-mullions", x: 500, y: 60, w: 420, h: 18, count: 9 };

  walls.forEach(w => regions.push({ id: w.id, class: "architecture", subclass: "wall", ...w }));
  doors.forEach(d => regions.push({ id: d.id, class: "architecture", subclass: "door-swing",
    x: d.dir === "e" ? d.hx : d.hx - d.size, y: d.hy, w: d.size, h: d.size }));
  regions.push({ id: stairs.id, class: "architecture", subclass: "stairs", x: stairs.x, y: stairs.y, w: stairs.w, h: stairs.h });
  regions.push({ id: hatch.id, class: "architecture", subclass: "hatched-service-area", x: hatch.x, y: hatch.y, w: hatch.w, h: hatch.h });
  regions.push({ id: mullions.id, class: "architecture", subclass: "window-mullions", x: mullions.x, y: mullions.y, w: mullions.w, h: mullions.h });

  return { W, H, objects, regions, columns, walls, doors, stairs, hatch, mullions, chairsPer: CHAIRS_PER, diameter: D };
}

// ---------------------------------------------------------------------------
// Fixture C: the conditions the detector actually fails under.
//
// The first two fixtures score F1 = 1.0 and always did — they are clean, well
// separated and colour-coded, so they prove a change did not break an easy
// plan but they never exercise the failure. This one reproduces what the real
// venue plan does, where 41 of 82 proposed tables were fragments:
//
//   - GREYSCALE. No saturated seat colour, so the chair-first colour clustering
//     cannot engage and everything falls to the luma/fill path.
//   - TOUCHING furniture. Tables abut each other and abut walls, so the blob
//     stage merges them and the valley-split step has to guess the boundaries.
//     Every fragment in the real plan's failure came out of that step.
//   - Text at furniture scale. Room labels drawn as large as a real table.
//   - Filled architectural blocks (ducts, risers) shaped like tables.
//
// It is built to be hard, not to be failed on purpose: the tables in it are
// real, regular and annotated exactly, so recall is fully scoreable and a
// suppression rule that solves it by deleting furniture is caught here.
// ---------------------------------------------------------------------------
function denseFixtureSpec() {
  const W = 1400, H = 900;
  const objects = [], regions = [];
  const CHAIRS_PER = 4, T = 70;

  // Four rows of six tables, spaced so neighbours nearly touch (gap 12px):
  // close enough to merge under threshold, far enough to be distinct objects.
  const gapX = T + 12, gapY = 150, x0 = 250, y0 = 260;
  let n = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    n++;
    objects.push({ id: `D${String(n).padStart(2, "0")}`, class: "table", type: "square",
      cx: x0 + c * gapX, cy: y0 + r * gapY, w: T, h: T, seats: CHAIRS_PER, seatsConfidence: "constructed" });
  }

  // Filled service blocks: solid rectangles at roughly table scale, the exact
  // shape a fill-mask detector wants to call a table.
  const blocks = [
    { id: "riser-1",  x: 80,   y: 250, w: 90,  h: 64 },
    { id: "riser-2",  x: 80,   y: 560, w: 90,  h: 64 },
    { id: "duct-1",   x: 1240, y: 250, w: 96,  h: 58 },
    { id: "duct-2",   x: 1240, y: 560, w: 96,  h: 58 },
    { id: "av-rack",  x: 640,  y: 100, w: 130, h: 62 },
  ];
  // Walls that cut straight through the seating field, forcing merges.
  const walls = [
    { id: "wall-mid",  x: 60,  y: 205, w: 1280, h: 12 },
    { id: "wall-mid2", x: 60,  y: 815, w: 1280, h: 12 },
    { id: "wall-l",    x: 60,  y: 205, w: 12,   h: 622 },
    { id: "wall-r",    x: 1328, y: 205, w: 12,  h: 622 },
  ];
  blocks.forEach(b => regions.push({ id: b.id, class: "architecture", subclass: "service-block", ...b }));
  walls.forEach(w => regions.push({ id: w.id, class: "architecture", subclass: "wall", ...w }));

  // Room labels drawn at table scale — big enough that a size filter alone
  // cannot separate them from furniture.
  const texts = [
    { id: "room-label", x: 90,  y: 60,  w: 420, h: 46, size: 42, weight: "bold",   s: "BALLROOM B" },
    { id: "pax-note",   x: 950, y: 60,  w: 380, h: 40, size: 36, weight: "bold",   s: "96 PAX" },
    { id: "zone-a",     x: 250, y: 838, w: 200, h: 34, size: 30, weight: "bold",   s: "ZONE A" },
    { id: "zone-b",     x: 900, y: 838, w: 200, h: 34, size: 30, weight: "bold",   s: "ZONE B" },
  ];
  texts.forEach(t => regions.push({ id: t.id, class: "text", x: t.x, y: t.y, w: t.w, h: t.h }));

  return { W, H, objects, regions, blocks, walls, texts, chairsPer: CHAIRS_PER, tableSize: T };
}

async function renderDenseFixture(page, spec) {
  return page.evaluate(({ spec }) => {
    const c = document.createElement("canvas"); c.width = spec.W; c.height = spec.H;
    const x = c.getContext("2d");
    // Deliberately greyscale: no colour channel for the chair clusterer to use.
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, spec.W, spec.H);
    const INK = "#000000", SURF = "#b8b8b8", SEATG = "#6e6e6e", BLOCK = "#8c8c8c";
    for (const w of spec.walls) { x.fillStyle = INK; x.fillRect(w.x, w.y, w.w, w.h); }
    for (const b of spec.blocks) {
      x.fillStyle = BLOCK; x.fillRect(b.x, b.y, b.w, b.h);
      x.strokeStyle = INK; x.lineWidth = 2; x.strokeRect(b.x, b.y, b.w, b.h);
    }
    for (const o of spec.objects) {
      x.fillStyle = SURF; x.strokeStyle = INK; x.lineWidth = 1.6;
      x.fillRect(o.cx - o.w / 2, o.cy - o.h / 2, o.w, o.h);
      x.strokeRect(o.cx - o.w / 2, o.cy - o.h / 2, o.w, o.h);
      // seats on two sides only, in grey, touching the table edge
      const s = 15;
      for (const [dx, dy] of [[-o.w / 2 - s / 2, 0], [o.w / 2 + s / 2, 0], [0, -o.h / 2 - s / 2], [0, o.h / 2 + s / 2]]) {
        x.fillStyle = SEATG; x.fillRect(o.cx + dx - s / 2, o.cy + dy - s / 2, s, s);
        x.strokeStyle = INK; x.lineWidth = 1; x.strokeRect(o.cx + dx - s / 2, o.cy + dy - s / 2, s, s);
      }
    }
    x.fillStyle = INK; x.textBaseline = "top";
    for (const t of spec.texts) { x.font = `${t.weight} ${t.size}px sans-serif`; x.fillText(t.s, t.x, t.y); }
    return c.toDataURL("image/png");
  }, { spec });
}

// ---------------------------------------------------------------------------
// Drawing. Colours mirror the real plan's language: warm paper, dark linework,
// saturated seat markers, so the detector meets the same colour separation it
// meets in production rather than an artificially easy black-on-white image.
// ---------------------------------------------------------------------------
const PAPER = "#f4f1ea", INK = "#1d2126", SURFACE = "#ded7c8", SEAT = "#2f6f4f";

const drawText = `
function chairRing(x, cx, cy, radius, count, size) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * radius, py = cy + Math.sin(a) * radius;
    x.fillStyle = "${SEAT}";
    x.fillRect(px - size / 2, py - size / 2, size, size);
    x.strokeStyle = "${INK}"; x.lineWidth = 1;
    x.strokeRect(px - size / 2, py - size / 2, size, size);
    out.push({ cx: px, cy: py });
  }
  return out;
}`;

async function renderTextFixture(page, spec) {
  return page.evaluate(({ spec, PAPER, INK, SURFACE, SEAT, drawText }) => {
    eval(drawText);
    const c = document.createElement("canvas"); c.width = spec.W; c.height = spec.H;
    const x = c.getContext("2d");
    x.fillStyle = PAPER; x.fillRect(0, 0, spec.W, spec.H);
    // furniture first, so text drawn later can sit beside it
    for (const o of spec.objects) {
      x.fillStyle = SURFACE; x.strokeStyle = INK; x.lineWidth = 2;
      x.fillRect(o.cx - o.w / 2, o.cy - o.h / 2, o.w, o.h);
      x.strokeRect(o.cx - o.w / 2, o.cy - o.h / 2, o.w, o.h);
      chairRing(x, o.cx, o.cy, o.w / 2 + 16, spec.chairsPer, 18);
    }
    x.fillStyle = INK; x.textBaseline = "top";
    for (const t of spec.texts) {
      x.font = `${t.weight} ${t.size}px sans-serif`;
      x.fillText(t.s, t.x, t.y);
    }
    // legend swatches beside the legend text (small filled marks that are NOT
    // furniture, sitting in a text region)
    x.fillStyle = SURFACE; x.strokeStyle = INK; x.lineWidth = 1.5;
    x.fillRect(1015, 758, 24, 20); x.strokeRect(1015, 758, 24, 20);
    x.fillStyle = SEAT; x.fillRect(1015, 784, 24, 20); x.strokeRect(1015, 784, 24, 20);
    // scale-bar ticks
    x.strokeStyle = INK; x.lineWidth = 3;
    x.beginPath(); x.moveTo(45, 855); x.lineTo(275, 855); x.stroke();
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(45 + i * 57, 848); x.lineTo(45 + i * 57, 862); x.stroke(); }
    return c.toDataURL("image/png");
  }, { spec, PAPER, INK, SURFACE, SEAT, drawText });
}

async function renderArchFixture(page, spec) {
  return page.evaluate(({ spec, PAPER, INK, SURFACE, SEAT, drawText }) => {
    eval(drawText);
    const c = document.createElement("canvas"); c.width = spec.W; c.height = spec.H;
    const x = c.getContext("2d");
    x.fillStyle = PAPER; x.fillRect(0, 0, spec.W, spec.H);

    // double-line walls: two strokes with a light core, the standard drafting
    // convention and a classic source of long thin "tables"
    for (const w of spec.walls) {
      x.fillStyle = "#ffffff"; x.fillRect(w.x, w.y, w.w, w.h);
      x.strokeStyle = INK; x.lineWidth = 2.5; x.strokeRect(w.x, w.y, w.w, w.h);
    }
    // door leaf + quarter-circle swing arc
    x.strokeStyle = INK; x.lineWidth = 2;
    for (const d of spec.doors) {
      const sign = d.dir === "e" ? 1 : -1;
      x.beginPath(); x.moveTo(d.hx, d.hy); x.lineTo(d.hx + sign * d.size, d.hy); x.stroke();
      x.beginPath(); x.arc(d.hx, d.hy, d.size, 0, Math.PI / 2 * sign, sign < 0); x.stroke();
    }
    // staircase: parallel treads with a direction arrow
    const s = spec.stairs;
    x.strokeStyle = INK; x.lineWidth = 2; x.strokeRect(s.x, s.y, s.w, s.h);
    for (let i = 1; i < s.treads; i++) {
      const ty = s.y + (s.h / s.treads) * i;
      x.beginPath(); x.moveTo(s.x, ty); x.lineTo(s.x + s.w, ty); x.stroke();
    }
    // hatched service area: 45-degree fill, dense linework with no solid body
    const h = spec.hatch;
    x.save(); x.beginPath(); x.rect(h.x, h.y, h.w, h.h); x.clip();
    x.strokeStyle = INK; x.lineWidth = 1.4;
    for (let i = -h.h; i < h.w; i += 11) {
      x.beginPath(); x.moveTo(h.x + i, h.y + h.h); x.lineTo(h.x + i + h.h, h.y); x.stroke();
    }
    x.restore();
    x.strokeStyle = INK; x.lineWidth = 2; x.strokeRect(h.x, h.y, h.w, h.h);
    // window mullions: a repeating small-rectangle rhythm, which is exactly
    // what a repetition-based table score rewards
    const m = spec.mullions, step = m.w / m.count;
    for (let i = 0; i < m.count; i++) {
      x.fillStyle = "#ffffff"; x.fillRect(m.x + i * step + 2, m.y, step - 4, m.h);
      x.strokeStyle = INK; x.lineWidth = 1.8; x.strokeRect(m.x + i * step + 2, m.y, step - 4, m.h);
    }
    // columns: solid, hatched-centre squares and circles
    for (const col of spec.columns) {
      x.fillStyle = "#c9c2b4"; x.strokeStyle = INK; x.lineWidth = 2.5;
      if (col.shape === "round") {
        x.beginPath(); x.arc(col.cx, col.cy, col.w / 2, 0, Math.PI * 2); x.fill(); x.stroke();
      } else {
        x.fillRect(col.cx - col.w / 2, col.cy - col.h / 2, col.w, col.h);
        x.strokeRect(col.cx - col.w / 2, col.cy - col.h / 2, col.w, col.h);
      }
    }
    // the real furniture
    for (const o of spec.objects.filter(o => o.class === "table")) {
      x.fillStyle = SURFACE; x.strokeStyle = INK; x.lineWidth = 2;
      x.beginPath(); x.arc(o.cx, o.cy, o.w / 2, 0, Math.PI * 2); x.fill(); x.stroke();
      chairRing(x, o.cx, o.cy, o.w / 2 + 17, spec.chairsPer, 17);
    }
    return c.toDataURL("image/png");
  }, { spec, PAPER, INK, SURFACE, SEAT, drawText });
}

// ---------------------------------------------------------------------------
function writeFixture(name, planId, dataUrl, spec, notes) {
  const png = Buffer.from(dataUrl.split(",")[1], "base64");
  const imgPath = path.join(ROOT, "fixtures", `${name}.png`);
  fs.writeFileSync(imgPath, png);
  const sha = crypto.createHash("sha256").update(png).digest("hex");

  const tables = spec.objects.filter(o => o.class === "table");
  const annot = {
    planId,
    source: { file: `fixtures/${name}.png`, width: spec.W, height: spec.H, sha256: sha },
    // The honesty field the annotation format requires. These fixtures are
    // generated, so the method is "constructed" and every box is exact -- no
    // estimate, no unverified object.
    annotationMethod: "constructed — this image is generated by benchmarks/make-adversarial-fixtures.mjs, so every object and region box is the exact geometry that was drawn, not a measurement of it. Regenerating the fixture regenerates the ground truth; the sha256 above detects a swapped image.",
    matchToleranceP: 2.0,
    notes,
    objects: spec.objects,
    regions: spec.regions,
    capacity: {
      annotatedChairs: tables.length * spec.chairsPer,
      ocrStated: null,
      unverified: [],
      note: "Chair count is constructed: every table was drawn with exactly this many seat markers.",
    },
  };
  fs.writeFileSync(path.join(ROOT, "annotations", `${name}.json`), JSON.stringify(annot, null, 2) + "\n");
  console.log(`${name}.png  ${spec.W}x${spec.H}  sha256 ${sha.slice(0, 16)}...`);
  console.log(`  ${tables.length} tables, ${tables.length * spec.chairsPer} chairs, ` +
    `${spec.objects.filter(o => o.class === "column").length} columns, ` +
    `${spec.regions.filter(r => r.class === "text").length} text regions, ` +
    `${spec.regions.filter(r => r.class === "architecture").length} architecture regions`);
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const page = await browser.newPage();
await page.goto("about:blank");

const textSpec = textFixtureSpec();
writeFixture("adversarial-text", "adversarial-text-v1", await renderTextFixture(page, textSpec), textSpec,
  "Real square tables with seat markers, buried in printed matter: title block, capacity legend, scale bar with ticks, north arrow, legend swatches, three lines of small notes, and a printed number beside every table. The per-table labels are the hard case — a rule that suppresses text merely because it is far from furniture will not catch them.");

const archSpec = archFixtureSpec();
writeFixture("adversarial-architecture", "adversarial-architecture-v1", await renderArchFixture(page, archSpec), archSpec,
  "Real round tables with seat markers, buried in architecture: double-line perimeter walls, two partitions, six columns (four square, two round), two door leaves with quarter-circle swing arcs, an eight-tread staircase, a 45-degree hatched service area, and nine repeating window mullions. Columns are annotated as OBJECTS because they are legitimate venue furniture; walls, doors, stairs, hatching and mullions are architecture REGIONS where any detection is a false positive.");

const denseSpec = denseFixtureSpec();
writeFixture("adversarial-dense", "adversarial-dense-v1", await renderDenseFixture(page, denseSpec), denseSpec,
  "The hard case, built to reproduce the conditions the real venue plan fails under. Greyscale, so the chair-first colour clustering cannot engage; 24 tables spaced 12px apart so the blob stage merges them and the valley-split step has to guess boundaries; walls cutting through the seating field; five filled service blocks at table scale; and room labels drawn as large as a real table. The tables are still regular and exactly annotated, so a suppression rule that 'solves' this image by deleting furniture is caught by recall here.");

await browser.close();
