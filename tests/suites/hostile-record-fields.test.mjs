// A FILE FROM ANOTHER MACHINE CARRIES MORE THAN TEXT FIELDS.
//
// `hostile-input` puts a payload in every field a person can TYPE or a
// spreadsheet can FILL — names, notes, labels — and walks every screen. Those
// are escaped where they are shown. But a backup or an event package is a whole
// record, and it also carries the fields nobody types: the ids that tie a guest
// to a table, a chair to its table, a freeze to what it covers; the plan image's
// address; what the last analysis made of the drawing. The screens put those
// into ATTRIBUTES — `data-guest-edit="<id>"`, `<img src="<plan>">` — and an
// attribute is where one unescaped `"` ends the value and starts markup.
//
// A file this product wrote never holds a `"` or `<` in an id or a plan
// address. A file somebody edited by hand, or built, can. This suite builds one
// from a real export: every id in it (and every reference to that id, so the
// record stays internally consistent and is not refused for broken references)
// gets a quote-breaking payload appended, and the plan address becomes one. It
// is restored through the real backup control and imported through the real
// package control, and every screen is walked, as in `hostile-input`:
//
//   NOTHING RAN           `window.__pwned` stays empty.
//   NOTHING BECAME MARKUP no `on*` attribute built from the payload, no script.
//   THE EVENT STILL WORKS the record was not refused (refusing every file with an
//                        odd character would pass the first two by importing
//                        nothing), and its guest is still seated at its table.
//
// MUTATION PROOF, recorded:
//   R1  before the fix (2026-11-01): the restored backup fired on the very first
//       screen (Events list: `event.id` in `data-open-event="…"`), and the plan
//       review fired from `<img src="${event.background.src}">`.
//   R2  the import boundary's id rule reverted → the same screens fire again.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, autoAnswer } from "../lib/app-actions.mjs";

export const meta = { name: "hostile-record-fields", tags: ["security", "storage", "fast"], timeout: 300000, downloads: true };

const breakout = (tag) => `"><img src=x onerror="window.__pwned.push('${tag}')"><b x="`;
// A data: address, so the escaped (harmless) form requests nothing over the
// network; the quote after it is what used to end the attribute.
const BG_SRC = `data:image/png;base64,AAAA" onerror="window.__pwned.push('background.src')" data-x="`;

async function audit(page, where, checks) {
  const r = await page.evaluate(() => {
    const handlerAttrs = [], scripts = [];
    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) if (/^on/i.test(a.name) && /__pwned/.test(a.value)) handlerAttrs.push(`${el.tagName}.${a.name}=${a.value.slice(0, 60)}`);
      if (el.tagName === "SCRIPT" && /__pwned/.test(el.textContent)) scripts.push("SCRIPT");
    }
    return { pwned: [...new Set(window.__pwned)], handlerAttrs: [...new Set(handlerAttrs)], scripts };
  });
  checks.equal(r.pwned, [], `${where}: nothing carried in an id or a plan address RAN`, r.pwned);
  checks.ok(!r.handlerAttrs.length && !r.scripts.length,
    `${where}: nothing carried in an id or a plan address BECAME MARKUP`, r.handlerAttrs.slice(0, 6));
  return r;
}

// Every value under a key named `id` (in the chosen parts of the record) is an
// id; every string VALUE anywhere in the record equal to one of them is a
// reference to it. Both get the same payload,
// tagged with where the id was defined, so the record stays consistent.
function poison(root, from, { only = null, skip = null } = {}) {
  const ids = new Map();
  const collect = (v, at) => {
    if (Array.isArray(v)) return v.forEach((x) => collect(x, at));
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "id" && ((only && !only.includes(at)) || (skip && skip.includes(at)))) continue;
      // A bare word ("seats", "zones") is a fact's NAME used as its id, and the
      // same word is ordinary data elsewhere; swapping it would corrupt the
      // record for a reason that has nothing to do with markup.
      if (k === "id" && typeof x === "string" && !/^[A-Za-z]*$/.test(x) && !ids.has(x)) ids.set(x, x + breakout(`${at}.id`));
      collect(x, k);
    }
  };
  for (const [at, sub] of Object.entries(from(root))) collect(sub, at);
  // An id a skipped kind of record owns stays itself everywhere, even where
  // another record reuses it as its own id (a scene-graph node is its object).
  if (skip) {
    const owned = (v, at) => {
      if (Array.isArray(v)) return v.forEach((x) => owned(x, at));
      if (!v || typeof v !== "object") return;
      for (const [k, x] of Object.entries(v)) { if (k === "id" && skip.includes(at)) ids.delete(x); else owned(x, k); }
    };
    for (const [at, sub] of Object.entries(from(root))) owned(sub, at);
  }
  const swap = (v) => {
    if (typeof v === "string") return ids.has(v) ? ids.get(v) : v;
    if (Array.isArray(v)) return v.map(swap);
    if (!v || typeof v !== "object") return v;
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = swap(x);
    return o;
  };
  return { out: swap(root), n: ids.size };
}

async function walk(page, checks, label, eventId) {
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await settle(page);
  await audit(page, `${label}: Events list`, checks);
  await page.evaluate((id) => { ui.activeEventId = id; ui.screen = "workspace"; render(); }, eventId);
  for (const tab of ["command", "floor", "guests", "seating", "live", "reports"]) {
    await gotoTab(page, tab); await settle(page);
    await audit(page, `${label}: ${tab}`, checks);
  }
  await page.evaluate(() => { const e = activeEvent(); ui.tab = "seating"; ui.selectedObjectId = e.tables[0].id; render(); });
  await settle(page);
  await audit(page, `${label}: Seating, table selected`, checks);
  await page.evaluate(() => { const e = activeEvent(); ui.tab = "floor"; ui.selectedObjectId = e.tables[0].id; ui.selectedObjectIds = [e.tables[0].id]; render(); });
  await settle(page);
  await audit(page, `${label}: Floor Plan, table selected`, checks);
  await page.evaluate(() => { ui.selectedObjectId = null; ui.selectedObjectIds = []; ui.tab = "floor"; ui.planMode = "review"; render(); });
  await settle(page);
  await audit(page, `${label}: Plan review`, checks);
  await page.evaluate(() => { const a = activeEvent().analysis; ui.selectedCandidateId = a && a.candidates[0] ? a.candidates[0].id : null; ui.reviewCenterOpen = true; render(); });
  await settle(page);
  await audit(page, `${label}: Plan review, a candidate selected, Review Center open`, checks);
  await page.evaluate(() => { ui.reviewCenterOpen = false; ui.selectedCandidateId = null; ui.planMode = null; render(); });
  await gotoTab(page, "guests");
  const gid = await page.evaluate(() => activeEvent().guests[0].id);
  await page.locator(`[data-guest-edit]`).first().click();
  await page.waitForTimeout(250);
  await audit(page, `${label}: Guest dialog`, checks);
  await page.evaluate(() => { const d = document.getElementById("guestDialog"); if (d.open) d.close(); });
  return gid;
}

export default async function run({ page, checks, baseUrl, artifactDir, repoRoot }) {
  await page.addInitScript(() => { window.__pwned = []; });
  page.on("dialog", (d) => d.accept());
  await autoAnswer(page);
  await openApp(page, baseUrl, { lang: "en" });

  // ---- a real event, analysed, exported ------------------------------------
  await createBlankEvent(page, { name: "Record Source", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });
  const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/adversarial/fixtures/a1-chair-under-table.png"));
  await page.evaluate((src) => {
    const e = state.events[0];
    e.background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    e.tables[0].capacity = 6; e.tables[1].capacity = 6;
    e.venueObjects = [{ id: "vo_rec", type: "stage", label: "Stage", x: 600, y: 400, w: 300, h: 120, rotation: 0, locked: false, z: 3 }];
    e.guests = [
      { id: "g_rec", name: "Seated Guest", additionalGuests: 1, pax: 2, vip: "VIP", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
        assignment: { tableId: e.tables[0].id, seats: [0, 1], locked: false }, createdAt: new Date().toISOString() },
      { id: "g_rec2", name: "Unseated Guest", additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "", planningStatus: "Tentative", arrivalStatus: "Not Arrived",
        assignment: null, createdAt: new Date().toISOString() },
    ];
    e.freezes = [{ id: "f_rec", scope: "TABLE", tableId: e.tables[1].id, reason: "OTHER", note: "held", createdAt: new Date().toISOString() }];
    e.handoverNotes = [{ id: "h_rec", text: "note", by: "ops", at: new Date().toISOString() }];
    ui.tab = "floor"; render();
  }, "data:image/png;base64," + plan.toString("base64"));
  await page.waitForTimeout(300);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 180000 });
  await page.waitForTimeout(400);
  checks.require(await page.evaluate(() => state.events[0].analysis.candidates.length > 0), "the analysis found objects, so its ids are in the record too");

  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent("download"), click(page, '[data-action="backup-export"]')]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  const [dlp] = await Promise.all([page.waitForEvent("download"), click(page, "[data-export-event-package]")]);
  const pkg = JSON.parse(fs.readFileSync(await dlp.path(), "utf8"));

  // ---- 0. AN EVENT-LEVEL ID WITH MARKUP IS REFUSED, NOTHING CHANGED ----------
  const all = poison(backup, (b) => ({ events: b.payload.events }));
  const refusedFile = path.join(artifactDir, "hostile-record-event-ids.json");
  fs.writeFileSync(refusedFile, JSON.stringify(all.out));
  const keep = await page.evaluate(() => JSON.stringify(state.events.map((e) => e.id)));
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", refusedFile);
  await page.waitForTimeout(700);
  const refused = await page.evaluate(() => ({ toast: [...document.querySelectorAll(".toast")].map((x) => x.textContent).pop() || "", ids: JSON.stringify(state.events.map((e) => e.id)) }));
  checks.ok(/identifier this product writes/.test(refused.toast) && refused.ids === keep,
    "a backup whose event, table or guest ids carry markup is refused whole, with the reason, and nothing is replaced", refused);
  await audit(page, "after refusing the event-level ids", checks);

  // ---- 1. A HOSTILE BACKUP, restored ----------------------------------------
  // The ids the event boundary already checks (event, tables, chairs, guests,
  // objects, freezes, notes — `MeritEventPackage.eventProblem`) refuse the
  // file outright; part 0 below holds that. Everything else a backup carries
  // is poisoned here: what the analysis made of the plan, the venues and their
  // layouts, the lessons, the operator sessions.
  const rest = (b) => ({ analysis: b.payload.events.map((e) => e.analysis), venues: b.payload.venues,
    teachings: b.payload.teachings, operatorSessions: b.payload.operatorSessions, analyses: b.payload.analyses });
  // 1a. The detected objects' own ids are drawn into the review map by code
  //     that does not escape them; the boundary refuses them, like an event id.
  const cand = poison(backup, rest, { only: ["candidates"] });
  const candFile = path.join(artifactDir, "hostile-record-candidate-ids.json");
  fs.writeFileSync(candFile, JSON.stringify(cand.out));
  const keepA = await page.evaluate(() => JSON.stringify(state.events.map((e) => e.id)));
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", candFile);
  await page.waitForTimeout(700);
  const refusedA = await page.evaluate(() => ({ toast: [...document.querySelectorAll(".toast")].map((x) => x.textContent).pop() || "", ids: JSON.stringify(state.events.map((e) => e.id)) }));
  checks.ok(cand.n > 0 && /analysis\.candidates\[\d+\]\.id is not an identifier this product writes/.test(refusedA.toast) && refusedA.ids === keepA,
    "a backup whose detected objects' ids carry markup is refused whole, naming the field, and nothing is replaced", { n: cand.n, ...refusedA });
  // 1b. Every other id the record carries is restored as it is, and must be
  //     harmless wherever it is shown.
  const pb = poison(backup, rest, { skip: ["candidates"] });
  for (const e of pb.out.events || []) if (e.background) e.background.src = BG_SRC;
  const backupFile = path.join(artifactDir, "hostile-record-backup.json");
  fs.writeFileSync(backupFile, JSON.stringify(pb.out));
  checks.ok(pb.n > 10, "the hostile backup carries a payload in every id (and every reference to it)", pb.n);

  await page.evaluate(() => { state.events = []; state.venues = []; render(); });
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", backupFile);
  await page.waitForTimeout(900);
  const restored = await page.evaluate(() => ({ toast: [...document.querySelectorAll(".toast")].map((x) => x.textContent).pop() || null, n: state.events.length, id: state.events[0] && state.events[0].id,
    seated: !!(state.events[0] && state.events[0].guests.find((g) => g.name === "Seated Guest")?.assignment?.tableId === state.events[0].tables[0].id) }));
  checks.require(restored.n === 1, "the hostile backup was restored, not refused — the fix is not to refuse a whole evening over an id", restored);
  checks.ok(restored.seated, "and its guest is still seated at its table: ids and the references to them still agree", restored);
  await walk(page, checks, "Backup", restored.id);

  // ---- 2. A HOSTILE EVENT PACKAGE, imported beside it -----------------------
  const pp = poison(pkg, (p) => ({ analysis: p.event && p.event.analysis, venue: p.venue }), { skip: ["candidates"] });
  if (pp.out.event && pp.out.event.background) pp.out.event.background.src = BG_SRC;
  const pkgFile = path.join(artifactDir, "hostile-record-package.json");
  fs.writeFileSync(pkgFile, JSON.stringify(pp.out));
  await page.evaluate(() => { window.__pwned.length = 0; ui.screen = "events"; render(); });
  await settle(page);
  const before = await page.evaluate(() => state.events.map((e) => e.id));
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", pkgFile);
  await page.waitForTimeout(900);
  const added = await page.evaluate((b) => state.events.filter((e) => !b.includes(e.id)).map((e) => e.id), before);
  const pkgToast = await page.evaluate(() => [...document.querySelectorAll(".toast")].map((x) => x.textContent).pop() || null);
  checks.require(added.length === 1, "the hostile package was imported as one new event", { added, toast: pkgToast });
  await walk(page, checks, "Package", added[0]);

  // ---- 3. WHAT THE ANALYSIS SAYS ABOUT AN OBJECT, not only its id ------------
  // The review map draws each detected object from its kind, status and
  // position — values the detector writes as words and numbers. A file can
  // hold anything there. Planted on a clean package, every object.
  const values = JSON.parse(JSON.stringify(pkg));
  for (const c of values.event.analysis.candidates) {
    c.kind = "table" + breakout("candidates.kind"); c.status = "unreviewed" + breakout("candidates.status");
    c.x = "10" + breakout("candidates.x"); c.rotation = "0" + breakout("candidates.rotation");
    for (const ch of c.chairDetections || []) { ch.x = "5" + breakout("chairDetections.x"); ch.rotation = "0" + breakout("chairDetections.rotation"); }
  }
  const valuesFile = path.join(artifactDir, "hostile-record-values.json");
  fs.writeFileSync(valuesFile, JSON.stringify(values));
  await page.evaluate(() => { window.__pwned.length = 0; ui.screen = "events"; ui.planMode = null; render(); });
  await settle(page);
  const before3 = await page.evaluate(() => JSON.stringify(state.events.map((e) => e.id)));
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", valuesFile);
  await page.waitForTimeout(900);
  const r3 = await page.evaluate((b) => ({ toast: [...document.querySelectorAll(".toast")].map((x) => x.textContent).pop() || "",
    added: state.events.filter((e) => !JSON.parse(b).includes(e.id)).map((e) => e.id) }), before3);
  if (r3.added.length) await walk(page, checks, "Package with hostile object values", r3.added[0]);
  checks.ok(!r3.added.length && /was not (restored|imported)/i.test(r3.toast),
    "a package whose analysis gives an object a kind, status or position that is not a word or a number is refused whole, with the reason",
    r3);
  // 3b. a position alone that is not a number: the message says so, not "is not a record"
  const numOnly = JSON.parse(JSON.stringify(pkg));
  numOnly.event.analysis.candidates[0].x = "10" + breakout("candidates.x");
  const numFile = path.join(artifactDir, "hostile-record-number.json");
  fs.writeFileSync(numFile, JSON.stringify(numOnly));
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", numFile);
  await page.waitForTimeout(900);
  const r3b = await page.evaluate(() => [...document.querySelectorAll(".toast")].map((x) => x.textContent).pop() || "");
  checks.ok(/candidates\[0\]\.x is not a number/.test(r3b), "a refused position is named as not a number", r3b);

  // ---- 4. THE SAME VALUES ALREADY IN STORAGE ---------------------------------
  // Part 3's import rule protects new files; a record saved before that rule
  // (or written by anything that is not the import) reaches the review map as
  // it is. The map itself must draw those values as text and numbers.
  // Mutation proof (2026-11-01): `candidateBox` in app-v8.js unescaped → the
  // review map fired `candidates.kind` / `candidates.status` / `candidates.id`.
  await page.evaluate(({ k, s, i }) => {
    window.__pwned.length = 0;
    const e = state.events.find((x) => x.analysis && x.analysis.candidates && x.analysis.candidates.length);
    for (const c of e.analysis.candidates) {
      c.kind = "table" + k; c.status = "unreviewed" + s; c.id = c.id + i;
      c.x = "10" + k; c.rotation = "0" + s;
      for (const ch of c.chairDetections || []) { ch.x = "5" + k; ch.rotation = "0" + s; }
    }
    ui.activeEventId = e.id; ui.screen = "workspace"; ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = null; render();
  }, { k: breakout("stored.kind"), s: breakout("stored.status"), i: breakout("stored.id") });
  await settle(page);
  await audit(page, "Plan review of a record already in storage", checks);
}
