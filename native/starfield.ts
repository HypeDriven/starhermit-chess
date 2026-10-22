// The club's backdrop: chess pieces drifting out of the dark toward the
// viewer, lit by the room's brass lamp, with dust motes in its light — the
// browser client's starfield.js on the engine's scene. It shows behind the
// club only (the table and replay keep a plain room); `update` is called
// every frame with whether it should.
import { frame, preferences } from "starhermit:engine";
import { OffscreenCanvas } from "starhermit:canvas";
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, Color,
  DirectionalLight, Fog, GLTFLoader, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial, Quaternion, Vector3,
  renderer, scene, type Object3D,
} from "starhermit:scene";
import { PALETTE } from "./board.js";

const DEPTH = 70;           // how far away pieces spawn (world units; king height = 1)
const SPREAD_X_MAX = 28;
const SPREAD_Y = 16;
const BASE_SPEED = 5.5;     // world units per second toward the camera
const WEIGHTS = { pawn: 8, rook: 2, knight: 2, bishop: 2, queen: 1, king: 1 } as const;
const EXPOSURE = 1.15;
const MOTE_NEAR = 3, MOTE_FAR = 34;

interface Star { x: number; y: number; z: number; speed: number; scale: number; axis: Vector3; rotSpeed: number; q: Quaternion }
interface Group { mesh: InstancedMesh; pre: Matrix4; stars: Star[] }
interface Mote { x: number; y: number; z: number; vy: number; sway: number; tw: number; ph: number }

let built: Promise<void> | null = null;
let ready = false;
let shown = false;
let spreadX = SPREAD_X_MAX;
let time = 0;
const groups: Group[] = [];
const motes: Mote[] = [];
let moteMesh: Points | null = null;
let others: Object3D[] = [];
const spin = new Quaternion();
const m = new Matrix4();
const pos = new Vector3(), scl = new Vector3();

// ACES (as the renderer tone-maps) and its inverse, so the fog and the
// background land exactly on the room's colour after tone mapping.
function aces([r, g, b]: number[], exposure: number): number[] {
  const k = exposure / 0.6;
  const x = [r! * k, g! * k, b! * k];
  const i = [0.59719 * x[0]! + 0.35458 * x[1]! + 0.04823 * x[2]!, 0.07600 * x[0]! + 0.90834 * x[1]! + 0.01566 * x[2]!, 0.02840 * x[0]! + 0.13383 * x[1]! + 0.83777 * x[2]!];
  const f = i.map((v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081));
  return [1.60475 * f[0]! - 0.53108 * f[1]! - 0.07367 * f[2]!, -0.10208 * f[0]! + 1.10813 * f[1]! - 0.00605 * f[2]!, -0.00327 * f[0]! - 0.07276 * f[1]! + 1.07602 * f[2]!]
    .map((v) => Math.min(1, Math.max(0, v)));
}
function invAces(target: number[], exposure: number): number[] {
  const x = target.slice();
  for (let it = 0; it < 40; it++) {
    const y = aces(x, exposure);
    for (let c = 0; c < 3; c++) {
      const h = Math.max(1e-4, x[c]! * 0.01);
      const bumped = x.slice(); bumped[c]! += h;
      const d = (aces(bumped, exposure)[c]! - y[c]!) / h;
      if (d > 1e-6) x[c] = Math.max(0, x[c]! - (y[c]! - target[c]!) / d);
    }
  }
  return x;
}

/** The colour that tone-maps onto the room's background (scene colours are linear). */
function roomColor(): Color {
  const bg = new Color(PALETTE.bg);
  const [r, g, b] = invAces([bg.r, bg.g, bg.b], EXPOSURE);
  return new Color().setRGB(r!, g!, b!);
}

function radialTexture(size: number, stops: [number, string][]): CanvasTexture {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

function spawn(anywhere: boolean, star?: Star): Star {
  const s = star ?? { x: 0, y: 0, z: 0, speed: 0, scale: 1, axis: new Vector3(), rotSpeed: 0, q: new Quaternion() };
  s.x = (Math.random() * 2 - 1) * spreadX;
  s.y = (Math.random() * 2 - 1) * SPREAD_Y;
  s.z = anywhere ? -(2 + Math.random() * (DEPTH - 2)) : -DEPTH + Math.random() * -4;
  s.speed = BASE_SPEED * (0.7 + Math.random() * 0.9);
  s.scale = 0.8 + Math.random() * 0.9;
  s.axis.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
  s.rotSpeed = 0.25 + Math.random() * 0.9;
  s.q.setFromAxisAngle(s.axis, Math.random() * Math.PI * 2);
  return s;
}

async function build(): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync("assets/chess-pieces.glb");
  gltf.scene.updateMatrixWorld(true);
  // The GLB is quantized: real-world scale lives in each node's matrix, so it
  // is folded into every instance matrix.
  const pieces = new Map<string, { mesh: Mesh; pre: Matrix4 }>();
  gltf.scene.traverse((o) => { if (o instanceof Mesh) pieces.set(o.name, { mesh: o, pre: new Matrix4().copy(o.matrixWorld) }); });

  scene.fog = new Fog(roomColor(), DEPTH * 0.25, DEPTH * 0.95);

  // Warm hemisphere fill, the brass lamp as key, a cool rim from behind the field.
  const hemi = new HemisphereLight(0xffe3b8, 0x2a1b10, 0.9);
  const amb = new AmbientLight(0x8a7a5f, 0.25);
  const key = new DirectionalLight(0xffd49a, 2.3);
  key.position.set(-4, 6, 8);
  const rim = new DirectionalLight(0x9db2d6, 0.9);
  rim.position.set(6, 3, -30);
  // The lamp itself: a wide, faint pool of light far up-left, behind the fog.
  const glow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
    map: radialTexture(256, [[0, "rgba(255,214,150,1)"], [0.3, "rgba(230,180,110,0.4)"], [0.7, "rgba(200,150,90,0.08)"], [1, "rgba(0,0,0,0)"]]),
    color: new Color(0.03, 0.021, 0.012), blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false,
  }));
  glow.position.set(-DEPTH * 0.35, DEPTH * 0.28, -DEPTH * 0.9);
  glow.scale.setScalar(DEPTH * 1.3);
  glow.renderOrder = -1;
  others = [hemi, amb, key, rim, glow];
  scene.add(...others);

  const small = Math.min(frame().width, frame().height) / frame().scale < 620;
  const total = small ? 120 : 210;
  const materials = {
    ivory: new MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.55, metalness: 0.1 }),
    walnut: new MeshStandardMaterial({ color: 0x6a4d36, roughness: 0.6, metalness: 0.1 }),
  };
  const weightSum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const piece = pieces.get(name);
    if (!piece) continue;
    const count = Math.max(1, Math.round((total * weight) / weightSum / 2));
    for (const tone of ["ivory", "walnut"] as const) {
      const mesh = new InstancedMesh(piece.mesh.geometry, materials[tone], count);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const stars: Star[] = [];
      for (let i = 0; i < count; i++) stars.push(spawn(true));
      groups.push({ mesh, pre: piece.pre, stars });
    }
  }

  // Dust motes: additive points, brighter toward the lamp, twinkling slowly.
  const n = small ? 90 : 160;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(n * 3), 3));
  moteMesh = new Points(geo, new PointsMaterial({
    size: 0.16, sizeAttenuation: true, vertexColors: true, fog: false,
    map: radialTexture(64, [[0, "rgba(255,255,255,1)"], [0.3, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]),
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  }));
  moteMesh.frustumCulled = false;
  scene.add(moteMesh);
  for (let i = 0; i < n; i++) {
    motes.push({
      x: (Math.random() * 2 - 1) * 14, y: (Math.random() * 2 - 1) * 9,
      z: -(MOTE_NEAR + Math.random() * (MOTE_FAR - MOTE_NEAR)),
      vy: 0.08 + Math.random() * 0.22, sway: Math.random() * Math.PI * 2,
      tw: 0.6 + Math.random() * 1.8, ph: Math.random() * Math.PI * 2,
    });
  }
  ready = true;
}

function setVisible(on: boolean): void {
  for (const g of groups) g.mesh.visible = on;
  for (const o of others) o.visible = on;
  if (moteMesh) moteMesh.visible = on;
  // Tone mapping and fog belong to the backdrop; the table's plain room stays as it was.
  renderer.toneMapping = on ? ACESFilmicToneMapping : 0;
  renderer.toneMappingExposure = on ? EXPOSURE : 1;
  scene.background = new Color(PALETTE.bg);
  if (scene.fog) (scene.fog as Fog).far = on ? DEPTH * 0.95 : 1e6;
  shown = on;
}

/** Advances and shows the backdrop (`active`), or hides it. */
export function updateStarfield(dt: number, active: boolean, camera: PerspectiveCamera): void {
  if (active && !built) built = build().catch((e) => { console.warn(`starfield: ${String(e)}`); });
  if (!ready) return;
  if (active !== shown) setVisible(active);
  if (!active) return;
  spreadX = Math.min(SPREAD_X_MAX, Math.max(12, SPREAD_Y * camera.aspect * 1.6));
  const step = preferences().reducedMotion ? 0 : Math.min(dt, 0.1);
  time += step;
  for (const g of groups) {
    for (let i = 0; i < g.stars.length; i++) {
      const s = g.stars[i]!;
      s.z += s.speed * step;
      if (s.z > -1.5) spawn(false, s);
      spin.setFromAxisAngle(s.axis, s.rotSpeed * step);
      s.q.premultiply(spin);
      m.compose(pos.set(s.x, s.y, s.z), s.q, scl.setScalar(s.scale)).multiply(g.pre);
      g.mesh.setMatrixAt(i, m);
    }
    g.mesh.instanceMatrix.needsUpdate = true;
  }
  if (moteMesh) {
    const p = moteMesh.geometry.getAttribute("position") as BufferAttribute;
    const c = moteMesh.geometry.getAttribute("color") as BufferAttribute;
    const pa = p.array as Float32Array, ca = c.array as Float32Array;
    for (let i = 0; i < motes.length; i++) {
      const o = motes[i]!;
      o.y += o.vy * step;
      o.z += 0.6 * step;
      if (o.y > 9) o.y = -9;
      if (o.z > -MOTE_NEAR) o.z = -MOTE_FAR;
      const x = o.x + Math.sin(time * 0.35 + o.sway) * 0.6;
      pa[i * 3] = x; pa[i * 3 + 1] = o.y; pa[i * 3 + 2] = o.z;
      const fade = 1 - (-o.z - MOTE_NEAR) / (MOTE_FAR - MOTE_NEAR);
      const lamp = 0.55 + 0.45 * Math.max(0, Math.min(1, (-x + o.y) / 20 + 0.5));
      const b = 2.2 * fade * lamp * (0.55 + 0.45 * Math.sin(time * o.tw + o.ph));
      ca[i * 3] = b; ca[i * 3 + 1] = b * 0.8; ca[i * 3 + 2] = b * 0.52;
    }
    p.needsUpdate = true;
    c.needsUpdate = true;
  }
}
