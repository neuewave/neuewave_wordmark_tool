// Text set in Monument Extended, built from outlines so no font file is
// needed at run time. Any text works: "nw", the wordmark, or paragraphs.
// Scene units: "neuewave" on one line at scale 1 is exactly 10 units wide,
// so 1 module = its x-height = 0.829 units.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { FONTS } from './font-data.js';

const CURVE = 12;
const cache = {};

// Outline and fill data for one glyph, in font units (y down).
function glyph(face, ch) {
  const id = face + ch;
  if (cache[id]) return cache[id];
  const src = FONTS[face].glyphs[ch];
  if (!src) return null;
  const g = { a: src.a, contours: [], fill: null, x0: 0, x1: src.a };
  if (src.d) {
    const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${src.d}"/></svg>`);
    const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
    let x0 = Infinity, x1 = -Infinity;
    for (const shape of shapes) for (const c of [shape, ...shape.holes]) {
      const pts = c.getPoints(CURVE);
      const flat = new Float32Array(pts.length * 2);
      pts.forEach((p, i) => { flat[i * 2] = p.x; flat[i * 2 + 1] = p.y; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); });
      g.contours.push(flat);
    }
    const geo = new THREE.ShapeGeometry(shapes, CURVE);
    g.fill = { pos: geo.attributes.position.array, index: Array.from(geo.index.array) };
    g.x0 = x0; g.x1 = x1;
  }
  cache[id] = g;
  return g;
}

function advance(face, text, tracking) {
  const F = FONTS[face];
  let x = 0, prev = '';
  const run = [];
  for (const ch of text) {
    const g = glyph(face, ch) || (ch === '\t' ? glyph(face, ' ') : null);
    if (!g) continue;
    x += F.kern[prev + ch] || 0;
    run.push({ g, x });
    x += g.a + tracking;
    prev = ch;
  }
  return { run, width: run.length ? x - tracking : 0 };
}

// font units -> scene units, fixed by the regular-weight wordmark
const ref = advance('regular', 'neuewave', 0);
const refInk = ref.run[ref.run.length - 1].x + ref.run[ref.run.length - 1].g.x1 - ref.run[0].g.x0;
export const K = 10 / refInk;
export const MODULE = FONTS.regular.xHeight * K;

function wrapLine(face, line, tracking, max) {
  if (!(max > 0) || advance(face, line, tracking).width <= max) return [line];
  const out = [];
  let cur = '';
  for (const word of line.split(/(\s+)/)) {
    if (cur && advance(face, (cur + word).trimEnd(), tracking).width > max) { out.push(cur.trimEnd()); cur = word.trimStart(); }
    else cur += word;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}

// p: a text section of the settings. Returns a group; group.userData.bounds
// holds the ink box in scene units.
export function buildWordmark(p, colour, resolution) {
  const group = new THREE.Group();
  const face = FONTS[p.face] ? p.face : 'regular';
  const F = FONTS[face];
  let text = String(p.text || '').slice(0, 3000).replace(/\r/g, '');
  if (p.casing === 'upper') text = text.toUpperCase();
  else if (p.casing === 'lower') text = text.toLowerCase();
  const unit = K * p.scale;
  const tracking = p.tracking * F.em;
  const lines = text.split('\n').flatMap((l) => wrapLine(face, l, tracking, p.wrap > 0 ? p.wrap / (unit * p.stretch) : 0));
  const pitch = FONTS.regular.xHeight * p.leading;
  const shear = Math.tan(THREE.MathUtils.degToRad(p.slant));
  const fillPos = [], fillIdx = [], segs = [], loops = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (fx, fy) => {
    const x = (fx - fy * shear) * unit * p.stretch, y = -fy * unit;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    return [x, y];
  };
  lines.forEach((line, li) => {
    const { run, width } = advance(face, line, tracking);
    const ox = p.align === 'left' ? 0 : p.align === 'right' ? -width : -width / 2;
    const oy = li * pitch;
    for (const { g, x } of run) {
      if (!g.fill) continue;
      // the outline of every glyph is kept as well, for vector export
      const mine = g.contours.map((c) => {
        const loop = [];
        for (let i = 0; i < c.length; i += 2) loop.push(...put(c[i] + x + ox, c[i + 1] + oy));
        return loop;
      });
      loops.push(...mine);
      if (p.style === 'fill') {
        const base = fillPos.length / 3, src = g.fill.pos;
        for (let i = 0; i < src.length; i += 3) { const [X, Y] = put(src[i] + x + ox, src[i + 1] + oy); fillPos.push(X, Y, 0); }
        for (const i of g.fill.index) fillIdx.push(base + i);
      } else {
        for (const l of mine) {
          for (let i = 0; i < l.length; i += 2) {
            const j = (i + 2) % l.length;
            segs.push(l[i], l[i + 1], 0, l[j], l[j + 1], 0);
          }
        }
      }
    }
  });
  if (!Number.isFinite(x0)) { x0 = x1 = y0 = y1 = 0; }
  const depthTest = p.depth === 'through';
  let obj = null;
  if (p.style === 'fill' && fillPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fillPos, 3));
    g.setIndex(fillIdx);
    obj = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide, depthTest, depthWrite: depthTest }));
  } else if (segs.length) {
    const mat = new LineMaterial({ color: colour, linewidth: p.weight * Math.max(0.15, p.scale), worldUnits: true, depthTest, depthWrite: depthTest });
    mat.resolution.copy(resolution);
    const g = new LineSegmentsGeometry();
    g.setPositions(segs);
    obj = new LineSegments2(g, mat);
  }
  // centre the ink box on the origin, then move to the chosen place
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (obj) { obj.position.set(-cx, -cy, 0); group.add(obj); }
  group.position.set(p.x, p.y, p.depth === 'behind' ? -40 : 0);
  group.renderOrder = p.depth === 'front' ? 10 : p.depth === 'behind' ? -10 : 0;
  group.traverse((o) => { o.renderOrder = group.renderOrder; });
  // text behind the forms draws on layer 1, other text on layer 2 (used by the line-art renderer)
  group.traverse((o) => { o.layers.set(p.depth === 'behind' ? 1 : 2); });
  group.userData.vector = {
    loops: loops.map((l) => l.map((v, i) => (i % 2 ? v - cy + p.y : v - cx + p.x))),
    fill: p.style === 'fill', colour, weight: p.weight * Math.max(0.15, p.scale), behind: p.depth === 'behind',
  };
  group.userData.bounds = { x0: p.x - (x1 - x0) / 2, x1: p.x + (x1 - x0) / 2, y0: p.y - (y1 - y0) / 2, y1: p.y + (y1 - y0) / 2 };
  return group;
}
