// neuewave mark generator: scene, interaction, physics and export.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ORGANIC, applyTint } from './elements.js';
import { buildShapes } from './shapes.js';
import { OutlinePass } from './outline.js';
import { traceRegions, composeSvg } from './svg.js';
import { buildWordmark, MODULE } from './wordmark.js';
import { BASE, PRESETS, applyPreset } from './presets.js';
import { buildPanel, RECORD_SCHEMA } from './ui.js';
import { PhysicsWorld } from './physics.js';
import { record } from './recorder.js';
import { collection } from './store.js';

const ELEMENTS = ['earth', 'fire', 'water', 'wind'];
const ASPECT = { '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5, '3:1': 3 };
const GROUND = { black: '#000000', white: '#FFFFFF', blue: '#0000FF' };
const VIEW_W = 13.4; // scene units across the frame at zoom 1
const STORE = 'neuewave-mark-v3';
// the organic builds keep their own settings in these sections
const ORGANIC_OF = { fire: 'flame', water: 'liquid', wind: 'gust' };
const OWNER = { flame: 'fire', liquid: 'water', gust: 'wind' };
const COMMON = ['colour', 'colour2', 'blend', 'react', 'weight', 'lift', 'stiff', 'pin'];
const TEXTS = ['wordmark', 'copy'];
const REC_STORE = 'neuewave-mark-record-v1';
const REC_BASE = { record: { format: 'gif', drive: 'both', start: 'reset', seconds: 4, preroll: 0, fps: 30, size: 1080 } };
// Element keys that only change how a form responds, so a running simulation keeps going.
const LIVE_KEYS = ['react', 'weight', 'lift', 'stiff', 'pin', 'link', 'spin', 'cohesion', 'viscosity'];
const PLACE_KEYS = ['x', 'y', 'z', 'scale', 'tilt', 'rot'];

const $ = (id) => document.getElementById(id);
const canvas = $('gl'), frame = $('frame'), stage = $('stage'), gridSvg = $('grid'), status = $('status');

let state = load() || applyPreset('elements');
let rec = loadRec();
let presetKey = 'custom';
let time = 0, playing = false, needsRender = true;
let recording = null;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
camera.layers.enableAll();
const outline = new OutlinePass(renderer);
// a soft studio environment, used for reflections by the glossier finishes
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xffffff, Math.PI);
const fill = new THREE.AmbientLight(0xffffff, 0);
scene.add(key, fill);
const resolution = new THREE.Vector2(1, 1);
const groups = {};
const world = new PhysicsWorld();
const texts = {};

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    return merge(JSON.parse(raw));
  } catch (e) { return null; }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage is optional */ } }
function loadRec() {
  const out = JSON.parse(JSON.stringify(REC_BASE));
  try {
    const raw = JSON.parse(localStorage.getItem(REC_STORE) || 'null');
    if (raw && raw.record) for (const k of Object.keys(out.record)) if (typeof raw.record[k] === typeof out.record[k]) out.record[k] = raw.record[k];
  } catch (e) { /* storage is optional */ }
  return out;
}
function saveRec() { try { localStorage.setItem(REC_STORE, JSON.stringify(rec)); } catch (e) { /* storage is optional */ } }

// Accept only known keys, so old or hand-edited settings cannot break the tool.
function merge(input) {
  const out = JSON.parse(JSON.stringify(BASE));
  if (!input || typeof input !== 'object') return out;
  if (Number.isFinite(input.seed)) out.seed = input.seed;
  for (const sec of Object.keys(BASE)) {
    if (sec === 'seed' || typeof input[sec] !== 'object' || !input[sec]) continue;
    for (const k of Object.keys(BASE[sec])) {
      if (typeof input[sec][k] === typeof BASE[sec][k]) out[sec][k] = input[sec][k];
    }
  }
  return out;
}

function inkColour(sec) {
  if (state[sec].colour !== 'auto' && state[sec].colour) return state[sec].colour;
  return state.canvas.bg === 'white' || state.canvas.bg === 'clear' ? '#000000' : '#FFFFFF';
}

const simOn = () => state.physics.mode !== 'off' || !!(recording && recording.phys);

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  scene.remove(g);
}

// ---- style: one look for every element
const FINISH = {
  matte: { roughness: 0.95, metalness: 0, env: 0 }, satin: { roughness: 0.45, metalness: 0, env: 0.45 },
  gloss: { roughness: 0.1, metalness: 0, env: 1 }, chrome: { roughness: 0.18, metalness: 0.92, env: 3.2 },
};
const is2d = () => state.style.dimension === '2d';
const unlit = () => is2d() || state.style.look === 'outline';
const shapeOpts = () => ({ flat: is2d(), poly: state.style.poly });
const kindOf = (name) => (ORGANIC_OF[name] && state[name].kind === 'organic' ? 'organic' : 'shape');
// what a builder or simulation receives: an organic build reads its own
// section plus the element's colours and physics response
function elementParams(name) {
  if (kindOf(name) !== 'organic') return state[name];
  const p = { ...state[ORGANIC_OF[name]] };
  for (const k of COMMON) p[k] = state[name][k];
  return p;
}

function material(p) {
  const st = state.style, wire = st.look === 'wire';
  if (unlit()) return new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, wireframe: wire });
  const f = FINISH[st.finish] || FINISH.satin;
  return new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: f.roughness, metalness: f.metalness, side: THREE.DoubleSide,
    envMap, envMapIntensity: f.env, flatShading: st.surface === 'facet', wireframe: wire,
    emissive: new THREE.Color(p.colour), emissiveIntensity: st.glow,
  });
}

function buildStatic(name, p) {
  return kindOf(name) === 'organic' ? ORGANIC[name](p, state.seed, time) : buildShapes(p, state.seed, name, time, shapeOpts());
}

function place(name) {
  const p = state[name], g = groups[name];
  if (!g) return;
  g.position.set(p.x, p.y, p.z);
  g.scale.setScalar(p.scale);
  g.rotation.y = is2d() ? 0 : THREE.MathUtils.degToRad(p.tilt);
  g.userData.holder.rotation.z = THREE.MathUtils.degToRad(p.rot);
}

// Each element is group (position, scale, tilt) > holder (in-plane rotation) > meshes.
// With physics on, the meshes belong to the simulation.
function buildElement(name) {
  if (groups[name]) disposeGroup(groups[name]);
  world.detach(name);
  const p = elementParams(name);
  const g = new THREE.Group();
  g.name = name;
  g.visible = state[name].on;
  const holder = new THREE.Group();
  g.add(holder);
  g.userData.holder = holder;
  groups[name] = g;
  place(name);
  scene.add(g);
  if (!state[name].on) return;
  const mat = material(p);
  world.flat = is2d();
  if (simOn()) world.attach(name, kindOf(name), p, state.seed, time, holder, mat, shapeOpts());
  else holder.add(new THREE.Mesh(applyTint(buildStatic(name, p), p.colour, p.colour2, p.blend), mat));
}

function buildText(sec) {
  if (texts[sec]) disposeGroup(texts[sec]);
  texts[sec] = null;
  if (!state[sec].on) return;
  texts[sec] = buildWordmark(state[sec], inkColour(sec), resolution);
  scene.add(texts[sec]);
}
const buildTexts = () => TEXTS.forEach(buildText);

function applyLight() {
  const az = THREE.MathUtils.degToRad(state.light.azimuth), el = THREE.MathUtils.degToRad(state.light.elevation);
  key.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(10);
  fill.intensity = state.light.fill * Math.PI;
}

function viewSize() {
  const a = ASPECT[state.canvas.format];
  const w = VIEW_W / state.canvas.zoom;
  return { w, h: w / a, a };
}

function layoutFrame() {
  if (recording) return;
  const { a } = viewSize();
  const availW = stage.clientWidth, availH = stage.clientHeight;
  let w = availW, h = w / a;
  if (h > availH) { h = availH; w = h * a; }
  frame.style.width = Math.floor(w) + 'px';
  frame.style.height = Math.floor(h) + 'px';
  frame.dataset.bg = state.canvas.bg;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(Math.floor(w), Math.floor(h), false);
  setCamera();
  drawGrid();
}

function setCamera() {
  const { w, h } = viewSize();
  camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2;
  camera.position.set(0, 0, 50);
  camera.updateProjectionMatrix();
  world.bounds = { l: -w / 2, r: w / 2, t: h / 2 };
  renderer.getDrawingBufferSize(resolution);
  if (state.canvas.bg === 'clear') renderer.setClearColor(0x000000, 0);
  else renderer.setClearColor(GROUND[state.canvas.bg], 1);
}

// The construction grid (one module = the x-height of the wordmark) and,
// with physics on, the floor line. Neither appears in exports.
function drawGrid() {
  const { w, h } = viewSize();
  const showFloor = state.physics.mode !== 'off' && state.physics.floor;
  gridSvg.style.display = state.canvas.grid || showFloor ? 'block' : 'none';
  const ink = state.canvas.bg === 'white' || state.canvas.bg === 'clear' ? '#000' : '#fff';
  const hi = state.canvas.bg === 'blue' ? '#fff' : '#00f';
  gridSvg.setAttribute('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`);
  const sw = w / 1400;
  let out = '';
  if (state.canvas.grid) {
    let s = '';
    for (let x = MODULE / 2; x < w / 2; x += MODULE) {
      s += `<line x1="${x}" x2="${x}" y1="${-h / 2}" y2="${h / 2}"/><line x1="${-x}" x2="${-x}" y1="${-h / 2}" y2="${h / 2}"/>`;
    }
    for (let y = MODULE / 2; y < h / 2; y += MODULE) {
      s += `<line y1="${y}" y2="${y}" x1="${-w / 2}" x2="${w / 2}"/><line y1="${-y}" y2="${-y}" x1="${-w / 2}" x2="${w / 2}"/>`;
    }
    // the wordmark's ink box, and its clear space of one module
    const b = texts.wordmark ? texts.wordmark.userData.bounds : { x0: 0, x1: 0, y0: 0, y1: 0 };
    const m = MODULE * state.wordmark.scale, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const box = `<rect x="${b.x0}" y="${-b.y1}" width="${bw}" height="${bh}"/>`
              + `<rect x="${b.x0 - m}" y="${-b.y1 - m}" width="${bw + 2 * m}" height="${bh + 2 * m}" stroke-dasharray="${sw * 6} ${sw * 6}"/>`;
    out += `<g fill="none" stroke="${ink}" stroke-opacity="0.28" stroke-width="${sw}">${s}</g>`
         + `<g fill="none" stroke="${hi}" stroke-width="${sw * 1.6}">${box}</g>`;
  }
  if (showFloor) {
    const y = -state.physics.floorY;
    out += `<line x1="${-w / 2}" x2="${w / 2}" y1="${y}" y2="${y}" stroke="${hi}" stroke-width="${sw * 1.6}" stroke-dasharray="${sw * 10} ${sw * 6}"/>`;
  }
  gridSvg.innerHTML = out;
}

function rebuildAll() {
  applyLight();
  layoutFrame();
  ELEMENTS.forEach(buildElement);
  buildTexts();
  needsRender = true;
}

function change(section, k) {
  presetKey = 'custom';
  markPreset();
  if (section === 'canvas') { layoutFrame(); buildTexts(); }
  else if (section === 'light') applyLight();
  else if (section === 'style') { if (k !== 'line' && k !== 'ink') ELEMENTS.forEach(buildElement); }
  else if (OWNER[section]) {
    if (LIVE_KEYS.includes(k) && world.has(OWNER[section])) world.setParams(OWNER[section], elementParams(OWNER[section]));
    else buildElement(OWNER[section]);
  }
  else if (TEXTS.includes(section)) { buildText(section); drawGrid(); }
  else if (section === 'physics') {
    if (k === 'mode') {
      const hasSims = ELEMENTS.some((n) => world.has(n));
      if (hasSims !== simOn()) { world.resetClock(); ELEMENTS.forEach(buildElement); }
    }
    drawGrid();
  }
  else if (PLACE_KEYS.includes(k)) place(section);
  else if (LIVE_KEYS.includes(k) && world.has(section)) world.setParams(section, elementParams(section));
  else {
    buildElement(section);
    if (k === 'kind' || k === 'prim') mountPanel();      // these change which controls are shown
  }
  needsRender = true;
  save();
}

function markPreset() {
  document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === presetKey)));
}

function simReset() {
  world.resetClock();
  ELEMENTS.forEach(buildElement);
  needsRender = true;
  status.textContent = simOn() ? 'Simulation reset' : 'Set Simulate to Run first';
}
function simKick() {
  if (!simOn()) { state.physics.mode = 'run'; panel.sync(); change('physics', 'mode'); }
  if (state.physics.mode === 'hold') { state.physics.mode = 'run'; panel.sync(); drawGrid(); save(); }
  world.kick(state.physics.kick);
  status.textContent = 'Kick';
}

let panel;
function mountPanel() {
  panel = buildPanel($('controls'), () => state, {
    change,
    simReset,
    simKick,
    textOne: (sec) => setText(sec, 'neuewave'),
    textTwo: (sec) => setText(sec, 'neue\nwave'),
    textNw: (sec) => setText(sec, 'nw'),
    textShuffle,
    sfRandom,
    sfReset,
    preset: (k) => { state = applyPreset(k, k === 'elements' ? BASE.seed : state.seed); presetKey = k; world.resetClock(); mountPanel(); rebuildAll(); save(); },
    seed: (n) => { state.seed = n; mountPanel(); rebuildAll(); save(); },
  });
  markPreset();
}

// ---- text shortcuts
function setText(sec, text) {
  state[sec].text = text;
  state[sec].on = true;
  panel.sync();
  change(sec, 'text');
}
// A random typographic treatment of the same words, for quick variations.
function textShuffle(sec) {
  const r = Math.random, pick = (list) => list[Math.floor(r() * list.length)];
  Object.assign(state[sec], {
    face: pick(['regular', 'regular', 'ultrabold']),
    casing: pick(['none', 'none', 'lower', 'upper']),
    style: pick(['outline', 'fill']),
    weight: Number((0.01 + r() * 0.04).toFixed(3)),
    tracking: Number(pick([0, 0, -0.04, 0.06, 0.15, 0.3]).toFixed(3)),
    stretch: Number(pick([1, 1, 0.8, 1.2, 1.4]).toFixed(2)),
    slant: pick([0, 0, 0, 10, -10, 18]),
    leading: Number(pick([1.2, 1.2, 1.05, 1.5]).toFixed(2)),
    align: pick(['center', 'center', 'left', 'right']),
  });
  panel.sync();
  change(sec, 'text');
  status.textContent = 'Shuffled. Save the ones you like to the collection.';
}

// ---- supershape shortcuts
function sfRandom(sec) {
  const r = Math.random, p = state[sec], n = () => Number((0.3 + r() * r() * 8).toFixed(2));
  Object.assign(p, { sf: Number((0.6 + r() * 0.4).toFixed(2)), m1: Math.floor(r() * 10), n1: n(), n2: n(), m2: Math.floor(r() * 8), k1: n(), k2: n() });
  // equal second and third exponents keep the outline closed for any lobe count
  p.n3 = p.n2; p.k3 = p.k2;
  panel.sync();
  change(sec, 'sf');
}
function sfReset(sec) {
  Object.assign(state[sec], { sf: 0, m1: 4, n1: 1, n2: 1, n3: 1, m2: 4, k1: 1, k2: 1, k3: 1 });
  panel.sync();
  change(sec, 'sf');
}

// ---- drawing: the plain renderer, or the line-art pass
function draw() {
  if (state.style.look !== 'outline') { renderer.render(scene, camera); return; }
  const px = renderer.getDrawingBufferSize(new THREE.Vector2()).x / viewSize().w;
  outline.render(scene, camera, {
    widthPx: state.style.line * px, creases: state.style.surface === 'facet',
    mono: state.style.ink === 'mono' ? inkColour('wordmark') : null,
  });
}

// ---- motion: the slow designed drift (separate from physics)
function motionStep() {
  const sim = simOn();
  if (sim) world.setTime(time);
  const moves = (n) => kindOf(n) === 'organic' || state[n].flow !== 0 || state[n].spin !== 0;
  for (const n of ELEMENTS) if (state[n].on && !sim && moves(n)) buildElement(n);
}

function physicsStep(dt) {
  scene.updateMatrixWorld();
  world.advance(dt * state.physics.speed, state.physics);
  world.sync();
}

// ---- direct manipulation: drag to move, shift-drag to rotate, wheel to scale
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(ELEMENTS.map((n) => groups[n]).filter((g) => g && g.visible), true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o.parent && !ELEMENTS.includes(o.name)) o = o.parent;
  return o.name;
}

function worldPoint(ev) {
  const r = canvas.getBoundingClientRect(), v = viewSize();
  return { x: ((ev.clientX - r.left) / r.width - 0.5) * v.w, y: (0.5 - (ev.clientY - r.top) / r.height) * v.h };
}
function pickText(ev) {
  const pt = worldPoint(ev), pad = 0.15;
  return TEXTS.slice().reverse().find((sec) => {
    const b = texts[sec] && texts[sec].userData.bounds;
    return b && pt.x > b.x0 - pad && pt.x < b.x1 + pad && pt.y > b.y0 - pad && pt.y < b.y1 + pad;
  }) || null;
}
const pushing = () => state.physics.mode === 'run' && state.physics.pointer !== 0;

canvas.addEventListener('pointerdown', (ev) => {
  if (recording) return;
  const name = pick(ev) || (pushing() ? null : pickText(ev));
  canvas.setPointerCapture(ev.pointerId);
  if (!name) {
    // with physics running, the pointer pushes (or pulls) whatever is near it
    if (pushing()) { world.pointer = { ...worldPoint(ev), f: state.physics.pointer }; status.textContent = state.physics.pointer > 0 ? 'Pushing' : 'Pulling'; }
    return;
  }
  drag = { name, x: ev.clientX, y: ev.clientY, px: state[name].x, py: state[name].y, rot: state[name].rot };
  panel.open(name);
  status.textContent = name[0].toUpperCase() + name.slice(1) + ' selected';
});
canvas.addEventListener('pointermove', (ev) => {
  if (recording) return;
  if (world.pointer) { Object.assign(world.pointer, worldPoint(ev)); return; }
  if (!drag) { canvas.style.cursor = pick(ev) || (!pushing() && pickText(ev)) ? 'grab' : pushing() ? 'crosshair' : 'default'; return; }
  const unit = viewSize().w / canvas.getBoundingClientRect().width;
  const p = state[drag.name];
  const isText = TEXTS.includes(drag.name);
  if (ev.shiftKey && !isText) {
    p.rot = ((drag.rot - (ev.clientX - drag.x) * 0.5) % 360 + 360) % 360;
  } else {
    let x = drag.px + (ev.clientX - drag.x) * unit, y = drag.py - (ev.clientY - drag.y) * unit;
    if (state.canvas.grid) { const q = MODULE / 2; x = Math.round(x / q) * q; y = Math.round(y / q) * q; }
    p.x = x; p.y = y;
  }
  if (isText) { texts[drag.name].position.x = p.x; texts[drag.name].position.y = p.y; }
  else place(drag.name);
  presetKey = 'custom'; markPreset();
  needsRender = true;
});
const endDrag = () => {
  world.pointer = null;
  if (!drag) return;
  if (TEXTS.includes(drag.name)) { buildText(drag.name); drawGrid(); }
  drag = null; panel.sync(); save();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (ev) => {
  if (recording) return;
  const name = pick(ev);
  if (!name) return;
  ev.preventDefault();
  const p = state[name];
  p.scale = THREE.MathUtils.clamp(p.scale * (ev.deltaY < 0 ? 1.04 : 0.96), 0.2, 2.5);
  place(name);
  presetKey = 'custom'; markPreset();
  panel.sync(); needsRender = true; save();
}, { passive: false });

// ---- saving files
async function saveBlob(blob, filename, previewable) {
  // Inside a Claude artifact the page saves through the host; as a local file it downloads directly.
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const downloads = await window.claude.use('downloads');
      if (downloads) { await downloads.save({ filename, data: blob }); status.textContent = 'Saved ' + filename; return; }
    } catch (e) {
      if (e && e.code === 'declined') { status.textContent = 'Export cancelled'; return; }
    }
    if (previewable) { showPreview(blob, filename); return; }
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status.textContent = 'Saved ' + filename;
}

function sizeFor(longEdge) {
  const { a } = viewSize();
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return a >= 1 ? { w: even(longEdge), h: even(longEdge / a) } : { w: even(longEdge * a), h: even(longEdge) };
}

function setRenderSize(w, h) {
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.getDrawingBufferSize(resolution);
}

function restoreRenderSize() {
  layoutFrame();
  needsRender = true;
}

function renderToBlob(longEdge) {
  const { w, h } = sizeFor(longEdge);
  setRenderSize(w, h);
  draw();
  return new Promise((resolve) => canvas.toBlob((blob) => { restoreRenderSize(); resolve({ blob, w, h }); }, 'image/png'));
}

async function exportPng() {
  if (recording) return;
  const edge = Number(document.querySelector('#sizes [aria-pressed="true"]').dataset.size);
  status.textContent = 'Rendering…';
  const { blob, w, h } = await renderToBlob(edge);
  await saveBlob(blob, `neuewave-mark-${presetKey}-${state.seed}-${w}x${h}.png`, true);
}

// Vector export: trace the flat picture of the forms, add the text as outlines.
async function exportSvg() {
  if (recording) return;
  status.textContent = 'Tracing…';
  await new Promise((r) => setTimeout(r, 20));
  const out = sizeFor(2000), tr = sizeFor(3000), v = viewSize(), f = out.w / v.w;
  const isLine = state.style.look === 'outline';
  let data;
  if (isLine) {
    // line art: trace the drawn lines themselves, so the file matches the screen
    data = outline.readLines(scene, camera, tr.w, tr.h, {
      widthPx: (state.style.line * tr.w) / v.w, creases: state.style.surface === 'facet',
      mono: state.style.ink === 'mono' ? inkColour('wordmark') : null,
    });
  } else {
    // every form in flat colour, whatever the current finish
    const swapped = [];
    const flatMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    for (const n of ELEMENTS) groups[n].traverse((o) => { if (o.isMesh) { swapped.push([o, o.material]); o.material = flatMat; } });
    data = outline.readFlat(scene, camera, tr.w, tr.h);
    for (const [o, m] of swapped) o.material = m;
    flatMat.dispose();
  }
  const regions = traceRegions(data, tr.w, tr.h, isLine ? 24 : 48);
  const toPx = (t) => ({ ...t, weight: t.weight * f, loops: t.loops.map((l) => l.map((c, i) => (i % 2 ? (v.h / 2 - c) * f : (c + v.w / 2) * f))) });
  const vectors = TEXTS.filter((sec) => texts[sec]).map((sec) => toPx(texts[sec].userData.vector));
  const svg = composeSvg({
    w: out.w, h: out.h, scale: out.w / tr.w, regions, seal: isLine ? 0 : 0.6,
    ground: state.canvas.bg === 'clear' ? null : GROUND[state.canvas.bg],
    textsBehind: vectors.filter((t) => t.behind), textsFront: vectors.filter((t) => !t.behind),
  });
  needsRender = true;
  await saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `neuewave-mark-${presetKey}-${state.seed}.svg`, false);
}

function showPreview(blob, filename) {
  const img = $('previewImg');
  img.src = URL.createObjectURL(blob);
  img.alt = filename;
  $('preview').hidden = false;
  status.textContent = 'Saving is not available in this view. Right-click or long-press the image to save it.';
}

// ---- recording: GIF, MP4, WebM or PNG frames, rendered frame by frame
const recUi = {};
function recordBlock() {
  const block = document.createElement('div');
  block.className = 'block';
  block.innerHTML = `<div class="pair"><button type="button" class="solid" id="recStart">Record</button><button type="button" id="recCancel" disabled>Cancel</button></div>
    <progress id="recProgress" max="1" value="0" hidden></progress>
    <p class="note">Records frame by frame, so the result is smooth whatever the speed of this computer. Settle runs the physics before the first frame. A clear ground becomes white in GIF and video; PNG frames keep transparency.</p>`;
  recUi.start = block.querySelector('#recStart');
  recUi.cancel = block.querySelector('#recCancel');
  recUi.progress = block.querySelector('#recProgress');
  recUi.start.addEventListener('click', startRecording);
  recUi.cancel.addEventListener('click', () => { if (recording) recording.cancelled = true; });
  return block;
}

function lockUi(on) {
  document.querySelectorAll('aside button, aside input, aside textarea').forEach((n) => { if (n !== recUi.cancel) n.disabled = on; });
  recUi.cancel.disabled = !on;
  recUi.progress.hidden = !on;
}

async function startRecording() {
  if (recording) return;
  const r = rec.record;
  const fps = r.fps, frames = Math.max(1, Math.round(r.seconds * fps));
  const usePhys = r.drive !== 'motion', useMotion = r.drive !== 'physics';
  const hadSims = ELEMENTS.some((n) => world.has(n));
  const prevTime = time;
  recording = { cancelled: false, phys: usePhys };
  lockUi(true);
  try {
    if (r.start === 'reset') time = 0;
    if (r.start === 'reset' || (usePhys && !hadSims)) { world.resetClock(); ELEMENTS.forEach(buildElement); }
    if (usePhys && r.preroll > 0) {
      const total = Math.round(r.preroll * 60);
      for (let s = 0; s < total && !recording.cancelled; s += 30) {
        physicsStep(Math.min(30, total - s) / 60 / state.physics.speed);
        recUi.progress.value = s / total;
        status.textContent = `Settling ${Math.round((100 * s) / total)}%`;
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    const { w, h } = sizeFor(r.size);
    setRenderSize(w, h);
    const base = `neuewave-mark-${presetKey}-${state.seed}-${w}x${h}-${fps}fps`;
    const out = await record({
      format: r.format, frames, fps, w, h, base,
      ground: GROUND[state.canvas.bg] || '#FFFFFF',
      keepAlpha: state.canvas.bg === 'clear',
      renderFrame: (i) => {
        if (i > 0) {
          if (useMotion) { time += 1 / fps; motionStep(); }
          if (usePhys) physicsStep(1 / fps);
        }
        draw();
        return canvas;
      },
      onProgress: (i, n, phase) => {
        recUi.progress.value = i / n;
        status.textContent = phase === 'encoding' ? 'Encoding…' : `Recording frame ${i} of ${n}`;
      },
      isCancelled: () => recording.cancelled,
    });
    recording.phys = false;
    if (useMotion && !playing) time = prevTime;
    restoreRenderSize();
    if (usePhys && !hadSims && state.physics.mode === 'off') ELEMENTS.forEach(buildElement);
    else if (useMotion && !playing) motionStep();
    if (!out) { status.textContent = 'Recording cancelled'; return; }
    await saveBlob(out.blob, `${base}.${out.ext}`, out.ext === 'gif');
  } catch (e) {
    console.error(e);
    status.textContent = 'Recording failed: ' + (e && e.message ? e.message : e);
    restoreRenderSize();
  } finally {
    recording = null;
    lockUi(false);
    needsRender = true;
  }
}

// ---- collection: saved variations with thumbnails, kept in this browser
let items = [];
function thumbnail() {
  const { w, h } = sizeFor(480);
  setRenderSize(w, h);
  draw();
  const url = state.canvas.bg === 'clear' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86);
  restoreRenderSize();
  return url;
}
function loadItem(item) {
  state = merge(item.state);
  presetKey = 'custom'; world.resetClock(); mountPanel(); rebuildAll(); save();
  $('compare').hidden = true;
  status.textContent = 'Loaded ' + item.name;
}
function card(item, big) {
  const c = document.createElement('div');
  c.className = 'card';
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'thumb'; open.title = 'Load ' + item.name;
  const img = document.createElement('img');
  img.src = item.thumb; img.alt = item.name; img.loading = 'lazy';
  open.append(img);
  open.addEventListener('click', () => loadItem(item));
  const foot = document.createElement('div');
  foot.className = 'cardfoot';
  const name = document.createElement('input');
  name.value = item.name; name.setAttribute('aria-label', 'Name');
  name.addEventListener('change', async () => { item.name = name.value.trim() || item.name; await collection.put(item); renderCollection(); });
  const del = document.createElement('button');
  del.type = 'button'; del.textContent = '\u00d7'; del.title = 'Delete ' + item.name; del.setAttribute('aria-label', 'Delete ' + item.name);
  del.addEventListener('click', async () => {
    if (!window.confirm(`Delete "${item.name}" from the collection?`)) return;
    await collection.remove(item.id); await refreshCollection();
  });
  foot.append(name, del);
  c.append(open, foot);
  if (big) c.classList.add('big');
  return c;
}
function renderCollection() {
  const grid = $('colGrid'), all = $('compareGrid');
  grid.textContent = ''; all.textContent = '';
  for (const item of items) { grid.append(card(item, false)); all.append(card(item, true)); }
  $('colEmpty').hidden = items.length > 0;
  $('colCount').textContent = items.length ? `(${items.length})` : '';
}
async function refreshCollection() { items = await collection.all(); renderCollection(); }
async function saveVariation() {
  if (recording) return;
  const typed = $('colName').value.trim();
  const item = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`, created: Date.now(),
    name: typed || `Variation ${items.length + 1}`,
    state: JSON.parse(JSON.stringify(state)), thumb: thumbnail(),
  };
  await collection.put(item);
  $('colName').value = '';
  await refreshCollection();
  status.textContent = 'Saved "' + item.name + '" to the collection';
}
$('colSave').addEventListener('click', saveVariation);
$('colName').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveVariation(); });
$('colCompare').addEventListener('click', () => { $('compare').hidden = false; });
$('closeCompare').addEventListener('click', () => { $('compare').hidden = true; });
$('colExport').addEventListener('click', () => {
  if (!items.length) { status.textContent = 'The collection is empty'; return; }
  const blob = new Blob([JSON.stringify({ app: 'neuewave-mark', version: 2, items })], { type: 'application/json' });
  saveBlob(blob, `neuewave-collection-${new Date().toISOString().slice(0, 10)}.json`, false);
});
$('colImport').addEventListener('click', () => $('colFile').click());
$('colFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.items;
    let n = 0;
    for (const it of list) {
      if (!it || typeof it.state !== 'object' || typeof it.thumb !== 'string' || !it.thumb.startsWith('data:image/')) continue;
      await collection.put({ id: String(it.id || `${Date.now()}-${n}`), created: Number(it.created) || Date.now(), name: String(it.name || 'Imported').slice(0, 80), state: merge(it.state), thumb: it.thumb });
      n++;
    }
    await refreshCollection();
    status.textContent = `Imported ${n} variation${n === 1 ? '' : 's'}`;
  } catch (e) { status.textContent = 'That file could not be read as a collection.'; }
});

$('closePreview').addEventListener('click', () => { $('preview').hidden = true; });
$('export').addEventListener('click', exportPng);
$('exportSvg').addEventListener('click', exportSvg);
document.querySelectorAll('#sizes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#sizes button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
}));
$('motion').addEventListener('click', () => {
  playing = !playing;
  $('motion').setAttribute('aria-pressed', String(playing));
  $('motion').textContent = playing ? 'Stop motion' : 'Play motion';
  if (!playing) { time = 0; motionStep(); needsRender = true; }
});
$('copy').addEventListener('click', async () => {
  const text = JSON.stringify(state);
  $('settings').value = text;
  try { await navigator.clipboard.writeText(text); status.textContent = 'Settings copied'; }
  catch (e) { status.textContent = 'Settings are in the box. Copy them from there.'; }
});
$('apply').addEventListener('click', () => {
  try {
    state = merge(JSON.parse($('settings').value));
    presetKey = 'custom'; world.resetClock(); mountPanel(); rebuildAll(); save();
    status.textContent = 'Settings loaded';
  } catch (e) { status.textContent = 'Those settings could not be read. Paste the full text from Copy settings.'; }
});

// ---- loop
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!recording) {
    if (playing) { time += dt; motionStep(); needsRender = true; }
    if (state.physics.mode === 'run') { physicsStep(dt); needsRender = true; }
    if (needsRender) { draw(); needsRender = false; }
  }
  requestAnimationFrame(tick);
}

new ResizeObserver(() => { layoutFrame(); needsRender = true; }).observe(stage);
mountPanel();
refreshCollection();
buildPanel($('recordPanel'), () => rec, { change: saveRec }, RECORD_SCHEMA, { presets: false, open: ['record'], after: { record: recordBlock() } });
rebuildAll();
requestAnimationFrame(tick);

// Small hook for tests and for driving the tool from the console.
window.neuewaveMark = {
  get state() { return state; },
  get world() { return world; },
  preset: (k) => { state = applyPreset(k, state.seed); presetKey = k; world.resetClock(); mountPanel(); rebuildAll(); },
  set: (s) => { state = merge(s); world.resetClock(); mountPanel(); rebuildAll(); },
  step: (seconds) => { physicsStep(seconds); draw(); },
  kick: () => world.kick(state.physics.kick),
  saveVariation,
  exportSvg,
  get items() { return items; },
  record: (opts) => { Object.assign(rec.record, opts || {}); return startRecording(); },
  render: () => draw(),
  presets: Object.keys(PRESETS),
};
