// THE PLANNER'S LAYOUT ENGINE — numbers in, an arrangement out.
//
// The AI planner (benchmarks/AI-PLANNER-DESIGN.md) lets a person describe an
// event in words; a model turns the words into a BRIEF (numbers only) and this
// module turns the brief into tables, chairs and totals. The model never draws
// and never adds up: every position, every seat count and every total below is
// computed here, so the numbers always agree with each other.
//
// Pure: reads no `state`, no `ui`, calls no `render()`. Metres, origin at the
// room's top-left corner, the stage (when there is one) along the top wall.
// It never writes an event; the planner window applies a chosen option through
// the app's own writers (one undo step).
//
// Defaults are the common conservative figures (§4 of the design) and every one
// can be overridden by the brief. They are planning defaults, not a fire code:
// the window says "check with the venue".
(function () {
  "use strict";
  const DEFAULTS = {
    chairDepth: 0.5, chairWidth: 0.5, pushBack: 0.1,  // a chair and the room to pull it out
    chairGap: 0.9,      // chair back to chair back between two tables
    wallGap: 0.6,       // free strip along every wall, beyond the chairs
    mainAisle: 1.2, stageGap: 1.5,
    rowPitch: 0.9,      // theatre: one row of chairs plus the passage in front of it
    seatsPerRowMax: 14, // theatre / classroom: a person never passes more than 7 to reach an aisle
    cocktailM2: 0.8,    // standing, per person
  };
  const ROUND_SEATS = [[150, 8], [160, 8], [180, 10], [200, 12]];
  const roundSeats = (dCm) => { let s = 8; for (const [d, n] of ROUND_SEATS) if (dCm >= d) s = n; return s; };
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

  function room(brief) {
    let w = num(brief.room_w_m), l = num(brief.room_l_m);
    if (!(w && l) && num(brief.area_m2)) { const a = brief.area_m2; w = Math.sqrt(a / 1.5); l = a / w; }  // unknown shape: a 2:3 rectangle, said as such
    if (!(w && l)) return null;
    return { w: Math.min(w, l), l: Math.max(w, l), assumedShape: !(num(brief.room_w_m) && num(brief.room_l_m)) };
  }

  // Rows and columns of identical footprints in a free rectangle, centred.
  function grid(x0, y0, w, h, fw, fh, pitchX, pitchY, max) {
    const cols = Math.max(0, Math.floor((w - fw) / pitchX) + 1), rows = Math.max(0, Math.floor((h - fh) / pitchY) + 1);
    if (fw > w || fh > h) return [];
    const usedW = (cols - 1) * pitchX + fw, usedH = (rows - 1) * pitchY + fh;
    const ox = x0 + (w - usedW) / 2 + fw / 2, oy = y0 + (h - usedH) / 2 + fh / 2, out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (out.length < max) out.push({ x: ox + c * pitchX, y: oy + r * pitchY });
    return out;
  }

  // Round tables also pack staggered: every other row shifted half a pitch,
  // rows closer by √3/2 — neighbours stay exactly one pitch apart.
  function stagger(x0, y0, w, h, foot, pitch, max) {
    if (foot > w || foot > h) return [];
    const py = pitch * Math.sqrt(3) / 2, rows = Math.floor((h - foot) / py) + 1, out = [];
    const colsEven = Math.floor((w - foot) / pitch) + 1, colsOdd = Math.floor((w - foot - pitch / 2) / pitch) + 1;
    const usedH = (rows - 1) * py + foot, oy = y0 + (h - usedH) / 2 + foot / 2;
    const usedW = Math.max((colsEven - 1) * pitch, (colsOdd - 1) * pitch + pitch / 2) + foot, ox = x0 + (w - usedW) / 2 + foot / 2;
    for (let r = 0; r < rows; r++) {
      const odd = r % 2, cols = odd ? colsOdd : colsEven;
      for (let c = 0; c < cols && out.length < max; c++) out.push({ x: ox + (odd ? pitch / 2 : 0) + c * pitch, y: oy + r * py });
    }
    return out;
  }

  function freeArea(R, brief, d) {
    const top = d.wallGap + (brief.stage ? (num(brief.stage.depth_m) || 3) + d.stageGap : 0);
    return { x: d.wallGap, y: top, w: R.w - 2 * d.wallGap, h: R.l - top - d.wallGap };
  }

  function roundTables(R, brief, d, need) {
    const dCm = num(brief.table_diam_cm) || 180, dm = dCm / 100;
    const seats = num(brief.seats_per_table) || roundSeats(dCm);
    const foot = dm + 2 * (d.chairDepth + d.pushBack), pitch = foot + d.chairGap - 2 * d.pushBack;
    const F = freeArea(R, brief, d);
    const sq = grid(F.x, F.y, F.w, F.h, foot, foot, pitch, pitch, need), st = stagger(F.x, F.y, F.w, F.h, foot, pitch, need);
    return (st.length > sq.length ? st : sq).map((p) => ({ kind: "round", x: p.x, y: p.y, d: dm, foot, seats }));
  }

  function rectTables(R, brief, d, need, defSeats) {
    const L = (num(brief.table_len_cm) || 180) / 100, W = (num(brief.table_wid_cm) || 60) / 100;
    const seats = num(brief.seats_per_table) || defSeats(L);
    const fw = L, fh = W + d.chairDepth + d.pushBack;                       // chairs on one side, facing front
    const F = freeArea(R, brief, d);
    const half = (F.w - d.mainAisle) / 2, out = [];
    const pitchY = fh + Math.max(0.6, d.chairGap - 0.3);
    for (const x0 of [F.x, F.x + half + d.mainAisle]) {                      // two blocks either side of a centre aisle
      for (const p of grid(x0, F.y, half, F.h, fw, fh, fw + 0.05, pitchY, need - out.length)) out.push({ kind: "rect", x: p.x, y: p.y, w: L, h: W, foot: [fw, fh], seats });
    }
    return out;
  }

  function theatre(R, brief, d, need) {
    const F = freeArea(R, brief, d), cw = num(brief.chair_w_cm) ? brief.chair_w_cm / 100 : d.chairWidth;
    const perBlock = Math.min(d.seatsPerRowMax, Math.floor(((F.w - d.mainAisle) / 2) / cw));
    const rows = Math.floor((F.h + (d.rowPitch - d.chairDepth)) / d.rowPitch), out = [];
    const blockW = perBlock * cw, left = F.x + (F.w - (2 * blockW + d.mainAisle)) / 2;
    for (let r = 0; r < rows && out.length < need; r++) {
      [left, left + blockW + d.mainAisle].forEach((bx, block) => {
        for (let i = 0; i < perBlock && out.length < need; i++) out.push({ kind: "chair", x: bx + cw * (i + 0.5), y: F.y + d.chairDepth / 2 + r * d.rowPitch, w: cw, h: d.chairDepth, seats: 1, row: r, block });
      });
    }
    return out;
  }

  function cocktail(R, brief, d, need) {
    const F = freeArea(R, brief, d), cap = Math.floor((F.w * F.h) / d.cocktailM2);
    const per = num(brief.seats_per_table) || 4, tablesWanted = num(brief.table_count) || Math.ceil(Math.min(need, cap) / 8);
    const pts = grid(F.x, F.y, F.w, F.h, 0.6, 0.6, 2.4, 2.4, tablesWanted);
    return { items: pts.map((p) => ({ kind: "bistro", x: p.x, y: p.y, d: 0.6, foot: 0.6, seats: 0, standing: per })), standingCapacity: cap };
  }

  function uShape(R, brief, d, need) {
    const F = freeArea(R, brief, d), W = (num(brief.table_wid_cm) || 60) / 100, per = 0.6;  // 60 cm a person, outer edge only
    const sideMax = F.h - (W + d.chairDepth + d.pushBack), baseMax = F.w - 2 * (W + d.chairDepth + d.pushBack);
    const seatsSide = Math.max(0, Math.floor(sideMax / per)), seatsBase = Math.max(0, Math.floor(baseMax / per));
    let a = Math.min(seatsSide, Math.ceil(need / 3)), b = Math.min(seatsBase, need - 2 * a);
    if (b < 0) b = 0;
    const x0 = F.x + d.chairDepth + d.pushBack, y0 = F.y + d.chairDepth + d.pushBack, len = a * per, base = Math.max(b * per, 1.2);
    return [
      { kind: "rect", x: x0 + W / 2, y: y0 + len / 2, w: W, h: len, seats: a },
      { kind: "rect", x: x0 + W + base + W / 2, y: y0 + len / 2, w: W, h: len, seats: a },
      { kind: "rect", x: x0 + W + base / 2, y: y0 + len - W / 2, w: base, h: W, seats: b },
    ].filter((t) => t.seats > 0);
  }

  function boardroom(R, brief, d, need) {
    const F = freeArea(R, brief, d), W = 1.2, per = 0.65, ends = 2;
    const along = Math.ceil(Math.max(0, need - ends) / 2), L = Math.max(1.8, along * per);
    const fits = L + 2 * (d.chairDepth + d.pushBack) <= F.h && W + 2 * (d.chairDepth + d.pushBack) <= F.w;
    return fits ? [{ kind: "rect", x: F.x + F.w / 2, y: F.y + F.h / 2, w: W, h: L, seats: 2 * along + ends }] : [];
  }

  // The brief is the parser's JSON (planner_brief_eval.py shape) plus optional
  // `stage: {depth_m}`. Returns the arrangement for the brief's event type and
  // the arithmetic a person needs to judge it; never throws on a short brief.
  function plan(brief, overrides) {
    const d = Object.assign({}, DEFAULTS, overrides || {});
    const R = room(brief || {});
    const pax = num(brief && brief.pax);
    if (!R) return { ok: false, missing: ["room"], ask: "room size (m² or width × length)" };
    if (!pax) return { ok: false, missing: ["pax"], ask: "how many people" };
    const ev = brief.event || "banquet";
    let items = [], standing = 0;
    if (ev === "theatre") items = theatre(R, brief, d, pax);
    else if (ev === "classroom") items = rectTables(R, brief, d, num(brief.table_count) || Math.ceil(pax / (num(brief.seats_per_table) || 3)), (L) => Math.max(1, Math.floor(L / 0.6)));
    else if (ev === "u_shape") items = uShape(R, brief, d, pax);
    else if (ev === "boardroom") items = boardroom(R, brief, d, pax);
    else if (ev === "cocktail") { const c = cocktail(R, brief, d, pax); items = c.items; standing = c.standingCapacity; }
    else if (brief.table_kind === "rect" || brief.table_kind === "square") items = rectTables(R, brief, d, num(brief.table_count) || Math.ceil(pax / (num(brief.seats_per_table) || 8)), () => 8);
    else items = roundTables(R, brief, d, num(brief.table_count) || Math.ceil(pax / (num(brief.seats_per_table) || roundSeats(num(brief.table_diam_cm) || 180))));
    const seated = items.reduce((s, t) => s + (t.seats || 0), 0);
    const capacity = ev === "cocktail" ? standing : seated;
    const area = R.w * R.l, notes = [];
    if (R.assumedShape) notes.push("room shape assumed (2:3 rectangle) — give width × length for a real layout");
    if (capacity < pax) notes.push(`fits ${capacity} of ${pax}`);
    if (num(brief.table_count) && ev !== "cocktail" && items.length < brief.table_count) notes.push(`${items.length} of ${brief.table_count} tables fit`);
    return { ok: true, event: ev, room: R, items, capacity, pax, fits: capacity >= pax, m2PerPerson: +(area / pax).toFixed(2), notes, defaults: d };
  }

  // Two items overlap when their footprints (chairs included) intersect; two
  // round tables are circles.
  function overlaps(a, b) {
    if (a.kind === "round" && b.kind === "round") return Math.hypot(a.x - b.x, a.y - b.y) < (a.foot + b.foot) / 2 - 1e-6;
    const box = (t) => { const f = t.foot; const w = Array.isArray(f) ? f[0] : f || t.w, h = Array.isArray(f) ? f[1] : f || t.h; return [t.x - w / 2, t.y - h / 2, t.x + w / 2, t.y + h / 2]; };
    const A = box(a), B = box(b), eps = 1e-6;
    return A[0] < B[2] - eps && B[0] < A[2] - eps && A[1] < B[3] - eps && B[1] < A[3] - eps;
  }

  // A theatre arrangement's chairs as the rows the floor plan draws: one row per
  // block per line, as long as its chairs. Empty for any other arrangement.
  function rows(p) {
    const by = new Map();
    for (const c of (p && p.items) || []) if (c.kind === "chair" && Number.isInteger(c.row)) {
      const k = c.row + ":" + c.block;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(c);
    }
    return [...by.values()].map((cs) => {
      const x0 = Math.min(...cs.map((c) => c.x - c.w / 2)), x1 = Math.max(...cs.map((c) => c.x + c.w / 2));
      return { kind: "row", x: (x0 + x1) / 2, y: cs[0].y, w: x1 - x0, h: cs[0].h, seats: cs.length, row: cs[0].row, block: cs[0].block };
    });
  }

  const api = { plan, rows, overlaps, roundSeats, DEFAULTS };
  globalThis.MeritPlannerLayout = api;
})();
