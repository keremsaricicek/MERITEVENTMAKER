// A FILE FROM ANOTHER MACHINE MUST NOT REACH THE LANGUAGE ITSELF.
//
// `.claude/skills/merit-security-hardening/SKILL.md`: "Backup and package
// import merge external JSON into application state. Keys `__proto__`,
// `constructor`, `prototype` must never be assigned from parsed input. This is
// the single highest-severity realistic bug in this codebase's shape, because
// those importers walk arbitrary object trees." And: "A suite — none exists
// today, and creating it is the first task."
//
// WHY THESE THREE KEYS. `JSON.parse` never pollutes anything by itself: it
// creates `__proto__` as an ordinary OWN property. The damage happens one step
// later, in code that copies with assignment rather than definition —
// `target[k] = source[k]` walking an object tree, or `Object.assign` — because
// ASSIGNING to `__proto__` is the prototype setter, and assigning into
// `x.constructor.prototype` is assigning into `Object.prototype`. After that,
// every object in the page inherits the file's values: an `if (guest.locked)`
// reads true on guests nobody locked, and the evening is wrong in a way no
// screen would show.
//
// So this suite asserts three things, through the REAL import controls, for
// every entry point that turns a file into keys:
//
//   1. THE LANGUAGE IS CLEAN. `Object.prototype` and `Array.prototype` carry
//      exactly the keys they carried before the import, and a fresh `{}`
//      inherits none of the file's markers.
//   2. NO RECORD'S PROTOTYPE WAS SWAPPED. Every object reachable from `state`
//      is a plain object or array — the per-object form of the same bug.
//   3. THE KEYS NEVER ENTER STATE AT ALL. Not even as harmless own
//      properties, because harmless is a property of TODAY'S copy code: the
//      first `Object.assign(existing, imported)` added tomorrow would turn a
//      dormant own `__proto__` into a live prototype swap, and it would have
//      been carried in, saved and exported by then. The schema defines no key
//      with any of these names, so no legitimate record loses anything.
//
// Each import must also still WORK — a guard that refused the whole file
// would pass the first two checks by importing nothing.
//
// MUTATION PROOF, recorded rather than remembered:
//   M1  `parseRecord` reduced to plain JSON.parse → 5 checks fail: the keys
//       ride into state, onto disk, and back out through the reload.
//   M2  M1 plus a naive recursive merge of the package into `{}` → 9 fail:
//       Object.prototype gains `locked`, `status` and every marker, so a fresh
//       `{}` reads as locked and Completed.
//   M3  `parseRecord` restored with the naive merge LEFT IN → all pass. That
//       is the claim: the boundary makes a careless copy harmless, instead of
//       depending on every future copy being written carefully.
//   M4  the reader's fast-path pre-check without its `\u` clause → the
//       escaped PACKAGE fixture fails (2b). The escaped BACKUP fixture (1b)
//       does not, because a restore reads the payload twice — see there.
//
// FOUND WHILE WRITING IT: SheetJS renames a `__proto__` header to
// `__proto___NaN` and `constructor` to `constructor_NaN` (its duplicate-header
// counter reads an inherited property), and a sheet NAMED `__proto__` swaps
// the prototype of SheetJS's own `Sheets` object — which still resolves the
// sheet by name, so the rows import. Neither reaches the language or state.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle, autoAnswer } from "../lib/app-actions.mjs";

export const meta = { name: "prototype-pollution", tags: ["security", "storage", "fast"], timeout: 150000, downloads: true };

const DANGEROUS = ["__proto__", "constructor", "prototype"];

// Define rather than assign: `obj.__proto__ = x` in THIS file would itself be
// the prototype setter, and the payload would silently never be written.
const plant = (target, key, value) =>
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

// Every dangerous shape at one site. `tag` names the site so a failure says
// WHERE in the file the key was taken from.
function poison(target, tag) {
  if (!target || typeof target !== "object") return;
  plant(target, "__proto__", { [`polluted_${tag}`]: true, locked: true, status: "Completed" });
  plant(target, "constructor", { prototype: { [`polluted_ctor_${tag}`]: true } });
  plant(target, "prototype", { [`polluted_proto_${tag}`]: true });
}

// What the page can see: the language's own prototypes, and every object in
// `state` whose prototype is not the ordinary one or which carries one of the
// three keys as its own property.
async function inspect(page) {
  return page.evaluate((DANGEROUS) => {
    const objectKeys = Object.getOwnPropertyNames(Object.prototype).sort();
    const arrayKeys = Object.getOwnPropertyNames(Array.prototype).sort();
    const inherited = [];
    for (const k in {}) inherited.push(k);
    const polluted = Object.keys(Object.prototype).concat(
      Object.getOwnPropertyNames(Object.prototype).filter((k) => /polluted/.test(k)));
    const swapped = [], ownDangerous = [];
    const seen = new Set();
    const walk = (v, where, depth) => {
      if (!v || typeof v !== "object" || seen.has(v) || depth > 40) return;
      seen.add(v);
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== Array.prototype && proto !== null)
        swapped.push(where);
      for (const k of DANGEROUS)
        if (Object.prototype.hasOwnProperty.call(v, k)) ownDangerous.push(`${where}.${k}`);
      for (const k of Object.keys(v)) walk(v[k], `${where}.${k}`, depth + 1);
    };
    walk(state, "state", 0);
    return {
      objectKeys, arrayKeys, inherited, polluted, swapped, ownDangerous,
      freshLocked: ({}).locked ?? null,
      freshStatus: ({}).status ?? null,
      events: state.events.map((e) => ({ name: e.name, guests: e.guests.length, tables: e.tables.length })),
    };
  }, DANGEROUS);
}

export default async function run({ page, checks, baseUrl, artifactDir }) {
  page.on("dialog", (d) => d.accept());
  await autoAnswer(page);
  await openApp(page, baseUrl, { lang: "en" });
  const clean = await inspect(page);
  checks.require(clean.polluted.length === 0 && clean.inherited.length === 0,
    "the page starts with an unpolluted Object.prototype — otherwise nothing below means anything", clean.polluted);

  // A realistic event: tables, an assigned guest, a freeze, a handover note —
  // so the file carries every nested shape the importers walk.
  await createBlankEvent(page, { name: "Pollution Source", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 6;
    e.tables[1].number = "T02"; e.tables[1].capacity = 6;
    e.guests = [{
      id: "g_pp", name: "Pollution Guest", additionalGuests: 1, pax: 2, vip: "Standard",
      invitedBy: "Host", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: { tableId: e.tables[0].id, seats: [0, 1], locked: false }, createdAt: new Date().toISOString(),
    }];
    e.freezes = [{ id: "f_pp", scope: "TABLE", tableId: e.tables[1].id, reason: "OTHER", note: "", createdAt: new Date().toISOString() }];
    touchEvent(e); render();
  });
  await gotoTab(page, "command");
  await settle(page);
  await page.fill("[data-handover-text]", "Pollution handover.");
  await click(page, "[data-handover-add]");
  await page.waitForTimeout(300);
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);

  const [backupDl] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="backup-export"]')]);
  const backup = JSON.parse(fs.readFileSync(await backupDl.path(), "utf8"));
  const [pkgDl] = await Promise.all([page.waitForEvent("download"), page.click("[data-export-event-package]")]);
  const pkg = JSON.parse(fs.readFileSync(await pkgDl.path(), "utf8"));

  const write = (name, obj) => {
    const f = path.join(artifactDir, name);
    fs.writeFileSync(f, JSON.stringify(obj));
    return f;
  };
  const importFile = async (file) => {
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(700);
  };

  // --- 1. BACKUP RESTORE ---------------------------------------------------
  // Poison every level the restore walks: the file, the payload, the event,
  // each table, chair, guest, assignment, freeze, handover note, the audit
  // log and its details, the venue records and their layouts.
  const evilBackup = JSON.parse(JSON.stringify(backup));
  const P = evilBackup.payload;
  poison(evilBackup, "file");
  poison(P, "payload");
  for (const e of P.events) {
    poison(e, "event");
    poison(e.background, "background");
    e.tables.forEach((t) => { poison(t, "table"); (t.chairs || []).forEach((c) => poison(c, "chair")); });
    e.guests.forEach((g) => { poison(g, "guest"); poison(g.assignment, "assignment"); });
    (e.freezes || []).forEach((f) => poison(f, "freeze"));
    (e.handoverNotes || []).forEach((n) => poison(n, "handover"));
    (e.venueObjects || []).forEach((o) => poison(o, "venueObject"));
  }
  (P.audit || []).forEach((a) => { poison(a, "audit"); poison(a.detail, "auditDetail"); });
  (P.venues || []).forEach((v) => { poison(v, "venue"); (v.layouts || []).forEach((l) => poison(l, "layout")); });
  poison(P.auditRetention, "auditRetention");
  const backupFile = write("evil-backup.json", evilBackup);
  const planted = (fs.readFileSync(backupFile, "utf8").match(/"__proto__"/g) || []).length;
  checks.ok(planted >= 10,
    "the backup file on disk really carries the keys as JSON text — defining rather than assigning them is what makes the fixture a fixture",
    planted);

  await importFile(backupFile);
  const afterBackup = await inspect(page);
  checks.ok(afterBackup.events.length === 1 && afterBackup.events[0].name === "Pollution Source" &&
    afterBackup.events[0].guests === 1 && afterBackup.events[0].tables === 2,
    "the poisoned backup still RESTORES — a guard that refused the file would pass the checks below by importing nothing",
    afterBackup.events);
  checks.equal(afterBackup.polluted, [], "after a backup restore, Object.prototype carries none of the file's keys", afterBackup.polluted);
  checks.equal(afterBackup.objectKeys, clean.objectKeys, "Object.prototype has exactly the properties it started with");
  checks.equal(afterBackup.arrayKeys, clean.arrayKeys, "and so does Array.prototype");
  checks.ok(afterBackup.freshLocked === null && afterBackup.freshStatus === null,
    "a fresh {} does not inherit `locked` or `status` from the file — the concrete way pollution would lie to the room",
    { locked: afterBackup.freshLocked, status: afterBackup.freshStatus });
  checks.equal(afterBackup.swapped, [], "no restored record had its prototype swapped", afterBackup.swapped.slice(0, 8));
  checks.equal(afterBackup.ownDangerous, [],
    "and none of the three keys entered state even as an own property, where tomorrow's Object.assign would arm it",
    afterBackup.ownDangerous.slice(0, 8));

  // The keys must not survive the save → reload round trip either: the
  // stored record is itself a file this build reads back on every boot.
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { try { return Array.isArray(state.events) && state.events.length > 0; } catch { return false; } }, null, { timeout: 20000 });
  await page.evaluate(() => { ui.lang = "en"; render(); });
  const afterReload = await inspect(page);
  checks.ok(afterReload.polluted.length === 0 && afterReload.swapped.length === 0 && afterReload.ownDangerous.length === 0,
    "after a save and reload the stored record carries none of it — the restore did not write a dormant payload to disk",
    { polluted: afterReload.polluted, swapped: afterReload.swapped.slice(0, 4), own: afterReload.ownDangerous.slice(0, 4) });

  // --- 1b. THE SAME KEYS, SPELLED WITH ESCAPES ------------------------------
  // `"__proto__"` is `__proto__` to JSON.parse. The reader skips its
  // reviver on text that cannot name a forbidden key, and this is the fixture
  // that says whether "cannot" is true: every key rewritten so the literal
  // name appears nowhere in the file.
  //
  // On THIS path the fixture cannot tell a sound fast path from an unsound
  // one, and the reason is worth knowing: a restore re-serialises the payload
  // and `parseRoot` reads it a second time, by which point the keys are
  // literal again. Mutation M4 (dropping the `\u` clause from the pre-check)
  // passed here. The package path below reads the file exactly once, and is
  // where M4 fails.
  const escapeKeys = (text) => text
    .replaceAll('"__proto__"', '"__pro\\u0074o__"')
    .replaceAll('"constructor"', '"construct\\u006fr"')
    .replaceAll('"prototype"', '"prot\\u006ftype"');
  const escaped = escapeKeys(fs.readFileSync(backupFile, "utf8"));
  checks.ok(!/"__proto__"|"constructor"|"prototype"/.test(escaped),
    "the escaped fixture spells none of the three names literally", null);
  const escapedFile = path.join(artifactDir, "evil-backup-escaped.json");
  fs.writeFileSync(escapedFile, escaped);
  await page.evaluate(() => { state.events[0].name = "Before Escaped Restore"; });
  await importFile(escapedFile);
  const afterEscaped = await inspect(page);
  checks.equal(afterEscaped.events[0]?.name, "Pollution Source", "the escaped backup restores", afterEscaped.events);
  checks.ok(afterEscaped.polluted.length === 0 && afterEscaped.swapped.length === 0 && afterEscaped.ownDangerous.length === 0,
    "and escaping the keys smuggles nothing past the reader — into the language, a prototype, or state",
    { polluted: afterEscaped.polluted, swapped: afterEscaped.swapped.slice(0, 4), own: afterEscaped.ownDangerous.slice(0, 4) });

  // --- 2. EVENT PACKAGE IMPORT --------------------------------------------
  const evilPkg = JSON.parse(JSON.stringify(pkg));
  poison(evilPkg, "pkg");
  poison(evilPkg.event, "pkgEvent");
  evilPkg.event.tables.forEach((t) => { poison(t, "pkgTable"); (t.chairs || []).forEach((c) => poison(c, "pkgChair")); });
  evilPkg.event.guests.forEach((g) => { poison(g, "pkgGuest"); poison(g.assignment, "pkgAssignment"); });
  (evilPkg.event.freezes || []).forEach((f) => poison(f, "pkgFreeze"));
  (evilPkg.event.handoverNotes || []).forEach((n) => poison(n, "pkgHandover"));
  (evilPkg.auditEntries || []).forEach((a) => { poison(a, "pkgAudit"); poison(a.detail, "pkgAuditDetail"); });
  // A venue that does not exist here yet, so the import takes the branch that
  // copies it in as a new record.
  if (evilPkg.venue) { evilPkg.venue.id = "venue-from-elsewhere"; poison(evilPkg.venue, "pkgVenue"); }
  if (evilPkg.event.venueRef) evilPkg.event.venueRef.venueId = "venue-from-elsewhere";
  const pkgFile = write("evil-package.json", evilPkg);
  await importFile(pkgFile);
  const afterPkg = await inspect(page);
  checks.equal(afterPkg.events.length, afterReload.events.length + 1,
    "the poisoned package still IMPORTS as one new event", afterPkg.events);
  checks.equal(afterPkg.polluted, [], "after a package import, Object.prototype carries none of the file's keys", afterPkg.polluted);
  checks.equal(afterPkg.objectKeys, clean.objectKeys, "Object.prototype is unchanged");
  checks.equal(afterPkg.swapped, [], "no imported record had its prototype swapped", afterPkg.swapped.slice(0, 8));
  checks.equal(afterPkg.ownDangerous, [], "and none of the three keys entered state", afterPkg.ownDangerous.slice(0, 8));

  // --- 2b. THE PACKAGE AGAIN, KEYS ESCAPED --------------------------------
  // One read of the file and no second chance, so this is the fixture that
  // decides whether the reader's fast path is sound.
  const escapedPkgFile = path.join(artifactDir, "evil-package-escaped.json");
  fs.writeFileSync(escapedPkgFile, escapeKeys(fs.readFileSync(pkgFile, "utf8")));
  await importFile(escapedPkgFile);
  const afterEscapedPkg = await inspect(page);
  checks.equal(afterEscapedPkg.events.length, afterPkg.events.length + 1,
    "the escaped package imports as one more event", afterEscapedPkg.events);
  checks.ok(afterEscapedPkg.polluted.length === 0 && afterEscapedPkg.swapped.length === 0 && afterEscapedPkg.ownDangerous.length === 0,
    "and a key spelled `__pro\\u0074o__` is dropped exactly like the literal one — the reader's shortcut only skips text that genuinely cannot name a forbidden key",
    { polluted: afterEscapedPkg.polluted, swapped: afterEscapedPkg.swapped.slice(0, 4), own: afterEscapedPkg.ownDangerous.slice(0, 4) });

  // --- 3. GUEST SPREADSHEET: the keys arrive as COLUMN HEADERS ------------
  // A header is a key the file chose. The wizard builds `mapping[header]` and
  // `row[header]`; a `__proto__` header written with assignment would be the
  // prototype setter. The same payload through both parsers the product has:
  // its own CSV reader and the embedded SheetJS one.
  await page.evaluate(() => { ui.activeEventId = state.events[0].id; ui.screen = "workspace"; ui.tab = "guests"; render(); });
  await page.waitForTimeout(300);
  const csv = [
    "__proto__,Name Surname,constructor,prototype,Pax",
    "{\"polluted_csv\":true},CSV HEADER GUEST,{\"prototype\":{\"polluted_csv_ctor\":true}},x,2",
  ].join("\n");
  const xlsx = await page.evaluate(() => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["__proto__", "Name Surname", "constructor", "prototype", "Pax"],
      ["{\"polluted_xlsx\":true}", "XLSX HEADER GUEST", "{\"prototype\":{\"polluted_xlsx_ctor\":true}}", "x", 3],
    ]);
    const wb = XLSX.utils.book_new();
    // The SHEET is named `__proto__` too: the reader looks the first sheet up
    // by name, `book.Sheets[book.SheetNames[0]]`, which is exactly the lookup
    // a prototype setter hides behind.
    XLSX.utils.book_append_sheet(wb, ws, "__proto__");
    // `type: "array"` returns an ArrayBuffer, which Array.from() reads as
    // EMPTY — the first version of this fixture uploaded a zero-byte file and
    // the product, correctly, said it held no rows.
    return Array.from(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
  });
  for (const [label, file] of [
    ["CSV", { name: "evil-headers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }],
    ["XLSX", { name: "evil-headers.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(xlsx) }],
  ]) {
    const guestName = `${label} HEADER GUEST`;
    const before = await inspect(page);
    await click(page, "[data-guest-command='import']");
    await page.setInputFiles("#guestFileInput", file);
    await page.waitForTimeout(500);
    const headers = await page.evaluate(() => (pendingImport ? pendingImport.headers : null));
    checks.ok(Array.isArray(headers) && headers.includes("Name Surname"),
      `${label}: the file reaches the wizard with its headers`, headers);
    // Drive the wizard the way an operator does: preview → mapping → interpret
    // → summary → import.
    for (let i = 0; i < 3; i++) { await click(page, "[data-wizard-next]"); await page.waitForTimeout(200); }
    await click(page, "[data-wizard-import]");
    await page.waitForTimeout(500);
    const r = await inspect(page);
    const imported = await page.evaluate((n) => {
      const g = state.events[0].guests.find((x) => x.name === n);
      return g ? { pax: g.pax } : null;
    }, guestName);
    checks.ok(imported && imported.pax === (label === "CSV" ? 2 : 3),
      `${label}: the row still imports as one guest with its own pax — the dangerous headers are ignored, not fatal`, imported);
    checks.ok(r.polluted.length === 0 && r.objectKeys.join() === clean.objectKeys.join(),
      `${label}: a __proto__ / constructor / prototype COLUMN HEADER pollutes nothing`, r.polluted);
    // Measured as a DELTA over this import alone, so a failure here names the
    // spreadsheet path and not something a previous section left behind.
    const added = r.ownDangerous.filter((w) => !before.ownDangerous.includes(w));
    checks.equal(added, [], `${label}: and none of the header names entered state`, added.slice(0, 6));
  }
}
