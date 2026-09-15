// Section 13/14: does a mutation that fails halfway leave storage and memory
// agreeing with each other?
//
// assignGuestGroup() (src/app-v8.js) is the one function in this codebase with
// an explicit snapshot-and-rollback: if anything inside its try block throws,
// the catch restores every guest's `assignment` from a snapshot taken before
// the move. That block already calls touchEvent(event) -- which persists --
// BEFORE render(), so render() throwing after a successful assignment would
// otherwise leave IndexedDB holding the new (successful) assignment while the
// catch's revert only undoes it in memory. The very next UNRELATED
// touchEvent() anywhere in the app would then persist that stale, reverted
// `state`, silently undoing an already-saved seating move. This suite proves
// the rollback re-persists itself, closing that gap -- and reads the raw
// IndexedDB record directly, never via a page reload, because a reload also
// fires the app's own unconditional beforeunload->saveState(), which would
// re-persist the (correctly reverted) in-memory value and mask exactly the
// storage-layer inconsistency this checks for.
import { openApp, createBlankEvent, addTables, addGuest, gotoTab, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "transaction-atomicity", tags: ["business", "fast"], timeout: 90000 };

const DB_NAME = "meritEventMaker";

async function readPersistedAssignment(page, guestId) {
  return page.evaluate(async ({ dbName, guestId }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const raw = await new Promise((res, rej) => {
      const tx = db.transaction("state", "readonly");
      const req = tx.objectStore("state").get("root");
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    db.close();
    const parsed = JSON.parse(raw);
    const guest = parsed.events[0].guests.find((g) => g.id === guestId);
    return guest && guest.assignment ? guest.assignment.tableId : null;
  }, { dbName: DB_NAME, guestId });
}

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "AtomicityCheck", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "Atomicity Guest" });
  await page.waitForTimeout(300);

  const setup = await page.evaluate(() => {
    const e = state.events[0];
    const [t1, t2] = e.tables;
    const g = e.guests[0];
    g.assignment = { tableId: t1.id, seats: [0], locked: false };
    touchEvent(e); render();
    return { guestId: g.id, t1: t1.id, t2: t2.id };
  });
  await page.waitForTimeout(500);
  const before = await readPersistedAssignment(page, setup.guestId);
  checks.require(before === setup.t1, "the guest's initial seat at table 1 actually reached storage", before);

  // --- render() throws mid-move: the rollback must re-persist itself --------
  const outcome = await page.evaluate(({ guestId, t2 }) => {
    const origRender = render;
    let thrown = false;
    render = function (...args) {
      if (!thrown) { thrown = true; throw new Error("simulated render failure"); }
      return origRender.apply(this, args);
    };
    let toastMsg = null;
    const origToast = toast;
    toast = function (msg, ...rest) { toastMsg = msg; return origToast(msg, ...rest); };
    try {
      assignGuestToTable(guestId, t2);
    } finally {
      render = origRender;
      toast = origToast;
    }
    const g = state.events[0].guests.find((x) => x.id === guestId);
    return { inMemoryTableId: g.assignment ? g.assignment.tableId : null, toastMsg };
  }, { guestId: setup.guestId, t2: setup.t2 });
  checks.ok(outcome.inMemoryTableId === setup.t1,
    "when render() throws mid-move, the in-memory assignment is rolled back to the original table", outcome);
  checks.ok(/rolled back/i.test(outcome.toastMsg || ""),
    "and the operator is told the move was rolled back", outcome.toastMsg);

  await page.waitForTimeout(500);
  const persistedAfterRollback = await readPersistedAssignment(page, setup.guestId);
  checks.ok(persistedAfterRollback === setup.t1,
    "storage agrees with memory after the rollback -- it never kept the failed move's table", persistedAfterRollback);
}
