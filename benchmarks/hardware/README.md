# On a weak machine — 2 CPU cores, no GPU

`taskset -c 0,1 node benchmarks/hardware/measure-constrained.mjs 3` runs the
real app in headless Chromium, pinned to two cores, three times per plan:
analyse the plan, read it, open the reading and the digital view. Memory is
the **PSS** of every browser process, summed and sampled every 100 ms. PSS
splits shared libraries fairly between processes; the first attempt summed
RSS and counted them once per process, about 1.5 GB for the same run. Results
go to `constrained-latest.json`.

## Measured 2026-10-10 (this container: 2 of 4 cores, no GPU, 15 GB)

| plan | analyse (median / p95) | read the plan | whole browser, peak PSS | page JS heap, peak |
|---|---|---|---|---|
| Golden (1355×788, drawn chairs) | **10.4 s** / 10.6 s | 6–9 ms | **1.07 GB** (1.05–1.09) | 35–40 MB |
| ORNEK (2402×1719, 166 symbols, OCR on 230 words) | **50.2 s** / 52.3 s | 13–30 ms | **1.43 GB** (1.40–1.45) | 62–84 MB |

## What this says about an 8 GB Windows laptop with no graphics card

- **Memory fits.** The whole browser peaks at about 1.4 GB while analysing the
  heaviest real plan, and the app's own heap stays under 100 MB. Windows and a
  browser leave several GB free on 8 GB.
- **Time is a wait, not a failure.** About 10 s for a drawn-chair plan and about
  50 s for a 166-symbol plan with OCR on two cores. Analysis runs once per plan
  version; reading it back and switching to the digital view take milliseconds.
- **Not measured: a real Windows laptop.** This is Linux headless Chromium
  pinned to two cores of a server CPU. A low-power laptop CPU may be slower per
  core. The figure to confirm on the target machine is the ORNEK analysis time.
  A person can do that on the target machine; it is not simulated here.
