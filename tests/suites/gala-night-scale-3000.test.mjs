// THE GALA NIGHT AT THREE TIMES THE SIZE (3,000 records, 4,500 people,
// 300 tables of 18) — the same evening and the same correctness checks as
// gala-night-scale.test.mjs, timed with median / p95. Budgets here are 2 x the
// worst p95 seen across the measured runs (listed beside each), as the owner
// asked 2026-11-08; regression budgets, not promises.
import { runGala } from "./gala-night-scale.test.mjs";

export const meta = { name: "gala-night-scale-3000", tags: ["business", "performance", "reports", "slow"], timeout: 1800000, downloads: true };

const BUDGET_MS = {
  guestListRender: 95,  // worst p95 46.8 ms
  guestSearchKey: 95,  // worst p95 46.1 ms
  doorSearchKey: 265,  // worst p95 132.4 ms
  seatingAssign: 875,  // worst p95 437.1 ms
  checkInClick: 285,  // worst p95 141.3 ms
  reportExport: 1365,  // worst p95 681 ms
};

export default (ctx) => runGala(ctx, { RECORDS: 3000, TABLES: 300, UNSEATED: 150, CHECK_INS: 600, BUDGET_MS });
