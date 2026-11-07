#!/usr/bin/env node
// Pushed-together tables END TO END: the real app analyses each generated
// relation plan (training/synth_relations.py) — detection, OCR, the local
// detector, plan intelligence — and the dining units it offers are scored
// against the plan's `logicalGroups` and `separateNeighbours`.
//
//   node benchmarks/relations/measure-groups-e2e.mjs --dir D [--limit N] [--out FILE] [--root CHECKOUT]
//
// --root serves another checkout of the app (a worktree of the previous
// commit), so a before/after pair is the same plans through two builds.
//
// measure-groups.mjs scores the grouping rule on TRUE boxes; this scores what
// an operator is shown, so a table the detector missed, split or invented
// counts here. A true table is matched to the offered table whose centre is
// nearest and within half the true table's side; a true group is EXACT only
// when every member is matched and the offered unit is exactly those tables.
// A unit that holds every member plus a detection matched to NO true table (a
// duplicate box or a fragment of one of them) is WITH_EXTRA — a detection
// artifact carried into the unit, counted apart from OVER_MERGED, which is a
// real table from outside the group joined to it.
//
// OCR is served from the pinned .vendor-cache and the network is refused
// (tests/lib/env.mjs), as in every benchmark here.
import fs from "node:fs";
import path from "node:path";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, startStaticServer } from "../../tests/lib/server.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../../tests/lib/app-actions.mjs";

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const dirs = argv.flatMap((a, i) => a === "--dir" ? [argv[i + 1]] : []);
const LIMIT = Number(opt("--limit")) || Infinity;
const OUT = opt("--out");
const ROOT_DIR = opt("--root");
if (!dirs.length) { console.error("usage: measure-groups-e2e.mjs --dir DIR [--limit N] [--out FILE]"); process.exit(2); }

const plans = dirs.flatMap((d) => fs.readdirSync(d).filter((n) => n.endsWith(".json") && n !== "index.json").sort().slice(0, LIMIT).map((n) => path.join(d, n)));
const app = ROOT_DIR ? await startStaticServer({ root: path.resolve(ROOT_DIR) }) : await serveApp();
const browser = await launchChromium();
const key = (a) => [...a].sort().join(",");
const blank = () => ({ plans: 0, tables: 0, matched: 0, groups: 0, exact: 0, split: 0, overMerged: 0, notGrouped: 0, membersMissing: 0, withExtra: 0, separatePairs: 0, proximityMerged: 0, scoredPairs: 0 });
const add = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k]; };
const all = blank(), byScene = {}, rows = [];

for (const file of plans) {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const W = d.source.width, H = d.source.height;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page, app.baseUrl);
  await createBlankEvent(page, { name: "Relations", date: futureDate() });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(path.dirname(file), d.source.file)).toString("base64"));
  const t0 = Date.now();
  await runDetection(page, { timeout: 300000 });
  const ms = Date.now() - t0;
  const out = await page.evaluate(() => {
    const a = state.events[0].analysis;
    return {
      tables: a.candidates.filter((c) => c.kind === "table" && c.status !== "rejected").map((c) => ({ id: c.id, cx: c.x + c.w / 2, cy: c.y + c.h / 2, rotation: c.rotation || 0 })),
      groups: (a.planIntelligence && a.planIntelligence.furnitureGroups || []).map((g) => g.memberIds),
    };
  });
  await page.close();

  // match true tables to offered ones, nearest first
  const gt = d.objects.filter((o) => o.class === "table" && !o.ignore);
  const pairs = [];
  for (const g of gt) for (const t of out.tables) {
    const dist = Math.hypot(t.cx / 100 * W - g.cx, t.cy / 100 * H - g.cy);
    if (dist <= Math.min(g.w, g.h) / 2) pairs.push({ g: g.id, t: t.id, dist });
  }
  pairs.sort((a, b) => a.dist - b.dist);
  const g2t = new Map(), usedT = new Set();
  for (const p of pairs) if (!g2t.has(p.g) && !usedT.has(p.t)) { g2t.set(p.g, p.t); usedT.add(p.t); }
  const matchedT = new Set(g2t.values());
  const unitOf = new Map();
  for (const ids of out.groups) for (const id of ids) unitOf.set(id, key(ids));
  const r = blank();
  r.plans = 1; r.tables = gt.length; r.matched = g2t.size;
  const ids = new Set(gt.map((o) => o.id));
  for (const grp of d.logicalGroups || []) {
    const members = grp.members.filter((m) => ids.has(m));
    if (members.length < 2) continue;
    const s = byScene[grp.scene || "plan"] ||= blank();
    r.groups++; s.groups++;
    const det = members.map((m) => g2t.get(m));
    if (det.some((x) => !x)) { r.membersMissing++; s.membersMissing++; continue; }
    const units = new Set(det.map((x) => unitOf.get(x) || x));
    if (units.size === 1 && [...units][0] === key(det)) { r.exact++; s.exact++; continue; }
    const unitMembers = [...units].flatMap((u) => u.split(","));
    const foreign = unitMembers.filter((x) => !det.includes(x));
    if (foreign.length && foreign.some((x) => matchedT.has(x))) { r.overMerged++; s.overMerged++; }
    else if (foreign.length && units.size === 1) { r.withExtra++; s.withExtra++; }
    else if (units.size === det.length) { r.notGrouped++; s.notGrouped++; }
    else { r.split++; s.split++; }
  }
  for (const n of d.separateNeighbours || []) {
    const [a, b] = n.members.map((m) => g2t.get(m));
    const s = byScene[n.scene || "plan"] ||= blank();
    r.separatePairs++; s.separatePairs++;
    if (!a || !b) continue;
    r.scoredPairs++; s.scoredPairs++;
    if (unitOf.get(a) && unitOf.get(a) === unitOf.get(b)) { r.proximityMerged++; s.proximityMerged++; }
  }
  add(all, r);
  const t2g = new Map([...g2t].map(([g, tt]) => [tt, g]));
  rows.push({ plan: d.planId, ms, pageErrors: errors.length, ...r,
    units: out.groups.filter((u) => u.length > 1).map((u) => u.map((id) => t2g.get(id) || "unmatched")) });
  console.log(`${d.planId.padEnd(34)} tables ${r.matched}/${r.tables}  groups exact ${r.exact}/${r.groups} (missing member ${r.membersMissing}, split ${r.split}, none ${r.notGrouped}, over ${r.overMerged}, +extra ${r.withExtra})  close-but-separate merged ${r.proximityMerged}/${r.scoredPairs}  ${(ms / 1000).toFixed(1)} s${errors.length ? `  PAGE ERRORS ${errors.length}` : ""}`);
}
await browser.close();
await app.close();

const rate = (s) => ({ ...s, tableRecall: s.tables ? +(s.matched / s.tables).toFixed(3) : null, exactRate: s.groups ? +(s.exact / s.groups).toFixed(3) : null,
  exactOfFullyDetected: s.groups - s.membersMissing ? +(s.exact / (s.groups - s.membersMissing)).toFixed(3) : null,
  proximityRate: s.scoredPairs ? +(s.proximityMerged / s.scoredPairs).toFixed(3) : null });
const report = { what: "relation plans analysed by the real app; offered dining units scored against logicalGroups / separateNeighbours", dirs, all: rate(all),
  byScene: Object.fromEntries(Object.entries(byScene).sort().map(([k, v]) => [k, rate(v)])), plans: rows };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
console.log("ALL", JSON.stringify(report.all));
for (const [k, v] of Object.entries(report.byScene)) console.log(k.padEnd(11), `exact ${v.exact}/${v.groups} (of fully detected ${v.exactOfFullyDetected ?? "—"})  missing ${v.membersMissing}  over ${v.overMerged}  +extra ${v.withExtra}  none ${v.notGrouped}  close-but-separate merged ${v.proximityMerged}/${v.scoredPairs}`);
