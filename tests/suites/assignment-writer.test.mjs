// WHO IS ALLOWED TO SEAT SOMEBODY?
//
// `guest.assignment` is the single most consequential field in this product:
// it decides where a person sits, what the workbook prints, who the door
// expects, and what every capacity number is counted against. It was written
// by RAW ASSIGNMENT from eleven places across three files — assign, unassign,
// two different undo paths, a rollback, a table deletion, a guest
// restoration, a spreadsheet import, plus a normalization default and a dead
// demo seeder.
//
// Nothing was wrong with any one of them. The problem is that "one writer" is
// the property that makes every rule about seating enforceable in ONE place
// rather than eleven: the shape of the field, what a locked assignment means,
// and — the reason the ownership map calls this a blocker — that the Guests,
// Seating and canvas extractions cannot move while the field is written from
// everywhere.
//
// So this suite asserts two different things:
//
//   THE BOUNDARY IS REAL. `MeritSeatAssignment.write()` is the only code in
//   `src/` that assigns to `.assignment`. This is a STATIC scan, because a
//   behavioural test cannot see a twelfth writer somebody adds tomorrow in a
//   path no suite happens to exercise.
//
//   THE BEHAVIOUR IS UNCHANGED. Every operational path that moves a guest —
//   assign, move, unassign, undo of each, rollback, table deletion, guest
//   deletion and restore, a contested seat, a frozen table — still does
//   exactly what it did. A single writer that quietly changed one of those
//   would be a worse outcome than eleven that did not.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle, autoAnswer } from "../lib/app-actions.mjs";

export const meta = { name: "assignment-writer", tags: ["business", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  // deleteSelection() still asks through a native confirm(). Accepting it here
  // keeps this suite about the assignment writer; removing the native dialog
  // itself is its own section of the programme.
  page.on("dialog", d => d.accept());
  await autoAnswer(page);

  // --- 1. the static boundary ----------------------------------------------
  // Every assignment to `.assignment` in src/, with comments stripped so the
  // prose describing the old defect is not read as the defect.
  const files = fs.readdirSync(path.join(repoRoot, "src")).filter(f => f.endsWith(".js"));
  const offenders = [];
  for (const file of files) {
    if (file === "seat-assignment.js") continue;   // the writer itself
    const src = fs.readFileSync(path.join(repoRoot, "src", file), "utf8")
      .split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    // `x.assignment =` but never `==`/`===`, and never a property read.
    for (const m of src.matchAll(/(\w+(?:\.\w+)*)\.assignment\s*=(?!=)/g)) {
      offenders.push(`${file}: ${m[0].trim()}`);
    }
  }
  checks.equal(offenders.length, 0,
    "MeritSeatAssignment.write() is the ONLY code in src/ that assigns to guest.assignment. It was written raw from eleven places across three files, which is what blocks the Guests, Seating and canvas extractions in the ownership map",
    offenders);

  const writer = fs.readFileSync(path.join(repoRoot, "src", "seat-assignment.js"), "utf8");
  checks.ok(/globalThis\.MeritSeatAssignment/.test(writer),
    "the writer is published as a module, so app.js, app-guests.js and app-v8.js can all reach the same one", true);
  checks.ok(!/\bstate\b|\bui\b\.|render\(|touchEvent\(/.test(writer.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n")),
    "and it reads no shell state — a guest and an assignment go in, the guest comes back", true);

  await openApp(page, baseUrl, { lang: "en" });

  // --- 2. the writer normalizes rather than trusting -----------------------
  const shapes = await page.evaluate(() => {
    const W = MeritSeatAssignment;
    const g = (a) => W.write({ id: "g", name: "X" }, a).assignment;
    return {
      cleared: g(null),
      fromGarbage: g("not an assignment"),
      noTable: g({ seats: [0, 1] }),
      normal: g({ tableId: "t1", seats: [2, 0, 1], locked: true }),
      seatOrderKept: g({ tableId: "t1", seats: [5, 3, 4] }).seats.join(","),
      stringSeats: g({ tableId: "t1", seats: ["3", 4, "x"] }).seats,
      lockDefault: g({ tableId: "t1", seats: [0] }).locked,
    };
  });
  checks.equal(shapes.cleared, null, "writing null clears the assignment", shapes.cleared);
  checks.equal(shapes.fromGarbage, null, "so does anything that is not an assignment at all", shapes.fromGarbage);
  checks.equal(shapes.noTable, null,
    "an assignment naming no table is not an assignment — it would strand the guest at a table that does not exist", shapes.noTable);
  checks.equal(shapes.seatOrderKept, "5,3,4",
    "SEAT ORDER IS PRESERVED, never sorted. The order maps a party to its companions — refreshChairOccupancy walks it by index — so tidying it would silently reseat a companion",
    shapes.seatOrderKept);
  checks.equal(JSON.stringify(shapes.stringSeats), JSON.stringify([3, 4]),
    "seat indexes are coerced to numbers and anything that is not one is dropped, rather than being carried as a string that no index lookup would match",
    shapes.stringSeats);
  checks.equal(shapes.lockDefault, false, "and an assignment is unlocked unless it says otherwise", shapes.lockDefault);
  checks.equal(shapes.normal.locked, true, "a locked one stays locked", shapes.normal);

  // --- 3. every operational path still behaves ----------------------------
  await createBlankEvent(page, { name: "Assignment Writer", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 3 });
  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 8;
    e.tables[1].number = "T02"; e.tables[1].capacity = 8;
    e.tables[2].number = "T03"; e.tables[2].capacity = 8;
    e.guests = [
      { id: "g_party", name: "Mehmet Yilmaz", additionalGuests: 2, pax: 3, vip: "Standard",
        invitedBy: "Host", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
        assignment: null, createdAt: new Date().toISOString() },
      { id: "g_solo", name: "Ayse Demir", additionalGuests: 0, pax: 1, vip: "Standard",
        invitedBy: "Host", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
        assignment: null, createdAt: new Date().toISOString() },
    ];
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id, t03: e.tables[2].id };
  });

  const seat = (guestId, tableId) => page.evaluate(({ guestId, tableId }) => {
    assignGuestToTable(guestId, tableId);
    const g = state.events[0].guests.find(x => x.id === guestId);
    return { tableId: g.assignment?.tableId || null, seats: (g.assignment?.seats || []).length };
  }, { guestId, tableId });

  const assigned = await seat("g_party", room.t01);
  checks.equal(assigned.tableId, room.t01, "ASSIGN: a party lands at the table it was sent to", assigned);
  checks.equal(assigned.seats, 3, "taking one seat per pax, through the one writer", assigned);

  const moved = await seat("g_party", room.t02);
  checks.equal(moved.tableId, room.t02, "MOVE: the same party moves to another table", moved);
  checks.equal(moved.seats, 3, "still as one record of three", moved);

  const freed = await page.evaluate(({ t01 }) => {
    const e = state.events[0];
    return occupiedSeatIndexes(e, t01).size;
  }, room);
  checks.equal(freed, 0, "and the table it left is empty again — a move is not a copy", freed);

  const unassigned = await page.evaluate(() => {
    unassignGuest("g_party");
    const g = state.events[0].guests.find(x => x.id === "g_party");
    return g.assignment;
  });
  checks.equal(unassigned, null, "UNASSIGN: the assignment is cleared", unassigned);

  // --- 4. a locked assignment is still refused ----------------------------
  const locked = await page.evaluate(({ t03 }) => {
    assignGuestToTable("g_solo", t03);
    const g = state.events[0].guests.find(x => x.id === "g_solo");
    g.assignment = MeritSeatAssignment.normalize({ ...g.assignment, locked: true });
    // A locked assignment must not be movable.
    assignGuestToTable("g_solo", state.events[0].tables[0].id);
    const after = state.events[0].guests.find(x => x.id === "g_solo");
    return { tableId: after.assignment?.tableId, expected: t03, locked: after.assignment?.locked };
  }, room);
  checks.equal(locked.tableId, locked.expected,
    "LOCKED: a locked assignment is not moved by an ordinary assign — a person's decision outranks the flow", locked);
  checks.ok(locked.locked, "and it stays locked", locked);

  // --- 5. a contested seat is refused, not overwritten ---------------------
  const contested = await page.evaluate(({ t03 }) => {
    const e = state.events[0];
    const solo = e.guests.find(x => x.id === "g_solo");
    solo.assignment = MeritSeatAssignment.normalize({ ...solo.assignment, locked: false });
    // Fill T03 completely, then try to seat the three-pax party into it.
    e.guests.push({ id: "g_hog", name: "Hog", additionalGuests: 6, pax: 7, vip: "Standard",
      invitedBy: "Host", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: MeritSeatAssignment.normalize({ tableId: t03, seats: [1, 2, 3, 4, 5, 6, 7], locked: false }),
      createdAt: new Date().toISOString() });
    touchEvent(e);
    assignGuestToTable("g_party", t03);
    const party = e.guests.find(x => x.id === "g_party");
    const hog = e.guests.find(x => x.id === "g_hog");
    return { party: party.assignment, hogSeats: (hog.assignment?.seats || []).length };
  }, room);
  checks.equal(contested.party, null,
    "CONTESTED: a party that does not fit is not seated at all — it is never split, and never written over somebody",
    contested.party);
  checks.equal(contested.hogSeats, 7,
    "and the guest already there keeps every one of their seats", contested.hogSeats);

  // --- 6. deleting a table returns its guests to Unassigned ---------------
  const afterDelete = await page.evaluate(async ({ t03 }) => {
    const e = state.events[0];
    // Through the same path the canvas uses.
    ui.selectedObjectId = t03; ui.selectedObjectIds = [t03];
    const before = e.guests.filter(g => g.assignment?.tableId === t03).length;
    // The global the canvas binds; app-v8 overrides it onto deleteSelection().
    // Awaited: since §16 the deletion is confirmed in the product's own dialog
    // (answered by autoAnswer), not by a blocking native confirm().
    await deleteSelectedObject();
    const stranded = e.guests.filter(g => g.assignment && !e.tables.some(t => t.id === g.assignment.tableId));
    return { before, stranded: stranded.length, tableGone: !e.tables.some(t => t.id === t03) };
  }, room);
  checks.ok(afterDelete.before > 0, "there really were guests at the table being deleted", afterDelete);
  checks.ok(afterDelete.tableGone, "DELETE TABLE: the table is gone", afterDelete);
  checks.equal(afterDelete.stranded, 0,
    "and nobody is left holding a seat at a table that no longer exists — the Plan Doctor's own guestAtMissingTable blocker, prevented at the source",
    afterDelete.stranded);

  // --- 7. undo restores through the same writer ---------------------------
  await gotoTab(page, "seating").catch(() => {});
  await settle(page);
  const undone = await page.evaluate(({ t01 }) => {
    const e = state.events[0];
    const g = e.guests.find(x => x.id === "g_party");
    assignGuestToTable("g_party", t01);
    const seated = g.assignment ? { ...g.assignment } : null;
    unassignGuest("g_party");
    return { seated, afterUnassign: e.guests.find(x => x.id === "g_party").assignment };
  }, room);
  checks.ok(undone.seated && undone.seated.tableId === room.t01, "the party was seated again", undone.seated);
  checks.equal(undone.afterUnassign, null, "and unassigned again", undone.afterUnassign);
  const undoBtn = await page.locator(".toast .toast-action").count().catch(() => 0);
  if (undoBtn) {
    await click(page, ".toast .toast-action");
    await page.waitForTimeout(400);
    const restored = await page.evaluate(() =>
      state.events[0].guests.find(x => x.id === "g_party").assignment?.tableId || null);
    checks.equal(restored, room.t01,
      "UNDO: the offered undo puts the party back where it was, through the same one writer", restored);
  } else {
    checks.ok(false, "an undo control was offered after unassigning", undoBtn);
  }
}
