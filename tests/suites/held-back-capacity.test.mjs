// A held-back candidate is not in the room's numbers.
//
// The detector offers what it believes and holds back what it found but does
// not trust (selected false, nobody has confirmed it). The drawn-chair figure,
// the seats a zone claims and the seats the scene counts are about the plan an
// operator gets by confirming what was offered — so a held-back table's chairs
// are not in them. On the Golden Plan they were: 112 drawn chairs reported
// against the 107 actually offered (2026-10-04). Held-back seats are reported
// on their own, so the difference is visible rather than folded in; switching
// a held-back table on (or confirming it) brings its chairs in.
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "held-back-capacity", tags: ["intelligence", "fast"], timeout: 60000, viewport: { width: 1200, height: 800 } };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const r = await page.evaluate(() => {
    const C = globalThis.MeritPlanIntelCapacity;
    const chairs = n => Array.from({ length: n }, (_, i) => ({ id: "ch" + i, x: 1, y: 1, w: 1, h: 1 }));
    const t = (id, n, extra) => ({ id, kind: "table", type: "square", x: 0, y: 0, w: 1, h: 1, chairDetections: chairs(n), ...extra });
    const cands = [
      t("offered", 4, { status: "unreviewed", selected: true }),
      t("confirmed", 6, { status: "confirmed", selected: true }),
      t("held", 5, { status: "unreviewed", selected: false }),
      t("rejected", 3, { status: "rejected", selected: false }),
      { id: "chairOffered", kind: "venue", type: "chair", status: "unreviewed", selected: true },
      { id: "chairHeld", kind: "venue", type: "chair", status: "unreviewed", selected: false },
    ];
    const switchedOn = cands.map(c => c.id === "held" ? { ...c, selected: true } : c);
    return {
      physical: C.computePhysicalCapacity(cands), associated: C.countAssociatedSeats(cands), standalone: C.countStandaloneChairs(cands),
      held: C.heldBackSeats(cands), afterSwitch: C.computePhysicalCapacity(switchedOn),
      audit: C.buildCapacityAudit(null, C.computePhysicalCapacity(cands), cands, []).physical,
    };
  });
  checks.equal(r.physical, 11, "the drawn-chair figure counts offered and confirmed tables' chairs and offered standalone chairs (4 + 6 + 1)");
  checks.equal(r.associated, 10, "seats at tables: offered and confirmed only");
  checks.equal(r.standalone, 1, "standalone chairs: offered only");
  checks.ok(r.held.tables === 1 && r.held.seats === 6, "held back is reported on its own: one table, 5 + 1 seats", r.held);
  checks.ok(r.audit.heldBack && r.audit.heldBack.seats === 6 && r.audit.seats === 11, "the capacity audit carries both, apart", r.audit);
  checks.equal(r.afterSwitch, 16, "switching the held-back table on brings its chairs in");

  // The capacity suspects an operator is shown first come out in one order for
  // one plan. Ties go to position, and two objects at exactly the same place
  // go to the order the analysis holds them in — never to their ids, which are
  // random per analysis (a6 has four such pairs; its fingerprint changed run to
  // run until 2026-10-10).
  const order = await page.evaluate(() => {
    const C = globalThis.MeritPlanIntelCapacity;
    const at = (id, x, y) => ({ id, kind: "table", type: "square", x, y, w: 1, h: 1, status: "unreviewed", selected: true, confidence: 0.4, chairDetections: [] });
    const run = (ids) => C.buildCapacityAudit(null, 0, [at(ids[0], 10, 10), at(ids[1], 10, 10), at(ids[2], 5, 5)], []).suspectRegions.map(s => s.id);
    return { a: run(["zz-first", "aa-second", "mm-top"]), b: run(["aa-first", "zz-second", "mm-top"]) };
  });
  checks.ok(JSON.stringify(order.a) === JSON.stringify(["mm-top", "zz-first", "aa-second"]) && JSON.stringify(order.b) === JSON.stringify(["mm-top", "aa-first", "zz-second"]),
    "suspects tied on score sort by place, and two at the same place keep the analysis's order whatever their ids", order);
}
