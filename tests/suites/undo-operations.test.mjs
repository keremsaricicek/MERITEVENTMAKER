// Every destructive canvas operation round-trips: do it, verify the new state,
// undo it, verify the original state came back exactly.
//
// Undo that "mostly works" is worse than no undo, because an operator trusts
// it. So each block asserts the restored value equals the recorded original,
// not merely that something changed back.
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "undo-operations", tags: ["business", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  page.on("dialog", d => d.accept());
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Undo", hotel: "Merit", date: "2026-12-01" });

  // --- 1. bulk add ----------------------------------------------------------
  checks.require((await addTables(page)) === 4, "bulk add created four tables");
  await page.evaluate(() => undoCanvas());
  await page.waitForTimeout(250);
  checks.ok((await page.evaluate(() => state.events[0].tables.length)) === 0,
    "undo of a bulk add removes all four tables, not just the last one");

  await addTables(page, { quantity: 1 });
  const tableId = await page.evaluate(() => state.events[0].tables[0].id);
  const before = await page.evaluate(id => {
    const t = state.events[0].tables.find(x => x.id === id);
    return { x: t.x, y: t.y, w: t.w, rotation: t.rotation || 0, capacity: t.capacity, locked: !!t.locked, z: t.z || 10 };
  }, tableId);

  const roundTrip = async (label, mutate, read, expectAfter) => {
    await page.evaluate(mutate, tableId);
    await page.waitForTimeout(150);
    const changed = await page.evaluate(read, tableId);
    checks.ok(matches(changed, expectAfter), `${label} took effect`, { got: changed, want: expectAfter });
    await page.evaluate(() => undoCanvas());
    await page.waitForTimeout(200);
    const restored = await page.evaluate(read, tableId);
    return restored;
  };

  // --- 2. move --------------------------------------------------------------
  let restored = await roundTrip("move",
    id => { const e = state.events[0], t = e.tables.find(x => x.id === id); recordUndo(e); t.x += 80; t.y += 40; touchEvent(e); },
    id => { const t = state.events[0].tables.find(x => x.id === id); return { x: t.x, y: t.y }; },
    { x: before.x + 80, y: before.y + 40 });
  checks.ok(restored.x === before.x && restored.y === before.y, "undo restored the exact position", { restored, before });

  // --- 3. resize ------------------------------------------------------------
  restored = await roundTrip("resize",
    id => { const e = state.events[0], t = e.tables.find(x => x.id === id); recordUndo(e); t.w += 50; touchEvent(e); },
    id => ({ w: state.events[0].tables.find(x => x.id === id).w }),
    { w: before.w + 50 });
  checks.ok(restored.w === before.w, "undo restored the exact width", { restored, before });

  // --- 4. rotate ------------------------------------------------------------
  restored = await roundTrip("rotate",
    id => { const e = state.events[0], t = e.tables.find(x => x.id === id); recordUndo(e); t.rotation = 45; touchEvent(e); },
    id => ({ rotation: state.events[0].tables.find(x => x.id === id).rotation || 0 }),
    { rotation: 45 });
  checks.ok(restored.rotation === before.rotation, "undo restored the exact rotation", { restored, before });

  // --- 5. capacity, which must drag chairs with it in both directions -------
  restored = await roundTrip("capacity change",
    id => { const e = state.events[0], t = e.tables.find(x => x.id === id); setTableCapacity(e, t, t.capacity + 2); },
    id => { const t = state.events[0].tables.find(x => x.id === id); return { capacity: t.capacity, chairs: t.chairs.length }; },
    { capacity: before.capacity + 2, chairs: before.capacity + 2 });
  checks.ok(restored.capacity === before.capacity && restored.chairs === before.capacity,
    "undo restored capacity AND chairs together — neither is left behind", { restored, before });

  // --- 6. lock --------------------------------------------------------------
  restored = await roundTrip("lock",
    id => { const e = state.events[0], t = e.tables.find(x => x.id === id); recordUndo(e); t.locked = true; touchEvent(e); },
    id => ({ locked: !!state.events[0].tables.find(x => x.id === id).locked }),
    { locked: true });
  checks.ok(restored.locked === before.locked, "undo restored the lock state", { restored, before });

  // --- 7. z-order -----------------------------------------------------------
  restored = await roundTrip("bring forward",
    id => { const e = state.events[0], t = e.tables.find(x => x.id === id); recordUndo(e); t.z = (t.z || 10) + 1; touchEvent(e); },
    id => ({ z: state.events[0].tables.find(x => x.id === id).z || 10 }),
    { z: before.z + 1 });
  checks.ok(restored.z === before.z, "undo restored the z-order", { restored, before });

  // --- 8. duplicate via the real shortcut -----------------------------------
  await page.evaluate(id => { ui.selectedObjectIds = [id]; ui.selectedObjectId = id; render(); }, tableId);
  await page.waitForTimeout(200);
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(300);
  checks.ok((await page.evaluate(() => state.events[0].tables.length)) === 2, "Ctrl+D duplicated the table");
  await page.evaluate(() => undoCanvas());
  await page.waitForTimeout(250);
  checks.ok((await page.evaluate(() => state.events[0].tables.length)) === 1, "undo removed the duplicate");

  // --- 9. background --------------------------------------------------------
  await page.evaluate(() => {
    const e = state.events[0]; recordUndo(e);
    e.background = { src: "data:image/png;base64,x", name: "x", opacity: 1, visible: true, locked: false, scale: 100 };
    touchEvent(e);
  });
  await page.waitForTimeout(200);
  checks.ok(await page.evaluate(() => !!state.events[0].background?.src), "a reference image was set");
  await page.evaluate(() => undoCanvas());
  await page.waitForTimeout(250);
  checks.ok(!(await page.evaluate(() => state.events[0].background?.src)), "undo removed the reference image");

  // --- 10. delete a table that has someone sitting at it --------------------
  await gotoTab(page, "guests");
  await addGuest(page, { name: "DELETE TEST" });
  await page.evaluate(id => { const e = state.events[0]; assignGuestToTable(e.guests[0].id, id); }, tableId);
  await page.waitForTimeout(300);
  await gotoTab(page, "floor");
  await page.evaluate(id => { ui.selectedObjectIds = [id]; ui.selectedObjectId = id; render(); }, tableId);
  await page.waitForTimeout(200);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(400);
  const afterDelete = await page.evaluate(() => ({
    tables: state.events[0].tables.length,
    stillSeated: !!state.events[0].guests[0].assignment,
  }));
  checks.ok(afterDelete.tables === 0, "deleting the table removed it", afterDelete);
  checks.ok(afterDelete.stillSeated === false,
    "the guest was returned to Unassigned rather than left pointing at a table that no longer exists", afterDelete);
  await page.evaluate(() => undoCanvas());
  await page.waitForTimeout(300);
  checks.ok((await page.evaluate(() => state.events[0].tables.length)) === 1, "undo restored the deleted table");

  // Canvas undo snapshots tables/venueObjects/background. Guest assignments are
  // a separate concern with their own undo, so the freed guest legitimately
  // stays unassigned here -- asserted so the documented scope stays honest and
  // a future change that quietly widens it gets noticed.
  checks.ok((await page.evaluate(() => !state.events[0].guests[0].assignment)),
    "canvas undo does not silently re-seat guests — assignment undo is its own mechanism");

  // --- 11. unassigning a guest is undoable from its toast -------------------
  await page.evaluate(id => { const e = state.events[0]; assignGuestToTable(e.guests[0].id, e.tables[0].id); }, tableId);
  await page.waitForTimeout(300);
  await gotoTab(page, "seating");
  const beforeUnassign = await page.evaluate(() => JSON.stringify(state.events[0].guests[0].assignment));
  await click(page, "[data-unassign]");
  await page.waitForTimeout(400);
  checks.ok((await page.evaluate(() => state.events[0].guests[0].assignment)) === null, "unassign cleared the assignment");
  await page.locator(".toast-action").last().click();
  await page.waitForTimeout(400);
  checks.ok((await page.evaluate(() => JSON.stringify(state.events[0].guests[0].assignment))) === beforeUnassign,
    "undo restored the exact seat list, not just some seat", { beforeUnassign });

  // --- 12. moving a guest between tables ------------------------------------
  await gotoTab(page, "floor");
  await addTables(page, { quantity: 1 });
  await gotoTab(page, "seating");
  const secondTableId = await page.evaluate(() => state.events[0].tables[1].id);
  const beforeMove = await page.evaluate(() => JSON.stringify(state.events[0].guests[0].assignment));
  await page.evaluate(id => { const e = state.events[0]; assignGuestToTable(e.guests[0].id, id); }, secondTableId);
  await page.waitForTimeout(400);
  checks.ok((await page.evaluate(() => state.events[0].guests[0].assignment.tableId)) === secondTableId,
    "the guest moved to the second table");
  const toastActions = await page.locator(".toast-action").count();
  checks.ok(toastActions === 1, "the move offers exactly one undo affordance, not a stack of stale ones", toastActions);
  await page.locator(".toast-action").last().click();
  await page.waitForTimeout(400);
  checks.ok((await page.evaluate(() => JSON.stringify(state.events[0].guests[0].assignment))) === beforeMove,
    "undo put the guest back on the exact seats of the previous table", { beforeMove });
}

function matches(got, want) {
  return Object.keys(want).every(k => got[k] === want[k]);
}
