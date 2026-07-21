/* starfield.js — the classic starfield behind the main menu, except the stars
   are 3D chess pieces drifting toward the viewer.

   Piece models come from mrabhin03/3D-Chess-Game (MIT, see vendor/ATTRIBUTION.md),
   repacked into assets/chess-pieces.glb (six geometries, simplified + quantized).
   Rendered with the three.js build vendored from the same project.

   This is a progressive enhancement: it lazy-loads three.js and the model the
   first time the menu is shown, and any failure (no WebGL, missing asset, no
   import-map support) leaves the menu working exactly as before. It honours
   prefers-reduced-motion by never starting. */

const menu = document.getElementById('view-menu');
const canvas = document.getElementById('starfield');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const DEPTH = 70;          // how far away pieces spawn (world units; king height = 1)
const SPREAD_X = 28;
const SPREAD_Y = 16;
const BASE_SPEED = 5.5;    // world units per second toward the camera
const TOTAL = 210;         // piece count (a menu backdrop, not a benchmark)
// A chess set's own census as spawn weights: pawns are the dust of this galaxy.
const WEIGHTS = { pawn: 8, rook: 2, knight: 2, bishop: 2, queen: 1, king: 1 };

let world = null;          // built scene, or null
let failed = false;        // don't retry a failed build
let building = false;
let raf = 0;

function menuActive() {
  return menu.classList.contains('active') && !reducedMotion.matches;
}

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

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const scene = new THREE.Scene();
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#171310';
  // Alpha canvas + fog toward the page background: distant pieces melt into the room.
  scene.fog = new THREE.Fog(new THREE.Color(bg), DEPTH * 0.25, DEPTH * 0.95);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, DEPTH + 10);
  camera.position.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x8a7a5f, 0.5));
  const key = new THREE.DirectionalLight(0xe2c17e, 1.6); // the club's brass lamp
  key.position.set(-4, 6, 8);
  scene.add(key);

  const ivory = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.55, metalness: 0.1 });
  const walnut = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.6, metalness: 0.1 });

  // One InstancedMesh per (piece type, colour); each instance is one "star".
  const groups = [];
  const names = Object.keys(WEIGHTS).filter((n) => pieces[n]);
  const weightSum = names.reduce((s, n) => s + WEIGHTS[n], 0);
  for (const name of names) {
    const perColor = Math.max(1, Math.round((TOTAL * WEIGHTS[name]) / weightSum / 2));
    for (const material of [ivory, walnut]) {
      const mesh = new THREE.InstancedMesh(pieces[name].geometry, material, perColor);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const starList = [];
      for (let i = 0; i < perColor; i++) starList.push(spawn(THREE, true));
      groups.push({ mesh, preMatrix: pieces[name].preMatrix, starList });
    }
  }

  world = {
    THREE, renderer, scene, camera, groups,
    dummy: new THREE.Object3D(),
    spin: new THREE.Quaternion(),
    lastT: 0,
  };
  resize();
}

/* A fresh star: far away on first respawn, anywhere along the run at startup. */
function spawn(THREE, anywhere, star) {
  star = star || {};
  star.x = (Math.random() * 2 - 1) * SPREAD_X;
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

function frame(t) {
  raf = requestAnimationFrame(frame);
  const w = world;
  const dt = Math.min((t - (w.lastT || t)) / 1000, 0.1); // clamp tab-return jumps
  w.lastT = t;
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
  w.renderer.render(w.scene, w.camera);
}

function resize() {
  if (!world) return;
  const wpx = window.innerWidth, hpx = window.innerHeight;
  world.camera.aspect = wpx / hpx;
  world.camera.updateProjectionMatrix();
  world.renderer.setSize(wpx, hpx, false);
}

async function sync() {
  if (!menuActive()) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    canvas.hidden = true;
    return;
  }
  if (!world && !failed && !building) {
    building = true;
    try { await build(); }
    catch (e) { failed = true; return; }
    finally { building = false; }
    if (!menuActive()) { sync(); return; } // view changed while loading
  }
  if (world && !raf) {
    canvas.hidden = false;
    world.lastT = 0;
    raf = requestAnimationFrame(frame);
  }
}

new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', resize);
reducedMotion.addEventListener('change', sync);
sync();
