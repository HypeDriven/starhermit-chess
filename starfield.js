/* starfield.js — the classic starfield behind the main menu, except the stars
   are 3D chess pieces drifting toward the viewer, lit by the club's brass lamp.

   Piece models come from mrabhin03/3D-Chess-Game (MIT, see vendor/ATTRIBUTION.md),
   repacked into assets/chess-pieces.glb (six geometries, simplified + quantized).
   Rendered with the vendored three.js r176 build and same-revision addons.

   Graphics settings (graphics.js / gfx.js) apply live: ACES tone mapping always;
   `reflections` swaps in lacquered MeshPhysicalMaterials lit by a RoomEnvironment
   PMREM; `particles` adds lamp-lit dust motes; `bloom`, `grade` and FXAA/SMAA run
   through an EffectComposer chain that is only built when something needs it;
   `antialias: msaa` uses canvas MSAA (direct) or a 4-sample target (post). Render
   scale and adaptive resolution set the pixel ratio. Under reduced motion the
   field is drawn once and holds still.

   This is a progressive enhancement: it lazy-loads three.js and the model the
   first time the menu is shown, and any failure (no WebGL, missing asset, no
   import-map support) leaves the menu working exactly as before. It never
   writes to the console (QA treats console output as a failure). */

import { Graphics } from './graphics.js';
import { PARTICLE_COUNT } from './gfx.js';

const menu = document.getElementById('view-menu');
let canvas = document.getElementById('starfield');

const DEPTH = 70;          // how far away pieces spawn (world units; king height = 1)
const SPREAD_X_MAX = 28;
const SPREAD_Y = 16;
const BASE_SPEED = 5.5;    // world units per second toward the camera
// Piece count (a menu backdrop, not a benchmark); phones get a lighter field.
const TOTAL = Math.min(window.innerWidth, window.innerHeight) < 620 ? 120 : 210;
let spreadX = SPREAD_X_MAX; // narrowed to the visible cone on portrait screens (see resize)
// A chess set's own census as spawn weights: pawns are the dust of this galaxy.
const WEIGHTS = { pawn: 8, rook: 2, knight: 2, bishop: 2, queen: 1, king: 1 };
const EXPOSURE = 1.15;
const MOTE_NEAR = 3, MOTE_FAR = 34;

let world = null;          // built scene, or null
let failed = false;        // don't retry a failed build
let building = false;
let raf = 0;

function menuActive() {
  return menu.classList.contains('active');
}

// ---------------------------------------------------------------- colour helpers

// three.js ACESFilmicToneMapping, on one linear RGB triple.
function aces([r, g, b], exposure) {
  const k = exposure / 0.6;
  r *= k; g *= k; b *= k;
  const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.07600 * r + 0.90834 * g + 0.01566 * b, 0.02840 * r + 0.13383 * g + 0.83777 * b];
  const f = i.map((v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081));
  const o = [1.60475 * f[0] - 0.53108 * f[1] - 0.07367 * f[2], -0.10208 * f[0] + 1.10813 * f[1] - 0.00605 * f[2], -0.00327 * f[0] - 0.07276 * f[1] + 1.07602 * f[2]];
  return o.map((v) => Math.min(1, Math.max(0, v)));
}

// The linear colour that ACES maps onto `target`, so fog (tone-mapped with the pieces)
// melts into exactly the page's --bg in both the direct and the post-processed path.
function invAces(target, exposure) {
  const x = target.slice();
  for (let it = 0; it < 60; it++) {
    const y = aces(x, exposure);
    for (let c = 0; c < 3; c++) {
      const h = Math.max(1e-4, x[c] * 0.01);
      const bumped = x.slice(); bumped[c] += h;
      const d = (aces(bumped, exposure)[c] - y[c]) / h;
      if (d > 1e-6) x[c] = Math.max(0, x[c] + (target[c] - y[c]) / d);
      else x[c] += 0.01;
    }
  }
  return x;
}

// A soft round sprite (dust motes) or a wide radial pool of light (the lamp glow).
function radialTexture(THREE, size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Colour grade + vignette, applied to linear HDR before OutputPass tone-maps it.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // A touch more saturation, lamp-warm highlights, faintly cool shadows.
      c = max(mix(vec3(l), c, 1.12), 0.0);
      float hi = smoothstep(0.02, 0.5, l);
      c *= mix(vec3(0.94, 0.97, 1.05), vec3(1.06, 1.0, 0.92), hi);
      // Gentle S-curve on the mid-tones (in a log-ish domain so HDR highlights survive).
      vec3 t = c / (1.0 + c);
      t = mix(t, t * t * (3.0 - 2.0 * t), 0.18);
      c = t / max(1.0 - t, 1e-4);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.3, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// ---------------------------------------------------------------- build

async function build() {
  const THREE = await import('three');
  const { GLTFLoader } = await import('./vendor/loaders/GLTFLoader.js');

  const gltf = await new GLTFLoader().loadAsync('assets/chess-pieces.glb');
  gltf.scene.updateMatrixWorld(true);
  const pieces = {};       // name -> { geometry, preMatrix }
  gltf.scene.traverse((o) => {
    // The GLB is KHR_mesh_quantization'd: real-world scale lives in the node
    // matrix, so keep it and fold it into each instance matrix (preMatrix).
    if (o.isMesh) pieces[o.name] = { geometry: o.geometry, preMatrix: o.matrixWorld.clone() };
  });

  // Post-processing modules are optional: if they fail to load the field renders directly.
  let post = null;
  try {
    const [ec, rp, sp, op, ub, sm, fx] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/ShaderPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/SMAAPass.js'),
      import('three/addons/shaders/FXAAShader.js'),
    ]);
    post = {
      EffectComposer: ec.EffectComposer, RenderPass: rp.RenderPass, ShaderPass: sp.ShaderPass,
      OutputPass: op.OutputPass, UnrealBloomPass: ub.UnrealBloomPass, SMAAPass: sm.SMAAPass, FXAAShader: fx.FXAAShader,
    };
  } catch (e) { post = null; }
  let RoomEnvironment = null;
  try { ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js')); } catch (e) { /* no IBL */ }

  const scene = new THREE.Scene();
  const bgHex = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#171310';
  const bgColor = new THREE.Color(bgHex);           // linear working space
  const fogColor = new THREE.Color().fromArray(invAces(bgColor.toArray(), EXPOSURE));
  // Fog toward the page background: distant pieces melt into the room.
  scene.fog = new THREE.Fog(fogColor, DEPTH * 0.25, DEPTH * 0.95);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, DEPTH + 10);
  camera.position.set(0, 0, 0);
  spreadX = Math.min(SPREAD_X_MAX,
    Math.max(12, SPREAD_Y * (window.innerWidth / window.innerHeight) * 1.6));

  // Lighting: warm hemisphere fill, the brass lamp as key, a cool rim from behind the field.
  scene.add(new THREE.HemisphereLight(0xffe3b8, 0x2a1b10, 0.9));
  scene.add(new THREE.AmbientLight(0x8a7a5f, 0.25));
  const key = new THREE.DirectionalLight(0xffd49a, 2.3); // the club's brass lamp
  key.position.set(-4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9db2d6, 0.9);
  rim.position.set(6, 3, -30);
  scene.add(rim);

  // The lamp itself: a wide, faint pool of light far up-left, behind the fog.
  const glowTex = radialTexture(THREE, 256, [[0, 'rgba(255,214,150,1)'], [0.3, 'rgba(230,180,110,0.4)'], [0.7, 'rgba(200,150,90,0.08)'], [1, 'rgba(0,0,0,0)']]);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: glowTex, color: new THREE.Color(0.03, 0.021, 0.012), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, fog: false,
  }));
  glow.position.set(-DEPTH * 0.35, DEPTH * 0.28, -DEPTH * 0.9);
  glow.scale.setScalar(DEPTH * 1.3);
  glow.renderOrder = -1;
  scene.add(glow);

  const materials = {
    plain: {
      ivory: new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.55, metalness: 0.1 }),
      walnut: new THREE.MeshStandardMaterial({ color: 0x6a4d36, roughness: 0.6, metalness: 0.1 }),
    },
    lacquer: {
      ivory: new THREE.MeshPhysicalMaterial({ color: 0xd9c59c, roughness: 0.45, metalness: 0.0, clearcoat: 0.55, clearcoatRoughness: 0.2, sheen: 0.3, sheenColor: 0xfff1d6 }),
      walnut: new THREE.MeshPhysicalMaterial({ color: 0x573a28, roughness: 0.5, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.1 }),
    },
  };

  // One InstancedMesh per (piece type, colour); each instance is one "star".
  const groups = [];
  const names = Object.keys(WEIGHTS).filter((n) => pieces[n]);
  const weightSum = names.reduce((s, n) => s + WEIGHTS[n], 0);
  for (const name of names) {
    const perColor = Math.max(1, Math.round((TOTAL * WEIGHTS[name]) / weightSum / 2));
    for (const tone of ['ivory', 'walnut']) {
      const mesh = new THREE.InstancedMesh(pieces[name].geometry, materials.plain[tone], perColor);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const starList = [];
      for (let i = 0; i < perColor; i++) starList.push(spawn(THREE, true));
      groups.push({ mesh, tone, preMatrix: pieces[name].preMatrix, starList });
    }
  }

  // Dust motes: additive HDR points (bright enough for the bloom threshold) with per-mote
  // twinkle and distance fade written into the vertex colours each frame.
  const moteMax = PARTICLE_COUNT.high;
  const motePos = new Float32Array(moteMax * 3);
  const moteCol = new Float32Array(moteMax * 3);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3).setUsage(THREE.DynamicDrawUsage));
  moteGeo.setAttribute('color', new THREE.BufferAttribute(moteCol, 3).setUsage(THREE.DynamicDrawUsage));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    size: 0.16, sizeAttenuation: true, vertexColors: true, fog: false,
    map: radialTexture(THREE, 64, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  motes.frustumCulled = false;
  scene.add(motes);
  const moteData = [];
  for (let i = 0; i < moteMax; i++) {
    moteData.push({
      x: (Math.random() * 2 - 1) * 14, y: (Math.random() * 2 - 1) * 9,
      z: -(MOTE_NEAR + Math.random() * (MOTE_FAR - MOTE_NEAR)),
      vy: 0.08 + Math.random() * 0.22, sway: Math.random() * Math.PI * 2,
      tw: 0.6 + Math.random() * 1.8, ph: Math.random() * Math.PI * 2,
    });
  }

  let envTex = null;
  world = {
    THREE, post, RoomEnvironment, scene, camera, groups, materials, motes, moteData,
    bgColor, fogColor, renderer: null, msaa: null, composer: null, postKey: null,
    envTex, q: null, pixelRatio: 0, size: [0, 0], adaptiveScale: 1, frames: [],
    postFailed: !post, time: 0,
    dummy: new THREE.Object3D(),
    spin: new THREE.Quaternion(),
    lastT: 0,
  };
  applySettings(Graphics.resolved);
  resize();
}

/* (Re)create the WebGL renderer. Canvas MSAA is fixed at context creation, so switching it
   swaps in a fresh <canvas> (same id and attributes) rather than reusing the old context. */
function makeRenderer(msaa) {
  const w = world;
  const { THREE } = w;
  if (w.renderer) {
    w.composer?.dispose(); w.composer = null; w.postKey = null;
    w.renderer.dispose();
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: msaa, alpha: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  w.renderer = renderer;
  w.msaa = msaa;
  w.pixelRatio = 0; // force setSize on the next frame
  if (w.envTex) { w.envTex.dispose(); w.envTex = null; }
}

function applySettings(q) {
  const w = world;
  if (!w || !q) return;
  w.q = q;
  // Canvas MSAA only matters when drawing directly (post uses a multisampled target).
  const wantMsaa = q.antialias === 'msaa' && !q.post;
  if (!w.renderer || w.msaa !== wantMsaa) makeRenderer(wantMsaa);

  const lacquer = q.reflections === 'on';
  if (lacquer && !w.envTex && w.RoomEnvironment) {
    try {
      const pmrem = new w.THREE.PMREMGenerator(w.renderer);
      w.envTex = pmrem.fromScene(new w.RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch (e) { w.envTex = null; }
  }
  w.scene.environment = lacquer ? w.envTex : null;
  w.scene.environmentIntensity = 0.42;
  for (const g of w.groups) g.mesh.material = w.materials[lacquer && w.envTex ? 'lacquer' : 'plain'][g.tone];

  const n = PARTICLE_COUNT[q.particles] || 0;
  w.motes.visible = n > 0;
  w.motes.geometry.setDrawRange(0, n);

  w.adaptiveScale = 1;
  w.frames = [];
  w.postKey = null; // rebuild the post chain on the next frame
  canvas.dataset.gfxPreset = q.preset;
}

/* A fresh star: far away on first respawn, anywhere along the run at startup. */
function spawn(THREE, anywhere, star) {
  star = star || {};
  star.x = (Math.random() * 2 - 1) * spreadX;
  star.y = (Math.random() * 2 - 1) * SPREAD_Y;
  star.z = anywhere ? -(2 + Math.random() * (DEPTH - 2)) : -DEPTH + Math.random() * -4;
  star.speed = BASE_SPEED * (0.7 + Math.random() * 0.9);
  star.scale = 0.8 + Math.random() * 0.9;
  star.axis = (star.axis || new THREE.Vector3()).set(
    Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
  star.rotSpeed = 0.25 + Math.random() * 0.9;
  star.q = (star.q || new THREE.Quaternion()).setFromAxisAngle(star.axis, Math.random() * Math.PI * 2);
  return star;
}

// ---------------------------------------------------------------- post chain

function buildPost(wpx, hpx) {
  const w = world, q = w.q, P = w.post;
  w.composer?.dispose();
  w.composer = null;
  if (!q.post || !P) {
    // Direct path: a colour background is written as-is (not tone-mapped), so it is --bg itself.
    w.scene.background = w.bgColor;
    return;
  }
  try {
    const { THREE } = w;
    const pr = w.pixelRatio;
    const target = new THREE.WebGLRenderTarget(Math.round(wpx * pr), Math.round(hpx * pr), {
      type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0,
    });
    const composer = new P.EffectComposer(w.renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(wpx, hpx);
    composer.addPass(new P.RenderPass(w.scene, w.camera));
    // High threshold: only clearcoat glints and the dust motes bloom.
    if (q.bloom === 'on') composer.addPass(new P.UnrealBloomPass(new THREE.Vector2(wpx, hpx), 0.45, 0.5, 0.9));
    if (q.grade === 'on') composer.addPass(new P.ShaderPass(GradeShader));
    composer.addPass(new P.OutputPass());
    if (q.antialias === 'smaa') {
      const smaa = new P.SMAAPass();
      smaa.setSize(Math.round(wpx * pr), Math.round(hpx * pr));
      composer.addPass(smaa);
    }
    if (q.antialias === 'fxaa') {
      const fxaa = new P.ShaderPass(P.FXAAShader);
      fxaa.material.uniforms.resolution.value.set(1 / (wpx * pr), 1 / (hpx * pr));
      composer.addPass(fxaa);
    }
    // Post path: the background lands in the linear target and is tone-mapped by OutputPass,
    // so use the fog colour (which ACES maps onto --bg). A scene background (not the clear
    // colour) because three converts the clear colour for whichever target was bound when it
    // was set, and RenderPass sets it while the screen is still bound.
    w.scene.background = w.fogColor;
    w.composer = composer;
    w.postFailed = false;
  } catch (e) {
    // Post-processing is an enhancement: render directly; the Graphics panel says so.
    w.composer = null;
    w.postFailed = true;
    w.scene.background = w.bgColor;
  }
  Graphics.report({ postFailed: w.postFailed });
}

// Adaptive resolution: step the render scale down when frames are slow, back up when fast.
function adapt(dt) {
  const w = world;
  w.frames.push(dt);
  if (w.frames.length < 90) return false;
  const avg = w.frames.reduce((a, b) => a + b, 0) / w.frames.length;
  w.frames.length = 0;
  if (!w.q.adaptive) return false;
  const before = w.adaptiveScale;
  if (avg > 26) w.adaptiveScale = Math.max(0.6, w.adaptiveScale - 0.1);
  else if (avg < 14 && w.adaptiveScale < 1) w.adaptiveScale = Math.min(1, w.adaptiveScale + 0.05);
  return before !== w.adaptiveScale;
}

// ---------------------------------------------------------------- frame

function frame(t) {
  raf = requestAnimationFrame(frame);
  const dtMs = world.lastT ? Math.min(t - world.lastT, 250) : 16;
  world.lastT = t;
  const rescale = adapt(dtMs);
  render(Math.min(dtMs / 1000, 0.1), rescale); // clamp tab-return jumps
}

/* Advance every piece by dt seconds (dt 0 = draw as-is) and draw the scene. */
function render(dt, rescale) {
  const w = world;
  w.time += dt;
  for (const g of w.groups) {
    for (let i = 0; i < g.starList.length; i++) {
      const s = g.starList[i];
      s.z += s.speed * dt;
      if (s.z > -1.5) spawn(w.THREE, false, s);
      w.spin.setFromAxisAngle(s.axis, s.rotSpeed * dt);
      s.q.premultiply(w.spin);
      w.dummy.position.set(s.x, s.y, s.z);
      w.dummy.quaternion.copy(s.q);
      w.dummy.scale.setScalar(s.scale);
      w.dummy.updateMatrix();
      w.dummy.matrix.multiply(g.preMatrix);
      g.mesh.setMatrixAt(i, w.dummy.matrix);
    }
    g.mesh.instanceMatrix.needsUpdate = true;
  }
  if (w.motes.visible) updateMotes(dt);

  const wpx = window.innerWidth, hpx = window.innerHeight;
  const ratio = Graphics.basePixelRatio() * w.q.scale * w.adaptiveScale;
  if (wpx !== w.size[0] || hpx !== w.size[1] || ratio !== w.pixelRatio || rescale) {
    w.size = [wpx, hpx];
    w.pixelRatio = ratio;
    w.renderer.setPixelRatio(ratio);
    w.renderer.setSize(wpx, hpx, false);
    Graphics.report({ pixels: [Math.round(wpx * ratio), Math.round(hpx * ratio)], adaptiveScale: w.adaptiveScale });
  }
  const key = w.q.post && w.post ? [w.q.bloom, w.q.grade, w.q.antialias, wpx, hpx, ratio].join('|') : 'none';
  if (key !== w.postKey) {
    w.postKey = key;
    buildPost(wpx, hpx);
  }
  if (w.composer) w.composer.render(dt);
  else w.renderer.render(w.scene, w.camera);
}

function updateMotes(dt) {
  const w = world;
  const pos = w.motes.geometry.attributes.position, col = w.motes.geometry.attributes.color;
  const n = w.motes.geometry.drawRange.count;
  const count = Number.isFinite(n) ? n : w.moteData.length;
  for (let i = 0; i < count; i++) {
    const m = w.moteData[i];
    m.y += m.vy * dt;
    m.z += 0.6 * dt; // drift slowly with the field
    if (m.y > 9) m.y = -9;
    if (m.z > -MOTE_NEAR) m.z = -MOTE_FAR;
    const x = m.x + Math.sin(w.time * 0.35 + m.sway) * 0.6;
    pos.array[i * 3] = x; pos.array[i * 3 + 1] = m.y; pos.array[i * 3 + 2] = m.z;
    // Brightest near the lamp side (upper left), fading with distance; a slow twinkle.
    const fade = 1 - (-m.z - MOTE_NEAR) / (MOTE_FAR - MOTE_NEAR);
    const lamp = 0.55 + 0.45 * Math.max(0, Math.min(1, (-x + m.y) / 20 + 0.5));
    const b = 2.2 * fade * lamp * (0.55 + 0.45 * Math.sin(w.time * m.tw + m.ph));
    col.array[i * 3] = b; col.array[i * 3 + 1] = b * 0.8; col.array[i * 3 + 2] = b * 0.52;
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

function resize() {
  if (!world) return;
  world.camera.aspect = window.innerWidth / window.innerHeight;
  world.camera.updateProjectionMatrix();
  // Keep spawns inside the visible cone on narrow screens so portrait phones
  // see the same piece density as a desktop window (respawns migrate over ~10s).
  spreadX = Math.min(SPREAD_X_MAX, Math.max(12, SPREAD_Y * world.camera.aspect * 1.6));
  if (Graphics.reducedMotion && menuActive() && world.q) render(0);
}

function stopLoop() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}

async function sync() {
  if (!menuActive()) {
    stopLoop();
    canvas.hidden = true;
    return;
  }
  if (!world && !failed && !building) {
    building = true;
    try { await build(); }
    catch (e) {
      failed = true; // no WebGL / model / import maps: the menu simply has no backdrop
      canvas.dataset.gfxFailed = '1';
      return;
    }
    finally { building = false; }
    if (!menuActive()) { sync(); return; } // view changed while loading
  }
  if (!world) return;
  canvas.hidden = false;
  if (Graphics.reducedMotion) {
    // Reduced motion: one still frame, no loop.
    stopLoop();
    render(0);
    return;
  }
  if (!raf) {
    world.lastT = 0;
    raf = requestAnimationFrame(frame);
  }
}

Graphics.subscribe((q, why) => {
  if (why === 'info') return;
  if (world && why === 'settings') applySettings(q);
  if (world && menuActive()) sync(); // redraws the still frame under reduced motion
});
new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', resize);
sync();
