// Where could this party sit, and what would it cost?
//
// Smart Seating is a recommender and nothing else, and this suite exists mostly
// to keep it one. Four rules are load-bearing:
//
//   NOTHING MUTATES BEFORE APPLY. Asking for recommendations changes nothing.
//   Opening a preview changes nothing. Only a person pressing Apply seats
//   anybody. This is checked by snapshotting every assignment in the event and
//   comparing it byte for byte after each step — a targeted check on one guest
//   would miss a recommender that tidied up somebody else along the way.
//
//   A PARTY IS ONE RECORD. "Name +3" needs four seats at ONE table. A table with
//   three free is not a near miss to be offered anyway; splitting the party to
//   make the numbers work is the optimisation this must never make.
//
//   A LOCKED ASSIGNMENT OUTRANKS THE ADVISOR. A locked seat is a person's
//   decision. Nothing is suggested over it, and the screen says why rather than
//   showing an empty panel.
//
//   A CONSTRAINT THAT CANNOT BE EVALUATED SAYS SO. Reporting "no conflict"
//   would be a claim about a feature that has never run. Freeze Zones has since
//   shipped and now answers for real; unavailable tables have not, and still say
//   so. The suite checks both halves, because the interesting failure is a
//   NOT_CONFIGURED row quietly turning into a reassuring one.
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "smart-seating", tags: ["business", "fast"], timeout: 150000 };

// Every assignment in the event, as one comparable string. The whole-room
// snapshot is the point: a recommender that quietly "improved" a different
// guest would pass a check that only watched the one being seated.
const SNAPSHOT = `JSON.stringify(state.events[0].guests.map(g => [g.id, g.assignment]))`;

const PANEL = `(function(){
  return {
    present: !!document.querySelector(".smart-seating"),
    empty: document.querySelector(".ss-empty")?.textContent.trim() || null,
    options: [...document.querySelectorAll(".ss-option")].map(o => ({
      number: o.querySelector("b")?.textContent.trim() || "",
      meta: o.querySelector(".ss-option-head span")?.textContent.trim() || "",
      reasons: [...o.querySelectorAll(".ss-why li")].map(r => r.textContent.trim()),
      tableId: o.querySelector("[data-seat-preview]")?.dataset.seatPreview || null,
    })),
    note: document.querySelector(".ss-note")?.textContent.trim() || null,
  };
})()`;

const PREVIEW = `(function(){
  const p = document.querySelector(".seat-preview");
  if (!p) return null;
  return {
    rows: [...p.querySelectorAll(".sp-row")].map(r => ({
      label: r.querySelector("em")?.textContent.trim() || "",
      values: [...r.querySelectorAll("b")].map(b => b.textContent.trim()),
      muted: r.classList.contains("muted"),
    })),
    nothing: p.querySelector(".sp-nothing")?.textContent.trim() || null,
    canApply: !!p.querySelector("[data-seat-apply]"),
  };
})()`;

const selectGuest = async (page, id) => {
  await page.evaluate(gid => { ui.selectedGuestId = gid; ui.seatPreview = null; render(); }, id);
  await page.waitForTimeout(300);
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Seating", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 4 });

  // A room with deliberately different shapes: one table nearly full, one with
  // exactly the party's size free, one empty, one with no physical seats.
  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 8; e.tables[0].zone = "VIP FRONT";
    e.tables[1].number = "T02"; e.tables[1].capacity = 8; e.tables[1].zone = "MAIN FLOOR";
    e.tables[2].number = "T03"; e.tables[2].capacity = 8; e.tables[2].zone = "MAIN FLOOR";
    e.tables[3].number = "T04"; e.tables[3].capacity = 8; e.tables[3].zone = "MAIN FLOOR";
    e.tables[3].hasPhysicalSeats = false;    // a symbol, not a place to sit
    e.guests = [
      // The party being seated: four pax, VIP, invited by Kerem.
      { id: "g_party", name: "Mehmet Yılmaz", additionalGuests: 3, pax: 4, vip: "VVIP",
        invitedBy: "Kerem Sarıçiçek", notes: "", planningStatus: "Confirmed",
        arrivalStatus: "Not Arrived", assignment: null, createdAt: new Date().toISOString() },
      // Fills T02 down to exactly four free.
      { id: "g_fill", name: "Filler Party", additionalGuests: 3, pax: 4, vip: "Standard",
        invitedBy: "Other", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
        assignment: { tableId: e.tables[1].id, seats: [0,1,2,3], locked: false },
        createdAt: new Date().toISOString() },
      // Leaves T01 with only three free — too few for a four-pax record.
      { id: "g_block", name: "Blocker Party", additionalGuests: 4, pax: 5, vip: "Standard",
        invitedBy: "Other", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
        assignment: { tableId: e.tables[0].id, seats: [0,1,2,3,4], locked: false },
        createdAt: new Date().toISOString() },
    ];
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id, t03: e.tables[2].id, t04: e.tables[3].id };
  });

  await gotoTab(page, "seating");
  const before = await page.evaluate(SNAPSHOT);

  // --- 1. asking changes nothing -------------------------------------------
  await selectGuest(page, "g_party");
  const panel = await page.evaluate(PANEL);
  checks.ok(panel.present, "selecting a guest offers somewhere they could sit");
  checks.equal(await page.evaluate(SNAPSHOT), before,
    "and asking for recommendations moved nobody");

  // --- 2. a party is one record --------------------------------------------
  const numbers = panel.options.map(o => o.number.replace(/\s+/g, ""));
  checks.ok(numbers.includes("T02"),
    "a table with exactly the party's size free is offered", numbers);
  checks.ok(numbers.includes("T03"), "so is an empty one", numbers);
  checks.ok(!numbers.includes("T01"),
    "a table with only three seats free is NOT offered for a four-pax record — the party is not split",
    numbers);
  checks.ok(!numbers.includes("T04"),
    "and a table with no physical seats is not a place to sit", numbers);

  // Asserted against the engine too, so a UI that merely hides T01 cannot pass.
  const engine = await page.evaluate(() => {
    const e = state.events[0];
    const r = MeritSeatingAdvisor.recommend({
      guest: e.guests.find(g => g.id === "g_party"), tables: e.tables, guests: e.guests });
    return { offered: r.options.map(o => o.number),
      blocked: r.blocked.map(b => ({ number: b.number, why: b.why })),
      statement: r.statement };
  });
  checks.ok(engine.blocked.some(b => b.number === "T01" && b.why === "NOT_ENOUGH_SEATS"),
    "the engine says WHY T01 was left out, rather than silently dropping it", engine.blocked);
  checks.ok(engine.blocked.some(b => b.number === "T04" && b.why === "NO_PHYSICAL_SEATS"),
    "and why T04 was", engine.blocked);

  // --- 3. every option carries reasons, in words ---------------------------
  const t02 = panel.options.find(o => o.number.replace(/\s+/g, "") === "T02");
  checks.ok(t02.reasons.length >= 2, "an option states why it is offered", t02.reasons);
  checks.ok(t02.reasons.every(r => r && !/^[A-Z][A-Z_]+$/.test(r)),
    "in words, not as raw enum values", t02.reasons);
  checks.ok(!/\d+(\.\d+)?\s*(%|score)/i.test(JSON.stringify(panel.options)),
    "and never as a score — a reason can be argued with, a number cannot", panel.options);
  checks.ok(panel.note && panel.note.length > 20,
    "the panel says plainly that these are suggestions", panel.note);

  // --- 4. previewing changes nothing ---------------------------------------
  await click(page, `[data-seat-preview="${room.t02}"]`);
  await page.waitForTimeout(400);
  const preview = await page.evaluate(PREVIEW);
  checks.ok(preview, "previewing an option opens the impact card");
  checks.equal(await page.evaluate(SNAPSHOT), before,
    "and NOTHING was seated, moved or unseated by opening it");
  checks.ok(preview.nothing && /\S/.test(preview.nothing),
    "the card says so on its face", preview.nothing);

  // Before → after, computed.
  const target = preview.rows.find(r => /T\s*02/.test(r.label));
  checks.ok(target && target.values.length === 2,
    "the target table shows before and after", target);
  checks.equal(target.values[0], "4/8", "before: four of eight taken");
  checks.equal(target.values[1], "8/8", "after: the party would fill it");
  const reserve = preview.rows.find(r => !/T\s*0/.test(r.label) && r.values.length === 2);
  checks.ok(reserve, "and the room's spare seats are shown before and after", reserve);

  // --- 5. a constraint that cannot be evaluated says so --------------------
  //
  // Freeze Zones USED to be one of these. It shipped, so the same slot now
  // carries a real answer and only the unimplemented constraint is muted —
  // which is the behaviour the NOT_CONFIGURED design promised: the row does
  // not quietly become a clean bill of health, it becomes a true one.
  const unevaluated = preview.rows.filter(r => r.muted);
  checks.equal(unevaluated.length, 1,
    "the one constraint this build still cannot evaluate is reported", unevaluated);
  const notSetUp = await page.evaluate(() => t("seat.notConfigured"));
  checks.ok(unevaluated.every(r => r.values[0] === notSetUp),
    "as NOT SET UP rather than as a clean bill of health — that feature has never run",
    unevaluated.map(r => r.values[0]));
  const freezeLabel = await page.evaluate(() => t("seat.constraint.FREEZE_ZONES"));
  const freezeRow = preview.rows.find(r => r.label === freezeLabel);
  checks.ok(freezeRow && !freezeRow.muted,
    "and the constraint that DID ship answers for real instead of saying not set up", freezeRow);
  checks.equal(freezeRow && freezeRow.values[0],
    await page.evaluate(() => t("freeze.state.OPEN")),
    "this table is open — nothing is frozen in this event");

  // --- 6. cancelling changes nothing ---------------------------------------
  await click(page, "[data-seat-cancel]");
  await page.waitForTimeout(350);
  checks.ok(!(await page.evaluate(PREVIEW)), "cancelling closes the card");
  checks.equal(await page.evaluate(SNAPSHOT), before, "and still moved nobody");

  // --- 7. ONLY Apply seats anybody, and the preview predicted it exactly ----
  //
  // The phase requires the preview and the applied result to AGREE, not merely
  // to each look right. So the predicted occupancy is captured from the card
  // and compared against what the room actually becomes — a preview that is
  // plausible but wrong is worse than none, because an operator acts on it.
  await click(page, `[data-seat-preview="${room.t02}"]`);
  await page.waitForTimeout(350);
  const predicted = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".seat-preview .sp-row")];
    const read = (re) => {
      const r = rows.find(x => re.test(x.querySelector("em")?.textContent || ""));
      const b = r ? [...r.querySelectorAll("b")].map(v => v.textContent.trim()) : [];
      return b.length === 2 ? b[1] : null;
    };
    return { target: read(/T\s*02/), reserve: read(/spare|yedek/i) };
  });
  await click(page, "[data-seat-apply]");
  await page.waitForTimeout(500);
  const seated = await page.evaluate(() => {
    const e = state.events[0], g = e.guests.find(x => x.id === "g_party");
    return { table: g.assignment && e.tables.find(t => t.id === g.assignment.tableId)?.number,
      seats: g.assignment ? g.assignment.seats.length : 0,
      locked: g.assignment ? g.assignment.locked : null,
      others: e.guests.filter(x => x.id !== "g_party").map(x => x.assignment?.tableId || null),
      preview: ui.seatPreview };
  });
  const actual = await page.evaluate(() => {
    const e = state.events[0];
    const t = e.tables.find(x => x.number === "T02");
    const taken = e.guests.filter(g => g.assignment && g.assignment.tableId === t.id)
      .reduce((n, g) => n + Math.max(1, g.pax || 1), 0);
    const chairs = e.tables.filter(x => x.hasPhysicalSeats !== false && x.capacity > 0)
      .reduce((n, x) => n + x.capacity, 0);
    const seatedPax = e.guests.reduce((n, g) => n + (g.assignment ? Math.max(1, g.pax || 1) : 0), 0);
    return { target: `${taken}/${t.capacity}`, reserve: String(chairs - seatedPax) };
  });
  checks.equal(actual.target, predicted.target,
    "the preview predicted the target table's occupancy EXACTLY, and applying produced it");
  checks.equal(actual.reserve, predicted.reserve,
    "and predicted the room's spare seats exactly too");
  checks.equal(seated.table, "T02", "applying seats the party at the table that was previewed");
  checks.equal(seated.seats, 4, "with all four of them, together");
  checks.equal(seated.locked, false, "and not locked — the operator chose, they did not freeze it");
  checks.equal(seated.preview, null, "the preview closes once it has been applied");

  // Everyone else is exactly where they were. The preview promised one record
  // would move; one record moved.
  const othersBefore = JSON.parse(before).filter(([id]) => id !== "g_party");
  const othersAfter = await page.evaluate(() =>
    JSON.parse(JSON.stringify(state.events[0].guests.filter(g => g.id !== "g_party").map(g => [g.id, g.assignment]))));
  checks.equal(JSON.stringify(othersAfter), JSON.stringify(othersBefore),
    "and nobody else was touched — the preview promised one record and one record moved");

  // --- 8. a locked assignment outranks the advisor -------------------------
  await page.evaluate(() => {
    const g = state.events[0].guests.find(x => x.id === "g_party");
    g.assignment.locked = true;
    touchEvent(state.events[0]); render();
  });
  await selectGuest(page, "g_party");
  const locked = await page.evaluate(PANEL);
  checks.equal(locked.options.length, 0,
    "nothing is suggested over a locked assignment — it is a person's decision", locked.options);
  checks.ok(locked.empty && locked.empty.length > 20,
    "and the panel says why rather than showing an empty list", locked.empty);

  // --- 9. no table fits, said plainly --------------------------------------
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests.find(g => g.id === "g_party").assignment.locked = false;
    // Fill the room so nothing has four seats together.
    e.guests.push({ id: "g_hog", name: "Hog Party", additionalGuests: 7, pax: 8, vip: "Standard",
      invitedBy: "Other", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: { tableId: e.tables[2].id, seats: [0,1,2,3,4,5,6,7], locked: false },
      createdAt: new Date().toISOString() });
    touchEvent(e); render();
  });
  await selectGuest(page, "g_party");
  const full = await page.evaluate(PANEL);
  checks.equal(full.options.length, 0, "with no room left, nothing is offered", full.options);
  checks.ok(full.empty && /\d/.test(full.empty),
    "and the panel says how many tables were considered rather than going blank", full.empty);

  // --- 10. no raw key or enum in either language ---------------------------
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests = e.guests.filter(g => g.id !== "g_hog");
    e.guests.find(g => g.id === "g_party").assignment = null;
    touchEvent(e); render();
  });
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await selectGuest(page, "g_party");
    await click(page, `[data-seat-preview="${room.t03}"]`).catch(() => {});
    await page.waitForTimeout(350);
    const leaked = await page.evaluate(() => {
      const roots = [document.querySelector(".smart-seating"), document.querySelector(".seat-preview")].filter(Boolean);
      const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
      const ENUM = /^[A-Z][A-Z_]{4,}$/;
      const found = new Set();
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          const s = n.textContent.trim();
          if (s && s.length <= 60 && (KEY.test(s) || ENUM.test(s))) found.add(s);
        }
      }
      return [...found];
    });
    checks.equal(leaked.length, 0, `no raw key or enum in Smart Seating in ${lang.toUpperCase()}`, leaked);
  }
  await page.evaluate(() => { ui.lang = "en"; ui.seatPreview = null; render(); });

  // --- 11. a finished event gets no suggestions ----------------------------
  const finishedBefore = await page.evaluate(SNAPSHOT);
  await page.evaluate(() => { state.events[0].status = "Completed"; openEvent(state.events[0].id); });
  await page.waitForTimeout(400);
  await gotoTab(page, "seating");
  const historical = await page.evaluate(() => ({
    panel: !!document.querySelector(".smart-seating"),
    preview: !!document.querySelector(".seat-preview"),
  }));
  checks.ok(!historical.panel,
    "a completed event is a record of what happened — nothing suggests changing it", historical);
  checks.ok(!historical.preview, "and no impact preview is offered either");
  checks.equal(await page.evaluate(SNAPSHOT), finishedBefore,
    "and walking its seating screen changed no assignment");
}
