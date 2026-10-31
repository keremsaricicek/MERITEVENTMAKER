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
