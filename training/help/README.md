# F8 help: "how do I …" (owner 2026-11-02: "uygulamayı kullanmak için olası bütün soruları ve sorunları bilmeli")

F8 answers a how-to question from the help topics (`src/help-topics.js`, Turkish and English, step by step, with a
"Götür" button that opens the screen). No model is used: a plain matcher over each topic's words.

**Held-out test, written BEFORE the topics' text and the matcher (2026-11-02):** `howto-test.jsonl` — 82 questions,
one Turkish (typed the owner's way) and one English per topic id in `topics.json` (41 topics); sha256 begins
`a779496493369ce5`. Never used to write or tune a topic's words. **Target:** the right topic first for ≥ 0.90 of the
questions in each language; a question with no matching topic says so rather than guessing.

**First and only measurement (2026-11-02 ~03:20 UTC), `node training/help/score.mjs`:** Turkish 38 / 41 = **0.927**,
English 38 / 41 = **0.927** — the 0.90 target met in both. Caveat, stated plainly: the same person (Claude) wrote the
test questions and, after them, the topics' words — a bias no held-out split removes. The owner's own questions are
the real test; misses he meets become new topics' words, and the next held-out set is written before that.
