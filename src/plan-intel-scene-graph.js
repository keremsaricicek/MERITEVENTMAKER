// The scene graph: typed relationships between objects, each carrying the evidence for and against it.
//
// Part of Plan Intelligence, split out of src/plan-intelligence.js on 2026-10-04
// (technical gaps, item 2) and moved verbatim: the only edits are references to
// a name another part owns, which now go through that part's object. Nothing
// here is a trained model; every number is computed from real geometry or OCR.
(() => {
  "use strict";
  const GEOM = globalThis.MeritPlanIntelGeometry;

  // ---- scene graph ---------------------------------------------------------
  // Explicit typed relationships derived from real geometry. Nothing here
  // asserts a relationship the pixels do not support: every edge records the
  // evidence that produced it, and objects with no qualifying evidence simply
  // get no edge rather than a guessed one.
  // Every edge carries the same shape, so a consumer never has to know which
  // stage produced one to know how much to trust it:
  //
  //   strength        strong | likely | uncertain
  //   supporting      what argues FOR it, in words
  //   contradicting   what argues against, where anything does — an edge with
  //                   a real objection is not the same as one with none, and
  //                   flattening them was how "every relationship looks equally
  //                   certain" happened
  //   humanVerified   whether a person ruled on this specific relation
  //   source          which stage produced it
  //   version         which build's rules, so an old graph is readable later
  //   evidence        the same reasons as ONE readable sentence, so a product
  //                   surface that has to explain WHY has a sentence to show
  //                   rather than an array to assemble. It is composed from
  //                   `supporting` and `contradicting` -- never a label, never
  //                   a constant, and never present without them.
  //   fromType/toType which kind of node each end is. `memberOf` means two
  //                   different things depending on the target -- membership of
  //                   a VISUAL FAMILY ("looks like these") and of a LOGICAL
  //                   GROUP ("physically joined to these") -- and a consumer
  //                   explaining a decision must not have to do a lookup to
  //                   tell them apart.
  const GRAPH_VERSION = 3;

  // One sentence, built from the reasons themselves. An edge whose supporting
  // list is empty gets no sentence, and `edge()` refuses to build it at all --
  // a relationship nothing argues for is an assertion, not a finding.
  function evidenceSentence(supporting, contradicting) {
    const forIt = (supporting || []).filter(Boolean).join("; ");
    if (!forIt) return "";
    const against = (contradicting || []).filter(Boolean).join("; ");
    return against ? `${forIt} — but ${against}` : forIt;
  }

  // Refused edges are counted rather than silently dropped: "we emitted no
  // relationship here" is a fact worth being able to see.
  let refusedEdges = 0;
  const edge = (from, fromType, type, to, toType, { strength = "likely", supporting = [],
    contradicting = [], humanVerified = false, source }) => {
    const evidence = evidenceSentence(supporting, contradicting);
    if (!evidence) { refusedEdges++; return null; }
    return { from, fromType, type, to, toType, evidence, strength, supporting, contradicting,
      humanVerified, source, version: GRAPH_VERSION };
  };

  const NODE_TYPES = ["physicalObject", "visualFamily", "logicalGroup", "zone", "structuralAnchor"];

  function buildSceneGraph(candidates, furnitureGroups, zones, similarityGroups) {
    const edges = [];
    // `edge()` returns null for a relationship with nothing to say for it, so
    // every push goes through here rather than each call site remembering.
    const push = (e) => { if (e) edges.push(e); };
    refusedEdges = 0;
    const alive = candidates.filter(c => c.status !== "rejected");
    const tables = alive.filter(c => c.kind === "table");
    const venues = alive.filter(c => c.kind === "venue");
    const byId = new Map(alive.map(c => [c.id, c]));

    // ---- the nodes themselves ---------------------------------------------
    //
    // Until now the graph published node COUNTS by type and never the nodes, so
    // nothing holding a scene graph could resolve an id in it: a consumer had
    // to rebuild the id spaces from four other fields of planIntelligence, and
    // the contract test that tried got one of the five wrong and reported real
    // `visualFamily` targets as dangling.
    //
    // A visual family IS a node -- it is the unit a correction spreads across,
    // and a graph that cannot name one cannot explain why a decision reached
    // thirty objects. So all five kinds are emitted as first-class typed nodes
    // with stable ids and the provenance each kind carries, and every edge
    // endpoint resolves inside the graph itself.
    const nodeList = [];
    const nodeType = new Map();
    const addNode = (id, type, label, source, extra) => {
      if (id == null || nodeType.has(id)) return;
      nodeType.set(id, type);
      nodeList.push({ id, type, label, source, ...(extra || {}) });
    };
    // Where each object came from, said by its own record rather than assumed:
    // a re-applied human decision is "memory", an object an operator drew is
    // "operator", the rest came from Assisted Detection. A node carries the
    // ids of the observations behind it (MeritObservations), so a question
    // about the graph can be answered by the evidence, not by the graph.
    const sourceOf = (c) => c.fromMemory ? "memory" : c.missed ? "operator" : "assistedDetection";
    for (const c of alive) {
      addNode(c.id, "physicalObject", c.kind === "venue" ? (c.type || "venue") : (c.kind || "object"),
        sourceOf(c), { kind: c.kind, objectType: c.type || null, humanVerified: c.status === "confirmed",
          observationIds: c.observationIds || [] });
      for (const ch of c.chairDetections || [])
        addNode(ch.id, "physicalObject", "chair", sourceOf(c),
          { kind: "chair", objectType: "chair", humanVerified: c.status === "confirmed",
            observationIds: ch.observedBy ? [ch.observedBy] : [] });
    }
    for (const g of similarityGroups || [])
      addNode(g.id, "visualFamily", g.type || g.kind || "family", "similarityClustering",
        { members: (g.memberIds || []).length, representativeId: g.representativeId || null,
          humanVerified: false });
    for (const g of furnitureGroups || [])
      addNode(g.id, "logicalGroup", g.type || g.shape || "group",
        g.decision ? "operatorDecision" : "touchAndAlign",
        { members: (g.memberIds || []).length, decision: g.decision || null,
          humanVerified: !!g.decision });
    for (const z of zones || [])
      addNode(z.id, "zone", z.type || "unknown", "semanticZones",
        { members: (z.memberIds || []).length, humanVerified: false });
    // A structural anchor is a physical object seen in its structural role. It
    // already has a physicalObject node, so it is marked rather than duplicated
    // -- two nodes for one column would be a graph that double-counts the room.
    for (const v of venues)
      if (["column", "entrance", "exit", "bar", "stage"].includes(v.type)) {
        const n = nodeList.find(x => x.id === v.id);
        if (n) n.structuralRole = v.type;
      }
    const typeOf = (id) => nodeType.get(id) || null;

    // chair -> belongsTo -> table, and chair -> faces -> table where the symbol
    // actually carries a direction. Both come from the relationship engine,
    // which records why it decided and how close the call was; an ambiguous
    // association is a `likely` edge with the competing table named as the
    // contradicting evidence rather than an edge that looks like any other.
    for (const t of tables)
      for (const ch of t.chairDetections || []) {
        const id = ch.id || `${t.id}:chair:${Math.round(ch.x)}x${Math.round(ch.y)}`;
        const rel = ch.relation || null;
        const supporting = rel
          ? [`seated ${rel.evidence.positionKind === "inside" ? "over the table body"
              : rel.evidence.positionKind === "edge" ? `along its ${rel.evidence.positionSide} edge`
              : "past a corner"}`,
             `perimeter distance ${rel.evidence.distance}`]
          : ["nearest table within reach, one table per chair"];
        if (rel && rel.orientation && rel.orientation.facingKnown) supporting.push("the chair faces it");
        // A chair the detector produced but the node pass never saw would be an
        // edge from nowhere. It cannot happen -- both read the same
        // chairDetections -- and it is asserted rather than assumed, because
        // "every endpoint resolves" is exactly the property that was broken.
        if (!nodeType.has(id))
          addNode(id, "physicalObject", "chair", "assistedDetection",
            { kind: "chair", objectType: "chair", humanVerified: t.status === "confirmed" });
        push(edge(id, "physicalObject", "belongsTo", t.id, "physicalObject", {
          strength: !rel ? "likely" : rel.ambiguous ? "uncertain"
            : rel.evidence.positionKind === "corner" ? "likely" : "strong",
          supporting,
          contradicting: rel && rel.ambiguous && rel.runnerUpId
            ? [`another table fits almost as well (margin ${rel.margin})`] : [],
          humanVerified: t.status === "confirmed",
          source: rel ? "relationshipEngine2" : "chairAssociation",
        }));
        if (rel && rel.orientation && rel.orientation.facingKnown)
          push(edge(id, "physicalObject", "faces", t.id, "physicalObject", {
            strength: rel.orientation.facingStrength > 0.5 ? "likely" : "uncertain",
            supporting: [`the symbol is asymmetric (${rel.orientation.facingEvidence})`,
              `facing ${Math.round(rel.orientation.facingAngle)} degrees`],
            humanVerified: false, source: "orientationFromInkMass",
          }));
      }

    // object -> memberOf -> visual family. A family is a node in its own right:
    // it is the unit a correction spreads across, so a graph that cannot name
    // one cannot explain why a decision reached thirty objects.
    for (const g of similarityGroups || [])
      for (const id of g.memberIds || [])
        if (byId.has(id))
          push(edge(id, typeOf(id), "memberOf", g.id, "visualFamily", {
            strength: "likely",
            supporting: ["shares this plan's repeated visual signature"],
            humanVerified: false, source: "similarityClustering",
          }));

    // structural and semantic anchors -> the zone they belong to. A column is
    // not furniture and never was, but it IS part of a region, and saying so is
    // the difference between "six objects we ignored" and a structural grid.
    for (const z of zones || [])
      for (const v of venues) {
        const inside = z.bbox && GEOM.containsCentre(z.bbox, v);
        if (!inside) continue;
        const type = v.type === "column" ? "structuralElementOf"
          : v.type === "entrance" || v.type === "exit" ? "connectsTo"
          : v.type === "bar" ? "locatedIn" : null;
        if (!type) continue;
        push(edge(v.id, "physicalObject", type, z.id, "zone", {
          strength: "likely",
          supporting: [`a ${v.type} standing inside the ${z.type} area`],
          humanVerified: v.status === "confirmed", source: "zoneContainment",
        }));
      }

    // table -> touches -> table, and table -> partOf -> logical group.
    for (const g of furnitureGroups || []) {
      const members = (g.memberIds || []).filter(id => byId.has(id));
      if (members.length > 1) {
        for (let i = 0; i < members.length; i++)
          for (let j = i + 1; j < members.length; j++) {
            const a = byId.get(members[i]), b = byId.get(members[j]);
            if (GEOM.gapBetween(a, b) <= Math.min(a.w, a.h, b.w, b.h) * 0.28 && GEOM.aligned(a, b))
              push(edge(members[i], "physicalObject", "adjacentTo", members[j], "physicalObject", {
                strength: "strong",
                supporting: ["their boxes are within a fraction of a table of each other", "and axis-aligned"],
                humanVerified: !!g.decision, source: "touchAndAlign" }));
          }
      }
      for (const id of members)
        push(edge(id, typeOf(id), "memberOf", g.id, "logicalGroup", {
          // A human answer about a grouping is the only evidence in this graph
          // that outranks geometry, and it is marked as such rather than
          // blended into the same confidence as a measurement.
          strength: g.decision ? "strong" : "likely",
          supporting: g.decision ? [`the operator answered: ${g.decision}`]
            : ["these tables touch and line up"],
          humanVerified: !!g.decision, source: g.decision ? "operatorDecision" : "touchAndAlign" }));
    }

    // seating furniture -> faces -> logical group, when it runs alongside one.
    const seating = alive.filter(c => ["sofa", "bench", "banquette"].includes(c.kind === "venue" ? c.type : c.kind));
    for (const s of seating) {
      let best = null, bestGap = Infinity;
      for (const g of furnitureGroups || []) {
        if (!g.bbox) continue;
        const gap = GEOM.gapBetween(s, g.bbox);
        if (gap < bestGap) { bestGap = gap; best = g; }
      }
      const reach = Math.max(s.w, s.h) * 0.9;
      if (best && bestGap <= reach)
        push(edge(s.id, "physicalObject", "faces", best.id, "logicalGroup", {
          strength: "uncertain",
          supporting: [`runs alongside the group, gap ${bestGap.toFixed(1)} within reach ${reach.toFixed(1)}`],
          // Said out loud rather than left implicit: proximity is not facing,
          // and this edge would be a real one only if the sofa's orientation
          // were derivable. For most plan symbols it is not.
          contradicting: ["the sofa's own orientation was not derivable, so this is proximity, not facing"],
          humanVerified: false, source: "proximityToGroup" }));
    }

    const counts = edges.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {});
    // `nodes` stays a count per type -- consumers and the adversarial report
    // read it -- and is now derived from the emitted list rather than counted
    // separately, so the two can no longer disagree. A structural anchor is a
    // role on a physical object, not a node of its own, so it is counted as a
    // role and the physicalObject total still equals the objects in the room.
    const nodes = NODE_TYPES.reduce((m, t) => (m[t] = 0, m), {});
    for (const n of nodeList) nodes[n.type] = (nodes[n.type] || 0) + 1;
    nodes.structuralAnchor = nodeList.filter(n => n.structuralRole).length;
    return {
      edges, counts, nodes, nodeTypes: NODE_TYPES, version: GRAPH_VERSION,
      // The nodes themselves, so every edge endpoint resolves inside the graph
      // rather than against ids a consumer has to gather from elsewhere.
      nodeList,
      nodeTotal: nodeList.length,
      // Kept under its original name and meaning for the callers that read it:
      // the CANDIDATES that survived review, which is not the graph's node
      // count and never was -- the chairs hanging off those candidates are
      // nodes too, and 108 of this plan's edges start at one.
      nodeCount: alive.length,
      // Relationships the builder declined to state because nothing argued for
      // them. Reported rather than silently dropped: "we said nothing here" is
      // a fact about the plan.
      refusedEdges,
      // How much of this graph rests on something a person actually said, and
      // how much of it the graph itself doubts. Both reported, because a graph
      // that only counts edges cannot be read for how much to trust it.
      humanVerifiedEdges: edges.filter(e => e.humanVerified).length,
      contradictedEdges: edges.filter(e => e.contradicting.length).length,
      byStrength: edges.reduce((m, e) => (m[e.strength] = (m[e.strength] || 0) + 1, m), {}),
    };
  }

  globalThis.MeritPlanSceneGraph = Object.freeze({ GRAPH_VERSION, NODE_TYPES, buildSceneGraph });
})();
