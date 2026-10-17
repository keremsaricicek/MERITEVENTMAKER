// MERIT Event Maker — the plan, read back in words (MeritPlanReading).
//
// The analysis already knows a great deal about a drawing: its objects, which
// chair belongs to which table, which tables were pushed together, the zones,
// the capacity it prints, the numbers it carries. What it did not do is say
// so the way a person reading the sheet would: where the stage is, what sits
// in front of it, which words on the paper meant what, what does not add up.
// This module is that reader. It DISCOVERS NO OBJECT — every sentence restates
// or relates something an earlier stage found or the drawing itself prints,
// and carries the objects (refs) and the printed text (boxes) it stands on, so
// a person can put a finger on the evidence.
//
// Every sentence says how it is known:
//   stated    the drawing itself says it (printed text, a PDF text object)
//   seen      detected on the drawing and not contradicted
//   inferred  derived from the above by a rule that is named (pushed-together
//             tables, a per-loca share of a printed total, a line of sight)
//   unsure    held back, ambiguous, or a shape the drawing does not name
// Nothing is promoted: a guess is never worded as a fact, and something the
// build does not model is not mentioned as if it had been checked.
//
// Sentences are structured (key + params), never English: the screen decides
// the language. Pure: no DOM, no state; positions are plan-relative thirds
// (top left … bottom right), never compass points or metres — nothing tells
// this build which way is north or how big a pixel is.
(function () {
  "use strict";

  const POS = Object.freeze(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"]);
  const MAX_TEXTS = 400;

  const fold = (s) => String(s || "").toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[：]/g, ":").replace(/\s+/g, " ").trim();
  const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  function posOf(b) {
    const c = center(b), col = c.x < 100 / 3 ? 0 : c.x < 200 / 3 ? 1 : 2, row = c.y < 100 / 3 ? 0 : c.y < 200 / 3 ? 1 : 2;
    return POS[row * 3 + col];
  }
  const median = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const offered = (c) => c && c.status !== "rejected" && (c.status === "confirmed" || c.selected !== false);
  const bboxOf = (list) => {
    if (!list.length) return null;
    const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
    const x1 = Math.max(...list.map((b) => b.x + b.w)), y1 = Math.max(...list.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  // ---- the words on the sheet -----------------------------------------------------
  // A word is put in ONE category by what it says, in Turkish or English, and
  // the category decides what it may be used for. The vocabulary is the
  // trade's, not any one plan's.
  const DATE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;
  const CATEGORIES = [
    ["capacity", /\d[\d.,]*\s*(pax|kisi|person|people|guests?|misafir|seats?)\b|\d+\s*[*x×]\s*\d+/],
    ["dimension", /^\d+([.,]\d+)?\s*(m|cm|mm|mt|metre|meter)$/],
    ["capacityLabel", /^(salon|toplam|total|kapasite|capacity|genel toplam)$/],
    ["stage", /\b(sahne|stage|podyum|podium|runway|catwalk)\b/],
    ["bar", /\bbar\b/],
    ["entrance", /\b(giris|entrance|entry|exit|cikis|acil cikis)\b/],
    ["loca", /\b(loca|localar|loge|locas)(\s*\d+[a-z]?)?\b/],
    ["service", /\b(servant|servis|service|office|ofis|mutfak|kitchen|catering)\b/],
    ["technical", /\b(kontrol|control|foh|reji|regie|sound|ses|isik|light|lighting|dj|system|sistem|teknik|technical)\b/],
    ["facility", /\b(wc|tuvalet|toilet|restroom|vestiyer|cloak|garderob|lobby|lobi|fuaye|foyer)\b/],
    ["vip", /\bvip\b/],
    ["venueName", /\b(salon|salonu|hall|ballroom|balo|otel|hotel|lounge|teras|terrace)\b/],
    ["number", /^\d{1,4}[a-z]?$/],
  ];
  const ROOM = new Set(["stage", "bar", "entrance", "loca"]);
  function categoryOf(text) {
    const f = fold(text);
    if (!f) return "empty";
    for (const [k, re] of CATEGORIES) if (re.test(f)) return k;
    if (DATE.test(f)) return "date";
    return "other";
  }

  // OCR model items ({text, box px}) in the analysed image's size, plus any
  // text the caller hands in (a PDF's own words, already in that image's
  // pixels), as plan-percent boxes. Stacked pieces of one label ("SYSTEM" over
  // "KONTROL") are joined when neither stands for a place on its own.
  function textsOf(analysis, extra) {
    const src = [];
    const om = analysis && analysis.ocrModel;
    const size = om && om.imageSize && om.imageSize.width > 0 ? om.imageSize : { width: analysis && analysis.imageWidth, height: analysis && analysis.imageHeight };
    for (const it of (om && Array.isArray(om.items) ? om.items : [])) src.push({ it, size, engine: "ocrModel" });
    for (const it of (Array.isArray(extra) ? extra : [])) src.push({ it, size: { width: analysis.imageWidth, height: analysis.imageHeight }, engine: it.engine || "pdfTextLayer" });
    const out = [];
    for (const { it, size: s, engine } of src.slice(0, MAX_TEXTS)) {
      const b = it && it.box, text = it && typeof it.text === "string" ? it.text.trim().slice(0, 120) : "";
      if (!text || !b || !(s.width > 0) || !(s.height > 0) || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) continue;
      out.push({ text, engine, box: { x: b.x0 / s.width * 100, y: b.y0 / s.height * 100, w: (b.x1 - b.x0) / s.width * 100, h: (b.y1 - b.y0) / s.height * 100 } });
    }
    out.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const joinable = (k) => k === "technical" || k === "other";
    const merged = [];
    for (const t of out) {
      const prev = merged.find((m) => {
        const lh = Math.min(m.box.h, t.box.h), ov = Math.min(m.box.x + m.box.w, t.box.x + t.box.w) - Math.max(m.box.x, t.box.x);
        const stacked = ov > 0.5 * Math.min(m.box.w, t.box.w) && t.box.y - (m.box.y + m.box.h) <= 0.8 * lh && t.box.y >= m.box.y;
        return stacked && joinable(categoryOf(m.text)) && joinable(categoryOf(t.text)) && !(categoryOf(m.text) === "other" && categoryOf(t.text) === "other");
      });
      if (prev) { prev.text = prev.text + " " + t.text; prev.box = bboxOf([prev.box, t.box]); }
      else merged.push({ ...t });
    }
    return merged.map((t, i) => ({ id: "txt-" + (i + 1), ...t, category: categoryOf(t.text) }));
  }

  // ---- geometry in the plan's own pixels ----------------------------------------------
  function px(b, W, H) { return { x0: b.x / 100 * W, y0: b.y / 100 * H, x1: (b.x + b.w) / 100 * W, y1: (b.y + b.h) / 100 * H }; }
  const mid = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  function gap(a, b) { return Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1)); }
  // Does the segment p→q pass through the rectangle r? (Liang–Barsky.)
  function segmentHitsRect(p, q, r) {
    let t0 = 0, t1 = 1;
    const dx = q.x - p.x, dy = q.y - p.y;
    for (const [pp, qq] of [[-dx, p.x - r.x0], [dx, r.x1 - p.x], [-dy, p.y - r.y0], [dy, r.y1 - p.y]]) {
      if (pp === 0) { if (qq < 0) return false; continue; }
      const t = qq / pp;
      if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 1e-6;
  }
  const nearestPoint = (p, r) => ({ x: Math.min(Math.max(p.x, r.x0), r.x1), y: Math.min(Math.max(p.y, r.y0), r.y1) });

  // ---- the reading -------------------------------------------------------------------------
  // analysis: the stored analysis. opts.texts: extra text items (a PDF's own
  // words, {text, box:{x0,y0,x1,y1}} in the analysed image's pixels).
  function read(analysis, opts) {
    const a = analysis || {}, o = opts || {};
    const W = a.imageWidth > 0 ? a.imageWidth : 100, H = a.imageHeight > 0 ? a.imageHeight : 100;
    const pi = a.planIntelligence || {};
    const all = Array.isArray(a.candidates) ? a.candidates : [];
    const live = all.filter(offered);
    const byId = new Map(all.map((c) => [c.id, c]));
    const tables = live.filter((c) => c.kind === "table");
    const venues = live.filter((c) => c.kind === "venue");
    const ofType = (t) => venues.filter((c) => c.type === t);
    const texts = textsOf(a, o.texts);
    const sum = pi.planSummary || {};
    const symbolic = sum.representation === "SYMBOLIC";
    const capa = pi.capacityAudit || {};
    const sections = [];
    let n = 0;
    // What a person decided outranks how the drawing was read: a line about
    // objects that a person confirmed says so (and says "remembered" when that
    // decision came back from the plan memory on a new analysis). Worked-out
    // lines stay worked out — confirming three tables does not confirm that
    // they are one table.
    const personal = (refs) => refs.length > 0 && refs.every((id) => { const c = byId.get(id); return c && c.status === "confirmed"; });
    const S = (key, params, refs, certainty, boxes) => {
      const r = (refs || []).filter(Boolean);
      const by = certainty !== "inferred" && personal(r) ? (r.every((id) => byId.get(id).fromMemory) ? "remembered" : "confirmed") : certainty;
      return { id: "rs-" + (++n), key, params: params || {}, refs: r, boxes: boxes || [], certainty: by };
    };
    const section = (id, sentences) => { const s = sentences.filter(Boolean); if (s.length) sections.push({ id, sentences: s }); };
    const P = (c) => px(c, W, H);
    const tableSide = median(tables.map((c) => Math.min(c.w / 100 * W, c.h / 100 * H))) || 1;

    // The words, each with what it was used for.
    const nearType = (t, type) => {
      const pool = (type === "entrance" ? venues.filter((c) => c.type === "entrance" || c.type === "exit") : ofType(type));
      const tp = px(t.box, W, H);
      return pool.filter((c) => gap(tp, P(c)) <= Math.max(tableSide, 2 * (tp.y1 - tp.y0))).sort((x, y) => gap(tp, P(x)) - gap(tp, P(y)))[0] || null;
    };
    for (const t of texts) {
      if (ROOM.has(t.category)) {
        const c = nearType(t, t.category);
        t.used = c ? { key: "read.used.named", params: { type: t.category } } : { key: "read.used.placeOnly", params: { type: t.category } };
        t.refs = c ? [c.id] : [];
      } else if (t.category === "capacity" || t.category === "capacityLabel") t.used = { key: capa.drawingStated != null ? "read.used.capacity" : "read.used.capacityUnread", params: {} };
      else if (t.category === "dimension") t.used = { key: "read.used.dimension", params: {} };
      else if (t.category === "number") t.used = { key: "read.used.number", params: {} };
      else if (["service", "technical", "facility", "vip"].includes(t.category)) t.used = { key: "read.used.placeOnly", params: { type: t.category } };
      else if (t.category === "venueName" || t.category === "date") t.used = { key: "read.used.eventInfo", params: {} };
      else t.used = { key: "read.used.none", params: {} };
      t.refs ||= [];
    }
    // A list of names stacked in one column, away from the objects it names,
    // is a LEGEND (an index printed beside the drawing), not the places.
    for (const k of ROOM) {
      const list = texts.filter((t) => t.category === k);
      const column = list.filter((t) => list.filter((u) => u !== t && Math.abs(u.box.x - t.box.x) < 2 && Math.abs(u.box.y - t.box.y) < 4 * t.box.h).length >= 2);
      if (column.length >= 3) for (const t of column) { t.used = { key: "read.used.legend", params: { type: k } }; t.refs = []; }
    }
    // A bare heading on the same line as a capacity figure ("LOCALAR  : 72 PAX")
    // labels that figure.
    for (const t of texts) {
      if (t.category === "capacity" || t.category === "number" || fold(t.text).split(" ").length > 2) continue;
      const sameLine = texts.find((u) => u.category === "capacity" && Math.min(t.box.y + t.box.h, u.box.y + u.box.h) - Math.max(t.box.y, u.box.y) > 0.5 * Math.min(t.box.h, u.box.h) && u.box.x > t.box.x && u.box.x - (t.box.x + t.box.w) < 20);
      if (sameLine && (t.category === "loca" || t.category === "capacityLabel" || t.category === "other" || t.category === "venueName")) { t.category = "capacityLabel"; t.used = { key: "read.used.capacity", params: {} }; t.refs = []; }
    }
    // A title: a long unplaced line in the top third, or the line a date is in.
    const dated = texts.find((t) => t.category === "date" || (t.category === "other" && DATE.test(fold(t.text))));
    const titleText = dated || texts.filter((t) => t.category === "other" && t.box.y < 33 && t.text.replace(/\W/g, "").length >= 4).sort((x, y) => y.text.length - x.text.length)[0] || null;
    let event = null;
    if (titleText || texts.some((t) => t.category === "venueName")) {
      const venue = texts.filter((t) => t.category === "venueName").sort((x, y) => y.text.length - x.text.length)[0] || null;
      const m = titleText ? fold(titleText.text).match(DATE) : null;
      const title = titleText ? titleText.text.replace(DATE, "").replace(/\s+/g, " ").trim() : "";
      event = { title: title || null, date: m ? m[0] : null, venue: venue ? venue.text : null,
        boxes: [titleText && titleText.box, venue && venue.box].filter(Boolean) };
      if (titleText) { titleText.category = "title"; titleText.used = { key: "read.used.eventInfo", params: {} }; }
    }

    // ---- the event, as the sheet names it
    section("event", event ? [
      event.title ? S("read.event.title", { title: event.title }, [], "stated", event.boxes.slice(0, 1)) : null,
      event.date ? S("read.event.date", { date: event.date }, [], "stated", event.boxes.slice(0, 1)) : null,
      event.venue ? S("read.event.venue", { venue: event.venue }, [], "stated", event.boxes.slice(-1)) : null,
    ] : []);

    // ---- what kind of drawing, and what is in it
    const typeCount = {};
    for (const t of tables) typeCount[t.type || "other"] = (typeCount[t.type || "other"] || 0) + 1;
    const typeList = Object.entries(typeCount).sort((x, y) => y[1] - x[1]).map(([type, k]) => ({ type, n: k }));
    const venueCount = {};
    for (const v of venues) venueCount[v.type || "other"] = (venueCount[v.type || "other"] || 0) + 1;
    const groups = (pi.furnitureGroups || []).filter((g) => (g.memberIds || []).filter((id) => byId.has(id) && offered(byId.get(id))).length > 1);
    const seatsOf = (ids) => ids.reduce((k, id) => k + ((byId.get(id) && byId.get(id).chairDetections) || []).length, 0);
    section("overview", [
      tables.length ? S(symbolic ? "read.overview.symbolic" : "read.overview.physical", { tables: tables.length, types: typeList, seats: sum.physicalSeats ?? null }, tables.map((t) => t.id), "seen") : S("read.overview.empty", {}, [], "seen"),
      groups.length ? S("read.overview.merged", { groups: groups.length, units: (pi.planSummary && pi.planSummary.diningGroups) || null }, groups.flatMap((g) => g.memberIds), "inferred") : null,
      Object.keys(venueCount).length ? S("read.overview.venue", { types: Object.entries(venueCount).map(([type, k]) => ({ type, n: k })) }, venues.map((v) => v.id), "seen") : null,
    ]);

    // ---- capacity: what the sheet says, what was counted, and the gap
    const stated = capa.drawingStated, rule = capa.rule, parts = capa.parts || {};
    const capTexts = texts.filter((t) => t.category === "capacity").map((t) => t.box);
    const locas = ofType("loca");
    const capSentences = [];
    if (rule && rule.units && rule.perUnit) capSentences.push(S("read.capacity.rule", { units: rule.units, perUnit: rule.perUnit, seats: rule.total }, [], rule.unitsAgree === false ? "inferred" : "stated", capTexts));
    if (stated != null) capSentences.push(S("read.capacity.stated", { total: stated }, [], "stated", capTexts));
    if (parts.boxes && locas.length) {
      const per = parts.boxes / locas.length;
      capSentences.push(S(Number.isInteger(per) ? "read.capacity.perLoca" : "read.capacity.locaTotal", { total: parts.boxes, locas: locas.length, per: Number.isInteger(per) ? per : null }, locas.map((l) => l.id), "inferred", capTexts));
    }
    if (!symbolic && Number.isFinite(sum.physicalSeats)) {
      capSentences.push(S("read.capacity.counted", { seats: sum.physicalSeats }, tables.map((t) => t.id), "seen"));
      if (stated != null && stated !== sum.physicalSeats) {
        const unsure = (capa.unverified || []).map((u) => u.id).filter((id) => byId.has(id));
        const held = capa.physical && capa.physical.heldBack;
        capSentences.push(S("read.capacity.gap", { stated, counted: sum.physicalSeats, diff: stated - sum.physicalSeats, unverified: unsure.length, held: held ? held.seats : 0 },
          [...unsure, ...all.filter((c) => c.status !== "rejected" && c.selected === false && c.kind === "table").map((c) => c.id)], "inferred"));
      }
    }
    if (symbolic && rule && rule.units && tables.length !== rule.units) capSentences.push(S("read.capacity.tablesVsRule", { found: tables.length, stated: rule.units, diff: rule.units - tables.length }, [], "seen"));
    if (stated == null && !rule) capSentences.push(S("read.capacity.none", {}, [], "stated"));
    section("capacity", capSentences);

    // ---- the stage, and what faces it
    const stages = ofType("stage");
    const stageSentences = [];
    let stageRect = null;
    if (stages.length) {
      const st = stages[0], b = P(st), label = texts.find((t) => t.category === "stage");
      stageRect = b;
      stageSentences.push(S("read.stage.where", { pos: posOf(st), widthPct: Math.round(st.w) }, [st.id], label ? "stated" : "seen", label ? [label.box] : []));
      const reach = 2.5 * tableSide;
      const front = tables.map((t) => ({ t, g: gap(P(t), b) })).filter((r) => r.g <= reach).sort((x, y) => x.g - y.g).map((r) => r.t.id);
      if (front.length) stageSentences.push(S("read.stage.front", { n: front.length }, front, "inferred"));
      const ext = ofType("stage_extension").concat(ofType("runway"));
      if (ext.length) stageSentences.push(S("read.stage.extension", { n: ext.length }, ext.map((c) => c.id), "seen"));
    } else {
      // A large unnamed block in the room, with tables around it, is offered
      // as a POSSIBLE stage — the sheet does not name it, so it is a question.
      const interior = all.filter((c) => c.status !== "rejected" && c.kind === "venue" && !["column", "loca", "banquette", "bar", "entrance", "exit", "chair"].includes(c.type))
        .filter((c) => c.x > 3 && c.y > 3 && c.x + c.w < 97 && c.y + c.h < 97);
      const block = interior.map((c) => {
        const b = P(c), area = (b.x1 - b.x0) * (b.y1 - b.y0), around = tables.filter((t) => gap(P(t), b) <= 3 * tableSide);
        const sides = new Set(around.map((t) => { const tc = mid(P(t)), cc = mid(b); return Math.abs(tc.x - cc.x) > Math.abs(tc.y - cc.y) ? (tc.x < cc.x ? "l" : "r") : (tc.y < cc.y ? "t" : "b"); }));
        return { c, area, sides: sides.size };
      }).filter((r) => r.area >= 2 * tableSide * tableSide && r.sides >= 3).sort((x, y) => y.area - x.area)[0];
      stageSentences.push(block ? S("read.stage.maybe", { pos: posOf(block.c) }, [block.c.id], "unsure") : S("read.stage.none", {}, [], tables.length ? "seen" : "unsure"));
    }
    section("stage", stageSentences);

    // ---- tables: pushed together, numbered
    const tableSentences = [];
    if (groups.length) {
      const sizes = {};
      for (const g of groups) { const k = g.memberIds.length; sizes[k] = (sizes[k] || 0) + 1; }
      tableSentences.push(S("read.tables.mergedSummary", { groups: groups.length, sizes: Object.entries(sizes).sort((x, y) => y[0] - x[0]).map(([size, k]) => ({ size: Number(size), n: k })) }, groups.flatMap((g) => g.memberIds), "inferred"));
      for (const g of groups.slice().sort((x, y) => y.memberIds.length - x.memberIds.length)) {
        const members = g.memberIds.filter((id) => byId.has(id)), seats = seatsOf(members);
        tableSentences.push(S(seats ? "read.tables.mergedOne" : "read.tables.mergedOneBare", { n: members.length, seats: seats || null, pos: posOf(g.bbox || bboxOf(members.map((id) => byId.get(id)))) }, members, "inferred"));
      }
    } else if (tables.length > 1 && symbolic) tableSentences.push(S("read.tables.symbolsApart", {}, [], "inferred"));
    const ni = a.numberIntegrity;
    if (ni && ni.summary) {
      const s = ni.summary;
      // Both sentences count the tables THIS reading is about. The number check
      // counts only the tables whose number it tried to read, and a table the
      // local model added was never among them, so its own total (163 on
      // ORNEK) did not add up with the open ones (21 of 166).
      const verifiedIds = tables.filter((t) => t.printedNumber && t.printedNumber.state === "VERIFIED").map((t) => t.id);
      tableSentences.push(S("read.numbers.summary", { verified: verifiedIds.length, tables: tables.length, from: ni.range && ni.range.from, to: ni.range && ni.range.to }, verifiedIds, "seen"));
      const open = tables.filter((t) => !(t.printedNumber && t.printedNumber.state === "VERIFIED")).map((t) => t.id);
      if (open.length) tableSentences.push(S("read.numbers.open", { n: open.length }, open, "unsure"));
      if (s.duplicates) tableSentences.push(S("read.numbers.duplicates", { n: s.duplicates }, (ni.findings || []).filter((f) => f.kind === "duplicate" || f.kind === "duplicateNumber").flatMap((f) => f.tableIds || []), "unsure"));
    }
    section("tables", tableSentences);

    // ---- seats: drawn chairs, who they belong to, what is unknown
    const seatSentences = [];
    if (!symbolic && sum.physicalSeats) {
      const chairs = tables.flatMap((t) => (t.chairDetections || []).map((ch) => ({ ch, t })));
      const facing = chairs.filter(({ ch }) => ch.relation && ch.relation.orientation && ch.relation.orientation.facingKnown).length;
      const ambiguous = chairs.filter(({ ch }) => ch.relation && ch.relation.ambiguous).map(({ t }) => t.id);
      seatSentences.push(S("read.seats.attached", { seats: chairs.length, tables: tables.filter((t) => (t.chairDetections || []).length).length }, tables.map((t) => t.id), "seen"));
      if (chairs.length) seatSentences.push(S("read.seats.facing", { n: facing, total: chairs.length }, [], facing === chairs.length ? "seen" : "inferred"));
      if (ambiguous.length) seatSentences.push(S("read.seats.ambiguous", { n: ambiguous.length }, [...new Set(ambiguous)], "unsure"));
      const bare = tables.filter((t) => !(t.chairDetections || []).length).map((t) => t.id);
      if (bare.length) seatSentences.push(S("read.seats.bare", { n: bare.length }, bare, "unsure"));
    }
    const banq = ofType("banquette");
    if (banq.length) seatSentences.push(S("read.seats.banquettes", { n: banq.length, pos: posOf(bboxOf(banq)) }, banq.map((b) => b.id), "unsure"));
    if (locas.length) {
      const labelled = texts.filter((t) => t.category === "loca").length;
      seatSentences.push(S("read.seats.locas", { n: locas.length, pos: posOf(bboxOf(locas)), labels: labelled }, locas.map((l) => l.id), labelled ? "stated" : "seen", texts.filter((t) => t.category === "loca").map((t) => t.box).slice(0, 30)));
    }
    section("seats", seatSentences);

    // ---- the room: columns and what they hide, bar, entrances, service, technical
    const roomSentences = [];
    const columns = ofType("column");
    if (columns.length) {
      const onWall = columns.filter((c) => c.typeBasis === "wallFamily" || c.x < 4 || c.y < 4 || c.x + c.w > 96 || c.y + c.h > 96).length;
      roomSentences.push(S(onWall === columns.length ? "read.room.columnsWall" : "read.room.columns", { n: columns.length, wall: onWall }, columns.map((c) => c.id), "seen"));
      if (stageRect) {
        const blocked = new Map();
        for (const t of tables) {
          const p = mid(P(t)), q = nearestPoint(p, stageRect);
          for (const col of columns) {
            const r = P(col);
            if (gap(P(t), r) < 0.25 * tableSide) continue; // touching its own table: not between it and the stage
            if (segmentHitsRect(p, q, r)) { if (!blocked.has(col.id)) blocked.set(col.id, []); blocked.get(col.id).push(t.id); }
          }
        }
        const tablesBlocked = [...new Set([...blocked.values()].flat())];
        roomSentences.push(tablesBlocked.length
          ? S("read.room.sightline", { columns: blocked.size, tables: tablesBlocked.length }, [...blocked.keys(), ...tablesBlocked], "inferred")
          : S("read.room.sightlineClear", { n: tables.length }, [], "inferred"));
      }
    }
    const bars = ofType("bar");
    const barText = texts.filter((t) => t.category === "bar");
    if (bars.length || barText.length) roomSentences.push(S("read.room.bar", { n: Math.max(bars.length, barText.length), pos: posOf(bboxOf(bars.length ? bars : barText.map((t) => t.box))) }, bars.map((b) => b.id), barText.length ? "stated" : "seen", barText.map((t) => t.box)));
    const doors = venues.filter((c) => c.type === "entrance" || c.type === "exit"), doorText = texts.filter((t) => t.category === "entrance");
    if (doors.length || doorText.length) roomSentences.push(S("read.room.entrances", { n: Math.max(doors.length, doorText.length), where: [...new Set((doors.length ? doors : doorText.map((t) => t.box)).map(posOf))] }, doors.map((d) => d.id), doorText.length ? "stated" : "seen", doorText.map((t) => t.box)));
    for (const k of ["service", "technical", "facility", "vip"]) {
      const list = texts.filter((t) => t.category === k);
      if (list.length) roomSentences.push(S("read.room." + k, { n: list.length, where: [...new Set(list.map((t) => posOf(t.box)))], words: [...new Set(list.map((t) => t.text))].slice(0, 4) }, [], "stated", list.map((t) => t.box)));
    }
    const dims = texts.filter((t) => t.category === "dimension");
    if (dims.length) roomSentences.push(S("read.room.dimensions", { n: dims.length, words: dims.map((t) => t.text).slice(0, 6) }, [], "stated", dims.map((t) => t.box)));
    section("room", roomSentences);

    // ---- what it is not sure of — each with the objects to look at
    const unsure = [];
    const held = all.filter((c) => c.status !== "rejected" && c.status !== "confirmed" && c.selected === false);
    if (held.length) unsure.push(S("read.unsure.held", { n: held.length }, held.map((c) => c.id), "unsure"));
    const contra = pi.contradictions || [];
    if (contra.length) unsure.push(S("read.unsure.contradictions", { n: contra.length }, [], "unsure"));
    const others = texts.filter((t) => t.category === "other");
    if (others.length) unsure.push(S("read.unsure.texts", { n: others.length }, [], "unsure", others.map((t) => t.box)));
    if (!texts.length) unsure.push(S(a.ocrModel && a.ocrModel.available === false ? "read.unsure.noTextEngine" : "read.unsure.noText", {}, [], "unsure"));
    section("unsure", unsure);

    // ---- parts of the room, each read on its own
    const zones = (pi.zones || []).filter((z) => (z.memberIds || []).length && z.bbox);
    let regions = zones.map((z) => ({ id: z.id, kind: z.type, box: z.bbox, refs: z.memberIds.filter((id) => byId.has(id)) }));
    if (regions.filter((r) => r.kind !== "unknown").length < 2 && tables.length >= 6) {
      // One undivided room: read it in thirds so "part by part" still means something.
      regions = ["left", "centre", "right"].map((k, i) => {
        const members = live.filter((c) => { const cx = center(c).x; return cx >= i * 100 / 3 && cx < (i + 1) * 100 / 3; });
        return { id: "third-" + k, kind: "third-" + k, box: bboxOf(members) || { x: i * 100 / 3, y: 0, w: 100 / 3, h: 100 }, refs: members.map((c) => c.id) };
      }).filter((r) => r.refs.length);
    }
    for (const r of regions) {
      const rt = r.refs.map((id) => byId.get(id)).filter((c) => c && c.kind === "table");
      const seats = rt.reduce((k, t) => k + (t.chairDetections || []).length, 0);
      const inGroups = groups.filter((g) => g.memberIds.some((id) => r.refs.includes(id))).length;
      const near = stageRect && r.box ? gap(px(r.box, W, H), stageRect) <= 2.5 * tableSide : false;
      r.sentences = [S(seats ? "read.region.summary" : "read.region.summaryNoSeats", { tables: rt.length, seats: seats || null, merged: inGroups, pos: posOf(r.box) }, r.refs, "seen"),
        near && r.kind !== "stage" ? S("read.region.nearStage", {}, r.refs, "inferred") : null].filter(Boolean);
    }

    // ---- the first lines a person would say
    const headline = [
      event && (event.title || event.venue) ? S("read.headline.event", { line: [event.title, event.date, event.venue].filter(Boolean).join(" · ") }, [], "stated", event.boxes) : null,
      tables.length ? S(symbolic ? (stated != null ? "read.headline.symbolic" : "read.headline.symbolicNoStated") : (stated != null ? "read.headline.physical" : "read.headline.physicalNoStated"), { tables: tables.length, merged: groups.length, seats: sum.physicalSeats ?? null, stated: stated ?? null }, [], symbolic ? "seen" : "inferred") : null,
      stages.length ? S("read.headline.stage", { pos: posOf(stages[0]) }, [stages[0].id], "seen") : null,
    ].filter(Boolean);

    return { version: 1, headline, sections, regions, texts, counts: { tables: tables.length, groups: groups.length, texts: texts.length, sentences: n } };
  }

  globalThis.MeritPlanReading = Object.freeze({ read, textsOf, categoryOf, posOf, segmentHitsRect, POS });
})();
