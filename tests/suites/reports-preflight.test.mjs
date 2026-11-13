// "BEFORE YOU EXPORT" SAYS WHAT THE COMMAND CENTER SAYS.
//
// CLAUDE.md: one layer answers "can this event safely proceed?" and every
// surface reads it, "so the product cannot say two different things about one
// event". Measured before this suite: the Reports screen's pre-flight list was
// built from planIssues() — four rules — while the Command Center judged from
// the Plan Doctor. With three guests seated at a table marked UNAVAILABLE the
// Command Center said NOT READY, and Reports, one tab away, said "Everything
// checks out — No blocking issues in this plan" above the export button. The
// four planIssues() rules are ones the Doctor already expresses natively
// (plan-doctor.js EXPRESSED_NATIVELY), so the narrow list could only ever
// agree by omission.
import { openApp, createBlankEvent, addTables, futureDate, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "reports-preflight", tags: ["business", "ui", "fast"], timeout: 180000 };

// REDESIGN v4 step 8 (SPEC-v4 "Raporlar"): "Rapor tasarımcısı" — a full-size live
// preview of the document (2/3) and a designer panel (1/3): choose and order the
// columns, filter by name / group / table / VIP / arrival, title, logo, paper
// (A4/A3, portrait/landscape, font size), save as a template (this machine,
// try/catch). The workbook (TABLE PLAN / GUEST LIST / UNASSIGNED) and its print
// stay exactly as they were — xlsx-contract guards their bytes. Mutation proof,
// recorded 2026-11-07: with the table filter ignored the filter check fails;
// with the column order not applied the order check fails.

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "One Answer", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await page.evaluate(() => {
    const e = activeEvent();
    const g = (id, name) => ({ id, name, additionalGuests: 0, pax: 1, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived",
      checkedInAt: null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    e.guests.push(g("g1", "Ada One"), g("g2", "Ben Two"), g("g3", "Cem Three"));
    touchEvent(e);
    for (const id of ["g1", "g2", "g3"]) assignGuestToTable(id, e.tables[0].id);
  });

  const commandCenter = async () => {
    await page.evaluate(() => { ui.tab = "command"; render(); });
    await settle(page);
    return page.evaluate(() => [...document.querySelectorAll(".cc-reason")].map((r) => ({
      level: r.classList.contains("blocker") ? "blocker" : "review", what: r.querySelector("b")?.textContent.trim() || "" })));
  };
  const reports = async () => {
    await page.evaluate(() => { ui.tab = "reports"; render(); });
    await settle(page);
    return page.evaluate(() => {
      const box = document.querySelector(".preflight");
      const rows = [...(box?.querySelectorAll(".pf-item:not(.ok)") || [])].map((r) => ({
        level: r.classList.contains("blocker") ? "blocker" : "review", what: r.querySelector("b")?.textContent.trim() || "" }));
      const head = [...document.querySelectorAll(".mx-section-head")].find((h) => h.nextElementSibling === box);
      return { rows, ok: !!box?.querySelector(".pf-item.ok"), count: head?.querySelector(".count")?.textContent.trim() || "" };
    });
  };

  // --- 1. the case that was measured: a failed table with guests at it -----
  await page.evaluate(() => { const e = activeEvent(); e.tables[0].availability = "UNAVAILABLE"; e.tables[0].unavailableReason = "DAMAGED";
    e.tables[0].unavailableSince = new Date().toISOString(); touchEvent(e); });
  const cc1 = await commandCenter();
  checks.ok(cc1.some((r) => r.level === "blocker"), "the Command Center names a blocking problem: guests are seated at a table that cannot be used", cc1);
  const rp1 = await reports();
  checks.ok(!rp1.ok, "Reports does NOT say everything checks out while the Command Center says the event is not ready", rp1);
  checks.equal(rp1.rows, cc1, "Reports lists exactly the Command Center's reasons, in the same order, at the same levels");
  checks.equal(rp1.count, String(cc1.length), "and its count is the same number", rp1.count);

  // --- 2. following the reason lands where the Command Center's does --------
  const destination = async (tab, selector) => {
    await page.evaluate((t) => { ui.tab = t; render(); }, tab);
    await settle(page);
    const found = await page.$(selector);
    if (!found) return null;
    await click(page, selector);
    await settle(page);
    return page.evaluate(() => ({ tab: ui.tab, table: ui.selectedTableId || ui.selectedObjectId || null }));
  };
  const fromCc = await destination("command", ".cc-reason.blocker button");
  const fromReports = await destination("reports", ".preflight .pf-item.blocker button");
  checks.ok(fromCc && fromReports, "both surfaces offer a way to act on the blocking reason", { fromCc, fromReports });
  checks.equal(fromReports, fromCc, "and Reports' control goes exactly where the Command Center's goes");

  // --- 3. fixed in one place, gone from both --------------------------------
  await page.evaluate(() => { const e = activeEvent(); e.tables[0].availability = "AVAILABLE"; e.tables[0].unavailableReason = null; touchEvent(e); });
  const cc2 = await commandCenter();
  const rp2 = await reports();
  checks.ok(!cc2.some((r) => r.level === "blocker") && !rp2.rows.some((r) => r.level === "blocker"), "the table back in service: neither surface still reports it", { cc2, rp2 });
  checks.equal(rp2.rows, cc2, "and the two lists still match");
  checks.equal(rp2.ok, cc2.length === 0, "\"Everything checks out\" appears exactly when the Command Center has nothing to report", { rp2, cc2 });

  // --- 4. a rule both lists had: worded once, by the Doctor ----------------
  // An unseated guest was one of planIssues()' four rules, so the old Reports
  // list said it too — in its own words, beside the Command Center's.
  await page.evaluate(() => { const e = activeEvent();
    e.guests.push({ id: "g4", name: "Dan Four", additionalGuests: 0, pax: 1, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived",
      checkedInAt: null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    touchEvent(e); });
  const cc3 = await commandCenter();
  const rp3 = await reports();
  checks.ok(cc3.length > 0, "an unseated guest is a reason on the Command Center", cc3);
  checks.equal(rp3.rows, cc3, "and the same reason, worded the same way, in Reports");

  // --- 5. Turkish: the same rows, translated the same way -------------------
  await page.evaluate(() => { ui.lang = "tr"; render(); });
  const cc4 = await commandCenter();
  const rp4 = await reports();
  checks.equal(rp4.rows, cc4, "in Turkish the two lists are the same list too");

  // --- REDESIGN v4 step 8: the report designer -------------------------------------
  await page.evaluate(() => { const e = activeEvent(); const g = (id, name, pax, host, vip, st) => ({ id, name, additionalGuests: pax - 1, pax, vip, invitedBy: host, notes: "", planningStatus: "Confirmed", arrivalStatus: st, assignment: null, createdAt: "" });
    e.guests.push(g("r1", "Ece Tan", 2, "Junket A", "VIP", "Checked In"), g("r2", "Ferhat Oz", 1, "Junket B", "Standard", "Not Arrived"), g("r3", "Gül Ak", 3, "Junket A", "Standard", "No Show"));
    assignGuestToTable("r1", e.tables[0].id); assignGuestToTable("r2", e.tables[1].id); touchEvent(e); ui.tab = "reports"; render(); });
  await settle(page);
  await click(page, '[data-reports-view="designer"]');
  // The designer was rebuilt on 2026-11-13 (src/report-designer.js): the preview is
  // now one .rd-sheet per printed page, so rows are read across every sheet (group
  // headings and companion lines are not records), and the font is the sheet's data-font (pt).
  const pv = () => page.evaluate(() => { const p = document.querySelector(".rd-sheet"); if (!p) return null; const all = [...document.querySelectorAll(".rd-preview .rd-sheet")];
    return { head: [...p.querySelectorAll("thead th")].map((x) => x.textContent.trim()), rows: all.flatMap((sh) => [...sh.querySelectorAll("tbody tr:not(.rd-grp):not(.rd-comp)")]).map((r) => [...r.cells].map((c) => c.textContent.trim())),
      title: p.querySelector(".rd-title")?.textContent.trim(), paper: p.dataset.paper, font: p.dataset.font,
      panel: !!document.querySelector(".rd-panel"), ratio: (() => { const a = document.querySelector(".rd-preview")?.getBoundingClientRect().width, b = document.querySelector(".rd-panel")?.getBoundingClientRect().width; return a && b ? b / (a + b) : null; })() }; });
  let d = await pv();
  checks.ok(d && d.panel && d.ratio > 0.25 && d.ratio < 0.4, "Raporlar has a full preview and a designer panel of about 1/3", d);
  const nAll = await page.evaluate(() => activeEvent().guests.length);
  checks.ok(d.rows.length === nAll && d.head.length >= 3, "the preview lists every guest record with the chosen columns", d);
  // options: All, No table, Has a table, then the tables — the first table is index 3
  await page.selectOption("[data-rd-filter='table']", { index: 3 }); await settle(page);
  d = await pv();
  const atFirst = await page.evaluate(() => { const v = document.querySelector("[data-rd-filter='table']").value; return activeEvent().guests.filter((g) => g.assignment && g.assignment.tableId === v).map((g) => g.name).sort(); });
  checks.equal(d.rows.map((r) => r[0]).sort(), atFirst, "filter by table: only that table's people", d.rows);
  await page.selectOption("[data-rd-filter='table']", ""); await settle(page);
  await page.fill("[data-rd-filter='q']", "gül"); await page.waitForTimeout(450); await settle(page);
  d = await pv();
  checks.ok(d.rows.length === 1 && /Gül Ak/.test(d.rows[0].join(" ")), "filter by name (Turkish-folded)", d.rows);
  await page.fill("[data-rd-filter='q']", ""); await page.waitForTimeout(450);
  await page.selectOption("[data-rd-filter='host']", "Junket A"); await settle(page);
  checks.equal((await pv()).rows.length, 2, "filter by group / junket");
  await page.selectOption("[data-rd-filter='host']", "");
  await page.selectOption("[data-rd-filter='vip']", "vip"); await settle(page);
  checks.equal((await pv()).rows.length, await page.evaluate(() => activeEvent().guests.filter((g) => /VIP/.test(String(g.vip || ""))).length), "VIP only");
  await page.selectOption("[data-rd-filter='vip']", ""); await settle(page);
  const before = (await pv()).head;
  await page.click(`[data-rd-col-down="${await page.evaluate(() => document.querySelector("[data-rd-col]")?.dataset.rdCol)}"]`); await settle(page);
  const after = (await pv()).head;
  checks.ok(after[0] === before[1] && after[1] === before[0], "a column moves down: the order is the document's order", { before, after });
  const off = await page.evaluate(() => [...document.querySelectorAll("[data-rd-col]")].find((x) => !x.querySelector("input").checked)?.dataset.rdCol);
  await page.check(`[data-rd-col="${off}"] input`); await settle(page);
  checks.equal((await pv()).head.length, after.length + 1, "ticking a column adds it", off);
  await page.fill("[data-rd-text='title']", "Kapı listesi — Junket"); await page.waitForTimeout(450);
  await page.selectOption("[data-rd-paper]", "A3-landscape"); await page.selectOption("[data-rd-font]", "14"); await settle(page);
  d = await pv();
  checks.ok(d.title === "Kapı listesi — Junket" && d.paper === "A3-landscape" && d.font === "14", "title, paper and font size shape the preview", d);
  await page.fill("[data-rd-template-name]", "Junket kapı"); await page.click("[data-rd-save]"); await settle(page);
  const saved = await page.evaluate(() => { try { return (JSON.parse(localStorage.getItem("merit.reportTemplates.v2") || "{}")[activeEvent().id] || []).map((x) => x.name); } catch { return null; } });
  checks.ok(saved && saved.includes("Junket kapı"), "save as template: kept on this machine, per event", saved);
  const thrown = await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error("quota"); }; try { document.querySelector("[data-rd-template-name]").value = "X"; document.querySelector("[data-rd-save]").click(); return "ok"; } catch (e) { return String(e); } finally { Storage.prototype.setItem = o; } });
  checks.equal(thrown, "ok", "a storage that refuses only loses the template, never the screen", thrown);
  await click(page, '[data-reports-view="summary"]');
  checks.ok(await page.evaluate(() => !!document.querySelector('[data-report="xlsx"]') && !!document.querySelector(".preflight")), "the summary with the workbook export is one click away, unchanged");

  // --- WIRING PASS (FEATURES-2026-11-07 §3): the night-end report -------------------
  // Its own workbook, one sheet "NIGHT END" from MeritNightReport — never added to
  // the TABLE PLAN / GUEST LIST / UNASSIGNED workbook.
  await page.evaluate(() => { window.__wb = null; const X = globalThis.XLSX; X.__orig = X.__orig || X.writeFile; X.writeFile = (wb, name) => { window.__wb = { names: wb.SheetNames.slice(), name, rows: X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) }; }; });
  await click(page, '[data-report="night"]');
  const wb = await page.evaluate(() => { const r = window.__wb; XLSX.writeFile = XLSX.__orig; return r; });
  checks.ok(wb && wb.names.length === 1 && wb.names[0] === "NIGHT END" && /night/i.test(wb.name), "Gece sonu raporu: its own workbook, one NIGHT END sheet", wb && { names: wb.names, name: wb.name });
  const hi = wb ? wb.rows.findIndex((r) => r[0] === "PEOPLE") : -1, vals = hi >= 0 ? wb.rows[hi + 1] : null;
  checks.ok(vals && wb.rows[hi][2] === "ARRIVED" && Number(vals[2]) === 2 && wb.rows[hi][3] === "NO SHOW" && Number(vals[3]) === 3, "with the night's figures from the records (2 arrived, 3 no show, in pax)", wb && wb.rows.slice(0, 12));
}
