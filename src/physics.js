// Physics for form finding.
//
// Every form is reduced to points that the solver moves in world space:
//   earth  rigid stones: rolling contact, stone on stone, bounce
//   fire   flame tongues as chains pinned at the root, with bending stiffness;
//          embers are free particles that rise off the tongues and respawn
//   water  a particle fluid: drops repel when squeezed, cling when close
//          (cohesion) and share velocity (viscosity); the liquid skin is
//          rebuilt around them every frame, so drops merge and pinch off
//   wind   stream lines as chains that ride the air
// "Memory" is a spring from each point back to its designed (rest) position:
// at 0 a form hangs, pours and falls freely; at 1 it barely moves.
// The solver uses a fixed step and seeded noise, so it is deterministic.
import * as THREE from 'three';
import {
  fireTongues, skinFire, FIRE_SEG, emberGeometry, waterBalls, skinWater,
  windStreams, skinWind, WIND_SEG, applyTint,
} from './elements.js';
import { shapeInstances } from './shapes.js';
import { IsoSurface } from './iso.js';
import { mulberry32, makeNoise } from './noise.js';

export const STEP = 1 / 60;
const ITER = 6;

const springK = (memory) => { const w = 14 * memory * memory * STEP; return Math.min(1, w * w); };
const scaleOf = (M) => Math.hypot(M.elements[0], M.elements[1], M.elements[2]);

// ---- shared environment, rebuilt from settings each step
export function makeEnv(ph, t, noise, extra) {
  const d = THREE.MathUtils.degToRad(ph.windDir);
  return {
    g: -ph.gravity,
    wx: Math.cos(d) * ph.wind, wy: Math.sin(d) * ph.wind, gust: ph.gust,
    turb: ph.turb, ts: 1 / Math.max(0.05, ph.turbScale),
    damp: ph.damping, bounce: ph.bounce,
    floor: ph.floor ? ph.floorY : null, collide: ph.collide,
    walls: ph.walls && extra.bounds ? extra.bounds : null,
    ptr: extra.pointer || null, flat: !!extra.flat,
    t, noise, colliders: [],
  };
}

// Acceleration at a point: gravity, lift, gusting wind, turbulence, pointer.
function force(env, x, y, z, react, lift, out) {
  const n = env.noise;
  let gust = 1;
  if (env.gust > 0) gust = Math.max(0, 1 + env.gust * 1.6 * n(x * 0.12 - env.t * 0.9, y * 0.12, env.t * 0.25));
  let ax = env.wx * gust, ay = env.g + env.wy * gust + lift, az = 0;
  if (env.turb > 0) {
    const s = env.ts, tt = env.t * 0.35;
    ax += env.turb * n(x * s + tt, y * s, z * s);
    ay += env.turb * n(x * s + 31.7, y * s + tt, z * s + 5.1);
    if (!env.flat) az += env.turb * 0.6 * n(x * s + 11.3, y * s + 71.9, z * s + tt);
  }
  if (env.ptr) {
    const dx = x - env.ptr.x, dy = y - env.ptr.y, d = Math.hypot(dx, dy), R = 2.6;
    if (d < R && d > 1e-4) { const f = (env.ptr.f * (1 - d / R) ** 2) / d; ax += dx * f; ay += dy * f; }
  }
  out[0] = ax * react; out[1] = ay * react; out[2] = az * react;
}

// Floor, walls and stones for one point held in flat arrays.
function contain(env, pos, prev, j, r, useStones, grip = 1) {
  if (env.floor !== null && pos[j + 1] < env.floor + r) {
    const vy = pos[j + 1] - prev[j + 1];
    pos[j + 1] = env.floor + r;
    prev[j + 1] = pos[j + 1] + vy * env.bounce;
    prev[j] += (pos[j] - prev[j]) * 0.35 * grip;             // friction
    prev[j + 2] += (pos[j + 2] - prev[j + 2]) * 0.35 * grip;
  }
  const w = env.walls;
  if (w) {
    if (pos[j] < w.l + r) { const v = pos[j] - prev[j]; pos[j] = w.l + r; prev[j] = pos[j] + v * env.bounce; }
    if (pos[j] > w.r - r) { const v = pos[j] - prev[j]; pos[j] = w.r - r; prev[j] = pos[j] + v * env.bounce; }
    if (pos[j + 1] > w.t - r) { const v = pos[j + 1] - prev[j + 1]; pos[j + 1] = w.t - r; prev[j + 1] = pos[j + 1] + v * env.bounce; }
  }
  if (useStones && env.collide) {
    for (const c of env.colliders) {
      const dx = pos[j] - c.x, dy = pos[j + 1] - c.y, dz = pos[j + 2] - c.z;
      const rr = c.r + r, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr && d2 > 1e-12) {
        const d = Math.sqrt(d2), f = (rr - d) / d;
        pos[j] += dx * f; pos[j + 1] += dy * f; pos[j + 2] += dz * f;
        prev[j] += (pos[j] - prev[j]) * 0.5 * grip;           // friction, so forms can rest on stones
        prev[j + 1] += (pos[j + 1] - prev[j + 1]) * 0.5 * grip;
        prev[j + 2] += (pos[j + 2] - prev[j + 2]) * 0.5 * grip;
      }
    }
  }
}

function transform(M, src, out) {
  const e = M.elements;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

// ---- verlet chains (flame tongues, wind streams)
class Chains {
  constructor(rest, lines, bend) {
    const n = rest.length / 3;
    this.n = n;
    this.restLocal = rest;
    this.lines = lines;           // [{ start, count }]
    this.bend = bend;             // 0..1 resistance to kinking
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.rest = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    this.anchor = null;           // optional per-point extra hold on the rest shape (0..1)
    this.local = new Float32Array(n * 3);
  }

  updateRest(M) { transform(M, this.restLocal, this.rest); }
  reset() { this.pos.set(this.rest); this.prev.set(this.rest); }

  step(env, react, lift, memory, radius) {
    const { pos, prev, rest, pinned } = this;
    const k = springK(memory), dt2 = STEP * STEP, keep = 1 - env.damp;
    const a = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      if (pinned[i]) { pos[j] = prev[j] = rest[j]; pos[j + 1] = prev[j + 1] = rest[j + 1]; pos[j + 2] = prev[j + 2] = rest[j + 2]; continue; }
      force(env, pos[j], pos[j + 1], pos[j + 2], react, lift, a);
      for (let c = 0; c < 3; c++) {
        const x = pos[j + c], v = (x - prev[j + c]) * keep;
        prev[j + c] = x;
        let nx = x + v + a[c] * dt2;
        nx += (rest[j + c] - nx) * (this.anchor ? k + (1 - k) * this.anchor[i] : k);
        pos[j + c] = nx;
      }
    }
    for (let it = 0; it < ITER; it++) {
      for (const L of this.lines) {
        for (let s = 0; s < L.count - 1; s++) this.relax(L.start + s, L.start + s + 1, 1);
        if (this.bend > 0) for (let s = 0; s < L.count - 2; s++) this.relax(L.start + s, L.start + s + 2, this.bend);
      }
    }
    for (let i = 0; i < this.n; i++) if (!pinned[i]) contain(env, pos, prev, i * 3, radius, true);
  }

  relax(i, j, stiff) {
    const { pos, rest, pinned } = this;
    const a = i * 3, b = j * 3;
    const rl = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
    const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-9) return;
    const wa = pinned[i] ? 0 : 1, wb = pinned[j] ? 0 : 1;
    if (wa + wb === 0) return;
    const f = ((d - rl) / d / (wa + wb)) * stiff;
    pos[a] += dx * f * wa; pos[a + 1] += dy * f * wa; pos[a + 2] += dz * f * wa;
    pos[b] -= dx * f * wb; pos[b + 1] -= dy * f * wb; pos[b + 2] -= dz * f * wb;
  }

  kick(rnd, amount) {
    const v = amount * STEP;
    for (const L of this.lines) {
      const dx = (rnd() - 0.5) * 2, dy = rnd() * 1.2 - 0.2, dz = rnd() - 0.5;
      for (let s = 0; s < L.count; s++) {
        const i = L.start + s;
        if (this.pinned[i]) continue;
        const f = v * (0.6 + 0.8 * rnd()) * (s / L.count);
        this.prev[i * 3] -= dx * f; this.prev[i * 3 + 1] -= dy * f; this.prev[i * 3 + 2] -= dz * f;
      }
    }
  }

  toLocal(Minv) { return transform(Minv, this.pos, this.local); }
}

// A form made of tube lines: builds its chains from the element's line
// builder and reskins them every frame.
class LineSim {
  constructor(p, seed, time, holder, mat, seg, bend) {
    this.p = p; this.seed = seed; this.holder = holder; this.seg = seg;
    this.clock = time;
    this.lines = this.makeLines(time);
    const N = seg + 1;
    const rest = new Float32Array(this.lines.length * N * 3);
    this.lines.forEach((l, i) => rest.set(l.pts, i * N * 3));
    this.chains = new Chains(rest, this.lines.map((_, i) => ({ start: i * N, count: N })), bend);
    this.chains.updateRest(holder.matrixWorld);
    this.chains.reset();
    this.mesh = new THREE.Mesh(this.skin(this.views(rest), null), mat);
    applyTint(this.mesh.geometry, p.colour, p.colour2, p.blend);
    holder.add(this.mesh);
  }
  views(flat) {
    const N = this.seg + 1;
    return this.lines.map((l, i) => ({ ...l, pts: flat.subarray(i * N * 3, (i + 1) * N * 3) }));
  }
  setTime(time) {
    const N = this.seg + 1;
    this.lines = this.makeLines(time);
    this.lines.forEach((l, i) => this.chains.restLocal.set(l.pts, i * N * 3));
  }
  step(env) {
    const M = this.holder.matrixWorld;
    this.chains.updateRest(M);
    this.pin();
    // weight 0 cancels gravity, so only lift, wind and turbulence shape the form
    this.chains.step(env, this.p.react, this.p.lift - env.g * (1 - this.p.weight), this.p.stiff, this.radius() * scaleOf(M));
    this.clock += STEP;
  }
  sync(Minv) { this.skin(this.views(this.chains.toLocal(Minv)), this.mesh.geometry); }
  kick(rnd, a) { this.chains.kick(rnd, a); }
}

class FireSim extends LineSim {
  constructor(p, seed, time, holder, mat) {
    super(p, seed, time, holder, mat, FIRE_SEG, 0.6);
    // the foot of each tongue holds its shape; the tip is free to lick about
    const N = FIRE_SEG + 1;
    this.chains.anchor = new Float32Array(this.chains.n);
    for (let i = 0; i < this.chains.n; i++) this.chains.anchor[i] = 0.92 * Math.pow(1 - (i % N) / FIRE_SEG, 2.2);
    this.initEmbers(seed, mat);
  }
  makeLines(time) { return fireTongues(this.p, this.seed, time); }
  skin(lines, into) {
    this.noise = this.noise || makeNoise(this.seed * 17 + 2);
    return skinFire(lines, this.p, into, this.noise, this.clock);
  }
  radius() { return this.p.width * 0.12; }
  pin() {
    const N = FIRE_SEG + 1, c = this.chains;
    c.pinned.fill(0);
    if (this.p.pin !== 'none') for (let i = 0; i < this.lines.length; i++) { c.pinned[i * N] = 1; c.pinned[i * N + 1] = 1; }
  }

  initEmbers(seed, mat) {
    const n = Math.round(this.p.embers);
    this.em = null;
    if (!n) return;
    const rnd = mulberry32(seed * 31337 + 5);
    const g = emberGeometry();
    applyTint(g, this.p.colour, this.p.colour2, this.p.blend);
    const inst = new THREE.InstancedMesh(g, mat, n);
    inst.frustumCulled = false;
    this.holder.add(inst);
    this.em = { n, rnd, inst, pos: new Float32Array(n * 3), prev: new Float32Array(n * 3), age: new Float32Array(n), life: new Float32Array(n), size: new Float32Array(n), local: new Float32Array(n * 3) };
    const s = scaleOf(this.holder.matrixWorld);
    for (let i = 0; i < n; i++) {
      this.spawn(i, s);
      // start mid-flight so the flame is never bare
      const age = rnd() * this.em.life[i];
      this.em.age[i] = age;
      this.em.pos[i * 3 + 1] += age * 0.7 * s; this.em.prev[i * 3 + 1] += age * 0.7 * s;
    }
    this.syncEmbers(new THREE.Matrix4().copy(this.holder.matrixWorld).invert());
  }
  spawn(i, s) {
    const e = this.em, rnd = e.rnd, N = FIRE_SEG + 1;
    const line = Math.floor(rnd() * this.lines.length), k = Math.floor((0.45 + 0.5 * rnd()) * FIRE_SEG);
    const q = (line * N + k) * 3, c = this.chains;
    for (let a = 0; a < 3; a++) {
      e.pos[i * 3 + a] = c.pos[q + a] + (rnd() - 0.5) * 0.15 * s;
      e.prev[i * 3 + a] = e.pos[i * 3 + a] - (c.pos[q + a] - c.prev[q + a]);
    }
    e.prev[i * 3 + 1] -= (0.4 + 0.5 * rnd()) * STEP * s;      // leaves the flame moving up
    e.age[i] = 0; e.life[i] = 1.4 + 2.2 * rnd(); e.size[i] = 0.5 + rnd();
  }
  step(env) {
    super.step(env);
    const e = this.em;
    if (!e) return;
    const s = scaleOf(this.holder.matrixWorld), a = [0, 0, 0], dt2 = STEP * STEP, keep = 1 - Math.min(0.5, env.damp * 2 + 0.02);
    for (let i = 0; i < e.n; i++) {
      e.age[i] += STEP * this.p.speed;
      if (e.age[i] > e.life[i]) { this.spawn(i, s); continue; }
      const j = i * 3;
      // embers are light: they shrug off most of gravity and ride the air
      force(env, e.pos[j], e.pos[j + 1], e.pos[j + 2], Math.max(0.3, this.p.react), this.p.lift * 0.3 + 1.2 - env.g * 0.85, a);
      for (let c = 0; c < 3; c++) {
        const x = e.pos[j + c], v = (x - e.prev[j + c]) * keep;
        e.prev[j + c] = x;
        e.pos[j + c] = x + v + a[c] * dt2;
      }
    }
  }
  syncEmbers(Minv) {
    const e = this.em;
    if (!e) return;
    transform(Minv, e.pos, e.local);
    const m = new THREE.Matrix4();
    for (let i = 0; i < e.n; i++) {
      const sz = this.p.emberSize * 0.06 * e.size[i] * Math.pow(Math.max(0, 1 - e.age[i] / e.life[i]), 0.6);
      m.makeScale(sz, sz, sz).setPosition(e.local[i * 3], e.local[i * 3 + 1], e.local[i * 3 + 2]);
      e.inst.setMatrixAt(i, m);
    }
    e.inst.instanceMatrix.needsUpdate = true;
  }
  sync(Minv) { super.sync(Minv); this.syncEmbers(Minv); }
}

class WindSim extends LineSim {
  constructor(p, seed, time, holder, mat) { super(p, seed, time, holder, mat, WIND_SEG, 0.6); }
  makeLines(time) { return windStreams(this.p, this.seed, time); }
  skin(lines, into) { return skinWind(lines, this.p, into); }
  radius() { return this.p.thick; }
  pin() {
    const N = WIND_SEG + 1, c = this.chains, mode = this.p.pin;
    c.pinned.fill(0);
    for (let i = 0; i < this.lines.length; i++) {
      if (mode === 'first' || mode === 'ends') c.pinned[i * N] = 1;
      if (mode === 'ends') c.pinned[i * N + N - 1] = 1;
    }
  }
}

// Particle fluid. Positions by verlet; pairs of drops are kept from
// overlapping too far, pulled together when near, and share velocity.
class WaterSim {
  constructor(p, seed, time, holder, mat) {
    this.p = p; this.seed = seed; this.holder = holder;
    const set = waterBalls(p, seed, time);
    this.n = set.n;
    this.ballsLocal = set.balls;
    this.restLocal = new Float32Array(this.n * 3);
    this.rest = new Float32Array(this.n * 3);
    this.pos = new Float32Array(this.n * 3);
    this.prev = new Float32Array(this.n * 3);
    this.local = new Float32Array(this.n * 3);
    this.out = new Float32Array(this.n * 5);
    this.readRest(set);
    transform(holder.matrixWorld, this.restLocal, this.rest);
    this.pos.set(this.rest); this.prev.set(this.rest);
    this.surface = new IsoSurface();
    this.mesh = new THREE.Mesh(skinWater(set, p, this.surface), mat);
    this.mesh.frustumCulled = false;
    applyTint(this.mesh.geometry, p.colour, p.colour2, p.blend);
    holder.add(this.mesh);
  }
  readRest(set) {
    const n = Math.min(this.n, set.n);
    for (let i = 0; i < n; i++) { this.restLocal[i * 3] = set.balls[i * 5]; this.restLocal[i * 3 + 1] = set.balls[i * 5 + 1]; this.restLocal[i * 3 + 2] = set.balls[i * 5 + 2]; }
  }
  setTime(time) { this.readRest(waterBalls(this.p, this.seed, time)); }
  step(env) {
    const M = this.holder.matrixWorld, s = scaleOf(M), p = this.p;
    const { pos, prev, rest, n } = this, B = this.ballsLocal;
    transform(M, this.restLocal, rest);
    const k = springK(p.stiff), dt2 = STEP * STEP, keep = 1 - env.damp;
    const a = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      force(env, pos[j], pos[j + 1], pos[j + 2], p.react, p.lift - env.g * (1 - p.weight), a);
      for (let c = 0; c < 3; c++) {
        const x = pos[j + c], v = (x - prev[j + c]) * keep;
        prev[j + c] = x;
        let nx = x + v + a[c] * dt2;
        nx += (rest[j + c] - nx) * k;
        pos[j + c] = nx;
      }
    }
    const coh = p.cohesion * 0.004, visc = p.viscosity * 0.08;
    const pairs = this.neighbours(s);
    for (let it = 0; it < 4; it++) {
      for (let q = 0; q < pairs.length; q += 2) {
        const i = pairs[q], j = pairs[q + 1], a3 = i * 3, b3 = j * 3;
        const ri = B[i * 5 + 3] * s, rj = B[j * 5 + 3] * s, sum = ri + rj;
        const dx = pos[b3] - pos[a3], dy = pos[b3 + 1] - pos[a3 + 1], dz = pos[b3 + 2] - pos[a3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > sum * sum * 1.7 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), close = sum * 0.49;
        let f = 0;
        if (d < close) f = ((d - close) / d) * 0.8;                                    // squeezed: push apart
        else if (it === 0 && d > sum * 0.85 && d < sum * 1.3) f = ((d - sum * 0.85) / d) * coh;   // drifting apart: surface tension
        if (f !== 0) {
          // heavier drops move less
          const mi = ri * ri * ri, mj = rj * rj * rj, wi = mj / (mi + mj), wj = mi / (mi + mj);
          pos[a3] += dx * f * wi; pos[a3 + 1] += dy * f * wi; pos[a3 + 2] += dz * f * wi;
          pos[b3] -= dx * f * wj; pos[b3 + 1] -= dy * f * wj; pos[b3 + 2] -= dz * f * wj;
        }
        if (it === 0 && visc > 0) {
          for (let c = 0; c < 3; c++) {
            const vi = pos[a3 + c] - prev[a3 + c], vj = pos[b3 + c] - prev[b3 + c], dv = (vj - vi) * visc;
            prev[a3 + c] -= dv; prev[b3 + c] += dv;
          }
        }
      }
      for (let i = 0; i < n; i++) contain(env, pos, prev, i * 3, B[i * 5 + 3] * s * 0.8, true, 0.15);   // water slips
    }
  }
  // Pairs of drops close enough to touch, found with a grid so the cost stays
  // near-linear in the number of drops.
  neighbours(s) {
    const { pos, n } = this, B = this.ballsLocal;
    if (!this.rmax) { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, B[i * 5 + 3]); this.rmax = m; }
    const cell = this.rmax * s * 2.7, inv = 1 / cell, grid = new Map(), pairs = [];
    const key = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
    const cx = new Int32Array(n), cy = new Int32Array(n), cz = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      cx[i] = Math.floor(pos[i * 3] * inv); cy[i] = Math.floor(pos[i * 3 + 1] * inv); cz[i] = Math.floor(pos[i * 3 + 2] * inv);
      const k = key(cx[i], cy[i], cz[i]);
      const list = grid.get(k);
      if (list) list.push(i); else grid.set(k, [i]);
    }
    for (let i = 0; i < n; i++) {
      const ri = B[i * 5 + 3] * s;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const list = grid.get(key(cx[i] + a, cy[i] + b, cz[i] + c));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const sum = (ri + B[j * 5 + 3] * s) * 1.45;
          const dx = pos[j * 3] - pos[i * 3], dy = pos[j * 3 + 1] - pos[i * 3 + 1], dz = pos[j * 3 + 2] - pos[i * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < sum * sum) pairs.push(i, j);
        }
      }
    }
    return pairs;
  }
  sync(Minv) {
    transform(Minv, this.pos, this.local);
    const o = this.out, B = this.ballsLocal;
    for (let i = 0; i < this.n; i++) {
      o[i * 5] = this.local[i * 3]; o[i * 5 + 1] = this.local[i * 3 + 1]; o[i * 5 + 2] = this.local[i * 3 + 2];
      o[i * 5 + 3] = B[i * 5 + 3]; o[i * 5 + 4] = B[i * 5 + 4];
    }
    this.surface.build(o, this.n, this.p.merge, this.p.detail);
    applyTint(this.mesh.geometry, this.p.colour, this.p.colour2, this.p.blend);
  }
  kick(rnd, amount) {
    const v = amount * STEP;
    const dx = (rnd() - 0.5) * 2, dy = 0.5 + rnd();
    for (let i = 0; i < this.n; i++) {
      const f = v * (0.5 + rnd());
      this.prev[i * 3] -= (dx + (rnd() - 0.5)) * f; this.prev[i * 3 + 1] -= dy * f; this.prev[i * 3 + 2] -= (rnd() - 0.5) * f * 0.5;
    }
  }
}

// Rigid copies of a sculpted primitive. Position by verlet, orientation by an
// angular velocity that follows rolling contact. Copies can be linked into a
// chain (each keeps its distance to the next) and pinned.
class RigidSim {
  constructor(name, p, seed, time, holder, mat, opts) {
    this.p = p; this.holder = holder; this.flat = opts.flat; this.rigid = true; this.spin = 0;
    const M = holder.matrixWorld;
    const Lq = new THREE.Quaternion(); M.decompose(new THREE.Vector3(), Lq, new THREE.Vector3());
    this.bodies = shapeInstances(p, seed, name, time, opts).map((it) => {
      it.geo.computeVertexNormals();
      applyTint(it.geo, p.colour, p.colour2, p.blend);
      const mesh = new THREE.Mesh(it.geo, mat);
      mesh.position.copy(it.pos); mesh.quaternion.copy(it.q); mesh.scale.setScalar(it.s);
      holder.add(mesh);
      const w = it.pos.clone().applyMatrix4(M);
      return {
        mesh, restLocal: it.pos.clone(), q0: it.q.clone(), rest: w.clone(), pos: w.clone(), prev: w.clone(),
        q: Lq.clone().multiply(it.q), restQ: new THREE.Quaternion(), w: new THREE.Vector3(), r: it.radius * it.s, rw: 0, pinned: false, grounded: false,
      };
    });
  }
  setTime() {}
  integrate(env) {
    const M = this.holder.matrixWorld, s = scaleOf(M), p = this.p, n = this.bodies.length;
    const k = springK(p.stiff), dt2 = STEP * STEP, keep = 1 - env.damp;
    const Lq = new THREE.Quaternion(); M.decompose(new THREE.Vector3(), Lq, new THREE.Vector3());
    const a = [0, 0, 0], v = new THREE.Vector3(), spinQ = new THREE.Quaternion();
    this.spin += p.spin * STEP;
    spinQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.spin);
    this.bodies.forEach((b, i) => {
      b.rw = b.r * s;
      b.chain = p.link ? this : null;       // linked copies do not collide with each other
      b.rest.copy(b.restLocal).applyMatrix4(M);
      b.restQ.copy(Lq).multiply(b.q0).multiply(spinQ);
      b.grounded = false;
      b.pinned = (p.pin === 'first' && i === 0) || (p.pin === 'ends' && (i === 0 || i === n - 1));
      if (b.pinned) { b.pos.copy(b.rest); b.prev.copy(b.rest); return; }
      force(env, b.pos.x, b.pos.y, b.pos.z, p.react, p.lift - env.g * (1 - p.weight), a);
      v.subVectors(b.pos, b.prev).multiplyScalar(keep);
      b.prev.copy(b.pos);
      b.pos.add(v);
      b.pos.x += a[0] * dt2; b.pos.y += a[1] * dt2; b.pos.z += a[2] * dt2;
      b.pos.lerp(b.rest, k);
      if (this.flat) { b.pos.z = b.rest.z; b.prev.z = b.rest.z; }
    });
  }
  // links, floor and walls; called several times per step
  solve(env, it) {
    const B = this.bodies, w = env.walls, v = new THREE.Vector3();
    if (this.p.link) {
      for (let i = 0; i < B.length - 1; i++) {
        const A = B[i], C = B[i + 1];
        const rl = A.rest.distanceTo(C.rest);
        v.subVectors(C.pos, A.pos);
        const d = v.length();
        if (d < 1e-9) continue;
        const wa = A.pinned ? 0 : 1, wc = C.pinned ? 0 : 1;
        if (wa + wc === 0) continue;
        const f = (d - rl) / d / (wa + wc);
        A.pos.addScaledVector(v, f * wa); C.pos.addScaledVector(v, -f * wc);
      }
    }
    for (const A of B) {
      if (A.pinned) continue;
      if (env.floor !== null && A.pos.y < env.floor + A.rw) {
        if (it === 0) { const vy = A.pos.y - A.prev.y; A.prev.y = env.floor + A.rw + vy * env.bounce; }
        A.pos.y = env.floor + A.rw; A.grounded = true;
      }
      if (w) {
        if (A.pos.x < w.l + A.rw) { const vx = A.pos.x - A.prev.x; A.pos.x = w.l + A.rw; if (it === 0) A.prev.x = A.pos.x + vx * env.bounce; }
        if (A.pos.x > w.r - A.rw) { const vx = A.pos.x - A.prev.x; A.pos.x = w.r - A.rw; if (it === 0) A.prev.x = A.pos.x + vx * env.bounce; }
        if (A.pos.y > w.t - A.rw) { const vy = A.pos.y - A.prev.y; A.pos.y = w.t - A.rw; if (it === 0) A.prev.y = A.pos.y + vy * env.bounce; }
      }
    }
  }
  finish(env) {
    const k = springK(this.p.stiff), keep = 1 - env.damp, hold = this.p.spin !== 0 ? Math.max(k, 0.25) : k;
    const v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), roll = new THREE.Vector3(), dq = new THREE.Quaternion();
    for (const b of this.bodies) {
      if (this.flat) b.pos.z = b.rest.z;
      v.subVectors(b.pos, b.prev).divideScalar(STEP);
      if (b.grounded) {
        b.prev.x += (b.pos.x - b.prev.x) * 0.12; b.prev.z += (b.pos.z - b.prev.z) * 0.12;
        roll.crossVectors(up, v).divideScalar(Math.max(1e-3, b.rw));
        b.w.lerp(roll, 0.5);
      } else {
        b.w.multiplyScalar(keep);
      }
      if (this.flat) { b.w.x = 0; b.w.y = 0; }
      const ang = b.w.length() * STEP;
      if (ang > 1e-7) b.q.premultiply(dq.setFromAxisAngle(roll.copy(b.w).normalize(), ang));
      b.q.slerp(b.restQ, hold);
      b.q.normalize();
    }
  }
  sync(Minv) {
    const Lq = new THREE.Quaternion(); this.holder.matrixWorld.decompose(new THREE.Vector3(), Lq, new THREE.Vector3());
    Lq.invert();
    for (const b of this.bodies) {
      b.mesh.position.copy(b.pos).applyMatrix4(Minv);
      b.mesh.quaternion.copy(Lq).multiply(b.q);
    }
  }
  kick(rnd, a) {
    for (const b of this.bodies) {
      if (b.pinned) continue;
      const f = a * STEP;
      b.prev.x -= (rnd() - 0.5) * 2 * f; b.prev.y -= (0.4 + rnd()) * f;
      if (!this.flat) b.prev.z -= (rnd() - 0.5) * f;
      b.w.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(6);
    }
  }
}

// Every rigid copy can touch every other, whichever element it belongs to.
function collideBodies(list) {
  for (let i = 0; i < list.length; i++) {
    const A = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const B = list[j];
      if (A.chain && A.chain === B.chain) continue;
      const dx = B.pos.x - A.pos.x, dy = B.pos.y - A.pos.y, dz = B.pos.z - A.pos.z, rr = A.rw + B.rw;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), push = (rr - d) / d;
      let wa = B.rw ** 3, wb = A.rw ** 3;
      if (A.pinned) wa = 0;
      if (B.pinned) wb = 0;
      const sum = wa + wb;
      if (sum === 0) continue;
      wa /= sum; wb /= sum;
      A.pos.x -= dx * push * wa; A.pos.y -= dy * push * wa; A.pos.z -= dz * push * wa;
      B.pos.x += dx * push * wb; B.pos.y += dy * push * wb; B.pos.z += dz * push * wb;
    }
  }
}

const ORGANIC = { fire: FireSim, water: WaterSim, wind: WindSim };
const ORDER = ['earth', 'fire', 'water', 'wind'];

export class PhysicsWorld {
  constructor() {
    this.sims = {};
    this.t = 0;
    this.acc = 0;
    this.kicks = 0;
    this.noise = makeNoise(97);
    this.pointer = null;      // { x, y, f } while the pointer pushes or pulls
    this.bounds = null;       // { l, r, t } frame edges, used when walls are on
    this.flat = false;        // 2D mode: everything stays in the picture plane
  }

  attach(name, kind, p, seed, time, holder, mat, opts) {
    holder.updateWorldMatrix(true, true);
    this.sims[name] = kind === 'organic' && ORGANIC[name]
      ? new ORGANIC[name](p, seed, time, holder, mat)
      : new RigidSim(name, p, seed, time, holder, mat, opts);
  }
  detach(name) { delete this.sims[name]; }
  has(name) { return !!this.sims[name]; }
  setParams(name, p) { if (this.sims[name]) this.sims[name].p = p; }
  setTime(time) { for (const s of Object.values(this.sims)) s.setTime(time); }
  resetClock() { this.t = 0; this.acc = 0; this.kicks = 0; }

  kick(amount = 6) {
    const rnd = mulberry32(9001 + this.kicks++);
    for (const n of ORDER) if (this.sims[n]) this.sims[n].kick(rnd, amount);
  }

  // Advance by dt seconds of simulated time in fixed steps.
  advance(dt, settings) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 240) {
      const env = makeEnv(settings, this.t, this.noise, this);
      const sims = ORDER.map((n) => this.sims[n]).filter(Boolean);
      const rigid = sims.filter((x) => x.rigid), bodies = rigid.flatMap((x) => x.bodies);
      for (const r of rigid) r.integrate(env);
      for (let it = 0; it < ITER; it++) {
        for (const r of rigid) r.solve(env, it);
        if (env.collide) collideBodies(bodies);
      }
      for (const r of rigid) r.finish(env);
      // the organic forms (flame, liquid, gusts) rest on and flow round the rigid ones
      for (const b of bodies) env.colliders.push({ x: b.pos.x, y: b.pos.y, z: b.pos.z, r: b.rw });
      for (const x of sims) if (!x.rigid) x.step(env);
      this.t += STEP;
      this.acc -= STEP;
      steps++;
    }
    if (steps === 240) this.acc = 0;
    return steps;
  }

  sync() {
    const Minv = new THREE.Matrix4();
    for (const s of Object.values(this.sims)) {
      Minv.copy(s.holder.matrixWorld).invert();
      s.sync(Minv);
    }
  }
}
