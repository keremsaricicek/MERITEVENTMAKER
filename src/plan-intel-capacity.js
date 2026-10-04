// Capacity: the physical seat count from detected chairs, and the cross-check against what the drawing itself prints.
//
// Part of Plan Intelligence, split out of src/plan-intelligence.js on 2026-10-04
// (technical gaps, item 2) and moved verbatim: the only edits are references to
// a name another part owns, which now go through that part's object. Nothing
// here is a trained model; every number is computed from real geometry or OCR.
(() => {
  "use strict";

  // ---- Capacity: physical seat count purely from detected chair objects —
  // no estimation for tables (chairs are literal). Sofas/benches (not yet
  // detected by the classical pipeline; taxonomy exists for Teach the Plan) get a
  // real evidence-based estimate when the user provides one via Teach the Plan.
  //
  // Two real chair populations are counted, never double-counted: chairs
  // associated with a table (c.chairDetections, one chair belongs to at most
  // one table) and chairs the detector found on their own that no table could
  // claim (kind "venue", type "chair"). The second group used to be dropped
  // entirely, which is a direct contributor to an under-reported seat total on
  // a plan whose chairs are the number the operator actually needs. Rejected
  // candidates are excluded: a human said that object is not real.
  // OFFERED, not merely not-rejected. A candidate the detector held back
  // (selected false, nobody has confirmed it) is not on the plan an operator
  // gets by confirming what was offered, and its chairs are not in the room's
  // drawn-chair figure: on the Golden Plan they added 5 seats (112 against
  // the 107 actually offered, 2026-10-04). Held-back seats are reported on
  // their own (heldBackSeats) so the difference is visible, never folded in.
  const isOffered = (c) => c.status === "confirmed" || (c.status !== "rejected" && c.selected !== false);
  function computePhysicalCapacity(candidates) {
    return candidates.reduce((n, c) => {
      if (!isOffered(c)) return n;
      // A standalone chair object seats exactly one person.
      if (c.kind === "chair" || (c.kind === "venue" && c.type === "chair")) return n + 1;
      // Only tables seat people. A stage, a bar, or a stray printed label that
      // happened to have a chair associated with it must never inflate the
      // capacity the operator plans against.
      if (c.kind !== "table") return n;
      return n + (c.chairDetections?.length || 0);
    }, 0);
  }
  function countAssociatedSeats(candidates) {
    return candidates.reduce((n, c) => n + (!isOffered(c) ? 0 : (c.chairDetections?.length || 0)), 0);
  }
  function countStandaloneChairs(candidates) {
    return candidates.filter(c => isOffered(c) && c.kind === "venue" && c.type === "chair").length;
  }
  // What the detector found and did not offer: tables held back and the seats
  // they carry, plus standalone chairs held back. Never part of a total.
  function heldBackSeats(candidates) {
    const held = candidates.filter(c => c.status !== "rejected" && !isOffered(c));
    return {
      tables: held.filter(c => c.kind === "table").length,
      seats: held.reduce((n, c) => n + (c.kind === "table" ? (c.chairDetections?.length || 0) : (c.kind === "venue" && c.type === "chair" ? 1 : 0)), 0),
    };
  }

  // ---- OCR capacity cross-check. Requires a real OCR engine (Tesseract.js,
  // loaded separately — see plan-ocr.js). If it isn't loaded, this returns
  // null rather than a fabricated number, per the project's AI-truthfulness
  // rule: never invent OCR results.
  function parsePaxFromText(text) {
    if (!text) return null;
    const matches = [...text.matchAll(/(\d{1,5})\s*(?:pax|kişi|seat|koltuk)/gi)].map(m => Number(m[1]));
    const totalMatch = text.match(/total[:\s]*([\d.,]+)\s*pax/i) || text.match(/toplam[:\s]*([\d.,]+)/i);
    const stated = totalMatch ? Number(totalMatch[1].replace(/[.,]/g, "")) : (matches.length ? Math.max(...matches) : null);
    return Number.isFinite(stated) ? stated : null;
  }

  // A capacity RULE, not just a total.
  //
  // Some plans do not leave their capacity to be counted — they print the
  // arithmetic. ORNEK prints
  //
  //     SALON    : 166 * 12 : 1992 PAX
  //     LOCALAR  :  72      PAX
  //     TOPLAM   : 2064     PAX
  //
  // which says three things a seat count can never say: how many tables the
  // room has, how many people sit at one, and what the two other figures add
  // up to. On a drawing with no seats drawn at all, that is the only capacity
  // there is — and it also gives the detector something to be checked against,
  // because "the drawing says 166 tables and 132 were found" is a real,
  // actionable gap where "132 tables" alone is just a number.
  //
  // Nothing here keys on this plan. The pattern is "a multiplication and its
  // result", and the ARITHMETIC IS THE VALIDATOR: a triple is only accepted as
  // a capacity rule when the multiplication actually comes out. That is what
  // makes it safe to run over noisy OCR of an arbitrary document — three
  // unrelated numbers that happen to sit near a "*" will not multiply out.
  //
  // Which matters here, because OCR does not read this cleanly. Tesseract
  // returns "SALON 1166 * 12: 1992 PAX": the colon before 166 became a 1, so
  // the first number reads 1166 and 1166 x 12 is not 1992. Rather than repair
  // the token — guessing at what a character "should" have been is how OCR
  // output becomes fiction — the count is DERIVED from the two figures that do
  // check out (1992 / 12 = 166, exactly), and the number as read is reported
  // beside it as corroboration that either agrees or does not.
  function parseCapacityRule(text, expected) {
    if (!text) return null;
    // Each multiplication sign, the number before it, and the digits after it.
    // The tail is taken loosely because OCR sprays and drops punctuation here:
    // the same line came back as "1166 * 12: 1992" on one run and
    // "1166 * 121992" on the next, the colon having disappeared and fused two
    // numbers into one.
    const starRe = /(\d{1,8})\s*[*x×X]\s*([\d\s:=.,\-]{1,24})/g;
    const candidates = [];
    if (expected != null) candidates.push(expected);
    for (const m of text.matchAll(starRe)) {
      const a = Number(m[1]);
      const runs = [...String(m[2]).matchAll(/\d+/g)].map((r) => r[0]);
      const options = [];
      if (runs.length >= 2) options.push([Number(runs[0]), Number(runs[1])]);
      if (runs.length === 1) {
        // One fused run: the separator was lost. Every split is a reading, and
        // the arithmetic plus the page's own other figures decide which one —
        // rather than repairing the characters, which would be inventing them.
        const d = runs[0];
        for (let i = 1; i < d.length; i++) options.push([Number(d.slice(0, i)), Number(d.slice(i))]);
      }
      for (const [b, c] of options) {
        if (!b || !c || c <= b || c % b !== 0) continue;
        const units = c / b;
        const exact = a * b === c;
        // Corroboration, not repair: the product has to be a figure the page
        // states somewhere else. Without that, a fused run would always yield
        // SOME split that divides, and the parser would read capacity rules
        // out of noise.
        const corroborated = candidates.includes(c);
        if (!exact && !corroborated) continue;
        return {
          units, perUnit: b, total: c,
          unitsSource: exact ? "read" : "derived",
          unitsAsRead: a,
          unitsAgree: a === units,
          corroboratedBy: exact ? null : c,
          why: exact
            ? `the drawing prints ${a} x ${b} = ${c}, and the multiplication comes out`
            : `OCR read this line as "${a} x ${String(m[2]).trim()}"; ${c} is a figure the drawing states elsewhere, `
              + `and ${c} / ${b} = ${units} exactly, so the count is taken as ${units} rather than the ${a} that does not multiply out`,
        };
      }
    }
    return null;
  }

  // The other figures a capacity block prints beside the rule, each tied to
  // the word that labelled it, so a number is never lifted out of context.
  function parseLabelledPax(text) {
    if (!text) return {};
    const out = {};
    const grab = (label, re) => {
      const m = text.match(re);
      if (m) out[label] = Number(String(m[1]).replace(/[.,\s]/g, ""));
    };
    grab("total", /toplam[^0-9]{0,12}(\d{1,6})/i);
    grab("total", /total[^0-9]{0,12}(\d{1,6})/i);
    grab("boxes", /loca(?:lar)?[^0-9]{0,12}(\d{1,6})\s*(?:pax|kişi)/i);
    grab("hall", /salon[^0-9]{0,12}(\d{1,6})\s*(?:pax|kişi)/i);
    return out;
  }

  // Rank the places a missing (or excess) seat is most likely hiding.
  //
  // The previous comparator was `(b.conf - a.conf) ? 0 : 0`, which evaluates
  // the difference only for truthiness and returns 0 either way. It therefore
  // never sorted anything: the "five most likely areas" were just the first
  // five candidates in detection order. This scores each candidate on real
  // evidence and sorts on that score.
  function rankSuspectRegions(candidates, difference) {
    const scored = candidates
      .filter(c => c.status !== "rejected" && c.status !== "confirmed")
      .map(c => {
        const reasons = [];
        let score = 0;
        // An object whose seat count is explicitly unknown is the strongest
        // explanation for a capacity gap -- a banquette nobody has counted.
        if (c.seats == null && (c.kind === "sofa" || c.kind === "bench" || c.kind === "banquette" ||
            c.type === "sofa" || c.type === "bench" || c.type === "banquette")) { score += 6; reasons.push("unverified seating furniture"); }
        // Chairs the association step could not attach to any table: real
        // detected seats that are currently contributing to nobody's total.
        if (c.unassociated) { score += 4; reasons.push("chair not associated with a table"); }
        // A table carrying no chairs at all on a plan where tables normally do.
        if (c.kind === "table" && !(c.chairDetections?.length)) { score += 3; reasons.push("table with no seats found"); }
        // Low confidence and never reviewed: the detector itself is unsure.
        const conf = c.confidence ?? 0;
        if (c.status === "unreviewed") { score += 1; reasons.push("not yet reviewed"); }
        if (conf < 0.5) { score += 2 * (0.5 - conf) / 0.5; reasons.push(`low confidence ${conf.toFixed(2)}`); }
        // Direction matters: if the drawing claims MORE than was counted, look
        // at things that might hide seats; if fewer, look at things that might
        // have invented them.
        if (difference > 0 && c.kind === "table" && (c.chairDetections?.length || 0) < 2) { score += 1; reasons.push("fewer seats than a table usually has"); }
        if (difference < 0 && (c.chairDetections?.length || 0) > 8) { score += 1; reasons.push("unusually many seats for one table"); }
        return { id: c.id, score: +score.toFixed(2), reasons };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
    return scored;
  }

  // Multi-source capacity reasoning: what the drawing says, what was physically
  // detected, what the logical seating groups imply, and what is admittedly
  // unknown. Every number is labelled with where it came from; none of them is
  // adjusted to make the others agree.
  function buildCapacityAudit(ocrText, systemCounted, candidates, furnitureGroups) {
    const stated = parsePaxFromText(ocrText);
    // The labelled figures first, because they are what a multiplication has
    // to agree with before it is believed.
    const labelled = parseLabelledPax(ocrText);
    const expected = labelled.total != null
      ? labelled.total - (labelled.boxes || 0)
      : null;
    const rule = parseCapacityRule(ocrText, expected) || parseCapacityRule(ocrText, labelled.total ?? null);
    const unverifiedSeating = candidates.filter(c =>
      c.status !== "rejected" && c.seats == null &&
      ["sofa", "bench", "banquette"].includes(c.kind === "venue" ? c.type : c.kind));
    const logicalSeats = (furnitureGroups || []).reduce((n, g) => {
      const members = g.memberIds || [];
      return n + members.reduce((m, id) => {
        const c = candidates.find(x => x.id === id);
        return m + (c?.chairDetections?.length || 0);
      }, 0);
    }, 0);
    const audit = {
      physical: { seats: systemCounted, source: "chairs on the tables offered, plus standalone chairs offered",
        heldBack: heldBackSeats(candidates) },
      logical: { seats: logicalSeats, groups: (furnitureGroups || []).length, source: "seats summed over logical seating groups" },
      unverified: unverifiedSeating.map(c => ({ id: c.id, kind: c.kind, type: c.type,
        note: "seat count not determinable from the drawing — needs a human answer" })),
      drawingStated: stated,
      // What the drawing states as a RULE rather than a total, when it does.
      // `rule.units` is a table count the drawing asserts, which the detector
      // can be measured against; `parts` are the other labelled figures, each
      // still attached to the word that labelled it.
      rule,
      parts: labelled,
      // Does the printed block agree with itself? A drawing whose own numbers
      // do not add up is worth saying so about, and one whose numbers do add
      // up has earned more trust than a single figure read in isolation.
      arithmetic: (rule && labelled.total != null)
        ? {
            seating: rule.total,
            others: labelled.total - rule.total,
            total: labelled.total,
            closes: labelled.total >= rule.total,
          }
        : null,
      difference: stated == null ? null : stated - systemCounted,
      sourceText: ocrText ? ocrText.slice(0, 400) : null,
      ocrAvailable: ocrText != null,
    };
    audit.suspectRegions = rankSuspectRegions(candidates, audit.difference ?? 0).slice(0, 8);
    // Kept for callers that already read this field.
    audit.likelyAreaIds = audit.suspectRegions.map(s => s.id);
    // With no OCR there is no stated number to compare against, but the
    // physical/logical/unverified breakdown is still real and worth returning.
    return (stated == null && !rule && !unverifiedSeating.length && !audit.suspectRegions.length) ? null : audit;
  }

  globalThis.MeritPlanIntelCapacity = Object.freeze({ buildCapacityAudit, computePhysicalCapacity, countAssociatedSeats, countStandaloneChairs, heldBackSeats, isOffered });
})();
