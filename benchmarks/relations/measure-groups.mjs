#!/usr/bin/env node
// Pushed-together tables, scored on generated plans whose groups are known by
// construction: `logicalGroups` (one dining unit) and, on the relation scenes
// of training/synth_relations.py, `separateNeighbours` (two tables standing
// close with an aisle between them — the hard negative).
//
//   node benchmarks/relations/measure-groups.mjs --dir D [--dir D ...] [--out FILE]
//
// ORACLE: the product's grouping rule (src/plan-intel-groups.js, unchanged,
// loaded as the browser loads it) runs on the TRUE table boxes, written the way
// the detector writes a table (percent of the sheet, the unrotated box around
// the centre plus its rotation in (-45, 45]). What is measured is the relation
// component alone — a missed or invented table cannot make the rule look better
// or worse than it is. End to end on detected tables is a different number.
//
// What is counted, per level, per split and per scene kind:
//   EXACT        a true group whose members the rule joined, and nothing else
//   SPLIT        the rule joined some of them, or none of them to each other
//   OVER_MERGED  the rule joined a member to a table outside the group
//   proximity    a pair of separate neighbours the rule put in one group —
//                "close together" taken as "pushed together", the failure the
//                rule exists to refuse
//   spurious     a group made only of tables that belong to no true group
//
// Objects the generator marks `ignore` (cut by the sheet's edge, under glare,
// a legend's sample) are left out, as the detector's scoring leaves them out.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const dirs = argv.flatMap((a, i) => a === "--dir" ? [argv[i + 1]] : []);
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null;
// --rule FILE: score a candidate version of plan-intel-groups.js before it replaces the real one
const ruleIdx = argv.indexOf("--rule");
const RULE = ruleIdx >= 0 ? path.resolve(argv[ruleIdx + 1]) : path.join(ROOT, "src/plan-intel-groups.js");
if (!dirs.length) { console.error("usage: measure-groups.mjs --dir DIR [--dir DIR ...] [--out FILE]"); process.exit(2); }

// The rule as the page runs it: the same two files, in a context with the one
// helper they reach for (uid).
const ctx = vm.createContext({ uid: (p) => `${p}-${Math.random().toString(36).slice(2, 8)}` });
for (const f of [path.join(ROOT, "src/plan-intel-geometry.js"), RULE]) vm.runInContext(fs.readFileSync(f, "utf8"), ctx);
const GROUPS = ctx.MeritPlanIntelGroups;
if (!GROUPS || typeof GROUPS.buildFurnitureGroups !== "function") { console.error("MeritPlanIntelGroups.buildFurnitureGroups did not load"); process.exit(2); }

// A true table as the detector writes one (plan-detection-tables.js
// toPercentBox + rotation): the unrotated box around the centre, in percent of
// each axis, rotation kept in (-45, 45] with the sides swapped past 45.
function asCandidate(o, W, H, symbol) {
  let w = o.w, h = o.h, rot = ((o.rotation || 0) % 180 + 180) % 180;
  if (rot > 135) rot -= 180;
  else if (rot > 45) { rot -= 90; [w, h] = [h, w]; }
  return { id: o.id, kind: "table", type: o.type || "round", rotation: rot, symbolFamily: symbol,
    x: (o.cx - w / 2) / W * 100, y: (o.cy - h / 2) / H * 100, w: w / W * 100, h: h / H * 100 };
}

const key = (a) => [...a].sort().join(",");
const blank = () => ({ plans: 0, groups: 0, exact: 0, split: 0, overMerged: 0, notGrouped: 0, separatePairs: 0, proximityMerged: 0, spurious: 0, spuriousTables: 0, tables: 0 });
const add = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k]; };
const byLevel = {}, bySplit = {}, byScene = {}, all = blank(), rows = [];

for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "index.json").sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!d.source || !Array.isArray(d.objects)) continue;
    const W = d.source.width, H = d.source.height;
    const seated = new Set((d.relationships || []).filter((r) => r.chair && r.belongsTo).map((r) => r.belongsTo));
    const tables = d.objects.filter((o) => o.class === "table" && !o.ignore);
    const ids = new Set(tables.map((t) => t.id));
    // A bare round table with no chairs drawn is the symbol a numbered sheet
    // uses (the analysis marks those `symbolFamily`).
    const cands = tables.map((t) => asCandidate(t, W, H, (t.type || "round") === "round" && !seated.has(t.id)));
    const det = GROUPS.buildFurnitureGroups(cands, [], { aspect: W / H }).filter((g) => g.memberIds.length >= 2).map((g) => g.memberIds);
    const truth = (d.logicalGroups || []).map((g) => g.members.filter((m) => ids.has(m))).filter((m) => m.length >= 2);
    const inTruth = new Set(truth.flat());
    const detKeys = new Set(det.map(key));
    const r = blank();
    r.plans = 1; r.tables = tables.length; r.groups = truth.length;
    const sceneOf = new Map((d.logicalGroups || []).map((g) => [key(g.members.filter((m) => ids.has(m))), g.scene || "plan"]));
    const together = (a, b) => det.some((dg) => dg.includes(a) && dg.includes(b));
    for (const g of truth) {
      const s = byScene[sceneOf.get(key(g)) || "plan"] ||= blank();
      s.groups++;
      if (detKeys.has(key(g))) { r.exact++; s.exact++; continue; }
      const touching = det.filter((dg) => dg.some((m) => g.includes(m)));
      if (!touching.length) { r.notGrouped++; s.notGrouped++; }
      else if (touching.some((dg) => dg.some((m) => !g.includes(m)))) { r.overMerged++; s.overMerged++; }
      else { r.split++; s.split++; }
    }
    for (const n of d.separateNeighbours || []) {
      const [a, b] = n.members;
      if (!ids.has(a) || !ids.has(b)) continue;
      const s = byScene[n.scene || "plan"] ||= blank();
      r.separatePairs++; s.separatePairs++;
      if (together(a, b)) { r.proximityMerged++; s.proximityMerged++; }
    }
    for (const dg of det) if (dg.every((m) => !inTruth.has(m))) { r.spurious++; r.spuriousTables += dg.length; }
    const lv = `L${d.level}`, sp = (d.split && d.split.set) || "?";
    add(byLevel[lv] ||= blank(), r); add(bySplit[sp] ||= blank(), r); add(all, r);
    if (r.groups !== r.exact || r.spurious || r.proximityMerged) rows.push({ plan: d.planId, level: d.level, split: sp, ...r });
  }
}

const rate = (s) => ({ ...s, exactRate: s.groups ? +(s.exact / s.groups).toFixed(3) : null,
  proximityRate: s.separatePairs ? +(s.proximityMerged / s.separatePairs).toFixed(3) : null,
  spuriousPer100Tables: s.tables ? +(100 * s.spurious / s.tables).toFixed(2) : null });
const report = {
  what: "src/plan-intel-groups.js buildFurnitureGroups on TRUE table boxes (oracle) — the relation rule alone, not detection",
  dirs: dirs.map((x) => path.resolve(x)),
  all: rate(all),
  byLevel: Object.fromEntries(Object.entries(byLevel).sort().map(([k, v]) => [k, rate(v)])),
  bySplit: Object.fromEntries(Object.entries(bySplit).sort().map(([k, v]) => [k, rate(v)])),
  byScene: Object.fromEntries(Object.entries(byScene).sort().map(([k, v]) => [k, rate(v)])),
  failures: rows.slice(0, 200),
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
const line = (n, s) => console.log(`${n.padEnd(11)} plans ${String(s.plans).padStart(4)}  groups ${String(s.groups).padStart(4)}  exact ${String(s.exact).padStart(4)} (${s.exactRate ?? "—"})  split ${s.split}  over ${s.overMerged}  none ${s.notGrouped}  close-but-separate ${s.proximityMerged}/${s.separatePairs} merged  spurious ${s.spurious}`);
line("ALL", report.all);
for (const [k, v] of Object.entries(report.byLevel)) line(k, v);
for (const [k, v] of Object.entries(report.bySplit)) line(k, v);
for (const [k, v] of Object.entries(report.byScene)) line(k, v);
