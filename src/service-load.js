// WHERE IS THIS ROOM BUSY RIGHT NOW?
//
// One question, answered from facts the product already has: where the tables
// are, how many people are on them, which zone they belong to, and which venue
// objects on the drawing are places service comes from.
//
// WHAT THIS MODULE REFUSES TO INVENT, and why each one is a real temptation:
//
//   WALKING ROUTES. The product knows where objects are on a drawing. It does
//   not know where the walls, doors, service corridors or kitchen passes are,
//   so a line drawn between a bar and a table is a line, not a route. Drawing
//   one would be the most convincing wrong thing on the screen.
//
//   DISTANCES IN ANY UNIT. A plan carries pixels and a display scale. Nothing
//   calibrates those to metres, so "14m from the bar" would be a number with no
//   referent. What IS valid on one drawing is RELATIVE ordering — which
//   occupied tables sit furthest from any marked service point — and that is
//   all this module reports, said as a rank and never as a measurement.
//
//   SERVICE TIMES, STAFF LOAD, COVER TURNAROUND. There is no staff record, no
//   service event and no timing data anywhere in this product. These are named
//   in `notEvaluated` so a screen can say so rather than implying the layer
//   covers them.
//
//   A CONTINUOUS HEAT FIELD. Occupancy is known PER TABLE. Interpolating a
//   smooth surface between tables would invent a figure for every square of
//   floor the product knows nothing about. Bands per table and totals per zone
//   are the honest granularity, and they are what this returns.
//
// PLANNED AND LIVE ARE DIFFERENT ROOMS. Planned occupancy is the seating plan.
// Live occupancy releases the seats of a No Show, because those chairs are
// physically free tonight while the plan correctly still shows them taken.
// Merging the two is the domain error this product exists not to make.
(function () {
  "use strict";

  // How busy, named rather than scored. A percentage per table would invite
  // being read as a service-pressure index, which is a thing this module has no
  // data for; a band says exactly what it knows — how full the table is.
  const BAND = {
    EMPTY: "EMPTY",     // nobody on it
    LIGHT: "LIGHT",     // up to half
    BUSY: "BUSY",       // more than half, not full
    FULL: "FULL",       // every chair taken
  };

  const MODE = {
    PLANNED: "PLANNED", // the seating plan
    LIVE: "LIVE",       // tonight's room: a No Show's chairs are free
  };

  // Venue objects that are places service comes from. A closed list read off
  // the drawing's own object types — nothing here guesses that an unlabelled
  // rectangle might be a service point.
  const SERVICE_TYPES = new Set(["bar"]);

  // Named so a screen can state them. Same discipline as the risk radar's
  // blind spots: a layer that shows only what it can compute teaches an
  // operator that a quiet layer means an easy room.
  const NOT_EVALUATED = [
    { aspect: "WALKING_ROUTES", why: "the drawing does not say where walls, doors or service corridors are" },
    { aspect: "SERVICE_TIMES", why: "no service event or timing is recorded anywhere in this product" },
    { aspect: "STAFF_LOAD", why: "there are no staff records to place or count" },
  ];

  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  // Logical seats, not drawn chairs -- defined in src/seat-model.js, which
  // says why. The fallback keeps this module usable on its own.
  const seatable = (t) => (globalThis.MeritSeatModel
    ? globalThis.MeritSeatModel.canSeat(t)
    : !!t && num(t.capacity) > 0);
  const centre = (o) => ({ x: num(o.x) + num(o.w) / 2, y: num(o.y) + num(o.h) / 2 });

  function bandOf(pax, capacity) {
    if (!capacity || pax <= 0) return BAND.EMPTY;
    if (pax >= capacity) return BAND.FULL;
    return pax * 2 > capacity ? BAND.BUSY : BAND.LIGHT;
  }

  // ---------------------------------------------------------------------------

  function build(input) {
    const inp = input || {};
    const tables = Array.isArray(inp.tables) ? inp.tables : [];
    const guests = Array.isArray(inp.guests) ? inp.guests : [];
    const venueObjects = Array.isArray(inp.venueObjects) ? inp.venueObjects : [];
    const mode = inp.mode === MODE.LIVE ? MODE.LIVE : MODE.PLANNED;

    // One pass over the guests rather than a scan per table: a four-hundred
    // table room would otherwise cost O(tables x guests) every time the layer
    // is drawn, and this runs on the canvas.
    const paxByTable = new Map();
    for (const g of guests) {
      if (!g || !g.assignment || !g.assignment.tableId) continue;
      // The ONE difference between the two rooms. A No Show keeps the planned
      // seat — the plan and the reports are right — and frees the chair tonight.
      if (mode === MODE.LIVE && g.arrivalStatus === "No Show") continue;
      const id = g.assignment.tableId;
      paxByTable.set(id, (paxByTable.get(id) || 0) + paxOf(g));
    }

    const rows = [], byZone = new Map();
    let chairs = 0, seated = 0;
    for (const t of tables) {
      if (!seatable(t)) continue;
      const capacity = num(t.capacity);
      const pax = Math.min(capacity, paxByTable.get(t.id) || 0);
      chairs += capacity; seated += pax;
      const zone = String(t.zone || "").trim() || null;
      rows.push({ tableId: t.id, number: String(t.number), zone, capacity, pax,
        free: capacity - pax, band: bandOf(pax, capacity) });
      const key = zone || "";
      if (!byZone.has(key)) byZone.set(key, { zone, tables: 0, capacity: 0, pax: 0 });
      const z = byZone.get(key);
      z.tables += 1; z.capacity += capacity; z.pax += pax;
    }

    const zones = [...byZone.values()]
      .map((z) => ({ ...z, free: z.capacity - z.pax, band: bandOf(z.pax, z.capacity) }))
      .sort((a, b) => (b.pax - a.pax) || String(a.zone || "").localeCompare(String(b.zone || ""), "tr"));

    // Service points, read off the drawing. Either they are marked or they are
    // not, and the second case is reported rather than worked around.
    const points = venueObjects.filter((o) => o && SERVICE_TYPES.has(o.type))
      .map((o) => ({ id: o.id, type: o.type, label: String(o.label || "").trim() || null,
        ...centre(o) }));

    // RELATIVE ordering only. The squared distance is compared and never
    // reported: on one drawing "further than" is a fact, and "14 metres" is a
    // number with no referent.
    let farthest = [];
    if (points.length) {
      const byId = new Map(tables.map((t) => [t.id, t]));
      farthest = rows.filter((r) => r.pax > 0).map((r) => {
        const t = byId.get(r.tableId), c = centre(t);
        let best = Infinity;
        for (const p of points) {
          const d = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
          if (d < best) best = d;
        }
        return { tableId: r.tableId, number: r.number, pax: r.pax, _d: best };
      }).sort((a, b) => b._d - a._d)
        .map(({ _d, ...rest }, i) => ({ ...rest, rank: i + 1 }));
    }

    return {
      version: 1, mode,
      tables: rows,
      zones,
      room: { chairs, seated, free: chairs - seated, band: bandOf(seated, chairs),
        tables: rows.length },
      busiestZone: zones.length && zones[0].pax > 0 ? zones[0] : null,
      servicePoints: {
        known: points.length > 0,
        count: points.length,
        points: points.map((p) => ({ id: p.id, type: p.type, label: p.label })),
        why: points.length ? null : "no service point is marked on this plan",
      },
      // Occupied tables ordered by how far they sit from the nearest marked
      // service point. Empty when no service point is marked — an unknown stays
      // unknown rather than becoming a list computed from nothing.
      farthestFromService: farthest,
      notEvaluated: NOT_EVALUATED.map((x) => ({ ...x })),
      // Said in the object so no caller can present the ordering as a distance
      // or the layer as a route map.
      measured: false,
      statement: "occupancy per table and per zone; ordering relative to this drawing only; no route, distance or timing is computed",
    };
  }

  globalThis.MeritServiceLoad = {
    version: 1, BAND, MODE, SERVICE_TYPES, NOT_EVALUATED, build, bandOf,
  };
})();
