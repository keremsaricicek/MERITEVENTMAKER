// A LONG GUEST LIST STAYS WORKABLE, AND EVERY ROW IS STILL REVIEWABLE.
//
// Measured 2026-10-04 (benchmarks/perf/large-files.mjs): the import wizard's
// interpretation step drew every row as editable controls — 2,000 rows froze
// the page for 3.9 s, 10,000 for 17.9 s, and every correction redrew them all.
// It now draws one page of 200; the pager and a "needs attention" filter reach
// every row. This suite holds the behaviour that makes that safe: no row is
// out of reach, a correction made on page N lands on the right record, and
// the import still takes every row.
//
// It also holds the collator change behind the Live screen's 8× speed-up at
// 50,000 guests: one cached Intl.Collator must order exactly as the
// per-call localeCompare it replaced.
import { openApp, createBlankEvent, futureDate, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "import-scale", tags: ["guests", "performance", "fast"], timeout: 150000 };

const ROWS = 3000, BAD_EVERY = 100;
const pad = (i) => String(i).padStart(4, "0");

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Long List", hotel: "Merit", date: futureDate() });

  // --- the collator is the same order ---------------------------------------
  const order = await page.evaluate(() => {
    const words = ["T1", "T10", "t2", "T02", "VIP 3", "vip 12", "B01", "Ömer", "ömer", "Oya", "Çiğdem", "Cem", "İlker", "ilker", "", "10", "9", "a-1", "A 1", "Şule", "Sena", "ğ", "Z99", "z100", "Omer", "Sule", "Cigdem", "Ilker", "T 1", "Gul", "Gül"];
    const old = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    const pool = []; for (let i = 0; i < 400; i++) pool.push(words[i % words.length] + (i % 3 ? String(i % 17) : ""));
    let mismatches = 0;
    for (let i = 0; i < pool.length; i++) for (let j = 0; j < pool.length; j += 7) if (Math.sign(naturalSort(pool[i], pool[j])) !== Math.sign(old(pool[i], pool[j]))) mismatches++;
    return { mismatches, sortedSame: JSON.stringify([...pool].sort(naturalSort)) === JSON.stringify([...pool].sort(old)) };
  });
  checks.equal(order, { mismatches: 0, sortedSame: true }, "naturalSort orders exactly as localeCompare with the same locale and options (Turkish letters, numbers, case)");

  // --- a 3,000-row list through the real wizard ------------------------------
  const lines = ["NAME SURNAME,ADDITIONAL GUESTS,STATUS"];
  for (let i = 1; i <= ROWS; i++) lines.push(`Guest ${pad(i)},${i % BAD_EVERY === 0 ? "x" : i % 9 === 0 ? 2 : 0},${i % 4 ? "Confirmed" : "Tentative"}`);
  await page.evaluate(() => { ui.tab = "guests"; render(); });
  await settle(page);
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "long.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.waitForSelector("[data-wizard-next]");
  for (let i = 0; i < 2; i++) { await click(page, "[data-wizard-next]"); await page.waitForTimeout(150); }
  await page.waitForSelector(".wz-pager");
  const view = () => page.evaluate(() => ({
    range: document.querySelector(".wz-pager-range")?.textContent.trim(),
    rows: document.querySelectorAll(".wz-table.interp tbody tr").length,
    first: document.querySelector(".wz-table.interp tbody tr td.src")?.textContent.trim() || null,
    nameInputs: document.querySelectorAll('[data-interp-field="name"]').length,
  }));
  const p1 = await view();
  checks.equal(p1, { range: "Rows 1–200 of 3,000", rows: 200, first: "Guest 0001", nameInputs: 200 },
    "the interpretation step draws one page of 200 rows and says how many there are");
  await click(page, '[data-interp-page="1"]');
  checks.equal((await view()).first, "Guest 0201", "Next shows the following 200 rows");
  await page.fill("[data-interp-goto]", "15");
  await page.dispatchEvent("[data-interp-goto]", "change");
  await page.waitForTimeout(150);
  const last = await view();
  checks.equal({ range: last.range, rows: last.rows, first: last.first }, { range: "Rows 2,801–3,000 of 3,000", rows: 200, first: "Guest 2801" }, "the last page reaches the last row");

  // the rows needing attention, every one reachable and correctable in place
  await click(page, '[data-interp-filter="attention"]');
  const flagged = await page.evaluate(() => [...document.querySelectorAll(".wz-table.interp tbody tr td.src")].map((td) => td.textContent.trim()));
  checks.equal(flagged.length, ROWS / BAD_EVERY, "the filter lists exactly the rows needing attention", flagged.length);
  checks.ok(flagged.every((n) => Number(n.slice(-4)) % BAD_EVERY === 0), "and only those", flagged.slice(0, 5));
  checks.ok(await page.locator("[data-wizard-import]").count() === 0, "(still on the interpretation step)");
  // Correct each flagged row. The row's index is its place in the WHOLE list,
  // so a fix made in the filtered view lands on that record.
  for (let k = 0; k < ROWS / BAD_EVERY; k++) {
    const input = page.locator('[data-interp-field="additionalGuests"]').first();
    await input.fill("1");
    await input.dispatchEvent("change");
    await page.waitForTimeout(40);
  }
  checks.ok(/no row needs attention/i.test(await page.locator(".wz-empty").textContent().catch(() => "")), "once corrected, the filtered view says nothing is left");
  await click(page, "[data-wizard-next]");
  await page.waitForSelector("[data-wizard-import]:not([disabled])");
  await click(page, "[data-wizard-import]");
  await page.waitForFunction((n) => activeEvent().guests.length >= n, ROWS);
  const imported = await page.evaluate(({ BAD_EVERY }) => {
    const gs = activeEvent().guests, by = new Map(gs.map((g) => [g.name, g]));
    const fixed = [];
    for (let i = BAD_EVERY; i <= 3000; i += BAD_EVERY) fixed.push(by.get("Guest " + String(i).padStart(4, "0"))?.additionalGuests);
    return { records: gs.length, fixedAll: fixed.every((v) => v === 1), untouched: by.get("Guest 0009").additionalGuests, plain: by.get("Guest 0001").additionalGuests };
  }, { BAD_EVERY });
  checks.equal(imported, { records: ROWS, fixedAll: true, untouched: 2, plain: 0 },
    "every row is imported as one record, each correction landed on its own record, and no other row changed");

  // A list that fits on one page looks exactly as before: no pager.
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "short.csv", mimeType: "text/csv", buffer: Buffer.from("NAME SURNAME,ADDITIONAL GUESTS,STATUS\nShort List,0,Confirmed\n") });
  await page.waitForSelector("[data-wizard-next]");
  for (let i = 0; i < 2; i++) { await click(page, "[data-wizard-next]"); await page.waitForTimeout(150); }
  checks.equal(await page.locator(".wz-pager").count(), 0, "a short list shows no pager");
}
