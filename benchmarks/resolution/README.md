# Resolution — what scaling costs small objects

`node benchmarks/resolution/measure-resolution.mjs` (real app, real detector,
pinned OCR, network refused). It writes `latest.json`. The analysis cap is
overridden through `globalThis.MERIT_ANALYSIS_MAX_SIDE`, which is for
benchmarks only and is clamped to 640–8192. The product default is 1920.

## Measured 2026-10-10

| plan | cap (analysed at) | tables P / R / F1 | chairs on tables | printed numbers right / wrong / unread | time |
|---|---|---|---|---|---|
| Golden 1355×788 | 900 (0.66×) | 0.706 / 0.261 / 0.381 | 39 / 113 | — | 9.0 s |
| Golden | **1355 (native, product default)** | 0.979 / 1.000 / 0.989 | 109 / 113 | — | 8.8 s |
| ORNEK 2402×1719 | 1200 (0.50×) | 0.988 / 0.970 / 0.979 | — | 139 / 0 / 13 | 57.5 s |
| ORNEK | 1600 (0.67×) | 0.982 / 0.982 / 0.982 | — | 140 / 0 / 14 | 60.4 s |
| ORNEK | **1920 (0.80×, product default)** | 0.994 / 0.976 / 0.985 | — | 145 / 0 / 8 | 60.2 s |
| ORNEK | 2402 (native) | 0.964 / 0.970 / 0.967 | — | 143 / 0 / 10 | 63.1 s |

Object sizes (short side, px): the Golden Plan's chairs have a median of 33 and
a minimum of 12 at source. At 0.66× the smallest ones fall to 8 px and the
detector loses most of the room. ORNEK's tables have a median of 78 at source
and 62 at the 1920 cap.

The vision-language overview (2,576 px / 3.59 MP) shows the Golden Plan at
1.0× and ORNEK at 0.93×. No annotated object falls under 12 px on either plan.

## What this decides

- **Detector, below native: real loss.** Downscaling a plan whose chairs are
  already small destroys recall: Golden falls from 1.000 to 0.261. The 1920 cap
  never downsamples a plan up to 1920 px on its long side.
- **Detector, above 1920: no gain on ORNEK.** Native resolution lowered
  precision (0.994 → 0.964) and did not raise recall or read more numbers. The
  cap stays at 1920. No real plan in the benchmark is both larger than 1920 px
  and has symbols small enough to need more resolution, so that case is not
  measured. It waits for the new venues (N1).
- **Model reading.** Both real plans fit the overview at ≥0.93×, so tiles would
  add cost without a measured benefit on them. Tiles are planned only when the
  overview would shrink the detector's smallest object below 12 px
  (`MeritVlmReview.tilePlan`). Their benefit on a real model is unmeasured until
  the pilot.
- Two plans are not a distribution. Every conclusion here is re-checked on the
  new venues (`ACCEPTANCE-602ba27.md`, N1).
