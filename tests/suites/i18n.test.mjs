// Both languages render, and no untranslated key ever reaches the screen.
//
// t() falls back to returning the key itself when a string is missing, which
// is the right behaviour (the gap stays visible) and also exactly what this
// suite hunts for: a literal "guestDialog.save" on a button is the shape a
// missing translation takes. The original scratchpad version printed the
// dialog text for a human to read; this one fails the build instead.
import { click, openApp, createBlankEvent, addTables, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "i18n", tags: ["ui", "fast"], timeout: 120000 };

// Keys the guest dialog is built from. Listed explicitly so that deleting a
// string from i18n.js fails here rather than shipping a raw key to a user.
const GUEST_DIALOG_KEYS = [
  "guests.addGuest", "guests.editGuest",
  "guestDialog.name", "guestDialog.additionalGuests", "guestDialog.planningStatus",
  "guestDialog.vipLevel", "guestDialog.invitedBy", "guestDialog.notes",
  "guestDialog.totalPax", "guestDialog.cancel", "guestDialog.save",
  "status.planning.Confirmed", "status.planning.Tentative",
];

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  // --- 1. every dialog key resolves in both languages -----------------------
  for (const lang of ["tr", "en"]) {
    const unresolved = await page.evaluate(({ keys, l }) => {
      ui.lang = l;
      return keys.filter(k => t(k) === k);
    }, { keys: GUEST_DIALOG_KEYS, l: lang });
    checks.ok(unresolved.length === 0,
      `every guest-dialog string resolves in ${lang.toUpperCase()}`, unresolved);
  }

  // --- 2. the two languages actually differ --------------------------------
  const pairs = await page.evaluate(keys => {
    const out = {};
    for (const k of keys) {
      ui.lang = "tr"; const tr = t(k);
      ui.lang = "en"; const en = t(k);
      out[k] = { tr, en };
    }
    return out;
  }, GUEST_DIALOG_KEYS);
  const identical = Object.entries(pairs).filter(([, v]) => v.tr === v.en).map(([k]) => k);
  checks.ok(identical.length === 0,
    "no guest-dialog string is the same in both languages (which would mean one side was never translated)", pairs);

  // --- 3. Turkish reaches the actual rendered dialog ------------------------
  await page.evaluate(() => { ui.lang = "tr"; });
  await createBlankEvent(page, { name: "I18N", hotel: "Merit", date: "2026-11-01" });
  await addTables(page, { quantity: 1 });

  await click(page, "#canvasViewport .table-object, #canvasViewport [data-object-id]");
  await page.waitForTimeout(400);
  const cardTr = await page.$eval(".contextual-card", n => n.innerText).catch(() => "");
  checks.ok(cardTr.length > 0, "the contextual card renders for a selected table in Turkish");

  await gotoTab(page, "guests");
  await click(page, '[data-guest-command="add"]');
  await page.waitForSelector("#guestForm", { state: "visible" });
  const dialogTr = await readDialog(page);
  checks.ok(dialogTr.title === pairs["guests.addGuest"].tr,
    "the dialog title is the Turkish string, not the English one", dialogTr.title);
  checks.ok(dialogTr.save === pairs["guestDialog.save"].tr,
    "the save button is translated", dialogTr.save);
  checks.ok(dialogTr.labels.includes(pairs["guestDialog.additionalGuests"].tr),
    "the +N field is labelled in Turkish", dialogTr.labels);

  // --- 4. validation and success messages are translated too ---------------
  await click(page, "#guestForm .dialog-foot .btn.primary");
  await page.waitForTimeout(400);
  const validation = await page.locator(".toast").last().textContent().catch(() => "");
  checks.ok(validation && !/^[a-z]+\.[a-zA-Z.]+$/.test(validation.trim()),
    "the empty-name validation message is a real sentence, not a key", validation);
  checks.ok(/[çğıöşüÇĞİÖŞÜ]/.test(validation) || validation !== "Guest name is required",
    "the validation message is in Turkish", validation);

  await page.fill('#guestForm input[name="name"]', "TEST KISI");
  await click(page, "#guestForm .dialog-foot .btn.primary");
  await page.waitForTimeout(500);

  // --- 5. editing shows the edit title, not the add title ------------------
  await click(page, "[data-guest-edit]");
  await page.waitForTimeout(400);
  const editTitle = await page.$eval("#guestDialogTitle", n => n.textContent).catch(() => "");
  checks.ok(editTitle === pairs["guests.editGuest"].tr,
    "reopening an existing guest shows the Turkish edit title", editTitle);
  await click(page, "#guestForm .dialog-close").catch(() => {});
  await page.waitForTimeout(300);

  // --- 6. switching back to English still renders English ------------------
  await page.evaluate(() => { ui.lang = "en"; render(); });
  await page.waitForTimeout(400);
  await click(page, '[data-guest-command="add"]');
  await page.waitForSelector("#guestForm", { state: "visible" });
  const dialogEn = await readDialog(page);
  checks.ok(dialogEn.title === pairs["guests.addGuest"].en,
    "switching back to English re-renders the English title", dialogEn.title);
  checks.ok(dialogEn.title !== dialogTr.title, "the two languages genuinely produced different dialogs");
  await click(page, "#guestForm .dialog-close").catch(() => {});
  await page.waitForTimeout(300);

  // --- 7. no raw key on any screen, in either language ---------------------
  for (const lang of ["tr", "en"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    for (const tab of ["floor", "guests", "seating", "live", "reports"]) {
      await gotoTab(page, tab);
      const leaked = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const found = new Set();
        // A leaked key renders as its own identifier: lowercase, dotted, no
        // spaces. Filenames and version numbers are excluded so the check
        // does not cry wolf on legitimate content.
        const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
        const NOT_A_KEY = /\.(png|jpg|jpeg|json|js|css|html|xlsx|pdf|svg|webp)$/i;
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent.trim();
          if (!text || text.length > 60) continue;
          if (KEY.test(text) && !NOT_A_KEY.test(text) && !/^\d/.test(text)) found.add(text);
        }
        return [...found];
      });
      checks.ok(leaked.length === 0, `no untranslated key on the ${tab} screen in ${lang.toUpperCase()}`, leaked);
    }
  }
}

async function readDialog(page) {
  return page.evaluate(() => ({
    title: document.getElementById("guestDialogTitle")?.textContent || "",
    labels: [...document.querySelectorAll("#guestForm label")].map(n => n.textContent.trim()),
    save: document.querySelector("#guestForm .dialog-foot .btn.primary")?.textContent.trim() || "",
  }));
}
