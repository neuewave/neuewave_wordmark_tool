// Vector export. The forms are rendered flat without anti-aliasing, split
// into regions of one colour, and each region's edge is traced into a path.
// Text is written from its real outlines.

// Closed-polyline simplification (Douglas-Peucker).
function simplify(pts, eps) {
  const n = pts.length / 2;
  if (n < 5) return pts;
  // split at the point farthest from the first, then simplify both halves
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) { const d = (pts[i * 2] - pts[0]) ** 2 + (pts[i * 2 + 1] - pts[1]) ** 2; if (d > best) { best = d; far = i; } }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const bi = b % n, ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[bi * 2], by = pts[bi * 2 + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let max = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / len;
      if (d > max) { max = d; at = i; }
    }
    if (max > eps && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

// data: RGBA rows, bottom row first (as WebGL returns them).
// Returns [{ colour: '#rrggbb', loops: [[x, y, ...], ...] }] with y down.
export function traceRegions(data, w, h, maxColours = 48, eps = 0.9) {
  const labels = new Int16Array(w * h).fill(-1);
  const index = new Map(), cols = [];
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let id = index.get(key);
    if (id === undefined) { id = cols.length; index.set(key, id); cols.push({ r: 0, g: 0, b: 0, n: 0, to: id }); }
    const c = cols[id];
    c.r += r; c.g += g; c.b += b; c.n++;
    labels[i] = id;
  }
  for (const c of cols) { c.r /= c.n; c.g /= c.n; c.b /= c.n; }
  // too many colours (smooth gradients): fold the rare ones into their nearest common colour
  if (cols.length > maxColours) {
    const order = cols.map((c, i) => i).sort((a, b) => cols[b].n - cols[a].n), top = order.slice(0, maxColours);
    for (const i of order.slice(maxColours)) {
      let best = top[0], bd = Infinity;
      for (const t of top) { const d = (cols[i].r - cols[t].r) ** 2 + (cols[i].g - cols[t].g) ** 2 + (cols[i].b - cols[t].b) ** 2; if (d < bd) { bd = d; best = t; } }
      cols[i].to = best;
    }
    for (let i = 0; i < w * h; i++) if (labels[i] >= 0) labels[i] = cols[labels[i]].to;
  }
  // boundary edges, walked clockwise round each region; corner (x, y) has key y * (w + 1) + x
  const W = w + 1, edges = cols.map(() => new Map());
  const add = (id, a, b) => { const m = edges[id], l = m.get(a); if (l) l.push(b); else m.set(a, [b]); };
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : labels[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const L = labels[y * w + x];
    if (L < 0) continue;
    if (at(x, y - 1) !== L) add(L, y * W + x, y * W + x + 1);
    if (at(x + 1, y) !== L) add(L, y * W + x + 1, (y + 1) * W + x + 1);
    if (at(x, y + 1) !== L) add(L, (y + 1) * W + x + 1, (y + 1) * W + x);
    if (at(x - 1, y) !== L) add(L, (y + 1) * W + x, y * W + x);
  }
  const out = [];
  cols.forEach((c, id) => {
    const m = edges[id];
    if (!m.size) return;
    const loops = [];
    for (const start of m.keys()) {
      let list = m.get(start);
      while (list && list.length) {
        const pts = [];
        let cur = start;
        for (let guard = 0; guard < 4e6; guard++) {
          const next = m.get(cur);
          if (!next || !next.length) break;
          pts.push(cur % W, h - Math.floor(cur / W));       // flip to y down
          cur = next.pop();
          if (cur === start) break;
        }
        if (pts.length >= 8) { const s = simplify(pts, eps); if (s.length >= 6) loops.push(s); }
        list = m.get(start);
      }
    }
    if (loops.length) out.push({ colour: '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), loops });
  });
  return out;
}

const pathOf = (loops, f = 1) => loops.map((l) => {
  let d = 'M';
  for (let i = 0; i < l.length; i += 2) d += `${i ? 'L' : ''}${+(l[i] * f).toFixed(2)} ${+(l[i + 1] * f).toFixed(2)}`;
  return d + 'Z';
}).join('');

// opts: { w, h, scale, ground (colour or null), regions, seal (hairline that closes gaps between regions), textsBehind, textsFront }
// texts: [{ loops, fill (bool), colour, weight }] already in pixel coordinates.
export function composeSvg(o) {
  const text = (t) => (t.fill
    ? `<path d="${pathOf(t.loops)}" fill="${t.colour}" fill-rule="evenodd"/>`
    : `<path d="${pathOf(t.loops)}" fill="none" stroke="${t.colour}" stroke-width="${+t.weight.toFixed(2)}" stroke-linejoin="round"/>`);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.w} ${o.h}" width="${o.w}" height="${o.h}">\n`;
  if (o.ground) s += `<rect width="${o.w}" height="${o.h}" fill="${o.ground}"/>\n`;
  s += o.textsBehind.map(text).join('\n') + '\n<g id="forms">\n';
  for (const r of o.regions) {
    s += `<path d="${pathOf(r.loops, o.scale)}" fill="${r.colour}" stroke="${r.colour}" stroke-width="${o.seal}" stroke-linejoin="round" fill-rule="evenodd"/>\n`;
  }
  s += '</g>\n' + o.textsFront.map(text).join('\n') + '\n</svg>\n';
  return s;
}
