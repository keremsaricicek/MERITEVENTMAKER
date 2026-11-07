// MERIT Event Maker — the plan reading on the review screen (MeritScreenReading).
//
// What src/plan-reading.js says about a plan, shown the way a person would
// read it out: a few first lines, then the event, what is on the plan, the
// capacity, the stage, the tables, the seats, the room and what it is not sure
// of — each line marked with how it is known, and each one a control that puts
// its objects (or the printed words it came from) under a finger on the plan.
// Part by part: a region of the room is read on its own. And the same
// understanding drawn clean — the DIGITAL view redraws the plan from what was
// understood, over or instead of the scan.
//
// It writes nothing: no decision, no candidate, no stored field. Everything it
// shows is derived on every render, so a person's decision in the review
// changes the reading at once.
//
// Everything this reads from the shell is handed to it by create(deps), once.
(function () {
  "use strict";

  let activeEvent;
  let applyReviewZoom;
  let esc;
  let render;
  let t;
  let ui;
  let created = false;

  const R = () => globalThis.MeritPlanReading;
  const VIEWS = ["original", "digital", "both"];
  const SECTIONS = ["event", "overview", "capacity", "stage", "tables", "seats", "room", "unsure", "second"];

  // One reading per analysis state: recomputed when a decision changes what is
  // on the plan, not on every render.
  const cache = { key: null, value: null };
  function readingFor(event) {
    const a = event && event.analysis;
    if (!a || !R()) return null;
    const sig = a.id + "|" + a.candidates.length + "|" + a.candidates.map((c) => (c.status || "")[0] + (c.selected === false ? "h" : "") + (c.type || "")).join("") + "|" + ((a.planIntelligence && a.planIntelligence.furnitureGroups) || []).length;
    if (cache.key === sig) return cache.value;
    const P = globalThis.MeritPdfText;
    const texts = P && event.background && event.background.pdfSource ? P.scaledItems(event.background.pdfSource, a.imageWidth, a.imageHeight) : [];
    cache.key = sig;
    cache.value = R().read(a, { texts });
    return cache.value;
  }

  // ---- words ---------------------------------------------------------------------
  const typeWord = (type, n) => {
    const pl = n !== 1 ? t("read.typePl." + type) : null;
    if (pl && pl !== "read.typePl." + type) return pl;
    const w = t("read.type." + type);
    return w === "read.type." + type ? String(type) : w;
  };
  const posWord = (p) => t("read.pos." + p);
  function words(s) {
    const p = { ...s.params };
    if (Array.isArray(p.types)) p.types = p.types.map((x) => `${x.n} ${typeWord(x.type, x.n)}`).join(", ");
    if (Array.isArray(p.sizes)) p.sizes = p.sizes.map((x) => t("read.sizeItem", { n: x.n, size: x.size })).join(", ");
    if (Array.isArray(p.where)) p.where = p.where.map(posWord).join(", ");
    if (Array.isArray(p.words)) p.words = p.words.map((w) => `“${w}”`).join(", ");
    if (p.pos) p.pos = posWord(p.pos);
    if (p.type) p.type = typeWord(p.type, 1);
    return t(s.key, p);
  }

  // ---- what is under the finger ------------------------------------------------------
  function allSentences(reading) {
    return [...reading.headline, ...reading.sections.flatMap((s) => s.sentences), ...reading.regions.flatMap((r) => r.sentences || [])];
  }
  function focusOf(event) {
    const reading = ui.readingOpen ? readingFor(event) : null;
    if (!reading || !ui.readingFocus) return null;
    if (ui.readingFocus.startsWith("txt-")) {
      const tx = reading.texts.find((x) => x.id === ui.readingFocus);
      return tx ? { refs: tx.refs || [], boxes: [tx.box] } : null;
    }
    if (ui.readingFocus.startsWith("region:")) {
      const r = reading.regions.find((x) => "region:" + x.id === ui.readingFocus);
      return r ? { refs: r.refs, boxes: [], region: r.box } : null;
    }
    const s = allSentences(reading).find((x) => x.id === ui.readingFocus);
    return s ? { refs: s.refs, boxes: s.boxes } : null;
  }
  // undefined: the reading has no say (the review screen's own focus stands);
  // null: show the whole plan; a box: zoom to it.
  function focusBox(event) {
    if (!ui.readingOpen || !ui.readingFocus) return undefined;
    const f = focusOf(event);
    if (!f) return undefined;
    const a = event.analysis, byId = new Map(a.candidates.map((c) => [c.id, c]));
    const boxes = [...f.refs.map((id) => byId.get(id)).filter(Boolean), ...f.boxes, ...(f.region ? [f.region] : [])];
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
    // The whole plan is not a place to zoom to.
    if (x1 - x0 > 85 && y1 - y0 > 85) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---- the header control ------------------------------------------------------------
  function toolbarHTML(event) {
    if (!event || !event.analysis || !R()) return "";
    return `<button class="btn" data-read-action="toggle" aria-expanded="${ui.readingOpen ? "true" : "false"}" aria-controls="readPanel">${t("read.open")}</button>`;
  }

  // ---- the panel -------------------------------------------------------------------------
  function lineHTML(s) {
    const on = ui.readingFocus === s.id;
    const where = s.refs.length || s.boxes.length;
    return `<li><button type="button" class="read-line cert-${esc(s.certainty)}${on ? " on" : ""}" data-read-action="focus" data-read-id="${esc(s.id)}" aria-pressed="${on ? "true" : "false"}"${where ? "" : " data-read-nowhere=\"1\""}>`
      + `<span class="read-cert">${esc(t("read.cert." + s.certainty))}</span><span class="read-say">${esc(words(s))}</span></button></li>`;
  }
  function panelHTML(event) {
    if (!ui.readingOpen) return "";
    const reading = readingFor(event);
    if (!reading) return "";
    const region = ui.readingRegion ? reading.regions.find((r) => r.id === ui.readingRegion) : null;
    const inRegion = (s) => !region || s.refs.some((id) => region.refs.includes(id));
    const view = VIEWS.includes(ui.planView) ? ui.planView : "original";
    const regionName = (r, i, list) => {
      const k = t("read.region.kind." + r.kind), name = k === "read.region.kind." + r.kind ? r.kind : k;
      const same = list.filter((x) => x.kind === r.kind);
      return same.length > 1 ? `${name} ${same.indexOf(r) + 1}` : name;
    };
    const regionsNav = reading.regions.length > 1
      ? `<nav class="read-regions" aria-label="${esc(t("read.regionsLabel"))}"><button type="button" class="chip${region ? "" : " on"}" data-read-action="region" data-read-region="" aria-pressed="${region ? "false" : "true"}">${t("read.whole")}</button>`
        + reading.regions.map((r, i, list) => `<button type="button" class="chip${region === r ? " on" : ""}" data-read-action="region" data-read-region="${esc(r.id)}" aria-pressed="${region === r ? "true" : "false"}">${esc(regionName(r, i, list))}</button>`).join("") + `</nav>`
      : "";
    const head = region ? `<ul class="read-lines read-headline">${(region.sentences || []).map(lineHTML).join("")}</ul>`
      : `<ul class="read-lines read-headline">${reading.headline.map(lineHTML).join("")}</ul>`;
    const sections = SECTIONS.map((id) => reading.sections.find((s) => s.id === id)).filter(Boolean).map((sec) => {
      const lines = sec.sentences.filter(inRegion);
      return lines.length ? `<section class="read-section"><h3>${t("read.section." + sec.id)}</h3><ul class="read-lines">${lines.map(lineHTML).join("")}</ul></section>` : "";
    }).join("");
    const shown = reading.texts.filter((x) => x.category !== "number");
    const numbers = reading.texts.length - shown.length;
    const texts = reading.texts.length ? `<details class="read-texts"${ui.readingTextsOpen ? " open" : ""}><summary data-read-action="texts">${t("read.textsTitle", { n: reading.texts.length })}</summary><ul class="read-lines">`
      + shown.map((x) => `<li><button type="button" class="read-line read-word${ui.readingFocus === x.id ? " on" : ""}" data-read-action="focus" data-read-id="${esc(x.id)}" aria-pressed="${ui.readingFocus === x.id ? "true" : "false"}"><q>${esc(x.text)}</q><span class="read-cat">${esc(t("read.cat." + x.category))}</span><span class="read-used">${esc(t(x.used.key, x.used.params.type ? { type: typeWord(x.used.params.type, 1) } : x.used.params))}</span></button></li>`).join("")
      + (numbers ? `<li class="read-note">${esc(t("read.numbersFolded", { n: numbers }))}</li>` : "") + `</ul></details>` : "";
    const legend = `<p class="read-legend"><span class="read-legend-title">${t("read.legend")}</span>${["confirmed", "remembered", "stated", "seen", "inferred", "unsure"].map((c) => `<span class="read-cert cert-${c}">${t("read.cert." + c)}</span>`).join("")}</p>`;
    return `<aside class="read-panel" id="readPanel" aria-label="${esc(t("read.title"))}"><div class="read-head"><strong>${t("read.title")}</strong>`
      + `<div class="read-view" role="group" aria-label="${esc(t("read.view.label"))}">${VIEWS.map((v) => `<button type="button" class="chip${view === v ? " on" : ""}" data-read-action="view" data-read-view="${v}" aria-pressed="${view === v ? "true" : "false"}">${t("read.view." + v)}</button>`).join("")}</div>`
      + `<button type="button" class="btn icon-only sm" data-read-action="close" aria-label="${esc(t("read.close"))}" title="${esc(t("read.close"))}">×</button></div>`
      + `<div class="read-body"><p class="read-intro">${t("read.intro")}</p>${head}${regionsNav}${sections}${texts}${legend}</div></aside>`;
  }

  // ---- on the plan: the focus, and the digital redraw ------------------------------------------
  const r1 = (v) => Math.round(v * 10) / 10;
  function digitalSVG(event) {
    const a = event.analysis, W = a.imageWidth || 100, H = a.imageHeight || 100;
    const X = (v) => r1(v / 100 * W), Y = (v) => r1(v / 100 * H);
    const live = a.candidates.filter((c) => c.status !== "rejected");
    const out = [`<rect class="dg-paper" x="0" y="0" width="${W}" height="${H}"/>`];
    const rot = (c) => (c.rotation ? ` transform="rotate(${r1(c.rotation)} ${X(c.x + c.w / 2)} ${Y(c.y + c.h / 2)})"` : "");
    // Lettering is sized to the plan, not to the object: a stage the width of
    // a third of the room does not get letters a hundred pixels tall.
    const cap = Math.max(11, Math.min(26, Math.max(W, H) / 55));
    // A word longer than a number turns to run along a tall, narrow block
    // instead of spilling across the tables beside it.
    const label = (c, text, cls) => {
      const wPx = c.w / 100 * W, hPx = c.h / 100 * H, size = (along, across) => Math.min(cap, along / Math.max(3, text.length) * 1.5, across * 0.5);
      const turn = text.length > 3 && size(hPx, wPx) > size(wPx, hPx) * 1.3, cx = X(c.x + c.w / 2), cy = Y(c.y + c.h / 2);
      return `<text class="${cls}" x="${cx}" y="${cy}" font-size="${r1(Math.max(8, turn ? size(hPx, wPx) : size(wPx, hPx)))}"${turn ? ` transform="rotate(-90 ${cx} ${cy})"` : ""}>${esc(text)}</text>`;
    };
    const order = { venue: 0, table: 1 };
    for (const c of live.slice().sort((x, y) => (order[x.kind] ?? 2) - (order[y.kind] ?? 2))) {
      const held = c.selected === false && c.status !== "confirmed" ? " dg-held" : "";
      if (c.kind === "venue") {
        const cls = ["stage", "column", "banquette", "bar", "loca", "entrance", "exit", "chair"].includes(c.type) ? c.type : "other";
        out.push(`<rect class="dg-${cls}${held}" x="${X(c.x)}" y="${Y(c.y)}" width="${X(c.w)}" height="${Y(c.h)}" rx="${cls === "banquette" || cls === "loca" ? r1(Math.min(X(c.w), Y(c.h)) / 3) : 0}"${rot(c)}/>`);
        // Named, as the Floor Plan names them: a pale block alone does not say column.
        if (["stage", "bar", "loca", "entrance", "exit", "column", "banquette"].includes(cls) && Math.max(c.w, c.h) > 3) out.push(label(c, typeWord(cls, 1).toLocaleUpperCase(ui.lang === "tr" ? "tr" : "en"), "dg-label"));
        continue;
      }
      if (c.kind !== "table") continue;
      // A chair detection's x/y is its CENTRE, not its corner (MeritPlanFrames):
      // drawn from the corner, every chair sat half its own size off the scan.
      for (const ch of c.chairDetections || []) out.push(`<rect class="dg-chair" x="${X(ch.x - ch.w / 2)}" y="${Y(ch.y - ch.h / 2)}" width="${X(ch.w)}" height="${Y(ch.h)}" rx="${r1(Math.min(X(ch.w), Y(ch.h)) / 4)}"${ch.rotation ? ` transform="rotate(${r1(ch.rotation)} ${X(ch.x)} ${Y(ch.y)})"` : ""}/>`);
      out.push(c.type === "round"
        ? `<ellipse class="dg-table${held}" cx="${X(c.x + c.w / 2)}" cy="${Y(c.y + c.h / 2)}" rx="${X(c.w / 2)}" ry="${Y(c.h / 2)}"/>`
        : `<rect class="dg-table${held}" x="${X(c.x)}" y="${Y(c.y)}" width="${X(c.w)}" height="${Y(c.h)}" rx="${r1(Math.min(X(c.w), Y(c.h)) / 10)}"${rot(c)}/>`);
      const pn = c.printedNumber;
      if (pn && pn.state === "VERIFIED" && pn.value != null) out.push(label(c, String(pn.value), "dg-number"));
    }
    // Tables pushed together are drawn as the one table they are used as.
    const byId = new Map(a.candidates.map((c) => [c.id, c]));
    for (const g of ((a.planIntelligence && a.planIntelligence.furnitureGroups) || [])) {
      const m = (g.memberIds || []).map((id) => byId.get(id)).filter((c) => c && c.status !== "rejected");
      if (m.length < 2) continue;
      const x0 = Math.min(...m.map((c) => c.x)), y0 = Math.min(...m.map((c) => c.y)), x1 = Math.max(...m.map((c) => c.x + c.w)), y1 = Math.max(...m.map((c) => c.y + c.h));
      const seats = m.reduce((k, c) => k + (c.chairDetections || []).length, 0);
      out.push(`<rect class="dg-group" x="${X(x0)}" y="${Y(y0)}" width="${X(x1 - x0)}" height="${Y(y1 - y0)}"/>`);
      if (seats) {
        // Worded, not a bare figure (a lone "8" beside a table reads as its
        // number), and set on the joined table itself, below any number read
        // on it, rather than out over the chairs of the table next door.
        const word = t("read.digital.seats", { n: seats }), numbered = m.some((c) => c.printedNumber && c.printedNumber.state === "VERIFIED");
        // A long, narrow joined table carries it along its length, as a label does.
        const gw = X(x1 - x0), gh = Y(y1 - y0), turn = gh > gw * 1.6, along = turn ? gh : gw, across = turn ? gw : gh;
        const fs = r1(Math.max(8, Math.min(cap * 0.5, along * 0.9 / (word.length * 0.58 + 0.9), across * 0.3)));
        const bx = X((x0 + x1) / 2) + (numbered && turn ? fs * 1.3 : 0), by = r1(Y((y0 + y1) / 2) + (numbered && !turn ? fs * 1.3 : 0)), bw = r1(fs * (word.length * 0.58 + 0.9));
        out.push(`<g class="dg-seats"${turn ? ` transform="rotate(-90 ${r1(bx)} ${by})"` : ""}><rect class="dg-badge-bg" x="${r1(bx - bw / 2)}" y="${r1(by - fs * 0.75)}" width="${bw}" height="${r1(fs * 1.5)}" rx="${r1(fs * 0.75)}"/><text class="dg-badge" x="${r1(bx)}" y="${by}" font-size="${fs}">${esc(word)}</text></g>`);
      }
    }
    // What was understood but is not an object: places the sheet only writes
    // (a service point, the technical desk), its title and its capacity line,
    // set where the words were — and a block that may be the stage, asked as such.
    const reading = readingFor(event);
    if (reading) {
      const maybe = reading.sections.flatMap((x) => x.sentences).find((x) => x.key === "read.stage.maybe");
      for (const id of (maybe ? maybe.refs : [])) {
        const c = byId.get(id);
        if (c) { out.push(`<rect class="dg-stage dg-held" x="${X(c.x)}" y="${Y(c.y)}" width="${X(c.w)}" height="${Y(c.h)}"/>`); out.push(label(c, typeWord("stage", 1).toLocaleUpperCase(ui.lang === "tr" ? "tr" : "en") + " ?", "dg-label")); }
      }
      const tag = (tx, text, cls) => {
        const fs = r1(Math.min(cap * 0.8, Math.max(10, Y(tx.box.h) * 0.8))), w = r1(Math.max(X(tx.box.w), text.length * fs * 0.62 + fs));
        const cx = X(tx.box.x + tx.box.w / 2), cy = Y(tx.box.y + tx.box.h / 2);
        return `<g class="${cls}"><rect x="${r1(cx - w / 2)}" y="${r1(cy - fs * 0.85)}" width="${w}" height="${r1(fs * 1.7)}" rx="${r1(fs * 0.4)}"/><text x="${cx}" y="${cy}" font-size="${fs}">${esc(text)}</text></g>`;
      };
      for (const tx of reading.texts) {
        if (["service", "technical", "facility", "vip"].includes(tx.category) || (["entrance", "bar"].includes(tx.category) && !tx.refs.length && tx.used.key === "read.used.placeOnly")) out.push(tag(tx, tx.text, "dg-place dg-" + tx.category));
        else if (tx.category === "title" || tx.category === "venueName") out.push(tag(tx, tx.text.replace(/(\D)(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/, "$1 $2"), "dg-title"));
        else if (tx.category === "capacity" || tx.category === "capacityLabel") out.push(tag(tx, tx.text.replace(/^[:：\s]+/, ""), "dg-capacity"));
      }
    }
    return `<svg class="digital-plan" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${out.join("")}</svg>`;
  }
  function mapHTML(event) {
    const a = event && event.analysis;
    if (!a || !R()) return "";
    const view = VIEWS.includes(ui.planView) ? ui.planView : "original";
    const parts = [];
    if (view !== "original") parts.push(digitalSVG(event));
    const f = ui.readingOpen ? focusOf(event) : null;
    if (f) {
      const byId = new Map(a.candidates.map((c) => [c.id, c]));
      for (const id of f.refs.slice(0, 400)) {
        const c = byId.get(id);
        if (c) parts.push(`<i class="read-mark" style="left:${r1(c.x - 0.4)}%;top:${r1(c.y - 0.4)}%;width:${r1(c.w + 0.8)}%;height:${r1(c.h + 0.8)}%"></i>`);
      }
      for (const b of f.boxes.slice(0, 60)) parts.push(`<i class="read-mark word" style="left:${r1(b.x - 0.3)}%;top:${r1(b.y - 0.3)}%;width:${r1(b.w + 0.6)}%;height:${r1(b.h + 0.6)}%"></i>`);
      if (f.region) parts.push(`<i class="read-mark region" style="left:${r1(f.region.x)}%;top:${r1(f.region.y)}%;width:${r1(f.region.w)}%;height:${r1(f.region.h)}%"></i>`);
    }
    return parts.join("");
  }
  const viewClass = () => "view-" + (VIEWS.includes(ui.planView) ? ui.planView : "original");

  // ---- actions -----------------------------------------------------------------------------
  function onAction(action, el) {
    const event = activeEvent();
    if (action === "toggle") {
      ui.readingOpen = !ui.readingOpen;
      if (ui.readingOpen) { ui.vlmPanelOpen = false; ui.activeReviewGroupId = null; ui.activeQuestionId = null; ui.reviewQueue = null; }
      else { ui.readingFocus = null; ui.readingRegion = null; }
      render(); return;
    }
    if (action === "close") { ui.readingOpen = false; ui.readingFocus = null; ui.readingRegion = null; render(); return; }
    if (action === "view") { ui.planView = VIEWS.includes(el.dataset.readView) ? el.dataset.readView : "original"; render(); return; }
    if (action === "texts") { ui.readingTextsOpen = !ui.readingTextsOpen; return; }
    if (action === "region") { ui.readingRegion = el.dataset.readRegion || null; ui.readingFocus = ui.readingRegion ? "region:" + ui.readingRegion : null; }
    else if (action === "focus") { const id = el.dataset.readId; ui.readingFocus = ui.readingFocus === id ? null : id; }
    else return;
    render();
    globalThis.requestAnimationFrame(() => {
      applyReviewZoom(focusBox(event));
      const back = document.querySelector(`[data-read-id="${ui.readingFocus}"]`) || document.querySelector(`[data-read-region="${ui.readingRegion || ""}"]`);
      if (back) back.focus({ preventScroll: true });
    });
  }

  function create(deps){
    if(created)throw new Error("MeritScreenReading.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    applyReviewZoom=deps.applyReviewZoom;
    esc=deps.esc;
    render=deps.render;
    t=deps.t;
    ui=deps.ui;
    return{focusBox,mapHTML,onAction,panelHTML,readingFor,toolbarHTML,viewClass};
  }
  globalThis.MeritScreenReading=Object.freeze({create,DEPS:Object.freeze(["activeEvent","applyReviewZoom","esc","render","t","ui"])});
})();
