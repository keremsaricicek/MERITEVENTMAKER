# Blind plans (never trained on, never tuned on)

## golden2.pdf — the third real plan ("Golden 2", owner, 2026-10-31)

- Source: the owner's own scan (one A4 page, Epson Scan 2, scanned 2026-10-29), sent in
  the session on 2026-10-31; named "Golden 2" by the owner. sha256
  `f8500be7c673ff58465e0f84d4a2a78ea1177637eabfceaa7af12df0c1aa3c1e`.
- **Frozen as the final blind exam.** Committed before anyone looked at its content.
  Until the exam it is not opened for development: no training example, no detector or
  threshold change, no generator change is made from it.
- **The exam (owner: "after everything, one complete exam on it"):** after the last
  model and code of this round are fixed, (1) its ground truth is written — tables
  (number, kind), chairs per table, seat capacity — and the owner confirms the counts;
  (2) the product reads it ONCE, as shipped (classical detection + the trained detector +
  the wired local model's second look and what it applies by itself), and the result is
  scored against that truth: tables found / missed / phantom, chairs per table, seat
  count, grouping, what a person would still have to fix; (3) the result is reported as
  measured, the first unseen-venue score. Only after that may it become training data.

## Golden 2 — exam result (2026-10-31, read once by the product as shipped)

Raw: `benchmarks/offline-intelligence/golden2-exam/result.json`, screenshot `after.png`. Shipped
offline package (`dist/merit-offline`, OCR included), classical detection + trained detector,
the wired local model (runB6d) on its second look. This 4-core cloud CPU, no GPU, trainer paused.

| | truth (hand count) | product | |
|---|---|---|---|
| tables | 27 (4 round, 22 square, 1 long) | **23** (3 round, 20 square, 0 long) | 85 % found, 0 phantom tables seen |
| chairs seated at their table | 68 | **49** | 72 % |
| chairs found but not tied to a table | – | 20 | a person ties them |
| banquettes | 3 | 2 | |
| dining groups | 14 | 11 | |
| left for a person | – | 6 decisions + 2 questions | |
| time to the plan on screen | – | **17 s** | second look: nothing to ask, 0 s |

Missed: one round table of the two by the entrance (and its 5 chairs), the long 8-seat table
(its chairs found as loose chairs), two square tables. The second look did not start: the
analysis left no grouping in doubt, and the wired model is measured only on grouping.
**First attempt:** the exam script waited for a second look that never started and timed out
after 58 min without recording a result (harness fault; fixed to stop when none starts). The
reading above is the first one that was recorded. Golden 2 is now SEEN.
