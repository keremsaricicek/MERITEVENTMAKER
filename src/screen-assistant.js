// MERIT Event Maker — the F8 assistant panel (MeritScreenAssistant).
//
// A small panel on the right (benchmarks/AI-PLANNER-DESIGN.md §11–§12): F8
// opens and closes it, Escape closes it, the plan stays visible beside it. A
// question is answered from the data (src/assistant-parse.js answer() over
// src/assistant-tools.js); a command is carried out at once through the app's
// own writers (src/assistant-actions.js) — no confirmation, because the
// command IS the person's decision — and every command is ONE undo, offered
// right under what it changed. Anything ambiguous comes back as a question and
// changes nothing.
//
// The panel lives in its own <aside>, outside #app, so a render() of the screen
// never wipes the conversation or the text being typed. Across its working
// moments a thin strip under its title bar carries the app's colours back and
// forth (the owner's design, 2026-10-27); it is still under reduced motion.
//
// REDESIGN v4 (SPEC-v4, owner 2026-11-07): it is presented as "Mimar", a
// bottom-right chat box (title bar · – · ×, bubbles, a field, a disabled
// "yakında" microphone, Gönder), and a command is SHOWN first — its sentence and
// the table it names highlighted on the plan — then "Uygula", then "Geri al".
// Door check-ins the rules read stay immediate (a plain statement at the door).
// The reading, resolving and acting code is unchanged.
//
// SECOND READER (2026-11-12, src/assistant-second-reader.js): the order q08 was
// raced with (hybrid, θ 0.91); a reading the pinned local chat model made is
// always a proposal (Uygula, then Geri al). With no relay or
// model, the answer and the head say so ("yalnız kurallar").
//
// Everything this reads from the shell is handed to it by create(deps), once.
(function () {
  "use strict";
  const P = () => globalThis.MeritAssistantParse;
  const R = () => globalThis.MeritAssistantReading;

  let canMutate;
  let currentId;
  let events;
  let go;
  let highlight;
  let onChange;
  let readText;
  let readerState;
  let research;
  let summary;
  let t;
  let today;
  let voice;
  let writers;
  let created = false;

  function create(deps) {
    if (created) throw new Error("MeritScreenAssistant.create() is called once, by app-v8.js.");
    created = true;
    // src/assistant-second-reader.js loads after this file (just before app-v8.js): read it at call time only
    const SR = () => globalThis.MeritAssistantSecondReader;
    canMutate=deps.canMutate;
    currentId=deps.currentId;
    events=deps.events;
    go=deps.go;
    highlight=deps.highlight;
    onChange=deps.onChange;
    readText=deps.readText;
    readerState=deps.readerState;
    research=deps.research;
    summary=deps.summary;
    t=deps.t;
    today=deps.today;
    voice=deps.voice;
    writers=deps.writers;
    let root = null, log = null, input = null, status = null, strip = null;
    const turns = [];   // {who:"you"|"assistant", text, lines?, undo?}
    // the head's resting words: "Hazır", or "Hazır · yalnız kurallar" while the
    // second reader is missing (src/assistant-second-reader.js)
    let restWords = null;
    const rest = () => restWords || t("assistant.ready");
    function readerIs(o) {
      restWords = o && o.state === "missing" ? t("assistant.readyRules") : null;
      if (root && !root.classList.contains("is-working")) status.textContent = rest();
    }

    function el(tag, attrs, text) {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      return n;
    }
    function mount() {
      if (root) return root;
      root = el("aside", { class: "assistant-panel theme-scope", id: "assistantPanel", "aria-label": t("assistant.title"), hidden: "" });
      strip = el("div", { class: "assistant-strip", "aria-hidden": "true" });
      const head = el("div", { class: "assistant-head" });
      head.append(el("h2", { class: "assistant-title" }, t("assistant.title")), el("kbd", { class: "assistant-key" }, "F8"));
      status = el("span", { class: "assistant-status", role: "status" }, t("assistant.ready"));
      const min = el("button", { class: "assistant-min", type: "button", "aria-label": t("assistant.minimise"), title: t("assistant.minimise") }, "–");
      min.addEventListener("click", (e) => { e.stopPropagation(); root.classList.toggle("is-min"); });
      const close = el("button", { class: "assistant-close", type: "button", "aria-label": t("assistant.close") }, "×");
      close.addEventListener("click", (e) => { e.stopPropagation(); toggle(false); });
      head.append(status, min, close);
      // a minimised box comes back from its title bar, like a classic chat
      head.addEventListener("click", () => { if (root.classList.contains("is-min")) { root.classList.remove("is-min"); input.focus(); } });
      log = el("div", { class: "assistant-log", "aria-live": "polite" });
      const form = el("form", { class: "assistant-form" });
      const label = el("label", { class: "sr-only", for: "assistantInput" }, t("assistant.inputLabel"));
      input = el("input", { id: "assistantInput", class: "assistant-input", autocomplete: "off", placeholder: t("assistant.placeholder") });
      const send = el("button", { class: "btn primary assistant-send", type: "submit" }, t("assistant.send"));
      // Voice is a later stage: the microphone is shown, disabled, and says so.
      const mic = el("button", { class: "assistant-mic", type: "button", disabled: "", title: t("assistant.micSoon"), "aria-label": t("assistant.micSoon") });
      const NS = "http://www.w3.org/2000/svg", icon = document.createElementNS(NS, "svg");
      for (const [k, v] of [["width", "16"], ["height", "16"], ["viewBox", "0 0 16 16"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.4"], ["stroke-linecap", "round"], ["aria-hidden", "true"]]) icon.setAttribute(k, v);
      const body = document.createElementNS(NS, "rect"); for (const [k, v] of [["x", "5.5"], ["y", "1.8"], ["width", "5"], ["height", "8"], ["rx", "2.5"]]) body.setAttribute(k, v);
      const stand = document.createElementNS(NS, "path"); stand.setAttribute("d", "M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.2");
      icon.append(body, stand); mic.append(icon);
      // VOICE (src/voice-input.js): only when the relay reports a voice engine on
      // this machine; otherwise the button stays disabled, "yakında". Words go INTO
      // THE BOX; the person reads them and presses Gönder — nothing is sent by voice.
      if (voice) Promise.resolve(voice.available()).then((on) => { if (!on) return; mic.disabled = false; mic.classList.add("is-live"); mic.title = t("assistant.micOn"); mic.setAttribute("aria-label", t("assistant.micOn")); soon.textContent = t("assistant.micSay"); }).catch((error) => console.warn("The voice engine could not be asked about.", error && error.name));
      let rec = null;
      mic.addEventListener("click", async () => {
        if (mic.disabled || !voice) return;
        if (!rec) {
          rec = voice.createRecorder();
          try { await rec.start(); } catch (error) { rec = null; status.textContent = t("assistant.micRefused"); console.warn("The microphone was refused.", error && error.name); return; }
          mic.classList.add("is-recording"); soon.textContent = t("assistant.micStop"); status.textContent = t("assistant.micListening");
          return;
        }
        const r = rec; rec = null; mic.classList.remove("is-recording"); soon.textContent = t("assistant.micSay");
        working(true, t("assistant.micReading"));
        let out;
        try { out = await r.stop(); } catch (error) { out = { ok: false, code: (error && error.name) || "ERROR" }; }
        working(false);
        if (out && out.ok && out.text) { input.value = out.text; input.focus(); status.textContent = t("assistant.micHeard"); }
        else status.textContent = t("assistant.micFailed", { code: (out && out.code) || "?" });
      });
      const soon = el("span", { class: "assistant-mic-soon" }, t("assistant.soon"));
      mic.append(soon);
      form.append(label, input, mic, send);
      form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { input.value = ""; ask(v); } });
      root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); toggle(false); } });
      root.append(head, strip, log, form);
      document.body.appendChild(root);
      return root;
    }
    function isOpen() { return !!root && !root.hidden; }
    // The first time the window opens, Mimar greets with three example
    // sentences as chips (the prototypes' greeting). A chip only ASKS: it goes
    // through the same data-assistant-ask path as any other button, so the
    // answer — or the action shown first, with Uygula — is the usual one.
    function greet() {
      if (!log || log.childElementCount) return;
      const box = el("div", { class: "assistant-turn assistant assistant-greet" });
      box.appendChild(el("p", {}, t("assistant.greet")));
      const chips = el("div", { class: "assistant-chips" });
      for (const k of ["assistant.chip.missing", "assistant.chip.where", "assistant.chip.seat"]) {
        const s = t(k);
        chips.appendChild(el("button", { type: "button", class: "assistant-chip", "data-assistant-ask": s }, s));
      }
      box.appendChild(chips);
      log.appendChild(box);
    }
    function toggle(open) {
      mount();
      const want = open == null ? root.hidden : open;
      root.hidden = !want;
      document.body.classList.toggle("assistant-open", want);
      if (want) { root.classList.remove("is-min"); greet(); setTimeout(() => input.focus(), 0); }
      // on every opening: is the local model there to read? (the relay asks the running process)
      if (want && readerState) Promise.resolve(readerState()).then(readerIs).catch((error) => console.warn("The second reader's state could not be read.", error && error.name));
      document.querySelectorAll("[data-shell-assistant]").forEach((b) => b.setAttribute("aria-expanded", String(want)));
    }
    function working(on, text) {
      root.classList.toggle("is-working", on);
      status.textContent = text || (on ? t("assistant.working") : rest());
    }
    function draw() {
      log.textContent = "";
      for (const turn of turns) {
        const b = el("div", { class: `assistant-turn ${turn.who}` });
        b.append(el("p", {}, turn.text));
        if (turn.byModel) b.append(el("p", { class: "assistant-by-model" }, t("assistant.readByModel")));
        if (turn.missing) b.append(el("p", { class: "assistant-by-model assistant-model-missing" }, t(turn.missing.key, turn.missing.params)));
        if (turn.lines && turn.lines.length) { const ul = el("ul", { class: "assistant-lines" }); for (const l of turn.lines) ul.append(el("li", {}, l)); b.append(ul); }
        for (const opt of turn.options || []) b.append(optionCard(turn, opt));
        if (turn.undo && !turn.undone) {
          const u = el("button", { class: "btn assistant-undo", type: "button" }, t("assistant.undo"));
          u.addEventListener("click", () => { undo(turn); });
          b.append(u);
        }
        if (turn.undone) b.append(el("p", { class: "assistant-undone" }, t("assistant.undone")));
        if (turn.go && go) { const g = el("button", { class: "btn assistant-go", type: "button" }, t("assistant.go")); g.addEventListener("click", () => go(turn.go)); b.append(g); }
        if (turn.topics) { const ul = el("ul", { class: "assistant-topics" }); for (const tp of turn.topics) { const li = el("li", {}); const a = el("button", { class: "btn quiet assistant-topic", type: "button" }, tp.title[lang()]); a.addEventListener("click", () => { turns.push(Object.assign({ who: "assistant" }, helpReply(tp))); draw(); }); li.append(a); ul.append(li); } b.append(ul); }
        if (turn.research && !turn.searched) {
          const go = el("button", { class: "btn primary assistant-search", type: "button" }, t("assistant.webGo"));
          go.addEventListener("click", () => search(turn));
          b.append(go);
        }
        if (turn.results) { const ul = el("ul", { class: "assistant-web" }); for (const x of turn.results) { const li = el("li", {}); li.append(el("b", {}, x.title || ""), el("span", { class: "assistant-web-url" }, x.url || ""), el("span", {}, x.snippet || "")); ul.append(li); } b.append(ul); }
        if (turn.confirm && !turn.settled) {
          const ok = el("button", { class: "btn primary assistant-confirm", type: "button" }, t("assistant.confirm"));
          const no = el("button", { class: "btn assistant-cancel", type: "button" }, t("assistant.cancel"));
          ok.addEventListener("click", () => settle(turn, true));
          no.addEventListener("click", () => settle(turn, false));
          b.append(ok, no);
        }
        log.append(b);
      }
      log.scrollTop = log.scrollHeight;
    }

    // One arrangement: the numbers a person judges it by, a small drawing, Uygula.
    function optionCard(turn, opt) {
      const o = opt.plan, card = el("div", { class: "assistant-option" });
      const tables = o.items.filter((x) => x.kind !== "chair").length;
      const kind = o.event === "theatre" ? t("assistant.planChairs", { n: o.items.length }) : t("assistant.planTables", { n: tables });
      card.append(el("p", { class: "assistant-option-title" }, `${kind} · ${t("assistant.planCapacity", { n: o.capacity })} · ${o.m2PerPerson} m²/${t("assistant.planPerson")}`));
      for (const note of o.notes) card.append(el("p", { class: "assistant-option-note" }, note));
      const NS = "http://www.w3.org/2000/svg", W = 300, sc = W / o.room.w, H = Math.round(o.room.l * sc);
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "assistant-preview"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", kind);
      const room = document.createElementNS(NS, "rect");
      room.setAttribute("x", "0.5"); room.setAttribute("y", "0.5"); room.setAttribute("width", String(W - 1)); room.setAttribute("height", String(H - 1)); room.setAttribute("class", "room");
      svg.append(room);
      for (const it of o.items) {
        const sh = document.createElementNS(NS, it.kind === "round" || it.kind === "bistro" ? "circle" : "rect");
        if (sh.tagName === "circle") { sh.setAttribute("cx", String(it.x * sc)); sh.setAttribute("cy", String(it.y * sc)); sh.setAttribute("r", String(Math.max(1.2, it.d * sc / 2))); }
        else { sh.setAttribute("x", String((it.x - it.w / 2) * sc)); sh.setAttribute("y", String((it.y - it.h / 2) * sc)); sh.setAttribute("width", String(Math.max(1, it.w * sc))); sh.setAttribute("height", String(Math.max(1, it.h * sc))); }
        svg.append(sh);
      }
      card.append(svg);
      if (opt.applied) card.append(el("p", { class: "assistant-undone" }, t("assistant.planApplied")));
      else {
        const go = el("button", { class: "btn primary assistant-apply", type: "button" }, t("assistant.apply"));
        go.addEventListener("click", () => {
          const ev = events().find((e) => e.id === currentId());
          if (!ev || !canMutate(ev)) return;
          working(true);
          const back = writers.applyLayout(o);
          opt.applied = true;
          turns.push({ who: "assistant", text: t("assistant.done"), lines: [kind + " · " + t("assistant.planCapacity", { n: o.capacity })], undo: back ? [back] : null });
          working(false); onChange(); draw(); input.focus();
        });
        card.append(go);
      }
      return card;
    }

    // Writers wrapped so each call records how to take it back; a writer that
    // could not do its step throws, and whatever ran before it is taken back.
    function recording(rec) {
      const ev = () => events().find((e) => e.id === currentId());
      const guest = (id) => ev().guests.find((g) => g.id === id);
      const W = writers;
      return {
        assign(id, tableId, seats) {
          const before = guest(id) && guest(id).assignment ? JSON.parse(JSON.stringify(guest(id).assignment)) : null;
          W.assign(id, tableId, seats);
          const now = guest(id) && guest(id).assignment;
          if (!now || now.tableId !== tableId) throw new Error(t("assistant.couldNot"));
          rec.push(() => before ? W.assign(id, before.tableId, before.seats) : W.unassign(id));
        },
        unassign(id) {
          const before = guest(id) && guest(id).assignment ? JSON.parse(JSON.stringify(guest(id).assignment)) : null;
          W.unassign(id);
          if (guest(id) && guest(id).assignment) throw new Error(t("assistant.couldNot"));
          if (before) rec.push(() => W.assign(id, before.tableId, before.seats));
        },
        deleteGuest(id) { const kept = W.deleteGuest(id); if (!kept) throw new Error(t("assistant.couldNot")); rec.push(() => W.restoreGuest(kept)); },
        setPax(id, pax) { const before = guest(id).pax; if (!W.setPax(id, pax)) throw new Error(t("assistant.couldNot")); rec.push(() => W.setPax(id, before)); },
        setVip(id, vip) { const before = guest(id).vip; W.setVip(id, vip); rec.push(() => W.setVip(id, before)); },
        setSeatRules(rules) { const before = W.setSeatRules(rules); if (!before) throw new Error(t("assistant.couldNot")); rec.push(() => W.setSeatRules(before)); },
        setArrival(id, status) { const before = guest(id).arrivalStatus; if (!W.setArrival(id, status)) throw new Error(t("assistant.couldNot")); rec.push(() => W.setArrival(id, before)); },
        addGuest(name, pax) { const id = W.addGuest(name, pax); rec.push(() => { const kept = W.deleteGuest(id); return kept; }); return id; },
      };
    }
    function undo(turn) {
      for (const back of turn.undo.slice().reverse()) back();
      turn.undone = true;
      onChange();
      draw();
      input.focus();
    }

    // A shown command: Onayla carries it out (resolved again against the event as
    // it is now), Vazgeç changes nothing.
    function settle(turn, yes) {
      turn.settled = true;
      const out = yes ? carryOut(turn.confirm.plan) : { text: t("assistant.cancelled") };
      turns.push(Object.assign({ who: "assistant" }, out, yes && turn.byModel ? { byModel: true } : {}));
      draw();
      input.focus();
    }

    // WEB RESEARCH (src/web-research.js): only when the person switched it on
    // (⋯ → Ayarlar, OFF by default). "web: …" shows the exact words that would
    // leave this machine — guest names, phones, e-mails, IDs removed — and waits
    // for the person's "Ara"; one search per click, results shown as text marked
    // as from the web, nothing written into the event.
    const WEB = /^\s*(?:web|webde ara|internette ara|search the web)\s*[:：]\s*(.+)$/i;
    async function search(turn) {
      turn.searched = true; working(true, t("assistant.webSearching")); draw();
      let r;
      try { r = await research.send(turn.research.query); } catch (error) { r = { ok: false, code: (error && error.name) || "ERROR" }; }
      working(false);
      turns.push(r && r.ok ? { who: "assistant", text: t("assistant.webFound", { n: r.results.length }), results: r.results.slice(0, 5), web: true } : { who: "assistant", text: t("assistant.webFailed", { code: (r && r.code) || "?" }) });
      draw();
    }
    function ask(text) {
      const w = research && research.enabled() && WEB.exec(text);
      if (w) {
        turns.push({ who: "you", text });
        const p = research.prepare(w[1]);
        turns.push(p.ok ? { who: "assistant", text: t("assistant.webPreview"), lines: [p.query, ...(p.anyRemoved ? [t("assistant.webRemoved")] : [])], research: { query: p.query } } : { who: "assistant", text: t("assistant.webTooShort") });
        draw();
        return;
      }
      turns.push({ who: "you", text });
      working(true);
      draw();
      // let the strip and the question paint before the work
      setTimeout(async () => {
        let reply;
        try { reply = await answer(text); } catch (e) { reply = { text: (e && e.message) || t("assistant.couldNot") }; }
        turns.push(Object.assign({ who: "assistant" }, reply));
        working(false);
        draw();
      }, 30);
    }
    // A brief becomes 1–2 arrangements from the layout engine; each can be
    // applied to the open event as one undo (a theatre arrangement as its chair
    // rows, S01…).
    function planReply(b) {
      const L = globalThis.MeritPlannerLayout, opts = [];
      const first = L.plan(b);
      if (!first.ok) return { text: t("assistant.planAsk", { what: first.ask }) };
      opts.push(first);
      if (first.event !== "theatre" && first.event !== "cocktail" && (b.table_kind == null || b.table_kind === "round") && !b.table_diam_cm) {
        const alt = L.plan(Object.assign({}, b, { table_diam_cm: 150 }));
        if (alt.ok && alt.capacity !== first.capacity) opts.push(alt);
      }
      return { text: t("assistant.planIntro"), options: opts.map((o) => ({ plan: o, applied: false })) };
    }
    // THE MEASURED ORDER (src/assistant-second-reader.js, "hybrid" θ 0.91, as q08
    // was raced and shipped): the second reader (the pinned chat model on this
    // machine, through the relay) reads every sentence but a door check-in the
    // rules read; its reading — the rules' own shape — is used when the rules read
    // nothing or it is sure, otherwise the rules'. A model's reading is only ever a
    // PROPOSAL — shown, then Uygula, then Geri al. When the model is missing, the
    // answer says so, with why, and the rules' answer stands.
    // F8 HELP (owner 2026-11-02): "how do I …" is answered from src/help-topics.js — step by step,
    // in the UI's language, with "Götür" to the screen. No model; nothing changes.
    const lang = () => (globalThis.MERIT_I18N_LANG && globalThis.MERIT_I18N_LANG() === "en" ? "en" : "tr");
    function helpReply(tp) { return { text: tp.title[lang()], lines: tp.steps[lang()], go: tp.go || null }; }
    // "?" (owner 2026-11-02): the keys, and sentences F8 understands, in the UI's language.
    function shortcuts() {
      toggle(true);
      const L = (k) => t(k).split("\n");
      turns.push({ who: "assistant", text: t("assistant.keysTitle"), lines: [...L("assistant.keys"), "—", ...L("assistant.examples")] });
      draw();
    }
    function help() {
      const H = globalThis.MeritHelpTopics;
      toggle(true);
      if (!H) return;
      turns.push({ who: "assistant", text: t("assistant.helpIntro"), topics: H.TOPICS });
      draw();
    }
    async function answer(text) {
      const evs = events(), now = today();
      const H = globalThis.MeritHelpTopics;
      // never when the sentence names one of our guests ("Ahmet nereye oturacak" is about Ahmet)
      if (H && H.isHowTo(text) && !P().personIn(text, evs)) { const m = H.match(text); if (m) return helpReply(m.topic); }
      const rules = P().parse(text, evs, now);
      let r = rules, byModel = false, missing = null;
      const compound = !!rules.compound;
      if (rules.kind === "status") return summary ? summary(rules.what, rules.what === "group" ? rules.host : rules.since) : { text: t("assistant.notUnderstood") };
      if (R() && SR().asksModel(rules)) {
        status.textContent = t("assistant.reading");
        const m = readText ? await readText(text) : SR().outcome({ relay: false });
        if (m && m.state === "reading") { const mr = R().toParse(m.reading, evs, now, text, currentId()); if (SR().choose(rules.kind, mr.kind, m.sure) === "model") { r = mr; byModel = true; } }
        if (m && m.state === "missing") missing = SR().notice(m);
        readerIs(m && m.state === "missing" ? m : null);
      }
      const mark = (out) => Object.assign(out, byModel ? { byModel: true } : {}, missing ? { missing } : {});
      // two jobs in one sentence nobody could read: asked back
      if (r.kind === "unknown" && compound) return mark({ text: t("assistant.oneAtATime") });
      // Neither a question about our events nor a command: ONE fixed answer, never
      // the model's free text (owner 2026-11-14; measured: it invented weather and
      // an exchange rate). Suite assistant-offtopic.
      if (r.kind === "unknown") return mark({ text: t("assistant.offTopic") });
      return mark(reply(r, evs, now, byModel));
    }
    function reply(r, evs, now, byModel) {
      if (r.kind === "plan") { if (!currentId()) return { text: t("assistant.noEvent") }; return planReply(r.brief); }
      if (r.kind === "question") return { text: P().answer(r, evs, now, currentId(), globalThis.MERIT_I18N_LANG ? globalThis.MERIT_I18N_LANG() : "tr").text };
      if (r.kind !== "command") return { text: t("assistant.notUnderstood") };
      if (!currentId()) return { text: t("assistant.noEvent") };
      // SPEC-v4: every change is SHOWN first and waits for Uygula — a misreading
      // costs a click, never a guest — except a door check-in the RULES read (a
      // plain statement at the door). A reading the model made is always shown
      // first, however sure it is (src/assistant-second-reader.js mustShow).
      if (SR().mustShow(r.plan, byModel)) {
        const A = globalThis.MeritAssistantActions.create({ events, current: currentId, today, lang: () => (globalThis.MERIT_I18N_LANG ? globalThis.MERIT_I18N_LANG() : "tr"), canMutate: (e) => canMutate(e), writers: {}, snapshot: () => null, registerUndo: () => {} });
        const res = A.resolve(r.plan);
        if (res.ask) return { text: res.ask };
        if (res.refuse) return { text: res.refuse };
        const real = res.steps.filter((x) => x.op !== "noop");
        if (!real.length) return { text: t("assistant.nothing"), lines: res.steps.map((x) => x.line) };
        const at = real.find((x) => x.tableId);
        if (at && highlight) highlight(at.tableId);
        return { text: t("assistant.confirmIntro"), lines: preview(res.steps), confirm: { plan: r.plan } };
      }
      return carryOut(r.plan);
    }
    // What a resolved plan will do, in words, before anything changes.
    function preview(steps) {
      const ev = events().find((e) => e.id === currentId());
      const pax = (id) => { const g = ev && ev.guests.find((x) => x.id === id); return g ? g.pax || 1 : 1; };
      return steps.map((x) => {
        if (x.op === "noop") return x.line;
        if (x.op === "assign") return `${x.name} → ${x.number}${x.seats ? ` (${t("assistant.pv.seat")} ${x.seats.map((n) => n + 1).join(", ")})` : ""}`;
        if (x.op === "unassign") return t("assistant.pv.unassign", { name: x.name });
        if (x.op === "deleteGuest") return pax(x.guestId) > 1 ? t("assistant.pv.deleteParty", { name: x.name, n: pax(x.guestId) - 1 }) : t("assistant.pv.delete", { name: x.name });
        if (x.op === "setPax") return t("assistant.pv.pax", { name: x.name, n: x.pax });
        if (x.op === "setVip") return t("assistant.pv.vip", { name: x.name });
        if (x.op === "arrive") return t("assistant.pv.arrive", { name: x.name });
        if (x.op === "rule") return x.line;
        if (x.op === "addGuest") return x.table ? t("assistant.pv.addAt", { name: x.name, n: x.pax, table: x.table }) : t("assistant.pv.add", { name: x.name, n: x.pax });
        return x.op;
      });
    }
    function carryOut(plan) {
      const rec = [];
      const A = globalThis.MeritAssistantActions.create({
        events, current: currentId, today, lang: () => (globalThis.MERIT_I18N_LANG ? globalThis.MERIT_I18N_LANG() : "tr"), canMutate: (e) => canMutate(e),
        writers: recording(rec), snapshot: () => null, registerUndo: () => {},
      });
      let out;
      try { out = A.run(plan); }
      catch (e) { for (const back of rec.slice().reverse()) back(); onChange(); return { text: e.message }; }
      if (out.ask) return { text: out.ask };
      if (out.refuse) return { text: out.refuse };
      onChange();
      return { text: out.applied.length ? t("assistant.done") : t("assistant.nothing"), lines: out.lines, undo: rec.length ? rec : null };
    }

    // A button anywhere may ask F8 a sentence (data-assistant-ask): the answer is shown in the panel,
    // and anything that changes seats waits for Onayla there (e.g. Seating's "Taslak yerleşim").
    document.addEventListener("click", (e) => {
      const b = e.target && e.target.closest && e.target.closest("[data-assistant-ask]");
      if (!b) return;
      e.preventDefault(); toggle(true); ask(b.dataset.assistantAsk);
    });
    return { mount, toggle, isOpen, ask, help, shortcuts };
  }

  globalThis.MeritScreenAssistant = Object.freeze({create,DEPS:Object.freeze(["canMutate","currentId","events","go","highlight","onChange","readText","readerState","research","summary","t","today","voice","writers"])});
})();
