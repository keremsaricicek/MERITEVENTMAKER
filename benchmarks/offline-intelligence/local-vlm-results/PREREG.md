Local VLM pre-registration, 2026-10-17, written before any real inference.
A candidate is USEFUL (wired into the offline flow, uncertain regions only) only if ALL hold at 4 threads:
  T1 generated furniture (sofa/bench/banquette) accuracy >= 0.80
  T1 real-plan accuracy (Golden + ORNEK crops) >= 0.80
  fabrication on generated negative crops <= 0.05
  T2 over-count rate <= 0.10
  median seconds per crop <= 10, peak server RSS <= 3000 MB
Otherwise: recorded as measured, not wired. Same crops (seed 5) for every model.
Sat Oct 17 18:09:27 UTC 2026
