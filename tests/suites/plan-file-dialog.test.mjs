// CLICKING THE PLAN DROP ZONE OPENS THE FILE DIALOG.
//
// Found by ux-operator-tasks (2026-11-01, every viewport): in New event, clicking
// the plan drop zone or the cover drop zone opened nothing — the label's click
// handler called preventDefault() on the click its own hidden <input> bubbles up,
// which cancelled the dialog. Every other suite gives the file with
// setInputFiles, so none could see it. This one clicks like a person and waits
// for the browser's file chooser.
// Mutation proof, recorded 2026-11-01: on the code before the fix both checks
// fail (no file chooser within 4 s).
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "plan-file-dialog", tags: ["ui", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await page.click('[data-action="create-event"]');
  await page.waitForSelector("#v8PlanDrop", { timeout: 10000 });
  for (const sel of ["#v8PlanDrop", "[data-cover-drop]"]) {
    const opened = page.waitForEvent("filechooser", { timeout: 4000 }).catch(() => null);
    await page.locator(sel).first().click();
    checks.ok(!!(await opened), `clicking ${sel} opens the file dialog`);
    await page.waitForTimeout(300);
  }
}
