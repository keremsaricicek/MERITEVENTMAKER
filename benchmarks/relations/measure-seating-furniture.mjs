// What does the product make of a sofa, a bench or a banquette? (R1, 2026-10-17)
//
//   node benchmarks/relations/measure-seating-furniture.mjs DIR [--out FILE] [--limit N]
//
// DIR holds `training/synth_relations.py --furniture` scenes: exact labels for
// every sofa, bench and banquette, its seats ONLY when its divisions are drawn
// (`seats: null` otherwise — "not shown", never a guess), the table each one
// serves (`seatingGroups`, a banquette shared by several tables), and sofas
// standing near a table with their back to it (`separateNeighbours`, scene
// `sofa-apart`).
//
// For every annotated piece it reports which ONE of these the product did, by
// the product objects whose centre lies inside the piece's own rotated box:
//   named        a venue object typed sofa / bench / banquette (exactType when
//                the type matches)
//   asTable      a table candidate on it — the piece read as a table
//   asChairs     chairs on it — cushions read as seats; on a piece that is ALSO
//                named this is the same seat counted twice (`doubleCounted`)
//   nothing      none of the above
// and, against ACCEPTANCE.md's seating-furniture rows (fixed 2026-10-12):
//   doubleCounted       seats on a piece counted both as chairs and as the piece   (target 0)
//   unknownAsUnknown    an undivided piece reported with seats unknown — named
//                       with `seats == null` and no chair on it                    (target 100 %)
//   groups P/R          a piece linked to the table it serves                      (target ≥ 0.95)
// The product has no piece→table link today; groups are reported as measured, 0
// when nothing links, rather than left out.
//
// Network refused, pinned OCR — the same environment as every benchmark.
import fs from "node:fs";
import path from "node:path";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import { futureDate } from "../../tests/lib/app-actions.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt("--out", null);
const LIMIT = Number(opt("--limit", 1e9));
const dir = argv.find((a, i) => !a.startsWith("--") && !["--out", "--limit"].includes(argv[i - 1]));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort().map((f) => path.join(dir, f)).slice(0, LIMIT);
const FURNITURE = new Set(["sofa", "bench", "banquette"]);

// inside the piece's own rotated box, with a margin of a fraction of its depth
function inside(piece, x, y, margin = 0.15) {
  const a = (piece.rotation || 0) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
  const dx = x - piece.cx, dy = y - piece.cy;
  const along = dx * ux + dy * uy, across = -dx * uy + dy * ux;
  const m = margin * Math.min(piece.w, piece.h);
  return Math.abs(along) <= piece.w / 2 + m && Math.abs(across) <= piece.h / 2 + m;
}

const app = await serveApp();
const browser = await launchChromium();
const plans = [];
for (const file of files) {
  const annot = JSON.parse(fs.readFileSync(file, "utf8"));
  const img = path.join(path.dirname(file), annot.source.file);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${app.baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Furniture");
  await page.fill('input[name="hotel"]', "Furniture");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(500);
  await page.evaluate((src) => { state.events[0].background = { src, name: "plan", opacity: 1, visible: true, locked: false, scale: 100 }; render(); },
    `data:image/png;base64,${fs.readFileSync(img).toString("base64")}`);
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy && state.events[0].analysis.timings && state.events[0].analysis.timings.analysisCompletedAtMs, null, { timeout: 240000 }).catch(() => {});
  const W = annot.source.width, H = annot.source.height;
  const got = await page.evaluate(({ W, H }) => {
    const a = state.events[0].analysis || {};
    const live = (a.candidates || []).filter((c) => c.status !== "rejected");
    const C = (c) => ({ x: (c.x + c.w / 2) / 100 * W, y: (c.y + c.h / 2) / 100 * H });
    return {
      representation: a.diagnostics?.representation?.kind || null,
      tables: live.filter((c) => c.kind === "table").map((c) => ({ id: c.id, ...C(c), seats: (c.chairDetections || []).length })),
      chairs: live.flatMap((c) => (c.chairDetections || []).map((s) => ({ table: c.id, x: s.x / 100 * W, y: s.y / 100 * H })))
        .concat(live.filter((c) => c.kind === "venue" && c.type === "chair").map((c) => ({ table: null, ...C(c) }))),
      furniture: live.filter((c) => c.kind === "venue" && ["sofa", "bench", "banquette"].includes(c.type))
        .map((c) => ({ id: c.id, type: c.type, ...C(c), seats: c.seats ?? null, seatsUnknown: !!c.seatsUnknown, servesTable: c.servesTable ?? c.relation?.tableId ?? null })),
    };
  }, { W, H });
  await page.close();

  const objs = annot.objects;
  const pieces = objs.filter((o) => FURNITURE.has(o.class));
  const tablesGt = objs.filter((o) => o.class === "table");
  // the product table nearest each annotated table, for the group link
  const tableMatch = new Map();
  for (const t of tablesGt) {
    let best = null, bd = Infinity;
    for (const p of got.tables) { const d = Math.hypot(p.x - t.cx, p.y - t.cy); if (d < bd) { bd = d; best = p; } }
    if (best && bd <= 0.6 * Math.max(t.w, t.h)) tableMatch.set(t.id, best.id);
  }
  const servedBy = new Map();
  for (const g of annot.seatingGroups || []) for (const m of g.members) if (pieces.some((p) => p.id === m)) {
    if (!servedBy.has(m)) servedBy.set(m, new Set());
    servedBy.get(m).add(g.table);
  }
  const apart = new Map((annot.separateNeighbours || []).filter((s) => s.scene === "sofa-apart").map((s) => [s.members[0], s.members[1]]));
  const rows = pieces.map((p) => {
    const named = got.furniture.filter((f) => inside(p, f.x, f.y));
    const asTable = got.tables.filter((t) => inside(p, t.x, t.y));
    const asChairs = got.chairs.filter((c) => inside(p, c.x, c.y));
    const outcome = named.length ? "named" : asTable.length ? "asTable" : asChairs.length ? "asChairs" : "nothing";
    const linked = new Set(named.map((f) => f.servesTable).filter(Boolean));
    const truth = servedBy.get(p.id) || new Set();
    const truthProduct = new Set([...truth].map((t) => tableMatch.get(t)).filter(Boolean));
    return {
      id: p.id, class: p.class, seats: p.seats ?? null, outcome,
      exactType: named.some((f) => f.type === p.class),
      namedSeats: named.length ? named[0].seats : undefined,
      chairsOn: asChairs.length, tablesOn: asTable.length,
      doubleCounted: named.length ? asChairs.length : 0,
      unknownAsUnknown: p.seats == null ? (named.length > 0 && named.every((f) => f.seats == null) && asChairs.length === 0) : null,
      linksTrue: [...linked].filter((t) => truthProduct.has(t)).length, linksFalse: [...linked].filter((t) => !truthProduct.has(t)).length,
      linksWanted: truthProduct.size,
      apartFrom: apart.get(p.id) || null,
      apartLinked: apart.has(p.id) ? [...linked].includes(tableMatch.get(apart.get(p.id))) : null,
    };
  });
  const tablesFound = tablesGt.filter((t) => tableMatch.has(t.id)).length;
  plans.push({ plan: annot.planId, family: annot.split?.family, representation: got.representation, errors: errors.length,
    tables: { gt: tablesGt.length, found: tablesFound, detected: got.tables.length }, rows });
  const oc = rows.reduce((m, r) => (m[r.outcome] = (m[r.outcome] || 0) + 1, m), {});
  console.log(`${annot.planId.padEnd(34)} ${String(got.representation).padEnd(9)} tables ${tablesFound}/${tablesGt.length} (+${got.tables.length - tablesFound})  pieces ${rows.length} ${JSON.stringify(oc)}`);
}
await browser.close();
await app.close?.();

const all = plans.flatMap((p) => p.rows);
const by = (k) => all.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
const undivided = all.filter((r) => r.seats == null);
const wanted = all.reduce((n, r) => n + r.linksWanted, 0), tp = all.reduce((n, r) => n + r.linksTrue, 0), fp = all.reduce((n, r) => n + r.linksFalse, 0);
const summary = {
  plans: plans.length, pieces: all.length, byClass: by("class"), outcomes: by("outcome"),
  outcomesByClass: Object.fromEntries([...FURNITURE].map((c) => [c, all.filter((r) => r.class === c).reduce((m, r) => (m[r.outcome] = (m[r.outcome] || 0) + 1, m), {})])),
  exactType: all.filter((r) => r.exactType).length,
  doubleCounted: all.reduce((n, r) => n + r.doubleCounted, 0),
  cushionsReadAsChairs: all.reduce((n, r) => n + r.chairsOn, 0),
  piecesReadAsTables: all.filter((r) => r.tablesOn > 0).length,
  unknownAsUnknown: { ok: undivided.filter((r) => r.unknownAsUnknown).length, of: undivided.length },
  groups: { truePositive: tp, falsePositive: fp, wanted, precision: tp + fp ? tp / (tp + fp) : null, recall: wanted ? tp / wanted : null },
  apartLinked: all.filter((r) => r.apartLinked === true).length, apartPieces: all.filter((r) => r.apartFrom).length,
  tables: plans.reduce((m, p) => ({ gt: m.gt + p.tables.gt, found: m.found + p.tables.found, detected: m.detected + p.tables.detected }), { gt: 0, found: 0, detected: 0 }),
  pageErrors: plans.reduce((n, p) => n + p.errors, 0),
};
console.log("\n" + JSON.stringify(summary, null, 1));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), dir, summary, plans }, null, 1));
