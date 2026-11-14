# Before the owner's Windows trial — the whole list

Nothing here is "done" because a script ran; each line is done when the check in its last column was **run on
the built package** and its result written next to it. The owner tries nothing until every line is done and he
is told "al dene" (owner, 2026-11-01). Still forbidden until he types **EXE YAP**: EXE, installer, Electron.

Owner's answers (2026-11-01): every work PC differs → any 64-bit Windows 10/11 with 8 GB RAM, no GPU assumed,
Intel; installed wherever is best, **no admin rights**; no existing data to migrate; delivery through GitHub.

| # | Area | Must be true | How it is checked |
|---|---|---|---|
| 1 | CPU | Runs on every x64 CPU: llama.cpp CPU build chosen at run time (AVX2 / AVX / SSE fallback); Vulkan GPU only after a CPU check passes | Start with `--cpu` variants forced one by one; each answers the F8 sample |
| 2 | Paths | Works from a folder with Turkish letters and spaces (`C:\Users\Şükrü Öz\Masaüstü\MERİT Etkinlik`) | Build, copy there, start, F8 + plan reading |
| 3 | No admin | Nothing written outside the package folder except the browser's own profile; no PATH, no service, no registry | Process Monitor-free check: list files changed after first start |
| 4 | SmartScreen | BENIOKU shows, with a picture, "Ek bilgi → Yine de çalıştır" (no paid signing) | Read BENIOKU on a clean Windows; follow it word by word |
| 5 | Fixed address | Always `http://127.0.0.1:<fixed port>` (browser storage is per address); a taken port is reported, never silently changed | Start twice; block the port; read the message |
| 6 | Data safety | Disk backup to `data/` on every save (src/disk-backup.js); restore from it after clearing the browser | Clear site data → restore → events identical |
| 7 | Memory | Peak RAM with chat model + plan model + Edge + Windows under 8 GB | Task Manager peak during F8 + plan reading together |
| 8 | Browser | Works in Edge (default on work PCs) and Chrome | Full operator task list in both |
| 9 | First start | Time to ready measured; a progress text while models load | Stopwatch from double-click to F8 answering |
| 10 | Update | New version replaces program files, never `data/`; keeps settings | Install v1, add data, apply v2, data intact |
| 11 | Diagnosis | One click makes a report (versions, CPU flags, RAM, ports, last errors) with **no guest data** | Open the report, search for a guest name: none |
| 12 | Online mode | OFF by default; paid reading only on the owner's explicit yes | Fresh package: setting is off |
| 13 | Licences | Licence text of every shipped part (llama.cpp, Qwen, OCR, SheetJS, pdf.js …) in `LICENCES/` | List shipped parts vs files |
| 14 | Both languages | Every screen and every F8 reply in Turkish and in English | Switch language; run the operator tasks in both |
| 15 | Owner's checklist | Ten steps in plain Turkish: start, open event, import guests, read plan, seat with F8, live, report, backup, close, reopen | Walk it on the built package before sending |

Order after this list: final full exam (`npm run test:all`, offline builds + verify, F8 race, plan benchmark) →
one short "ready" report → "al dene".
