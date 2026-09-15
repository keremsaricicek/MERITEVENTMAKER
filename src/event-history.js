// EVENT HISTORY & LEARNING — what an operator's own past events show, never
// what a model predicts.
//
// "Learning" here means exactly what it means everywhere else in this
// product (the Teach Area, the captured-decision log): an operator reading
// real numbers from their own past, never a trained model. This module
// fits no engine of its own and reads no plan pixels — it only takes
// per-event facts src/arrival-wave.js and app-v8.js's own eventMetrics()
// already computed, and averages them honestly.
//
// TWO RULES:
//
//   NULL MEANS NO DATA, NEVER ZERO. A historical event with no tables yet
//   (or no guests) contributes no utilization figure — reporting 0% would
//   claim an empty room was used, when the truth is nothing is known.
//
//   AN AVERAGE NAMES ITS OWN SAMPLE SIZE. Averaging two of twenty events
//   because the other eighteen carry no capacity yet is honest arithmetic,
//   but only if the screen says "across 2," never "across your history."
(function () {
  "use strict";

  // One completed event's real outcome, from facts already computed
  // elsewhere (eventMetrics()'s totalPax, MeritArrivalWave's actual.pax and
  // noShow.pax/records, physicalCapacity()) — this function derives nothing
  // any of those modules did not already establish.
  function outcome({ totalPax, actualPax, capacity, noShowPax, noShowRecords } = {}) {
    const tp = Number(totalPax) || 0;
    const ap = Number(actualPax) || 0;
    const cap = Number(capacity) || 0;
    const nsPax = Number(noShowPax) || 0;
    return {
      totalPax: tp,
      actualPax: ap,
      capacity: cap,
      utilization: cap > 0 ? Math.min(1, ap / cap) : null,
      noShowPax: nsPax,
      noShowRecords: Number(noShowRecords) || 0,
      noShowRate: tp > 0 ? nsPax / tp : null,
    };
  }

  // Plain arithmetic mean across whichever outcomes actually carry the
  // figure — never a weighted or decayed average, and never a projection
  // past this data.
  function mean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  function learning(outcomes) {
    const list = (Array.isArray(outcomes) ? outcomes : []).filter(Boolean);
    const withUtilization = list.filter((o) => o.utilization !== null && o.utilization !== undefined);
    const withNoShow = list.filter((o) => o.noShowRate !== null && o.noShowRate !== undefined);
    return {
      eventsConsidered: list.length,
      averageUtilization: mean(withUtilization.map((o) => o.utilization)),
      utilizationSampleSize: withUtilization.length,
      averageNoShowRate: mean(withNoShow.map((o) => o.noShowRate)),
      noShowSampleSize: withNoShow.length,
      statement: "measured from your own completed events; nothing here is predicted",
    };
  }

  globalThis.MeritEventHistory = { version: 1, outcome, learning };
})();
