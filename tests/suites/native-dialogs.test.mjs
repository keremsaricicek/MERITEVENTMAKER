// NO BROWSER-NATIVE DIALOGS — AND CANCEL STILL MEANS NOTHING HAPPENED.
//
// `merit-ui-quality-gates` §native dialogs and
// `merit-accessibility-hardening`: "Browser-native dialogs are both an
// accessibility problem and a UI-quality problem. They cannot be styled,
// cannot be made to match the product, and their semantics vary by browser.
// Replace them with real in-app dialogs." At entry there were 9 `confirm()`
// and 2 `prompt()` calls; nine were live.
//
// Replacing a confirm() is only safe if its CONTRACT survives: most of these
// guard something destructive — deleting a guest, a table, a whole event,
// replacing every event with a backup — and the one property that matters is
// that answering "no" changes nothing. So every live site is driven through
// the real control twice: once answered Cancel (or Escape), asserting state
// is byte-identical afterwards, and once answered yes, asserting the action
// really happened. Throughout, a native dialog appearing at all is a failure.
//
// The two prompts get the same treatment plus validation: a seat count or a
// PDF page number that is out of range is refused IN the dialog, with the
// error tied to the field, and nothing changes.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, addGuest, click } from "../lib/app-actions.mjs";
import { stripCommentsAndStrings } from "../lib/js-scan.mjs";

export const meta = { name: "native-dialogs", tags: ["ui", "accessibility", "fast"], timeout: 180000, downloads: true };

// A two-page PDF, written here byte by byte so the page-number question has
// something to ask about (the repo's only PDF has one page).
function twoPagePdf() {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>",
    null,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 6 0 R >>",
    null,
  ];
  const streams = { 4: "0 0 0 RG 4 w 40 40 m 260 160 l S", 6: "0 0 0 RG 4 w 40 160 m 260 40 l S" };
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    const n = i + 1;
    offsets[n] = out.length;
    const body = o ?? `<< /Length ${streams[n].length} >>\nstream\n${streams[n]}\nendstream`;
    out += `${n} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= objs.length; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export default async function run({ page, checks, baseUrl, repoRoot, artifactDir }) {
  // --- 0. none left in the source ---------------------------------------------
  const found = [];
  for (const f of fs.readdirSync(path.join(repoRoot, "src")).filter((x) => x.endsWith(".js"))) {
    const code = stripCommentsAndStrings(fs.readFileSync(path.join(repoRoot, "src", f), "utf8"));
    for (const m of code.matchAll(/(^|[^\w$.])(confirm|prompt|alert)\s*\(/g))
      found.push(`${f}:${code.slice(0, m.index).split("\n").length} ${m[2]}()`);
  }
  checks.equal(found, [], "no browser-native confirm(), prompt() or alert() anywhere in src/", found);

  const natives = [];
  page.on("dialog", (d) => { natives.push(`${d.type()}: ${d.message().slice(0, 60)}`); d.dismiss(); });
  await openApp(page, baseUrl, { lang: "en" });

  const ask = () => page.evaluate(() => {
    const d = document.getElementById("meritAskDialog");
    return d && d.open ? { title: d.querySelector("#meritAskTitle")?.textContent, body: d.querySelector("#meritAskBody")?.textContent,
      focus: document.activeElement?.getAttribute("data-ask") || document.activeElement?.id || null } : null;
  });
  const answer = async (how) => {
    await page.waitForFunction(() => document.getElementById("meritAskDialog")?.open, null, { timeout: 5000 });
    if (how === "escape") await page.keyboard.press("Escape");
    else await page.click(`#meritAskDialog [data-ask="${how}"]`);
    await page.waitForTimeout(300);
  };
  const snapshot = () => page.evaluate(() => JSON.stringify(state.events.map((e) => ({
    id: e.id, name: e.name, tables: e.tables.map((t) => [t.id, t.capacity]), guests: e.guests.map((g) => g.id) }))));

  await createBlankEvent(page, { name: "Dialog Event", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 3 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "DELETE ME" });
  await addGuest(page, { name: "KEEP ME" });

  // --- 1. delete a guest ----------------------------------------------------------
  const gid = await page.evaluate(() => state.events[0].guests.find((g) => g.name === "DELETE ME").id);
  for (const how of ["cancel", "escape"]) {
    const before = await snapshot();
    await click(page, `[data-guest-delete="${gid}"]`);
    const shown = await ask();
    checks.ok(shown && /DELETE ME/.test(shown.body || shown.title), `delete guest: an IN-APP dialog asks, naming the guest (${how})`, shown);
    checks.equal(shown && shown.focus, "cancel", "and a destructive question opens with focus on Cancel, not on the destructive answer");
    await answer(how);
    checks.equal(await snapshot(), before, `delete guest, answered ${how}: NOTHING changed`);
  }
  await click(page, `[data-guest-delete="${gid}"]`);
  await answer("confirm");
  checks.ok(await page.evaluate((id) => !state.events[0].guests.some((g) => g.id === id), gid), "delete guest, confirmed: the guest is gone");

  // --- 2. delete a table on the canvas -------------------------------------------
  await gotoTab(page, "floor");
  const tid = await page.evaluate(() => { const t = state.events[0].tables[0]; ui.selectedObjectId = t.id; ui.selectedObjectIds = [t.id]; render(); return t.id; });
  await page.focus(`[data-object-id="${tid}"]`);
  const beforeTable = await snapshot();
  // Count the questions one keypress raises: ask() collapses a duplicate into
  // one visible dialog, so only a count can see a second handler asking.
  await page.evaluate(() => { const orig = window.ask; window.__asks = 0; window.ask = function (...a) { window.__asks++; return orig.apply(this, a); }; });
  await page.keyboard.press("Delete");
  checks.ok(!!(await ask()), "delete a table: an in-app dialog asks");
  checks.equal(await page.evaluate(() => window.__asks), 1, "and ONE Delete press asks exactly once — two global key handlers both used to handle it", null);
  await answer("cancel");
  checks.equal(await snapshot(), beforeTable, "delete a table, cancelled: nothing changed");
  // Found by this suite: two global key handlers both handled Delete, so
  // Cancel on the question was followed by the SAME question again.
  await page.waitForTimeout(200);
  checks.equal(await ask(), null, "and Cancel is final — the same question does not come back a second time");
  await page.evaluate((id) => { ui.selectedObjectId = id; ui.selectedObjectIds = [id]; render(); }, tid);
  await page.focus(`[data-object-id="${tid}"]`);
  await page.keyboard.press("Delete");
  await answer("confirm");
  checks.ok(await page.evaluate((id) => !state.events[0].tables.some((t) => t.id === id), tid), "delete a table, confirmed: it is gone");

  // --- 3. a custom seat count ------------------------------------------------------
  const t2 = await page.evaluate(() => { const t = state.events[0].tables[0]; ui.selectedObjectId = t.id; ui.selectedObjectIds = [t.id]; render(); return { id: t.id, cap: t.capacity }; });
  await click(page, "[data-seat-custom]");
  const numberAsk = await ask();
  checks.ok(numberAsk && numberAsk.focus === "meritAskInput", "custom seats: an in-app NUMBER dialog opens with focus in its field", numberAsk);
  await page.fill("#meritAskInput", "500");
  await page.click('#meritAskDialog [data-ask="confirm"]');
  const invalid = await page.evaluate(() => ({ open: document.getElementById("meritAskDialog").open,
    invalid: document.getElementById("meritAskInput").getAttribute("aria-invalid"),
    described: document.getElementById(document.getElementById("meritAskInput").getAttribute("aria-describedby") || "x")?.textContent || "" }));
  checks.ok(invalid.open && invalid.invalid === "true" && /1.*99/.test(invalid.described),
    "500 seats is refused IN the dialog, with the reason tied to the field — not a toast that disappears", invalid);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  checks.equal(await page.evaluate((id) => state.events[0].tables.find((t) => t.id === id).capacity, t2.id), t2.cap, "and nothing changed");
  // Found by this suite: Escape in the dialog ALSO reached the app's global
  // Escape handler and cleared the selection behind it.
  checks.equal(await page.evaluate(() => ui.selectedObjectId), t2.id,
    "and Escape closed ONLY the dialog — the table behind it is still selected");
  await click(page, "[data-seat-custom]");
  await page.fill("#meritAskInput", "12");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  checks.equal(await page.evaluate((id) => state.events[0].tables.find((t) => t.id === id).capacity, t2.id), 12, "12, entered with Enter, is set");

  // --- 4. replace the plan with a two-page PDF ------------------------------------
  const pdf = twoPagePdf();
  const bgBefore = await page.evaluate(() => JSON.stringify(state.events[0].background || null));
  await page.setInputFiles("#floorPlanFile", { name: "two.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.waitForFunction(() => document.getElementById("meritAskDialog")?.open, null, { timeout: 20000 });
  const pdfAsk = await ask();
  checks.ok(pdfAsk && /2/.test(pdfAsk.body || ""), "a two-page PDF asks WHICH page, in the product's own dialog, saying how many there are", pdfAsk);
  await answer("cancel");
  await page.waitForTimeout(500);
  checks.equal(await page.evaluate(() => JSON.stringify(state.events[0].background || null)), bgBefore, "cancelling the page question leaves the current plan exactly as it was");
  await page.setInputFiles("#floorPlanFile", { name: "two.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.waitForFunction(() => document.getElementById("meritAskDialog")?.open, null, { timeout: 20000 });
  await page.fill("#meritAskInput", "2");
  await page.click('#meritAskDialog [data-ask="confirm"]');
  await page.waitForFunction(() => /page 2/.test(state.events[0].background?.name || ""), null, { timeout: 20000 }).catch(() => {});
  checks.ok(await page.evaluate(() => /page 2/.test(state.events[0].background?.name || "")),
    "page 2, chosen, becomes the plan — which also proves a PDF page RENDERS: pdf.js 5 needs Map.prototype.getOrInsertComputed, which this Chromium lacks, and every PDF import threw until app.js supplied it");

  // --- 5. delete an event ---------------------------------------------------------
  await click(page, '[data-action="back-events"]');
  await settle(page);
  const eid = await page.evaluate(() => state.events[0].id);
  const beforeEvent = await snapshot();
  await click(page, `[data-delete-event="${eid}"]`);
  checks.ok(!!(await ask()), "delete an event: an in-app dialog asks");
  await answer("escape");
  checks.equal(await snapshot(), beforeEvent, "delete an event, Escape: nothing changed");

  // --- 6. restore a backup / import a package ---------------------------------------
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="backup-export"]')]);
  const backupFile = path.join(artifactDir, "dialog-backup.json");
  const backup = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  backup.payload.events[0].name = "RESTORED NAME";
  fs.writeFileSync(backupFile, JSON.stringify(backup));
  const beforeRestore = await snapshot();
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", backupFile);
  checks.ok(!!(await (async () => { await page.waitForFunction(() => document.getElementById("meritAskDialog")?.open, null, { timeout: 5000 }); return ask(); })()),
    "restoring a backup: an in-app dialog asks before replacing everything");
  await answer("cancel");
  checks.equal(await snapshot(), beforeRestore, "restore, cancelled: every event is exactly as it was");
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", backupFile);
  await answer("confirm");
  checks.ok(await page.evaluate(() => state.events[0].name === "RESTORED NAME"), "restore, confirmed: the backup replaced them");

  const [pdl] = await Promise.all([page.waitForEvent("download"), page.click("[data-export-event-package]")]);
  const pkgFile = await pdl.path();
  const beforePkg = await snapshot();
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", pkgFile);
  await answer("escape");
  checks.equal(await snapshot(), beforePkg, "package import, Escape: nothing added");

  checks.equal(natives, [], "and not one browser-native dialog appeared anywhere in all of that", natives);
}
