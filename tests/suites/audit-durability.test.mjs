// WHAT THE ACTIVITY LOG IS ALLOWED TO FORGET.
//
// `state.audit` is ONE root-level log shared by every event in the install,
// and it was capped at 1,000 entries by an unconditional
// `state.audit.slice(0, 1000)` on every single write. Two things follow, and
// both are data loss:
//
//   A SINGLE EVENT OUTGROWS THE CAP ON ITS OWN. Arrival status changes are
//   audited one per guest, and this product is specified for four thousand
//   guests. A busy door silently erased that same event's EVENT_CREATED,
//   its freezes, and every teach decision made while setting the room up.
//
//   ONE EVENT ERASED ANOTHER'S HISTORY. The log is shared, so a second
//   event's check-ins evicted the first event's decisions — an event whose
//   own trail was complete on Friday was missing its opening entries by
//   Saturday, with nothing on screen saying so.
//
// The old disclosure was a banner reading "the oldest entries across ALL
// events MAY have been superseded and are no longer available here." That
// sentence is the shape of the defect: the product did not know what it had
// dropped, so it could only warn that it might have dropped something.
//
// This suite fixes the contract in three parts:
//
//   1. DURABLE STORAGE IS NOT A DISPLAY LIMIT. The log keeps what happened.
//      How many rows one screen paints is a rendering decision and has
//      nothing to do with what is retained.
//
//   2. A RETENTION CEILING MAY EXIST, BUT NOT INSIDE THE WORKING RANGE.
//      Same lesson the detector's MAX_TABLES taught at 240: a ceiling a real
//      operator reaches is a correctness bug, not a resource policy.
//
//   3. NOTHING IS DROPPED SILENTLY. If the ceiling is ever reached, the
//      product records how many entries went and how far back the log now
//      begins — a fact, not a "may have".
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "audit-durability", tags: ["business", "fast"], timeout: 180000 };

// Well above the old 1,000 cap, and above what one busy event produces.
const PER_EVENT = 1500;
const EVENTS = 3;
const EACH = 600;

export default async function run({ page, checks, baseUrl, repoRoot }) {
  // --- 1. the ceiling, read from the source it lives in ---------------------
  const mod = fs.readFileSync(path.join(repoRoot, "src", "audit-trail.js"), "utf8");
  const retention = mod.match(/RETENTION_LIMIT\s*=\s*(\d+)/);
  checks.require(retention, "durable retention is a named constant in the audit module", retention);
  const limit = Number(retention[1]);
  checks.ok(limit >= 50000,
    "the retention ceiling sits far above operational scale. It was 1,000 — and one 4,000-guest event's arrivals alone exceed that, so the cap was erasing the very event that was producing the entries",
    limit);

  const display = mod.match(/DISPLAY_LIMIT\s*=\s*(\d+)/);
  checks.require(display, "and how many rows one screen paints is a SEPARATE named constant", display);
  const shown = Number(display[1]);
  checks.ok(shown > 0 && shown < limit / 10,
    "the display window is far smaller than retention — these are two different questions, and answering them with one number is what made a rendering limit destroy data",
    { display: shown, retention: limit });

  // Read CODE, not the comments that explain the old bug — those mention the
  // very expression being banned, and a scanner that cannot tell the two
  // apart reports the explanation as the defect.
  const v8 = fs.readFileSync(path.join(repoRoot, "src", "app-v8.js"), "utf8")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").replace(/\s/g, "");
  const truncations = (v8.match(/audit[^;]{0,40}\.slice\(0,1000\)/g) || []);
  checks.equal(truncations.length, 0,
    "no audit write path truncates at 1,000 any more — not the writer, and not the package import, which applied the same cap to entries it had just been handed",
    truncations);

  await openApp(page, baseUrl, { lang: "en" });

  // --- 2. the shell's own writer, on the real path ------------------------
  // A handful of genuine check-ins through setArrival() — the one writer of
  // the arrival axis AND of its audit entry. This proves the shell writes
  // through the retention path at all; the static check above proves it no
  // longer truncates afterwards, and scale is exercised below.
  await createBlankEvent(page, { name: "Busy Door", hotel: "Merit Royal", date: futureDate() });
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests = Array.from({ length: 3 }, (_, i) => ({
      id: "g" + i, name: "Guest " + i, additionalGuests: 0, pax: 1, vip: "Standard",
      invitedBy: "Host", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString(),
    }));
    touchEvent(e); render();
  });
  await gotoTab(page, "live");
  await settle(page);
  for (const id of ["g0", "g1", "g2"]) {
    await click(page, `[data-live-guest="${id}"][data-arrival="Checked In"]`);
    await page.waitForTimeout(120);
  }
  const real = await page.evaluate(() => {
    const e = state.events[0];
    return {
      arrivals: state.audit.filter(a => a.eventId === e.id && a.action === "ARRIVAL_STATUS_CHANGED").length,
      hasCreation: state.audit.some(a => a.eventId === e.id && a.action === "EVENT_CREATED"),
      retention: state.auditRetention,
    };
  });
  checks.equal(real.arrivals, 3, "three check-ins at the real door wrote three audit entries through the product's own writer", real.arrivals);
  checks.ok(real.hasCreation, "alongside the event's own creation entry", real.hasCreation);
  checks.equal(real.retention, null,
    "and nothing was evicted, so the retention record stays null rather than claiming a loss that did not happen", real.retention);

  // --- 2b. one event outgrows the old cap and loses nothing ----------------
  // Built through MeritAuditTrail.append — the exact call the shell makes —
  // because 1,500 round trips through setArrival() would measure render()
  // rather than retention.
  const one = await page.evaluate((n) => {
    const e = state.events[0];
    let retention = state.auditRetention || null;
    for (let i = 0; i < n; i++) {
      const r = MeritAuditTrail.append(state.audit, {
        id: "pad_" + i, eventId: e.id, action: "ARRIVAL_STATUS_CHANGED",
        detail: { guestId: "g0", from: "Not Arrived", to: "Checked In", seq: i },
        at: new Date(Date.now() + i).toISOString(),
      });
      state.audit = r.log;
      retention = MeritAuditTrail.recordEviction(retention, r);
    }
    state.auditRetention = retention;
    const mine = state.audit.filter(a => a.eventId === e.id && a.action === "ARRIVAL_STATUS_CHANGED" && a.detail && a.detail.seq !== undefined);
    return {
      total: state.audit.length,
      mine: mine.length,
      oldestSeq: mine.length ? mine[mine.length - 1].detail.seq : null,
      hasCreation: state.audit.some(a => a.eventId === e.id && a.action === "EVENT_CREATED"),
      evicted: retention ? retention.evicted : 0,
    };
  }, PER_EVENT);
  checks.equal(one.mine, PER_EVENT,
    `all ${PER_EVENT} decisions from one event are retained — the old cap kept 1,000 and dropped the rest without a word`,
    one.mine);
  checks.equal(one.oldestSeq, 0,
    "including the very FIRST one. Under the old cap this was the entry most certainly gone, because eviction took the oldest", one.oldestSeq);
  checks.ok(one.hasCreation,
    "and the event's own EVENT_CREATED survived its door. An event that cannot say when it was created has lost the first line of its history to its own busiest hour",
    one.hasCreation);
  checks.equal(one.evicted, 0,
    "nothing was evicted at this scale, and the product says so with a number rather than a 'may have'", one.evicted);

  // --- 3. one event never erases another's history --------------------------
  const many = await page.evaluate(({ events, each }) => {
    let retention = state.auditRetention || null;
    const write = (eventId, action, detail, i) => {
      const r = MeritAuditTrail.append(state.audit,
        { id: eventId + "_" + action + "_" + i, eventId, action, detail,
          at: new Date(Date.now() + i).toISOString() });
      state.audit = r.log;
      retention = MeritAuditTrail.recordEviction(retention, r);
    };
    for (let n = 0; n < events; n++) {
      const id = "ev_" + n;
      state.events.push({ id, name: "Event " + n, hotel: "", salon: "", date: "2099-01-0" + (n + 1),
        status: "Planning", tables: [], guests: [], venueObjects: [], freezes: [], handoverNotes: [],
        createdAt: new Date().toISOString(), lastModified: new Date().toISOString() });
      write(id, "EVENT_CREATED", { blank: true }, 0);
      for (let i = 0; i < each; i++) {
        write(id, "ARRIVAL_STATUS_CHANGED", { guestId: "g", from: "Not Arrived", to: "Checked In", seq: i }, i + 1);
      }
    }
    state.auditRetention = retention;
    return state.events.filter(e => e.id.startsWith("ev_")).map(e => ({
      id: e.id,
      entries: state.audit.filter(a => a.eventId === e.id).length,
      keptCreation: state.audit.some(a => a.eventId === e.id && a.action === "EVENT_CREATED"),
    }));
  }, { events: EVENTS, each: EACH });
  checks.equal(many.length, EVENTS, `${EVENTS} further events were logged`, many.length);
  checks.ok(many.every(m => m.entries === EACH + 1),
    `each event kept all ${EACH + 1} of its own decisions while the others were writing theirs — the shared log no longer lets a busy event overwrite a quiet one's history`,
    many);
  checks.ok(many.every(m => m.keptCreation),
    "and every one of them can still say when it was created", many);

  // --- 4. the ceiling, when it IS reached, is recorded ----------------------
  // Exercised against the module directly at a small explicit limit: the real
  // ceiling is deliberately out of reach, and a suite that cannot reach it
  // cannot prove what happens there.
  const evicted = await page.evaluate(() => {
    const T = MeritAuditTrail;
    let log = [];
    let retention = null;
    for (let i = 0; i < 12; i++) {
      const r = T.append(log, { id: "a" + i, eventId: "e", action: "ARRIVAL_STATUS_CHANGED",
        detail: { seq: i }, at: new Date(2026, 0, 1, 0, i).toISOString() }, 10);
      log = r.log;
      retention = T.recordEviction(retention, r);
    }
    return {
      kept: log.length,
      newestSeq: log[0].detail.seq,
      oldestSeq: log[log.length - 1].detail.seq,
      evicted: retention ? retention.evicted : 0,
      oldestDroppedAt: retention ? retention.oldestDroppedAt : null,
      conserved: log.length + (retention ? retention.evicted : 0),
    };
  });
  checks.equal(evicted.kept, 10, "at an explicit limit of 10, ten entries are kept", evicted.kept);
  checks.equal(evicted.newestSeq, 11, "the newest is kept", evicted.newestSeq);
  checks.equal(evicted.oldestSeq, 2, "and the two oldest are the ones that went", evicted.oldestSeq);
  checks.equal(evicted.evicted, 2,
    "the product knows EXACTLY how many entries it dropped — not that it 'may have' dropped some", evicted.evicted);
  checks.ok(evicted.oldestDroppedAt,
    "and how far back the log used to reach, so a person reading a short trail knows whether it is short because nothing happened or because something was removed",
    evicted.oldestDroppedAt);
  checks.equal(evicted.conserved, 12,
    "kept + evicted === written. Every entry is either in the log or counted in what left it; none is unaccounted for", evicted.conserved);

  // --- 5. a display window is a rendering decision, not a retention one -----
  await gotoTab(page, "reports");
  await settle(page);
  const rendered = await page.evaluate(() => {
    const rows = document.querySelectorAll(".audit-row").length;
    const total = state.audit.filter(a =>
      a.eventId === ui.activeEventId && MeritAuditTrail.DECISION_CODES.has(a.action)).length;
    const more = document.querySelector(".audit-more")?.textContent.trim() || null;
    return { rows, total, more, limit: MeritAuditTrail.DISPLAY_LIMIT };
  });
  checks.ok(rendered.total > rendered.limit,
    "this event really does have more decisions than one screen paints", rendered.total);
  checks.equal(rendered.rows, rendered.limit,
    "the trail renders exactly its display window — painting 1,500 rows is a rendering problem, and solving it by DELETING 500 of them is how this started",
    { rows: rendered.rows, limit: rendered.limit });
  checks.ok(rendered.more && new RegExp(String(rendered.total)).test(rendered.more),
    "and the screen states the real total, so the window is visibly a window rather than the whole truth",
    rendered.more);

  // --- 6. the full log survives a save/reload round trip --------------------
  const roundTrip = await page.evaluate(async () => {
    const before = state.audit.length;
    saveState();
    let root = null;
    for (let i = 0; i < 100; i++) {
      const raw = await MERIT_STORAGE_PROVIDER.load();
      root = typeof raw === "string" ? JSON.parse(raw) : raw;
      if ((root?.audit || []).length >= before) break;
      await new Promise(r => setTimeout(r, 50));
    }
    return { before, after: (root?.audit || []).length,
      retention: root?.auditRetention === undefined ? "MISSING" : "PRESENT" };
  });
  checks.equal(roundTrip.after, roundTrip.before,
    "every entry survives the trip to storage — a log that is durable in memory and truncated on disk is not durable",
    roundTrip);
  checks.equal(roundTrip.retention, "PRESENT",
    "and the retention record travels with it, so what was dropped is not forgotten by a reload", roundTrip.retention);

  // --- 7. an event package carries its whole log, and importing keeps it ----
  const pkg = await page.evaluate(() => {
    const e = state.events.find(x => x.name === "Busy Door");
    const mine = state.audit.filter(a => a.eventId === e.id);
    const payload = MeritEventPackage.buildPayload(JSON.parse(JSON.stringify(e)), { auditEntries: mine });
    const regen = MeritEventPackage.regenerateIds(payload.event, payload.auditEntries, (p) => p + "_new_" + Math.random().toString(36).slice(2));
    const merged = MeritAuditTrail.merge(state.audit, regen.auditEntries);
    return {
      exported: mine.length,
      regenerated: regen.auditEntries.length,
      mergedTotal: merged.log.length,
      expected: state.audit.length + mine.length,
      evicted: merged.evicted,
    };
  });
  checks.ok(pkg.exported > 1000,
    "the exported package carries more than a thousand entries, which the old cap could not even hold", pkg.exported);
  checks.equal(pkg.regenerated, pkg.exported, "id regeneration loses none of them", pkg);
  checks.equal(pkg.mergedTotal, pkg.expected,
    "and importing adds every one to the existing log. The old path ran slice(0,1000) over the concatenation, so importing a large event's history threw most of it away AND evicted the host install's own",
    pkg);
  checks.equal(pkg.evicted, 0, "with nothing evicted at this scale", pkg.evicted);

  // --- 8. replay reads the whole history, oldest first ----------------------
  const replay = await page.evaluate(() => {
    const e = state.events.find(x => x.name === "Busy Door");
    const trail = MeritAuditTrail.resolve(state.audit, e.id);
    const chron = MeritPostEventReplay.chronological(trail);
    return { trail: trail.length, chron: chron.length,
      firstIsOldest: chron.length > 1 && chron[0].at <= chron[chron.length - 1].at };
  });
  checks.equal(replay.chron, replay.trail,
    "post-event replay sees every retained decision, not a display window — the screen's limit must not reach the replay", replay);
  checks.ok(replay.firstIsOldest, "and still reads oldest first", replay);

}
