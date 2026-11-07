// MERIT Event Maker — finding more of a symbol a person confirmed
// (MeritPlanExemplar). Pure: grey pixels in, places out. No DOM, no shell state.
//
// This is "local examples as evidence", the second of the three kinds of
// learning the product keeps apart:
//   1. decision memory  — the same object on the same plan keeps a person's
//      decision (src/plan-memory.js);
//   2. local examples   — THIS: a symbol a person confirmed is used as a
//      template to look for other drawings of the same symbol, here and on
//      the venue's next plan. Nothing is fitted; it is matching;
//   3. model training   — verified labels produce a new detector version
//      (training/), which is a separate, versioned, reviewed act.
//
// What it returns are SUGGESTIONS: places whose pixels match the confirmed
// symbol under normalised cross-correlation, at the four quarter turns (a
// chair drawn on the other side of a table is the same symbol turned). It
// never accepts anything; the review decides.
//
// Cost is bounded: the search runs on a 2× reduced image first, and only the
// peaks are re-scored at full resolution.
(function () {
  "use strict";

  // grey: Uint8Array/Float32Array of width*height, 0..255
  function crop(grey, W, x0, y0, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = grey[(y0 + y) * W + (x0 + x)];
    return out;
  }
  function rot90(t, w, h) { // clockwise: new w = h, new h = w
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = t[y * w + x];
    return out;
  }
  function down2(grey, W, H) {
    const w = W >> 1, h = H >> 1, out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = 2 * y * W + 2 * x;
      out[y * w + x] = (grey[i] + grey[i + 1] + grey[i + W] + grey[i + W + 1]) / 4;
    }
    return { g: out, w, h };
  }
  function stats(t) {
    let s = 0, q = 0;
    for (const v of t) { s += v; q += v * v; }
    const n = t.length, m = s / n, sd = Math.sqrt(Math.max(1e-6, q / n - m * m));
    return { m, sd };
  }
  // Integral images of the image and its square, for O(1) window mean/sd.
  function integrals(g, W, H) {
    const S = new Float64Array((W + 1) * (H + 1)), Q = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rs = 0, rq = 0;
      for (let x = 0; x < W; x++) {
        const v = g[y * W + x]; rs += v; rq += v * v;
        S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + rs;
        Q[(y + 1) * (W + 1) + x + 1] = Q[y * (W + 1) + x + 1] + rq;
      }
    }
    return { S, Q };
  }
  function ncc(g, W, H, I, t, tw, th, tStats, stride) {
    const out = new Float32Array(Math.ceil((H - th + 1) / stride) * Math.ceil((W - tw + 1) / stride));
    const n = tw * th, tz = new Float32Array(n);
    for (let i = 0; i < n; i++) tz[i] = (t[i] - tStats.m) / tStats.sd;
    let k = 0;
    const cols = Math.ceil((W - tw + 1) / stride);
    for (let y = 0; y + th <= H; y += stride) {
      for (let x = 0; x + tw <= W; x += stride) {
        const a = y * (W + 1) + x, b = a + tw, c = (y + th) * (W + 1) + x, d = c + tw;
        const s = I.S[d] - I.S[b] - I.S[c] + I.S[a], q = I.Q[d] - I.Q[b] - I.Q[c] + I.Q[a];
        const m = s / n, v = q / n - m * m;
        if (v < 4) { out[k++] = 0; continue; } // a flat window cannot be a drawn symbol
        let acc = 0;
        for (let yy = 0; yy < th; yy++) {
          const row = (y + yy) * W + x, trow = yy * tw;
          for (let xx = 0; xx < tw; xx++) acc += g[row + xx] * tz[trow + xx];
        }
        out[k++] = acc / (n * Math.sqrt(v));
      }
    }
    return { map: out, cols, rows: Math.ceil((H - th + 1) / stride) };
  }

  // search(grey, W, H, box{x,y,w,h} in px, {threshold, exclude:[{x,y,w,h}], maxResults})
  // -> [{x,y,w,h,score,turn}] in px, best first.
  function search(grey, W, H, box, opts) {
    const o = Object.assign({ threshold: 0.72, maxResults: 400, exclude: [] }, opts || {});
    const bx = Math.max(0, Math.round(box.x)), by = Math.max(0, Math.round(box.y));
    const bw = Math.min(W - bx, Math.round(box.w)), bh = Math.min(H - by, Math.round(box.h));
    if (bw < 6 || bh < 6) return [];
    const tmpl = crop(grey, W, bx, by, bw, bh);
    const D = down2(grey, W, H), I = integrals(D.g, D.w, D.h);
    const coarse = down2(tmpl, bw, bh);
    const found = [];
    let t = coarse.g, tw = coarse.w, th = coarse.h, full = tmpl, fw = bw, fh = bh;
    for (let turn = 0; turn < 4; turn++) {
      if (turn) { t = rot90(t, tw, th); [tw, th] = [th, tw]; full = rot90(full, fw, fh); [fw, fh] = [fh, fw]; }
      if (tw < 3 || th < 3 || tw >= D.w || th >= D.h) continue;
      const r = ncc(D.g, D.w, D.h, I, t, tw, th, stats(t), 1);
      // local maxima over the coarse threshold
      for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.cols; x++) {
        const v = r.map[y * r.cols + x];
        if (v < o.threshold - 0.08) continue;
        let peak = true;
        for (let dy = -2; dy <= 2 && peak; dy++) for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy, xx = x + dx;
          if ((dx || dy) && yy >= 0 && xx >= 0 && yy < r.rows && xx < r.cols && r.map[yy * r.cols + xx] > v) { peak = false; break; }
        }
        if (peak) found.push({ x: x * 2, y: y * 2, w: fw, h: fh, coarse: v, turn, t: full });
      }
    }
    // re-score each peak at full resolution in a small neighbourhood
    const IF = integrals(grey, W, H), out = [];
    for (const f of found) {
      let best = -1, bxy = null;
      const ts = stats(f.t);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = f.x + dx, y = f.y + dy;
        if (x < 0 || y < 0 || x + f.w > W || y + f.h > H) continue;
        // one window, scored directly against the integral images
        const n = f.w * f.h;
        const a = y * (W + 1) + x, b = a + f.w, c = (y + f.h) * (W + 1) + x, d = c + f.w;
        const s = IF.S[d] - IF.S[b] - IF.S[c] + IF.S[a], q = IF.Q[d] - IF.Q[b] - IF.Q[c] + IF.Q[a];
        const m = s / n, v = q / n - m * m;
        if (v < 4) continue;
        let acc = 0;
        for (let yy = 0; yy < f.h; yy++) for (let xx = 0; xx < f.w; xx++) acc += grey[(y + yy) * W + x + xx] * (f.t[yy * f.w + xx] - ts.m) / ts.sd;
        const sc = acc / (n * Math.sqrt(v));
        if (sc > best) { best = sc; bxy = { x, y }; }
      }
      if (bxy && best >= o.threshold) out.push({ x: bxy.x, y: bxy.y, w: f.w, h: f.h, score: +best.toFixed(3), turn: f.turn });
    }
    // non-maximum suppression across turns, and drop what is already known
    out.sort((a, b) => b.score - a.score);
    const kept = [];
    const overlaps = (a, b) => {
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return ix * iy / Math.min(a.w * a.h, b.w * b.h);
    };
    for (const c of out) {
      if (kept.some(k => overlaps(k, c) > 0.3)) continue;
      if (o.exclude.some(e => overlaps(e, c) > 0.3)) continue;
      if (overlaps(c, { x: bx, y: by, w: bw, h: bh }) > 0.3) continue;
      kept.push(c);
      if (kept.length >= o.maxResults) break;
    }
    return kept;
  }

  // Several confirmed examples at once (L3, 2026-10-18). Each is searched as
  // above; with ONE the answer is that search. With two or more a place is
  // suggested only where at least two of the examples find it: the union of
  // three searches added every odd example's false matches — measured on the
  // Golden Plan's fifteen renderings, 58 phantoms per 100 objects with three
  // table examples against 0 with one. The best-scored box of each agreed
  // place is the one returned.
  function searchMany(grey, W, H, boxes, opts) {
    const list = (boxes || []).filter(Boolean);
    if (list.length <= 1) return list.length ? search(grey, W, H, list[0], opts) : [];
    const runs = list.map((b, i) => search(grey, W, H, b, Object.assign({}, opts, { exclude: ((opts && opts.exclude) || []).concat(list.filter((_, j) => j !== i)) })).map(s => ({ ...s, from: i })));
    const overlaps = (a, b) => {
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return ix * iy / Math.min(a.w * a.h, b.w * b.h);
    };
    const all = runs.flat().sort((a, b) => b.score - a.score);
    const kept = [];
    for (const c of all) {
      if (kept.some(k => overlaps(k, c) > 0.3)) continue;
      const support = new Set(all.filter(o => overlaps(o, c) > 0.3).map(o => o.from));
      if (support.size >= 2) kept.push({ ...c, support: support.size });
    }
    return kept.map(({ from, ...c }) => c);
  }

  globalThis.MeritPlanExemplar = Object.freeze({ search, searchMany });
})();
