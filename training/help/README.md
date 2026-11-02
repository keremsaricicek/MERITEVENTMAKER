# F8 help: "how do I …" (owner 2026-11-02: "uygulamayı kullanmak için olası bütün soruları ve sorunları bilmeli")

F8 answers a how-to question from the help topics (`src/help-topics.js`, Turkish and English, step by step, with a
"Götür" button that opens the screen). No model is used: a plain matcher over each topic's words.

**Held-out test, written BEFORE the topics' text and the matcher (2026-11-02):** `howto-test.jsonl` — 82 questions,
one Turkish (typed the owner's way) and one English per topic id in `topics.json` (41 topics); sha256 begins
`a779496493369ce5`. Never used to write or tune a topic's words. **Target:** the right topic first for ≥ 0.90 of the
questions in each language; a question with no matching topic says so rather than guessing.
