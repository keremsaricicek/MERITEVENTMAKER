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
// moments a thin strip on its top edge carries the app's colours back and
// forth (the owner's design, 2026-10-27); it is still under reduced motion.
//
// Everything this reads from the shell is handed to it by create(deps), once.
(function () {
  "use strict";
  const P = () => globalThis.MeritAssistantParse;

  function create(deps) {
    const { events, currentId, today, canMutate, writers, t, onChange } = deps;
    let root = null, log = null, input = null, status = null, strip = null;
    const turns = [];   // {who:"you"|"assistant", text, lines?, undo?}

    function el(tag, attrs, text) {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      return n;
    }
    function mount() {
      if (root) return root;
      root = el("aside", { class: "assistant-panel", id: "assistantPanel", "aria-label": t("assistant.title"), hidden: "" });
      strip = el("div", { class: "assistant-strip", "aria-hidden": "true" });
      const head = el("div", { class: "assistant-head" });
      head.append(el("h2", { class: "assistant-title" }, t("assistant.title")), el("kbd", { class: "assistant-key" }, "F8"));
      status = el("span", { class: "assistant-status", role: "status" }, t("assistant.ready"));
      const close = el("button", { class: "assistant-close", type: "button", "aria-label": t("assistant.close") }, "×");
      close.addEventListener("click", () => toggle(false));
      head.append(status, close);
      log = el("div", { class: "assistant-log", "aria-live": "polite" });
      const form = el("form", { class: "assistant-form" });
      const label = el("label", { class: "sr-only", for: "assistantInput" }, t("assistant.inputLabel"));
      input = el("input", { id: "assistantInput", class: "assistant-input", autocomplete: "off", placeholder: t("assistant.placeholder") });
      const send = el("button", { class: "btn primary assistant-send", type: "submit" }, t("assistant.send"));
      form.append(label, input, send);
      form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { input.value = ""; ask(v); } });
      root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); toggle(false); } });
      root.append(strip, head, log, form);
      document.body.appendChild(root);
      return root;
    }
    function isOpen() { return !!root && !root.hidden; }
    function toggle(open) {
      mount();
      const want = open == null ? root.hidden : open;
      root.hidden = !want;
      document.body.classList.toggle("assistant-open", want);
      if (want) setTimeout(() => input.focus(), 0);
    }
    function working(on, text) {
      root.classList.toggle("is-working", on);
      status.textContent = text || (on ? t("assistant.working") : t("assistant.ready"));
    }
    function draw() {
      log.textContent = "";
      for (const turn of turns) {
        const b = el("div", { class: `assistant-turn ${turn.who}` });
        b.append(el("p", {}, turn.text));
        if (turn.lines && turn.lines.length) { const ul = el("ul", { class: "assistant-lines" }); for (const l of turn.lines) ul.append(el("li", {}, l)); b.append(ul); }
        if (turn.undo && !turn.undone) {
          const u = el("button", { class: "btn assistant-undo", type: "button" }, t("assistant.undo"));
          u.addEventListener("click", () => { undo(turn); });
          b.append(u);
        }
        if (turn.undone) b.append(el("p", { class: "assistant-undone" }, t("assistant.undone")));
        log.append(b);
      }
      log.scrollTop = log.scrollHeight;
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
        addGuest(name, pax) { const id = W.addGuest(name, pax); rec.push(() => { const kept = W.deleteGuest(id); return kept; }); return id; },
      };
    }
    function undo(turn) {
      for (const back of turn.undo.slice().reverse()) back();
      turn.undone = true;
      onChange();
      draw();
    }

    function ask(text) {
      turns.push({ who: "you", text });
      working(true);
      draw();
      // let the strip and the question paint before the work
      setTimeout(() => {
        let reply;
        try { reply = answer(text); } catch (e) { reply = { text: (e && e.message) || t("assistant.couldNot") }; }
        turns.push(Object.assign({ who: "assistant" }, reply));
        working(false);
        draw();
      }, 30);
    }
    function answer(text) {
      const evs = events(), now = today();
      const r = P().parse(text, evs, now);
      if (r.kind === "question") return { text: P().answer(r, evs, now, currentId()).text };
      if (r.kind !== "command") return { text: t("assistant.notUnderstood") };
      if (!currentId()) return { text: t("assistant.noEvent") };
      const rec = [];
      const A = globalThis.MeritAssistantActions.create({
        events, current: currentId, today, canMutate: (e) => canMutate(e),
        writers: recording(rec), snapshot: () => null, registerUndo: () => {},
      });
      let out;
      try { out = A.run(r.plan); }
      catch (e) { for (const back of rec.slice().reverse()) back(); onChange(); return { text: e.message }; }
      if (out.ask) return { text: out.ask };
      if (out.refuse) return { text: out.refuse };
      onChange();
      return { text: out.applied.length ? t("assistant.done") : t("assistant.nothing"), lines: out.lines, undo: rec.length ? rec : null };
    }

    return { mount, toggle, isOpen, ask };
  }

  globalThis.MeritScreenAssistant = { create };
})();
