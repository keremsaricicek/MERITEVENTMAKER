# Real operator test kit

The thing you carry into the room.

`README.md` next to this file is the *rationale* — why this test exists, what
is instrumented, which two failure modes it hunts. Read it once, before the
day. This file is what you actually run from: what to have ready, what to say
out loud, what to write while it happens, and what to do the moment it ends.

## Status: **NOT RUN.** No person has performed this session.

Nothing in this repository may be read as saying the product works for someone
doing this job. This kit's existence is not evidence that it does. See
`HUMAN-TEST-CONTRACT.md` for exactly what may and may not be reported
afterwards — read that *before* the session, not after, because it constrains
what you need to have written down while it was happening.

---

## Before the day

**1. Build the artifact they will actually use.**

```
node scripts/build-offline-full.mjs
node benchmarks/offline/verify-offline-package.mjs   # must be 27/27
```

Use `dist/merit-offline/`, not `npm run serve`. The folder build is the one
with real offline OCR, and OCR is load-bearing on the symbolic plan (Session B)
— running B against a build that reports OCR unavailable tests a product the
operator will never be given.

**2. Verify the machine is offline-capable and then take it offline.**

The verifier already proves the package makes zero off-origin requests. Pull
the network anyway, for the session. It removes a whole class of "was it
uploading my venue's floor plan?" question from the room, and it is the
condition the product claims to work under.

**3. Start from genuinely blank state.** A fresh browser profile, or clear the
site data. An operator who opens the app and finds somebody else's event is
being tested on a different product.

**4. Have both plans ready as files**, not on screen:

| | Session A | Session B |
|---|---|---|
| file | `benchmarks/plans/merit-real-venue-plan.png` | `benchmarks/plans/ORNEK.pdf` |
| representation | **PHYSICAL** — draws its chairs | **SYMBOLIC** — numbered circles |
| capacity means | counted from chairs the detector found | a figure the drawing prints about itself |

**5. Confirm today's "known before the session" list is empty**, by re-reading
that section of `README.md` and checking it against the current build. A stale
entry tells you in advance to ignore the thing you came to see.

**6. Two people.** One operator, one observer who writes. The observer does not
help, does not answer product questions, and does not touch the machine. If you
are alone, record audio with consent and transcribe — but a second person is
better, because the questions below need judgement in the moment.

---

## Who the operator must be

- Does event or banqueting operations for a living. Not a developer, not a
  designer, not somebody who has watched a demo.
- **Has not been shown this screen before.** Whether it explains itself is most
  of what is being measured, and it can only be measured once per person.
- Is willing to be watched working, and has been told what is recorded (below).

One person does both sessions, B second. Whether the second is faster is itself
evidence, and whether the *symbolic* one is harder is the question the two-plan
work exists to answer.

## What you say out loud

Read this. Do not improvise it, and do not add to it.

> This is software for getting a venue floor plan into a system so you can seat
> guests on it. I'm going to give you a floor plan file and ask you to get it
> into the system correctly. I'm not going to explain the screen — how clear it
> is, is what we're trying to find out. There's no wrong way to do this and
> nothing you do can break anything.
>
> The software records what you click and how long things take, on this machine
> only. It doesn't send anything anywhere — the machine is offline. I'll show
> you the recording at the end if you want to see it.
>
> Please think out loud where you can. If you get stuck, say so, and stay stuck
> for a bit before asking me — me answering is the thing that would spoil it.
>
> Ready? Here's the plan. **Get this floor plan into the system correctly.**

Then **stop talking.**

### When they ask you something

They will. The rule:

| they ask | you say |
|---|---|
| "What does this button do?" | "What do you think it does?" — then silence. Write down both their guess and whether they pressed it. |
| "Am I doing this right?" | "There's no right way — do what you'd do." |
| "Is it supposed to take this long?" | "I can't say. Carry on when you're ready." |
| "What's a *disagreement*?" | Nothing. Write the question down verbatim — a product term the operator has to ask about is a finding. |
| "Can I stop?" | "Yes, any time." Then ask why, and write it down. **Stopping is data, not failure.** |
| anything about *their own* domain ("do these two tables count as one?") | Answer honestly — that is their expertise, not the product's UI. |

The only reason to break the script is safety or genuine distress. If you
intervene, write down exactly when and what you said; that session's later
numbers are contaminated from that point and must be reported as such.

---

## While it runs — the observer's sheet

Timestamps matter more than prose. Write the clock time next to anything you
note; the session report gives you its own timings and the two together are
what let you say *when* something happened relative to what the product did.

```
SESSION ___ (A / B)      plan ____________      date __________
operator (role, not name) ____________________  observer _______

t=0  app opened

CLOCK  WHAT HAPPENED / WHAT THEY SAID (verbatim where you can)
_____  ________________________________________________________
_____  ________________________________________________________
_____  ________________________________________________________
_____  ________________________________________________________
_____  ________________________________________________________
_____  ________________________________________________________

first time they said something was wrong/confusing:  t=____
first time they asked you a question:                t=____
did you break script? (when, what you said) _____________________
where they stopped, and why: ____________________________________
```

Three things to catch in the moment, because the report cannot:

1. **What they looked at and did not click.** The recording sees actions, not
   attention. If they read the Worth deciding list and then went to the canvas
   anyway, that is the "right and unused" failure mode and only you can see it.
2. **Their words for product concepts.** If they call a *disagreement* "the
   thing that's arguing with itself", write it exactly. Their vocabulary is the
   most useful output of the whole session.
3. **Hesitation before an irreversible-looking control.** Especially "apply to
   all". Whether it reads as one decision or as a risk is question 6.

---

## Session C — the event, end to end

Sessions A and B test getting a plan in. Session C tests running the night on
it. Same operator, after B, on the event B produced (or A's, if B was not
completed — write down which). Hand over **one task card at a time**, read the
card aloud, then stop talking; the observer's sheet and the "when they ask"
rules above apply unchanged.

The guest list is `benchmarks/operator/session-c-guests.SYNTHETIC.csv` —
**SYNTHETIC**, written for this session, not a real guest list. It carries the
traps on purpose: a guest with three companions (one record, pax 4), two
different people called Ayşe Demir, a duplicated Sofia Rossi row, a
companion count written "three", a negative one, a row with no name, and a
table (T99) that is not on the plan. Measured 2026-10-03 through the real
wizard: 20 records, 43 pax, 8 rows flagged, 4 of them blocking until fixed.
That is what the observer should see at the end of task C3 — the operator is
not told it.

| # | task card (read aloud) | done when | observe |
|---|---|---|---|
| C1 | "This is your first time in the product. Find your way to a new event." | an event exists | onboarding: did the empty states tell them where to go? |
| C2 | "Save your work, close the browser tab, and open the event again." | the event reopens with its plan | did they look for a save button? did they trust it? |
| C3 | "Import this guest list." | records imported, or they stop | each trap: noticed? fixed how? did "+3" read as one guest? |
| C4 | "Find Mehmet Yılmaz. Then find Sofia Rossi." | the guest's row is open | the finder; what they typed (keyboard, spelling, caps) |
| C5 | "Seat everyone you can. Keep Mehmet Yılmaz's party together." | guests seated | Seating and Smart Seating; was the advice read or ignored? |
| C6 | "The head table must not change from now on. Make sure nobody can move people there by accident." | a freeze exists | the freeze — found? understood as a rule about a place? |
| C7 | "Is this event ready to run? What would stop it?" | they give an answer | the Plan Doctor / readiness — did they find it, and believe it? |
| C8 | "Doors are open. Check in the first five guests." | five checked in | Live; the door search; keyboard vs mouse |
| C9 | "Zeynep Kaya will not come tonight." | marked No Show | did they look for "delete"? did the seat stay planned? |
| C10 | "A walk-in has arrived: Kemal Er, alone. Seat him and check him in." | walk-in seated and in | **there is no walk-in control** — how did they do it, and how long did it take? |
| C11 | "Elif Arslan (VVIP) must move closer to the stage, now." | she is moved | move during live; did the freeze or a lock stop them, and did they understand why? |
| C12 | "Table [pick one with guests] has just broken. Deal with it." | table unavailable, guests relocated | stranded guests found? relocated through Seating? |
| C13 | "Take a backup. Then restore it." | restored | did they find it; did the confirmation reassure or alarm? |
| C14 | "Send this event to a colleague as a file." | package exported | event package — found under which name? |
| C15 | "Leave a note for the next shift: what they need to know." | a handover note | handover — found? |
| C16 | "The night is over. Show what happened, and when." | replay viewed | post-event replay — found? readable? |

Write the clock time at the start and end of each card. A card abandoned is
recorded as abandoned, with why, and the next card is handed over.

### The second round — after the fixes

`HUMAN-TEST-CONTRACT.md` decides which findings oblige a code change. **When
those changes ship, Session C is run again** — with a *different* operator who
has not seen the product, on the rebuilt artifact, with the same cards and
the same CSV. Only that second round can say a fix worked: the first
operator has learned the screen and would find it easier either way. Until
the second round has happened, a fixed finding is reported as **FIXED, NOT
RE-VERIFIED**, never as resolved.

---

## The moment it ends

**Open the session report first, before you talk about it.**
`Advanced Diagnostics → Session report`, on the review screen.

It fills in: Import → Confirm, analysis time, review time, time to first
action, action count, how many landed on the suggested queue,
`firstActionWasTopOfQueue`, what is still unreviewed, what the analysis held
back, open disagreements, and whether the plan was confirmed. It reports and
**does not grade** — there is no "good" review time and inventing one would be
the overclaiming this product refuses everywhere else.

Copy it out before you close the app. It lives in `state.operatorSessions` and
a cleared profile takes it with it.

**Then ask the 14 questions** printed on that same page (they are listed in
full in `README.md` and are not duplicated here, so there is one copy to keep
correct). Ask them in order. Write answers verbatim — especially 4, 9, 12 and
13, where the value is entirely in their wording and a paraphrase destroys it.

Two you must not skip even though they feel rude:

- **9. What did they look for and not find?** The only question in the set that
  can surface a missing feature rather than a confusing one.
- **10. Would they use this instead of what they do now?** Ask for the reason,
  not the yes/no. "No, because I'd still have to check every table by hand
  anyway" is worth the entire session.

**Finally, show them the recording** if they asked to see it. You promised.

---

## What you have at the end

Per session: one report (copied out), one observer sheet, 14 answers. Both
sessions: the same again, plus whether B was faster than A and whether the
symbolic plan was harder. Session C: the sixteen cards' start/end times,
what was abandoned and why, and the observer's notes per card.

That is the input to `HUMAN-TEST-CONTRACT.md`, which governs what happens to it
— how a finding is classified, what obliges a code change, and what may be
written in a status line. Do not write a verdict before reading it.
