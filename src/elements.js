// The organic forms: an alternative to the primitive system (shapes.js) for
// three of the elements.
//
//   fire   a flame: layered teardrop tongues, hottest in the core, with embers
//   water  liquid: drops that merge into one smooth surface (stream, wave or splash)
//   wind   moving air: sweeping gust lines that end in curls, or a vortex
//
// Each form is a skeleton (the points physics can move) plus a skin (the mesh
// grown around it). Every skin writes a "tint" value per vertex (0..1);
// applyTint turns that into a two-colour gradient.
// Units: the wordmark is 10 units wide.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, makeNoise } from './noise.js';
import { IsoSurface } from './iso.js';

const TAU = Math.PI * 2;
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function unitSphere(detail, smooth) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  if (smooth) g = mergeVertices(g, 1e-5);
  return g;
}

function constTint(g, value) {
  g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(value), 1));
  return g;
}

// ---- colour: tint 0 = colour, tint 1 = colour2, scaled by blend
const cA = new THREE.Color(), cB = new THREE.Color();
export function applyTint(g, colour, colour2, blend) {
  const tint = g.attributes.tint;
  if (!tint) return g;
  let col = g.attributes.color;
  if (!col || col.count !== tint.count) {
    col = new THREE.BufferAttribute(new Float32Array(tint.count * 3), 3);
    g.setAttribute('color', col);
  }
  cA.set(colour); cB.set(colour2);
  const n = g.index ? tint.count : Math.min(tint.count, g.drawRange.count);
  const t = tint.array, c = col.array;
  for (let i = 0; i < n; i++) {
    const k = clamp01(t[i] * blend), o = i * 3;
    c[o] = cA.r + (cB.r - cA.r) * k; c[o + 1] = cA.g + (cB.g - cA.g) * k; c[o + 2] = cA.b + (cB.b - cA.b) * k;
  }
  col.needsUpdate = true;
  return g;
}

// ---- tubes: shared by flame tongues and wind streams
function sideOf(out, T) {
  out.crossVectors(Z, T);
  if (out.lengthSq() < 1e-8) out.crossVectors(Y, T);
  return out.normalize();
}

// lines: [{ pts, rad, tint0, tint1 }]. profile(t, line, angle) returns the
// radius factor at t along the line. flat squashes the tube front to back.
function skinTubes(lines, seg, sides, profile, flat, into) {
  const N = seg + 1, count = lines.length * N * sides;
  let g = into;
  if (!g || g.attributes.position.count !== count) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(count), 1));
    const idx = [];
    for (let i = 0; i < lines.length; i++) for (let s = 0; s < seg; s++) for (let k = 0; k < sides; k++) {
      const a0 = (i * N + s) * sides + k, a1 = (i * N + s) * sides + ((k + 1) % sides);
      idx.push(a0, a1, a0 + sides, a1, a1 + sides, a0 + sides);
    }
    g.setIndex(idx);
  }
  const out = g.attributes.position.array, tint = g.attributes.tint.array;
  const T = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), A0 = new THREE.Vector3();
  let w = 0, tw = 0;
  for (const line of lines) {
    const pts = line.pts;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, a = Math.max(0, s - 1) * 3, b = Math.min(seg, s + 1) * 3;
      T.set(pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]);
      if (T.lengthSq() < 1e-12) T.set(0, 1, 0);
      T.normalize();
      sideOf(A, T);
      if (s > 0 && A.dot(A0) < 0) A.negate();      // keep the frame from flipping
      A0.copy(A);
      B.crossVectors(T, A).normalize();
      const x = pts[s * 3], y = pts[s * 3 + 1], z = pts[s * 3 + 2];
      const tv = line.tint0 + (line.tint1 - line.tint0) * t;
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * TAU, c = Math.cos(ang), sn = Math.sin(ang);
        const r = line.rad * profile(t, line, ang);
        out[w++] = x + (A.x * c + B.x * sn * flat) * r;
        out[w++] = y + (A.y * c + B.y * sn * flat) * r;
        out[w++] = z + (A.z * c + B.z * sn * flat) * r;
        tint[tw++] = tv;
      }
    }
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.tint.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.boundingBox = null;
  return g;
}

function mergeParts(parts) {
  parts.forEach((g) => g.deleteAttribute('normal'));
  const out = parts.length === 1 ? parts[0].clone() : mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  out.computeVertexNormals();
  return out;
}

// ---------------------------------------------------------------- FIRE
// A flame grows up the local Y axis. Tongues come in nested layers: a wide
// outer layer, then smaller, hotter layers in front of it.
export const FIRE_SEG = 30;
const FIRE_SIDES = 16;

export function fireTongues(p, seed, time = 0) {
  const rnd = mulberry32(seed * 104729 + 23);
  const layers = Math.max(1, Math.round(p.layers));
  const out = [];
  for (let l = 0; l < layers; l++) {
    const s = 1 - (l / layers) * 0.8;
    const n = Math.max(1, Math.round(p.count) - 2 * l);
    const hot = layers > 1 ? l / (layers - 1) : 0;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : (i + 0.5) / n - 0.5 + ((rnd() - 0.5) * 0.3) / n;
      const edge = Math.min(1, Math.abs(u) * 2);
      const h = p.height * s * (1 - p.ragged * 0.7 * Math.pow(edge, 1.3)) * (1 - p.ragged * 0.3 * rnd());
      const lean = p.lean * u * 2 * (0.7 + 0.6 * rnd());
      const rad = (p.girth * p.width * s * 0.55 * (0.8 + 0.4 * rnd())) / Math.sqrt(n);
      const x0 = u * p.width * s, z0 = l * 0.2 * p.depth + (rnd() - 0.5) * 0.08;
      const ph = rnd() * TAU, ph2 = rnd() * TAU, hook = rnd() < 0.5 ? -1 : 1, off = rnd() * 100;
      const dx = Math.sin(lean), dy = Math.cos(lean);
      const pts = new Float32Array((FIRE_SEG + 1) * 3);
      for (let k = 0; k <= FIRE_SEG; k++) {
        const t = k / FIRE_SEG;
        const lick = p.sway * h * 0.16 * Math.sin(Math.PI * 2 * p.licks * t + ph - time * 2.6 * p.speed) * Math.pow(t, 1.2)
                   + p.curl * h * 0.22 * hook * t * t * t;
        pts[k * 3] = x0 + dx * h * t + dy * lick;
        pts[k * 3 + 1] = dy * h * t - dx * lick;
        pts[k * 3 + 2] = z0 + p.sway * h * 0.06 * Math.sin(Math.PI * 2 * p.licks * t + ph2 - time * 1.9 * p.speed) * t;
      }
      out.push({ pts, rad, tint0: hot * 0.78, tint1: Math.min(1, hot * 0.78 + 0.3), off });
    }
  }
  return out;
}

export function skinFire(tongues, p, into, noise, time = 0) {
  const b = THREE.MathUtils.clamp(p.belly, 0.05, 0.9);
  const profile = (t, line, ang) => {
    // teardrop: round at the bottom, fullest at "belly", drawn out to a point
    const body = t < b ? Math.sqrt(Math.max(0, 1 - (1 - t / b) ** 2)) : Math.pow(Math.cos((Math.PI / 2) * ((t - b) / (1 - b))), p.taper);
    if (!noise || p.ripple <= 0) return body;
    return body * (1 + p.ripple * 1.6 * t * noise(Math.cos(ang) * 0.7 + line.off, t * 2.4 - time * 1.6 * p.speed, Math.sin(ang) * 0.7));
  };
  return skinTubes(tongues, FIRE_SEG, FIRE_SIDES, profile, p.depth, into);
}

// Embers as a function of time, used for still frames and designed motion.
export function fireEmbers(p, seed, time = 0) {
  const rnd = mulberry32(seed * 31337 + 5);
  const out = [];
  for (let i = 0; i < Math.round(p.embers); i++) {
    const life = 1.6 + 2.2 * rnd();
    const a = ((time * 0.5 * p.speed + rnd() * life) % life) / life;
    const x0 = (rnd() - 0.5) * p.width * 0.8, y0 = p.height * (0.35 + 0.5 * rnd()), z0 = (rnd() - 0.5) * 0.5;
    const ph = rnd() * TAU, sz = 0.5 + rnd();
    out.push({
      x: x0 + Math.sin(a * 5 + ph) * 0.2 * (0.4 + a), y: y0 + a * p.height * 0.7, z: z0,
      s: p.emberSize * 0.06 * sz * Math.pow(1 - a, 0.6),
    });
  }
  return out;
}

export const emberGeometry = () => { const g = constTint(unitSphere(1, true), 1); g.computeVertexNormals(); return g; };

export function buildFire(p, seed, time = 0) {
  const parts = [skinFire(fireTongues(p, seed, time), p, null, makeNoise(seed * 17 + 2), time)];
  const ember = constTint(unitSphere(1, true), 1);
  for (const e of fireEmbers(p, seed, time)) {
    if (e.s < 1e-4) continue;
    const g = ember.clone();
    g.scale(e.s, e.s, e.s);
    g.translate(e.x, e.y, e.z);
    parts.push(g);
  }
  ember.dispose();
  return mergeParts(parts);
}

// ---------------------------------------------------------------- WATER
// Liquid is a set of balls placed along one or more paths. Big balls sit
// close and fuse into a body; towards the ends they spread out and break
// into drops. Spray adds loose droplets around the body.
const MAX_BALLS = 1000;

function waterPaths(p, rnd, time) {
  const L = p.length, ph = rnd() * TAU;
  const lo = 0.2;
  // liquid necks and swells along its length before it breaks into drops
  const neck = (u) => 1 - p.pulse * 0.5 * (0.5 + 0.5 * Math.sin(TAU * p.pulses * u + ph));
  if (p.type === 'wave') {
    // a swell that rises from the surface, then curls over into a breaking crest
    const H = p.arc * L * 0.9, Rc = H * 0.4, xc = L * 0.14;
    const rise = (v, o) => o.set(-L / 2 + v * (xc + L / 2), H * v * v * (3 - 2 * v) - H / 2, 0);
    const paths = [{
      len: L * 0.7 + Rc * 4,
      at: (u, o) => {
        if (u < 0.5) rise(u / 0.5, o);
        else {
          const v = (u - 0.5) / 0.5, phi = v * 4.3, r = Rc * (1 - 0.45 * v);
          o.set(xc + r * Math.sin(phi), H / 2 - Rc + r * Math.cos(phi), 0.3 * Rc * v);
        }
        o.y += p.wave * 0.03 * L * Math.sin(TAU * p.waves * u + ph + time);
      },
      rho: (u) => (u < 0.5 ? 0.62 + 0.2 * u : lo + (0.72 - lo) * Math.pow(1 - (u - 0.5) / 0.5, p.taper)) * neck(u),
    }];
    // the body of water under the crest
    for (const k of [0, 0.5]) {
      paths.push({
        len: L * 0.7, fill: true,
        at: (u, o) => { rise(u, o); o.y = -H / 2 + (o.y + H / 2) * k; o.x += 0.3 * p.size * (1 - k); o.z = -0.1; },
        rho: (u) => 0.5 + 0.4 * u,
      });
    }
    return paths;
  }
  if (p.type === 'crown') {
    // a splash: a ring of liquid with jets thrown up and out
    const n = Math.max(3, Math.round(p.jets)), Rr = L * 0.17, H = p.arc * L * 0.85;
    const paths = [{
      len: TAU * Rr, fill: true,
      at: (u, o) => o.set(Rr * Math.cos(u * TAU), -H / 2, Rr * Math.sin(u * TAU) * 0.6),
      rho: () => 0.8,
    }];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * TAU + ph, hj = H * (0.7 + 0.3 * rnd()), out = 0.9 + 0.5 * rnd();
      paths.push({
        len: hj * 1.2,
        at: (u, o) => {
          const r = Rr * (1 + out * u * (0.6 + 0.6 * u));
          o.set(r * Math.cos(a), -H / 2 + hj * (1 - (1 - u) ** 2) - 0.25 * hj * u * u + p.wave * 0.04 * L * Math.sin(time + j), r * Math.sin(a) * 0.6);
        },
        rho: (u) => lo + (0.72 - lo) * Math.pow(1 - u, p.taper),
      });
    }
    return paths;
  }
  // stream: a thrown arc of water with a heavy head and a tail that breaks into drops
  const h = THREE.MathUtils.clamp(p.head, 0.1, 0.92);
  return [{
    len: L * (1 + Math.abs(p.arc)),
    at: (u, o) => o.set(
      (u - 0.5) * L,
      p.arc * L * (4 * u * (1 - u) - 0.5) + p.wave * 0.1 * L * Math.sin(TAU * p.waves * u + ph + time),
      p.wave * 0.05 * L * Math.cos(TAU * p.waves * u * 0.7 + ph * 1.7 + time * 0.7),
    ),
    rho: (u) => {
      const body = u < h ? Math.pow(u / h, p.taper) : Math.pow(Math.cos((Math.PI / 2) * ((u - h) / (1 - h))), 0.55);
      return lo + (1 - lo) * body * neck(u);
    },
  }];
}

// Returns { balls: [x, y, z, radius, tint] * n, n }.
export function waterBalls(p, seed, time = 0) {
  // if the body needs more particles than the budget allows, pack it more coarsely
  let grain = Math.max(0.05, p.grain);
  for (let tries = 0; tries < 8; tries++) {
    const set = packWater(p, seed, time, grain);
    if (!set.full) return set;
    grain *= 1.15;
  }
  return packWater(p, seed, time, grain);
}

function packWater(p, seed, time, grain) {
  const rnd = mulberry32(seed * 15485863 + 37);
  const noise = makeNoise(seed * 13 + 3);
  const paths = waterPaths(p, rnd, time);
  const data = [];
  const P = new THREE.Vector3(), Q = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3();
  let full = false;
  const push = (x, y, z, r, t) => { if (data.length < MAX_BALLS * 5) data.push(x, y, z, r, t); else full = true; };
  // The body is packed with small particles of one size ("grain") so it can
  // flow like a liquid; where the stream gets thinner than that it becomes
  // single drops.
  const rs = grain, pitch = rs * 1.08;
  let station = 0;
  for (const path of paths) {
    let u = 0;
    while (u <= (path.fill ? 0.999 : 1)) {
      const pr = path.rho(u);
      const r = p.size * pr * (1 + (rnd() - 0.5) * 0.5 * p.jitter);
      const tint = clamp01(1.15 - pr * 1.15);
      path.at(u, P);
      if (r > rs * 1.35) {
        // a disc of particles across the stream: one in the middle, then rings
        path.at(Math.min(1, u + 0.004), Q); path.at(Math.max(0, u - 0.004), T);
        T.subVectors(Q, T).normalize();
        sideOf(N, T);
        push(P.x, P.y, P.z, rs, tint);
        // rings are spread evenly out to the edge, so the body's width changes smoothly
        const reach = r - rs * 0.75, rings = Math.max(1, Math.round(reach / pitch));
        for (let ring = 1; ring <= rings; ring++) {
          const rr = (reach * ring) / rings, m = Math.max(3, Math.round((TAU * rr) / pitch)), a0 = station * 2.4 + ring;
          for (let k = 0; k < m; k++) {
            const a = a0 + (k / m) * TAU, c = Math.cos(a) * rr, sn = Math.sin(a) * rr * 0.85;
            push(P.x + N.x * c, P.y + N.y * c, P.z + N.z * c + sn, rs, tint);
          }
        }
        station++;
        u += (pitch * 0.92) / path.len;
      } else {
        const j = r * p.jitter * 0.5;
        push(P.x + (rnd() - 0.5) * j, P.y + (rnd() - 0.5) * j, P.z + (rnd() - 0.5) * j, r, tint);
        const gap = path.fill ? 1.1 : 1.1 * (1 + p.breakup * 5 * (1 - pr) ** 2);
        u += Math.max(0.003, (r * gap) / path.len);
      }
    }
  }
  const body = data.length / 5;
  for (let i = 0; i < Math.round(p.spray); i++) {
    const path = paths[Math.floor(rnd() * paths.length)], u = rnd();
    path.at(u, P);
    const d = p.size * path.rho(u) + p.spread * p.size * (0.5 + 1.8 * rnd()), a = rnd() * TAU, up = 0.3 + 0.7 * rnd();
    push(P.x + Math.cos(a) * d * 0.7, P.y + up * d, P.z + Math.sin(a) * d * 0.5, p.size * (0.09 + 0.2 * rnd() * rnd()) * p.spraySize, 1);
  }
  const balls = new Float32Array(data);
  const n = balls.length / 5;
  if (time !== 0) {
    // designed motion: the liquid wobbles and its spray bobs
    for (let i = 0; i < n; i++) {
      const amp = balls[i * 5 + 3] * (i < body ? 0.25 : 1.2);
      balls[i * 5] += amp * noise(i * 1.7, time * 0.6, 0.5);
      balls[i * 5 + 1] += amp * noise(i * 2.3 + 20, time * 0.6, 4.5);
    }
  }
  return { balls, n, full };
}

export function skinWater(set, p, surface) {
  return surface.build(set.balls, set.n, p.merge, p.detail);
}

export function buildWater(p, seed, time = 0) {
  return skinWater(waterBalls(p, seed, time), p, new IsoSurface());
}

// ---------------------------------------------------------------- WIND
// Gusts: lines of air that sweep across and roll up into curls.
// Vortex: the same lines wound into a funnel.
export const WIND_SEG = 80;
const WIND_SIDES = 8;

export function windStreams(p, seed, time = 0) {
  const rnd = mulberry32(seed * 32452843 + 53);
  const n = Math.max(1, Math.round(p.count));
  const out = [];
  for (let j = 0; j < n; j++) {
    const pts = new Float32Array((WIND_SEG + 1) * 3);
    const rad = p.thick * (0.65 + 0.7 * rnd());
    const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), ph = rnd() * TAU;
    if (p.type === 'vortex') {
      const a0 = (j / n) * TAU + r1 * 0.6, top = 0.75 + 0.25 * r2;
      for (let k = 0; k <= WIND_SEG; k++) {
        const t = k / WIND_SEG, tt = t * top;
        const R = p.radius * (0.1 + 0.9 * Math.pow(tt, 1.5)) * (1 + p.wave * 0.12 * Math.sin(TAU * p.waves * t + ph));
        const a = a0 + TAU * p.turns * tt + time * 1.4;
        pts[k * 3] = R * Math.cos(a);
        pts[k * 3 + 1] = (tt - 0.5) * p.length;
        pts[k * 3 + 2] = R * Math.sin(a) * p.depth;
      }
    } else {
      const lane = j - (n - 1) / 2;
      const dir = lane > 0.01 ? 1 : lane < -0.01 ? -1 : (r4 < 0.5 ? -1 : 1);
      const run = p.length * (1 - p.stagger * 0.55 * r1);
      const xs = -p.length / 2 + p.stagger * p.length * 0.35 * r2;
      const R = p.radius * (0.55 + 0.9 * r3), phiMax = TAU * p.turns * (0.7 + 0.6 * r4);
      const spiral = phiMax * R * 0.65, total = run + spiral;
      const y0 = lane * p.spacing, z0 = (r2 - 0.5) * 0.3 * p.depth;
      const yEnd = y0;
      for (let k = 0; k <= WIND_SEG; k++) {
        const s = (k / WIND_SEG) * total;
        if (s <= run) {
          const u = s / run;
          pts[k * 3] = xs + s;
          pts[k * 3 + 1] = y0 + p.wave * 0.3 * Math.pow(1 - u, 1.5) * Math.sin(TAU * p.waves * u + ph - time * 1.5);
          pts[k * 3 + 2] = z0;
        } else {
          const v = (s - run) / spiral, phi = v * phiMax, r = R * (1 - 0.7 * v);
          pts[k * 3] = xs + run + r * Math.sin(phi);
          pts[k * 3 + 1] = yEnd + dir * (R - r * Math.cos(phi));
          pts[k * 3 + 2] = z0 + p.depth * R * 0.9 * v;
        }
      }
    }
    out.push({ pts, rad, tint0: 0, tint1: 1 });
  }
  return out;
}

export function skinWind(streams, p, into) {
  // a fine tail that swells, then thins away into the curl
  const profile = (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), p.taper);
  return skinTubes(streams, WIND_SEG, WIND_SIDES, profile, 1, into);
}

export function buildWind(p, seed, time = 0) {
  return skinWind(windStreams(p, seed, time), p);
}

// The organic builds, offered beside the primitive system for fire, water and wind.
export const ORGANIC = { fire: buildFire, water: buildWater, wind: buildWind };
