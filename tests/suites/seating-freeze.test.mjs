// What may not be seated, and who said so.
//
// A freeze is a rule about a PLACE. This suite exists to keep five properties
// true, because each one is easy to lose and expensive to lose quietly:
//
//   NOTHING CROSSES A FREEZE SILENTLY. Every path that changes an assignment —
//   a seat row, the table card, a drag, Smart Seating's Apply — is stopped by
//   the same evaluation. The whole-room snapshot is compared after each attempt,
//   so a path that mutated and THEN challenged would fail here, not in
//   production.
//
//   AN OVERRIDE AUTHORISES ONE OPERATION AND NEVER LIFTS THE FREEZE. The second
//   attempt is challenged again. This is the check that would catch an
//   "overridden" flag being stored somewhere convenient.
//
//   THE RULE IS A RULE, NOT A LIST OF TABLES. A zone freeze covers a table
//   moved into the zone afterwards; a range freeze covers a table created
//   inside the range afterwards.
//
//   SMART SEATING RESPECTS FREEZES. A frozen table is never RECOMMENDED, and the
//   constraint row that used to read "not set up yet" now carries a real state.
//
//   THE OVERRIDE CARD MAKES THE CASE. What is frozen, why, who it touches, and
//   what the numbers become — all of it, before anything moves.
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "seating-freeze", tags: ["business", "fast"], timeout: 180000 };

const SNAPSHOT = `JSON.stringify(state.events[0].guests.map(g => [g.id, g.assignment]))`;

const CHALLENGE = `(function(){
  const c = document.querySelector(".freeze-challenge");
  if (!c) return null;
  return {
    title: c.querySelector(".fc-head strong")?.textContent.trim() || "",
    direction: c.querySelector(".fc-head span")?.textContent.trim() || "",
    what: [...c.querySelectorAll(".fc-what li")].map(li => ({
      scope: li.querySelector("b")?.textContent.trim() || "",
      reason: li.querySelector("span")?.textContent.trim() || "",
      note: li.querySelector("em")?.textContent.trim() || null,
    })),
    rows: [...c.querySelectorAll(".fc-row")].map(r => ({
      label: r.querySelector("em")?.textContent.trim() || "",
      values: [...r.querySelectorAll("b")].map(b => b.textContent.trim()),
    })),
    nothing: c.querySelector(".fc-nothing")?.textContent.trim() || null,
    stays: c.querySelector(".fc-stays")?.textContent.trim() || null,
    canOverride: !!c.querySelector("[data-freeze-action='override']"),
  };
})()`;

const PANEL = `[...document.querySelectorAll(".ss-option b")].map(b => b.textContent.replace(/\\s+/g, ""))`;

// Selecting a guest the way a real click does. selectGuestRecord() writes BOTH
// selectedGuestId and selectedGuestIds, and the seating paths read the plural
// one first — a helper that set only the singular left a stale multi-selection
// behind and silently re-seated the wrong guest two steps later.
const selectGuest = async (page, id) => {
  await page.evaluate(gid => {
    ui.selectedGuestId = gid; ui.selectedGuestIds = [gid]; ui.seatPreview = null; render();
  }, id);
  await page.waitForTimeout(300);
};

// Seat through the table card, which is the shortest real operator path: pick
// the table, press the assign button. Deliberately NOT a direct call into the
// closure — the point is that the gate sits where the operator meets it.
const seatVia = async (page, tableId, guestId) => {
  await page.evaluate(id => { ui.selectedTableId = id; render(); }, tableId);
  await page.waitForTimeout(250);
  await selectGuest(page, guestId);
  await page.evaluate(id => { ui.selectedTableId = id; render(); }, tableId);
  await page.waitForTimeout(250);
  await click(page, `[data-assign-selected="${tableId}"]`);
  await page.waitForTimeout(400);
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Freeze", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 4 });

  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 8; e.tables[0].zone = "VIP FRONT";
    e.tables[1].number = "T02"; e.tables[1].capacity = 8; e.tables[1].zone = "MAIN FLOOR";
    e.tables[2].number = "T03"; e.tables[2].capacity = 8; e.tables[2].zone = "MAIN FLOOR";
    e.tables[3].number = "T04"; e.tables[3].capacity = 8; e.tables[3].zone = "VIP FRONT";
    const g = (id, name, pax, assignment) => ({
      id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment, createdAt: new Date().toISOString(),
    });
    e.guests = [
      g("g_move", "Mehmet Yılmaz", 2, null),
      // Two records already sitting inside what is about to become the frozen
      // VIP area. Two rather than one so the card's count is exercised in the
      // plural as well as the singular.
      g("g_inside", "Ayşe Demir", 3, { tableId: e.tables[0].id, seats: [0, 1, 2], locked: false }),
      g("g_inside2", "Burak Şahin", 2, { tableId: e.tables[0].id, seats: [3, 4], locked: false }),
      g("g_open", "Can Öztürk", 2, { tableId: e.tables[1].id, seats: [0, 1], locked: false }),
    ];
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id, t03: e.tables[2].id, t04: e.tables[3].id };
  });

  await gotoTab(page, "seating");
  await settle(page);

  // --- 1. nothing is frozen to begin with ----------------------------------
  const emptyPanel = await page.evaluate(() => ({
    present: !!document.querySelector(".freeze-panel"),
    empty: !!document.querySelector(".fz-empty"),
    rows: document.querySelectorAll(".fz-row").length,
    layerButton: document.querySelectorAll("[data-freeze-action='layer']").length,
  }));
  checks.ok(emptyPanel.present, "Seating offers a place to hold part of the room back");
  checks.ok(emptyPanel.empty && emptyPanel.rows === 0, "and says plainly that nothing is frozen yet");
  checks.equal(emptyPanel.layerButton, 0,
    "with no layer toggle on the toolbar — a permanent switch for an empty layer teaches an operator to stop reading the toolbar");

  const before = await page.evaluate(SNAPSHOT);

  // --- 2. freezing a zone, through the real form ---------------------------
  await click(page, "[data-freeze-action='open-form']");
  await page.waitForSelector("[data-freeze-form]", { timeout: 8000 });
  await page.selectOption("[data-freeze-field='scope']", "ZONE");
  await page.waitForTimeout(250);
  await page.selectOption("[data-freeze-field='zone']", "VIP FRONT");
  await page.selectOption("[data-freeze-field='reason']", "VIP_AREA");
  await page.fill("[data-freeze-field='note']", "Host confirms at 20:00");
  await click(page, "[data-freeze-action='create']");
  await page.waitForTimeout(500);

  const stored = await page.evaluate(() => {
    const e = state.events[0];
    return {
      count: (e.freezes || []).length,
      scope: e.freezes[0]?.scope, reason: e.freezes[0]?.reason, note: e.freezes[0]?.note,
      frozen: [...MeritSeatingFreeze.frozenTableIds(e.freezes, e.tables)],
      audit: (state.audit || []).filter(a => a.action === "FREEZE_CREATED").length,
    };
  });
  checks.equal(stored.count, 1, "the freeze is stored on the event");
  checks.equal(stored.scope, "ZONE", "as a rule about a zone");
  checks.equal(stored.reason, "VIP_AREA", "carrying the reason a person chose");
  checks.equal(stored.note, "Host confirms at 20:00", "and their own words alongside it");
  checks.equal(stored.frozen.length, 2, "both VIP FRONT tables are covered", stored.frozen);
  checks.equal(stored.audit, 1, "creating a freeze is recorded");

  checks.equal(await page.evaluate(SNAPSHOT), before, "and freezing an area moved nobody");

  // --- 3. the layer draws it, without burying the plan ----------------------
  const layer = await page.evaluate(() => ({
    button: document.querySelectorAll("[data-freeze-action='layer']").length,
    frozenTables: document.querySelectorAll(".table-object.frozen").length,
    marks: document.querySelectorAll(".table-frozen").length,
    // A freeze must never be drawn as a filled block over the drawing.
    opaque: [...document.querySelectorAll(".table-object.frozen")].some(el => {
      const s = getComputedStyle(el, "::after");
      const bg = s.backgroundColor || "";
      const m = /rgba?\(([^)]+)\)/.exec(bg);
      if (!m) return false;
      const parts = m[1].split(",").map(Number);
      return parts.length < 4 || parts[3] > 0.25;
    }),
  }));
  checks.equal(layer.button, 1, "the layer toggle appears now that there is something to show");
  checks.equal(layer.frozenTables, 2, "both frozen tables are marked on the canvas");
  checks.equal(layer.marks, 2, "each carries a lock mark");
  checks.ok(!layer.opaque, "and none of them is covered by a heavy opaque block");

  await click(page, "[data-freeze-action='layer']");
  await page.waitForTimeout(300);
  checks.equal(await page.evaluate(() => document.querySelectorAll(".table-object.frozen").length), 0,
    "switching the layer off hides the marks");
  await click(page, "[data-freeze-action='layer']");
  await page.waitForTimeout(300);

  // --- 4. Smart Seating respects it ----------------------------------------
  await selectGuest(page, "g_move");
  const offered = await page.evaluate(PANEL);
  checks.ok(offered.length > 0, "the advisor still offers somewhere to sit", offered);
  checks.ok(!offered.includes("T01") && !offered.includes("T04"),
    "but never recommends a frozen table — routing around a rule a person set is exactly what a freeze forbids", offered);
  checks.ok(offered.includes("T02") || offered.includes("T03"),
    "the open tables are still offered", offered);

  const blockedReason = await page.evaluate(() => {
    const e = state.events[0];
    const r = MeritSeatingAdvisor.recommend({
      guest: e.guests.find(g => g.id === "g_move"), tables: e.tables, guests: e.guests,
      frozen: MeritSeatingFreeze.resolve(e.freezes, e.tables),
    });
    return r.blocked.filter(b => b.why === "FROZEN").map(b => b.number);
  });
  checks.equal(blockedReason.sort().join(","), "T01,T04",
    "and says FROZEN as the reason rather than dropping them without one", blockedReason);

  // The constraint row that used to say "not set up yet" now answers.
  await page.evaluate(() => { ui.selectedGuestId = "g_move"; render(); });
  await page.waitForTimeout(250);
  const t02 = room.t02;
  await click(page, `[data-seat-preview="${t02}"]`);
  await page.waitForTimeout(400);
  const constraintRow = await page.evaluate(() => {
    const label = t("seat.constraint.FREEZE_ZONES");
    const row = [...document.querySelectorAll(".seat-preview .sp-row")]
      .find(r => r.querySelector("em")?.textContent.trim() === label);
    return row ? { value: row.querySelector("b")?.textContent.trim(), muted: row.classList.contains("muted") } : null;
  });
  checks.ok(constraintRow && !constraintRow.muted,
    "the preview's freeze row carries a real answer now, not 'not set up yet'", constraintRow);
  await click(page, "[data-seat-cancel]");
  await page.waitForTimeout(300);

  // --- 5. seating INTO the frozen area is challenged, not done -------------
  await seatVia(page, room.t04, "g_move");
  const challenge = await page.evaluate(CHALLENGE);
  checks.ok(challenge, "seating into a frozen area stops and asks");
  checks.equal(await page.evaluate(SNAPSHOT), before,
    "and NOTHING was seated while the question is on screen");
  checks.ok(challenge.canOverride, "a supervisor override is offered");
  checks.ok(challenge.nothing && /\S/.test(challenge.nothing), "the card says nothing has changed yet");
  checks.ok(challenge.stays && /\S/.test(challenge.stays),
    "and that the freeze stays in place afterwards", challenge.stays);

  // Blocking means blocking. The table card sits in the same column with its
  // own "Seat this guest" button; if the scrim did not cover it, the control
  // that raised the question would still be clickable underneath it.
  const covered = await page.evaluate(() => {
    const card = document.querySelector(".table-card");
    if (!card) return "no table card";
    const r = card.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && hit.closest(".freeze-challenge-scrim") ? "covered" : "reachable";
  });
  checks.equal(covered, "covered", "and the card underneath it cannot be clicked through");

  // The whole case for the decision, in one card.
  checks.equal(challenge.what.length, 1, "it names what is frozen", challenge.what);
  checks.ok(/VIP FRONT/i.test(challenge.what[0].scope), "with the scope the operator wrote", challenge.what[0]);
  checks.ok(challenge.what[0].reason && /\S/.test(challenge.what[0].reason), "and why", challenge.what[0]);
  checks.equal(challenge.what[0].note, "Host confirms at 20:00", "including their own note");
  const labels = await page.evaluate(() => ({
    moved: t("freeze.beingMoved"), inArea: t("freeze.alreadyInArea"),
  }));
  const moved = challenge.rows.find(r => r.label === labels.moved);
  const inArea = challenge.rows.find(r => r.label === labels.inArea);
  const affected = await page.evaluate(() => ({
    one: t("seat.affectedValue", { guests: 1, pax: 2 }),
    many: t("seat.affectedValue.n", { guests: 2, pax: 5 }),
  }));
  checks.equal(moved && moved.values[0], affected.one,
    "how many records and pax are being moved", moved);
  checks.equal(inArea && inArea.values[0], affected.many,
    "and how many people are already sitting inside the AREA — every table the rule covers, not just the one being touched, and a different fact from the first, never summed with it", inArea);
  checks.ok(!/\b2 record\b/.test(inArea.values[0]),
    "counted in the plural when there is more than one", inArea.values[0]);
  const impact = challenge.rows.find(r => /T\s*04/.test(r.label));
  checks.ok(impact && impact.values.length === 2, "with the target table's occupancy before and after", impact);
  checks.equal(impact && impact.values[0], "0/8", "before: empty");
  checks.equal(impact && impact.values[1], "2/8", "after: the party would be on it");

  // --- 6. cancelling authorises nothing ------------------------------------
  await click(page, "[data-freeze-action='cancel-override']");
  await page.waitForTimeout(350);
  checks.ok(!(await page.evaluate(CHALLENGE)), "cancelling closes the card");
  checks.equal(await page.evaluate(SNAPSHOT), before, "and seated nobody");

  // Escape is the same answer, and is the only thing it closes.
  await seatVia(page, room.t04, "g_move");
  checks.ok(await page.evaluate(CHALLENGE), "the challenge comes back on the next attempt");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  checks.ok(!(await page.evaluate(CHALLENGE)), "Escape declines it");
  checks.equal(await page.evaluate(SNAPSHOT), before, "having authorised nothing");

  // --- 7. only an explicit override seats anybody --------------------------
  await seatVia(page, room.t04, "g_move");
  await click(page, "[data-freeze-action='override']");
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const e = state.events[0];
    const g = e.guests.find(x => x.id === "g_move");
    const table = e.tables.find(x => x.id === g.assignment?.tableId);
    return {
      table: table?.number || null, seats: g.assignment?.seats.length || 0,
      stillFrozen: (e.freezes || []).length,
      overrides: (state.audit || []).filter(a => a.action === "FREEZE_OVERRIDDEN").length,
      lifted: (state.audit || []).filter(a => a.action === "FREEZE_LIFTED").length,
    };
  });
  checks.equal(after.table, "T04", "the supervisor's decision seats the party where they chose");
  checks.equal(after.seats, 2, "with the whole party");
  checks.equal(after.overrides, 1, "and the override is recorded");
  checks.equal(after.stillFrozen, 1, "the freeze is STILL in place — an override is not an unlock");
  checks.equal(after.lifted, 0, "nothing lifted it as a side effect");

  // --- 8. the next operation is challenged again ---------------------------
  await page.evaluate(() => { ui.selectedTableId = null; render(); });
  await page.waitForTimeout(200);
  await seatVia(page, room.t01, "g_open");
  checks.ok(await page.evaluate(CHALLENGE),
    "the very next crossing is stopped too — one authorisation, one operation");
  await click(page, "[data-freeze-action='cancel-override']");
  await page.waitForTimeout(350);

  // --- 9. leaving a frozen area is a crossing too --------------------------
  await page.evaluate(() => { ui.selectedTableId = state.events[0].tables[0].id; render(); });
  await page.waitForTimeout(300);
  await click(page, "[data-unassign='g_inside']");
  await page.waitForTimeout(450);
  const outward = await page.evaluate(CHALLENGE);
  checks.ok(outward, "pulling somebody OUT of a frozen area is challenged as well");
  checks.ok(/OUT|ÇIKAR|çıkar/i.test(outward.direction),
    "and the card says which way the rule is being crossed", outward.direction);
  checks.ok(await page.evaluate(() => !!state.events[0].guests.find(g => g.id === "g_inside").assignment),
    "with the guest still sitting exactly where they were");
  await click(page, "[data-freeze-action='cancel-override']");
  await page.waitForTimeout(350);

  // --- 10. the rule covers tables it has never seen ------------------------
  const laterTable = await page.evaluate(() => {
    const e = state.events[0];
    const t = JSON.parse(JSON.stringify(e.tables[2]));
    t.id = "t_later"; t.number = "T09"; t.zone = "VIP FRONT"; t.x += 400;
    e.tables = [...e.tables, t];
    touchEvent(e); render();
    return [...MeritSeatingFreeze.frozenTableIds(e.freezes, e.tables)].includes("t_later");
  });
  checks.ok(laterTable,
    "a table created inside the zone AFTER the freeze is covered — the freeze is a rule, not a list of ids");

  // A range freeze behaves the same way.
  const rangeCovers = await page.evaluate(() => {
    const e = state.events[0];
    const f = MeritSeatingFreeze.normalize({ id: "f_range", scope: "TABLE_GROUP", prefix: "T",
      from: 2, to: 3, reason: "SPONSOR_TABLES" });
    return {
      inRange: MeritSeatingFreeze.tablesCovered(f, e.tables).map(t => t.number).sort(),
      leadingZeros: MeritSeatingFreeze.covers(f, { id: "x", number: "T02" }),
      wrongPrefix: MeritSeatingFreeze.covers(f, { id: "y", number: "B02" }),
    };
  });
  checks.equal(rangeCovers.inRange.join(","), "T02,T03", "a range covers exactly its range", rangeCovers);
  checks.ok(rangeCovers.leadingZeros, "matching the printed number regardless of leading zeros");
  checks.ok(!rangeCovers.wrongPrefix, "and never a different prefix's number");

  // --- 11. a freeze that covers nothing is refused --------------------------
  const refused = await page.evaluate(() => {
    const e = state.events[0];
    const before = (e.freezes || []).length;
    ui.freezeDraft = { scope: "ZONE", zone: "NOWHERE AT ALL", reason: "OTHER", note: "" };
    render();
    return before;
  });
  await page.waitForTimeout(250);
  await click(page, "[data-freeze-action='create']");
  await page.waitForTimeout(400);
  checks.equal(await page.evaluate(() => (state.events[0].freezes || []).length), refused,
    "a freeze matching no table is refused — it would look like protection and be none");

  // --- 12. the Plan Doctor reports what is held ----------------------------
  const doctor = await page.evaluate(() => {
    const e = state.events[0];
    const r = MeritPlanDoctor.run({
      tables: e.tables, guests: e.guests,
      frozenTableIds: [...MeritSeatingFreeze.frozenTableIds(e.freezes, e.tables)],
    });
    const held = r.all.find(f => f.code === "capacityHeldByFreeze");
    return held ? { level: held.level, chairs: held.params.chairs, go: held.action.go,
      tableIds: (held.action.tableIds || []).length } : null;
  });
  checks.ok(doctor, "the Plan Doctor knows how much of the room is being held");
  checks.equal(doctor.level, "INFORMATION",
    "as information — a freeze is a person's decision, never a problem in itself");
  checks.equal(doctor.chairs, 24, "counting every chair inside the freeze", doctor);
  checks.equal(doctor.go, "SEATING", "and it can say where to go");
  checks.ok(doctor.tableIds > 0, "naming the tables, not describing them in a sentence");

  // The one case where a freeze becomes a question rather than a note.
  const squeezed = await page.evaluate(() => {
    const e = JSON.parse(JSON.stringify(state.events[0]));
    // Fill every open table and leave a party with nowhere but the frozen area.
    const frozen = [...MeritSeatingFreeze.frozenTableIds(e.freezes, e.tables)];
    for (const t of e.tables) {
      if (frozen.includes(t.id) || t.hasPhysicalSeats === false) continue;
      e.guests = e.guests.filter(g => g.assignment?.tableId !== t.id);
      e.guests.push({ id: "pad_" + t.id, name: "Pad", pax: t.capacity, additionalGuests: t.capacity - 1,
        planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
        assignment: { tableId: t.id, seats: Array.from({ length: t.capacity }, (_, i) => i), locked: false } });
    }
    e.guests.push({ id: "waiting", name: "Waiting", pax: 6, additionalGuests: 5,
      planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: null });
    const r = MeritPlanDoctor.run({
      tables: e.tables, guests: e.guests,
      frozenTableIds: frozen,
    });
    const f = r.all.find(x => x.code === "frozenCapacityNeeded");
    return f ? { level: f.level, pax: f.params.pax, open: f.params.open, held: f.params.held } : null;
  });
  checks.ok(squeezed, "and raises it when the people waiting cannot be seated without the frozen chairs");
  checks.equal(squeezed.level, "NEEDS_REVIEW",
    "as a decision to take, not as a capacity shortage — the chairs exist");
  checks.ok(squeezed.held > 0, "naming how many held chairs would cover the difference", squeezed);

  // --- 13. lifting is the only way a freeze ends ---------------------------
  const freezeId = await page.evaluate(() => state.events[0].freezes[0].id);
  await gotoTab(page, "seating");
  await settle(page);
  await click(page, `[data-freeze-lift="${freezeId}"]`);
  await page.waitForTimeout(500);
  const lifted = await page.evaluate(() => ({
    freezes: (state.events[0].freezes || []).length,
    audit: (state.audit || []).filter(a => a.action === "FREEZE_LIFTED").length,
    marks: document.querySelectorAll(".table-object.frozen").length,
  }));
  checks.equal(lifted.freezes, 0, "lifting removes the freeze");
  checks.equal(lifted.audit, 1, "and is recorded as a person's act");
  checks.equal(lifted.marks, 0, "the canvas stops marking the area");

  await seatVia(page, room.t01, "g_open");
  checks.ok(!(await page.evaluate(CHALLENGE)), "and the area seats normally again");
  checks.equal(await page.evaluate(() => {
    const e = state.events[0];
    const t = e.tables.find(x => x.id === e.guests.find(g => g.id === "g_open").assignment.tableId);
    return t.number;
  }), "T01", "with the guest actually moved this time");

  // --- 14. it all survives a reload ----------------------------------------
  await page.evaluate(() => {
    const e = state.events[0];
    e.freezes = [{ id: "f_persist", scope: "TABLE_GROUP", prefix: "T", from: 2, to: 3,
      reason: "LATE_ARRIVAL_RESERVE", note: "kapıda bekleyenler için", createdAt: new Date().toISOString() }];
    touchEvent(e);
  });
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => { try { return Array.isArray(state.events) && state.events.length > 0; } catch { return false; } },
    null, { timeout: 20000 });
  const survived = await page.evaluate(() => {
    const e = state.events[0];
    const f = (e.freezes || [])[0];
    return f ? { scope: f.scope, from: f.from, to: f.to, reason: f.reason, note: f.note,
      covers: MeritSeatingFreeze.tablesCovered(f, e.tables).map(t => t.number).sort().join(",") } : null;
  });
  checks.ok(survived, "a freeze survives a reload");
  checks.equal(survived.scope, "TABLE_GROUP", "with its scope");
  checks.equal(survived.from + "-" + survived.to, "2-3", "its range");
  checks.equal(survived.reason, "LATE_ARRIVAL_RESERVE", "its reason");
  checks.equal(survived.note, "kapıda bekleyenler için", "and the operator's own words, in their own language");
  checks.equal(survived.covers, "T02,T03", "still covering the same tables");

  // --- 15. both languages, no raw enums ------------------------------------
  //
  // Raw-key sweeps cannot see this: an English sentence left in the Turkish
  // table reads as perfectly valid output. Comparing the two languages can.
  const words = await page.evaluate(() => {
    const out = {};
    // The reload landed on the events screen; reopen the workspace.
    ui.activeEventId = state.events[0].id; ui.screen = "workspace";
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; ui.tab = "seating"; render();
      out[lang] = {
        title: document.querySelector(".fz-head strong")?.textContent.trim() || "",
        reason: document.querySelector(".fz-reason")?.textContent.trim() || "",
        note: document.querySelector(".fz-note")?.textContent.trim() || "",
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  for (const lang of ["en", "tr"]) {
    const v = Object.values(words[lang]);
    checks.ok(v.every(s => s.length > 0), `${lang}: the panel is written`, words[lang]);
    checks.ok(v.every(s => !/^[A-Z][A-Z_]{3,}$/.test(s)), `${lang}: in words, never a raw enum`, words[lang]);
  }
  checks.ok(words.en.reason !== words.tr.reason,
    "and Turkish is really Turkish, not English left in place", words);
  checks.ok(words.en.note !== words.tr.note, "for the panel's own explanation too", words);
}
