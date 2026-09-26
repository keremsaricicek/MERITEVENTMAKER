// A DIALOG TAKES FOCUS IN, KEEPS IT, AND GIVES IT BACK TO WHAT OPENED IT.
//
// `.claude/skills/merit-accessibility-hardening/SKILL.md`, Dialogs: "Focus
// moves into the dialog on open, to the first meaningful control — not the
// close button unless that is the only action. Focus is trapped inside while
// it is open. Focus is restored to the invoking control on close. Returning
// focus to <body> is a defect: it drops the operator at the top of the page."
// Required evidence 3: "for each dialog, focus enters, is trapped, and is
// restored to the invoker."
//
// Every dialog here is OPENED FROM THE KEYBOARD (the invoker is focused and
// Enter is pressed) and CLOSED FROM THE KEYBOARD, both ways an operator does
// it: Escape, and Enter on the dialog's own close control. A dialog opened by
// a click and closed by script would pass checks that a keyboard user fails.
//
// The restore is the hard part in this product, and why it is asserted
// against the INVOKER'S SELECTOR rather than a node: every close is followed
// by render(), which replaces the DOM, so the node that opened the dialog no
// longer exists when focus comes back.
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, addGuest } from "../lib/app-actions.mjs";

export const meta = { name: "a11y-dialog-focus", tags: ["accessibility", "ui", "fast"], timeout: 120000 };

const where = (page) => page.evaluate(() => {
  const a = document.activeElement;
  const dlg = a && a.closest && a.closest("dialog[open]");
  return {
    tag: a ? a.tagName : null,
    inDialog: dlg ? dlg.id : null,
    isBody: a === document.body || a === null,
    desc: a ? (a.outerHTML || "").slice(0, 110) : null,
    closeButton: !!(a && a.matches && a.matches(".dialog-close,[data-wizard-close],[data-guide-close],[value='cancel']")),
  };
});
const matches = (page, sel) => page.evaluate((s) => !!document.activeElement && document.activeElement.matches(s), sel);

export default async function run({ page, checks, baseUrl }) {
  page.on("dialog", (d) => d.accept());
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Focus Event", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "FOCUS GUEST" });
  await settle(page);

  // Open a dialog the keyboard way: focus the invoker, press Enter.
  const openWith = async (invoker, dialogId) => {
    await page.focus(invoker);
    await page.keyboard.press("Enter");
    await page.waitForFunction((id) => document.getElementById(id)?.open, dialogId, { timeout: 5000 });
    await page.waitForTimeout(150);
  };
  // Tab and Shift+Tab well past the number of controls: focus must never
  // leave the open dialog.
  const trapped = async (dialogId, presses = 25) => {
    const escapes = [];
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < presses; i++) {
        await page.keyboard.press(key);
        const w = await where(page);
        if (w.inDialog !== dialogId) { escapes.push(`${key} ×${i + 1} → ${w.desc}`); break; }
      }
    }
    return escapes;
  };

  const DIALOGS = [
    { name: "guest dialog (add)", tab: "guests", invoker: '[data-guest-command="add"]', id: "guestDialog",
      firstMeaningful: '#guestForm input[name="name"]', closer: "#guestForm .dialog-close" },
    { name: "guest dialog (edit a row)", tab: "guests", invoker: "[data-guest-edit]", id: "guestDialog",
      firstMeaningful: '#guestForm input[name="name"]', closer: "#guestForm .dialog-close" },
    { name: "guest-list import wizard", tab: "guests", invoker: '[data-guest-command="import"]', id: "excelDialog",
      firstMeaningful: "[data-wizard-choose], [data-wizard-template]", closer: "#excelDialog [data-wizard-close]" },
    { name: "user guide", tab: "guests", invoker: '[data-action="help"]', id: "guideDialog",
      firstMeaningful: "#guideDialog [data-guide-lang], #guideDialog .guide-nav a, #guideDialog [data-guide-print]", closer: "[data-guide-close]" },
  ];

  for (const d of DIALOGS) {
    for (const how of ["Escape", "close control"]) {
      await gotoTab(page, d.tab);
      await settle(page);
      await openWith(d.invoker, d.id);
      const entered = await where(page);
      checks.ok(entered.inDialog === d.id,
        `${d.name}: opening it from the keyboard moves focus INTO the dialog`, entered);
      if (how === "Escape") {
        checks.ok(await matches(page, d.firstMeaningful),
          `${d.name}: to its first meaningful control, not the close button`, entered);
        checks.equal(await trapped(d.id), [],
          `${d.name}: Tab and Shift+Tab cannot walk focus out of it`);
        await page.keyboard.press("Escape");
      } else {
        await page.focus(d.closer);
        await page.keyboard.press("Enter");
      }
      await page.waitForFunction((id) => !document.getElementById(id)?.open, d.id, { timeout: 5000 });
      await page.waitForTimeout(250);
      const back = await where(page);
      checks.ok(!back.isBody && await matches(page, d.invoker),
        `${d.name}, closed by ${how}: focus returns to the control that opened it — never to <body>`, back);
    }
  }

  // Escape closes the TOPMOST layer and nothing else: with the guest dialog
  // open, Escape must not also close or reset the screen behind it.
  await gotoTab(page, "guests");
  await page.fill("#guestSearch", "FOCUS");
  await settle(page);
  await openWith('[data-guest-command="add"]', "guestDialog");
  await page.keyboard.type("HALF TYPED");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const behind = await page.evaluate(() => ({ tab: ui.tab, query: ui.guestQuery, screen: ui.screen, guests: state.events[0].guests.map((g) => g.name) }));
  checks.ok(behind.tab === "guests" && behind.query === "FOCUS" && behind.screen === "workspace",
    "Escape in a dialog closes the dialog and nothing behind it — the tab and the typed search survive", behind);
  checks.ok(!behind.guests.includes("HALF TYPED"),
    "and a half-typed guest is not saved by Escape — cancelling a form discards the draft, it does not submit it", behind.guests);
}
