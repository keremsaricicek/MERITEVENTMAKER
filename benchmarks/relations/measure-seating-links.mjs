#!/usr/bin/env node
// Which table does each sofa, bench and banquette serve? Scored on TRUE boxes
// (R2, 2026-10-17), the relation rule alone: a missed or invented object cannot
// make the rule look better or worse than it is. End to end on detected objects
// is measure-seating-furniture.mjs.
//
//   node benchmarks/relations/measure-seating-links.mjs --dir DIR [--dir DIR ...] [--mode rotated|oriented|envelope|fitted [--fits FILE]] [--out FILE]
//
// DIR holds `training/synth_relations.py --furniture` scenes. Two ways to hand
// the rule its boxes:
//   rotated    each piece's own box and turn, and for a sofa or banquette the
//              side its seat faces (its back is drawn on the other) — what a
//              reading that sees the back would give
//   oriented   each piece's own box and turn, front unknown — what an oriented
//              box fitted to the piece's pixels gives (no back is read)
//   envelope   each piece's axis-aligned envelope, turn 0, front unknown — what
//              the plan-symbol detector writes today
//   fitted     that envelope after MeritPlanModelFusion.orientPiece read the
//              piece's turn from its pixels — what the product writes now;
//              needs --fits FILE from measure-piece-orientation.mjs
// Tables are written as the detector writes them (turn kept in (-45, 45]).
// Chairs are given to the table whose box is nearest — a stand-in for the
// detector's own chair association, scored separately (`chairAssociation`)
// so it cannot hide inside the group number.
//
// Counted against `seatingGroups` (the furniture and chairs that serve each
// table) and `separateNeighbours` scene sofa-apart (a sofa near a table with its
// back to it — the hard negative):
//   links P/R      piece→table pairs
//   groups EXACT   a table's predicted pieces AND chairs are its true ones
//   spurious       a predicted group on a table that has no seating group
//   apartLinked    a sofa-apart sofa linked to its neighbour (target 0)
//   seats          per group: known and equal / null where the truth is null /
//                  null because a shared piece is not divided / wrong
//   room seats     every chair once plus every drawn piece seat once, against
//                  the truth's own total (double counting would exceed it)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const dirs = argv.flatMap((a, i) => a === "--dir" ? [argv[i + 1]] : []);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt("--out", null);
const MODE = opt("--mode", "rotated");
const RULE = path.resolve(opt("--rule", path.join(ROOT, "src/plan-intel-groups.js")));
if (!dirs.length || !["rotated", "oriented", "envelope", "fitted"].includes(MODE)) { console.error("usage: measure-seating-links.mjs --dir DIR [--mode rotated|oriented|envelope|fitted [--fits FILE]] [--out FILE]"); process.exit(2); }

const ctx = vm.createContext({ uid: (p) => `${p}-${Math.random().toString(36).slice(2, 8)}` });
for (const f of [path.join(ROOT, "src/plan-intel-geometry.js"), RULE]) vm.runInContext(fs.readFileSync(f, "utf8"), ctx);
const GROUPS = ctx.MeritPlanIntelGroups;
const FITS = new Map(MODE === "fitted" ? JSON.parse(fs.readFileSync(opt("--fits", ""), "utf8")).rows.map((r) => [`${r.plan}|${r.id}`, r.fitBox]) : []);
if (typeof GROUPS?.buildSeatingLinks !== "function") { console.error("MeritPlanIntelGroups.buildSeatingLinks did not load"); process.exit(2); }

const FURNITURE = new Set(["sofa", "bench", "banquette"]);
const pct = (v, S) => v / S * 100;
function asTable(o, W, H) {
  let w = o.w, h = o.h, rot = ((o.rotation || 0) % 180 + 180) % 180;
  if (rot > 135) rot -= 180;
  else if (rot > 45) { rot -= 90; [w, h] = [h, w]; }
  return { id: o.id, kind: "table", type: o.type || "round", rotation: rot, chairDetections: [],
    x: pct(o.cx - w / 2, W), y: pct(o.cy - h / 2, H), w: pct(w, W), h: pct(h, H) };
}
function asPiece(o, W, H, planId) {
  const fit = FITS.get(`${planId}|${o.id}`);
  if (fit) return { id: o.id, kind: "venue", type: o.class, seats: o.seats ?? null, seatsUnknown: o.seats == null, rotation: fit.rotation, facingDeg: null,
    x: pct(fit.cx - fit.w / 2, W), y: pct(fit.cy - fit.h / 2, H), w: pct(fit.w, W), h: pct(fit.h, H) };
  const base = { id: o.id, kind: "venue", type: o.class, seats: o.seats ?? null, seatsUnknown: o.seats == null };
  if (MODE === "rotated" || MODE === "oriented") {
    // synth_relations: a sofa's or banquette's back is on its own -v side, so
    // its seat faces +v = rotation + 90 degrees; a bench has no back
    const facingDeg = o.class === "bench" || MODE === "oriented" ? null : (o.rotation || 0) + 90;
    return { ...base, rotation: o.rotation || 0, facingDeg, x: pct(o.cx - o.w / 2, W), y: pct(o.cy - o.h / 2, H), w: pct(o.w, W), h: pct(o.h, H) };
  }
  const a = (o.rotation || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const ew = o.w * c + o.h * s, eh = o.w * s + o.h * c;
  return { ...base, rotation: 0, facingDeg: null, x: pct(o.cx - ew / 2, W), y: pct(o.cy - eh / 2, H), w: pct(ew, W), h: pct(eh, H) };
}
// distance from a point to a turned box (0 inside)
function toBox(o, x, y) {
  const a = (o.rotation || 0) * Math.PI / 180, dx = x - o.cx, dy = y - o.cy;
  const u = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) - o.w / 2, v = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) - o.h / 2;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".json") && f !== "index.json").sort().map((f) => path.join(d, f)));
const tot = { plans: 0, links: { tp: 0, fp: 0, fn: 0 }, groups: { exact: 0, of: 0, spurious: 0, wrongPieces: 0, wrongChairs: 0 },
  apart: { linked: 0, of: 0 }, seats: { equal: 0, nullTruthNull: 0, nullShared: 0, nullWrong: 0, wrong: 0 },
  room: { exact: 0, over: 0, under: 0 }, chairAssociation: { right: 0, of: 0 }, question: { asked: 0 }, byScene: {} };
const fails = [];
for (const file of files) {
  const a = JSON.parse(fs.readFileSync(file, "utf8"));
  const W = a.source.width, H = a.source.height;
  const objs = a.objects.filter((o) => !o.ignore);
  const tables = objs.filter((o) => o.class === "table").map((o) => asTable(o, W, H));
  const tById = new Map(tables.map((t) => [t.id, t]));
  const trueTable = new Map(objs.filter((o) => o.class === "table").map((o) => [o.id, o]));
  const chairTruth = new Map((a.relationships || []).filter((r) => r.chair).map((r) => [r.chair, r.belongsTo]));
  for (const c of objs.filter((o) => o.class === "chair")) {
    let best = null, bd = Infinity;
    for (const t of trueTable.values()) { const d = toBox(t, c.cx, c.cy); if (d < bd) { bd = d; best = t; } }
    if (!best) continue;
    tById.get(best.id).chairDetections.push({ id: c.id, x: pct(c.cx, W), y: pct(c.cy, H), w: pct(c.w, W), h: pct(c.h, H) });
    if (chairTruth.has(c.id)) { tot.chairAssociation.of++; if (chairTruth.get(c.id) === best.id) tot.chairAssociation.right++; }
  }
  const pieces = objs.filter((o) => FURNITURE.has(o.class)).map((o) => asPiece(o, W, H, a.planId));
  const res = GROUPS.buildSeatingLinks([...tables, ...pieces], { aspect: W / H });
  tot.plans++;
  if (res.question) tot.question.asked++;
  const pieceIds = new Set(pieces.map((p) => p.id));
  const truthLinks = new Set((a.seatingGroups || []).flatMap((g) => g.members.filter((m) => pieceIds.has(m)).map((m) => `${m}|${g.table}`)));
  const predLinks = new Set(res.links.map((l) => `${l.pieceId}|${l.tableId}`));
  for (const k of predLinks) truthLinks.has(k) ? tot.links.tp++ : (tot.links.fp++, fails.push({ plan: a.planId, falseLink: k }));
  for (const k of truthLinks) if (!predLinks.has(k)) { tot.links.fn++; fails.push({ plan: a.planId, missedLink: k }); }
  const predByTable = new Map(res.groups.map((g) => [g.tableId, g]));
  const truthTables = new Set();
  for (const g of a.seatingGroups || []) {
    truthTables.add(g.table);
    const scene = g.scene || "?";
    const s = (tot.byScene[scene] ||= { exact: 0, of: 0 });
    tot.groups.of++; s.of++;
    const p = predByTable.get(g.table) || { pieceIds: [], chairIds: [], seats: null, sharedPieces: [] };
    const wantP = g.members.filter((m) => pieceIds.has(m)).sort().join(","), gotP = [...p.pieceIds].sort().join(",");
    const wantC = g.members.filter((m) => !pieceIds.has(m)).sort().join(","), gotC = [...p.chairIds].sort().join(",");
    if (wantP === gotP && wantC === gotC) { tot.groups.exact++; s.exact++; }
    else { if (wantP !== gotP) tot.groups.wrongPieces++; if (wantC !== gotC) tot.groups.wrongChairs++; fails.push({ plan: a.planId, table: g.table, scene, wantP, gotP, wantC, gotC }); }
    if (p.seats != null) (g.seats === p.seats ? tot.seats.equal++ : tot.seats.wrong++);
    else if (g.seats == null) tot.seats.nullTruthNull++;
    else if (g.sharedSeating && p.sharedPieces.includes(g.sharedSeating)) tot.seats.nullShared++;
    else tot.seats.nullWrong++;
  }
  for (const g of res.groups) if (!truthTables.has(g.tableId)) { tot.groups.spurious++; fails.push({ plan: a.planId, spuriousGroup: g.tableId, pieces: g.pieceIds }); }
  for (const s of (a.separateNeighbours || []).filter((x) => x.scene === "sofa-apart")) {
    tot.apart.of++;
    if (predLinks.has(`${s.members[0]}|${s.members[1]}`)) tot.apart.linked++;
  }
  // room seats: every chair once + every drawn piece seat once
  const truthRoom = objs.filter((o) => o.class === "chair").length + objs.filter((o) => FURNITURE.has(o.class)).reduce((n, o) => n + (o.seats || 0), 0);
  const gotRoom = res.room.chairs + res.room.pieceSeats;
  tot.room[gotRoom === truthRoom ? "exact" : gotRoom > truthRoom ? "over" : "under"]++;
}
const r = (n, d) => d ? Math.round(n / d * 1000) / 1000 : null;
const summary = {
  mode: MODE, rule: path.relative(ROOT, RULE), dirs, ...tot,
  linkPrecision: r(tot.links.tp, tot.links.tp + tot.links.fp), linkRecall: r(tot.links.tp, tot.links.tp + tot.links.fn),
  groupExact: r(tot.groups.exact, tot.groups.of),
};
console.log(JSON.stringify(summary, null, 1));
if (fails.length) console.log(`\nfirst failures (${fails.length}):\n` + fails.slice(0, 15).map((f) => JSON.stringify(f)).join("\n"));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), summary, fails }, null, 1));
