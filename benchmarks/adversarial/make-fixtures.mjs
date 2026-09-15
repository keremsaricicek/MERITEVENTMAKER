// The eight layouts this system has never been allowed to fail on.
//
// Everything measured in benchmarks/ so far comes from ONE drawing and sixteen
// re-renderings of it. That corpus can tell you a change did not break what
// already worked. It cannot tell you which of the system's beliefs are
// properties of floor plans and which are properties of THAT floor plan — and
// after several sprints of tuning against it, the second set is the dangerous
// one. A rule like "a table's seats sit around it, not inside it" reads as
// common sense until someone draws a banquet plan with the chairs tucked under.
//
// So these are not decorative plans. Each one is a HYPOTHESIS about a specific
// assumption the current build might be carrying, drawn so that the assumption,
// if present, produces a visible wrong answer. A fixture that everything passes
// on the first run taught us nothing; the useful outcome of this file is a list
// of failures.
//
// THEY ARE NOT REAL VENUES.
//   - they do not count toward REAL DISTINCT VENUE PLANS (that number is 1)
//   - the learned encoder is not trained on them
//   - no threshold may be tuned to an individual fixture, and no code may
//     branch on a fixture id
//   - their scores never enter the real-plan aggregates
//
// Because they are generated, every box is the exact geometry that was drawn
// rather than a measurement of it, and the ground truth includes things a human
// annotator cannot supply reliably: which table each chair actually belongs to,
// which chairs are genuinely ambiguous between two tables, and which way each
// chair faces. That is the point of paying the synthetic-data cost here.
//
// Usage: node benchmarks/adversarial/make-fixtures.mjs
// Writes benchmarks/adversarial/fixtures/*.png and declarations/*.json.

import { launchChromium } from "../../tests/lib/env.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// The real plan's colour language, so the detector meets the same tone and
// saturation separation it meets in production rather than an easy black-on-
// white image that flatters every threshold.
const PAPER = "#f4f1ea", INK = "#1d2126", SURFACE = "#ded7c8";
const SEAT = "#2f6f4f", SEAT_WARM = "#c2703a", ARCH_FILL = "#c9c2b4";
const GREY = "#8c8c8c", WHITE = "#ffffff";

// ---------------------------------------------------------------------------
// A fixture accumulates three things at once and keeps them in step: the draw
// operations, the ground truth for what was drawn, and the semantic claims the
// interpreter is expected (or forbidden) to make about it. Anything that
// produces a pixel also produces its own annotation here, so the two cannot
// drift apart the way a hand-maintained annotation file does.
// ---------------------------------------------------------------------------
class Fixture {
  constructor({ id, hypothesis, W, H, notes, matchToleranceP = 2.0 }) {
    Object.assign(this, { id, hypothesis, W, H, notes, matchToleranceP });
    this.ops = [{ t: "paper", fill: PAPER }];
    this.objects = [];
    this.regions = [];
    this.relationships = [];
    this.expectedZones = [];
    this.expectedFacts = [];
    this.forbiddenFacts = [];
    this.forbiddenZoneTypes = [];
    this.performance = null;
    this.minTableTypes = null;
    this._chairSeq = 0;
  }

  // -- architecture and printed matter --------------------------------------
  wall(id, x, y, w, h) {
    this.ops.push({ t: "rect", x, y, w, h, fill: WHITE, stroke: INK, lw: 2.5 });
    this.regions.push({ id, class: "architecture", subclass: "wall", x, y, w, h });
    return this;
  }
  solidWall(id, x, y, w, h) {
    this.ops.push({ t: "rect", x, y, w, h, fill: INK });
    this.regions.push({ id, class: "architecture", subclass: "wall", x, y, w, h });
    return this;
  }
  // The leaf, then the quarter-circle swing it sweeps. Both quadrants are drawn
  // toward the room interior: an east-hung door swings from due east round to
  // due south, a west-hung one from due west round to due south, which is why
  // the two cases are different arcs rather than one arc with a sign flipped.
  doorSwing(id, hx, hy, size, dir) {
    const sign = dir === "e" ? 1 : -1;
    this.ops.push({ t: "line", x1: hx, y1: hy, x2: hx + sign * size, y2: hy, stroke: INK, lw: 2 });
    this.ops.push(dir === "e"
      ? { t: "arc", cx: hx, cy: hy, r: size, a0: 0, a1: Math.PI / 2, ccw: false, stroke: INK, lw: 2 }
      : { t: "arc", cx: hx, cy: hy, r: size, a0: Math.PI, a1: Math.PI / 2, ccw: true, stroke: INK, lw: 2 });
    this.regions.push({ id, class: "architecture", subclass: "door-swing",
      x: dir === "e" ? hx : hx - size, y: hy, w: size, h: size });
    return this;
  }
  stairs(id, x, y, w, h, treads) {
    this.ops.push({ t: "rect", x, y, w, h, stroke: INK, lw: 2 });
    for (let i = 1; i < treads; i++)
      this.ops.push({ t: "line", x1: x, y1: y + (h / treads) * i, x2: x + w, y2: y + (h / treads) * i, stroke: INK, lw: 2 });
    this.regions.push({ id, class: "architecture", subclass: "stairs", x, y, w, h });
    return this;
  }
  hatch(id, x, y, w, h, subclass = "hatched-service-area") {
    this.ops.push({ t: "hatch", x, y, w, h, step: 11, stroke: INK, lw: 1.4 });
    this.ops.push({ t: "rect", x, y, w, h, stroke: INK, lw: 2 });
    this.regions.push({ id, class: "architecture", subclass, x, y, w, h });
    return this;
  }
  // A filled block at furniture scale — a riser, a plinth, a floor box. Not
  // furniture, and shaped exactly like the thing a fill-mask detector wants to
  // call a table.
  block(id, x, y, w, h, subclass = "service-block") {
    this.ops.push({ t: "rect", x, y, w, h, fill: GREY, stroke: INK, lw: 2 });
    this.regions.push({ id, class: "architecture", subclass, x, y, w, h });
    return this;
  }
  dimension(id, x1, y1, x2, y2, label) {
    this.ops.push({ t: "line", x1, y1, x2, y2, stroke: INK, lw: 1 });
    for (const [tx, ty] of [[x1, y1], [x2, y2]])
      this.ops.push({ t: "line", x1: tx, y1: ty - 6, x2: tx, y2: ty + 6, stroke: INK, lw: 1 });
    this.ops.push({ t: "text", x: (x1 + x2) / 2 - 30, y: y1 - 20, s: label, size: 14, weight: "normal", fill: INK });
    this.regions.push({ id, class: "architecture", subclass: "dimension-line",
      x: Math.min(x1, x2), y: Math.min(y1, y2) - 22, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) + 30 });
    return this;
  }
  text(id, x, y, s, size, weight = "normal") {
    this.ops.push({ t: "text", x, y, s, size, weight, fill: INK });
    this.regions.push({ id, class: "text", x, y, w: Math.round(s.length * size * 0.56), h: Math.round(size * 1.2) });
    return this;
  }

  // -- furniture -------------------------------------------------------------
  table({ id, type, cx, cy, w, h, rotation = 0, seats = 0, fill = SURFACE }) {
    if (type === "round") this.ops.push({ t: "circle", cx, cy, r: w / 2, fill, stroke: INK, lw: 2 });
    else this.ops.push({ t: "rect", x: cx - w / 2, y: cy - h / 2, w, h, fill, stroke: INK, lw: 2, rotation, rcx: cx, rcy: cy });
    this.objects.push({ id, class: "table", type, cx, cy, w, h, rotation, seats, seatsConfidence: "constructed" });
    return this;
  }

  // A chair is drawn AND its ground-truth relation is recorded in the same
  // call, because the two are the same fact. `belongsTo: null` is a deliberate
  // abstention — a chair the drawing genuinely does not assign to one table —
  // and the benchmark scores those as ambiguous rather than counting a forced
  // answer as correct.
  //
  // `style` decides whether orientation is knowable at all:
  //   filled / outline  — a symmetric square. orientationKnown = false, always.
  //   backrest          — one heavy edge. orientationKnown = true, and the
  //                       facing direction is the opposite of that edge.
  chair({ cx, cy, size = 22, style = "filled", family, belongsTo, facingDeg = null,
          competing = null, note = null, colour = SEAT }) {
    const id = `c${String(++this._chairSeq).padStart(3, "0")}`;
    const orientationKnown = style === "backrest";
    const rotation = orientationKnown ? facingDeg : 0;
    this.ops.push({ t: "chair", cx, cy, size, style, colour,
      backDeg: orientationKnown ? facingDeg + 180 : 0 });
    this.objects.push({ id, class: "chair", family: family || style, cx, cy, w: size, h: size,
      rotation: rotation || 0, orientationKnown,
      facingDeg: orientationKnown ? ((facingDeg % 360) + 360) % 360 : null });
    this.relationships.push({
      chair: id, belongsTo: belongsTo ?? null, method: "constructed",
      evidence: note || (belongsTo ? `drawn as a seat of ${belongsTo}` : "drawn equidistant between two tables; the drawing does not say"),
      ...(competing ? { competing } : {}),
      facingDeg: orientationKnown ? ((facingDeg % 360) + 360) % 360 : null,
      orientationKnown,
    });
    return id;
  }

  // Seats evenly around a round table, each one facing the centre. The only
  // arrangement in this file where facing is derivable from the drawing alone.
  chairRing({ tableId, cx, cy, radius, count, size = 20, style = "filled", family, colour = SEAT, startDeg = -90 }) {
    const ids = [];
    for (let i = 0; i < count; i++) {
      const a = ((startDeg + (i / count) * 360) * Math.PI) / 180;
      const px = cx + Math.cos(a) * radius, py = cy + Math.sin(a) * radius;
      // Facing the table centre is the direction from the chair back to it.
      const facing = (Math.atan2(cy - py, cx - px) * 180) / Math.PI;
      ids.push(this.chair({ cx: px, cy: py, size, style, family, belongsTo: tableId,
        facingDeg: facing, colour }));
    }
    return ids;
  }

  // Seats in a row along one edge of a rectangular table.
  chairRow({ tableId, cx, cy, count, spacing, size = 22, style = "filled", family, colour = SEAT, facingDeg = null, horizontal = true }) {
    const ids = [];
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spacing;
      ids.push(this.chair({ cx: cx + (horizontal ? off : 0), cy: cy + (horizontal ? 0 : off),
        size, style, family, belongsTo: tableId, facingDeg, colour }));
    }
    return ids;
  }

  venue({ id, cls, cx, cy, w, h, fill = ARCH_FILL, shape = "rect" }) {
    if (shape === "round") this.ops.push({ t: "circle", cx, cy, r: w / 2, fill, stroke: INK, lw: 2.5 });
    else this.ops.push({ t: "rect", x: cx - w / 2, y: cy - h / 2, w, h, fill, stroke: INK, lw: 2.5 });
    this.objects.push({ id, class: cls, cx, cy, w, h, rotation: 0 });
    return this;
  }

  zone({ id, type, memberIds, note }) {
    this.expectedZones.push({ id, type, memberIds, note: note || null });
    return this;
  }
  expect(...ids) { this.expectedFacts.push(...ids); return this; }
  forbid(...ids) { this.forbiddenFacts.push(...ids); return this; }
  forbidZones(...types) { this.forbiddenZoneTypes.push(...types); return this; }
}

// ---------------------------------------------------------------------------
// A1 — CHAIR UNDER TABLE
//
// Hypothesis under test: the seat-containment gate added in the previous
// sprint ("a table whose every detected seat centre lies inside its own body
// is not a table") was measured on one plan, where it removed 158 invented
// tables and zero real ones. It encodes a belief about how banquet furniture
// is drawn. This fixture draws the counterexample the belief forbids: real
// tables with their chairs tucked under, which is how a plan shows a set table
// nobody is sitting at.
//
// Half the tables have chairs pulled out (the control). If the gate is
// over-general, the tucked half is held back and the control half is not, and
// that difference is the finding.
// ---------------------------------------------------------------------------
function a1ChairUnderTable() {
  const f = new Fixture({
    id: "a1-chair-under-table", W: 1500, H: 950,
    hypothesis: "The seat-containment rule ('a table's seats surround it, they do not lie inside it') is over-general. " +
      "A banquet plan drawn with chairs tucked under the table has every seat centre inside the table footprint, " +
      "and a table so drawn must still be detected, selected and kept.",
    notes: "Eight tables with seats tucked under the top (all six seat centres inside the table box) and eight otherwise " +
      "identical tables with the seats pulled clear. Same size, same seat count, same drawing style; the only variable is " +
      "how far the chairs are pulled out.",
  });
  f.wall("room", 40, 40, 1420, 870);

  const TW = 170, TH = 74, SEATSZ = 24;
  let n = 0;
  // Tucked: seat centres at ±26 of a 74-tall table, i.e. inside the body.
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    n++;
    const id = `TUCK${String(n).padStart(2, "0")}`;
    const cx = 230 + c * 330, cy = 200 + r * 210;
    f.table({ id, type: "rectangle", cx, cy, w: TW, h: TH, seats: 6 });
    f.chairRow({ tableId: id, cx, cy: cy - 26, count: 3, spacing: 54, size: SEATSZ,
      style: "backrest", family: "tucked-backrest-chair", facingDeg: 90 });
    f.chairRow({ tableId: id, cx, cy: cy + 26, count: 3, spacing: 54, size: SEATSZ,
      style: "backrest", family: "tucked-backrest-chair", facingDeg: -90 });
  }
  // Control: same table, seats pulled clear of the edge.
  n = 0;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    n++;
    const id = `OUT${String(n).padStart(2, "0")}`;
    const cx = 230 + c * 330, cy = 620 + r * 190;
    f.table({ id, type: "rectangle", cx, cy, w: TW, h: TH, seats: 6 });
    f.chairRow({ tableId: id, cx, cy: cy - 56, count: 3, spacing: 54, size: SEATSZ,
      style: "backrest", family: "pulled-out-backrest-chair", facingDeg: 90 });
    f.chairRow({ tableId: id, cx, cy: cy + 56, count: 3, spacing: 54, size: SEATSZ,
      style: "backrest", family: "pulled-out-backrest-chair", facingDeg: -90 });
  }
  f.text("title", 60, 60, "BANQUET — LONG TABLES", 26, "bold");
  f.zone({ id: "z-dining", type: "dining", memberIds: f.objects.filter(o => o.class === "table").map(o => o.id),
    note: "one dining area; the tuck/pull-out split is a drawing difference, not two rooms" });
  f.expect("tableCount", "seats", "zone:dining");
  f.forbid("zone:stage", "zone:bar", "zone:lounge", "empty");
  f.forbidZones("stage", "bar", "lounge");
  f.minTableTypes = 1;
  return f;
}

// ---------------------------------------------------------------------------
// A2 — MIXED FURNITURE FAMILIES
//
// Hypothesis under test: the detector learns "the plan's own modal object
// size" and judges every candidate against it. On a plan with one dominant
// family that is exactly right. On a plan with five furniture families of
// genuinely different sizes, the modal size belongs to the majority and every
// minority family is, by construction, off-modal — which is the same signal
// the fragment filter uses to throw things away.
// ---------------------------------------------------------------------------
function a2MixedFamilies() {
  const f = new Fixture({
    id: "a2-mixed-families", W: 1600, H: 1000,
    hypothesis: "Plan-relative size reasoning silently deletes minority furniture families. A plan with square, round, " +
      "rectangle and bistro tables, two chair sizes in two drawing styles, and a lounge group must keep all of them: " +
      "the minority families must survive detection and must still be visible in the interpreter's type mix.",
    notes: "Five table families and four chair families on one drawing. Nothing here is unusual for a hotel ballroom; " +
      "it is only unusual for a benchmark corpus of one plan.",
  });
  f.wall("room", 40, 40, 1520, 920);
  f.text("title", 60, 58, "BALLROOM — MIXED SETTING", 26, "bold");

  // Majority family: square tables, four warm filled chairs.
  for (let i = 0; i < 8; i++) {
    const id = `SQ${String(i + 1).padStart(2, "0")}`;
    const cx = 190 + (i % 4) * 200, cy = 190 + Math.floor(i / 4) * 190;
    f.table({ id, type: "square", cx, cy, w: 64, h: 64, seats: 4 });
    for (const [dx, dy, fd] of [[0, -50, 90], [0, 50, -90], [-50, 0, 0], [50, 0, 180]])
      f.chair({ cx: cx + dx, cy: cy + dy, size: 24, style: "filled", family: "warm-filled-chair",
        belongsTo: id, colour: SEAT_WARM, facingDeg: fd });
  }
  // Round tables, eight small outlined chairs each — a different size AND a
  // different drawing style from the majority.
  for (let i = 0; i < 4; i++) {
    const id = `RD${String(i + 1).padStart(2, "0")}`;
    const cx = 1090 + (i % 2) * 250, cy = 200 + Math.floor(i / 2) * 220;
    f.table({ id, type: "round", cx, cy, w: 104, h: 104, seats: 8 });
    f.chairRing({ tableId: id, cx, cy, radius: 70, count: 8, size: 19, style: "outline",
      family: "pale-outlined-chair" });
  }
  // Rectangle tables with the largest chairs on the plan.
  for (let i = 0; i < 3; i++) {
    const id = `RC${String(i + 1).padStart(2, "0")}`;
    const cx = 300 + i * 380, cy = 610;
    f.table({ id, type: "rectangle", cx, cy, w: 200, h: 76, seats: 6 });
    f.chairRow({ tableId: id, cx, cy: cy - 62, count: 3, spacing: 66, size: 30, style: "backrest",
      family: "large-backrest-chair", facingDeg: 90 });
    f.chairRow({ tableId: id, cx, cy: cy + 62, count: 3, spacing: 66, size: 30, style: "backrest",
      family: "large-backrest-chair", facingDeg: -90 });
  }
  // Bistro tables: the smallest family, two tiny chairs each.
  for (let i = 0; i < 6; i++) {
    const id = `BI${String(i + 1).padStart(2, "0")}`;
    const cx = 200 + i * 150, cy = 830;
    f.table({ id, type: "bistro", cx, cy, w: 48, h: 42, seats: 2 });
    f.chair({ cx: cx - 40, cy, size: 16, style: "outline", family: "bistro-chair", belongsTo: id });
    f.chair({ cx: cx + 40, cy, size: 16, style: "outline", family: "bistro-chair", belongsTo: id });
  }
  // Lounge: sofas with low tables, no dining chairs. The seat count on a sofa
  // is not derivable from the drawing, which is why the product refuses to
  // guess one.
  const loungeIds = [];
  for (let i = 0; i < 2; i++) {
    const id = `SOFA${i + 1}`;
    f.venue({ id, cls: "sofa", cx: 1200 + i * 250, cy: 720, w: 180, h: 58, fill: SURFACE });
    loungeIds.push(id);
    const lt = `LT${i + 1}`;
    f.venue({ id: lt, cls: "lounge-table", cx: 1200 + i * 250, cy: 820, w: 66, h: 66, shape: "round", fill: SURFACE });
    loungeIds.push(lt);
  }

  f.zone({ id: "z-lounge", type: "lounge", memberIds: loungeIds,
    note: "sofas and low tables with no dining chair pattern" });
  f.expect("tableCount", "tableTypeMix", "seats");
  f.forbid("empty");
  f.minTableTypes = 3;
  return f;
}

// ---------------------------------------------------------------------------
// A3 — NO STAGE, NO BAR, NO LOUNGE
//
// Hypothesis under test: hallucination. A plain dining room contains none of
// the semantic anchors the product knows how to name, and the honest output is
// a dining area and nothing else. Every stage, bar, lounge or entrance zone
// this fixture produces is invented, and a STRONG fact about one is the worst
// failure mode the interpreter has.
// ---------------------------------------------------------------------------
function a3NoSemanticAnchors() {
  const f = new Fixture({
    id: "a3-no-anchors", W: 1400, H: 900,
    hypothesis: "The interpreter invents semantic anchors that are not drawn. A plain dining plan with no stage, " +
      "no bar, no lounge furniture and no entrance wording must produce none of those zones and no fact claiming them.",
    notes: "Twenty round tables, eight seats each, four walls, two printed labels. Deliberately featureless.",
  });
  f.wall("room", 40, 40, 1320, 820);
  f.text("title", 60, 58, "DINING ROOM 2", 24, "bold");
  f.text("pax", 1130, 58, "160 PAX", 22, "bold");

  const ids = [];
  for (let i = 0; i < 20; i++) {
    const id = `T${String(i + 1).padStart(2, "0")}`;
    const cx = 210 + (i % 5) * 250, cy = 220 + Math.floor(i / 5) * 190;
    f.table({ id, type: "round", cx, cy, w: 96, h: 96, seats: 8 });
    f.chairRing({ tableId: id, cx, cy, radius: 66, count: 8, size: 20, style: "backrest",
      family: "radial-backrest-chair" });
    ids.push(id);
  }
  f.zone({ id: "z-dining", type: "dining", memberIds: ids });
  f.expect("tableCount", "seats", "zone:dining");
  f.forbid("zone:stage", "zone:bar", "zone:lounge", "zone:entrance", "empty");
  f.forbidZones("stage", "bar", "lounge", "entrance");
  return f;
}

// ---------------------------------------------------------------------------
// A4 — L-SHAPED, TWO ROOMS, ONE CORRIDOR
//
// Hypothesis under test: zone clustering links furniture at a fraction of the
// plan's modal table size and knows nothing about walls. Two halls joined by a
// corridor should be two zones. If the link distance reaches across the
// corridor they become one, and the product will describe a room that does not
// exist — a failure that is invisible on a single rectangular hall.
// ---------------------------------------------------------------------------
function a4MultiRoom() {
  const f = new Fixture({
    id: "a4-multi-room", W: 1600, H: 1100,
    hypothesis: "Zone clustering is distance-only and cannot see a wall. An L-shaped venue of two halls joined by a " +
      "corridor must produce at least two furniture zones, not one zone spanning both halls and the empty corridor.",
    notes: "West hall: square tables. South-east hall: bistro tables. They are joined by a 150px corridor with no " +
      "furniture in it, and separated by real drawn walls.",
  });
  // The L: west hall, corridor, south-east hall.
  f.wall("hall-a", 40, 40, 700, 560);
  f.wall("corridor", 300, 600, 180, 160);
  f.wall("hall-b", 40, 760, 1520, 300);
  f.wall("hall-c", 760, 40, 800, 700);
  f.solidWall("divider", 740, 40, 14, 560);

  f.text("label-a", 70, 58, "HALL A", 22, "bold");
  f.text("label-b", 790, 58, "HALL B", 22, "bold");
  f.text("label-c", 70, 778, "FUNCTION ROOM", 22, "bold");

  const west = [], east = [], south = [];
  for (let i = 0; i < 9; i++) {
    const id = `A${String(i + 1).padStart(2, "0")}`;
    const cx = 160 + (i % 3) * 210, cy = 180 + Math.floor(i / 3) * 170;
    f.table({ id, type: "square", cx, cy, w: 66, h: 66, seats: 4 });
    for (const [dx, dy, fd] of [[0, -50, 90], [0, 50, -90], [-50, 0, 0], [50, 0, 180]])
      f.chair({ cx: cx + dx, cy: cy + dy, size: 22, style: "filled", family: "hall-a-chair", belongsTo: id, facingDeg: fd });
    west.push(id);
  }
  for (let i = 0; i < 8; i++) {
    const id = `B${String(i + 1).padStart(2, "0")}`;
    const cx = 900 + (i % 4) * 170, cy = 220 + Math.floor(i / 4) * 300;
    f.table({ id, type: "round", cx, cy, w: 92, h: 92, seats: 8 });
    f.chairRing({ tableId: id, cx, cy, radius: 64, count: 8, size: 19, style: "backrest", family: "hall-b-chair" });
    east.push(id);
  }
  for (let i = 0; i < 8; i++) {
    const id = `C${String(i + 1).padStart(2, "0")}`;
    const cx = 180 + i * 175, cy = 900;
    f.table({ id, type: "bistro", cx, cy, w: 48, h: 42, seats: 2 });
    f.chair({ cx: cx - 40, cy, size: 16, style: "outline", family: "function-bistro-chair", belongsTo: id });
    f.chair({ cx: cx + 40, cy, size: 16, style: "outline", family: "function-bistro-chair", belongsTo: id });
    south.push(id);
  }
  f.zone({ id: "z-hall-a", type: "dining", memberIds: west });
  f.zone({ id: "z-hall-b", type: "dining", memberIds: east });
  f.zone({ id: "z-function", type: "bistro", memberIds: south });
  f.expect("tableCount", "seats");
  f.forbid("zone:stage", "zone:bar", "zone:lounge", "empty");
  f.forbidZones("stage", "bar", "lounge");
  f.minTableTypes = 2;
  return f;
}

// ---------------------------------------------------------------------------
// A5 — ARCHITECTURE ONLY
//
// Hypothesis under test: whether the system can return nothing. Every plan in
// the corpus contains furniture, so "there is no seating furniture on this
// drawing" is an answer the product has never been required to give. A shell
// drawing — the state a venue plan is in before anyone lays out an event — has
// no tables, no chairs and no capacity, and saying so is the correct output.
// ---------------------------------------------------------------------------
function a5ArchitectureOnly() {
  const f = new Fixture({
    id: "a5-architecture-only", W: 1400, H: 900,
    hypothesis: "The system cannot say 'nothing'. A shell drawing with walls, columns, doors, stairs, dimensions and " +
      "printed notes but no furniture must produce no table facts, no seat count, no dining zone and no capacity claim.",
    notes: "A venue shell as issued by the architect. Every filled shape on it is at furniture scale on purpose.",
  });
  f.wall("shell", 40, 40, 1320, 820);
  f.solidWall("wall-n", 60, 60, 1280, 14);
  f.solidWall("wall-s", 60, 826, 1280, 14);
  f.solidWall("wall-w", 60, 60, 14, 780);
  f.solidWall("wall-e", 1326, 60, 14, 780);
  f.solidWall("partition", 700, 60, 12, 300);

  // Columns on a structural grid, clear of the hatched plant areas and the
  // stair: an architect's drawing does not put a column inside a shaft, and an
  // overlap here would make "which region did this false positive land in"
  // ambiguous for the scorer.
  for (let i = 0; i < 8; i++) {
    const cx = 250 + (i % 4) * 300, cy = 340 + Math.floor(i / 4) * 300;
    f.venue({ id: `COL${i + 1}`, cls: "column", cx, cy, w: 48, h: 48,
      shape: i % 2 ? "round" : "rect", fill: ARCH_FILL });
  }
  f.doorSwing("door-w", 76, 480, 92, "e");
  f.doorSwing("door-e", 1324, 600, 92, "w");
  f.stairs("stairs", 1090, 110, 200, 150, 8);
  f.hatch("riser-shaft", 150, 160, 200, 110);
  f.hatch("plant-room", 600, 700, 240, 120);
  f.dimension("dim-w", 200, 862, 1160, 862, "38.400");
  f.text("title", 70, 82, "GRAND HALL — SHELL", 28, "bold");
  f.text("rev", 70, 120, "ARCHITECTURAL BASE / REV 2 / NO FF&E", 16);
  f.text("note1", 950, 760, "Furniture layout to be issued separately.", 14);
  f.text("note2", 950, 782, "Do not scale from this drawing.", 14);

  f.expect("capacityUnknown");
  f.forbid("tableCount", "tableTypeMix", "seats", "zone:dining", "zone:bistro", "zone:lounge",
    "zone:stage", "zone:bar", "capacity", "groups", "unseated");
  f.forbidZones("dining", "bistro", "lounge", "stage", "bar");
  return f;
}

// ---------------------------------------------------------------------------
// A6 — ARCHITECTURAL CONFUSION
//
// Hypothesis under test: repetition is treated as evidence of furniture. The
// detector's table score rewards objects that repeat at a consistent size,
// because real furniture does. So does a floor-box grid, a plinth row and a
// bank of window mullions — and here the architecture repeats MORE regularly
// than the furniture does, and outnumbers it three to one, which also makes
// the architecture set the plan's modal size.
// ---------------------------------------------------------------------------
function a6ArchitecturalConfusion() {
  const f = new Fixture({
    id: "a6-architectural-confusion", W: 1500, H: 950,
    hypothesis: "Repetition at a consistent size is read as furniture. When repeated architecture outnumbers the real " +
      "furniture and sets the plan's modal size, the furniture must still be found and the architecture must not be " +
      "proposed as tables.",
    notes: "24 floor boxes at chair scale, 10 plinths at table scale, 12 mullions, a service duct run — and 8 real " +
      "square tables with 32 chairs in the north-west corner.",
  });
  f.wall("room", 40, 40, 1420, 870);
  f.text("title", 60, 58, "AV & SERVICES OVERLAY", 24, "bold");

  // Floor boxes: a regular grid at chair scale.
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++)
    f.block(`floorbox-${r}-${c}`, 640 + c * 130, 250 + r * 150, 34, 34, "floor-box");
  // Plinths: table-sized, evenly spaced.
  for (let i = 0; i < 10; i++)
    f.block(`plinth-${i}`, 120 + (i % 5) * 130, 700 + Math.floor(i / 5) * 110, 66, 62, "equipment-plinth");
  // Mullions: the repeating rhythm a repetition score loves.
  for (let i = 0; i < 12; i++)
    f.block(`mullion-${i}`, 620 + i * 68, 100, 44, 26, "window-mullion");
  f.hatch("duct-run", 1280, 240, 120, 560, "service-duct");

  const tables = [];
  for (let i = 0; i < 8; i++) {
    const id = `T${String(i + 1).padStart(2, "0")}`;
    const cx = 180 + (i % 4) * 130, cy = 200 + Math.floor(i / 4) * 200;
    f.table({ id, type: "square", cx, cy, w: 62, h: 62, seats: 4 });
    for (const [dx, dy, fd] of [[0, -48, 90], [0, 48, -90], [-48, 0, 0], [48, 0, 180]])
      f.chair({ cx: cx + dx, cy: cy + dy, size: 22, style: "filled", family: "overlay-chair",
        belongsTo: id, colour: SEAT_WARM, facingDeg: fd });
    tables.push(id);
  }
  f.zone({ id: "z-dining", type: "dining", memberIds: tables });
  f.expect("tableCount", "seats");
  f.forbid("zone:stage", "zone:bar", "zone:lounge", "empty");
  f.forbidZones("stage", "bar", "lounge");
  return f;
}

// ---------------------------------------------------------------------------
// A7 — EXTREME DENSE OVERLAP
//
// Hypothesis under test: chair-to-table association is nearest-table-within-
// reach, so it has never had to choose. This fixture makes it choose, in three
// ways that have different right answers:
//
//   (a) a chair 8px nearer table A than table B — one correct answer, and the
//       margin is small enough that a distance-only rule gets it by luck;
//   (b) a chair EXACTLY equidistant between two tables — no correct answer.
//       The ground truth abstains, and forcing one is the failure. A system
//       that reports these as ambiguous is right; one that reports a table
//       with confidence is wrong even when it happens to pick the same table
//       a human would guess;
//   (c) chairs whose graphics touch the table so the two merge into one
//       component, where the association has to survive decomposition.
// ---------------------------------------------------------------------------
function a7DenseOverlap() {
  const f = new Fixture({
    id: "a7-dense-overlap", W: 1600, H: 1000, matchToleranceP: 1.4,
    hypothesis: "Chair association is distance-only and cannot express doubt. Between two nearly equidistant tables it " +
      "must compare both candidates and report a margin; where the drawing is genuinely symmetric it must say ambiguous " +
      "rather than pick the nearest by a rounding error.",
    notes: "Row A: seats between neighbouring tables, offset 8px toward their true owner, so the answer is decidable " +
      "but only by 16px of margin. Row B: seats drawn EXACTLY halfway between two identical tables — the ground truth " +
      "abstains on all five, and a confident answer is wrong even when it names the table a person would guess. " +
      "Row C: bistro tables whose chairs touch the table body and merge with it graphically. Row D: eight tables at " +
      "an 8px separation and no seats at all, which is decomposition with nothing else to go on.",
  });
  f.wall("room", 40, 40, 1520, 920);
  f.text("title", 60, 58, "DENSE BANQUET", 24, "bold");

  // (a) decidable, but only just: seats sit between two tables, 8px nearer one.
  const rowA = [];
  for (let i = 0; i < 8; i++) {
    const id = `A${String(i + 1).padStart(2, "0")}`;
    const cx = 180 + i * 172, cy = 220;
    f.table({ id, type: "square", cx, cy, w: 120, h: 104, seats: 0 });
    rowA.push({ id, cx, cy });
  }
  for (let i = 0; i < rowA.length - 1; i++) {
    const gapMid = (rowA[i].cx + rowA[i + 1].cx) / 2;
    // 8px toward the left table: decidable, with a real margin to measure.
    f.chair({ cx: gapMid - 8, cy: 220, size: 26, style: "backrest", family: "dense-chair",
      belongsTo: rowA[i].id, facingDeg: 180, competing: { other: rowA[i + 1].id, marginPx: 16 },
      note: `8px nearer ${rowA[i].id} than ${rowA[i + 1].id}` });
  }
  // Seats on the free edges, unambiguous, so the row is not entirely made of
  // hard cases and recall stays scoreable.
  for (const t of rowA) {
    f.chair({ cx: t.cx, cy: t.cy - 74, size: 26, style: "backrest", family: "dense-chair",
      belongsTo: t.id, facingDeg: 90 });
    f.chair({ cx: t.cx, cy: t.cy + 74, size: 26, style: "backrest", family: "dense-chair",
      belongsTo: t.id, facingDeg: -90 });
  }

  // (b) genuinely undecidable: exactly halfway, both tables identical.
  const rowB = [];
  for (let i = 0; i < 6; i++) {
    const id = `B${String(i + 1).padStart(2, "0")}`;
    const cx = 240 + i * 230, cy = 520;
    f.table({ id, type: "square", cx, cy, w: 110, h: 110, seats: 0 });
    rowB.push({ id, cx, cy });
  }
  for (let i = 0; i < rowB.length - 1; i++) {
    f.chair({ cx: (rowB[i].cx + rowB[i + 1].cx) / 2, cy: 520, size: 26, style: "filled",
      family: "ambiguous-chair", belongsTo: null,
      competing: { between: [rowB[i].id, rowB[i + 1].id], marginPx: 0 },
      note: `exactly equidistant between ${rowB[i].id} and ${rowB[i + 1].id}; the drawing does not decide` });
  }
  for (const t of rowB) {
    f.chair({ cx: t.cx, cy: t.cy - 78, size: 26, style: "filled", family: "dense-chair", belongsTo: t.id });
    f.chair({ cx: t.cx, cy: t.cy + 78, size: 26, style: "filled", family: "dense-chair", belongsTo: t.id });
  }

  // (c) merged graphics: bistro tables with chairs hard against the body.
  for (let i = 0; i < 7; i++) {
    const id = `C${String(i + 1).padStart(2, "0")}`;
    const cx = 220 + i * 190, cy = 730;
    f.table({ id, type: "bistro", cx, cy, w: 52, h: 44, seats: 2 });
    f.chair({ cx: cx - 33, cy, size: 22, style: "filled", family: "merged-chair", belongsTo: id, colour: SEAT_WARM });
    f.chair({ cx: cx + 33, cy, size: 22, style: "filled", family: "merged-chair", belongsTo: id, colour: SEAT_WARM });
  }

  // (d) tables at an 8px separation and nothing else: pure decomposition. Seat
  // adjacency is the strongest evidence the table scorer has, and this row
  // withholds it, so the only thing left is whether one blob can be cut into
  // eight objects at the right boundaries.
  for (let i = 0; i < 8; i++) {
    const id = `D${String(i + 1).padStart(2, "0")}`;
    f.table({ id, type: "rectangle", cx: 240 + i * 108, cy: 880, w: 100, h: 70, seats: 0 });
  }
  // Fill in the constructed seat counts now that the chairs exist.
  for (const t of f.objects.filter(o => o.class === "table"))
    t.seats = f.relationships.filter(r => r.belongsTo === t.id).length;

  f.expect("tableCount", "seats");
  f.forbid("zone:stage", "zone:bar", "zone:lounge", "empty");
  f.forbidZones("stage", "bar", "lounge");
  return f;
}

// ---------------------------------------------------------------------------
// A8 — LARGE VENUE
//
// Hypothesis under test: everything measured so far was measured on 46 tables.
// The relationship pass compares chairs against tables, the scene graph
// compares group members pairwise, and the zone pass single-links across all
// furniture — all of which are quadratic in something. This is the plan where
// that stops being free.
//
// It is also the fixture that exposes the detector's MAX_TABLES cap, which has
// never been reached by any plan in the corpus.
// ---------------------------------------------------------------------------
function a8LargeVenue() {
  const f = new Fixture({
    id: "a8-large-venue", W: 2600, H: 2470, matchToleranceP: 1.0,
    hypothesis: "Every measurement in this repository was taken on 46 tables. At 324 tables and 3,240 seats the " +
      "relationship pass, the scene graph, the zone clustering and the review queue must all still complete, and the " +
      "detector's internal table cap must be visible rather than silently truncating the plan.",
    notes: "Four quadrants of 81 round tables, ten seats each, separated by service aisles. 324 tables, 3,240 seats.",
    performance: { note: "recorded, not asserted — the first run establishes what this costs" },
  });
  f.wall("room", 30, 30, 2540, 2410);
  f.text("title", 60, 50, "ARENA — FULL BANQUET", 34, "bold");

  const quadrants = [[110, 190], [1420, 190], [110, 1420], [1420, 1420]];
  let n = 0;
  const zoneMembers = [[], [], [], []];
  quadrants.forEach(([qx, qy], qi) => {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      n++;
      const id = `T${String(n).padStart(3, "0")}`;
      const cx = qx + 65 + c * 130, cy = qy + 60 + r * 130;
      f.table({ id, type: "round", cx, cy, w: 58, h: 58, seats: 10 });
      f.chairRing({ tableId: id, cx, cy, radius: 42, count: 10, size: 17, style: "filled",
        family: "arena-chair", colour: SEAT });
      zoneMembers[qi].push(id);
    }
  });
  zoneMembers.forEach((ids, i) => f.zone({ id: `z-q${i + 1}`, type: "dining", memberIds: ids }));
  f.expect("tableCount", "seats", "zone:dining");
  f.forbid("zone:stage", "zone:bar", "zone:lounge", "empty");
  f.forbidZones("stage", "bar", "lounge");
  return f;
}

// ---------------------------------------------------------------------------
// Rendering: one interpreter for the op list, so a fixture's drawing code and
// its ground truth cannot be edited apart.
// ---------------------------------------------------------------------------
async function render(page, f) {
  return page.evaluate(({ ops, W, H }) => {
    const cvs = document.createElement("canvas");
    cvs.width = W; cvs.height = H;
    const x = cvs.getContext("2d");
    x.textBaseline = "top";
    for (const o of ops) {
      switch (o.t) {
        case "paper": x.fillStyle = o.fill; x.fillRect(0, 0, W, H); break;
        case "rect":
          x.save();
          if (o.rotation) { x.translate(o.rcx, o.rcy); x.rotate((o.rotation * Math.PI) / 180); x.translate(-o.rcx, -o.rcy); }
          if (o.fill) { x.fillStyle = o.fill; x.fillRect(o.x, o.y, o.w, o.h); }
          if (o.stroke) { x.strokeStyle = o.stroke; x.lineWidth = o.lw || 1; x.strokeRect(o.x, o.y, o.w, o.h); }
          x.restore();
          break;
        case "circle":
          x.beginPath(); x.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
          if (o.fill) { x.fillStyle = o.fill; x.fill(); }
          if (o.stroke) { x.strokeStyle = o.stroke; x.lineWidth = o.lw || 1; x.stroke(); }
          break;
        case "line":
          x.strokeStyle = o.stroke; x.lineWidth = o.lw || 1;
          x.beginPath(); x.moveTo(o.x1, o.y1); x.lineTo(o.x2, o.y2); x.stroke();
          break;
        case "arc":
          x.strokeStyle = o.stroke; x.lineWidth = o.lw || 1;
          x.beginPath(); x.arc(o.cx, o.cy, o.r, o.a0, o.a1, !!o.ccw); x.stroke();
          break;
        case "hatch":
          x.save(); x.beginPath(); x.rect(o.x, o.y, o.w, o.h); x.clip();
          x.strokeStyle = o.stroke; x.lineWidth = o.lw || 1;
          for (let i = -o.h; i < o.w; i += o.step) {
            x.beginPath(); x.moveTo(o.x + i, o.y + o.h); x.lineTo(o.x + i + o.h, o.y); x.stroke();
          }
          x.restore();
          break;
        case "text":
          x.fillStyle = o.fill; x.font = `${o.weight} ${o.size}px sans-serif`; x.fillText(o.s, o.x, o.y);
          break;
        case "chair": {
          const s = o.size, half = s / 2;
          x.save(); x.translate(o.cx, o.cy);
          if (o.style === "backrest") x.rotate((o.backDeg * Math.PI) / 180);
          if (o.style === "filled") { x.fillStyle = o.colour; x.fillRect(-half, -half, s, s); }
          else { x.fillStyle = "#ffffff"; x.fillRect(-half, -half, s, s); }
          x.strokeStyle = "#1d2126"; x.lineWidth = 1.4; x.strokeRect(-half, -half, s, s);
          // The backrest: a heavy bar on the edge the sitter's back is against,
          // which is the only asymmetry in this drawing vocabulary and the only
          // thing from which a facing direction can honestly be derived.
          if (o.style === "backrest") {
            x.fillStyle = o.colour;
            x.fillRect(half - s * 0.26, -half, s * 0.26, s);
          }
          x.restore();
          break;
        }
        default: throw new Error(`unknown op ${o.t}`);
      }
    }
    return cvs.toDataURL("image/png");
  }, { ops: f.ops, W: f.W, H: f.H });
}

function write(f, dataUrl) {
  const png = Buffer.from(dataUrl.split(",")[1], "base64");
  fs.writeFileSync(path.join(ROOT, "fixtures", `${f.id}.png`), png);
  const sha = crypto.createHash("sha256").update(png).digest("hex");

  const tables = f.objects.filter(o => o.class === "table");
  const chairs = f.objects.filter(o => o.class === "chair");
  const decl = {
    planId: f.id,
    kind: "synthetic-adversarial",
    // Repeated in the artefact itself so a number lifted out of this file
    // cannot be quoted as a real-venue result by someone reading only the JSON.
    realVenue: false,
    notRealVenueNote: "SYNTHETIC ADVERSARIAL FIXTURE — not a real venue. Does not count toward REAL DISTINCT VENUE " +
      "PLANS, is never used to train the learned encoder, and its scores are never mixed into real-plan aggregates.",
    hypothesis: f.hypothesis,
    notes: f.notes,
    source: { file: `adversarial/fixtures/${f.id}.png`, width: f.W, height: f.H, sha256: sha },
    annotationMethod: "constructed — generated by benchmarks/adversarial/make-fixtures.mjs, so every object box, every " +
      "chair-to-table relation and every orientation is the exact geometry that was drawn rather than a measurement " +
      "of it. Regenerating the fixture regenerates the ground truth; the sha256 detects a swapped image.",
    matchToleranceP: f.matchToleranceP,
    objects: f.objects,
    regions: f.regions,
    relationships: f.relationships,
    expectedZones: f.expectedZones,
    expectedFacts: f.expectedFacts,
    forbiddenFacts: f.forbiddenFacts,
    forbiddenZoneTypes: f.forbiddenZoneTypes,
    minTableTypes: f.minTableTypes,
    performance: f.performance,
    capacity: {
      annotatedChairs: chairs.length,
      ocrStated: null,
      unverified: [],
      note: "Constructed: one annotated chair per seat marker actually drawn.",
    },
  };
  fs.writeFileSync(path.join(ROOT, "declarations", `${f.id}.json`), JSON.stringify(decl, null, 2) + "\n");

  const amb = f.relationships.filter(r => !r.belongsTo).length;
  const oriented = f.objects.filter(o => o.class === "chair" && o.orientationKnown).length;
  console.log(`${f.id}.png  ${f.W}x${f.H}  sha ${sha.slice(0, 12)}`);
  console.log(`  ${tables.length} tables (${[...new Set(tables.map(t => t.type))].join("/")}), ${chairs.length} chairs, ` +
    `${f.relationships.length - amb} scoreable relations + ${amb} deliberately ambiguous, ${oriented} with known facing`);
  console.log(`  ${f.regions.length} regions, ${f.expectedZones.length} expected zones, ` +
    `${f.expectedFacts.length} expected / ${f.forbiddenFacts.length} forbidden facts`);
}

const builders = [a1ChairUnderTable, a2MixedFamilies, a3NoSemanticAnchors, a4MultiRoom,
  a5ArchitectureOnly, a6ArchitecturalConfusion, a7DenseOverlap, a8LargeVenue];

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
for (const build of builders) {
  const f = build();
  write(f, await render(page, f));
}
await browser.close();
console.log("\nSYNTHETIC ADVERSARIAL FIXTURES — NOT REAL VENUES. REAL DISTINCT VENUE PLANS: 1.");
