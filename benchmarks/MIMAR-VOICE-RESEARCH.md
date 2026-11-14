# Mimar (F8) — voice command and opt-in web research: design note

2026-11-07. Groundwork only: the relay endpoints, two page modules that `index.html`
does NOT load yet, a scripted test suite and one honest measurement. The assistant's
panel is being rewritten; wiring the microphone button and the "search the web" action
into it is a later, separate step.

## 1. Voice command

**What.** A microphone button in the F8 box. Speech becomes **text in the box**; the
person reads it and presses Enter. Voice never acts by itself: the F8 rules / reader and
the app's writers stay the only path to the plan, so a misheard word costs a re-say,
never a wrong change.

**How.**
- Page: `src/voice-input.js` (`MeritVoiceInput`) — `getUserMedia` → `MediaRecorder` →
  `decodeAudioData` → 16 kHz mono → 16-bit WAV → `POST /vlm-relay/listen?lang=tr|en`
  (same origin). Releases the microphone at stop/cancel; keeps nothing.
- Relay: `server/voice-listener.mjs` — runs **whisper.cpp** (`whisper-cli`, MIT) with a
  **multilingual Whisper GGML model** (MIT), both pinned by size + sha256 in a
  `merit-local-voice/1` manifest (`MERIT_VOICE_MANIFEST`). No shell, stripped
  environment (no proxy, no PATH), 30 s cap, temp clip deleted in every outcome, the
  words never logged. Off without a manifest (`VOICE_OFF`).
- Why whisper.cpp: one native exe + DLLs, CPU-only, no Python/Node for the end user, MIT,
  Turkish and English in one model, same GGML family as the llama.cpp the package
  already ships. Rejected: Vosk (Apache-2.0, very light, but its small Turkish model is
  old and weak), Moonshine (no Turkish), browser Web Speech API (sends audio to Google /
  Microsoft — not offline), cloud STT (not offline).

**Measured** (pre-registered bar: `training/README.md` "Voice command (Mimar)"; FLEURS
test clips, CC-BY-4.0, real read speech; this machine was running a training job, so
speeds are an UPPER bound, 2 threads, `nice 19`): see §4.

**Limits.** FLEURS is read Wikipedia text, not the owner's commands, voice or room. Names
are the hard part (an unusual surname may be spelled several ways) — the box shows the
text before anything happens, and the guest finder already tolerates typos. Mixed
Turkish/English in one sentence is not measured. Speed on an 8 GB PC is not yet measured.

## 2. Web research (opt-in)

**What.** The person asks a general question (a venue's capacity, an artist, a
supplier) and gets up to five links with short snippets, shown as text marked "from the
web". Nothing from the web is written into the event.

**How — the safe path agreed with the owner.**
- **OFF by default.** The relay searches only when ITS environment has all three:
  `MERIT_WEB_RESEARCH=on`, `MERIT_SEARCH_PROVIDER=brave|tavily`, `MERIT_SEARCH_KEY=…`.
  A key alone does not turn it on; on without a key → `SEARCH_NO_KEY`, said plainly.
- **A person starts each search.** `MeritWebResearch.prepare()` shows the exact words
  that would leave; `send()` is called from that person's click, once.
- **No guest data leaves.** Only `{ query }` is sent. `prepare()` removes every guest name
  of the open event (accent/case-blind, with Turkish endings), phones, e-mails, Turkish
  ID / IBAN, long digit runs; the relay **refuses** (`PRIVATE_DATA`) anything still
  carrying those patterns instead of sending it. No event, plan, cookie or referrer.
- **Through the relay only**, to the provider's one fixed host, redirects refused,
  15 s timeout, one at a time, a daily cap (`MERIT_SEARCH_MAX_PER_DAY`, default 30).
- **The key** lives only in the relay's environment: never in `src/`, a reply, the status,
  a log line or a commit. Provider errors come back as codes, not provider text.
- Results: ≤ 5, plain text (HTML stripped), http(s) links only, the key scrubbed even if
  a provider echoes it.

**Limits.** The name filter knows the open event's guests; a name the person types that
is NOT a guest (e.g. a supplier's private phone is caught, a stranger's name is not) is
sent as typed — the preview is the person's last check. Search answers are someone
else's text and can be wrong or out of date; they are never presented as the product's
knowledge.

## 3. Tests

`tests/suites/mimar-voice-research.test.mjs` — **SCRIPTED** (a shell-script engine, a fake
provider fetch; a tripwire fails the suite if any request leaves loopback). 52 checks;
two deliberate mutations (privacy refusal removed, engine given the full environment)
each fail it. It proves the plumbing and the privacy rules, **never** recognition or
search quality.

## 4. Measured numbers

`tools/local-voice/measure-fleurs.mjs`, report `benchmarks/voice/fleurs-2026-11-07.json`.
Bars written first (`training/README.md`): Turkish WER ≤ 0.20, English WER ≤ 0.12.

| model (whisper.cpp v1.9.5) | size | TR WER (CER), 40 clips / 663 words | EN WER (CER), 20 clips / 430 words | median decode, 2 threads, under load |
|---|---|---|---|---|
| `ggml-base-q5_1` | 60 MB | **0.309** (0.081) — FAILS | 0.116 (0.065) — passes | ~4 s per clip |
| `ggml-small-q5_1` | 190 MB | **0.163** (0.042) — passes | 0.084 (0.048) — passes | ~11–12 s per clip |
| `ggml-large-v3-turbo-q5_0` | 574 MB | not run (the rule stops at the smallest passing model) | — | — |

**Chosen: `ggml-small-q5_1`** (sha256 `ae85e4a9…20411bb`, 190,085,487 bytes). Turkish errors are
mostly endings and punctuation-adjacent spellings ("değişikler" for "değişiklikler"), and
foreign acronyms; ±3–4 points on this sample size. **Speed is not yet known on the target**:
here a training job held all four cores and the engine ran at `nice 19` on 2 threads; the
decode time is dominated by Whisper's fixed 30 s window, so a 5 s command costs about the
same as a 12 s sentence. The decisive check (≤ 5 s for a 5 s command, 4 threads) is on the
owner's PC. A shorter window (`-ac`) would be faster but is a NEW candidate: it needs its
own bar written first, not a change to this result.

Not done here: the Windows `whisper-cli.exe` + DLLs were not downloaded (GitHub release
API blocked from this machine); the voice manifest for the package pins them at package
build, the same way the llama.cpp files are pinned.

## 5. What the owner must decide

1. **Voice model size** (§4): the smallest model that passes is the default; a bigger one
   is more accurate but slower and larger in the package.
2. **Record the 20-command owner test** on his own PC (second stage of the bar): ≥ 17 of
   20 need no correction before Enter.
3. **Web search: on or off, and which provider.** Both cost money beyond a small
   allowance (as published, 2026, to be re-checked before paying):
   - **Brave Search API** — own independent index; metered, about **$5 per 1,000
     searches**, with a monthly **$5 credit** (≈ 1,000 searches) per account; standard
     plans keep query logs up to 90 days (zero retention only on Enterprise).
   - **Tavily** — built for assistants; **1,000 free credits a month**, no card; then
     about $0.008 per credit (a basic search is 1–2 credits).
   Either needs an account and a key the owner creates; the key goes into the relay's
   environment on the event PC, never into the app or a file in the repo.
4. **Daily cap** (default 30 searches) — protects against a surprise bill.
