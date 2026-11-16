// The shape system shared by all four elements.
//
//   primitive   sphere, cube, tetra, octa, dodeca, icosa, cone, cylinder, torus
//   supershape  the Gielis superformula on both angles reshapes the primitive:
//               "around" (longitude, seen face-on) and "profile" (latitude)
//   deform      proportions, taper, twist, bend, noise
//   array       how many copies and how they are arranged: scatter, line,
//               stack, ring, spiral, grid, with size falloff and turning
//
// Every element uses exactly the same controls, so one look can be carried
// across the whole mark. The superformula's "around" angle turns about the
// view axis, so in 2D the silhouette is the classic superformula curve.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, makeNoise, fbm, superformula } from './noise.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
export const PRIMS = ['sphere', 'cube', 'tetra', 'octa', 'dodeca', 'icosa', 'cone', 'cylinder', 'torus'];
const SALT = { earth: 11, fire: 23, water: 37, wind: 53 };

// ---- primitives, built once per (kind, detail, tube) at roughly unit radius
const primCache = new Map();

// Weld vertices that share a position and a normal: smooth surfaces close
// up, hard edges stay hard.
function weld(g) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const map = new Map(), remap = new Uint32Array(pos.count), out = [];
  for (let i = 0; i < pos.count; i++) {
    const k = [pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i)].map((v) => Math.round(v * 2000)).join(',');
    let id = map.get(k);
    if (id === undefined) { id = out.length / 3; map.set(k, id); out.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    remap[i] = id;
  }
  const src = g.index ? g.index.array : null, n = src ? src.length : pos.count, idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = remap[src ? src[i] : i];
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  o.setIndex(idx);
  g.dispose();
  return o;
}

// A flat-faced solid with every face cut into n*n triangles, so it can be
// reshaped while its edges stay crisp.
function polyhedron(make, n) {
  const src = make.toNonIndexed().attributes.position;
  const pos = [], idx = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
  for (let f = 0; f < src.count; f += 3) {
    A.fromBufferAttribute(src, f); B.fromBufferAttribute(src, f + 1); C.fromBufferAttribute(src, f + 2);
    const base = pos.length / 3, row = [];
    for (let i = 0; i <= n; i++) {
      row.push(pos.length / 3 - base);
      for (let j = 0; j <= n - i; j++) {
        P.copy(A).addScaledVector(B.clone().sub(A), i / n).addScaledVector(C.clone().sub(A), j / n);
        pos.push(P.x, P.y, P.z);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      const a = base + row[i] + j, b = base + row[i + 1] + j;
      idx.push(a, b, a + 1);
      if (j < n - i - 1) idx.push(a + 1, b, b + 1);
    }
  }
  make.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function primitive(kind, detail, tube) {
  const d = clamp(Math.round(detail), 0, 6);
  const key = `${kind}|${d}|${kind === 'torus' ? tube.toFixed(3) : ''}`;
  if (primCache.has(key)) return primCache.get(key);
  let g;
  const n = 1 + d * 2;
  if (kind === 'cube') { g = new THREE.BoxGeometry(1.5, 1.5, 1.5, n, n, n); g = weld(g); }
  else if (kind === 'tetra') g = polyhedron(new THREE.TetrahedronGeometry(1.25, 0), n + 1);
  else if (kind === 'octa') g = polyhedron(new THREE.OctahedronGeometry(1.15, 0), n + 1);
  else if (kind === 'dodeca') g = polyhedron(new THREE.DodecahedronGeometry(1.05, 0), Math.max(1, d + 1));
  else if (kind === 'icosa') g = polyhedron(new THREE.IcosahedronGeometry(1.05, 0), n);
  else if (kind === 'cone') { g = new THREE.ConeGeometry(0.95, 2, 10 + d * 9, 1 + d * 4); g = weld(g); }
  else if (kind === 'cylinder') { g = new THREE.CylinderGeometry(0.8, 0.8, 1.8, 10 + d * 9, 1 + d * 4); g = weld(g); }
  else if (kind === 'torus') { g = weld(new THREE.TorusGeometry(1, clamp(tube, 0.02, 0.9), 6 + d * 4, 16 + d * 18)); }
  else g = weld(new THREE.IcosahedronGeometry(1, 1 + d * 3));
  primCache.set(key, g);
  if (primCache.size > 60) primCache.delete(primCache.keys().next().value);
  return g;
}

// ---- supershape
const normCache = new Map();
function sfRadius(angle, m, n1, n2, n3) {
  const r = superformula(angle, m, Math.max(0.05, n1), n2, n3);
  return clamp(r, 0.02, 8);
}
// Scale so the widest lobe has radius 1: the form keeps its size while its shape changes.
function sfNorm(m, n1, n2, n3) {
  const key = `${m}|${n1}|${n2}|${n3}`;
  let v = normCache.get(key);
  if (v === undefined) {
    let max = 0;
    for (let i = 0; i < 180; i++) max = Math.max(max, sfRadius((i / 180) * TAU, m, n1, n2, n3));
    v = 1 / max;
    normCache.set(key, v);
    if (normCache.size > 400) normCache.delete(normCache.keys().next().value);
  }
  return v;
}

// Reshape a copy of the primitive. Returns geometry around the origin with a
// "tint" attribute (0 at the bottom, 1 at the top) and its contact radius.
function sculpt(p, opts, noise, off) {
  const src = primitive(p.prim, p.detail * opts.poly, p.tube);
  const g = src.clone();
  const pos = g.attributes.position, tint = new Float32Array(pos.count);
  const k1 = sfNorm(p.m1, p.n1, p.n2, p.n3), k2 = sfNorm(p.m2, p.k1, p.k2, p.k3);
  const twist = THREE.MathUtils.degToRad(p.twist) / 2;
  const v = new THREE.Vector3();
  let sum = 0, max = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (p.sf > 0) {
      const th = Math.atan2(v.y, v.x);
      const r1 = sfRadius(th, p.m1, p.n1, p.n2, p.n3) * k1;
      if (p.prim === 'torus') {
        // supertoroid: the ring follows "around", the tube's section follows "profile"
        const cx = Math.cos(th), cy = Math.sin(th);
        const dr = v.x * cx + v.y * cy - 1, dz = v.z;
        const r2 = sfRadius(Math.atan2(dz, dr), p.m2, p.k1, p.k2, p.k3) * k2;
        const R = lerp(1, r1, p.sf), t = lerp(1, r2, p.sf);
        v.set(cx * (R + dr * t), cy * (R + dr * t), dz * t);
      } else {
        const len = v.length() || 1;
        const r2 = sfRadius(Math.asin(clamp(v.z / len, -1, 1)), p.m2, p.k1, p.k2, p.k3) * k2;
        const fxy = lerp(1, r1 * r2, p.sf), fz = lerp(1, r2, p.sf);
        v.x *= fxy; v.y *= fxy; v.z *= fz;
      }
    }
    const t = clamp(v.y, -1.3, 1.3);                     // height through the form, before stretching
    v.x *= p.sx; v.y *= p.sy; v.z *= p.sz;
    if (p.taper !== 0) { const f = Math.max(0.02, 1 - p.taper * (t * 0.5 + 0.5)); v.x *= f; v.z *= f; }
    if (twist !== 0) { const a = twist * t, c = Math.cos(a), s = Math.sin(a), x = v.x; v.x = x * c + v.z * s; v.z = -x * s + v.z * c; }
    if (p.bend !== 0) v.x += p.bend * t * t * p.sy * 0.5;
    if (p.noise > 0) {
      const q = p.noiseScale;
      v.multiplyScalar(1 + p.noise * 1.5 * fbm(noise, v.x * q + off, v.y * q, v.z * q, 3));
    }
    pos.setXYZ(i, v.x, v.y, v.z);
    tint[i] = t * 0.5 + 0.5;
    const d = v.length();
    sum += d; max = Math.max(max, d);
  }
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
  // a ring is mostly hole, so it gets a smaller contact radius and can thread other forms
  return { geo: g, radius: ((sum / pos.count + max) / 2) * (p.prim === 'torus' ? 0.5 : 1) };
}

// ---- arrays: where each copy sits, how big it is and how it is turned
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
const AX_Z = new THREE.Vector3(0, 0, 1), AX_T = new THREE.Vector3(1, 0.6, 0).normalize();

function placements(p, seed, name, time, flat) {
  const rnd = mulberry32(seed * 7919 + (SALT[name] || 1));
  const n = Math.max(1, Math.round(p.count));
  const out = [];
  const flowing = time !== 0 && p.flow !== 0 && p.array !== 'scatter' && p.array !== 'grid';
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const r = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
    let u = n > 1 ? i / (n - 1) : 0;
    // designed motion: copies travel along the array and loop round
    if (flowing) u = ((((i + time * p.flow * n * 0.25) / n) % 1) + 1) % 1;
    const pos = new THREE.Vector3();
    let heading = 0;
    const S = p.spread;
    if (p.array === 'line') {
      pos.set((u - 0.5) * S, p.arc * S * (4 * u * (1 - u) - 0.5), 0);
      heading = Math.atan2(p.arc * 4 * (1 - 2 * u), 1);
    } else if (p.array === 'stack') {
      pos.set(p.arc * S * 0.3 * Math.sin(u * Math.PI * 1.6) * u, u * S, 0);
    } else if (p.array === 'ring') {
      const a = (flowing ? u : i / n) * TAU;
      pos.set((S / 2) * Math.cos(a), (S / 2) * Math.sin(a), flat ? 0 : (S / 2) * p.arc * Math.sin(a));
      heading = a + Math.PI / 2;
    } else if (p.array === 'spiral') {
      const a = u * TAU * (0.5 + Math.abs(p.arc) * 4) * Math.sign(p.arc || 1), rr = (S / 2) * (0.12 + 0.88 * u);
      pos.set(rr * Math.cos(a), rr * Math.sin(a), flat ? 0 : (u - 0.5) * S * 0.25);
      heading = a + Math.PI / 2;
    } else if (p.array === 'grid') {
      const gx = i % cols, gy = Math.floor(i / cols), step = S / Math.max(1, cols - 1 || 1);
      pos.set((gx - (cols - 1) / 2) * step, ((Math.ceil(n / cols) - 1) / 2 - gy) * step, flat ? 0 : p.arc * step * Math.sin(gx * 1.3 + gy * 0.9));
    } else {
      pos.set((r[0] - 0.5) * S, (r[1] - 0.5) * S * 0.45, flat ? 0 : (r[2] - 0.5) * S * 0.2);
    }
    if (n === 1) pos.set(0, 0, 0);                       // a single copy sits on the element's own position
    const along = p.falloff >= 0 ? Math.pow(1 - u, 1.3) : Math.pow(u, 1.3);
    let s = p.size * lerp(1, 0.08 + 0.92 * along, Math.abs(p.falloff)) * (1 + (r[3] - 0.5) * p.jitter);
    if (flowing) s *= THREE.MathUtils.smoothstep(u, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(u, 0.9, 1));
    if (p.array !== 'scatter') {
      pos.x += (r[4] - 0.5) * p.jitter * p.size; pos.y += (r[5] - 0.5) * p.jitter * p.size;
      if (!flat) pos.z += (r[6] - 0.5) * p.jitter * p.size;
    }
    if (flat) pos.z = i * 0.004;                          // a stable drawing order
    const q = new THREE.Quaternion();
    const turn = THREE.MathUtils.degToRad(p.turn) * i + time * p.spin;
    if (p.array === 'scatter') {
      if (flat) q.setFromAxisAngle(AX_Z, r[7] * TAU * Math.min(1, p.jitter * 2) + turn);
      else q.setFromEuler(new THREE.Euler((r[5] - 0.5) * 2.4 * p.jitter, (r[6] - 0.5) * 2.4 * p.jitter, r[7] * TAU * Math.min(1, p.jitter * 2))).multiply(qa.setFromAxisAngle(AX_Z, turn));
    } else {
      q.setFromAxisAngle(AX_Z, (p.follow ? heading : 0) + turn);
      if (!flat && p.tumble !== 0) q.multiply(qb.setFromAxisAngle(AX_T, THREE.MathUtils.degToRad(p.tumble) * i));
    }
    out.push({ pos, s: Math.max(0.001, s), q, u, off: r[0] * 90 });
  }
  return out;
}

// One sculpted copy per placement. opts: { flat: 2D mode, poly: detail multiplier }.
export function shapeInstances(p, seed, name, time, opts) {
  const noise = makeNoise(seed * 31 + (SALT[name] || 1));
  const places = placements(p, seed, name, time, opts.flat);
  let shared = null;
  // colour runs along the array; a single copy is shaded bottom to top instead
  const own = places.length > 1 ? 0.25 : 1;
  const out = places.map((pl) => {
    // without noise every copy is the same form, so it is sculpted once
    let made;
    if (p.noise > 0) made = sculpt(p, opts, noise, pl.off);
    else { shared = shared || sculpt(p, opts, noise, 0); made = { geo: shared.geo.clone(), radius: shared.radius }; }
    const t = made.geo.attributes.tint.array;
    for (let i = 0; i < t.length; i++) t[i] = clamp(pl.u * (1 - own) + t[i] * own, 0, 1);
    return { geo: made.geo, radius: made.radius, pos: pl.pos, s: pl.s, q: pl.q };
  });
  if (shared) shared.geo.dispose();
  return out;
}

// All copies as one mesh, for still frames.
export function buildShapes(p, seed, name, time, opts) {
  const m = new THREE.Matrix4(), sc = new THREE.Vector3();
  const parts = shapeInstances(p, seed, name, time, opts).map((it) => it.geo.applyMatrix4(m.compose(it.pos, it.q, sc.setScalar(it.s))));
  const out = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (parts.length > 1) parts.forEach((g) => g.dispose());
  out.computeVertexNormals();
  return out;
}
