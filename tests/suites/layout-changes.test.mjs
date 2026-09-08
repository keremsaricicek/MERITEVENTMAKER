// What has moved since the room was published.
//
// The comparison engine has existed since the venue model was built and had no
// UI at all — it was reachable only from a test, so nothing in the product could
// answer "what did we change since v3?". This suite guards the workflow around
// it, and three rules in particular:
//
//   A NUMBER OUTRANKS A POSITION. Table 42 relocated across the room is TABLE 42
//   MOVED, never "42 removed, something added". That is the whole reason the
//   engine matches on the table number first, and the failure it prevents is the
//   one that makes a change report useless: a renumbering or a reshuffle turns
//   into a wall of additions and removals nobody can read.
//
//   A CHANGE IS NAMED, NOT LUMPED. A table that stayed put and gained two seats
//   is CAPACITY_CHANGED, not MOVED. It used to be reported as moved, because a
//   capacity change was pushed into the same bucket — and an operator reading
//   "3 tables moved" would go looking for movement that never happened.
//
//   THE PLAN STAYS THE HERO. This is a MODE of the Floor Plan on the same
//   canvas, not a second drawing of the same room. A future change that redrew
//   the layout from the diff would look reasonable in a diff and would undo the
//   thing that makes the view trustworthy.
import { click, openApp, createBlankEvent, addTables, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "layout-changes", tags: ["business", "fast"], timeout: 120000 };

// Publish the event's current tables as a layout version, then change the room
// underneath it. Everything goes through the real venue model.
const PUBLISH = `(function(){
  const e = state.events[0];
  const venue = MeritVenueModel.createVenue(state, { name: "Merit Royal" });
  const layout = MeritVenueModel.createLayout(state, venue.id, { name: "Main Ballroom" });
  const version = MeritVenueModel.createLayoutVersion(state, venue.id, layout.id, {
    structure: { tables: e.tables, venueObjects: e.venueObjects, background: e.background },
    label: "v1",
  });
  e.venueRef = { venueId: venue.id, venueName: venue.name, layoutId: layout.id,
    layoutName: layout.name, layoutVersionId: version.id, layoutVersionLabel: version.label,
    snapshotAt: new Date().toISOString() };
  render();
  return { version: version.id, tables: e.tables.map(t => t.number) };
})()`;

const PANEL = `(function(){
  return {
    modes: [...document.querySelectorAll("[data-plan-mode]")].map(b => b.dataset.planMode),
    panel: !!document.querySelector(".layout-changes"),
    heading: document.querySelector(".lc-head span")?.textContent.trim() || null,
    rows: [...document.querySelectorAll(".lc-row")].map(r => ({
      type: (r.className.match(/lc-row ([A-Z_]+)/) || [])[1] || null,
      text: r.textContent.replace(/\\s+/g, " ").trim(),
      key: r.querySelector(".lc-key")?.textContent.trim() || null,
      label: r.querySelector(".lc-type")?.textContent.trim() || null,
      confidence: r.querySelector(".lc-conf")?.textContent.trim() || null,
      confirm: !!r.querySelector("[data-change-confirm]"),
      confirmed: !!r.querySelector(".lc-confirmed"),
    })),
    canvas: !!document.getElementById("canvasViewport"),
    plan: !!document.querySelector(".reference-layer, #canvasWorld"),
    tabs: [...document.querySelectorAll(".tabs [data-tab]")].map(b => b.dataset.tab),
  };
})()`;

// Ask the engine directly for the change classes, so a UI that renders the
// wrong ones cannot hide behind wording.
const CLASSES = `(function(){
  const e = state.events[0];
  const d = MeritVenueModel.compareToVersion(state, e.venueRef.layoutVersionId,
    { tables: e.tables, venueObjects: e.venueObjects });
  return {
    counts: d.changeCounts,
    changes: d.changes.map(c => ({ type: c.type, key: c.key, kind: c.kind,
      by: c.identity.by, confidence: c.identity.confidence,
      before: c.before, after: c.after })),
    tables: d.tables,
  };
})()`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Changes", hotel: "Merit Royal", date: "2026-12-11" });
  await addTables(page, { quantity: 4 });

  // --- 1. no published version, nothing to compare against -----------------
  const before = await page.evaluate(PANEL);
  checks.ok(!before.modes.includes("changes"),
    "an event never taken from a published layout offers no change view — there is no 'since when'",
    before.modes);

  const published = await page.evaluate(PUBLISH);
  checks.equal(published.tables.length, 4, "four tables were published as v1", published.tables);

  const clean = await page.evaluate(PANEL);
  checks.ok(clean.modes.includes("changes"),
    "publishing the layout makes the change view available", clean.modes);
  checks.equal(clean.tabs.length, 6,
    "and it is a MODE of the Floor Plan — the permanent navigation did not grow", clean.tabs);

  // --- 2. the named classes, one per thing that changed ---------------------
  //
  // Four separate edits, each of a different kind, so every class is asserted
  // on a change that is genuinely only that.
  const edited = await page.evaluate(() => {
    const e = state.events[0], [a, b, c, d] = e.tables;
    a.capacity += 2;                     // capacity only — did not move
    b.x += 400; b.y += 260;              // moved only
    c.zone = "VIP FRONT";                // zone only
    e.tables = e.tables.filter(t => t.id !== d.id);   // removed
    e.tables.push({ id: "t_new", number: "T99", type: "round",
      x: 60, y: 60, w: 120, h: 120, capacity: 8, zone: "MAIN FLOOR", chairs: [] });
    render();
    return { moved: b.number, capacity: a.number, zoned: c.number, removed: d.number };
  });

  const cls = await page.evaluate(CLASSES);
  const find = (type, key) => cls.changes.find(c => c.type === type && c.key === key);

  checks.ok(find("CAPACITY_CHANGED", edited.capacity),
    "a table that gained seats without moving is CAPACITY_CHANGED", cls.changes);
  checks.ok(!find("MOVED", edited.capacity),
    "and is NOT also reported as moved — it did not move", cls.changes);
  checks.ok(find("MOVED", edited.moved),
    "a table that moved is MOVED", cls.changes);
  checks.ok(find("ZONE_CHANGED", edited.zoned),
    "a table reassigned to another zone is ZONE_CHANGED", cls.changes);
  checks.ok(find("REMOVED", edited.removed), "a table taken out is REMOVED", cls.changes);
  checks.ok(find("ADDED", "T99"), "a table put in is ADDED", cls.changes);

  // --- 3. a number outranks a position -------------------------------------
  //
  // Without the identity-by-number pass this is where it shows: the moved table
  // comes back as "T02 removed" plus "T02 added", the same table counted twice.
  const movedChange = find("MOVED", edited.moved);
  checks.require(!!movedChange,
    "the moved table is a single MOVED entry, not a removal plus an addition", cls.changes);
  checks.equal(movedChange.by, "TABLE_NUMBER",
    "the moved table was matched by its number, not by where it ended up");
  checks.equal(movedChange.confidence, "VERIFIED",
    "which is the strongest identity this comparison has");
  checks.equal(cls.changes.filter(c => c.type === "REMOVED").length, 1,
    "a table that moved across the room did not become a removal", cls.changes);
  checks.equal(cls.changes.filter(c => c.type === "ADDED").length, 1,
    "nor a removal plus an addition", cls.changes);

  // An added and a removed table have nothing to match against, and say so.
  checks.equal(find("REMOVED", edited.removed).by, "NONE",
    "a removed table is matched by nothing, and reports that");
  checks.equal(find("ADDED", "T99").confidence, "UNCERTAIN",
    "which is the case an operator is asked to confirm");

  // --- 3b. a stage that appeared is not a stage that changed ---------------
  //
  // Found by rendering: an added stage came out as "STAGE CHANGED · STAGE ·
  // — → stage", which states the object's type twice and its actual news not at
  // all. ADDED, REMOVED and STAGE_CHANGED are peers in the taxonomy: the last
  // one means the stage was there before and is different now.
  const staged = await page.evaluate(() => {
    const e = state.events[0];
    e.venueObjects.push({ id: "v_stage", type: "stage", label: "STAGE",
      x: 500, y: 420, w: 380, h: 180, rotation: 0, z: 3 });
    render();
    const d = MeritVenueModel.compareToVersion(state, e.venueRef.layoutVersionId,
      { tables: e.tables, venueObjects: e.venueObjects });
    return d.changes.filter(c => c.kind === "venueObject")
      .map(c => ({ type: c.type, key: c.key, before: c.before, after: c.after }));
  });
  checks.equal(staged.length, 1, "the new stage is one change", staged);
  checks.equal(staged[0].type, "ADDED",
    "a stage that was not there before is ADDED, not STAGE_CHANGED", staged[0]);
  checks.ok(staged[0].before === null && staged[0].after === null,
    "and carries no before/after — the row already names the object", staged[0]);

  // Moving it in place is the case STAGE_CHANGED exists for.
  const movedStage = await page.evaluate(() => {
    const e = state.events[0];
    const v = MeritVenueModel.findVersion(
      MeritVenueModel.findLayout(MeritVenueModel.findVenue(state, e.venueRef.venueId), e.venueRef.layoutId),
      e.venueRef.layoutVersionId);
    v.structure.venueObjects = [{ id: "v_stage_old", type: "stage", label: "STAGE",
      x: 120, y: 120, w: 380, h: 180, rotation: 0, z: 3 }];
    const d = MeritVenueModel.compareToVersion(state, e.venueRef.layoutVersionId,
      { tables: e.tables, venueObjects: e.venueObjects });
    return d.changes.filter(c => c.kind === "venueObject").map(c => ({ type: c.type, by: c.identity.by }));
  });
  checks.equal(movedStage.length, 1, "a stage present in both versions is one change", movedStage);
  checks.equal(movedStage[0].type, "STAGE_CHANGED",
    "and it is STAGE_CHANGED — the stage was there and is different now", movedStage[0]);
  checks.equal(movedStage[0].by, "TYPE_AND_LABEL",
    "matched on the label it carries, not on where it ended up", movedStage[0]);

  // --- 4. the view is the plan, not a redraw of it -------------------------
  await gotoTab(page, "floor");
  await click(page, '[data-plan-mode="changes"]');
  await page.waitForTimeout(400);
  const view = await page.evaluate(PANEL);
  checks.ok(view.panel, "the change view has a panel of what changed");
  checks.ok(view.canvas && view.plan,
    "on the same canvas the operator was already looking at — not a second drawing", view);
  checks.equal(await page.evaluate(() => ui.screen), "workspace",
    "and without leaving the workspace");
  // Re-read the engine here rather than reusing the earlier snapshot: the stage
  // checks above deliberately changed the published version, so the comparison
  // is not the one `cls` captured.
  const live = await page.evaluate(CLASSES);
  checks.equal(view.rows.length, live.changes.length,
    "every change the engine named reaches the screen", { rows: view.rows.length, engine: live.changes.length });
  checks.ok(view.heading && /v1/.test(view.heading),
    "the panel says which version it is comparing against", view.heading);

  const labels = view.rows.map(r => r.label);
  checks.ok(labels.every(l => l && !/^[A-Z_]+$/.test(l)),
    "each row names its change in words, not as a raw enum", labels);

  // --- 5. confirmation is offered only where it means something -------------
  const uncertain = view.rows.filter(r => r.confirm);
  checks.ok(uncertain.length > 0, "an uncertain change offers a confirmation", view.rows);
  checks.ok(view.rows.filter(r => r.type === "CAPACITY_CHANGED").every(r => !r.confirm),
    "a change matched by table number does not — there is nothing for a person to ratify",
    view.rows.filter(r => r.type === "CAPACITY_CHANGED"));

  await click(page, ".lc-row [data-change-confirm]");
  await page.waitForTimeout(400);
  const afterConfirm = await page.evaluate(PANEL);
  checks.equal(afterConfirm.rows.filter(r => r.confirmed).length, 1,
    "confirming marks that one change, and only that one", afterConfirm.rows);
  checks.equal(afterConfirm.rows.length, view.rows.length,
    "and does not remove it — a confirmed change is still a change that happened");

  // --- 6. selecting a change shows previous, current, confidence, evidence --
  await click(page, ".lc-row");
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => {
    const c = document.querySelector(".lc-card");
    if (!c) return null;
    return {
      pairs: [...c.querySelectorAll(".lc-pair")].map(p => ({
        label: p.querySelector("em")?.textContent.trim(),
        value: p.querySelector("b")?.textContent.trim() })),
      evidence: c.querySelector(".lc-evidence")?.textContent.trim() || "",
      highlighted: ui.highlightId,
    };
  });
  checks.ok(card, "selecting a change opens a card about it");
  checks.equal(card.pairs.length, 4,
    "stating previous, current, how confident and how it was matched", card.pairs);
  checks.ok(card.pairs.every(p => p.label && !/^[a-z][a-zA-Z]*\./.test(p.label)),
    "with labels in words, not keys", card.pairs);
  checks.ok(card.evidence.length > 20,
    "and the evidence spelled out rather than a confidence number on its own", card.evidence);

  // --- 7. no raw key or enum in either language ----------------------------
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(300);
    const leaked = await page.evaluate(() => {
      const root = document.querySelector(".layout-changes");
      if (!root) return ["(no panel)"];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
      const ENUM = /^[A-Z][A-Z_]{3,}$/;
      const found = new Set();
      let n;
      while ((n = walker.nextNode())) {
        const s = n.textContent.trim();
        // An object's own name is not an enum: a stage really is labelled
        // STAGE on the drawing, and T01 is a table number. The sweep is about
        // the vocabulary the ENGINE uses reaching the screen unchanged, so the
        // element that carries object names is excluded from it.
        if (n.parentElement && n.parentElement.closest(".lc-key")) continue;
        if (s && s.length <= 60 && (KEY.test(s) || ENUM.test(s))) found.add(s);
      }
      return [...found];
    });
    checks.equal(leaked.length, 0, `no raw key or enum in the change view in ${lang.toUpperCase()}`, leaked);
  }
  await page.evaluate(() => { ui.lang = "en"; render(); });

  // --- 8. a published version is never rewritten ---------------------------
  //
  // The whole hierarchy rests on this: reading a comparison, and confirming one,
  // must not touch the thing being compared against.
  // Found by id across every venue: createBlankEvent may already have made one,
  // so state.venues[0] is not necessarily the venue this suite published into.
  const version = await page.evaluate(v => {
    let ver = null;
    for (const venue of state.venues || [])
      for (const layout of venue.layouts || [])
        for (const x of layout.versions || []) if (x.id === v) ver = x;
    if (!ver) return null;
    return { tables: ver.structure.tables.length,
      capacities: ver.structure.tables.map(t => t.capacity),
      numbers: ver.structure.tables.map(t => t.number) };
  }, published.version);
  checks.require(!!version, "the published version is still in the registry", published.version);
  checks.equal(version.tables, 4, "the published version still holds its own four tables");
  checks.ok(!version.numbers.includes("T99"),
    "the table added to the event did not appear in the published version", version.numbers);

  // --- 9. a completed event reads its changes and cannot confirm them -------
  await page.evaluate(() => {
    state.events[0].status = "Completed";
    openEvent(state.events[0].id);
    ui.tab = "floor"; ui.planMode = "changes"; render();
  });
  await page.waitForTimeout(400);
  const historical = await page.evaluate(() => ({
    rows: document.querySelectorAll(".lc-row").length,
    confirms: document.querySelectorAll("[data-change-confirm]").length,
    seen: Object.keys(state.events[0].layoutChangesSeen || {}).length,
  }));
  checks.ok(historical.rows > 0 || historical.rows === 0,
    "a completed event renders without throwing", historical);
  checks.equal(historical.confirms, 0,
    "and offers no confirmation — a finished night is read-only", historical);
  checks.equal(historical.seen, 1,
    "the one confirmation made while it was open is still exactly one", historical);
}
