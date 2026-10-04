// MERIT Event Maker — sourced observations (MeritObservations).
//
// An OBSERVATION is one thing one source saw, said in a way that can be
// checked: who saw it (source kind, provider id, version), where (geometry in a
// NAMED frame and box convention — MeritPlanFrames), how sure that source was
// (its own confidence, in its own units, never rescaled), and what to look at
// to see it again (the evidence: a crop, the words read, the stage that found
// it). Candidates and relations carry the ids of the observations behind them.
//
// Two rules this layer exists to hold:
//
//   CONFIDENCES ARE NEVER AVERAGED ACROSS SOURCES. A classical detector's 0.86
//   and an OCR engine's 94 are not the same quantity. Each stays with its
//   observation; a decision states WHICH observations support it.
//
//   AGREEMENT FROM ONE IMAGE IS ONE SOURCE. Two models run on the same raster,
//   or two crops of it read by the same engine, share every flaw of that
//   raster — a smudge, a fold, a resampling — so their agreement is
//   consistency, not independent confirmation. Independence is counted by
//   MEASUREMENT CHANNEL: the raster pixels of one image (whatever reads them),
//   a PDF's vector paths, a PDF's text layer, and a person are four channels.
//   A PDF's vectors and the raster drawn from them are the same drawing, so
//   their agreement says the drawing was READ correctly — never that the
//   drawing is right.
//
// Pure: no DOM, no state. Published once on globalThis.
(function () {
  "use strict";
  const OBSERVATION_VERSION = 1;

  // Source kinds and the channel each one measures through.
  const SOURCES = Object.freeze({
    "classical-cv": "raster",       // geometry from pixels (Assisted Detection)
    "learned-detector": "raster",   // a trained model, same pixels
    "vlm": "raster",                // a vision-language model, same pixels
    "ocr": "raster",                // text read off the pixels
    "pdf-vector": "pdf-vector",     // paths in the PDF's content stream
    "pdf-text": "pdf-text",         // the PDF's own text layer
    "human": "human",               // a person decided
    "memory": "human",              // a person's earlier decision, re-applied
    "teach-area": "human",          // an operator's scoped note
  });

  const FRAMES = new Set(["plan-percent", "source-px", "analysis-px", "pdf"]);

  function channelOf(obs) {
    const ch = SOURCES[obs.source && obs.source.kind];
    if (!ch) return null;
    // A raster channel is per image: two DIFFERENT images (a re-scan, a new
    // version) are two channels.
    if (ch === "raster") return `raster:${obs.imageRef || "unknown-image"}`;
    if (ch === "pdf-vector" || ch === "pdf-text") return `${ch}:${obs.imageRef || "unknown-document"}`;
    return ch;
  }

  // Build one observation. Refuses what it could not later explain.
  function create(input) {
    const src = input.source || {};
    if (!SOURCES[src.kind]) throw new Error(`unknown observation source "${src.kind}"`);
    if (!src.provider) throw new Error("an observation names the provider that made it");
    const g = input.geometry || null;
    if (g) {
      if (!FRAMES.has(g.frame)) throw new Error(`unknown frame "${g.frame}"`);
      if (g.convention !== "corner" && g.convention !== "centre") throw new Error("geometry names its box convention (corner | centre)");
      for (const k of ["x", "y", "w", "h"]) if (!Number.isFinite(g[k])) throw new Error(`geometry.${k} is not a number`);
    }
    const conf = input.confidence;
    if (conf != null && (!Number.isFinite(conf.value) || !conf.scale))
      throw new Error("a confidence carries its value AND its scale (e.g. provider-native-0-1, ocr-0-100)");
    return {
      v: OBSERVATION_VERSION,
      id: input.id,
      source: { kind: src.kind, provider: src.provider, version: src.version || null },
      imageRef: input.imageRef || null,
      claim: input.claim || {},
      geometry: g ? { frame: g.frame, convention: g.convention, x: g.x, y: g.y, w: g.w, h: g.h, rotation: g.rotation || 0 } : null,
      confidence: conf ? { value: conf.value, scale: conf.scale } : null,
      evidence: input.evidence || null,
    };
  }

  // How much independent support a set of observations gives one claim: the
  // number of distinct channels, and per channel how many observations agree.
  // Deliberately NO combined confidence.
  function support(observations) {
    const byChannel = {};
    for (const o of observations || []) {
      const ch = channelOf(o);
      if (!ch) continue;
      (byChannel[ch] ||= { observations: 0, sources: [] }).observations++;
      const key = `${o.source.kind}:${o.source.provider}`;
      if (!byChannel[ch].sources.includes(key)) byChannel[ch].sources.push(key);
    }
    const channels = Object.keys(byChannel);
    return {
      independentChannels: channels.length,
      observations: (observations || []).length,
      byChannel,
      humanDecided: channels.includes("human"),
    };
  }

  // Is this set allowed to be called "independently confirmed"? Two or more
  // channels — never two observations from one image.
  function independentlyConfirmed(observations) {
    return support(observations).independentChannels >= 2;
  }

  // Attach observations to an analysis and link them from candidates.
  // `analysis.observations` is the one list; candidates carry ids.
  function link(analysis, candidate, obs) {
    (analysis.observations ||= []).push(obs);
    (candidate.observationIds ||= []).push(obs.id);
    return obs;
  }

  function forCandidate(analysis, candidate) {
    const ids = new Set(candidate.observationIds || []);
    return (analysis.observations || []).filter(o => ids.has(o.id));
  }

  // Shape check for stored data (schema migration reads old analyses without
  // observations; that is valid and says "not recorded", not "unsupported").
  function validate(obs) {
    const problems = [];
    if (!obs || typeof obs !== "object") return ["not an object"];
    if (!SOURCES[obs.source && obs.source.kind]) problems.push("unknown source kind");
    if (!obs.source || !obs.source.provider) problems.push("no provider");
    if (obs.geometry && (!FRAMES.has(obs.geometry.frame) || !["corner", "centre"].includes(obs.geometry.convention))) problems.push("geometry frame/convention");
    if (obs.confidence && (!Number.isFinite(obs.confidence.value) || !obs.confidence.scale)) problems.push("confidence without scale");
    return problems;
  }

  // The observations behind a finished analysis, built from what each stage
  // left on the candidates — the detector's geometry and native confidence, the
  // label the drawing printed on a venue object, each crop's reading of a
  // printed table number, a re-applied human decision. Rebuilt whole on every
  // analysis, so a stale observation cannot outlive the candidate it described.
  //
  // Seats are not separate observations: a seat is produced by the same
  // detector pass as its table, and its geometry (CENTRE convention), its own
  // confidence and the relation engine's reasons already sit on it. Each seat
  // carries `observedBy`, the id of the observation that produced it.
  function recordFromAnalysis(analysis, ctx) {
    const detector = (ctx && ctx.detector) || { id: "unknown-detector", version: null };
    const ocrEngine = (ctx && ctx.ocrEngine) || null;
    const imageRef = (ctx && ctx.imageRef) || null;
    const list = [];
    let n = 0;
    const add = (candidate, input) => {
      const obs = create({ ...input, id: `obs-${++n}`, imageRef });
      list.push(obs);
      candidate.observationIds.push(obs.id);
      return obs;
    };
    for (const c of analysis.candidates || []) {
      c.observationIds = [];
      const geometry = { frame: "plan-percent", convention: "corner", x: c.x, y: c.y, w: c.w, h: c.h, rotation: c.rotation || 0 };
      let made;
      if (c.fromMemory || c.missed) {
        made = add(c, {
          source: { kind: c.fromMemory ? "memory" : "human", provider: c.fromMemory ? "plan-memory" : "operator" },
          claim: { kind: c.kind, type: c.type || null, status: c.status },
          geometry, confidence: null,
          evidence: { what: c.fromMemory ? "an operator's earlier decision on this plan, re-applied by Visual Plan Memory" : "drawn by an operator" },
        });
      } else {
        made = add(c, {
          source: { kind: "classical-cv", provider: detector.id, version: detector.version || null },
          claim: { kind: c.kind, type: c.type || null },
          geometry,
          confidence: Number.isFinite(c.confidence) ? { value: c.confidence, scale: "provider-native-0-1" } : null,
          evidence: {
            stageSource: (c.evidence && c.evidence.source) || null,
            shapeBasis: (c.evidence && c.evidence.shapeBasis) || null,
            seats: (c.chairDetections || []).length,
            seatConvention: "centre",
          },
        });
      }
      for (const ch of c.chairDetections || []) ch.observedBy = made.id;
      if (c.labelRead && ocrEngine) {
        add(c, {
          source: { kind: "ocr", provider: ocrEngine },
          claim: { type: c.type, label: c.labelRead.term },
          geometry,
          confidence: Number.isFinite(c.labelRead.confidence) ? { value: c.labelRead.confidence, scale: "ocr-0-100" } : null,
          evidence: { crop: "this object's own box", variant: c.labelRead.variant || null },
        });
      }
      const pn = c.printedNumber;
      if (pn && Array.isArray(pn.readings) && ocrEngine) {
        for (const r of pn.readings) {
          add(c, {
            source: { kind: "ocr", provider: ocrEngine },
            claim: { printedNumber: r.value },
            geometry,
            confidence: Number.isFinite(r.confidence) ? { value: r.confidence, scale: "ocr-0-100" } : null,
            evidence: { crop: r.view || null, of: "this table's own symbol" },
          });
        }
      }
    }
    analysis.observations = list;
    return list;
  }

  globalThis.MeritObservations = Object.freeze({
    OBSERVATION_VERSION, SOURCES, create, support, independentlyConfirmed, channelOf, link, forCandidate, validate,
    recordFromAnalysis,
  });
})();
