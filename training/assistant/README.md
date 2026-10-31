# F8 assistant — fixture and test sets (frozen 2026-10-27, before any model saw them)

`fixture.json`: four invented events (three past concerts, one upcoming gala —
the current event), overlapping guests, a name shared by two people (Ayşe Demir,
different phones), No Shows, a +2 party. `questions.jsonl` (20): the expected tool
chain and the facts the answer must carry (or `ask` / `none`). `commands.jsonl`
(15): the writer calls a command must produce, or `ask` / `refuse`. Bars
(AI-PLANNER-DESIGN.md §11–§12): right tool chain ≥ 90 %; when the chain is right
the answer matches the data 100 %; commands: right calls ≥ 95 % and **no wrong
change** (a wrong guess must be a question); every command undone by one undo.
