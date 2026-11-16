// Control panel. Plain DOM, driven by the schemas at the bottom of this file.
import { BRAND, PRESETS } from './presets.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const row = (label) => {
  const r = el('div', 'row');
  r.append(el('span', 'lab', label));
  return r;
};

function slider(state, sec, key, label, min, max, step, onChange) {
  const r = row(label);
  const input = el('input');
  Object.assign(input, { type: 'range', min, max, step, value: state[sec][key] });
  input.setAttribute('aria-label', label);
  const val = el('span', 'val');
  const show = () => { val.textContent = Number(state[sec][key]).toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0); };
  input.addEventListener('input', () => { state[sec][key] = Number(input.value); show(); onChange(sec, key); });
  show();
  r.append(input, val);
  r.sync = () => { input.value = state[sec][key]; show(); };
  return r;
}

function segmented(state, sec, key, label, options, onChange) {
  const r = row(label);
  const box = el('div', options.length > 4 ? 'seg wrap' : 'seg');
  const buttons = options.map(([value, text]) => {
    const b = el('button', '', text);
    b.type = 'button';
    b.addEventListener('click', () => { state[sec][key] = value; r.sync(); onChange(sec, key); });
    box.append(b);
    return [value, b];
  });
  r.append(box);
  r.sync = () => buttons.forEach(([v, b]) => b.setAttribute('aria-pressed', String(state[sec][key] === v)));
  r.sync();
  return r;
}

function toggle(state, sec, key, label, onChange) {
  return segmented(state, sec, key, label, [[true, 'On'], [false, 'Off']], onChange);
}

// Brand swatches plus a free colour. "auto" adds a chip that follows the ground.
function colour(state, sec, key, label, auto, onChange) {
  const r = row(label);
  const box = el('div', 'swatches');
  const custom = el('input');
  custom.type = 'color';
  custom.setAttribute('aria-label', label + ' custom colour');
  const set = (v) => { state[sec][key] = v; r.sync(); onChange(sec, key); };
  const chips = [];
  if (auto) {
    const b = el('button', 'chip auto', 'A');
    b.type = 'button'; b.title = 'Auto: black or white to suit the ground';
    b.addEventListener('click', () => set('auto'));
    box.append(b); chips.push(['AUTO', b]);
  }
  for (const [name, hex] of Object.entries(BRAND)) {
    const b = el('button', 'chip');
    b.type = 'button';
    b.title = name + ' ' + hex;
    b.setAttribute('aria-label', name);
    b.style.background = hex;
    b.addEventListener('click', () => set(hex));
    box.append(b);
    chips.push([hex, b]);
  }
  custom.addEventListener('input', () => set(custom.value.toUpperCase()));
  box.append(custom);
  r.append(box);
  r.sync = () => {
    const cur = String(state[sec][key]).toUpperCase();
    chips.forEach(([hex, b]) => b.setAttribute('aria-pressed', String(cur === hex)));
    if (cur !== 'AUTO') custom.value = state[sec][key];
  };
  r.sync();
  return r;
}

function textBox(state, sec, key, label, onChange) {
  const r = el('div', 'block');
  const area = el('textarea', 'copy');
  area.rows = 3;
  area.spellcheck = false;
  area.setAttribute('aria-label', label);
  area.placeholder = 'Type anything. Press Enter for a new line.';
  area.value = state[sec][key];
  area.addEventListener('input', () => { state[sec][key] = area.value; onChange(sec, key); });
  r.append(area);
  r.sync = () => { if (area.value !== state[sec][key]) area.value = state[sec][key]; };
  return r;
}

function buttons(sec, list, actions) {
  const r = el('div', 'row');
  r.append(el('span', 'lab', ''));
  const box = el('div', 'seg');
  for (const [text, action] of list) {
    const b = el('button', '', text);
    b.type = 'button';
    b.addEventListener('click', () => actions[action](sec));
    box.append(b);
  }
  r.append(box);
  r.sync = () => {};
  return r;
}

function sub(text) {
  const r = el('div', 'sub', text);
  r.sync = () => {};
  return r;
}

const COLOURS = [['colour', 'colour', 'Colour'], ['colour', 'colour2', 'Second'], ['slider', 'blend', 'Blend', 0, 1, 0.01]];

const TRANSFORM = [
  ['sub', 'Place'],
  ['slider', 'scale', 'Scale', 0.2, 2.5, 0.01],
  ['slider', 'rot', 'Rotate', 0, 360, 1],
  ['slider', 'tilt', 'Tilt', -90, 90, 1],
  ['slider', 'z', 'Depth', -3, 3, 0.1],
];

const TEXT = [
  ['toggle', 'on', 'Show'],
  ['text', 'text', 'Text'],
  ['buttons', [['neuewave', 'textOne'], ['neue/wave', 'textTwo'], ['nw', 'textNw'], ['Shuffle', 'textShuffle']]],
  ['seg', 'face', 'Weight', [['regular', 'Regular'], ['ultrabold', 'Ultrabold']]],
  ['seg', 'casing', 'Case', [['none', 'As typed'], ['lower', 'lower'], ['upper', 'UPPER']]],
  ['seg', 'style', 'Style', [['outline', 'Outline'], ['fill', 'Solid']]],
  ['slider', 'weight', 'Line', 0.005, 0.12, 0.001],
  ['colour', 'colour', 'Ink', true],
  ['seg', 'depth', 'Layer', [['front', 'Front'], ['through', 'Through'], ['behind', 'Behind']]],
  ['sub', 'Format'],
  ['slider', 'scale', 'Size', 0.05, 3, 0.01],
  ['slider', 'tracking', 'Tracking', -0.12, 0.8, 0.005],
  ['slider', 'leading', 'Leading', 0.7, 3.5, 0.01],
  ['slider', 'wrap', 'Wrap width', 0, 13, 0.1],
  ['seg', 'align', 'Align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]],
  ['slider', 'stretch', 'Stretch', 0.4, 2, 0.01],
  ['slider', 'slant', 'Slant', -30, 30, 0.5],
  ['sub', 'Place'],
  ['slider', 'x', 'Across', -7, 7, 0.01],
  ['slider', 'y', 'Up', -4, 4, 0.01],
];

// ---- the shape system: the same controls for every element
const PRIM_OPTIONS = [
  ['sphere', 'Sphere'], ['cube', 'Cube'], ['tetra', 'Tetra'], ['octa', 'Octa'], ['dodeca', 'Dodeca'], ['icosa', 'Icosa'],
  ['cone', 'Cone'], ['cylinder', 'Cylinder'], ['torus', 'Torus'],
];
const ARRAY_OPTIONS = [['scatter', 'Scatter'], ['line', 'Line'], ['stack', 'Stack'], ['ring', 'Ring'], ['spiral', 'Spiral'], ['grid', 'Grid']];

const shapeRows = (p) => [
  ['sub', 'Primitive'],
  ['seg', 'prim', 'Solid', PRIM_OPTIONS],
  ['slider', 'detail', 'Mesh detail', 0, 6, 1],
  ...(p.prim === 'torus' ? [['slider', 'tube', 'Tube', 0.02, 0.8, 0.01]] : []),
  ['sub', 'Supershape'],
  ['slider', 'sf', 'Amount', 0, 1, 0.01],
  ['buttons', [['Randomise', 'sfRandom'], ['Reset', 'sfReset']]],
  ['slider', 'm1', 'Around: lobes', 0, 16, 1],
  ['slider', 'n1', 'Around: n1', 0.1, 10, 0.05],
  ['slider', 'n2', 'Around: n2', 0.1, 10, 0.05],
  ['slider', 'n3', 'Around: n3', 0.1, 10, 0.05],
  ['slider', 'm2', 'Profile: lobes', 0, 16, 1],
  ['slider', 'k1', 'Profile: n1', 0.1, 10, 0.05],
  ['slider', 'k2', 'Profile: n2', 0.1, 10, 0.05],
  ['slider', 'k3', 'Profile: n3', 0.1, 10, 0.05],
  ['sub', 'Deform'],
  ['slider', 'sx', 'Width', 0.1, 3, 0.01],
  ['slider', 'sy', 'Height', 0.1, 3, 0.01],
  ['slider', 'sz', 'Depth', 0.05, 3, 0.01],
  ['slider', 'taper', 'Taper', -1, 1, 0.01],
  ['slider', 'twist', 'Twist', -360, 360, 1],
  ['slider', 'bend', 'Bend', -2, 2, 0.01],
  ['slider', 'noise', 'Noise', 0, 1, 0.01],
  ['slider', 'noiseScale', 'Noise size', 0.2, 5, 0.01],
  ['sub', 'Array'],
  ['seg', 'array', 'Layout', ARRAY_OPTIONS],
  ['slider', 'count', 'Copies', 1, 60, 1],
  ['slider', 'spread', 'Spread', 0, 12, 0.05],
  ['slider', 'arc', 'Curve', -1, 1, 0.01],
  ['slider', 'size', 'Size', 0.05, 3, 0.01],
  ['slider', 'falloff', 'Size falloff', -1, 1, 0.01],
  ['slider', 'turn', 'Turn each', -180, 180, 1],
  ['slider', 'tumble', 'Tumble each', -180, 180, 1],
  ['slider', 'jitter', 'Irregular', 0, 1.5, 0.01],
  ['toggle', 'follow', 'Follow path'],
  ['sub', 'Motion'],
  ['slider', 'flow', 'Flow', -2, 2, 0.01],
  ['slider', 'spin', 'Spin', -6, 6, 0.05],
];

const FLAME = [
  ['sub', 'Flame'],
  ['slider', 'count', 'Tongues', 1, 12, 1], ['slider', 'layers', 'Layers', 1, 4, 1],
  ['slider', 'height', 'Height', 0.5, 8, 0.05], ['slider', 'width', 'Width', 0.3, 5, 0.01],
  ['slider', 'girth', 'Girth', 0.3, 2.5, 0.01], ['slider', 'belly', 'Belly', 0.08, 0.7, 0.01],
  ['slider', 'taper', 'Taper', 0.4, 3, 0.01], ['slider', 'ragged', 'Ragged', 0, 1, 0.01],
  ['slider', 'lean', 'Fan out', -0.5, 1, 0.01], ['slider', 'sway', 'Sway', 0, 3, 0.01],
  ['slider', 'licks', 'Licks', 0.2, 3, 0.01], ['slider', 'curl', 'Tip curl', 0, 1.5, 0.01],
  ['slider', 'ripple', 'Ripple', 0, 0.6, 0.01], ['slider', 'depth', 'Roundness', 0.2, 1, 0.01],
  ['slider', 'embers', 'Embers', 0, 120, 1], ['slider', 'emberSize', 'Ember size', 0.3, 3, 0.01],
  ['slider', 'speed', 'Flicker speed', 0.2, 3, 0.01],
];
const LIQUID = [
  ['sub', 'Liquid'],
  ['seg', 'type', 'Form', [['stream', 'Stream'], ['wave', 'Wave'], ['crown', 'Splash']]],
  ['slider', 'size', 'Body', 0.15, 1.2, 0.01], ['slider', 'length', 'Length', 1, 12, 0.1],
  ['slider', 'arc', 'Arc', -0.6, 0.8, 0.01], ['slider', 'wave', 'Wobble', 0, 3, 0.01],
  ['slider', 'waves', 'Waves', 0, 5, 0.01], ['slider', 'taper', 'Taper', 0.2, 3, 0.01],
  ['slider', 'head', 'Head', 0.1, 0.92, 0.01], ['slider', 'pulse', 'Necking', 0, 1, 0.01],
  ['slider', 'pulses', 'Neck count', 0.5, 8, 0.1], ['slider', 'breakup', 'Break up', 0, 1.5, 0.01],
  ['slider', 'jitter', 'Irregular', 0, 1.5, 0.01], ['slider', 'jets', 'Jets', 3, 12, 1],
  ['slider', 'spray', 'Droplets', 0, 50, 1], ['slider', 'spraySize', 'Droplet size', 0.3, 3, 0.01],
  ['slider', 'spread', 'Spray spread', 0, 3, 0.01], ['slider', 'grain', 'Particle size', 0.08, 0.35, 0.005],
  ['slider', 'merge', 'Merge', 1.3, 3, 0.01], ['slider', 'detail', 'Mesh size', 0.04, 0.2, 0.005],
  ['slider', 'cohesion', 'Cohesion', 0, 3, 0.01], ['slider', 'viscosity', 'Viscosity', 0, 1, 0.01],
];
const GUST = [
  ['sub', 'Air'],
  ['seg', 'type', 'Form', [['gust', 'Gusts'], ['vortex', 'Vortex']]],
  ['slider', 'count', 'Streams', 1, 14, 1], ['slider', 'length', 'Length', 1, 12, 0.1],
  ['slider', 'spacing', 'Spacing', 0.1, 1.5, 0.01], ['slider', 'stagger', 'Stagger', 0, 1, 0.01],
  ['slider', 'thick', 'Thickness', 0.02, 0.4, 0.005], ['slider', 'taper', 'Taper', 0.2, 2.5, 0.01],
  ['slider', 'wave', 'Wave', 0, 3, 0.01], ['slider', 'waves', 'Waves', 0, 5, 0.01],
  ['slider', 'radius', 'Curl size', 0.1, 3, 0.01], ['slider', 'turns', 'Curl turns', 0, 5, 0.05],
  ['slider', 'depth', 'Depth', 0, 2, 0.01],
];
const ORGANIC = { fire: ['flame', 'Flame', FLAME], water: ['liquid', 'Liquid', LIQUID], wind: ['gust', 'Gusts', GUST] };

function elementSection(name, title, state) {
  const p = state[name], org = ORGANIC[name];
  const organic = org && p.kind === 'organic';
  return [name, title, [
    ['toggle', 'on', 'Show'], ...COLOURS,
    ...(org ? [['seg', 'kind', 'Build', [['shape', 'Primitive'], ['organic', org[1]]]]] : []),
    ...(organic ? [['in', org[0], org[2]]] : shapeRows(p)),
    ['sub', 'Physics'],
    ['slider', 'react', 'Response', 0, 3, 0.01],
    ['slider', 'weight', 'Weight', 0, 1, 0.01],
    ['slider', 'lift', 'Lift', -6, 14, 0.1],
    ['slider', 'stiff', 'Memory', 0, 1, 0.01],
    ...(organic ? [] : [['toggle', 'link', 'Link copies']]),
    ['seg', 'pin', 'Pin', [['none', 'Free'], ['first', 'First'], ['ends', 'Ends']]],
    ...TRANSFORM,
  ]];
}

export function buildSchema(state) {
  return [
    ['canvas', 'Canvas', [
      ['seg', 'format', 'Format', [['16:9', '16:9'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:1', '3:1']]],
      ['seg', 'bg', 'Ground', [['black', 'Black'], ['white', 'White'], ['blue', 'Blue'], ['clear', 'Clear']]],
      ['slider', 'zoom', 'Zoom', 0.5, 3, 0.01],
      ['toggle', 'grid', 'Grid'],
    ]],
    ['style', 'Style (all elements)', [
      ['seg', 'dimension', 'Dimension', [['3d', '3D'], ['2d', '2D']]],
      ['seg', 'look', 'Look', [['solid', 'Solid'], ['outline', 'Line art'], ['wire', 'Wire']]],
      ['seg', 'surface', 'Surface', [['smooth', 'Smooth'], ['facet', 'Faceted']]],
      ['seg', 'finish', 'Finish', [['matte', 'Matte'], ['satin', 'Satin'], ['gloss', 'Gloss'], ['chrome', 'Chrome']]],
      ['slider', 'poly', 'Resolution', 0.1, 1.6, 0.01],
      ['slider', 'glow', 'Glow', 0, 1, 0.01],
      ['slider', 'line', 'Line weight', 0.005, 0.15, 0.001],
      ['seg', 'ink', 'Line colour', [['own', 'Element'], ['mono', 'Ink']]],
    ]],
    ['wordmark', 'Wordmark', TEXT],
    ['copy', 'Copy', TEXT],
    ['light', 'Light', [
      ['slider', 'fill', 'Shadow fill', 0, 1, 0.01],
      ['slider', 'azimuth', 'Direction', -180, 180, 1],
      ['slider', 'elevation', 'Height', 0, 90, 1],
    ]],
    ['physics', 'Physics', [
      ['seg', 'mode', 'Simulate', [['off', 'Off'], ['run', 'Run'], ['hold', 'Hold']]],
      ['buttons', [['Reset', 'simReset'], ['Kick', 'simKick']]],
      ['slider', 'kick', 'Kick force', 0, 30, 0.5],
      ['slider', 'pointer', 'Pointer push', -40, 40, 1],
      ['sub', 'Forces'],
      ['slider', 'gravity', 'Gravity', -10, 10, 0.1],
      ['slider', 'wind', 'Wind', 0, 12, 0.1],
      ['slider', 'windDir', 'Wind angle', -180, 180, 1],
      ['slider', 'gust', 'Gusts', 0, 1, 0.01],
      ['slider', 'turb', 'Turbulence', 0, 12, 0.1],
      ['slider', 'turbScale', 'Eddy size', 0.1, 4, 0.01],
      ['slider', 'damping', 'Drag', 0, 0.3, 0.005],
      ['slider', 'speed', 'Time scale', 0.1, 3, 0.05],
      ['sub', 'Contacts'],
      ['toggle', 'floor', 'Floor'],
      ['slider', 'floorY', 'Floor height', -5, 3, 0.05],
      ['toggle', 'walls', 'Walls'],
      ['slider', 'bounce', 'Bounce', 0, 0.95, 0.01],
      ['toggle', 'collide', 'Collide'],
    ]],
    elementSection('earth', 'Earth', state),
    elementSection('fire', 'Fire', state),
    elementSection('water', 'Water', state),
    elementSection('wind', 'Wind', state),
  ];
}

export const RECORD_SCHEMA = [
  ['record', 'Record', [
    ['seg', 'format', 'Format', [['gif', 'GIF'], ['mp4', 'MP4'], ['webm', 'WebM'], ['png', 'PNGs']]],
    ['seg', 'drive', 'Animate', [['both', 'Both'], ['physics', 'Physics'], ['motion', 'Motion']]],
    ['seg', 'start', 'Start', [['reset', 'From rest'], ['current', 'As is']]],
    ['slider', 'seconds', 'Length (s)', 0.5, 20, 0.5],
    ['slider', 'preroll', 'Settle (s)', 0, 10, 0.5],
    ['seg', 'fps', 'Frame rate', [[12, '12'], [24, '24'], [30, '30'], [60, '60']]],
    ['seg', 'size', 'Long edge', [[540, '540'], [720, '720'], [1080, '1080'], [2160, '2160']]],
  ]],
];

export function buildPanel(root, getState, actions, schema, opts = {}) {
  const wasOpen = new Set([...root.querySelectorAll('details[open]')].map((d) => d.dataset.section));
  const first = !root.querySelector('details');
  root.textContent = '';
  const syncs = [];
  const state = getState();

  if (opts.presets !== false) {
    const presets = el('div', 'presets');
    for (const [key, p] of Object.entries(PRESETS)) {
      const b = el('button', '', p.label);
      b.type = 'button';
      b.dataset.preset = key;
      b.addEventListener('click', () => actions.preset(key));
      presets.append(b);
    }
    const seedRow = row('Seed');
    const seed = el('input');
    Object.assign(seed, { type: 'number', value: state.seed, min: 0, step: 1 });
    seed.setAttribute('aria-label', 'Seed');
    seed.addEventListener('change', () => actions.seed(Math.max(0, Math.floor(Number(seed.value) || 0))));
    const shuffle = el('button', 'solid', 'New seed');
    shuffle.type = 'button';
    shuffle.addEventListener('click', () => actions.seed(Math.floor(Math.random() * 99999)));
    seedRow.append(seed, shuffle);
    root.append(el('h2', '', 'Presets'), presets, seedRow);
  }

  for (const [sec, title, rows] of schema || buildSchema(state)) {
    // rows wrapped in ['in', section, rows] edit another section's values
    const controls = rows.flatMap((c) => (c[0] === 'in' ? c[2].map((x) => ({ c: x, at: c[1] })) : [{ c, at: sec }]));
    const d = el('details');
    d.dataset.section = sec;
    d.open = first ? (opts.open || ['canvas', 'wordmark']).includes(sec) : wasOpen.has(sec);
    const s = el('summary', '', title);
    d.append(s);
    for (const { c, at } of controls) {
      let r;
      if (c[0] === 'slider') r = slider(state, at, c[1], c[2], c[3], c[4], c[5], actions.change);
      else if (c[0] === 'seg') r = segmented(state, at, c[1], c[2], c[3], actions.change);
      else if (c[0] === 'toggle') r = toggle(state, at, c[1], c[2], actions.change);
      else if (c[0] === 'buttons') r = buttons(at, c[1], actions);
      else if (c[0] === 'sub') r = sub(c[1]);
      else if (c[0] === 'text') r = textBox(state, at, c[1], c[2], actions.change);
      else r = colour(state, at, c[1], c[2], c[3], actions.change);
      d.append(r);
      syncs.push(r.sync);
    }
    if (opts.after && opts.after[sec]) d.append(opts.after[sec]);
    root.append(d);
  }
  return { sync: () => syncs.forEach((f) => f()), open: (sec) => { const d = root.querySelector(`details[data-section="${sec}"]`); if (d) d.open = true; } };
}
