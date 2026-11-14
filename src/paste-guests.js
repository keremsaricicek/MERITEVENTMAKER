// "PASTE A LIST" ON GUESTS (owner 2026-11-02): paste → preview with ticks → add.
//
// The dialog reads the paste with MeritMessyList.parse and shows one row per guest:
// name, people, phone, host — a likely duplicate unticked and said so, an unreadable
// line shown and never added. "Add" hands the ticked rows to the shell as a
// `merit:add-guests` event; the shell adds them through its own guest writer, for the
// open event only, and only when the event may change. Nothing is added by this file.
(function () {
  "use strict";
  const tr = (k, v) => (typeof t === "function" ? t(k, v) : k);
  let dlg = null, rows = [];
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function build() {
    dlg = el("dialog", "dialog-wide paste-guests"); dlg.setAttribute("aria-labelledby", "pasteGuestsTitle");
    const head = el("div", "dialog-head"), h = el("h2", null, ""); h.id = "pasteGuestsTitle"; head.append(h);
    const body = el("div", "dialog-body");
    const hint = el("p", "muted paste-hint", "");
    const ta = el("textarea", "paste-text"); ta.rows = 8; ta.setAttribute("aria-label", "paste"); ta.spellcheck = false;
    const prev = el("div", "paste-preview"); prev.setAttribute("role", "region"); prev.setAttribute("aria-live", "polite");
    body.append(hint, ta, prev);
    const foot = el("div", "dialog-foot");
    const cancel = el("button", "btn", ""); cancel.type = "button"; cancel.dataset.paste = "cancel";
    const look = el("button", "btn", ""); look.type = "button"; look.dataset.paste = "preview";
    const add = el("button", "btn primary", ""); add.type = "button"; add.dataset.paste = "add"; add.disabled = true;
    foot.append(cancel, look, add);
    dlg.append(head, body, foot); document.body.appendChild(dlg);
    cancel.onclick = () => dlg.close();
    look.onclick = () => preview();
    prev.addEventListener("change", () => { add.textContent = tr("paste.add", { n: prev.querySelectorAll("input:checked").length }); });
    add.onclick = () => {
      const pick = rows.filter((r, i) => !r.problem && prev.querySelector(`input[data-row="${i}"]`)?.checked);
      if (!pick.length) return;
      document.dispatchEvent(new CustomEvent("merit:add-guests", { detail: pick.map((r) => ({ name: r.name, pax: r.pax, phone: r.phone || "", invitedBy: r.host || "" })) }));
      dlg.close();
    };
  }
  function label() {
    dlg.querySelector("#pasteGuestsTitle").textContent = tr("paste.title");
    dlg.querySelector(".paste-hint").textContent = tr("paste.hint");
    dlg.querySelector(".paste-text").placeholder = tr("paste.placeholder");
    dlg.querySelector(".paste-text").setAttribute("aria-label", tr("paste.title"));
    dlg.querySelector('[data-paste="cancel"]').textContent = tr("paste.cancel");
    dlg.querySelector('[data-paste="preview"]').textContent = tr("paste.preview");
  }
  function preview() {
    const existing = (typeof globalThis.MERIT_PASTE_EXISTING === "function" ? globalThis.MERIT_PASTE_EXISTING() : []) || [];
    rows = globalThis.MeritMessyList.parse(dlg.querySelector(".paste-text").value, existing);
    const prev = dlg.querySelector(".paste-preview"); prev.textContent = "";
    const table = el("table", "paste-table"), hr = el("tr");
    for (const k of ["", "paste.name", "paste.pax", "paste.phone", "paste.host", "paste.note"]) hr.append(el("th", null, k ? tr(k) : ""));
    const thead = el("thead"); thead.append(hr); table.append(thead);
    const tb = el("tbody"); let ok = 0;
    rows.forEach((r, i) => {
      const row = el("tr", r.problem ? "is-bad" : r.duplicateOf ? "is-dup" : "");
      const c0 = el("td"), cb = el("input"); cb.type = "checkbox"; cb.dataset.row = String(i); cb.checked = !r.problem && !r.duplicateOf; cb.disabled = !!r.problem;
      cb.setAttribute("aria-label", r.name || r.raw); c0.append(cb); row.append(c0);
      row.append(el("td", null, r.problem ? r.raw : r.name), el("td", null, r.problem ? "" : String(r.pax)), el("td", null, r.phone || ""), el("td", null, r.host || ""),
        el("td", null, r.problem ? tr("paste.unreadable") : r.duplicateOf ? tr("paste.duplicate", { name: r.duplicateOf }) : ""));
      if (cb.checked) ok++;
      tb.append(row);
    });
    table.append(tb); prev.append(table);
    const add = dlg.querySelector('[data-paste="add"]'); add.disabled = !rows.some((r) => !r.problem);
    add.textContent = tr("paste.add", { n: rows.filter((r) => !r.problem).length });
    return ok;
  }
  function open() {
    if (!dlg) build();
    label(); dlg.querySelector(".paste-text").value = ""; dlg.querySelector(".paste-preview").textContent = "";
    const add = dlg.querySelector('[data-paste="add"]'); add.disabled = true; add.textContent = tr("paste.add", { n: 0 });
    dlg.showModal(); dlg.querySelector(".paste-text").focus();
  }
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-guest-command="paste"]');
    if (!b) return;
    e.preventDefault(); open();
  });
  globalThis.MeritPasteGuests = Object.freeze({ open, preview: () => preview() });
})();
