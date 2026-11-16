// Liquid surface: turns a set of balls into one smooth skin (metaballs,
// polygonised with marching cubes). Balls that sit close together merge;
// balls that drift apart pinch off into separate drops.
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

const MAX_CELLS = 420000;

export class IsoSurface {
  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.cap = 0;
    this.field = new Float32Array(0);
    this.tfield = new Float32Array(0);
    this.vp = new Float32Array(36); this.vn = new Float32Array(36); this.vt = new Float32Array(12);
  }

  ensure(n) {
    if (n <= this.cap) return;
    const cap = Math.max(n, this.cap * 2, 60000);
    const grow = (old, size) => { const a = new Float32Array(cap * size); if (old) a.set(old); return a; };
    this.pos = grow(this.pos, 3); this.nor = grow(this.nor, 3); this.tint = grow(this.tint, 1);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(this.tint, 1));
    this.geometry.deleteAttribute('color');
    this.cap = cap;
  }

  // balls: [x, y, z, radius, tint] * n.  merge: how far a ball's pull reaches
  // (in radii).  cell: grid size in the same units as the balls.
  build(balls, n, merge, cell) {
    const g = this.geometry;
    if (!n) { this.ensure(3); g.setDrawRange(0, 0); return g; }
    const k = Math.max(1.2, merge), iso = Math.pow(1 - 1 / (k * k), 3);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const b = i * 5, R = balls[b + 3] * k;
      x0 = Math.min(x0, balls[b] - R); x1 = Math.max(x1, balls[b] + R);
      y0 = Math.min(y0, balls[b + 1] - R); y1 = Math.max(y1, balls[b + 1] + R);
      z0 = Math.min(z0, balls[b + 2] - R); z1 = Math.max(z1, balls[b + 2] + R);
    }
    let h = Math.max(0.01, cell), nx, ny, nz;
    for (;;) {
      nx = Math.ceil((x1 - x0) / h) + 3; ny = Math.ceil((y1 - y0) / h) + 3; nz = Math.ceil((z1 - z0) / h) + 3;
      if (nx * ny * nz <= MAX_CELLS) break;
      h *= 1.12;
    }
    const ox = x0 - h, oy = y0 - h, oz = z0 - h, nxy = nx * ny, total = nxy * nz;
    if (this.field.length < total) { this.field = new Float32Array(total); this.tfield = new Float32Array(total); }
    const F = this.field, TF = this.tfield;
    F.fill(0, 0, total); TF.fill(0, 0, total);
    for (let i = 0; i < n; i++) {
      const b = i * 5, bx = balls[b], by = balls[b + 1], bz = balls[b + 2], R = balls[b + 3] * k, R2 = R * R, t = balls[b + 4];
      const i0 = Math.max(0, Math.floor((bx - R - ox) / h)), i1 = Math.min(nx - 1, Math.ceil((bx + R - ox) / h));
      const j0 = Math.max(0, Math.floor((by - R - oy) / h)), j1 = Math.min(ny - 1, Math.ceil((by + R - oy) / h));
      const k0 = Math.max(0, Math.floor((bz - R - oz) / h)), k1 = Math.min(nz - 1, Math.ceil((bz + R - oz) / h));
      for (let c = k0; c <= k1; c++) {
        const dz = oz + c * h - bz, dz2 = dz * dz;
        for (let bb = j0; bb <= j1; bb++) {
          const dy = oy + bb * h - by, dyz = dy * dy + dz2;
          if (dyz >= R2) continue;
          let q = i0 + bb * nx + c * nxy;
          for (let a = i0; a <= i1; a++, q++) {
            const dx = ox + a * h - bx, d2 = dx * dx + dyz;
            if (d2 < R2) { const w = 1 - d2 / R2, w3 = w * w * w; F[q] += w3; TF[q] += w3 * t; }
          }
        }
      }
    }

    const vp = this.vp, vn = this.vn, vt = this.vt;
    let count = 0;
    // one vertex on the grid edge between nodes A and B
    const edge = (e, qa, ax, ay, az, qb, bx, by, bz) => {
      const fa = F[qa], fb = F[qb];
      let mu = (iso - fa) / (fb - fa);
      if (!(mu >= 0 && mu <= 1)) mu = 0.5;
      vp[e * 3] = ox + (ax + (bx - ax) * mu) * h;
      vp[e * 3 + 1] = oy + (ay + (by - ay) * mu) * h;
      vp[e * 3 + 2] = oz + (az + (bz - az) * mu) * h;
      // normal: the field falls away from the liquid, so its negative gradient points out
      const gax = F[qa - (ax > 0 ? 1 : 0)] - F[qa + (ax < nx - 1 ? 1 : 0)], gbx = F[qb - (bx > 0 ? 1 : 0)] - F[qb + (bx < nx - 1 ? 1 : 0)];
      const gay = F[qa - (ay > 0 ? nx : 0)] - F[qa + (ay < ny - 1 ? nx : 0)], gby = F[qb - (by > 0 ? nx : 0)] - F[qb + (by < ny - 1 ? nx : 0)];
      const gaz = F[qa - (az > 0 ? nxy : 0)] - F[qa + (az < nz - 1 ? nxy : 0)], gbz = F[qb - (bz > 0 ? nxy : 0)] - F[qb + (bz < nz - 1 ? nxy : 0)];
      let gx = gax + (gbx - gax) * mu, gy = gay + (gby - gay) * mu, gz = gaz + (gbz - gaz) * mu;
      const gl = Math.hypot(gx, gy, gz) || 1;
      vn[e * 3] = gx / gl; vn[e * 3 + 1] = gy / gl; vn[e * 3 + 2] = gz / gl;
      const wa = fa + (fb - fa) * mu, ta = TF[qa] + (TF[qb] - TF[qa]) * mu;
      vt[e] = wa > 1e-6 ? ta / wa : 0;
    };

    for (let c = 0; c < nz - 1; c++) for (let b = 0; b < ny - 1; b++) {
      let q = b * nx + c * nxy;
      for (let a = 0; a < nx - 1; a++, q++) {
        const q1 = q + 1, qy = q + nx, q1y = q1 + nx, qz = q + nxy, q1z = q1 + nxy, qyz = qy + nxy, q1yz = q1y + nxy;
        let ci = 0;
        if (F[q] < iso) ci |= 1; if (F[q1] < iso) ci |= 2; if (F[qy] < iso) ci |= 8; if (F[q1y] < iso) ci |= 4;
        if (F[qz] < iso) ci |= 16; if (F[q1z] < iso) ci |= 32; if (F[qyz] < iso) ci |= 128; if (F[q1yz] < iso) ci |= 64;
        const bits = edgeTable[ci];
        if (bits === 0) continue;
        const a1 = a + 1, b1 = b + 1, c1 = c + 1;
        if (bits & 1) edge(0, q, a, b, c, q1, a1, b, c);
        if (bits & 2) edge(1, q1, a1, b, c, q1y, a1, b1, c);
        if (bits & 4) edge(2, qy, a, b1, c, q1y, a1, b1, c);
        if (bits & 8) edge(3, q, a, b, c, qy, a, b1, c);
        if (bits & 16) edge(4, qz, a, b, c1, q1z, a1, b, c1);
        if (bits & 32) edge(5, q1z, a1, b, c1, q1yz, a1, b1, c1);
        if (bits & 64) edge(6, qyz, a, b1, c1, q1yz, a1, b1, c1);
        if (bits & 128) edge(7, qz, a, b, c1, qyz, a, b1, c1);
        if (bits & 256) edge(8, q, a, b, c, qz, a, b, c1);
        if (bits & 512) edge(9, q1, a1, b, c, q1z, a1, b, c1);
        if (bits & 1024) edge(10, q1y, a1, b1, c, q1yz, a1, b1, c1);
        if (bits & 2048) edge(11, qy, a, b1, c, qyz, a, b1, c1);
        for (let t = ci << 4; triTable[t] !== -1; t += 3) {
          this.ensure(count + 3);
          for (let v = 0; v < 3; v++) {
            const e = triTable[t + v], o = (count + v) * 3;
            this.pos[o] = vp[e * 3]; this.pos[o + 1] = vp[e * 3 + 1]; this.pos[o + 2] = vp[e * 3 + 2];
            this.nor[o] = vn[e * 3]; this.nor[o + 1] = vn[e * 3 + 1]; this.nor[o + 2] = vn[e * 3 + 2];
            this.tint[count + v] = vt[e];
          }
          count += 3;
        }
      }
    }
    this.ensure(3);
    g.setDrawRange(0, count);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2);
    g.boundingBox = null;
    return g;
  }
}
