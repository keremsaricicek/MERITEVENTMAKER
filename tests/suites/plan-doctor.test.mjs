// CAN THIS EVENT SAFELY PROCEED? — the pre-flight check.
//
// Four things here are load-bearing, and each is the reason a specific line of
// this suite exists rather than a general "does it render" check.
//
//   A READING IS NOT AN OPERATIONAL FACT. Two tables a person numbered the same
//   is BLOCKING; two tables OCR *read* as the same number is NEEDS REVIEW. The
//   easiest possible change — treating both as one "duplicate number" rule —
//   would look like a simplification in a diff, and would either cry wolf on
//   every plan with imperfect OCR or bury a conflict that will misdirect a
//   guest tonight.
//
//   NO DEAD-END ROWS. Every finding must offer a way to act on it, and the
//   target has to resolve against live data. A row that names a problem and
//   leaves the operator to go hunting is the failure mode the programme names.
//
//   NOTHING IS REMEMBERED. Fix the problem and the row is gone on the next
//   render, because the report is derived and never stored. A cached finding
//   list would be right most of the time and wrong exactly when it matters.
//
//   THE PRODUCT ANSWERS ONCE. The header badge, the attention list and the
//   Doctor all read one report. Three assemblies of the same facts is the
//   defect B1 fixed for the status pill and the review chip.
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "plan-doctor", tags: ["business", "fast"], timeout: 150000 };

const DOCTOR = `(function(){
  const rows = [...document.querySelectorAll(".doc-row")].map(r => ({
    level: (r.className.match(/lvl-(\\w+)/) || [])[1] || null,
    text: r.querySelector("b")?.textContent.trim() || "",
    why: r.querySelector(".doc-why")?.textContent.trim() || "",
    meta: r.querySelector(".doc-meta")?.textContent.trim() || "",
    go: (() => {
      const b = r.querySelector(".btn");
      if (!b) return null;
      return { label: b.textContent.trim(), tab: b.dataset.tab || null,
        cc: b.dataset.ccAction || null, code: b.dataset.ccGo || null };
    })(),
  }));
  return {
    present: !!document.querySelector(".cc-doctor"),
    verdict: document.querySelector(".cc-doctor-verdict strong")?.textContent.trim() || null,
    stamp: document.querySelector(".cc-doctor-verdict span")?.textContent.trim() || null,
    tone: (document.querySelector(".cc-doctor")?.className.match(/cc-doctor (\\w+)/) || [])[1] || null,
    tally: [...document.querySelectorAll(".doc-tally")].map(n => ({
      level: (n.className.match(/doc-tally (\\w+)/) || [])[1],
      n: Number(n.querySelector("b").textContent.trim()) })),
    rows,
    reasons: [...document.querySelectorAll(".cc-reason")].map(n => n.className),
    badge: (() => {
      const m = (document.querySelector(".plan-health-badge")?.textContent || "").match(/(\\d+)\\s*$/);
      return m ? Number(m[1]) : null;
    })(),
  };
})()`;

const openDoctor = async (page) => {
  await gotoTab(page, "command");
  const open = await page.evaluate(() => ui.doctorOpen);
  if (!open) await click(page, '[data-cc-doctor="run"]');
  await page.waitForTimeout(400);
  return page.evaluate(DOCTOR);
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Doctor", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 3 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "Ada Lovelace", additionalGuests: 3 });
  await gotoTab(page, "command");

  // --- 1. the verdict is a named state, and the report is a deliberate act --
  const closed = await page.evaluate(DOCTOR);
  checks.ok(closed.present, "the Plan Doctor lives in the Command Center, not on a page of its own");
  checks.equal(closed.rows.length, 0,
    "its rows are not on screen until someone runs the check — the Command Center is not a report");
  checks.equal(closed.tally.length, 3, "the three levels are always tallied", closed.tally);
  checks.equal(closed.stamp, await page.evaluate(() => t("doctor.neverRun")),
    "and it says plainly that nobody has run it yet");

  const first = await openDoctor(page);
  const verdicts = await page.evaluate(() =>
    ["YES", "WITH_REVIEW", "NO"].map(v => t("doctor.verdict." + v)));
  checks.ok(verdicts.includes(first.verdict),
    "the answer is one of three named states", first.verdict);
  checks.ok(!/\d+\s*%/.test(first.verdict + " " + first.stamp),
    "and never a readiness score", first);
  checks.ok(first.rows.length > 0, "running the check produces the report", first.rows.length);

  // --- 2. no dead-end rows -------------------------------------------------
  //
  // Asserted at the source, not at the screen. A finding added later without a
  // destination still renders a button -- the UI labels it generically rather
  // than showing a raw key -- so a check that only reads the rendered row
  // cannot tell the difference. The defect lives in the module, so that is
  // where the contract is checked: every finding the engine can emit, at every
  // level, must declare a destination the product knows how to reach.
  const declared = await page.evaluate(() => {
    const D = globalThis.MeritPlanDoctor;
    const known = new Set(Object.values(D.GO));
    const e = state.events[0];
    const report = D.run({ phase: "ready", tables: e.tables, guests: e.guests,
      planIssues: [], analysis: e.analysis || null });
    return {
      total: report.all.length,
      undeclared: report.all.filter(f => !f.action || !known.has(f.action.go)).map(f => f.code),
      unsourced: report.all.filter(f => !(f.sources || []).length).map(f => f.code),
      unaffecting: report.all.filter(f => !(f.affects || []).length).map(f => f.code),
    };
  });
  checks.ok(declared.total > 0, "the engine is reachable and produced findings", declared.total);
  checks.equal(declared.undeclared.length, 0,
    "every finding declares a destination the product can reach", declared.undeclared);
  checks.equal(declared.unsourced.length, 0,
    "and says where its facts came from", declared.unsourced);
  checks.equal(declared.unaffecting.length, 0,
    "and what it puts at risk", declared.unaffecting);

  const dead = first.rows.filter(r => !r.go || !r.go.label ||
    !(r.go.tab || r.go.cc || r.go.code));
  checks.equal(dead.length, 0, "so every row on screen carries a control", dead);
  const unlabelled = first.rows.filter(r => /^[a-z][a-zA-Z0-9]*\./.test(r.go.label));
  checks.equal(unlabelled.length, 0, "and the control is a sentence, not a key", unlabelled);

  // Following each one has to actually move the operator. A control that
  // renders and does nothing is the same dead end wearing a button.
  for (const r of first.rows) {
    const sel = r.go.code ? `[data-cc-go="${r.go.code}"]`
      : r.go.cc ? `.doc-row [data-cc-action="${r.go.cc}"]`
        : `.doc-row [data-tab="${r.go.tab}"]`;
    await click(page, sel);
    await page.waitForTimeout(350);
    const where = await page.evaluate(() => ({ tab: ui.tab, screen: ui.screen }));
    checks.ok(where.screen === "workspace" && where.tab !== "command",
      `following "${r.text.slice(0, 46)}" leaves the Command Center for the screen that owns it`, where);
    await gotoTab(page, "command");
  }

  // --- 3. every row says what it is, why, where it came from ---------------
  const thin = first.rows.filter(r => !r.text || !r.why || !r.meta);
  checks.equal(thin.length, 0,
    "each row states what is wrong, why the system believes it, and its source", thin);
  const sourceLabel = await page.evaluate(() => t("doctor.sourceLabel"));
  checks.ok(first.rows.every(r => r.meta.startsWith(sourceLabel)),
    "the source is named, not implied", first.rows.map(r => r.meta));

  // --- 3b. a check's own provenance reaches the row ------------------------
  //
  // Found by rendering, not by reading: the first version compared each input's
  // `origin` against the ORIGINS KEY names ("PRINTED") when the values are
  // words ("printedOnTheDrawing"), so it matched nothing and a finding with
  // perfectly good provenance reported none of it. The values are read from the
  // module here for the same reason the product reads them from the module.
  const provenance = await page.evaluate(() => {
    const O = globalThis.MeritSelfCheck.ORIGINS;
    const e = state.events[0];
    e.analysis = { candidates: [], selfCheck: { checks: [{
      id: "statedTablesVsDetected", verdict: "INCONSISTENT",
      statement: "the drawing states 166 tables; 163 were found", detail: "3 not accounted for",
      inputs: [{ origin: O.PRINTED }, { origin: O.DETECTED }],
      params: { a: 166, b: 163, d: 3, direction: "short" },
    }], summary: { total: 1, consistent: 0, inconsistent: 1, needsReview: 0, notCheckable: 0 } } };
    render();
    const f = globalThis.MeritPlanDoctor.run({ phase: "ready", tables: e.tables,
      guests: e.guests, planIssues: [], analysis: e.analysis })
      .all.find(x => x.code === "planChecksDisagree");
    return { sources: f ? f.sources : null, origins: [O.PRINTED, O.DETECTED] };
  });
  checks.ok(provenance.sources && provenance.sources.includes("DRAWING"),
    "a figure the drawing printed is credited to the drawing", provenance);
  checks.ok(provenance.sources && provenance.sources.includes("ASSISTED_DETECTION"),
    "and a figure the detector produced is credited to Assisted Detection", provenance);

  // The same values must reach the Command Center's own check list as words.
  await gotoTab(page, "command");
  await page.waitForTimeout(300);
  const ccSources = await page.evaluate(() =>
    [...document.querySelectorAll(".cc-check-source")].map(n => n.textContent.trim()));
  checks.ok(ccSources.length > 0 && ccSources.every(s => !/cc\.origin\./.test(s)),
    "and the plan-consistency block names them in words, never as a key", ccSources);

  // --- 4. a reading is not an operational fact -----------------------------
  //
  // The same disagreement, arrived at two different ways, must land at two
  // different levels. Both halves are set up here so the contrast is asserted
  // rather than assumed.
  await page.evaluate(() => {
    const e = state.events[0];
    // What Assisted Detection would have produced: two candidates whose printed
    // numbers were READ as the same value. Shaped exactly as
    // plan-number-integrity.js emits it.
    e.analysis = {
      candidates: [],
      numberIntegrity: {
        summary: { tables: 2, verified: 2, needsReview: 0, unknown: 0, unnumbered: 0, duplicates: 1 },
        findings: [{ kind: "duplicateNumber", severity: "high", number: 12,
          tableIds: ["cand-a", "cand-b"], detail: "2 tables each read as 12" }],
      },
    };
    render();
  });
  const read = await openDoctor(page);
  const readDupe = read.rows.find(r => /12/.test(r.text) && r.level === "NEEDS_REVIEW");
  checks.ok(readDupe,
    "two tables READ as the same number is something to review, not something that blocks",
    read.rows.map(r => `${r.level}: ${r.text}`));
  checks.equal(read.rows.filter(r => r.level === "BLOCKING" && /12/.test(r.text)).length, 0,
    "an uncertain reading never becomes a blocker on its own");

  // Now the operational half: two tables in the plan carrying one number.
  await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = e.tables[1].number;
    render();
  });
  const planDupe = await openDoctor(page);
  const blockingDupe = planDupe.rows.find(r => r.level === "BLOCKING" &&
    /\b(number|numara)\b/i.test(r.text));
  checks.ok(blockingDupe,
    "the same duplication IN THE PLAN is blocking — a guest would be sent to two places",
    planDupe.rows.map(r => `${r.level}: ${r.text}`));
  checks.ok(planDupe.rows.some(r => r.level === "NEEDS_REVIEW" && /12/.test(r.text)),
    "and the reading is still reported, at its own level, rather than being swallowed by it");
  checks.equal(planDupe.verdict, await page.evaluate(() => t("doctor.verdict.NO")),
    "with something blocking, the answer to the question is no");
  checks.equal(planDupe.tone, "blocker", "and the block carries that weight visually");

  // --- 5. nothing is remembered: fixing it removes the row -----------------
  await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T99";
    render();
  });
  await page.waitForTimeout(300);
  const fixed = await page.evaluate(DOCTOR);
  checks.equal(fixed.rows.filter(r => r.level === "BLOCKING").length, 0,
    "renumbering the table removes the blocker without anything being dismissed", fixed.rows);
  checks.equal(fixed.stamp, await page.evaluate(() => t("doctor.changedSince")),
    "and the recorded run says the event has changed rather than implying it was checked");

  // --- 6. a guest seated at a table that no longer exists -------------------
  //
  // Driven through the real seating flow first, then the table is deleted from
  // under it — which is how this state actually arises, and why no UI guard
  // catches it.
  const orphaned = await page.evaluate(() => {
    const e = state.events[0], g = e.guests[0], t0 = e.tables[0];
    g.assignment = { tableId: t0.id, seats: [0, 1, 2, 3], locked: false };
    e.tables = e.tables.filter(x => x.id !== t0.id);
    render();
    return { guest: g.name, tables: e.tables.length };
  });
  checks.equal(orphaned.tables, 2, "the fixture really did remove the table", orphaned);
  const withOrphan = await openDoctor(page);
  const orphanRow = withOrphan.rows.find(r => r.level === "BLOCKING" && r.go.code &&
    r.go.code.startsWith("guestAtMissingTable"));
  checks.ok(orphanRow,
    "a guest holding a seat at a deleted table is blocking — nobody would see it otherwise",
    withOrphan.rows.map(r => `${r.level}: ${r.text}`));

  // --- 7. following a row lands on the thing, not merely on the screen -----
  await click(page, `[data-cc-go="${orphanRow.go.code}"]`);
  await page.waitForTimeout(500);
  const landed = await page.evaluate(() => ({
    tab: ui.tab, screen: ui.screen,
    guest: state.events[0].guests.find(g => g.id === ui.selectedGuestId)?.name || null,
  }));
  checks.equal(landed.tab, "seating", "the row opens the screen that owns the fix");
  checks.equal(landed.screen, "workspace", "without leaving the workspace");
  checks.equal(landed.guest, "Ada Lovelace",
    "and selects the guest the row is about, rather than dropping the operator on a list");

  // --- 8. INFORMATION is reported and demands nothing ----------------------
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests[0].assignment = null;
    render();
  });
  const info = await openDoctor(page);
  const infoRows = info.rows.filter(r => r.level === "INFORMATION");
  checks.ok(infoRows.length > 0,
    "spare capacity is reported as information", info.rows.map(r => r.level));
  checks.ok(infoRows.every(r => r.go && r.go.label),
    "information rows are actionable too — they are not a dead end just because they are calm", infoRows);
  const attention = await page.evaluate(() =>
    [...document.querySelectorAll(".cc-reason")].map(n => n.querySelector("b").textContent.trim()));
  checks.ok(!attention.some(a => infoRows.some(r => r.text === a)),
    "and none of it appears in the list of things needing a decision", { attention, infoRows });

  // --- 9. the badge, the attention list and the Doctor agree ---------------
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(300);
    const s = await page.evaluate(DOCTOR);
    const tally = Object.fromEntries(s.tally.map(x => [x.level, x.n]));
    checks.equal(s.reasons.length, tally.BLOCKING + tally.NEEDS_REVIEW,
      `the attention list is exactly the blocking and review findings in ${lang.toUpperCase()}`);
    checks.equal(s.badge, s.reasons.length,
      `and the header badge counts the same things in ${lang.toUpperCase()}`);
    checks.equal(s.rows.length, tally.BLOCKING + tally.NEEDS_REVIEW + tally.INFORMATION,
      `the report lists every finding it tallied in ${lang.toUpperCase()}`);
  }

  // --- 9b. the "last run" stamp is not an English island -------------------
  //
  // Found by rendering the Turkish panel: the verdict, the rows and the
  // controls were all translated and the stamp read "son çalıştırma: Just now",
  // because the relative-time helper predates i18n and nothing else live still
  // calls it. A raw-key sweep cannot see this — the leak is real English.
  const stamps = {};
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(250);
    stamps[lang] = await page.evaluate(() =>
      document.querySelector(".cc-doctor-verdict span")?.textContent.trim() || null);
  }
  checks.ok(stamps.en && stamps.tr, "both languages render a stamp", stamps);
  checks.ok(stamps.en !== stamps.tr,
    "and the Turkish one is Turkish, including the time it says", stamps);
  checks.ok(!/\b(just now|ago|hr|min)\b/i.test(stamps.tr),
    "no English time wording survives into the Turkish panel", stamps.tr);

  // --- 10. no raw key in either language -----------------------------------
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(250);
    const leaked = await page.evaluate(() => {
      const root = document.querySelector(".cc-doctor");
      if (!root) return ["(no doctor)"];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
      const found = new Set();
      let n;
      while ((n = walker.nextNode())) {
        const s = n.textContent.trim();
        if (s && s.length <= 80 && KEY.test(s) && !/^\d/.test(s)) found.add(s);
      }
      return [...found];
    });
    checks.equal(leaked.length, 0, `no untranslated key in the Plan Doctor in ${lang.toUpperCase()}`, leaked);
  }
  await page.evaluate(() => { ui.lang = "en"; render(); });

  // --- 11. a finished night has no pre-flight, and cannot acquire one ------
  // The final-check record is asserted separately below; this snapshot is the
  // event itself, which running a pre-flight must never touch.
  const before = await page.evaluate(() => JSON.stringify({
    tables: state.events[0].tables.length,
    guests: state.events[0].guests.length,
    assignments: state.events[0].guests.filter(g => g.assignment).length,
  }));
  await page.evaluate(() => {
    state.events[0].status = "Completed";
    state.events[0].finalCheck = null;
    openEvent(state.events[0].id);
  });
  await page.waitForTimeout(400);
  const historical = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".tabs [data-tab]")].map(b => b.dataset.tab),
    doctor: !!document.querySelector(".cc-doctor"),
    finalCheck: state.events[0].finalCheck || null,
  }));
  checks.ok(!historical.tabs.includes("command"),
    "a completed event has no Command Center, so no pre-flight to run", historical.tabs);
  checks.ok(!historical.doctor, "and the Plan Doctor is not rendered anywhere else");
  checks.equal(historical.finalCheck, null,
    "nothing wrote a final-check record onto a historical event");
  const after = await page.evaluate(() => JSON.stringify({
    tables: state.events[0].tables.length,
    guests: state.events[0].guests.length,
    assignments: state.events[0].guests.filter(g => g.assignment).length,
  }));
  checks.equal(after, before,
    "and reading a historical event through the Doctor changed nothing else about it");
}
