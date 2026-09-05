// What the bulk-add panel stores must be the stored value, not the label.
//
// The panel is bilingual. A select whose option text is "Bistro Masa" must
// still write type:"bistro", because the type identifier is read by the
// detector, the reports and the seat geometry. This suite runs the panel in
// Turkish precisely because that is where a label-vs-value slip would show.
import { openApp, createBlankEvent, addTables } from "../lib/app-actions.mjs";

export const meta = { name: "bulk-add-integrity", tags: ["business", "fast"], timeout: 90000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Deger", hotel: "H", date: "2026-10-02" });

  const count = await addTables(page, { quantity: 6, type: "bistro", prefix: "B" });
  checks.ok(count === 6, "the Turkish panel created exactly the requested six tables", count);

  const result = await page.evaluate(() => {
    const ts = state.events[0].tables;
    return {
      types: [...new Set(ts.map(t => t.type))],
      numbers: ts.map(t => t.number),
      capacities: ts.map(t => t.capacity),
      chairCounts: ts.map(t => t.chairs.length),
    };
  });

  checks.ok(result.types.length === 1 && result.types[0] === "bistro",
    'table.type stored the English identifier "bistro", not the Turkish label', result.types);
  checks.ok(result.numbers.every(n => /^B\d+$/.test(n)),
    "the number prefix was applied to every table", result.numbers);
  checks.ok(new Set(result.numbers).size === result.numbers.length,
    "bulk-added tables get distinct numbers", result.numbers);
  checks.ok(result.capacities.every((c, i) => c === result.chairCounts[i]),
    "every bulk-added table has exactly as many chairs as its capacity",
    { capacities: result.capacities, chairs: result.chairCounts });

  // Chairs are first-class objects, so each must be a real chair record bound
  // to its table -- a capacity number with an empty chair array would pass a
  // naive count check and break the seating canvas.
  const chairShape = await page.evaluate(() => {
    const t = state.events[0].tables[0];
    return {
      parentsMatch: t.chairs.every(c => c.parentTableId === t.id),
      seatNumbers: t.chairs.map(c => c.seatNumber),
      haveIds: t.chairs.every(c => !!c.id),
    };
  });
  checks.ok(chairShape.parentsMatch && chairShape.haveIds,
    "each chair is a real object carrying its own id and parent table", chairShape);
  checks.ok(chairShape.seatNumbers.join(",") === chairShape.seatNumbers.map((_, i) => i + 1).join(","),
    "seat numbers run 1..capacity with no gaps", chairShape.seatNumbers);
}
