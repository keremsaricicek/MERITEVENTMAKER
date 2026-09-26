// A TOAST IS A TRANSIENT CONFIRMATION. IT IS CAPPED, SAID ONCE, HELD WHILE IT
// IS READ, SHOWN ON TOP OF WHATEVER RAISED IT, KEPT OFF THE CONTROLS, WRITTEN
// IN THE OPERATOR'S LANGUAGE — AND NEVER THE ONLY PLACE A LASTING PROBLEM IS
// TOLD.
//
// `.claude/skills/merit-ui-quality-gates/SKILL.md`: "No unlimited toast
// stacking. Toasts are capped and never obscure the work." And the programme's
// §17: a toast is never the only carrier of an error an operator must act on.
//
// What was measured before this suite existed (the §17 entry in
// benchmarks/MASTER-PROGRAMME-STATE.md has the numbers):
//   · 132 toast call sites; 67 passed an English literal or template, which
//     a pattern table then tried to recognise AFTER the fact and translate.
//     "Event created. Review the plan, then run Assisted Detection." had no
//     pattern and reached a Turkish screen in English.
//   · No cap and no de-duplication: a burst stacked without limit.
//   · The guest dialog's own validation error rendered BEHIND the dialog's
//     backdrop — the topmost element at the toast's centre was the dialog.
//   · Bottom-right, a three-toast stack covered 23 controls across six
//     screens and three viewports: Guests' row actions, and at 1440×900 the
//     Live door list's No Show buttons.
//   · Three lasting conditions were told ONLY by a toast: plan images dropped
//     from storage, a state that could not be serialised for saving (which
//     the toast misreported as "storage is full"), and a boot that silently
//     fell back to an older recovery point when the saved record was missing.
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings } from "../lib/js-scan.mjs";
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, addGuest, autoAnswer } from "../lib/app-actions.mjs";
import { installStorageFaults, setFault, deleteRecord, readRecord, gotoBlank, bootApp } from "../lib/faults.mjs";

export const meta = { name: "toast-discipline", tags: ["ui", "localization", "resilience", "fast"], timeout: 300000 };

// ---------------------------------------------------------------------------
// STATIC: where every message comes from.
// ---------------------------------------------------------------------------

// Every toast()/toastAction() call site whose message is NOT one translation
// call. Each is a composition of translated parts, and says where they come
// from. A new composed site fails until it is read and listed here; a listed
// one that disappears fails too, so this list cannot rot.
const COMPOSED = [
  { file: "app-v8.js", fn: "toast", arg: "message", count: 1,
    from: 'const message=t("seating.groupMovedToast",…) on the line above: a first seating of a group is confirmed plainly…' },
  { file: "app-v8.js", fn: "toastAction", arg: "message", count: 1,
    from: "…and a group MOVE is confirmed with Undo. Same t() message." },
  { file: "app-v8.js", fn: "toast", arg: 'anyClash?t("seating.groupSeatTaken"):t("seating.groupRestoredToast")', count: 1,
    from: "a choice between two keys" },
  { file: "app-v8.js", fn: "toast", arg: 'seatLost?t("guests.restoredNoSeat",{name:snapshot.name}):t("guests.restoredToast",{name:snapshot.name})', count: 1,
    from: "a choice between two keys" },
  { file: "app-v8.js", fn: "toast", arg: "toastText(r.lesson)", count: 1,
    from: 'keepLesson()\'s two callers pass toastText as l=>t("number.confirmedToast",…) and l=>t("teachArea.kept",…)' },
  { file: "app-v8.js", fn: "toast", arg: 't("toast.groupConfirmed",{n:strong.length,objectWord:t(strong.length===1?"word.object":"word.objects"),title:group.title})+(group.outlierIds.length?" "+t("toast.outliersRemain",{n:group.outlierIds.length}):"")', count: 1,
    from: "two keys joined by a space; group.title is a Review Center group name (MERIT_I18N_STATUS.notMigrated names it)" },
  { file: "app-v8.js", fn: "toast", arg: 'decision==="merged" ?t("toast.confirmedOneGroup",{n:newPi.planSummary.diningGroups}) :t("toast.splitIntoTables",{count:memberIds.length,n:newPi.planSummary.diningGroups})', count: 1,
    from: "a choice between two keys" },
];

// Every toast raised as an ERROR, by the key it shows, and what kind of error
// it is. A toast disappears in seconds, so the class decides whether that is
// acceptable:
//   REFUSAL       the operator's own attempt did not happen and nothing
//                 changed; the toast answers the click that caused it.
//   CONFIRMATION  styled as a warning, but it confirms an act the operator
//                 just completed, whose result stays visible where it applies.
//   INFORMATION   nothing for the operator to do; the event is unaffected.
//   CONDITION     something stays wrong after the toast has gone. Only
//                 allowed with a persistent carrier, named here and asserted
//                 below.
const REFUSAL = "REFUSAL", CONFIRMATION = "CONFIRMATION", INFORMATION = "INFORMATION", CONDITION = "CONDITION";
const ERROR_CLASS = {
  "toast.tableNumberInUse": REFUSAL, "toast.capacityBelowOccupied": REFUSAL, "toast.capacityBelowPax": REFUSAL,
  "toast.nameRequired": REFUSAL, "toast.recordSeatsShort": REFUSAL, "toast.mapNameColumn": REFUSAL,
  "guests.readFailed": REFUSAL, "toast.fixBlockingErrors": REFUSAL, "guests.templateFailed": REFUSAL,
  "toast.assignmentLockedMove": REFUSAL, "toast.seatsShort": REFUSAL, "toast.unlockAssignmentFirst": REFUSAL,
  "reports.workbookFailed": REFUSAL, "toast.historicalReadOnly": REFUSAL, "handover.empty": REFUSAL,
  "setup.planReadFailed": REFUSAL, "toast.chooseImageType": REFUSAL, "plan.unreadableImage": REFUSAL,
  "toast.eventFieldsRequired": REFUSAL, "toast.unlockSelectedFirst": REFUSAL, "freeze.invalid": REFUSAL,
  "freeze.coversNothing": REFUSAL, "avail.cannotSeatToast": REFUSAL, "toast.assignmentLockedName": REFUSAL,
  "toast.groupSeatsShort": REFUSAL, "seating.groupSeatTaken": REFUSAL, "toast.groupMoveRolledBack": REFUSAL,
  "avail.reasonRequiredToast": REFUSAL, "reports.printNoTables": REFUSAL, "seating.unlockFirst": REFUSAL,
  "seating.seatTaken": REFUSAL, "teachArea.refused": REFUSAL, "number.notANumber": REFUSAL,
  "toast.importPlanFirst": REFUSAL, "detect.failed": REFUSAL, "toast.selectDetectionFirst": REFUSAL,
  "teach.exportEmpty": REFUSAL, "dataset.exportFailed": REFUSAL, "toast.enableTeachFirst": REFUSAL,
  "toast.saveVerifiedFirst": REFUSAL, "backup.corruptFile": REFUSAL, "backup.invalidFile": REFUSAL,
  "backup.futureVersion": REFUSAL, "backup.invalidRecord": REFUSAL, "backup.badReference": REFUSAL,
  "eventPackage.invalidFile": REFUSAL, "eventPackage.futureVersion": REFUSAL, "eventPackage.invalidRecord": REFUSAL,
  "eventPackage.badReference": REFUSAL, "eventPackage.importFailed": REFUSAL, "recovery.none": REFUSAL,
  "plan.replaceFailed": REFUSAL,
  // Both keys of a toast whose TYPE is conditional are listed: the success
  // branch shares the call, so it is classified with it.
  "avail.markedUnavailableToast": CONFIRMATION, "avail.markedAvailableToast": CONFIRMATION,
  "seating.groupRestoredToast": CONFIRMATION,
  "training.captureFailed": INFORMATION, "teach.exportMissingCrops": INFORMATION,
  // The persistent carrier of each, asserted by the dynamic checks below.
  "toast.storageFull": CONDITION, "toast.storageFullLegacy": CONDITION, "toast.imageTooLargeLegacy": CONDITION,
  "toast.imagesNotStored": CONDITION, "toast.notSerializable": CONDITION, "recovery.bootRecoveredToast": CONDITION,
};
const CARRIER = {
  "toast.storageFull": 'data-storage-notice="save-failing" (resilience-storage)',
  "toast.imagesNotStored": 'data-storage-notice="images-dropped" (asserted here)',
  "toast.notSerializable": 'data-storage-notice="save-failing", its serialise wording (asserted here)',
  "recovery.bootRecoveredToast": 'data-storage-notice="recovered" (asserted here)',
  // The pre-v8 saveState() that raised these two is overridden by app-v8.js's
  // (boot-contract proves the override resolves), so they are unreachable;
  // they are keyed like every other message so a revival would be Turkish.
  "toast.storageFullLegacy": "unreachable: app.js saveState() is overridden",
  "toast.imageTooLargeLegacy": "unreachable: app.js saveState() is overridden",
};

function callSites(repoRoot) {
  const out = [];
  const dir = path.join(repoRoot, "src");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const code = stripCommentsAndStrings(src);
    const re = /(?<![\w$.])(toast|toastAction)\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      if (/function\s*$/.test(code.slice(Math.max(0, m.index - 10), m.index))) continue;
      const args = [];
      let i = m.index + m[0].length, start = i, depth = 0;
      for (; i < code.length; i++) {
        const c = code[i];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) { if (depth === 0) { args.push(src.slice(start, i).trim()); break; } depth--; }
        else if (c === "," && depth === 0) { args.push(src.slice(start, i).trim()); start = i + 1; }
      }
      out.push({ file, fn: m[1], line: src.slice(0, m.index).split("\n").length, args });
    }
  }
  return out;
}
const oneTranslationCall = (arg) => {
  if (!/^(t|t_|userMessage)\(/.test(arg)) return false;
  const code = stripCommentsAndStrings(arg);
  let depth = 0;
  for (let i = code.indexOf("("); i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return code.slice(i + 1).trim() === "";
  }
  return false;
};
const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*([?:])\s*/g, "$1").trim();
// The key(s) a message argument shows: t("k"…), t_("k"…), t_(c?"a":"b"…),
// userMessage(err,"k").
// Every dotted string literal in the argument, after removing the {…}
// parameter objects — so t("a",{reason:userMessage(e,"b")}) shows "a", and a
// multi-line t(cond?"a":"b",{…}) shows both "a" and "b".
const keysOf = (arg) => {
  let out = "", depth = 0;
  for (const c of arg) { if (c === "{") depth++; else if (c === "}") depth--; else if (depth === 0) out += c; }
  return [...out.matchAll(/"([a-zA-Z]+\.[\w.]+)"/g)].map((m) => m[1]).filter((k) => !/^word\./.test(k));
};

export default async function run({ page, checks, baseUrl, repoRoot, errors }) {
  const sites = callSites(repoRoot);
  checks.ok(sites.length >= 120, `the scan found the product's toast call sites (${sites.length})`, sites.length);

  // --- 1. every message comes from a translation ---------------------------
  const unlisted = [];
  const seen = new Map();
  for (const s of sites) {
    const msg = s.args[0] || "";
    if (oneTranslationCall(msg)) continue;
    const hit = COMPOSED.find((c) => c.file === s.file && c.fn === s.fn && norm(c.arg) === norm(msg));
    if (hit) { seen.set(hit, (seen.get(hit) || 0) + 1); continue; }
    unlisted.push(`${s.file}:${s.line} ${s.fn}(${msg.slice(0, 110)})`);
  }
  checks.equal(unlisted, [],
    "every toast message is one t()/userMessage() call or a listed composition of them — no English literal is passed and translated afterwards");
  checks.equal(COMPOSED.filter((c) => (seen.get(c) || 0) !== c.count).map((c) => `${c.file} ${c.fn}(${c.arg.slice(0, 60)}) ×${seen.get(c) || 0}`), [],
    "and every listed composition still exists exactly as often as it says");

  // --- 2. every error toast is classified; conditions have a carrier --------
  const errorSites = sites.filter((s) => /"error"/.test(s.args[1] || ""));
  const unclassified = [];
  const used = new Set();
  for (const s of errorSites) {
    const keys = keysOf(s.args[0] || "");
    if (!keys.length) unclassified.push(`${s.file}:${s.line} (no key found in ${s.args[0]})`);
    for (const k of keys) { used.add(k); if (!ERROR_CLASS[k]) unclassified.push(`${s.file}:${s.line} ${k}`); }
  }
  checks.equal(unclassified, [], "every toast raised as an error is classified as a refusal, a confirmation, information, or a condition");
  checks.equal(Object.keys(ERROR_CLASS).filter((k) => !used.has(k)), [], "and the classification lists no error toast that no longer exists");
  checks.equal(Object.entries(ERROR_CLASS).filter(([k, c]) => c === CONDITION && !CARRIER[k]).map(([k]) => k), [],
    "every CONDITION names the persistent notice that also carries it — a toast is never its only carrier");

  // --- 3. every key shown exists in both languages --------------------------
  const allSrc = fs.readdirSync(path.join(repoRoot, "src")).filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(repoRoot, "src", f), "utf8")).join("\n");
  const toastKeys = [...new Set([...allSrc.matchAll(/"((?:toast|word)\.[A-Za-z]+)"/g)].map((m) => m[1]))];

  await openApp(page, baseUrl, { lang: "en" });
  const both = await page.evaluate((keys) => {
    const out = {};
    for (const lang of ["en", "tr"]) { ui.lang = lang; out[lang] = Object.fromEntries(keys.map((k) => [k, t(k)])); }
    ui.lang = "en";
    return out;
  }, toastKeys);
  checks.equal(toastKeys.filter((k) => both.en[k] === k || both.tr[k] === k || !both.en[k] || !both.tr[k]), [],
    `every toast.*/word.* key used in the source exists in English and Turkish (${toastKeys.length} keys)`);
  const SAME_IN_BOTH = new Set(["toast.arrivalSet"]);   // "{name}: {status}." — both parts translated separately
  checks.equal(toastKeys.filter((k) => k.startsWith("toast.") && both.en[k] === both.tr[k] && !SAME_IN_BOTH.has(k)), [],
    "and no Turkish entry is the English sentence copied across");

  // A value is substituted as TEXT. t() used a replacement STRING, so "$&"
  // in a guest name became the placeholder and "$$" became "$".
  const dollar = await page.evaluate(() => t("toast.returnedUnassigned", { name: "PAY $& $$ $1 CASH" }));
  checks.equal(dollar, "PAY $& $$ $1 CASH returned to Unassigned.",
    "a guest name containing $&, $$ or $1 is shown exactly as typed");

  // --- 4. the previously-leaking sentence is Turkish on a Turkish screen ----
  await createBlankEvent(page, { name: "Toast Event", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 30 });
  await page.evaluate(() => {
    const e = activeEvent();
    for (let i = 0; i < 25; i++) e.guests.push({ id: "g" + i, name: "TOAST GUEST " + i, additionalGuests: 0, pax: 1, planningStatus: "Confirmed",
      arrivalStatus: "Not Arrived", assignment: null, vip: "Standard", invitedBy: "", notes: "", createdAt: new Date().toISOString() });
    touchEvent(e); render();
  });
  const trLeak = await page.evaluate(() => {
    ui.lang = "tr";
    document.querySelectorAll(".toast").forEach((n) => n.remove());
    toast(t("toast.eventCreatedWithPlan"), "success");
    const text = [...document.querySelectorAll(".toast")].pop()?.textContent || "";
    ui.lang = "en";
    return text;
  });
  checks.ok(/Planı inceleyin/.test(trLeak), "the sentence that used to reach a Turkish screen in English is Turkish", trLeak);

  // --- 5. capped, once, and the newest always shows -------------------------
  const clear = () => page.evaluate(() => document.querySelectorAll(".toast").forEach((n) => n.remove()));
  await gotoTab(page, "reports");
  await clear();
  const burst = await page.evaluate(() => {
    toast("Burst error that must survive", "error", 60000);
    for (let i = 1; i <= 7; i++) toast("Burst message " + i, "success", 60000);
    return [...document.querySelectorAll("#toastWrap .toast")].map((n) => n.textContent);
  });
  checks.ok(burst.length === 3, "eight toasts in a burst leave at most three on screen", burst);
  checks.ok(burst.includes("Burst error that must survive"), "an error outlives the routine confirmations raised after it", burst);
  checks.ok(burst[burst.length - 1] === "Burst message 7", "and the newest one is always shown", burst);

  await clear();
  const repeated = await page.evaluate(() => {
    toast("Other message", "info", 60000);
    for (let i = 0; i < 5; i++) toast("Same refusal", "error", 60000);
    const nodes = [...document.querySelectorAll("#toastWrap .toast")];
    const same = nodes.filter((n) => n.textContent === "Same refusal");
    return { count: same.length, shown: same[0]?.dataset.count || null, last: nodes[nodes.length - 1]?.textContent, total: nodes.length,
      badge: same[0] ? getComputedStyle(same[0], "::after").content : null };
  });
  checks.ok(repeated.count === 1 && repeated.total === 2, "the same message five times is ONE toast, not five", repeated);
  checks.ok(repeated.shown === "5" && /×/.test(repeated.badge || ""), "which says it happened five times (×5)", repeated);
  checks.ok(repeated.last === "Same refusal", "and moves to the newest place, where the operator is looking", repeated);

  // --- 6. held while it is being read ---------------------------------------
  await clear();
  await page.evaluate(() => toast("Hold me", "info", 700));
  const held = page.locator("#toastWrap .toast", { hasText: "Hold me" });
  await held.hover();
  await page.waitForTimeout(1400);
  checks.ok(await held.count() === 1, "a toast under the pointer does not disappear while it is being read");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1200);
  checks.ok(await held.count() === 0, "and leaves on its own once the pointer moves away");

  // --- 7. an undo offer is the last thing a burst pushes out ----------------
  await gotoTab(page, "guests");
  await clear();
  await autoAnswer(page, "confirm");
  await page.click('[data-guest-delete="g0"]');
  await page.waitForSelector(".toast .toast-action", { timeout: 5000 });
  await page.evaluate(() => { for (let i = 1; i <= 5; i++) toast("After the delete " + i, "success", 60000); });
  const undoLeft = await page.evaluate(() => ({ actions: document.querySelectorAll("#toastWrap .toast .toast-action").length,
    total: document.querySelectorAll("#toastWrap .toast").length,
    role: document.querySelector("#toastWrap .toast.has-action")?.getAttribute("role") }));
  checks.ok(undoLeft.actions === 1 && undoLeft.total === 3, "five confirmations after a delete do not push its Undo off the screen", undoLeft);
  checks.ok(undoLeft.role === "status", "and the Undo toast is announced like every other confirmation", undoLeft);
  await page.click("#toastWrap .toast-action");
  await settle(page);
  checks.ok(await page.evaluate(() => activeEvent().guests.some((g) => g.id === "g0")), "the Undo still works");
  await clear();

  // --- 8. never over the controls, on any screen, at three viewports --------
  const COVERABLE = "button,a[href],input,select,textarea,[role=button],[tabindex='0'],[draggable=true],.canvas-status,.planmap-status-pill,.seat-pill";
  const coveredBy = (label) => page.evaluate(({ label, COVERABLE }) => {
    document.querySelectorAll(".toast").forEach((n) => n.remove());
    const LONG = "Table T12 has 3 available chairs; the selected group needs 6. No assignments changed.";
    toast(LONG, "error", 60000); toast(LONG + " Again.", "success", 60000); toast(LONG + " Once more.", "info", 60000);
    const host = [...document.querySelectorAll(".toast-wrap")].find((w) => w.children.length);
    const wrap = host.getBoundingClientRect();
    const hits = [];
    for (const n of document.querySelectorAll(COVERABLE)) {
      if (n.closest(".toast-wrap")) continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= wrap.left || r.left >= wrap.right || r.bottom <= wrap.top || r.top >= wrap.bottom) continue;
      const top = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2));
      if (top && top.closest(".toast-wrap")) hits.push(`${label}: ${n.outerHTML.slice(0, 80)}`);
    }
    const inside = wrap.left >= 0 && wrap.right <= innerWidth && wrap.top >= 0 && wrap.bottom <= innerHeight;
    document.querySelectorAll(".toast").forEach((n) => n.remove());
    return { hits, inside };
  }, { label, COVERABLE });
  const overlaps = [], outside = [];
  const record = (r, label) => { overlaps.push(...r.hits); if (!r.inside) outside.push(label); };
  for (const vp of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(vp);
    const at = `${vp.width}×${vp.height}`;
    for (const tab of ["floor", "guests", "seating", "live", "reports"]) {
      await gotoTab(page, tab); await settle(page);
      record(await coveredBy(`${at} ${tab}`), `${at} ${tab}`);
    }
    // Seating with a table selected, and with Smart Seating's preview open —
    // its Apply button is the one control in that phase that moves a guest.
    await gotoTab(page, "seating");
    await page.evaluate(() => { ui.selectedTableId = activeEvent().tables[0].id; render(); });
    await settle(page);
    record(await coveredBy(`${at} seating/table`), `${at} seating/table`);
    await page.evaluate(() => { ui.selectedTableId = null; ui.selectedGuestId = "g1"; ui.seatPreview = null; render(); });
    await settle(page);
    const preview = await page.$("[data-seat-preview]");
    if (preview) { await preview.click(); await settle(page); }
    checks.ok(await page.$(".seat-preview"), `${at}: Smart Seating's preview card is open to measure against`);
    record(await coveredBy(`${at} seating/preview`), `${at} seating/preview`);
    await page.evaluate(() => { ui.selectedGuestId = null; ui.seatPreview = null; ui.screen = "events"; render(); });
    await settle(page);
    record(await coveredBy(`${at} events`), `${at} events`);
    await page.evaluate(() => { ui.screen = "workspace"; render(); });
    await settle(page);
  }
  checks.equal(overlaps, [], "a full stack of three long toasts covers no control and no status readout — on six screens, at 1920, 2560 and 1440");
  checks.equal(outside, [], "and the stack stays inside the viewport everywhere");

  // --- 9. raised inside a modal dialog, it is on TOP of that dialog ---------
  await page.setViewportSize({ width: 1920, height: 1080 });
  const onTop = () => page.evaluate(() => {
    const el = [...document.querySelectorAll(".toast")].pop();
    if (!el) return { none: true };
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const dlg = document.querySelector("dialog[open]");
    const controls = dlg ? [...dlg.querySelectorAll("button,input,select,textarea,a[href]")].filter((n) => {
      if (n.closest(".toast-wrap")) return false;
      const b = n.getBoundingClientRect();
      if (!b.width || b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom) return false;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return hit && hit.closest(".toast-wrap");
    }).map((n) => n.outerHTML.slice(0, 70)) : [];
    return { text: el.textContent, onTop: !!(top && top.closest(".toast")), topIs: top ? top.tagName + "#" + top.id : null,
      inDialog: el.closest("dialog")?.id || null, coversDialogControls: controls };
  });
  await gotoTab(page, "guests"); await settle(page);
  await clear();
  await page.click('[data-guest-command="add"]');
  await page.waitForFunction(() => document.getElementById("guestDialog").open);
  await page.fill('#guestForm input[name="name"]', "+3");
  await page.click("#guestForm .dialog-foot .btn.primary");
  await page.waitForTimeout(300);
  const guestDlg = await onTop();
  checks.ok(guestDlg.text === "Name Surname is required." && guestDlg.onTop,
    "the guest dialog's own validation error is shown ON TOP of the dialog, not dimmed behind its backdrop", guestDlg);
  checks.ok(guestDlg.inDialog === "guestDialog", "inside the dialog's top layer, where it is reachable and announced while the rest of the page is inert", guestDlg);
  checks.equal(guestDlg.coversDialogControls, [], "and it covers none of the dialog's own controls");
  // One place for toasts, dialog or not. A transform on the open dialog makes
  // it the containing block of the toast inside it, which put the toast INTO
  // the dialog's own box, over its form.
  const place = await page.evaluate(() => {
    const w = document.querySelector("#guestDialog > .toast-wrap").getBoundingClientRect();
    const d = document.getElementById("guestDialog").getBoundingClientRect();
    return { left: Math.round(w.left), bottomGap: Math.round(innerHeight - w.bottom),
      insideDialog: !(w.right <= d.left || w.left >= d.right || w.bottom <= d.top || w.top >= d.bottom) };
  });
  checks.ok(place.left === 16 && place.bottomGap === 16 && !place.insideDialog,
    "it appears where every other toast does — the viewport's corner, not inside the dialog's own box", place);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("guestDialog").open);
  await page.waitForTimeout(300);   // the dialog's close event is a task after close()
  const handedBack = await page.evaluate(() => [...document.querySelectorAll("#toastWrap .toast")].map((n) => n.textContent));
  checks.ok(handedBack.includes("Name Surname is required."),
    "closing the dialog hands its toast back to the page rather than hiding it inside a closed dialog", handedBack);

  for (const vp of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(vp);
    await clear();
    await page.click('[data-guest-command="import"]');
    await page.waitForFunction(() => document.getElementById("excelDialog").open);
    await page.evaluate(() => { toast("Table T12 has 3 available chairs; the selected group needs 6. No assignments changed.", "error", 60000); toast("Map one column to Name Surname — repeated to fill the stack.", "info", 60000); });
    const wizard = await onTop();
    checks.ok(wizard.onTop && wizard.inDialog === "excelDialog", `${vp.width}: a toast raised over the import wizard is on top of it`, wizard);
    checks.equal(wizard.coversDialogControls, [], `${vp.width}: and covers none of the wizard's controls`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("excelDialog").open);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await clear();

  // --- 10. the three conditions a toast used to carry alone ----------------
  // A fresh page, so storage faults are armed before boot.
  const p2 = await page.context().newPage();
  p2.on("pageerror", (e) => errors.push(`p2 pageerror: ${e.message}`));
  await installStorageFaults(p2);
  await openApp(p2, baseUrl, { lang: "en" });
  await createBlankEvent(p2, { name: "Condition Event", hotel: "Merit", date: futureDate() });
  const notice = (kind) => p2.evaluate((k) => document.querySelector(`[data-storage-notice="${k}"]`)?.textContent.replace(/\s+/g, " ").trim() || null, kind);
  const waitSaved = () => p2.evaluate(() => saveState());

  // (a) The plan image does not fit, the rest does: the save is retried
  // without images and SUCCEEDS — so nothing else would ever mention it.
  await p2.evaluate(() => { activeEvent().background = { src: "data:image/png;base64," + "A".repeat(400000), name: "plan.png" }; });
  await setFault(p2, "put", 200000);   // a record this large does not fit; one without the image does
  await waitSaved();
  await p2.waitForTimeout(200);
  checks.ok(/NOT stored/.test(await notice("images-dropped") || ""),
    "a plan image dropped from storage is a persistent notice, not only a toast", await notice("images-dropped"));
  await p2.evaluate(() => document.querySelectorAll(".toast").forEach((n) => n.remove()));
  await p2.evaluate(() => { touchEvent(activeEvent()); render(); });
  checks.ok(await notice("images-dropped"), "still there after the toast has gone and the screen has been redrawn");
  checks.ok(await p2.$('[data-storage-notice="images-dropped"] [data-storage-action="backup"]'),
    "with the control that keeps the image: a backup, which includes it");
  await setFault(p2, "put", null);
  await waitSaved();
  await p2.waitForTimeout(200);
  checks.ok(!(await notice("images-dropped")), "and it clears itself the moment a save stores the image after all");

  // (b) State that cannot be serialised. It used to toast "Browser storage is
  // full" — which was not what happened — and say nothing after that.
  await p2.evaluate(() => { activeEvent().__unserialisable = 1n; });
  await waitSaved();
  await p2.waitForTimeout(200);
  const serialise = await notice("save-failing");
  checks.ok(serialise && /could not be prepared for saving/.test(serialise),
    "a state that cannot be serialised raises the persistent 'not being saved' notice, in words that say what happened", serialise);
  checks.ok(!/full/i.test(serialise || ""), "and it no longer claims the storage is full", serialise);
  await p2.evaluate(() => { delete activeEvent().__unserialisable; });
  await waitSaved();
  await p2.waitForTimeout(200);
  checks.ok(!(await notice("save-failing")), "the notice clears itself on the next save that succeeds");

  // (c) The saved record is MISSING (not corrupt — that has its own notice),
  // and the boot quietly opened an older automatic recovery point.
  let snapshots = null;
  for (let i = 0; i < 40 && !snapshots; i++) { snapshots = await readRecord(p2, "autosnapshots"); if (!snapshots) await p2.waitForTimeout(200); }
  checks.require(snapshots, "precondition: an automatic recovery point exists on disk");
  // Off the app first: a reload would run its save-on-unload and put the
  // record straight back.
  await gotoBlank(p2, baseUrl);
  await deleteRecord(p2, "root");
  await bootApp(p2, baseUrl);
  await p2.waitForSelector('[data-storage-notice="recovered"]', { timeout: 15000 }).catch(() => {});
  const recovered = await notice("recovered");
  checks.ok(recovered && /recovery point/i.test(recovered),
    "a boot that fell back to an automatic recovery point says so in a persistent notice — changes after it may be missing", recovered);
  await p2.evaluate(() => document.querySelectorAll(".toast").forEach((n) => n.remove()));
  await p2.evaluate(() => render());
  checks.ok(await notice("recovered"), "which outlives the toast");
  await p2.click('[data-storage-notice="recovered"] [data-storage-action="dismiss"]');
  checks.ok(!(await notice("recovered")), "and the operator can put it away once they have checked");
  await p2.close();
}
