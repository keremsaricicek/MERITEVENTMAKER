// Finding one guest, at a door, with a queue behind them.
//
// The global search was a name-and-table lookup that offered a single
// destination. The question at a door is rarely "where is this name" on its
// own — it is who is this, are they expected, have they arrived, where do they
// sit, who came with them — and then one action. Four things are load-bearing:
//
//   SPEED IS AN INDEX, NOT A PROMISE. The old search ran a table lookup INSIDE
//   the filter, so every keystroke cost O(guests x tables). This suite builds a
//   real four-thousand-guest event and MEASURES a search, because "should be
//   fast" is exactly the claim that rots.
//
//   THE ROW IS THE ANSWER. Party size, VIP, planning status, arrival status,
//   table, seats, zone and host, without a second click.
//
//   NOTHING MOVES BY ITSELF. CHANGE TABLE opens Seating with the guest selected
//   and waits for a person. Silently reseating somebody is the one thing this
//   product must never do, and a "smart" finder is exactly where that would
//   creep in.
//
//   THE TWO STATUS AXES STAY SEPARATE. Checking somebody in must never touch
//   their planning status.
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "guest-finder", tags: ["business", "fast"], timeout: 150000 };

// Guests are built through the model rather than the dialog: this suite is
// about search behaviour, and four thousand dialog round-trips would measure
// Playwright rather than the product.
const SEED = `(function(){
  const e = state.events[0];
  const hosts = ["Kerem Sarıçiçek", "International Marketing", "Milica V.", "Loyalty Desk"];
  const vips = ["Standard", "VIP", "VVIP"];
  const made = [];
  for (let i = 0; i < 4000; i++) {
    made.push({
      id: "g_" + i,
      name: "Guest " + String(i).padStart(4, "0"),
      additionalGuests: i % 4, pax: 1 + (i % 4),
      vip: vips[i % 3],
      invitedBy: hosts[i % 4],
      notes: "",
      planningStatus: i % 5 === 0 ? "Tentative" : "Confirmed",
      arrivalStatus: "Not Arrived",
      assignment: null,
      createdAt: new Date().toISOString(),
    });
  }
  // Three named guests with real shapes to assert on.
  made.push({ id: "g_yilmaz", name: "Mehmet Yılmaz", additionalGuests: 3, pax: 4,
    vip: "VVIP", invitedBy: "Kerem Sarıçiçek", notes: "", planningStatus: "Confirmed",
    arrivalStatus: "Not Arrived", assignment: null, createdAt: new Date().toISOString() });
  // TENTATIVE on purpose. A guest who is already Confirmed cannot prove that
  // checking in leaves planning status alone — writing "Confirmed" over
  // "Confirmed" changes nothing and the check passes either way. Caught by
  // mutating the product to set planningStatus on check-in: the suite stayed
  // green, which meant the most important domain rule here was unguarded.
  made.push({ id: "g_rossi", name: "Sofia Rossi", additionalGuests: 1, pax: 2,
    vip: "VIP", invitedBy: "International Marketing", notes: "", planningStatus: "Tentative",
    arrivalStatus: "Not Arrived", assignment: null, createdAt: new Date().toISOString() });
  made.push({ id: "g_lonely", name: "Zeynep Tek", additionalGuests: 0, pax: 1,
    vip: "Standard", invitedBy: "", notes: "", planningStatus: "Confirmed",
    arrivalStatus: "Not Arrived", assignment: null, createdAt: new Date().toISOString() });
  e.guests = made;
  // Seat Mr Yılmaz at the first table so the seated path is real.
  const t = e.tables[0];
  e.guests.find(g => g.id === "g_yilmaz").assignment = { tableId: t.id, seats: [0,1,2,3], locked: false };
  touchEvent(e);
  render();
  return { guests: e.guests.length, table: t.number, zone: t.zone };
})()`;

const READ = `(function(){
  const rows = [...document.querySelectorAll(".find-row")].map(r => ({
    name: r.querySelector("strong")?.textContent.trim() || "",
    meta: [...r.querySelectorAll(".find-meta")].map(m => m.textContent.trim()),
    active: r.classList.contains("active"),
    actions: [...r.querySelectorAll("[data-find-action]")].map(b => ({
      action: b.dataset.findAction, label: b.textContent.trim(), enabled: !b.disabled,
      title: b.getAttribute("title") || "",
    })),
  }));
  return {
    open: !document.getElementById("globalSearchResults")?.classList.contains("hidden"),
    rows,
    more: document.querySelector(".find-more")?.textContent.trim() || null,
    empty: document.querySelector(".find-empty")?.textContent.trim() || null,
  };
})()`;

const type = async (page, text) => {
  await page.fill("#globalGuestSearch", text);
  await page.waitForTimeout(220);
  return page.evaluate(READ);
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Finder", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 4 });
  const seeded = await page.evaluate(SEED);
  checks.equal(seeded.guests, 4003, "a four-thousand-guest event was built", seeded);

  // --- 1. it is fast, measured rather than asserted -------------------------
  //
  // Two numbers: the first search pays for building the index, every one after
  // it does not. Both are reported; only the warm one is gated, because that is
  // the one an operator feels on every keystroke.
  // Measured through renderGlobalSearch, not the matcher underneath it: that is
  // the whole cost of one keystroke — index, match, rank, and build the rows —
  // and it is the only one of the two an operator can feel. (The matcher itself
  // is closure-scoped and unreachable from here, which is the right shape: the
  // test drives what the product exposes.)
  const timing = await page.evaluate(() => {
    const t0 = performance.now();
    renderGlobalSearch("yıl");
    const cold = performance.now() - t0;
    const runs = [];
    for (const q of ["gue", "guest 12", "vip", "kerem", "sofia", "t0", "confirmed", "guest 0001"]) {
      const s = performance.now();
      renderGlobalSearch(q);
      runs.push(performance.now() - s);
    }
    return { cold: +cold.toFixed(2), warm: +(runs.reduce((a, b) => a + b, 0) / runs.length).toFixed(2),
      worst: +Math.max(...runs).toFixed(2), guests: state.events[0].guests.length };
  });
  checks.ok(true, "search cost over 4,003 guests (ms)", timing);
  checks.ok(timing.warm < 25,
    "a warm search over four thousand guests stays well inside one keystroke", timing);
  checks.ok(timing.worst < 60, "and the worst of eight queries does too", timing);

  // --- 2. every field the phase names is searchable -------------------------
  const byName = await type(page, "Yılmaz");
  checks.ok(byName.rows.some(r => r.name.startsWith("Mehmet Yılmaz")), "by name", byName.rows.slice(0, 3));
  const byHost = await type(page, "Milica");
  checks.ok(byHost.rows.length > 0, "by the host or company who invited them", byHost.rows.slice(0, 2));
  const byVip = await type(page, "VVIP");
  checks.ok(byVip.rows.length > 0, "by VIP level", byVip.rows.slice(0, 2));
  const byStatus = await type(page, "Tentative");
  checks.ok(byStatus.rows.length > 0, "by planning status", byStatus.rows.slice(0, 2));
  const byTable = await type(page, seeded.table);
  checks.ok(byTable.rows.some(r => r.name.startsWith("Mehmet Yılmaz")),
    "and by the table number they are sitting at", byTable.rows.slice(0, 3));

  // Terms narrow rather than widen — an OR search over four thousand guests is
  // the same as no search at all.
  const wide = await type(page, "kerem");
  const narrow = await type(page, "kerem yılmaz");
  checks.ok(narrow.rows.length < wide.rows.length || wide.more,
    "two terms narrow the result rather than widening it",
    { wide: wide.rows.length, narrow: narrow.rows.length });
  checks.ok(narrow.rows.every(r => /Yılmaz/i.test(r.name)),
    "every remaining row matches both terms", narrow.rows.map(r => r.name));

  // --- 3. the row is the answer --------------------------------------------
  const found = (await type(page, "Mehmet Yılmaz")).rows[0];
  checks.ok(found, "the guest is found");
  checks.equal(found.name, "Mehmet Yılmaz +3",
    "the row shows the record as one guest plus companions, never four records");
  const all = found.meta.join(" | ");
  checks.ok(/4/.test(all), "with total pax", all);
  checks.ok(/VVIP/.test(all), "VIP level", all);
  checks.ok(/Confirmed/i.test(all), "planning status", all);
  checks.ok(/arriv|gel/i.test(all), "arrival status", all);
  // The row prints the table the way the whole product prints it ("T 01"), not
  // the raw stored "T01", so the check compares the parts rather than the
  // spacing.
  const [, prefix, digits] = String(seeded.table).match(/^([A-Za-z]+)0*(\d+)$/) || [];
  checks.ok(new RegExp(prefix + "\\s*0*" + digits + "\\b", "i").test(all),
    "the table they are at", { row: all, table: seeded.table });
  checks.ok(seeded.zone ? all.includes(seeded.zone) : true, "its zone", all);
  checks.ok(/Kerem/.test(all), "and who invited them", all);

  // --- 4. an action is offered only where it can do something ---------------
  checks.equal(found.actions.length, 4, "four actions", found.actions);
  const act = name => found.actions.find(a => a.action === name);
  checks.ok(act("plan").enabled, "a seated guest can be shown on the plan");
  checks.ok(act("party").enabled, "and their party viewed — others share the host");
  checks.ok(act("checkin").enabled, "and checked in");

  const lonely = (await type(page, "Zeynep Tek")).rows[0];
  checks.ok(lonely, "the unseated guest with no host is found");
  const lonelyAct = name => lonely.actions.find(a => a.action === name);
  checks.ok(!lonelyAct("plan").enabled,
    "an unseated guest cannot be shown on a plan, and the control says so rather than doing nothing",
    lonelyAct("plan"));
  checks.ok(lonelyAct("plan").title.length > 10, "with the reason on the control", lonelyAct("plan").title);
  checks.ok(!lonelyAct("party").enabled,
    "and a guest nobody else shares a host with has no party to view", lonelyAct("party"));
  checks.ok(lonelyAct("table").enabled, "but they can still be given a table");

  // --- 5. SHOW ON PLAN lands on the table, not merely on the Floor Plan -----
  await type(page, "Mehmet Yılmaz");
  await click(page, '[data-find-action="plan"]');
  await page.waitForTimeout(450);
  const landed = await page.evaluate(() => {
    const e = state.events[0];
    return { tab: ui.tab, mode: ui.planMode, screen: ui.screen,
      selected: e.tables.find(t => t.id === ui.selectedObjectId)?.number || null,
      highlighted: ui.highlightId === ui.selectedObjectId,
      guest: e.guests.find(g => g.id === ui.selectedGuestId)?.name || null };
  });
  checks.equal(landed.tab, "floor", "it opens the Floor Plan");
  checks.equal(landed.mode, "plan", "in plan mode, not review");
  checks.equal(landed.screen, "workspace", "without leaving the workspace");
  checks.equal(landed.selected, seeded.table, "with the guest's own table selected");
  checks.ok(landed.highlighted, "and highlighted", landed);
  checks.equal(landed.guest, "Mehmet Yılmaz", "and the guest carried across as the context");

  // --- 6. CHECK IN moves one axis and only one -----------------------------
  const before = await page.evaluate(() => {
    const g = state.events[0].guests.find(x => x.id === "g_rossi");
    return { planning: g.planningStatus, arrival: g.arrivalStatus };
  });
  await type(page, "Sofia Rossi");
  await click(page, '[data-find-action="checkin"]');
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => {
    const g = state.events[0].guests.find(x => x.id === "g_rossi");
    // touchEvent() records its own entry after this one, so the check looks in
    // the recent window rather than assuming the newest slot.
    return { planning: g.planningStatus, arrival: g.arrivalStatus,
      assignment: g.assignment,
      audit: (state.audit || []).slice(0, 5).map(a => a.action) };
  });
  checks.equal(after.arrival, "Checked In", "checking in sets arrival status");
  checks.equal(before.planning, "Tentative",
    "the fixture really does put the two axes in different states");
  checks.equal(after.planning, "Tentative",
    "and checking in does NOT touch planning status — they are independent axes");
  checks.equal(after.assignment, null, "nor does it seat anybody");
  checks.ok(after.audit.includes("GUEST_CHECKED_IN"),
    "the arrival is recorded in the audit trail", after.audit);

  // Checking in again is not offered.
  const again = (await type(page, "Sofia Rossi")).rows[0];
  checks.ok(!again.actions.find(a => a.action === "checkin").enabled,
    "a guest already in is not offered a second check-in", again.actions);

  // --- 7. CHANGE TABLE recommends, it does not move -------------------------
  const seatBefore = await page.evaluate(() =>
    JSON.stringify(state.events[0].guests.map(g => g.assignment)));
  await type(page, "Zeynep Tek");
  await click(page, '[data-find-action="table"]');
  await page.waitForTimeout(450);
  const seating = await page.evaluate(() => ({
    tab: ui.tab,
    guest: state.events[0].guests.find(g => g.id === ui.selectedGuestId)?.name || null,
    assignments: JSON.stringify(state.events[0].guests.map(g => g.assignment)),
  }));
  checks.equal(seating.tab, "seating", "it opens Seating");
  checks.equal(seating.guest, "Zeynep Tek", "with the guest selected and waiting for a table");
  checks.equal(seating.assignments, seatBefore,
    "and NOTHING was seated, moved or unseated on the way — a person still chooses");

  // --- 8. the keyboard works, because a door operator does not reach for a mouse
  await page.fill("#globalGuestSearch", "Guest 00");
  await page.waitForTimeout(250);
  const first = await page.evaluate(READ);
  checks.ok(first.rows.length > 1 && first.rows[0].active,
    "the first result is active as soon as there is a list", first.rows.map(r => r.active));
  await page.press("#globalGuestSearch", "ArrowDown");
  await page.waitForTimeout(250);
  const moved = await page.evaluate(READ);
  checks.ok(moved.rows[1]?.active && !moved.rows[0].active,
    "arrow keys move the selection", moved.rows.map(r => r.active));
  await page.press("#globalGuestSearch", "Escape");
  await page.waitForTimeout(250);
  checks.ok(!(await page.evaluate(READ)).open, "and Escape closes the list");

  // --- 9. a large result set says so instead of pretending it is all of them
  const many = await type(page, "Guest");
  checks.ok(many.rows.length <= 12, "a huge match list is capped", many.rows.length);
  checks.ok(many.more && /\d/.test(many.more),
    "and the rest are counted rather than silently dropped", many.more);
  const none = await type(page, "zzzzz-nobody");
  checks.ok(none.empty && none.rows.length === 0, "no match says so plainly", none.empty);

  // --- 9b. the row is Turkish in Turkish, not half of it -------------------
  //
  // A raw-key sweep cannot see this: "Confirmed" is real English, not a key, and
  // it reached the Turkish row because planning status is stored in English as a
  // domain value and was rendered straight through. Arrival status had already
  // been translated at the boundary; planning status had not, and only rendering
  // the two languages side by side showed the difference.
  const said = {};
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(200);
    said[lang] = (await type(page, "Sofia Rossi")).rows[0].meta.join(" | ");
  }
  checks.ok(said.en && said.tr, "both languages render the row", said);
  checks.ok(said.en !== said.tr, "and the Turkish one is actually Turkish", said);
  checks.ok(!/\b(Confirmed|Tentative|pax|not arrived|checked in|no show|invited by)\b/i.test(said.tr),
    "no English status, count or label survives into the Turkish row", said.tr);

  // --- 10. no raw key in either language -----------------------------------
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(200);
    await type(page, "Mehmet Yılmaz");
    const leaked = await page.evaluate(() => {
      const root = document.getElementById("globalSearchResults");
      if (!root) return ["(no results box)"];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
      const found = new Set();
      let n;
      while ((n = walker.nextNode())) {
        const s = n.textContent.trim();
        if (s && s.length <= 60 && KEY.test(s)) found.add(s);
      }
      return [...found];
    });
    checks.equal(leaked.length, 0, `no untranslated key in the finder in ${lang.toUpperCase()}`, leaked);
  }
  await page.evaluate(() => { ui.lang = "en"; render(); });

  // --- 11. a finished event is readable and unchangeable -------------------
  await page.evaluate(() => { state.events[0].status = "Completed"; openEvent(state.events[0].id); });
  await page.waitForTimeout(400);
  const historical = await type(page, "Mehmet Yılmaz");
  checks.ok(historical.rows.length > 0, "a completed event can still be searched", historical.rows.length);
  const hist = historical.rows[0].actions;
  checks.ok(!hist.find(a => a.action === "checkin").enabled,
    "but nobody can be checked in on it", hist);
  checks.ok(!hist.find(a => a.action === "table").enabled,
    "and nobody can be reseated", hist);
  checks.ok(hist.find(a => a.action === "plan").enabled,
    "while showing them on the plan still works — reading is not a mutation", hist);
}
