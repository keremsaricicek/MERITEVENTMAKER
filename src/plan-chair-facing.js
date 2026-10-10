// MERIT Event Maker — which way a chair faces, read off its own stencil (MeritChairFacing).
//
// A chair's facing is a SIGNED direction and the drawing shows it only one
// way: the symbol's backrest. The box angle says nothing (a rotated box has an
// axis, not a front), and "it stands next to a table" is adjacency, not
// observation — neither is used here.
//
// One chair is a few dozen pixels and too noisy to read on its own; measured
// on the Golden Plan, a per-chair ink-centroid rule stated 19 facings and got
// 6 wrong. But a plan draws its chairs from a STENCIL: every armchair is the
// same symbol, turned. So the chairs of one family are aligned to each other —
// each turned by its own detected angle plus whichever quarter turn matches
// the others best — and averaged into one clean template. The template is
// read for its backrest: walking in from each side across the middle, the
// back crosses TWO lines (the outer edge and the backrest's inner edge), the
// front crosses ONE. A family whose template shows exactly one such side has
// a front; each member faces that way, turned by its own alignment. A family
// whose template shows none (a round symbol, a stencil too small to resolve)
// states nothing.
//
// Two maps of the same pixels are read, because stencils are drawn two ways:
// outlines in a grey against a coloured fill, and dark lines on a pale fill.
// If both find a front they must agree; if they disagree nothing is stated.
//
// Pure: no DOM, no state. A raster is {data, width, height} (RGBA); chairs are
// {id, cx, cy, w, h, rotation} in raster pixels (centre convention). Angles are
// degrees in the image frame: 0 points to +x, 90 to +y (down). Published once
// on globalThis.
(function () {
  "use strict";
  const N = 32, CROP = 1.3, MIN_MEMBERS = 4, RIDGE = 0.12;

  const lum = (d, p) => (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
  const chr = (d, p) => Math.max(d[p], d[p + 1], d[p + 2]) - Math.min(d[p], d[p + 1], d[p + 2]);

  // The two line maps, as functions of a pixel. "outline": low colour and not
  // paper. "line": darker than its 7x7 neighbourhood by a margin.
  function maps(raster) {
    const { width: W, height: H, data: d } = raster;
    const at = (x, y) => 4 * (y * W + x);
    const outline = (x, y) => { const p = at(x, y); return chr(d, p) < 70 && lum(d, p) < 232 ? 1 : 0; };
    const line = (x, y) => {
      const p = at(x, y), l = lum(d, p);
      let s = 0, n = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        s += lum(d, at(xx, yy)); n++;
      }
      return l < s / n - 10 ? 1 : 0;
    };
    // Memoised per pixel for the whole read: every chair is viewed four times
    // on each map, and neighbouring chairs share pixels.
    const memo = (f) => { const m = new Map(); return (x, y) => { const k = y * W + x; let v = m.get(k); if (v === undefined) { v = f(x, y); m.set(k, v); } return v; }; };
    return { outline: memo(outline), line: memo(line) };
  }

  // The chair seen at angle theta: sample the map at centre + R(theta)·q for q
  // on an N x N grid spanning CROP x the chair's long side. Bilinear.
  function view(raster, map, chair, theta) {
    const { width: W, height: H } = raster;
    const s = CROP * Math.max(chair.w, chair.h), rad = theta * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
    const out = new Float32Array(N * N);
    const m = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : map(x, y));
    for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
      const qx = ((u + 0.5) / N - 0.5) * s, qy = ((v + 0.5) / N - 0.5) * s;
      const x = chair.cx + c * qx - sn * qy, y = chair.cy + sn * qx + c * qy;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      out[v * N + u] = m(x0, y0) * (1 - fx) * (1 - fy) + m(x0 + 1, y0) * fx * (1 - fy) + m(x0, y0 + 1) * (1 - fx) * fy + m(x0 + 1, y0 + 1) * fx * fy;
    }
    return out;
  }
  const normalise = (a) => {
    let mean = 0; for (const v of a) mean += v; mean /= a.length;
    const o = new Float32Array(a.length); let n = 0;
    for (let i = 0; i < a.length; i++) { o[i] = a[i] - mean; n += o[i] * o[i]; }
    n = Math.sqrt(n) || 1; for (let i = 0; i < a.length; i++) o[i] /= n;
    return o;
  };
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  // Peaks of an inward profile: local maxima at least RIDGE, two peaks counted
  // separately only when the profile dips below half the smaller one between.
  function ridgeCount(p) {
    const peaks = [];
    for (let i = 0; i < p.length; i++) {
      const l = i > 0 ? p[i - 1] : -1, r = i < p.length - 1 ? p[i + 1] : -1;
      if (p[i] >= RIDGE && p[i] >= l && p[i] >= r) peaks.push(i);
    }
    const kept = [];
    for (const i of peaks) {
      const last = kept[kept.length - 1];
      if (last != null) {
        let dip = Infinity; for (let k = last; k <= i; k++) dip = Math.min(dip, p[k]);
        if (dip > 0.5 * Math.min(p[last], p[i])) { if (p[i] > p[last]) kept[kept.length - 1] = i; continue; }
      }
      kept.push(i);
    }
    return kept.length;
  }

  // Which side of a template is its front (template frame), or null.
  function templateFront(T) {
    const lo = Math.floor(N / 3), hi = Math.floor(2 * N / 3), half = N / 2;
    const prof = { left: [], right: [], top: [], bottom: [] };
    for (let k = 0; k < half; k++) {
      let l = 0, r = 0, t = 0, b = 0;
      for (let j = lo; j < hi; j++) {
        l += T[j * N + k]; r += T[j * N + (N - 1 - k)]; t += T[k * N + j]; b += T[(N - 1 - k) * N + j];
      }
      const n = hi - lo;
      prof.left.push(l / n); prof.right.push(r / n); prof.top.push(t / n); prof.bottom.push(b / n);
    }
    const ridges = {}; for (const s in prof) ridges[s] = ridgeCount(prof[s]);
    const opposite = { left: "right", right: "left", top: "bottom", bottom: "top" };
    const fronts = Object.keys(ridges).filter(s => ridges[s] === 1 && ridges[opposite[s]] >= 2);
    const angle = { right: 0, bottom: 90, left: 180, top: 270 };
    return { front: fronts.length === 1 ? fronts[0] : null, angle: fronts.length === 1 ? angle[fronts[0]] : null, ridges };
  }

  // Align a family to itself on one map: each member's best quarter turn
  // (on top of its own detected rotation) against the running template.
  function alignFamily(raster, map, members) {
    const turns = [0, 90, 180, 270];
    const views = members.map(c => turns.map(t => view(raster, map, c, (c.rotation || 0) + t)));
    const normed = views.map(vs => vs.map(normalise));
    let ref = normed[0][0];
    let pick = members.map(() => ({ k: 0, margin: 0, score: 0 }));
    for (let it = 0; it < 4; it++) {
      pick = normed.map(vs => {
        const sc = vs.map(v => dot(v, ref));
        const order = [0, 1, 2, 3].sort((a, b) => sc[b] - sc[a]);
        return { k: order[0], margin: sc[order[0]] - sc[order[1]], score: sc[order[0]] };
      });
      const mean = new Float32Array(N * N);
      pick.forEach((p, i) => { const v = normed[i][p.k]; for (let j = 0; j < v.length; j++) mean[j] += v[j]; });
      ref = normalise(mean);
    }
    const T = new Float32Array(N * N);
    pick.forEach((p, i) => { const v = views[i][p.k]; for (let j = 0; j < v.length; j++) T[j] += v[j] / members.length; });
    return { pick, template: T, front: templateFront(T) };
  }

  // Families: chairs of one colour class whose sides agree within 30% (single
  // linkage), at least MIN_MEMBERS of them.
  function familiesOf(raster, chairs) {
    const { width: W, height: H, data: d } = raster;
    const colourOf = (c) => {
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = Math.round(c.cx) + dx, y = Math.round(c.cy) + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        s += chr(d, 4 * (y * W + x)); n++;
      }
      return n && s / n >= 80 ? "colour" : "pale";
    };
    const items = chairs.map(c => ({ c, colour: colourOf(c), s: Math.min(c.w, c.h), l: Math.max(c.w, c.h) }));
    const parent = items.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.colour !== b.colour) continue;
      if (Math.abs(a.s - b.s) > 0.3 * Math.max(a.s, b.s) || Math.abs(a.l - b.l) > 0.3 * Math.max(a.l, b.l)) continue;
      parent[find(i)] = find(j);
    }
    const groups = new Map();
    items.forEach((it, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
    return [...groups.values()].filter(g => g.length >= MIN_MEMBERS).map(g => ({ colour: g[0].colour, members: g.map(x => x.c) }));
  }

  // The answer for every chair it can read: {id -> {facingAngle, evidence}}.
  // Chairs it cannot read are absent — nothing is stated about them.
  function readFacing(raster, chairs, opts) {
    const o = opts || {};
    const minMargin = o.minMargin == null ? 0.05 : o.minMargin;
    const M = maps(raster);
    const out = new Map(), families = [];
    for (const fam of familiesOf(raster, chairs)) {
      const byMap = {};
      for (const name of ["outline", "line"]) byMap[name] = alignFamily(raster, M[name], fam.members);
      const a = byMap.outline.front, b = byMap.line.front;
      let use = null;
      if (a.angle != null && b.angle != null) use = a.angle === b.angle ? "outline" : null;
      else if (a.angle != null) use = "outline";
      else if (b.angle != null) use = "line";
      families.push({ colour: fam.colour, members: fam.members.length, outline: a.ridges, line: b.ridges,
        front: use ? byMap[use].front.front : null, map: use, disagreed: a.angle != null && b.angle != null && a.angle !== b.angle });
      if (!use) continue;
      const al = byMap[use];
      fam.members.forEach((c, i) => {
        const p = al.pick[i];
        if (p.margin < minMargin) return;
        const angle = ((al.front.angle + (c.rotation || 0) + 90 * p.k) % 360 + 360) % 360;
        out.set(c.id, { facingAngle: angle, evidence: "stencilBackrest", family: fam.members.length, map: use, margin: +p.margin.toFixed(3) });
      });
    }
    return { byId: out, families };
  }

  globalThis.MeritChairFacing = Object.freeze({ readFacing, templateFront, ridgeCount });
})();
