// Can the plan check itself?
//
// Every number this product shows an operator comes from one of four places,
// and they are not equally trustworthy:
//
//   A  what the DRAWING STATES about itself   read by OCR from printed text
//   B  what the DETECTOR FOUND                counted from the analysis
//   C  what the ARITHMETIC gives              derived from A
//   D  what a PERSON CONFIRMED                the strongest, and the rarest
//
// A plan that says "166 tables at 12 pax = 1992, plus 72 = 2064" is making four
// claims that must agree with each other and with what was actually found. This
// layer compares them and says where they agree and where they do not. It is
// not another detector: it reads nothing, measures nothing, and adds no engine
// calls. It only asks whether what is already known is self-consistent.
//
// ---- the two rules that keep it honest -------------------------------------
//
// ARITHMETIC IS CORROBORATION, NOT PERMISSION TO REWRITE EVIDENCE. When
// 166 x 12 does not equal the printed total, the answer is NEEDS REVIEW. It is
// never a licence to adjust one of the numbers until it does. OCR of a
// photographed sheet misreads digits constantly — that is exactly why the
// arithmetic is worth checking, and exactly why it must not be allowed to
// "fix" its own inputs. The moment a check can edit its evidence it stops
// being a check.
//
// EVERY NUMBER CARRIES WHERE IT CAME FROM. A check whose inputs are anonymous
// tells an operator that something disagrees but not which side to trust, which
// is the half of the message that decides what they do next.
(function () {
  "use strict";

  const VERDICT = {
    CONSISTENT: "CONSISTENT",
    INCONSISTENT: "INCONSISTENT",
    NEEDS_REVIEW: "NEEDS_REVIEW",
    NOT_CHECKABLE: "NOT_CHECKABLE",
  };

  // A number, with its origin attached. Nothing enters a check without one.
  //
  // `source` is the sentence -- free English, sometimes composed from the
  // figures themselves, and read by the benchmarks and the exported report.
  // `origin` is the same fact as a stable name, because a product screen has to
  // say where a number came from in the operator's language and cannot re-parse
  // an English phrase to do it. One of ORIGINS; never invented per call site.
  const ORIGINS = {
    PRINTED: "printedOnTheDrawing",
    DERIVED: "derivedFromPrintedFigures",
    DETECTED: "assistedDetection",
    PERSON: "confirmedByAPerson",
    SYSTEM: "theSystem",
  };
  function value(name, v, source, confidence, origin) {
    return { name, value: v, source, confidence: confidence || null,
      origin: origin || ORIGINS.PRINTED };
  }

  function checkable(...vals) {
    return vals.every((v) => v && typeof v.value === "number" && Number.isFinite(v.value));
  }

  function run(input) {
    const inp = input || {};
    const audit = inp.capacityAudit || null;
    const rule = audit && audit.rule ? audit.rule : null;
    const parts = (audit && audit.parts) || {};
    const checks = [];

    // `statement` and `detail` are written in English here because this layer
    // is also read by the benchmarks and the exported operator report, which
    // are English artifacts. A UI that has to say the same thing in Turkish
    // cannot re-parse an English sentence, so every number a sentence uses is
    // also carried structurally in `params`. The sentence and the params are
    // the same facts in two forms -- never two different facts.
    const add = (id, statement, verdict, inputs, detail, params) =>
      checks.push({ id, statement, verdict, inputs, detail, params: params || {} });

    // ---- A vs C: does the drawing's own multiplication come out? -----------
    if (rule) {
      const units = value("tables the drawing states", rule.units,
        rule.unitsSource === "derived"
          ? `derived from the printed seating figure (${rule.total} / ${rule.perUnit}); OCR itself read "${rule.unitsAsRead}"`
          : "printed on the drawing, read by OCR",
        rule.unitsAgree ? "verified" : "likely",
        rule.unitsSource === "derived" ? ORIGINS.DERIVED : ORIGINS.PRINTED);
      const perUnit = value("pax at each table", rule.perUnit, "printed on the drawing, read by OCR", "verified", ORIGINS.PRINTED);
      const seats = value("seating capacity the drawing states", rule.total, "printed on the drawing, read by OCR", "verified", ORIGINS.PRINTED);
      const product = units.value * perUnit.value;
      add("capacityRuleArithmetic",
        `${units.value} x ${perUnit.value} = ${seats.value}`,
        product === seats.value ? VERDICT.CONSISTENT : VERDICT.NEEDS_REVIEW,
        [units, perUnit, seats],
        product === seats.value
          ? "the drawing's own multiplication comes out"
          : `${units.value} x ${perUnit.value} is ${product}, not the ${seats.value} printed — one of these three was misread, and none of them is adjusted to make it close`,
        { a: units.value, b: perUnit.value, c: seats.value, p: product });

      // ---- A vs A: do the parts add up to the printed grand total? ---------
      if (typeof parts.total === "number") {
        const others = value("capacity printed for the rest of the venue",
          typeof parts.boxes === "number" ? parts.boxes : parts.total - rule.total,
          "printed on the drawing, read by OCR", "likely", ORIGINS.PRINTED);
        const grand = value("total capacity the drawing states", parts.total,
          "printed on the drawing, read by OCR", "verified", ORIGINS.PRINTED);
        if (checkable(others, grand)) {
          const sum = rule.total + others.value;
          add("capacityPartsSum",
            `${rule.total} + ${others.value} = ${grand.value}`,
            sum === grand.value ? VERDICT.CONSISTENT : VERDICT.NEEDS_REVIEW,
            [seats, others, grand],
            sum === grand.value
              ? "the parts the drawing prints add up to the total it prints"
              : `they add to ${sum}, not the ${grand.value} printed`,
            { a: rule.total, b: others.value, c: grand.value, p: sum });
        }
      }
    }

    // ---- A vs B: does what was found match what the drawing claims? --------
    const detected = typeof inp.tablesDetected === "number" ? inp.tablesDetected : null;
    if (rule && detected != null) {
      const stated = value("tables the drawing states", rule.units, "printed on the drawing, read by OCR", "likely", ORIGINS.PRINTED);
      const found = value("tables the detector found", detected, "Assisted Detection", "measured", ORIGINS.DETECTED);
      add("statedTablesVsDetected",
        `the drawing states ${stated.value} tables; ${found.value} were found`,
        stated.value === found.value ? VERDICT.CONSISTENT : VERDICT.INCONSISTENT,
        [stated, found],
        stated.value === found.value
          ? "the count agrees"
          : `${Math.abs(stated.value - found.value)} ${stated.value > found.value ? "not accounted for" : "more than the drawing claims"}`,
        { a: stated.value, b: found.value, d: Math.abs(stated.value - found.value),
          direction: stated.value > found.value ? "short" : "over" });
    }

    // ---- B vs B: are the numbers on those tables internally sound? ---------
    const integrity = inp.numberIntegrity || null;
    if (integrity && integrity.summary) {
      const s = integrity.summary;
      const dupes = (integrity.findings || []).filter((f) => f.kind === "duplicateNumber");
      add("tableNumbersUnique",
        dupes.length ? `${dupes.length} number${dupes.length === 1 ? " is" : "s are"} claimed by more than one table`
          : `each of the ${s.verified} confidently read numbers belongs to one table`,
        dupes.length ? VERDICT.INCONSISTENT : VERDICT.CONSISTENT,
        // Two sources reach VERIFIED, and the wording names both rather than
        // implying every confident number was machine-read: OCR of the table's
        // own symbol accepted only where two differently-inset crops agreed,
        // and a number a person confirmed in the Teach Area, which outranks it.
        [value("numbers held confidently", s.verified,
          "OCR of each table's own symbol where two crops agreed, plus any number a person confirmed",
          "verified", ORIGINS.PRINTED)],
        dupes.length ? dupes.map((d) => `${d.number} on ${d.tableIds.length} tables`).join("; ")
          : "no number is claimed twice",
        { a: s.verified, d: dupes.length,
          list: dupes.map((x) => `${x.number} × ${x.tableIds.length}`).join(", ") });
    }

    // ---- A vs B, but only where B means something -------------------------
    //
    // Comparing a printed pax figure against a counted seat total is a real
    // check on a plan that DRAWS seats, and meaningless on one that does not —
    // a symbolic plan draws no chairs, so "2064 stated, 0 counted" is a
    // restatement of what kind of drawing it is dressed up as a discovery. That
    // exact false finding was withdrawn in an earlier sprint and must not
    // return through this layer.
    const seatsCounted = typeof inp.seatsCounted === "number" ? inp.seatsCounted : null;
    const drawsSeats = inp.drawsSeats === true;
    if (rule && seatsCounted != null && drawsSeats) {
      const stated = value("seating capacity the drawing states", rule.total, "printed on the drawing, read by OCR", "verified", ORIGINS.PRINTED);
      const counted = value("seats the detector counted", seatsCounted, "Assisted Detection", "measured", ORIGINS.DETECTED);
      const within = Math.abs(stated.value - counted.value) <= Math.max(3, stated.value * 0.1);
      add("statedSeatsVsCounted",
        `the drawing states ${stated.value} seats; ${counted.value} were counted`,
        within ? VERDICT.CONSISTENT : VERDICT.INCONSISTENT,
        [stated, counted],
        within ? "within a tenth of each other" : `a difference of ${Math.abs(stated.value - counted.value)}`,
        { a: stated.value, b: counted.value, d: Math.abs(stated.value - counted.value) });
    } else if (rule && !drawsSeats) {
      add("statedSeatsVsCounted",
        "the drawing's seating figure cannot be checked against a seat count",
        VERDICT.NOT_CHECKABLE,
        [value("seating capacity the drawing states", rule.total, "printed on the drawing, read by OCR", "verified", ORIGINS.PRINTED)],
        "this drawing shows its tables as symbols and draws no seats, so there is nothing to count against it",
        { a: rule.total });
    }

    // ---- D: what a person confirmed outranks everything above -------------
    for (const h of (inp.humanVerified || [])) {
      if (typeof h.value !== "number" || typeof h.against !== "number") continue;
      add(`humanVerified:${h.id || h.name}`,
        `${h.name}: a person confirmed ${h.value}`,
        h.value === h.against ? VERDICT.CONSISTENT : VERDICT.INCONSISTENT,
        [value(h.name, h.value, "confirmed by a person", "verified", ORIGINS.PERSON),
          value(`${h.name}, as the system had it`, h.against, h.againstSource || "the system", null, ORIGINS.SYSTEM)],
        h.value === h.against ? "and the system agrees" : "and the system does not agree — the person is right",
        { name: h.name, a: h.value, b: h.against });
    }

    const count = (v) => checks.filter((c) => c.verdict === v).length;
    return {
      checks,
      summary: {
        total: checks.length,
        consistent: count(VERDICT.CONSISTENT),
        inconsistent: count(VERDICT.INCONSISTENT),
        needsReview: count(VERDICT.NEEDS_REVIEW),
        notCheckable: count(VERDICT.NOT_CHECKABLE),
      },
      // Said out loud rather than left to be inferred from the absence of a
      // repair step.
      policy: "arithmetic is corroboration; no input is adjusted to make a check pass",
    };
  }

  globalThis.MeritSelfCheck = { version: 2, VERDICT, ORIGINS, run };
})();
