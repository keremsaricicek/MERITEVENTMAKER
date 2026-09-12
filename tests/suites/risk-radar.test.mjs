// What could make this event fail operationally?
//
// The Risk Radar runs no engine. Every row comes from the Plan Doctor, which
// compares facts other layers already concluded — so this suite is mostly about
// the two things a radar gets wrong:
//
//   IT MUST NOT INVENT A NUMBER. "92% ready" has to come from somewhere, and
//   there is no honest weighting of one duplicate table number against twelve
//   unseated guests. The radar says which of four named situations the event is
//   in. A percentage anywhere on it is a defect.
//
//   IT MUST SAY WHAT IT CANNOT SEE. A radar that shows only the risks it knows
//   how to evaluate teaches an operator that a quiet radar means a safe event.
//   The risks this build does not model are named on the screen, from the
//   engine's own list rather than from a sentence somebody typed — so a risk
//   that ships stops being listed by itself.
//
// The rest is the risks Phase J added, each checked where an operator meets it:
// somebody checked in with nowhere to sit, a reserve that already has people in
// it, chairs a No Show freed without the plan being wrong, and an event with no
// copy of itself anywhere.
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "risk-radar", tags: ["business", "fast"], timeout: 180000 };

const RADAR = `(function(){
  const s = document.querySelector(".cc-radar");
  if (!s) return null;
  return {
    title: s.querySelector("h3")?.textContent.trim() || "",
    question: s.querySelector(".cc-radar-head p")?.textContent.trim() || "",
    rows: [...s.querySelectorAll(".cc-reason")].map(r => ({
      level: r.className.includes("blocker") ? "blocker" : "review",
      what: r.querySelector(".cc-reason-body b")?.textContent.trim() || "",
      why: r.querySelector(".cc-reason-body span")?.textContent.trim() || "",
      go: r.querySelector("button")?.textContent.trim() || null,
    })),
    blind: s.querySelector(".cc-radar-blind")?.textContent.trim() || null,
    text: s.textContent,
  };
})()`;

const VERDICT = `document.querySelector(".cc-head")?.className || ""`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Radar", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 3 });

  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 8; e.tables[0].zone = "MAIN FLOOR";
    e.tables[1].number = "T02"; e.tables[1].capacity = 8; e.tables[1].zone = "MAIN FLOOR";
    e.tables[2].number = "T03"; e.tables[2].capacity = 8; e.tables[2].zone = "RESERVE";
    const g = (id, name, pax, extra) => ({
      id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString(), ...extra,
    });
    e.guests = [
      g("g_seated", "Ayşe Demir", 2, { assignment: { tableId: e.tables[0].id, seats: [0, 1], locked: false } }),
    ];
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id, t03: e.tables[2].id };
  });

  await gotoTab(page, "command");
  await settle(page);

  // --- 1. the radar asks the question, and never answers it with a number --
  const first = await page.evaluate(RADAR);
  checks.ok(first, "the Command Center carries a risk radar");
  checks.ok(first.title.length > 0 && !/^[a-z][a-zA-Z.]*$/.test(first.title),
    "with a name, in words", first.title);
  checks.ok(first.question.length > 10, "and the question it answers on its face", first.question);
  checks.ok(!/\d+(\.\d+)?\s*%/.test(first.text),
    "no percentage anywhere on it — there is no honest weighting to derive one from", first.text);
  const verdict = await page.evaluate(VERDICT);
  checks.ok(/verdict-(ready|readyWithReview|notReady|liveRisk)/.test(verdict),
    "the verdict is one of the four named states", verdict);

  // --- 2. it says what it cannot see ---------------------------------------
  const blind = await page.evaluate(() => {
    const list = MeritPlanDoctor.NOT_EVALUATED.map(x => t("radar.notEvaluated." + x.risk));
    return { list, shown: document.querySelector(".cc-radar-blind")?.textContent.trim() || null };
  });
  checks.ok(blind.list.length > 0,
    "the engine names risks this build does not evaluate", blind.list);
  checks.ok(blind.shown, "and the radar shows them rather than implying it covers everything");
  checks.ok(blind.list.every(name => blind.shown.includes(name)),
    "every one of them, in words rather than as an enum", blind);

  // --- 3. an event with no copy of itself is a risk ------------------------
  const backupRisk = await page.evaluate(() => {
    const wording = t("doctor.neverBackedUp");
    const rows = [...document.querySelectorAll(".cc-reason")];
    const row = rows.find(r => r.querySelector(".cc-reason-body b")?.textContent.trim() === wording);
    return row ? { level: row.className.includes("blocker") ? "blocker" : "review",
      go: row.querySelector("button")?.textContent.trim() || null,
      goLabel: t("doctor.go.BACKUP"), stored: state.lastBackupAt || null } : null;
  });
  checks.ok(backupRisk,
    "an event with guests and tables and no exported copy is raised — everything here lives in one browser");
  checks.equal(backupRisk.level, "review",
    "as an open question rather than a blocker: the doors can still open");
  checks.equal(backupRisk.go, backupRisk.goLabel,
    "and its control is the act itself, not a trip to go and find the button");
  checks.equal(backupRisk.stored, null, "nothing has been backed up yet");

  // Pressing it does the thing, and the risk then disappears by itself —
  // the report is derived on every read, so nothing has to clear it.
  await click(page, `[data-cc-go="neverBackedUp"]`);
  await page.waitForTimeout(600);
  const afterBackup = await page.evaluate(() => {
    const wording = t("doctor.neverBackedUp");
    return {
      stored: state.lastBackupAt || null,
      stillRaised: [...document.querySelectorAll(".cc-reason-body b")]
        .some(b => b.textContent.trim() === wording),
    };
  });
  checks.ok(afterBackup.stored, "pressing it takes a real copy and records when", afterBackup);
  checks.ok(!afterBackup.stillRaised,
    "and the risk is gone from the next read without anything having to dismiss it");

  // Change the event and the copy is stale. Information, not a problem.
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests.push({ id: "g_later", name: "Sonradan Eklenen", additionalGuests: 0, pax: 1,
      vip: "Standard", invitedBy: "Host", notes: "", planningStatus: "Confirmed",
      arrivalStatus: "Not Arrived", assignment: null, createdAt: new Date().toISOString() });
    // lastModified is a string timestamp; nudge it past the backup explicitly
    // rather than relying on the two landing in different milliseconds.
    e.lastModified = new Date(Date.now() + 60000).toISOString();
    render();
  });
  await page.waitForTimeout(300);
  const stale = await page.evaluate(() => {
    const d = MeritPlanDoctor.run({
      tables: state.events[0].tables, guests: state.events[0].guests,
      backup: { at: state.lastBackupAt, staleBy: true },
    });
    const f = d.all.find(x => x.code === "backupOlderThanTheEvent");
    return f ? { level: f.level, go: f.action.go } : null;
  });
  checks.ok(stale, "an event that moved on since its backup says so");
  checks.equal(stale.level, "INFORMATION",
    "as information — a copy that exists but is a day old is not an open question");

  // --- 4. somebody is in the room with nowhere to sit ----------------------
  await page.evaluate(() => {
    const e = state.events[0];
    const g = e.guests.find(x => x.id === "g_later");
    g.arrivalStatus = "Checked In";
    touchEvent(e); render();
  });
  await page.waitForTimeout(400);
  const arrived = await page.evaluate(RADAR);
  const arrivedWording = await page.evaluate(() => t("doctor.checkedInWithoutATable.1", { pax: 1, guests: 1, n: 1 }));
  const arrivedRow = arrived.rows.find(r => r.what === arrivedWording);
  checks.ok(arrivedRow,
    "a checked-in guest with no table is raised — they are standing in the room now");
  checks.equal(arrivedRow && arrivedRow.level, "blocker",
    "as BLOCKING: this is not a forecast, it is already true");
  // LIVE RISK rather than NOT READY, and that distinction is the point: the
  // doors are open — somebody has checked in — so this is not a pre-flight
  // problem to fix before opening, it is a problem happening on the floor.
  checks.equal(await page.evaluate(VERDICT), "cc-head verdict-liveRisk",
    "and the event reads as LIVE RISK: the doors are already open");
  checks.ok(arrivedRow && arrivedRow.go, "with somewhere to go", arrivedRow);

  // Planning status is a different axis and must not have moved.
  checks.equal(await page.evaluate(() => state.events[0].guests.find(g => g.id === "g_later").planningStatus),
    "Confirmed", "and raising an ARRIVAL risk changed nothing about planning status");

  // Seat them and it is gone, with no dismissal anywhere.
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests.find(g => g.id === "g_later").assignment =
      { tableId: e.tables[1].id, seats: [0], locked: false };
    touchEvent(e); render();
  });
  await page.waitForTimeout(400);
  const cleared = await page.evaluate(RADAR);
  checks.ok(!cleared.rows.some(r => r.what === arrivedWording),
    "seating them clears it — the report is derived, never stored");

  // --- 5. a reserve that already has people in it --------------------------
  //
  // NOT every occupied frozen table. A VIP area or a head table is frozen to
  // protect the people sitting in it; raising those would be crying wolf at
  // the normal case, which is how an operator learns to ignore a radar.
  const freezeCases = await page.evaluate((ids) => {
    const e = state.events[0];
    const seatOn = (tableId) => e.guests.find(g => g.id === "g_seated").assignment = { tableId, seats: [0, 1], locked: false };
    const runWith = (reason, tableId) => {
      seatOn(tableId);
      const freezes = [{ id: "f1", scope: "TABLE", tableId, reason, note: "", createdAt: new Date().toISOString() }];
      const d = MeritPlanDoctor.run({
        tables: e.tables, guests: e.guests,
        frozen: MeritSeatingFreeze.resolve(freezes, e.tables),
      });
      return !!d.all.find(x => x.code === "reservedAreaOccupied");
    };
    return {
      lateArrival: runWith("LATE_ARRIVAL_RESERVE", ids.t01),
      managementHold: runWith("MANAGEMENT_HOLD", ids.t01),
      vipArea: runWith("VIP_AREA", ids.t01),
      headTables: runWith("HEAD_TABLES", ids.t01),
      sponsor: runWith("SPONSOR_TABLES", ids.t01),
      emptyReserve: (() => {
        seatOn(ids.t01);
        const freezes = [{ id: "f2", scope: "TABLE", tableId: ids.t03,
          reason: "LATE_ARRIVAL_RESERVE", note: "", createdAt: new Date().toISOString() }];
        const d = MeritPlanDoctor.run({ tables: e.tables, guests: e.guests,
          frozen: MeritSeatingFreeze.resolve(freezes, e.tables) });
        return !!d.all.find(x => x.code === "reservedAreaOccupied");
      })(),
    };
  }, room);
  checks.ok(freezeCases.lateArrival,
    "a table held for late arrivals that already has guests on it is a contradiction, and is raised");
  checks.ok(freezeCases.managementHold, "so is a management hold with people on it");
  checks.ok(!freezeCases.vipArea,
    "a VIP area with guests in it is NOT — the freeze is protecting exactly those people");
  checks.ok(!freezeCases.headTables, "nor are head tables");
  checks.ok(!freezeCases.sponsor, "nor sponsor tables");
  checks.ok(!freezeCases.emptyReserve, "and a reserve nobody is sitting in is simply a reserve");

  // --- 6. No Show frees a chair without making the plan wrong --------------
  const noShow = await page.evaluate(() => {
    const e = state.events[0];
    const g = e.guests.find(x => x.id === "g_seated");
    const planned = JSON.parse(JSON.stringify(g.assignment));
    g.arrivalStatus = "No Show";
    const d = MeritPlanDoctor.run({ tables: e.tables, guests: e.guests });
    const f = d.all.find(x => x.code === "chairsFreedByNoShow");
    return {
      found: !!f, level: f && f.level, pax: f && f.params.pax, go: f && f.action.go,
      why: f && f.why,
      // The domain rule this row sits next to, checked here because the row
      // would be the obvious place for it to get broken.
      assignmentKept: JSON.stringify(g.assignment) === JSON.stringify(planned),
      planningUntouched: g.planningStatus,
    };
  });
  checks.ok(noShow.found, "a No Show's chair is reported as physically free tonight");
  checks.equal(noShow.level, "INFORMATION",
    "as information: the plan is not wrong, the room simply has room");
  checks.equal(noShow.pax, 2, "counting the whole party", noShow);
  checks.equal(noShow.go, "LIVE", "and it points at the arrivals screen");
  checks.ok(/keeps its planned seat on purpose|correct/i.test(noShow.why || ""),
    "the wording says the plan is right, never that it needs fixing", noShow.why);
  checks.ok(noShow.assignmentKept, "the planned seat is untouched — No Show never clears an assignment");
  checks.equal(noShow.planningUntouched, "Confirmed", "and planning status is a separate axis");

  // --- 7. every radar row is still actionable ------------------------------
  //
  // Driven back to a state that really has open questions. INFORMATION rows
  // never reach the radar — that is the difference between the radar and the
  // pre-flight report, and a radar padded with things that demand nothing is
  // how an operator learns the list is safe to ignore.
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests.find(g => g.id === "g_seated").arrivalStatus = "No Show";
    e.guests.find(g => g.id === "g_later").assignment = null;
    touchEvent(e); render();
  });
  await page.waitForTimeout(400);
  const final = await page.evaluate(RADAR);
  checks.ok(final.rows.length > 0, "the radar has something to say", final.rows.length);
  checks.equal(final.rows.filter(r => !r.go).length, 0,
    "and every row on it carries a control — a row that cannot say where to go does not belong here",
    final.rows.filter(r => !r.go));
  checks.equal(final.rows.filter(r => /^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(r.what)).length, 0,
    "in words, never a raw translation key", final.rows.map(r => r.what));

  // --- 8. both languages ---------------------------------------------------
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      const s = document.querySelector(".cc-radar");
      out[lang] = {
        title: s?.querySelector("h3")?.textContent.trim() || "",
        question: s?.querySelector(".cc-radar-head p")?.textContent.trim() || "",
        blind: s?.querySelector(".cc-radar-blind")?.textContent.trim() || "",
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  for (const lang of ["en", "tr"]) {
    checks.ok(Object.values(words[lang]).every(v => v.length > 0), `${lang}: the radar is written`, words[lang]);
  }
  checks.ok(words.en.question !== words.tr.question,
    "and Turkish is really Turkish, not English left in place", words);
  checks.ok(words.en.blind !== words.tr.blind, "including what it says it cannot see", words);
}
