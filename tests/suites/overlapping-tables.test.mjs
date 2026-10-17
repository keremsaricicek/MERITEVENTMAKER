// Two tables cannot stand in one place (app-v8.js holdBackOverlappingTables).
//
// What this pins, on the Golden Plan:
//   THE SPLIT PIECE IS HELD BACK, NOT DELETED: a blob holding an armchair and
//     half of the table beside it was split into a "rectangle table" that
//     covers that real table by about a third. It stays in the analysis, held
//     back with the reason overlapsAnotherTable and the table it overlaps.
//   ITS SEATS ARE STILL SEATS: the chairs it had claimed go to the table they
//     stand against, so the room's seat count does not drop.
//   TOUCHING IS NOT OVERLAPPING: no table of a joined group is held back.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "overlapping-tables", tags: ["intelligence", "detection"], timeout: 300000, viewport: { width: 1400, height: 900 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Overlap", date: futureDate() });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64"));
  await runDetection(page);
  const r = await page.evaluate(() => {
    const a = state.events[0].analysis, W = 1355, H = 788;
    const t = a.candidates.filter(c => c.kind === "table");
    const box = c => ({ x0: Math.round(c.x / 100 * W), y0: Math.round(c.y / 100 * H), x1: Math.round((c.x + c.w) / 100 * W), y1: Math.round((c.y + c.h) / 100 * H) });
    const held = t.filter(c => c.lowEvidence && c.lowEvidence.reason === "overlapsAnotherTable");
    const byId = new Map(t.map(c => [c.id, c]));
    return {
      held: held.map(c => ({ box: box(c), selected: c.selected, share: c.lowEvidence.share, seats: (c.chairDetections || []).length,
        withBox: byId.get(c.lowEvidence.with) ? box(byId.get(c.lowEvidence.with)) : null,
        withSeats: byId.get(c.lowEvidence.with) ? (byId.get(c.lowEvidence.with).chairDetections || []).length : null })),
      moved: t.flatMap(c => (c.chairDetections || []).filter(ch => ch.relation && ch.relation.reason === "reassignedFromOverlappingReading")).length,
      offeredSeats: t.filter(c => c.selected !== false && c.status !== "rejected").reduce((n, c) => n + (c.chairDetections || []).length, 0),
      groupsHeld: (a.planIntelligence.furnitureGroups || []).filter(g => (g.memberIds || []).length > 1)
        .some(g => g.memberIds.some(id => byId.get(id) && byId.get(id).lowEvidence && byId.get(id).lowEvidence.reason === "overlapsAnotherTable")),
      diag: a.diagnostics.tablesHeldForOverlap,
    };
  });
  checks.equal(r.held.length, 1, "one reading is held back for covering another table", r.held);
  const h = r.held[0] || {};
  checks.ok(h.selected === false && h.share >= 0.25 && h.box && h.box.x0 >= 735 && h.box.x0 <= 755,
    "it is the split piece left of table T11, held back (not deleted) and naming the table it covers", h);
  checks.ok(h.seats === 0 && r.moved === 2 && h.withSeats >= 2,
    "the two seats it had claimed now stand with the tables they are against", { moved: r.moved, withSeats: h.withSeats });
  checks.ok(r.offeredSeats >= 108, "so the offered seat count does not drop", r.offeredSeats);
  checks.ok(!r.groupsHeld, "no dining group contains a held-back reading: groups are made of offered tables");
}
