// Semantic zones: the regions an operator reads a room as, each only as certain as the objects it stands on.
//
// Part of Plan Intelligence, split out of src/plan-intelligence.js on 2026-10-04
// (technical gaps, item 2) and moved verbatim: the only edits are references to
// a name another part owns, which now go through that part's object. Nothing
// here is a trained model; every number is computed from real geometry or OCR.
(() => {
  "use strict";
  const GEOM = globalThis.MeritPlanIntelGeometry;

  // ---- semantic zones ------------------------------------------------------
  //
  // A plan is not a bag of objects. An operator reads a room as regions with a
  // job — this end is dining, that corner is bistro, the band is the stage —
  // and every number the product reports is easier to trust when it is attached
  // to a part of the room rather than to a total.
  //
  // Three rules this follows, and they are the whole design:
  //
  //   EVIDENCE OR NOTHING. Every zone carries the facts that typed it, in
  //   words. A region that satisfies no rule becomes an `unknown` zone and is
  //   still reported — a plan with a region nobody can name is exactly the
  //   thing an operator needs told, and silently dropping it would be the
  //   dishonest option.
  //
  //   PLAN-RELATIVE, NEVER ABSOLUTE. Clusters link at a fraction of THIS plan's
  //   own modal table size, so a zone is not a distance in pixels and survives
  //   an export at another scale.
  //
  //   NOTHING IS INFERRED FROM A NAME. An entrance zone exists only where OCR
  //   actually read entrance wording or a human confirmed an entrance object.
  //   Where OCR is unavailable there is no entrance zone, rather than a guessed
  //   one.
  const ZONE_LINK_OF_TABLE = 1.5;   // floor for the cluster link distance, in modal table sides
  // ...and a floor is all it is, because table size is the wrong yardstick for
  // "are these in the same area".
  //
  // Measured on the Golden Plan, which is one dining floor: its tables are
  // ~4.4% of the plan across, so the old link distance was 6.6%; its columns
  // are pitched 11-12.5% apart, leaving a 7.7% gap. Vertical neighbours touch
  // and link, horizontal ones do not, so the room was read as SIX dining zones
  // standing in columns. On the plain-dining adversarial fixture it was five.
  // A room split into stripes is not a wrong number, it is a wrong description
  // of the drawing.
  //
  // What actually says "same area" is the plan's OWN spacing. Furniture set out
  // at the spacing this drawing uses everywhere is one area; a gap several
  // times that is a real separation — an aisle, a wall, another room. So the
  // link distance is taken from the distribution of each table's nearest
  // neighbours, at the 75th percentile so a few touching pairs cannot drag it
  // to zero and one outlier cannot inflate it.
  const ZONE_NEIGHBOURS = 4;        // per table, pooled across the plan
  const ZONE_LINK_OF_SPACING = 1.3;
  function planSpacing(tables) {
    if (tables.length < 3) return 0;
    const pool = [];
    for (const a of tables) {
      const gaps = [];
      for (const b of tables) if (a !== b) gaps.push(GEOM.gapBetween(a, b));
      gaps.sort((x, y) => x - y);
      for (const g of gaps.slice(0, ZONE_NEIGHBOURS)) pool.push(g);
    }
    if (!pool.length) return 0;
    pool.sort((a, b) => a - b);
    return pool[Math.min(pool.length - 1, Math.floor(pool.length * 0.75))];
  }
  const ENTRANCE_WORDS = /\b(giri[sş]|entrance|entry|exit|[cç][iı]k[iı][sş])\b/i;

  function buildZones(candidates, furnitureGroups, ocrText) {
    const alive = candidates.filter(c => c.status !== "rejected");
    const tables = alive.filter(c => c.kind === "table");
    const venues = alive.filter(c => c.kind === "venue");
    const zones = [];
    const bboxOf = list => {
      const xs = list.flatMap(c => [c.x, c.x + c.w]), ys = list.flatMap(c => [c.y, c.y + c.h]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const seatsOf = list => list.reduce((n, c) => n + (c.chairDetections || []).length, 0);
    const add = (type, members, confidence, evidence, extra = {}) => {
      if (!members.length) return;
      zones.push({ id: uid("zone"), type, confidence, evidence,
        memberIds: members.map(c => c.id), objects: members.length,
        seats: seatsOf(members), bbox: bboxOf(members), ...extra });
    };

    // -- stage, from objects the detector typed as stage ----------------------
    const stageObjects = venues.filter(c => c.type === "stage");
    if (stageObjects.length) {
      // Stage bands that touch are one performance area, not several.
      // A zone is only as certain as the objects it stands on. An object typed
      // "stage" purely because it is long is a shape guess, not a reading of
      // the drawing, and a zone built entirely on shape guesses is `likely`.
      // ORNEK is why: its four `servant` bars and its wide grey service bar
      // are all long rectangles, and this claimed three stage areas as STRONG
      // on a plan that has no stage.
      for (const cluster of clusterByGap(stageObjects, s => Math.max(s.w, s.h) * 0.6)) {
        const guessed = cluster.every(o => o.typeBasis === "aspectRatio");
        add("stage", cluster, guessed ? "likely" : "strong",
          [`${cluster.length} stage object${cluster.length === 1 ? "" : "s"} detected`,
           guessed ? "typed by shape alone — long enough to be a stage, with nothing else saying so"
                   : "typed with more than shape",
           "no seating is counted inside a stage"]);
      }
    }

    // -- bar, from objects typed as one --------------------------------------
    //
    // `bar` has been a first-class object type an operator can assign, and
    // planSummary has counted them, but the zone model had no room for one — so
    // a confirmed bar was an object in a dining area rather than a part of the
    // room with its own job. Same rule as the stage: the zone exists because an
    // object was typed as a bar, never because a cluster looked service-ish.
    // A plan with no bar produces no bar zone, which is what the a3 fixture is
    // there to check.
    const barObjects = venues.filter(c => c.type === "bar");
    if (barObjects.length)
      for (const cluster of clusterByGap(barObjects, s => Math.max(s.w, s.h) * 0.6)) {
        const guessed = cluster.every(o => o.typeBasis === "aspectRatio");
        add("bar", cluster, guessed ? "likely" : "strong",
          [`${cluster.length} bar object${cluster.length === 1 ? "" : "s"} detected`,
           "no dining seating is counted inside a bar"]);
      }

    // -- entrance, only where wording was actually read -----------------------
    const entranceObjects = venues.filter(c => c.type === "entrance");
    if (entranceObjects.length) {
      add("entrance", entranceObjects, "strong", ["objects confirmed as entrances"]);
    } else if (ocrText && ENTRANCE_WORDS.test(ocrText)) {
      // Read, but with no object to attach it to. Recorded as a zone with no
      // members and no box rather than invented somewhere plausible.
      zones.push({ id: uid("zone"), type: "entrance", confidence: "uncertain",
        evidence: ["entrance wording was read on the plan, but no entrance object was detected to place it"],
        memberIds: [], objects: 0, seats: 0, bbox: null });
    }

    // -- lounge: seating furniture that serves no table -----------------------
    const loungeFurniture = venues.filter(c => ["sofa", "bench", "banquette"].includes(c.type));
    const modalTableSide = tables.length
      ? (() => { const v = tables.map(t => Math.sqrt(t.w * t.h)).sort((a, b) => a - b); return v[v.length >> 1]; })()
      : 0;
    const link = Math.max((modalTableSide || 4) * ZONE_LINK_OF_TABLE,
      planSpacing(tables) * ZONE_LINK_OF_SPACING);
    const standalone = loungeFurniture.filter(s =>
      !tables.some(t => GEOM.gapBetween(s, t) <= Math.max(s.w, s.h) * 0.9));
    for (const cluster of clusterByGap(standalone, () => link))
      add("lounge", cluster, cluster.length > 1 ? "likely" : "uncertain",
        [`${cluster.length} seating object${cluster.length === 1 ? "" : "s"} with no table within reach`,
         "seat count on this furniture is unverified unless an operator entered it"],
        { seatsVerified: cluster.every(c => c.seatsConfidence === "verified") });

    // -- dining and bistro: clusters of tables, typed by what they are --------
    //
    // The zone's type comes from its members' modal table type, so a corner of
    // bistro tables reads as a bistro zone and the banquet floor reads as
    // dining. It is never "small tables = bistro": the tables were typed
    // upstream on evidence from three different stages, and this only reports
    // what they already are.
    for (const cluster of clusterByGap(tables, () => link)) {
      const types = cluster.reduce((m, c) => (m[c.type] = (m[c.type] || 0) + 1, m), {});
      const ranked = Object.entries(types).sort((a, b) => b[1] - a[1]);
      const [modalType, modalCount] = ranked[0];
      const share = modalCount / cluster.length;
      const seated = cluster.filter(c => (c.chairDetections || []).length > 0).length;
      const groups = (furnitureGroups || []).filter(g =>
        (g.memberIds || []).some(id => cluster.some(c => c.id === id))).length;
      const evidence = [
        `${cluster.length} table${cluster.length === 1 ? "" : "s"} standing together`,
        `${modalCount} of them typed ${modalType}`,
        `${seated} carry detected seats`,
      ];
      if (groups) evidence.push(`${groups} logical seating group${groups === 1 ? "" : "s"} inside it`);
      if (!seated) {
        // Tables nobody sits at are not a dining room. Say so rather than
        // guessing what the region is for.
        add("unknown", cluster, "uncertain",
          [...evidence, "no seats were detected at any of them, so what this area is for is undetermined"]);
        continue;
      }
      const type = modalType === "bistro" && share >= 0.5 ? "bistro" : "dining";
      add(type, cluster, share >= 0.8 ? "strong" : "likely", evidence, { modalTableType: modalType });
    }
    return zones;
  }

  // Single-linkage clustering with a caller-supplied link distance, so "these
  // things stand together" is a relation between real objects rather than a
  // grid laid over the plan.
  function clusterByGap(items, linkFor) {
    const remaining = items.slice(), clusters = [];
    while (remaining.length) {
      const cluster = [remaining.shift()];
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const c = remaining[i];
          if (cluster.some(m => GEOM.gapBetween(m, c) <= Math.max(linkFor(m), linkFor(c)))) {
            cluster.push(c); remaining.splice(i, 1); grew = true;
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  globalThis.MeritPlanZones = Object.freeze({ buildZones });
})();
