// Brand colours. Red, teal, sand and blue come from the flat logo; orange and
// yellow extend the warm side for fire and wind.
export const BRAND = {
  red: '#FF0000', orange: '#FF6A00', yellow: '#FFD400', sand: '#D7B18F',
  teal: '#00A79D', blue: '#0000FF', black: '#000000', white: '#FFFFFF',
};

// A block of text in Monument Extended.
const TEXT = (over) => ({
  on: true, text: 'neuewave', face: 'regular', casing: 'none', style: 'outline', weight: 0.02, colour: 'auto',
  depth: 'through', scale: 1, tracking: 0, leading: 1.2, wrap: 0, align: 'center', stretch: 1, slant: 0, x: 0, y: 0,
  ...over,
});

// One element of the shape system. Every element has the same controls.
const EL = (over) => ({
  on: true, colour: BRAND.white, colour2: BRAND.white, blend: 0.9, kind: 'shape',
  // primitive
  prim: 'sphere', detail: 3, tube: 0.3,
  // supershape: m/n1/n2/n3 shape the outline seen face-on, m2/k1/k2/k3 the profile
  sf: 0, m1: 4, n1: 1, n2: 1, n3: 1, m2: 4, k1: 1, k2: 1, k3: 1,
  // deform
  sx: 1, sy: 1, sz: 1, taper: 0, twist: 0, bend: 0, noise: 0, noiseScale: 1,
  // array
  array: 'scatter', count: 5, spread: 4, arc: 0, size: 0.6, falloff: 0, turn: 0, tumble: 0, jitter: 0.3, follow: true,
  // motion
  flow: 0, spin: 0,
  // physics
  react: 1, weight: 1, lift: 0, stiff: 0.3, link: false, pin: 'none',
  // place
  x: 0, y: 0, z: 0, scale: 1, rot: 0, tilt: 0,
  ...over,
});

// Positions are in scene units: "neuewave" on one line is 10 wide, centred on the origin.
export const BASE = {
  seed: 2021,
  canvas: { format: '16:9', bg: 'black', zoom: 1, grid: false },
  // one look for every element
  style: { dimension: '3d', look: 'solid', surface: 'smooth', finish: 'satin', poly: 1, glow: 0.12, line: 0.035, ink: 'own' },
  light: { fill: 0.2, azimuth: -28, elevation: 48 },
  wordmark: TEXT({}),
  copy: TEXT({ on: false, text: 'earth, fire, water, wind', style: 'fill', scale: 0.2, leading: 2, y: -1.05 }),
  // Earth: cut blocks. Fire: a rising, turning stack of tetrahedra.
  // Water: a thrown arc of drops. Wind: a run of hoops, like a wind tunnel.
  earth: EL({
    colour: BRAND.sand, colour2: '#8C6A50', blend: 0.6, x: -3.5, y: 2.05, z: -1.2,
    prim: 'cube', detail: 2, taper: 0.3, sy: 0.85,
    array: 'scatter', count: 4, spread: 4.8, size: 0.62, jitter: 0.75,
  }),
  fire: EL({
    colour: BRAND.red, colour2: BRAND.yellow, blend: 1, x: 3.3, y: -3.0, z: -0.9,
    prim: 'octa', detail: 1, sx: 0.62, sy: 1.9, sz: 0.62,
    array: 'stack', count: 8, spread: 3.5, arc: 0.7, size: 0.72, falloff: 0.82, turn: 5, tumble: 16, jitter: 0.12,
    flow: 0.5, spin: 0.6, weight: 0, lift: 3, stiff: 0.35, link: true, pin: 'first',
  }),
  water: EL({
    colour: BRAND.blue, colour2: BRAND.teal, blend: 0.9, x: -3.0, y: -2.2, z: -0.9,
    prim: 'sphere', detail: 3, sf: 0.55, m1: 1, n1: 1.6, n2: 1.2, n3: 1.2, m2: 2, k1: 1.4, k2: 1.4, k3: 1.4,
    array: 'line', count: 9, spread: 5.0, arc: 0.24, size: 0.56, falloff: 0.82, jitter: 0.12,
    flow: 0.4, weight: 1, stiff: 0.3,
  }),
  wind: EL({
    colour: BRAND.yellow, colour2: BRAND.orange, blend: 0.6, x: 3.1, y: 2.15, z: -0.6,
    prim: 'torus', detail: 3, tube: 0.07, sx: 0.42,
    array: 'line', count: 9, spread: 5.2, arc: -0.08, size: 1.05, falloff: 0.7, turn: 5, follow: true,
    flow: 0.35, weight: 0, stiff: 0.4, link: true,
  }),
  // the organic builds (chosen per element with Build: Organic)
  flame: {
    count: 5, layers: 3, height: 3.7, width: 1.7, girth: 1, belly: 0.28, taper: 1.3,
    sway: 1, licks: 0.9, curl: 0.35, lean: 0.25, ragged: 0.55, ripple: 0.1, depth: 0.75,
    embers: 14, emberSize: 1, speed: 1,
  },
  liquid: {
    type: 'stream', size: 0.5, length: 5.8, arc: 0.2, wave: 0.6, waves: 1.2, taper: 1.3, head: 0.7, pulse: 0.55, pulses: 3,
    breakup: 0.6, jitter: 0.5, spray: 10, spraySize: 1, spread: 0.7, jets: 7, grain: 0.14, merge: 2.3, detail: 0.07,
    cohesion: 1, viscosity: 0.5,
  },
  gust: {
    type: 'gust', count: 5, length: 5, spacing: 0.5, thick: 0.1, taper: 0.7, wave: 0.6, waves: 1.2,
    turns: 1.2, radius: 0.5, stagger: 0.6, depth: 0.8,
  },
  physics: {
    mode: 'off', gravity: 4, wind: 0, windDir: 0, gust: 0.5, turb: 1.5, turbScale: 0.8, damping: 0.02, bounce: 0.25,
    speed: 1, floor: true, floorY: -3.2, walls: false, collide: true, kick: 6, pointer: 14,
  },
};

const only = (name) => ({
  earth: { on: name === 'earth' }, fire: { on: name === 'fire' },
  water: { on: name === 'water' }, wind: { on: name === 'wind' },
});
const solo = (name, set) => ({ ...only(name), [name]: { on: true, ...set } });
const mono = (hex) => ({ colour: hex, colour2: hex });
const one = (prim, set) => ({ prim, count: 1, array: 'line', size: 1.25, falloff: 0, turn: 0, tumble: 0, jitter: 0, noise: 0, taper: 0, twist: 0, sx: 1, sy: 1, sz: 1, sf: 0, spin: 0.5, flow: 0, link: false, pin: 'none', rot: 22, tilt: 32, scale: 1, ...set });
const SMALL = {
  earth: { scale: 0.5, x: -1.9, y: 2.45 }, wind: { scale: 0.5, x: 1.9, y: 2.5 },
  water: { scale: 0.5, x: -1.8, y: -2.5 }, fire: { scale: 0.55, x: 2.2, y: -3.45 },
};

// Each preset is a set of overrides on BASE.
export const PRESETS = {
  elements: { label: 'Elements', set: {} },
  graphic: { label: '2D graphic', set: { canvas: { bg: 'white' }, style: { dimension: '2d' }, wordmark: { style: 'fill' } } },
  lines: { label: 'Line art', set: { style: { look: 'outline', surface: 'facet' } } },
  wire: { label: 'Wireframe', set: { style: { look: 'wire', poly: 0.6 } } },
  facet: { label: 'Faceted', set: { style: { surface: 'facet', poly: 0.45 }, canvas: { bg: 'white' }, light: { fill: 0.4 }, wordmark: { style: 'fill' } } },
  chrome: { label: 'Chrome', set: { style: { finish: 'chrome', glow: 0 }, light: { fill: 0.35 } } },
  signal: {
    label: 'Signal blue',
    set: { canvas: { bg: 'white' }, style: { dimension: '2d' }, wordmark: { style: 'fill' }, earth: mono(BRAND.blue), fire: mono(BRAND.blue), water: mono(BRAND.blue), wind: mono(BRAND.blue) },
  },
  platonic: {
    label: 'Platonic',
    set: {
      style: { surface: 'facet' },
      earth: one('cube', { x: -4.6, y: 2.3 }), wind: one('octa', { x: 4.6, y: 2.3 }),
      water: one('icosa', { x: -4.6, y: -2.3 }), fire: one('tetra', { x: 4.6, y: -2.3, weight: 0, lift: 0 }),
    },
  },
  supers: {
    label: 'Supershapes',
    set: {
      style: { finish: 'gloss' },
      earth: one('sphere', { x: -4.6, y: 2.3, sf: 1, m1: 4, n1: 8, n2: 8, n3: 8, m2: 4, k1: 8, k2: 8, k3: 8, detail: 4 }),
      wind: one('sphere', { x: 4.6, y: 2.3, sf: 1, m1: 8, n1: 0.6, n2: 1.4, n3: 1.4, m2: 2, k1: 1, k2: 1, k3: 1, detail: 5, sz: 0.5 }),
      water: one('sphere', { x: -4.6, y: -2.3, sf: 1, m1: 5, n1: 2.5, n2: 6, n3: 6, m2: 6, k1: 1.2, k2: 2, k3: 2, detail: 5 }),
      fire: one('sphere', { x: 4.6, y: -2.3, sf: 1, m1: 3, n1: 0.9, n2: 1.6, n3: 1.6, m2: 2, k1: 0.8, k2: 1.2, k3: 1.2, detail: 5, weight: 0, lift: 0 }),
    },
  },
  organic: { label: 'Organic', set: { fire: { kind: 'organic', y: -3.2 }, water: { kind: 'organic' }, wind: { kind: 'organic' } } },
  stacked: {
    label: 'Stacked 1:1',
    set: { canvas: { format: '1:1', zoom: 1.75 }, wordmark: { text: 'neue\nwave' }, physics: { floorY: -3.55 }, ...SMALL },
  },
  nw: {
    label: 'nw',
    set: { canvas: { format: '1:1', zoom: 1.75 }, wordmark: { text: 'nw', scale: 1.9, face: 'ultrabold', style: 'fill' }, physics: { floorY: -3.55 }, ...SMALL },
  },
  copy: { label: 'With copy', set: { wordmark: { y: 0.25 }, copy: { on: true } } },
  drop: {
    label: 'Drop',
    set: {
      physics: { mode: 'run', gravity: 7, turb: 0.3, walls: true, bounce: 0.35 },
      earth: { stiff: 0 }, fire: { stiff: 0, weight: 1, lift: 0, link: false, pin: 'none' }, water: { stiff: 0 }, wind: { stiff: 0, weight: 1, link: false },
    },
  },
  gale: {
    label: 'Gale',
    set: {
      physics: { mode: 'run', gravity: 1, wind: 5, windDir: 6, gust: 1, turb: 3.5, turbScale: 0.6 },
      earth: { stiff: 0.7 }, fire: { stiff: 0.25 }, water: { stiff: 0.3 }, wind: { stiff: 0.3, pin: 'first' },
    },
  },
  earth: { label: 'Earth', set: solo('earth', { x: 0, y: 2.0, scale: 1.2 }) },
  fire: { label: 'Fire', set: solo('fire', { x: 0, y: -3.2, scale: 1.3 }) },
  water: { label: 'Water', set: solo('water', { x: 0, y: -2.0, scale: 1.3 }) },
  wind: { label: 'Wind', set: solo('wind', { x: 0, y: 2.0, scale: 1.3 }) },
};

export function applyPreset(key, seed) {
  const out = JSON.parse(JSON.stringify(BASE));
  const set = PRESETS[key].set;
  for (const section of Object.keys(set)) Object.assign(out[section], set[section]);
  if (seed !== undefined) out.seed = seed;
  return out;
}
