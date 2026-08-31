// A completed or past-dated event is a record of what happened. Nothing may
// edit it.
//
// The rule is that enforcement lives in canMutate, not in which buttons get
// drawn. canMutate is closure-scoped and unreachable from a test, so this
// suite verifies both halves of the guarantee from outside: the mutation
// surfaces are gone from the UI, AND the data does not move when the
// keyboard paths that normally mutate are fired at it directly.
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "historical-immutability", tags: ["business", "fast"], timeout: 90000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  // --- a past-dated event is historical from the moment it is created -------
  await createBlankEvent(page, { name: "Historical", hotel: "Merit Royal", date: "2020-01-01" });
  const tabs = await page.locator(".tabs .tab").allTextContents();
  checks.ok(!tabs.some(t => /floor plan|kat plan/i.test(t)),
    "a past-dated event has no Floor Plan tab — the editing surface is removed, not just disabled", tabs);
  checks.ok(!tabs.some(t => /live event|canlı/i.test(t)),
    "a past-dated event has no Live Event tab", tabs);

  await gotoTab(page, "guests");
  const guestControls = await page.locator(".screen-titlebar button").allTextContents();
  checks.ok(!guestControls.some(b => /add guest|misafir ekle/i.test(b)),
    "the Guests screen offers no way to add a guest to a historical event", guestControls);
  checks.ok((await page.locator('[data-guest-command="add"]').count()) === 0,
    "the add-guest command itself is absent, not merely unlabelled");

  // --- the same event before it became historical ---------------------------
  // Build a live event with real content, then complete it, and prove the
  // content is frozen rather than merely hidden.
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(400);
  await createBlankEvent(page, { name: "Goes Historical", hotel: "Merit Royal", date: "2026-12-01" });
  await addTables(page, { quantity: 2 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "FROZEN GUEST" });

  const before = await page.evaluate(() => {
    const e = state.events.find(x => x.name === "Goes Historical");
    return { tables: e.tables.length, guests: e.guests.length, json: JSON.stringify(e.tables) };
  });

  await page.evaluate(() => {
    const e = state.events.find(x => x.name === "Goes Historical");
    e.status = "Completed";
    render();
  });
  await page.waitForTimeout(400);

  // Fire, one at a time, every keyboard path that mutates a live event. These
  // handlers are bound to window and are not all gated on the current screen
  // or tab, so a completed event is genuinely reachable from the keyboard.
  // Ctrl+Z is called out separately because it is the one that shipped
  // unguarded: the undo stack survives an event being marked Completed inside
  // the workspace, and one keystroke used to rewrite the frozen floor plan.
  const readEvent = () => page.evaluate(() => {
    const e = state.events.find(x => x.name === "Goes Historical");
    return { tables: e.tables.length, guests: e.guests.length, json: JSON.stringify(e.tables) };
  });
  const press = async (key, ctrl) => {
    await page.evaluate(({ k, c }) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: c, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: c, bubbles: true }));
    }, { k: key, c: !!ctrl });
    await page.waitForTimeout(300);
    return readEvent();
  };

  const afterUndo = await press("z", true);
  checks.ok(afterUndo.json === before.json,
    "Ctrl+Z does not roll a completed event back to an earlier state", { before, afterUndo });
  const afterRedo = await press("y", true);
  checks.ok(afterRedo.json === before.json, "Ctrl+Y does not replay changes onto a completed event", afterRedo);
  const afterDuplicate = await press("d", true);
  checks.ok(afterDuplicate.tables === before.tables, "Ctrl+D does not add a table to a completed event", afterDuplicate);
  const after = await press("Delete", false);
  checks.ok(after.tables === before.tables && after.guests === before.guests,
    "Delete removes nothing from a completed event", { before, after });
  checks.ok(after.json === before.json,
    "the completed event's table data is byte-for-byte what it was", { changed: after.json !== before.json });

  // --- and it survives a reload as a historical event -----------------------
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  const reloaded = await page.evaluate(() => {
    const e = state.events.find(x => x.name === "Goes Historical");
    return e ? { status: e.status, tables: e.tables.length, guests: e.guests.length } : null;
  });
  checks.ok(reloaded && reloaded.status === "Completed" && reloaded.tables === before.tables,
    "the completed event persisted intact across a reload", reloaded);
}
