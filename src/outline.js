// Line-art look: draws the outlines of the forms instead of their surfaces.
// The forms are rendered flat (colour + depth) and as normals; a second pass
// marks every pixel that lies on a boundary: a silhouette, a change of
// colour, a step in depth, or (when faceted) a crease.
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const EDGE = `
uniform sampler2D tColor, tDepth, tNormal;
uniform vec2 px; uniform float radius; uniform float creases; uniform vec3 mono; uniform float useMono;
varying vec2 vUv;
void main() {
  vec4 c0 = texture2D(tColor, vUv); float d0 = texture2D(tDepth, vUv).x; vec3 n0 = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  float edge = 0.0; vec4 best = c0; float bestD = c0.a > 0.5 ? d0 : 2.0;
  for (int ring = 0; ring < 2; ring++) {
    float r = ring == 0 ? radius : radius * 0.5;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236 + float(ring) * 0.26;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * px * r;
      vec4 c = texture2D(tColor, uv); float d = texture2D(tDepth, uv).x;
      float both = step(0.5, c.a) * step(0.5, c0.a);
      float diff = step(0.5, abs(c.a - c0.a))
                 + both * step(0.09, distance(c.rgb, c0.rgb))
                 + both * step(0.0016, abs(d - d0));
      if (creases > 0.5) { vec3 n = texture2D(tNormal, uv).xyz * 2.0 - 1.0; diff += both * step(dot(n, n0), 0.8); }
      if (diff > 0.0) edge = 1.0;
      if (c.a > 0.5 && d < bestD) { bestD = d; best = c; }
    }
  }
  vec3 ink = mix(best.rgb, mono, useMono);
  gl_FragColor = edge > 0.0 ? vec4(ink, 1.0) : vec4(0.0);
}`;
const COPY = 'uniform sampler2D tex; varying vec2 vUv; void main() { gl_FragColor = texture2D(tex, vUv); }';

export class OutlinePass {
  constructor(renderer) {
    this.renderer = renderer;
    const target = (opts) => new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, ...opts });
    this.flat = target({ depthTexture: new THREE.DepthTexture(4, 4) });
    this.flat.texture.colorSpace = THREE.SRGBColorSpace;
    this.normals = target({});
    this.lines = target({ minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    this.edge = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: EDGE, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: this.flat.texture }, tDepth: { value: this.flat.depthTexture }, tNormal: { value: this.normals.texture },
        px: { value: new THREE.Vector2() }, radius: { value: 2 }, creases: { value: 0 }, mono: { value: new THREE.Color() }, useMono: { value: 0 },
      },
    });
    // the line layer is premultiplied, so it is laid over the picture as such
    this.copy = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COPY, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: { tex: { value: this.lines.texture } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edge);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // Fills the three targets at w x h: flat colour + depth, normals, then lines.
  // opts: { widthPx: line width in target pixels, creases: bool, mono: colour or null }
  passes(scene, camera, w, h, opts) {
    const r = this.renderer;
    for (const t of [this.flat, this.normals, this.lines]) if (t.width !== w || t.height !== h) t.setSize(w, h);
    camera.layers.set(0);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.flat); r.clear(); r.render(scene, camera);
    scene.overrideMaterial = this.normalMat;
    this.normalMat.flatShading = !!opts.creases; this.normalMat.needsUpdate = true;
    r.setRenderTarget(this.normals); r.clear(); r.render(scene, camera);
    scene.overrideMaterial = null;
    const u = this.edge.uniforms;
    u.px.value.set(1 / w, 1 / h); u.radius.value = Math.max(0.6, opts.widthPx / 2); u.creases.value = opts.creases ? 1 : 0;
    u.useMono.value = opts.mono ? 1 : 0;
    if (opts.mono) u.mono.value.set(opts.mono).convertLinearToSRGB();
    this.quad.material = this.edge;
    r.setRenderTarget(this.lines); r.clear(); r.render(this.scene, this.cam);
    r.setRenderTarget(null);
    camera.layers.enableAll();
  }

  // Draws the picture: text behind, the lines, then the rest of the text.
  // Layers: forms are on 0, text behind the forms on 1, other text on 2.
  render(scene, camera, opts) {
    const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
    const clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    // draw at twice the size where that is affordable, so lines come out smooth
    const ss = Math.max(size.x, size.y) * 2 <= 4096 ? 2 : 1;
    this.passes(scene, camera, size.x * ss, size.y * ss, { ...opts, widthPx: opts.widthPx * ss });
    r.setClearColor(clear, alpha);
    const auto = r.autoClear;
    r.autoClear = false;
    r.clear();
    camera.layers.set(1); r.render(scene, camera);
    this.quad.material = this.copy; r.render(this.scene, this.cam);
    r.clearDepth();
    camera.layers.set(2); r.render(scene, camera);
    camera.layers.enableAll();
    r.autoClear = auto;
  }

  // The line layer on its own, read back as pixels (for vector tracing).
  readLines(scene, camera, w, h, opts) {
    const r = this.renderer;
    const clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    this.passes(scene, camera, w, h, opts);
    const data = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(this.lines, 0, 0, w, h, data);
    r.setClearColor(clear, alpha);
    return data;
  }

  // The flat render on its own, read back as pixels (for vector tracing).
  readFlat(scene, camera, w, h) {
    const r = this.renderer;
    const t = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    t.texture.colorSpace = THREE.SRGBColorSpace;
    const clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    camera.layers.set(0);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(t); r.clear(); r.render(scene, camera);
    const data = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(t, 0, 0, w, h, data);
    r.setRenderTarget(null);
    r.setClearColor(clear, alpha);
    camera.layers.enableAll();
    t.dispose();
    return data;
  }
}
