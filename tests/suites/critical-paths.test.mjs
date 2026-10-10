// THE OPERATOR PATHS NO SUITE EVER EXECUTED.
//
// §28 of the master programme: not a coverage percentage, but the question
// behind one. `MERIT_COVERAGE=1 npm run test:all` merged V8 block coverage over
// all 97 suites and `benchmarks/coverage/analyse.mjs` cross-checked it against
// the static reachability model. Among 152 reachable functions no suite ever
// ran, these are real operator paths — each one is a place a regression would
// have shipped in silence:
//
//   - importing a floor plan from a FILE (PNG, and a PDF with its page choice):
//     every suite set `event.background` directly
//   - the localStorage fallback when IndexedDB is unavailable, which is the
//     whole of persistence on a browser that refuses IndexedDB
//   - the audit trail at its 100,000-entry cap: the eviction branch, the
//     retention record and its reload normalization had never run
//   - the assignment LOCK, which is what makes "a locked assignment outranks
//     every suggestion" true
//   - the guest Excel template an operator is told to fill in
//   - the schema step that drops placeholder chairs from a physical table
//   - an event package whose chairs are malformed
//
// Recorded in benchmarks/coverage/README.md with what stayed untested and why.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "critical-paths", tags: ["business", "storage", "fast"], timeout: 240000, downloads: true };

// A real two-page PDF, written byte by byte so the fixture is its own source:
// page 1 a filled rectangle, page 2 two circles' worth of strokes. PDF.js is
// served from the pinned cache, so this exercises the product's actual reader.
function twoPagePdf() {
  const pages = ["0 0 1 rg 60 60 300 180 re f", "1 0 0 RG 4 w 80 80 m 380 80 l 380 260 l 80 260 l h S 0 0 0 rg 200 150 40 40 re f"];
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>`];
  pages.forEach((content, i) => {
    const contentId = 4 + i * 2;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 440 320] /Contents ${contentId} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export default async function run({ page, checks, baseUrl, repoRoot, browser }) {
  // --- 0. boot draws the real screen, never the retired shell ---------------
  // app-guests.js used to end with render(), which drew the pre-v8 shell — in
  // English — for ~50-90 ms on every start before app-v8.js replaced it.
  const bootCtx = await browser.newContext();
  const boot = await bootCtx.newPage();
  await boot.addInitScript(() => { window.__frames = [];
    new MutationObserver(() => { const el = document.getElementById("app"); if (el && el.innerText) window.__frames.push(el.innerText.slice(0, 200)); })
      .observe(document, { childList: true, subtree: true }); });
  await boot.goto(baseUrl + "/index.html");
  await boot.waitForFunction(() => /Etkinlik/.test(document.getElementById("app")?.innerText || ""), null, { timeout: 15000 });
  const frames = await boot.evaluate(() => window.__frames);
  checks.equal(frames.filter((f) => /All Events|Create Event|Event Operations/.test(f)).length, 0,
    `no boot frame shows the retired English shell (${frames.length} frames observed)`);
  await bootCtx.close();

  // --- 1. a floor plan imported from a FILE ---------------------------------
  await openApp(page, baseUrl, { lang: "tr" });
  await page.click('.appbar [data-action="create-event"]');
  await settle(page);
  const png = fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png"));
  await page.setInputFiles("#v8PlanFile", { name: "salon.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => /salon\.png/.test(document.getElementById("v8PlanDrop")?.textContent || ""), null, { timeout: 15000 });
  checks.ok(await page.evaluate(() => !!document.querySelector("#v8PlanDrop img")?.src.startsWith("data:image")), "a PNG chosen through the file input becomes the draft plan, shown by name");
  await page.fill('input[name="name"]', "Dosya"); await page.fill('input[name="hotel"]', "Merit"); await page.fill('input[name="date"]', futureDate());
  await page.click('[data-setup="create"]');
  await settle(page);
  const bg = await page.evaluate(() => { const e = activeEvent(); return { src: (e.background?.src || "").slice(0, 22), tables: e.tables.length }; });
  checks.ok(bg.src.startsWith("data:image") && bg.tables === 0, "creating the event carries the plan as its background — and seeds no tables", bg);

  await page.evaluate(() => { ui.screen = "events"; render(); });
  await page.click('.appbar [data-action="create-event"]');
  await settle(page);
  await page.setInputFiles("#v8PlanFile", { name: "salon.pdf", mimeType: "application/pdf", buffer: twoPagePdf() });
  await page.waitForSelector('[data-pdf-page="1"]', { timeout: 20000 });
  checks.equal(await page.locator("[data-pdf-page]").count(), 2, "a two-page PDF offers both pages to choose from");
  // Two renders in one frame schedule two thumbnail passes over the SAME
  // canvases — the race that threw "Cannot use the same canvas during
  // multiple render() operations" the first time a suite picked a PDF page.
  await page.evaluate(() => { render(); render(); render(); });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-pdf-thumb]")].every((c) => c.dataset.thumbState && c.dataset.thumbState !== "rendering"), null, { timeout: 15000 });
  checks.equal(await page.evaluate(() => [...document.querySelectorAll("[data-pdf-thumb]")].map((c) => c.dataset.thumbState)), ["done", "done"],
    "three renders in one frame still draw each page thumbnail exactly once — no pass collides with another on the same canvas");
  await page.click('[data-pdf-page="1"]');
  await page.waitForFunction(() => /page 2/.test(document.getElementById("v8PlanDrop")?.textContent || ""), null, { timeout: 20000 });
  checks.ok(await page.evaluate(() => (document.querySelector("#v8PlanDrop img")?.src || "").startsWith("data:image/png")),
    "choosing page 2 renders THAT page as the plan, named for it");
  await page.click('[data-setup="cancel"]');
  await settle(page);
  await page.evaluate(() => { ui.screen = "events"; render(); });

  // --- 2. the audit trail at its cap ----------------------------------------
  await createBlankEvent(page, { name: "Denetim", hotel: "Merit", date: futureDate() });
  const cap = await page.evaluate(() => MeritAuditTrail.RETENTION_LIMIT ?? 100000);
  await page.evaluate((cap) => {
    const e = activeEvent(), oldest = Date.now() - cap * 1000;
    state.audit = Array.from({ length: cap }, (_, i) => ({ id: "a" + i, eventId: e.id, action: "SEED", detail: {}, at: new Date(oldest + (cap - i) * 1000).toISOString() }));
    state.auditRetention = null;
    e.guests.push({ id: "gA", name: "Arda Kılıç", additionalGuests: 0, pax: 1, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived",
      checkedInAt: null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    touchEvent(e); ui.tab = "live"; render();
  }, cap);
  await settle(page);
  const lastBefore = await page.evaluate(() => state.audit[state.audit.length - 1].id);
  await page.click('[data-arrival="Checked In"][data-live-guest="gA"]');
  await settle(page);
  const trail = await page.evaluate(() => ({ n: state.audit.length, first: state.audit[0].action, last: state.audit[state.audit.length - 1].id, r: state.auditRetention }));
  checks.equal(trail.n, cap, `a check-in at the ${cap.toLocaleString("en")}-entry cap keeps the log at the cap`);
  checks.ok(trail.first !== "SEED" && trail.last !== lastBefore, "the new entry is first and the oldest one is the one dropped", trail);
  checks.ok(trail.r && trail.r.evicted === 1 && !!trail.r.oldestDroppedAt, "and the drop is RECORDED — how many, and where the log now begins — never silent", trail.r);
  await page.evaluate(() => saveState());
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => { try { return state.events.length >= 1 && Array.isArray(state.audit); } catch { return false; } }, null, { timeout: 30000 });
  const kept = await page.evaluate(() => ({ n: state.audit.length, r: state.auditRetention }));
  checks.ok(kept.n === cap && kept.r && kept.r.evicted === 1 && typeof kept.r.oldestDroppedAt === "string", "the cap and the eviction record survive a reload", { n: kept.n, r: kept.r });
  await page.evaluate(() => { state.audit = []; state.auditRetention = null; saveState(); });
  await page.waitForTimeout(400);

  // --- 3. the assignment lock -----------------------------------------------
  await page.evaluate(() => { const e = state.events.find((x) => x.name === "Denetim"); ui.activeEventId = e.id; ui.screen = "workspace"; ui.tab = "floor"; render(); });
  await addTables(page, { quantity: 2 });
  await page.evaluate(() => {
    const e = activeEvent();
    e.guests.push({ id: "gL", name: "Lale Uçar", additionalGuests: 1, pax: 2, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived",
      checkedInAt: null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    touchEvent(e); assignGuestToTable("gL", e.tables[0].id); ui.tab = "seating"; ui.selectedTableId = e.tables[0].id; render();
  });
  await settle(page);
  await page.click('[data-lock-assignment="gL"]');
  await settle(page);
  const lock = () => page.evaluate(() => { const g = activeEvent().guests.find((x) => x.id === "gL"); return { locked: !!g.assignment?.locked, table: g.assignment?.tableId }; });
  const locked = await lock();
  checks.ok(locked.locked, "the Lock control locks the party's assignment", locked);
  await page.evaluate(() => { const e = activeEvent(); assignGuestToTable("gL", e.tables[1].id); });
  await settle(page);
  checks.equal((await lock()).table, locked.table, "a locked party is not moved by an assignment to another table");
  await page.click('[data-lock-assignment="gL"]');
  await settle(page);
  checks.equal((await lock()).locked, false, "and the same control unlocks it");

  // --- 4. the guest Excel template ------------------------------------------
  await gotoTab(page, "guests");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click('[data-guest-command="template"]')]);
  const bytes = fs.readFileSync(await download.path());
  const header = await page.evaluate((b64) => { const wb = XLSX.read(b64, { type: "base64" }); const ws = wb.Sheets[wb.SheetNames[0]]; return XLSX.utils.sheet_to_json(ws, { header: 1 })[0]; }, bytes.toString("base64"));
  checks.equal(header, ["NAME SURNAME", "ADDITIONAL GUESTS", "STATUS", "VIP", "INVITED BY", "NOTES"], "the template an operator is told to fill in is a real workbook with the importer's columns");

  // --- 5. the schema step's placeholder-chair branch ------------------------
  const migrated = await page.evaluate(() => {
    const root = { version: 8, events: [{ id: "e1", tables: [{ id: "t1", hasPhysicalSeats: true, capacity: 4,
      chairs: [{ id: "c1", physical: true, x: 1, y: 1 }, { id: "c2", physical: false, x: 2, y: 2 }, { id: "c3", x: 3, y: 3 }] }] }] };
    const out = MeritSchemaMigrations.migrate(root);
    const t = out.root.events[0].tables[0];
    return { chairs: t.chairs.map((c) => c.id), flags: t.chairs.filter((c) => "physical" in c).length, capacity: t.capacity };
  });
  checks.equal(migrated, { chairs: ["c1", "c3"], flags: 0, capacity: 4 },
    "8 → 9 on a PHYSICAL table: the placeholder chair (physical:false) is dropped, real chairs are kept, the retired flag goes, capacity is untouched");

  // --- 6. an event package with malformed chairs is refused, precisely ------
  const problems = await page.evaluate(() => {
    const base = () => ({ id: "e1", name: "P", date: new Date(Date.now() + 90 * 864e5).toLocaleDateString("en-CA"), tables: [{ id: "t1", number: "T01", chairs: [] }], guests: [], venueObjects: [] });
    const cases = { notList: (e) => { e.tables[0].chairs = "x"; }, notRecord: (e) => { e.tables[0].chairs = [42]; }, badId: (e) => { e.tables[0].chairs = [{ id: "bad id with spaces" }]; } };
    const out = {};
    for (const [k, f] of Object.entries(cases)) { const e = base(); f(e); out[k] = MeritEventPackage.eventProblem(e); }
    out.clean = MeritEventPackage.eventProblem(base());
    return out;
  });
  checks.equal([problems.notList?.rule, problems.notRecord?.rule, problems.badId?.rule, problems.clean], ["notList", "notRecord", "badId", null],
    "a package whose chairs are not a list, not records, or carry a bad id is refused with the rule and path that failed", problems);

  // --- 7. persistence when IndexedDB is unavailable --------------------------
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true }); } catch { /* keep going: the check below reports the provider */ } });
  const p2 = await ctx.newPage();
  const errs = [];
  p2.on("pageerror", (e) => errs.push(e.message));
  await openApp(p2, baseUrl, { lang: "tr" });
  const provider = await p2.evaluate(() => globalThis.MERIT_STORAGE_STATUS?.provider);
  checks.equal(provider, "LocalStorageStorageProvider", "with no IndexedDB the app chooses the localStorage provider instead of failing");
  await createBlankEvent(p2, { name: "Yedek Depo", hotel: "Merit", date: futureDate() });
  await p2.evaluate(() => saveState());
  await p2.waitForTimeout(500);
  await p2.reload();
  await p2.waitForFunction(() => { try { return Array.isArray(state.events); } catch { return false; } }, null, { timeout: 15000 });
  checks.equal(await p2.evaluate(() => state.events.map((e) => e.name)), ["Yedek Depo"], "an event saved through the fallback is there after a reload");
  checks.equal(errs, [], "and nothing threw on the way");
  await ctx.close();

  // IndexedDB FORBIDDEN by policy (SecurityError) falls back too: this product
  // could never have written there. One that EXISTS but will not open
  // (InvalidStateError), is blocked, or is full does NOT — it may hold the
  // evening's data, and moving to a second store would show an empty app and
  // hide this session's writes on the next boot. What the operator sees then
  // is resilience-storage's section 4.
  const decisions = await page.evaluate(async () => {
    const make = (error) => {
      const fallbacks = [];
      const p = new MeritStorageProviders.ResilientStorageProvider("merit.probe", (x) => fallbacks.push(x.name));
      p.idb = p.active = { save: async () => { throw error; } };
      return { p, fallbacks };
    };
    const refused = make(new DOMException("refused", "SecurityError"));
    await refused.p.save(JSON.stringify({ ok: 1 }), "probe");
    const unopened = make(new DOMException("The database could not be opened.", "InvalidStateError"));
    let unopenedThrew = false; try { await unopened.p.save("{}", "probe"); } catch { unopenedThrew = true; }
    const blocked = make(new Error("IndexedDB open blocked (another tab holds an older version)."));
    let threw = false; try { await blocked.p.save("{}", "probe"); } catch { threw = true; }
    const full = make(new DOMException("disk full", "QuotaExceededError"));
    let fullThrew = false; try { await full.p.save("{}", "probe"); } catch { fullThrew = true; }
    localStorage.removeItem("merit.probe:probe");
    return { refused: [refused.p.name, refused.fallbacks.length, !!refused.p.fallbackReason], blocked: [blocked.p.name === "LocalStorageStorageProvider", threw],
      full: [full.p.name === "LocalStorageStorageProvider", fullThrew], unopened: [unopened.p.name === "LocalStorageStorageProvider", unopenedThrew, unopened.fallbacks.length] };
  });
  checks.equal(decisions.refused, ["LocalStorageStorageProvider", 1, true], "an IndexedDB forbidden by policy (SecurityError) falls back, once, and records why", decisions);
  checks.equal(decisions.unopened, [false, true, 0], "an IndexedDB that exists but will not open does NOT move the data: it may hold the evening, and the load path announces it instead", decisions);
  checks.equal(decisions.blocked, [false, true], "a BLOCKED IndexedDB does not move the data — the failure goes to the caller's save-failure notice", decisions);
  checks.equal(decisions.full, [false, true], "nor does a full one", decisions);
}
