// WHEN ARE THEY COMING, AND WHEN DID THEY ACTUALLY COME?
//
// Two axes, and the whole module exists to keep them apart.
//
//   EXPECTED is what somebody stated. It is not a prediction, not a model
//   output and not a distribution this product inferred from anything. A guest
//   has a stated arrival window because a person typed one, or the guest has
//   none. When nobody has stated one, the expected axis DOES NOT EXIST and
//   every bucket reports null rather than zero — zero is a claim about the
//   evening, null is the truth about the data.
//
//   ACTUAL is what happened. A guest who has been checked in carries the
//   moment it happened, and that is the only source for the actual curve.
//
// THIS MODULE DOES NOT FORECAST. There is no field for a projection, no
// extrapolation past the last real figure, and `forecast: null` is returned in
// the object itself so that no caller can present one. "310 guests expected in
// the next 20 minutes" would need a model that does not exist; a product that
// says it anyway is guessing at the one thing an operator would act on.
//
// Three smaller rules follow from the domain:
//
//   A NO SHOW IS NEVER AN ARRIVAL. It is counted, separately, and never
//   reaches a bucket. The two statuses are different facts about the evening.
//
//   A PARTY IS ONE RECORD AND N PEOPLE. Every figure is reported both ways —
//   an operator at a door thinks in people, a planner thinks in records.
//
//   A CHECK-IN WITHOUT A TIME IS NOT GUESSED AT. Data imported before arrival
//   times were recorded, or restored from an older backup, has a status and no
//   moment. Those records are counted in the total and reported as untimed
//   rather than dropped into a bucket the module invented for them.
(function () {
  "use strict";

  // How much of the room has a stated window. Named rather than a ratio: the
  // difference between "nobody stated one" and "a third of them did" changes
  // what the screen may say, and a percentage would invite reading it as
  // confidence.
  const COVERAGE = {
    NONE: "NONE",           // no expected axis exists
    PARTIAL: "PARTIAL",     // some guests stated a window
    COMPLETE: "COMPLETE",   // every guest record stated one
  };

  const CHECKED_IN = "Checked In";
  const NO_SHOW = "No Show";
  const NOT_ARRIVED = "Not Arrived";

  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);
  const isVip = (g) => g && (g.vip === "VIP" || g.vip === "VVIP");
  const pad = (n) => String(n).padStart(2, "0");

  // "HH:MM" -> minutes past midnight, or null. Deliberately strict: a field an
  // operator half-typed must not become a point on a timeline.
  function minutesOfClock(value) {
    const m = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*$/.exec(String(value == null ? "" : value));
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }
  const clockOfMinutes = (mins) => `${pad(Math.floor(((mins % 1440) + 1440) % 1440 / 60))}:${pad(((mins % 60) + 60) % 60)}`;

  // A stored timestamp -> minutes past midnight in the operator's own timezone,
  // which is the timezone the door is standing in.
  function minutesOfStamp(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return isFinite(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
  }

  const empty = (extra) => ({ records: 0, pax: 0, vipPax: 0, guestIds: [], ...extra });
  function addTo(tally, g) {
    tally.records += 1;
    tally.pax += paxOf(g);
    if (isVip(g)) tally.vipPax += paxOf(g);
    tally.guestIds.push(g.id);
  }

  // ---------------------------------------------------------------------------

  function build(input) {
    const inp = input || {};
    const guests = Array.isArray(inp.guests) ? inp.guests : [];
    const step = [15, 30, 60].includes(Number(inp.bucketMinutes)) ? Number(inp.bucketMinutes) : 30;

    const stated = [], arrived = [], untimedArrivals = [];
    const noShow = empty(), notArrived = empty(), vipStillExpected = empty();
    let totalRecords = 0, totalPax = 0;

    for (const g of guests) {
      if (!g) continue;
      totalRecords += 1;
      totalPax += paxOf(g);

      const window = minutesOfClock(g.expectedArrival);
      if (window !== null) stated.push({ guest: g, minutes: window });

      if (g.arrivalStatus === CHECKED_IN) {
        const at = minutesOfStamp(g.checkedInAt);
        if (at === null) untimedArrivals.push(g);
        else arrived.push({ guest: g, minutes: at });
      } else if (g.arrivalStatus === NO_SHOW) {
        // Counted, and never a point on the arrival curve.
        addTo(noShow, g);
      } else {
        addTo(notArrived, g);
        if (isVip(g)) addTo(vipStillExpected, g);
      }
    }

    const statedRecords = stated.length;
    const statedPax = stated.reduce((n, s) => n + paxOf(s.guest), 0);
    const coverage = statedRecords === 0 ? COVERAGE.NONE
      : statedRecords === totalRecords ? COVERAGE.COMPLETE : COVERAGE.PARTIAL;
    const expectedAxis = coverage !== COVERAGE.NONE;

    // The span comes from the data. There is no default evening, no assumed
    // door time and no window this module invented to have something to draw.
    const points = [...stated.map((s) => s.minutes), ...arrived.map((a) => a.minutes)];
    const buckets = [];
    if (points.length) {
      const lo = Math.floor(Math.min(...points) / step) * step;
      const hi = Math.floor(Math.max(...points) / step) * step;
      for (let m = lo; m <= hi; m += step) {
        buckets.push({
          key: clockOfMinutes(m), fromMinutes: m,
          from: clockOfMinutes(m), to: clockOfMinutes(m + step),
          // null, not zero: a bucket with no expected axis is not a bucket
          // where nobody is expected.
          expected: expectedAxis ? empty() : null,
          actual: empty(),
        });
      }
      const index = new Map(buckets.map((b) => [b.fromMinutes, b]));
      const slot = (mins) => index.get(Math.floor(mins / step) * step) || null;
      if (expectedAxis) for (const s of stated) { const b = slot(s.minutes); if (b) addTo(b.expected, s.guest); }
      for (const a of arrived) { const b = slot(a.minutes); if (b) addTo(b.actual, a.guest); }
    }

    const arrivedPax = arrived.reduce((n, a) => n + paxOf(a.guest), 0);
    const untimedPax = untimedArrivals.reduce((n, g) => n + paxOf(g), 0);
    const stamps = arrived.length ? arrived.map((a) => a.guest.checkedInAt).filter(Boolean).sort() : [];

    return {
      version: 1,
      bucketMinutes: step,
      expected: {
        available: expectedAxis,
        coverage,
        statedRecords, statedPax, totalRecords, totalPax,
        // Said rather than implied, because a screen that shows an expected
        // curve covering a third of the room without saying so is worse than
        // one that shows none.
        why: expectedAxis ? null : "no guest record carries a stated arrival window",
      },
      actual: {
        records: arrived.length + untimedArrivals.length,
        pax: arrivedPax + untimedPax,
        timedRecords: arrived.length, timedPax: arrivedPax,
        untimedRecords: untimedArrivals.length, untimedPax,
        untimedGuestIds: untimedArrivals.map((g) => g.id),
        firstAt: stamps[0] || null, lastAt: stamps[stamps.length - 1] || null,
      },
      noShow: { records: noShow.records, pax: noShow.pax },
      notArrived: { records: notArrived.records, pax: notArrived.pax },
      // The VIPs still outside. The one group whose lateness costs the most to
      // discover at the door rather than on a screen.
      vipStillExpected: {
        records: vipStillExpected.records, pax: vipStillExpected.pax,
        guestIds: vipStillExpected.guestIds,
      },
      buckets,
      // Said in the object itself so no caller can present one.
      forecast: null,
      statement: "expected is what a person stated; actual is what happened; nothing here is predicted",
    };
  }

  globalThis.MeritArrivalWave = {
    version: 1, COVERAGE,
    build, minutesOfClock, clockOfMinutes, minutesOfStamp,
  };
})();
