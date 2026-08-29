(() => {
  "use strict";
  // VENUE -> LAYOUT -> LAYOUT VERSION -> EVENT
  //
  // Until now a venue was two free-text strings on the event (`hotel`,
  // `salon`), so nothing could be reused or compared across events: the same
  // ballroom typed twice was two unrelated events, and there was nowhere to
  // hang verified plan knowledge that ought to outlive one party.
  //
  //   VENUE          stable real-world identity ("Merit Starlit")
  //   LAYOUT         a reusable arrangement family ("Main Ballroom — Concert")
  //   LAYOUT VERSION a reviewed, immutable structural snapshot ("v4")
  //   EVENT          references a version and holds its OWN copy of the
  //                  structure, so editing the event never rewrites history
  //
  // The immutability rule is the point of the whole hierarchy. Creating an
  // event from a version DEEP COPIES the structure. Editing the event mutates
  // only that copy. Pushing changes back is an explicit act that creates a NEW
  // version; it never overwrites an existing one.

  const uid = (p) => `${p}_${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))}`;
  const nowISO = () => new Date().toISOString();
  const deepCopy = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

  function ensureRegistry(state) {
    state.venues ||= [];
    return state;
  }

  function findVenue(state, venueId) { return (state.venues || []).find(v => v.id === venueId) || null; }
  function findLayout(venue, layoutId) { return (venue?.layouts || []).find(l => l.id === layoutId) || null; }
  function findVersion(layout, versionId) { return (layout?.versions || []).find(v => v.id === versionId) || null; }

  function createVenue(state, { name, address = "" }) {
    ensureRegistry(state);
    const venue = { id: uid("venue"), name: String(name || "").trim(), address, layouts: [], createdAt: nowISO() };
    state.venues.push(venue);
    return venue;
  }

  function createLayout(state, venueId, { name, description = "" }) {
    const venue = findVenue(state, venueId);
    if (!venue) throw new Error("createLayout: unknown venue");
    const layout = { id: uid("layout"), venueId, name: String(name || "").trim(), description, versions: [], createdAt: nowISO() };
    venue.layouts.push(layout);
    return layout;
  }

  // A version is a frozen structural snapshot. `structure` is deep-copied on
  // the way in, so a caller holding a reference to the live event cannot
  // retroactively mutate a published version.
  function createLayoutVersion(state, venueId, layoutId, { structure, label = "", note = "", sourcePlanHash = null }) {
    const venue = findVenue(state, venueId);
    const layout = findLayout(venue, layoutId);
    if (!layout) throw new Error("createLayoutVersion: unknown layout");
    const version = {
      id: uid("layoutver"),
      layoutId, venueId,
      versionNumber: layout.versions.length + 1,
      label: label || `v${layout.versions.length + 1}`,
      note,
      sourcePlanHash,
      createdAt: nowISO(),
      structure: deepCopy({
        tables: structure?.tables || [],
        venueObjects: structure?.venueObjects || [],
        background: structure?.background || null,
      }),
    };
    layout.versions.push(version);
    return version;
  }

  // Snapshot a version INTO an event. The event gets its own deep copy plus a
  // reference recording where it came from; the version itself is untouched.
  function snapshotVersionIntoEvent(state, event, versionId) {
    for (const venue of state.venues || [])
      for (const layout of venue.layouts || []) {
        const version = findVersion(layout, versionId);
        if (!version) continue;
        const copy = deepCopy(version.structure);
        event.tables = copy.tables;
        event.venueObjects = copy.venueObjects;
        if (copy.background) event.background = copy.background;
        event.venueRef = {
          venueId: venue.id, venueName: venue.name,
          layoutId: layout.id, layoutName: layout.name,
          layoutVersionId: version.id, layoutVersionLabel: version.label,
          snapshotAt: nowISO(),
        };
        return event;
      }
    throw new Error("snapshotVersionIntoEvent: unknown layout version");
  }

  // Promote an event's current structure back to the layout as a NEW version.
  // Explicit by design: there is no code path that writes into an existing
  // version, so historical layout knowledge cannot be silently rewritten.
  function promoteEventToNewVersion(state, event, { label = "", note = "" } = {}) {
    const ref = event.venueRef;
    if (!ref) throw new Error("promoteEventToNewVersion: event is not linked to a layout");
    const version = createLayoutVersion(state, ref.venueId, ref.layoutId, {
      structure: { tables: event.tables, venueObjects: event.venueObjects, background: event.background },
      label, note: note || `Promoted from event "${event.name}"`,
    });
    event.venueRef = { ...ref, layoutVersionId: version.id, layoutVersionLabel: version.label, snapshotAt: nowISO() };
    return version;
  }

  // ---- Layout change detector ---------------------------------------------
  // Compares a structure against a previous version and reports only what was
  // actually computed. Matching is by centre distance relative to typical
  // object size, the same rule the detection benchmark uses, so "moved" and
  // "added+removed" cannot be confused for one another.
  function compareToVersion(state, versionId, structure) {
    let found = null;
    for (const venue of state.venues || [])
      for (const layout of venue.layouts || []) {
        const v = findVersion(layout, versionId);
        if (v) found = { venue, layout, version: v };
      }
    if (!found) throw new Error("compareToVersion: unknown layout version");

    const prev = found.version.structure.tables || [];
    const next = structure?.tables || [];
    const centre = t => ({ x: t.x + (t.w || 0) / 2, y: t.y + (t.h || 0) / 2 });
    const spans = [...prev, ...next].map(t => Math.max(t.w || 0, t.h || 0)).filter(Boolean);
    const typical = spans.length ? spans.slice().sort((a, b) => a - b)[Math.floor(spans.length / 2)] : 100;
    const sameSpot = typical * 0.5;      // closer than half a table: the same table
    const movedFloor = typical * 0.15;   // beyond a small drafting nudge: really moved

    const usedP = new Set(), usedN = new Set(), unchanged = [], moved = [];
    const record = (pi, ni, d, how) => {
      usedP.add(pi); usedN.add(ni);
      const before = prev[pi], after = next[ni];
      const capacityChanged = (before.capacity || 0) !== (after.capacity || 0);
      const entry = { before: before.number ?? null, after: after.number ?? null, distance: +d.toFixed(1),
        capacityBefore: before.capacity ?? null, capacityAfter: after.capacity ?? null, matchedBy: how };
      if (d > movedFloor || capacityChanged) moved.push(entry); else unchanged.push(entry);
    };

    // Identity first. A floor plan numbers its tables, and that number is
    // stronger evidence of "same table" than any distance rule: a table
    // relocated across the room is still T07. Falling back to geometry alone
    // reported such a table as one removed plus one added, which is both wrong
    // and much less useful to an operator comparing two versions.
    const numKey = t => (t.number == null ? null : String(t.number).trim().toUpperCase());
    const nextByNumber = new Map();
    next.forEach((n, ni) => { const k = numKey(n); if (k && !nextByNumber.has(k)) nextByNumber.set(k, ni); });
    prev.forEach((p, pi) => {
      const k = numKey(p);
      if (!k || !nextByNumber.has(k)) return;
      const ni = nextByNumber.get(k);
      if (usedN.has(ni)) return;
      const a = centre(p), b = centre(next[ni]);
      record(pi, ni, Math.hypot(a.x - b.x, a.y - b.y), "table number");
    });

    // Geometry for anything left unnumbered or renumbered.
    const pairs = [];
    prev.forEach((p, pi) => { if (usedP.has(pi)) return; next.forEach((n, ni) => {
      if (usedN.has(ni)) return;
      const a = centre(p), b = centre(n);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d <= sameSpot) pairs.push({ pi, ni, d });
    }); });
    pairs.sort((a, b) => a.d - b.d);
    for (const p of pairs) {
      if (usedP.has(p.pi) || usedN.has(p.ni)) continue;
      record(p.pi, p.ni, p.d, "position");
    }
    const removed = prev.filter((_, i) => !usedP.has(i)).map(t => ({ number: t.number ?? null, capacity: t.capacity ?? null }));
    const added = next.filter((_, i) => !usedN.has(i)).map(t => ({ number: t.number ?? null, capacity: t.capacity ?? null }));
    const seats = list => list.reduce((n, t) => n + (t.capacity || 0), 0);

    const semanticOf = list => {
      const m = {};
      for (const o of list || []) m[o.type] = (m[o.type] || 0) + 1;
      return m;
    };
    const prevSem = semanticOf(found.version.structure.venueObjects);
    const nextSem = semanticOf(structure?.venueObjects);
    const semanticChanges = {};
    for (const k of new Set([...Object.keys(prevSem), ...Object.keys(nextSem)]))
      if ((prevSem[k] || 0) !== (nextSem[k] || 0)) semanticChanges[k] = { before: prevSem[k] || 0, after: nextSem[k] || 0 };

    return {
      comparedTo: { versionId: found.version.id, label: found.version.label, layout: found.layout.name, venue: found.venue.name },
      tables: { before: prev.length, after: next.length, unchanged: unchanged.length, moved: moved.length, added: added.length, removed: removed.length },
      capacity: { before: seats(prev), after: seats(next), delta: seats(next) - seats(prev) },
      movedDetail: moved, addedDetail: added, removedDetail: removed,
      semanticChanges,
      method: `table number where both sides carry one, then centre matching with a same-spot radius of ${sameSpot.toFixed(0)}px; a match counts as moved past ${movedFloor.toFixed(0)}px or on any capacity change. Both radii derive from the median object span (${typical.toFixed(0)}px)`,
    };
  }

  // ---- Venue / Layout memory ----------------------------------------------
  // Verified human corrections, stored against the layout family rather than
  // one event, so a later plan from the same family can use them as PRIOR
  // evidence. Explicitly not model training: it is recall of what a person
  // confirmed, and it never outranks a human answer on the current plan.
  function rememberVerifiedExample(state, venueRef, example) {
    const venue = findVenue(state, venueRef?.venueId);
    const layout = findLayout(venue, venueRef?.layoutId);
    if (!layout) return null;
    layout.memory ||= [];
    layout.memory.push({
      id: uid("vmem"),
      layoutVersionId: venueRef.layoutVersionId || null,
      verifiedClass: example.verifiedClass, originalPrediction: example.originalPrediction ?? null,
      descriptor: example.descriptor ?? null,
      geometry: example.geometry ?? null,
      planHash: example.planHash ?? null,
      providerVersion: example.providerVersion ?? null,
      at: nowISO(),
    });
    return layout.memory[layout.memory.length - 1];
  }
  function layoutMemory(state, venueRef) {
    const venue = findVenue(state, venueRef?.venueId);
    const layout = findLayout(venue, venueRef?.layoutId);
    return layout?.memory || [];
  }

  // ---- migration ----------------------------------------------------------
  // Existing events carry `hotel` and `salon` strings. Those are promoted into
  // real Venue/Layout records, matching case-insensitively on the trimmed name
  // so the same ballroom typed twice becomes one layout. Every event keeps its
  // original strings untouched; the reference is added alongside, so nothing
  // that reads event.hotel today changes behaviour.
  function migrateVenues(state) {
    ensureRegistry(state);
    let venuesCreated = 0, layoutsCreated = 0, linked = 0;
    const key = s => String(s || "").trim().toLocaleLowerCase("tr");
    for (const event of state.events || []) {
      if (event.venueRef) continue;
      const hotel = String(event.hotel || event.venue || "").trim();
      if (!hotel) continue;
      let venue = (state.venues || []).find(v => key(v.name) === key(hotel));
      if (!venue) { venue = createVenue(state, { name: hotel }); venuesCreated++; }
      const layoutName = String(event.salon || "").trim() || "Default layout";
      let layout = venue.layouts.find(l => key(l.name) === key(layoutName));
      if (!layout) { layout = createLayout(state, venue.id, { name: layoutName }); layoutsCreated++; }
      event.venueRef = {
        venueId: venue.id, venueName: venue.name,
        layoutId: layout.id, layoutName: layout.name,
        layoutVersionId: null, layoutVersionLabel: null,
        snapshotAt: null,
        migratedFromStrings: true,
      };
      linked++;
    }
    return { venuesCreated, layoutsCreated, linked };
  }

  globalThis.MeritVenueModel = {
    createVenue, createLayout, createLayoutVersion,
    snapshotVersionIntoEvent, promoteEventToNewVersion,
    compareToVersion,
    rememberVerifiedExample, layoutMemory,
    migrateVenues,
    findVenue, findLayout, findVersion,
  };
})();
