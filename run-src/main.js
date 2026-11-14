import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { HW, WT, FT, MR, ORDER, getDef, LIBRARY, totalDrop } from './parts.js';

const VERSION = '0.1';
const Y = new THREE.Vector3(0, 1, 0);
const GRAV = -20;
const $ = (id) => document.getElementById(id);
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/* ---------------------------------------------------------------- geometry helpers */
function frameFor(f) {
  f = f.clone().normalize();
  const s = new THREE.Vector3().crossVectors(f, Y).normalize();
  const u = new THREE.Vector3().crossVectors(s, f);
  return { f, s, u };
}
const quatFromFrame = (fr) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.f, fr.u, fr.s));

// rotate a frame about its forward axis by b radians (banking)
function bankFrame(fr, b) {
  if (!b) return fr;
  const c = Math.cos(b), s = Math.sin(b);
  return { f: fr.f, u: fr.u.clone().multiplyScalar(c).addScaledVector(fr.s, s), s: fr.s.clone().multiplyScalar(c).addScaledVector(fr.u, -s) };
}
function sampleFrames(P, bank) {
  const n = P.length;
  return P.map((p, i) => bankFrame(frameFor(P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)])), bank ? bank[i] : 0));
}

function ribbonGeometry(def) {
  const P = def.samples.map((s) => V3(s.p));
  const W = def.samples.map((s) => s.w);
  const H = def.H;
  const fr = sampleFrames(P, def.bank);
  const n = P.length;
  const pos = [], idx = [];
  const prof = (w) => {
    const hw = w / 2;
    return [[-hw - WT, -FT], [-hw - WT, H], [-hw, H], [-hw, 0], [hw, 0], [hw, H], [hw + WT, H], [hw + WT, -FT]];
  };
  const at = (i, a, h) => P[i].clone().addScaledVector(fr[i].s, a).addScaledVector(fr[i].u, h);
  const push = (v) => { pos.push(v.x, v.y, v.z); return pos.length / 3 - 1; };
  for (let k = 0; k < 8; k++) {
    const A = [], B = [];
    for (let i = 0; i < n; i++) {
      const pr = prof(W[i]);
      A.push(push(at(i, ...pr[k])));
      B.push(push(at(i, ...pr[(k + 1) % 8])));
    }
    for (let i = 0; i < n - 1; i++) idx.push(A[i], B[i], A[i + 1], B[i], B[i + 1], A[i + 1]);
  }
  for (const i of [0, n - 1]) {
    const pr = prof(W[i]);
    const quad = (ids) => {
      const v = ids.map((j) => push(at(i, ...pr[j])));
      idx.push(v[0], v[1], v[2], v[0], v[2], v[3]);
    };
    quad([0, 1, 2, 3]); quad([0, 3, 4, 7]); quad([4, 5, 6, 7]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const matCache = {};
function trackMat(color) {
  if (!matCache[color]) matCache[color] = new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, side: THREE.DoubleSide });
  return matCache[color];
}
const pegMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 });

function chevGeometry() {
  const sh = new THREE.Shape();
  sh.moveTo(-0.12, -0.17); sh.lineTo(0.0, -0.17); sh.lineTo(0.14, 0); sh.lineTo(0.0, 0.17); sh.lineTo(-0.12, 0.17); sh.lineTo(0.02, 0);
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  return g;
}
const CHEV = chevGeometry();

// Visual for one piece in LOCAL coordinates. mat overrides everything (ghost).
function pieceVisual(type, ghostMat) {
  const def = getDef(type);
  const g = new THREE.Group();
  const rib = new THREE.Mesh(ribbonGeometry(def), ghostMat || trackMat(def.color));
  rib.castShadow = !ghostMat; rib.receiveShadow = !ghostMat;
  g.add(rib);
  for (const e of def.extras) {
    let m = null;
    if (e.k === 'box') {
      m = new THREE.Mesh(new THREE.BoxGeometry(e.h[0] * 2, e.h[1] * 2, e.h[2] * 2), ghostMat || trackMat(e.color));
      m.position.set(...e.c);
    } else if (e.k === 'peg') {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 16), ghostMat || pegMat(e.color));
      m.position.set(e.x, e.y + 0.15, e.z);
    } else if (e.k === 'roof') {
      const a = V3(e.a), b = V3(e.b), len = a.distanceTo(b);
      m = new THREE.Mesh(new THREE.BoxGeometry(len, e.hh * 2, e.hs * 2),
        ghostMat || new THREE.MeshPhysicalMaterial({ color: e.color, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false }));
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.copy(quatFromFrame(frameFor(b.clone().sub(a))));
    } else if (e.k === 'chev') {
      m = new THREE.Mesh(CHEV, ghostMat || new THREE.MeshBasicMaterial({ color: e.color, side: THREE.DoubleSide }));
      m.position.set(e.x, e.y + 0.012, 0);
    }
    if (m) { m.castShadow = !ghostMat && e.k !== 'chev'; g.add(m); }
  }
  return g;
}

/* ---------------------------------------------------------------- layout (world transforms) */
function computeLayout(type, E, yaw) {
  const def = getDef(type);
  const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(E);
  const smp = def.samples.map((s) => V3(s.p).applyMatrix4(M));
  const W = def.samples.map((s) => s.w);
  // dense polyline (≤0.25 spacing) used for collision checks between pieces
  const dense = [];
  for (let i = 0; i < smp.length - 1; i++) {
    const a = smp[i], b = smp[i + 1], d = a.distanceTo(b), k = Math.max(1, Math.ceil(d / 0.25));
    for (let j = 0; j < k; j++) dense.push({ p: a.clone().lerp(b, j / k), w: W[i] + (W[i + 1] - W[i]) * (j / k) });
  }
  dense.push({ p: smp[smp.length - 1].clone(), w: W[W.length - 1] });
  return {
    type, def, E: E.clone(), yaw, M, smp, W, dense,
    exit: def.exit ? { pos: V3(def.exit.p).applyMatrix4(M), yaw: yaw + def.exit.yaw } : null,
    boosters: (def.boosters || []).map((b) => ({ a: V3(b.a).applyMatrix4(M), b: V3(b.b).applyMatrix4(M) })),
  };
}

/* ---------------------------------------------------------------- app state */
let build = null;            // { startY, nextId, pieces:[{id,type,parent}] }
let layout = new Map();      // id -> layout
let undoStack = [];
let selectedType = null;     // part chosen in tray
let selectedPiece = null;    // piece id picked for removal
let activeConn = null;       // piece id whose open end is the default target
let hoverConn = null;
let ghost = null;            // {group, conn, ok}
let soundOn = localStorage.getItem('marble.sound') !== '0';

function newBuild(startY = 9) {
  return { startY, nextId: 2, pieces: [{ id: 1, type: 'start', parent: null }] };
}
function buildFromSeq(seq) {
  const b = newBuild(Math.max(3, totalDrop(seq) + 1.3));
  let parent = 1;
  for (const t of seq.slice(1)) { const id = b.nextId++; b.pieces.push({ id, type: t, parent }); parent = id; }
  return b;
}
function computeAll(b) {
  const m = new Map();
  for (const p of b.pieces) {
    const par = p.parent == null ? null : m.get(p.parent);
    const L = par ? computeLayout(p.type, par.exit.pos, par.exit.yaw) : computeLayout(p.type, new THREE.Vector3(0, b.startY, 0), 0);
    L.id = p.id; L.parent = p.parent;
    m.set(p.id, L);
  }
  return m;
}
const hasChild = (id) => build.pieces.some((p) => p.parent === id);
function openConns() {
  return build.pieces.filter((p) => layout.get(p.id).exit && !hasChild(p.id)).map((p) => p.id);
}

function validate(type, parentId, lay = layout) {
  const par = lay.get(parentId);
  if (!par || !par.exit) return { ok: false, msg: 'That piece has no open end.' };
  const L = computeLayout(type, par.exit.pos, par.exit.yaw);
  for (const d of L.dense) if (d.p.y < 0.3) return { ok: false, msg: 'Too low – that would hit the table. Try a flatter piece, or lift the whole run with "Higher".' };
  for (const [id, q] of lay) {
    if (id === parentId) continue;
    for (const a of q.dense) for (const b of L.dense) {
      const thr = 0.3 + 0.5 * Math.max(a.w, b.w);
      if (a.p.distanceToSquared(b.p) < thr * thr) return { ok: false, msg: 'That would crash into another piece.' };
    }
  }
  return { ok: true, L };
}

/* ---------------------------------------------------------------- renderer / scene */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
camera.position.set(9, 9, 11);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.minDistance = 2.5; controls.maxDistance = 90;
controls.screenSpacePanning = true;
controls.target.set(0, 4, 0);

const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
sun.position.set(8, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xdbeafe, 0xe9dfc9, 0.45));

const table = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd3deec, roughness: 0.95 }));
table.receiveShadow = true;
scene.add(table);
const grid = new THREE.GridHelper(60, 60, 0xaebdd2, 0xbccadc);
grid.position.y = 0.003; grid.material.transparent = true; grid.material.opacity = 0.7;
scene.add(grid);

const trackGroup = new THREE.Group(); scene.add(trackGroup);
const markerGroup = new THREE.Group(); scene.add(markerGroup);
const marbleGroup = new THREE.Group(); scene.add(marbleGroup);
const ghostGroup = new THREE.Group(); scene.add(ghostGroup);
const ghostOk = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/* ---------------------------------------------------------------- build → scene + physics */
let world = null;
let spawnLocal = new THREE.Vector3();
let boosters = [];
let pillarMeshes = [];

function pillarsFor(L) {
  const out = [];
  const pts = L.def.pillars || [L.def.samples[0].p];
  for (const pl of pts) {
    const top = V3(pl).applyMatrix4(L.M);
    if (!L.def.pillarTop) top.y -= FT;
    let base = 0;
    for (const [id, q] of layout) {
      if (id === L.id) continue;
      for (const d of q.dense) {
        if (Math.abs(d.p.x - top.x) < 0.28 && Math.abs(d.p.z - top.z) < 0.28 && d.p.y < top.y - 0.3 && d.p.y > base) base = d.p.y;
      }
    }
    if (top.y - base > 0.15) out.push({ x: top.x, z: top.z, y0: base, y1: top.y });
  }
  return out;
}

function addBeam(c, q, h, extra) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(h[0], h[1], h[2]).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.35).setRestitution(0.18), extra);
}

function trackColliders(L) {
  const P = L.smp, W = L.W, H = L.def.H, n = P.length, bk = L.def.bank;
  const fr = sampleFrames(P, bk);
  for (let i = 0; i < n - 1; i++) {
    const bm = bk ? (bk[i] + bk[i + 1]) / 2 : 0;
    const a = P[i], b = P[i + 1], sf = bankFrame(frameFor(b.clone().sub(a)), bm), len = a.distanceTo(b);
    addBeam(a.clone().add(b).multiplyScalar(0.5).addScaledVector(sf.u, -FT / 2), quatFromFrame(sf), [len / 2 + 0.03, FT / 2, (W[i] + W[i + 1]) / 4 + WT]);
    for (const side of [-1, 1]) {
      const ea = P[i].clone().addScaledVector(fr[i].s, side * (W[i] / 2 + WT / 2));
      const eb = P[i + 1].clone().addScaledVector(fr[i + 1].s, side * (W[i + 1] / 2 + WT / 2));
      const ef = bankFrame(frameFor(eb.clone().sub(ea)), bm);
      addBeam(ea.clone().add(eb).multiplyScalar(0.5).addScaledVector(ef.u, (H - FT) / 2), quatFromFrame(ef), [ea.distanceTo(eb) / 2 + 0.03, (H + FT) / 2, WT / 2]);
    }
  }
  const qy = new THREE.Quaternion().setFromAxisAngle(Y, L.yaw);
  for (const e of L.def.extras) {
    if (e.k === 'box') {
      const c = V3(e.c).applyMatrix4(L.M);
      addBeam(c, qy, e.h);
    } else if (e.k === 'peg') {
      const c = new THREE.Vector3(e.x, e.y + 0.15, e.z).applyMatrix4(L.M);
      world.createCollider(RAPIER.ColliderDesc.cylinder(0.15, 0.055).setTranslation(c.x, c.y, c.z).setFriction(0.02).setRestitution(0.5));
    } else if (e.k === 'roof') {
      const a = V3(e.a).applyMatrix4(L.M), b = V3(e.b).applyMatrix4(L.M), f = frameFor(b.clone().sub(a));
      addBeam(a.clone().add(b).multiplyScalar(0.5), quatFromFrame(f), [a.distanceTo(b) / 2, e.hh, e.hs]);
    }
  }
}

function rebuild({ keepCamera = true } = {}) {
  layout = computeAll(build);
  // visuals
  for (const g of [trackGroup, markerGroup]) { while (g.children.length) { const c = g.children.pop(); c.traverse((o) => { if (o.geometry && o.geometry !== CHEV) o.geometry.dispose(); }); } }
  for (const p of build.pieces) {
    const L = layout.get(p.id);
    const g = pieceVisual(p.type);
    g.position.copy(L.E); g.rotation.y = L.yaw;
    g.userData.pieceId = p.id;
    g.traverse((o) => { o.userData.pieceId = p.id; });
    trackGroup.add(g);
  }
  const pillMat = new THREE.MeshStandardMaterial({ color: 0xa9b7cb, roughness: 0.6 });
  const placed = [];
  for (const p of build.pieces) {
    for (const pl of pillarsFor(layout.get(p.id))) {
      if (placed.some((q) => Math.hypot(q.x - pl.x, q.z - pl.z) < 1.6 && Math.abs(q.y1 - pl.y1) < 2.2)) continue;
      placed.push(pl);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, pl.y1 - pl.y0, 12), pillMat);
      m.position.set(pl.x, (pl.y0 + pl.y1) / 2, pl.z); m.castShadow = true; m.receiveShadow = true;
      trackGroup.add(m);
    }
  }
  // physics
  if (world) world.free();
  world = new RAPIER.World({ x: 0, y: GRAV, z: 0 });
  world.timestep = 1 / 120;
  world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0).setFriction(0.6).setRestitution(0.1));
  boosters = [];
  for (const p of build.pieces) { const L = layout.get(p.id); trackColliders(L); boosters.push(...L.boosters); }
  const sl = layout.get(1);
  spawnLocal = V3(sl.def.spawn).applyMatrix4(sl.M);
  clearRun();
  rebuildMarkers();
  updateShadowBox();
  refreshGhost();
  updateHint();
  localStorage.setItem('marble.current', JSON.stringify(build));
}

function bbox() {
  const b = new THREE.Box3();
  for (const L of layout.values()) for (const s of L.smp) b.expandByPoint(s);
  return b;
}
function updateShadowBox() {
  const b = bbox(), c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2 + 3;
  sun.target.position.copy(c);
  sun.position.copy(c).add(new THREE.Vector3(0.45, 1, 0.55).normalize().multiplyScalar(r * 2.2));
  const cam = sun.shadow.camera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.5; cam.far = r * 5;
  cam.updateProjectionMatrix();
  sun.shadow.map?.dispose(); sun.shadow.map = null;
}
function frameAll(animate = true) {
  const b = bbox(), c = b.getCenter(new THREE.Vector3()), r = Math.max(4, b.getSize(new THREE.Vector3()).length() / 2);
  const dist = r / Math.tan((camera.fov * Math.PI) / 360) * 1.12 * (camera.aspect < 1 ? 1.5 : 1);
  const dir = new THREE.Vector3(0.62, 0.5, 0.75).normalize();
  camTween = { t: 0, from: camera.position.clone(), fromT: controls.target.clone(), to: c.clone().addScaledVector(dir, dist), toT: c.clone().add(new THREE.Vector3(0, -r * 0.12, 0)), dur: animate ? 0.7 : 0.001 };
}
let camTween = null;

/* ---------------------------------------------------------------- open-end markers + ghost */
const markerMeshes = [];
function rebuildMarkers() {
  markerMeshes.length = 0;
  for (const id of openConns()) {
    const L = layout.get(id);
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 12, 40).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 16).rotateZ(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    cone.position.x = 0.05;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    g.add(ring, cone, hit);
    g.position.copy(L.exit.pos).add(new THREE.Vector3(0, 0.12, 0)); g.rotation.y = L.exit.yaw;
    g.userData = { marker: true, pieceId: id, ring, cone };
    hit.userData = { marker: true, pieceId: id };
    markerGroup.add(g); markerMeshes.push(g);
  }
  if (!openConns().includes(activeConn)) activeConn = openConns().slice(-1)[0] ?? null;
}
function updateMarkers(time) {
  for (const g of markerMeshes) {
    const act = g.userData.pieceId === activeConn;
    const col = act ? 0xfbbf24 : 0x22c55e;
    g.userData.ring.material.color.setHex(col); g.userData.cone.material.color.setHex(col);
    const s = (act ? 1.1 : 0.9) + Math.sin(time * 3.2) * 0.07;
    g.scale.setScalar(s);
    g.visible = !riding;
  }
}

function targetConn() { return hoverConn ?? activeConn; }
function refreshGhost() {
  while (ghostGroup.children.length) ghostGroup.remove(ghostGroup.children[0]);
  ghost = null;
  const cid = targetConn();
  if (!selectedType || cid == null || !layout.get(cid)?.exit) return;
  const v = validate(selectedType, cid);
  const par = layout.get(cid);
  const L = v.L || computeLayout(selectedType, par.exit.pos, par.exit.yaw);
  const g = pieceVisual(selectedType, v.ok ? ghostOk : ghostBad);
  g.position.copy(L.E); g.rotation.y = L.yaw;
  g.traverse((o) => { o.userData.ghost = true; });
  ghostGroup.add(g);
  ghost = { conn: cid, ok: v.ok, msg: v.msg };
}

/* ---------------------------------------------------------------- marbles + recording */
const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f8fafc'];
let colorIdx = 1;
const marbleTex = {};
function marbleMaterial(col) {
  if (marbleTex[col]) return marbleTex[col];
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = col; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 7; i++) {
    x.fillStyle = i % 2 ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.28)';
    x.beginPath();
    const y0 = 8 + i * 18;
    x.moveTo(0, y0);
    for (let px = 0; px <= 256; px += 16) x.lineTo(px, y0 + Math.sin(px / 256 * Math.PI * 4 + i) * 9);
    for (let px = 256; px >= 0; px -= 16) x.lineTo(px, y0 + 7 + Math.sin(px / 256 * Math.PI * 4 + i + 0.6) * 9);
    x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (marbleTex[col] = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 }));
}
const marbleGeo = new THREE.SphereGeometry(MR, 40, 28);

let marbles = [];
let head = 0, playhead = 0, dir = 0, speed = 1, finished = false, calm = 0;
let spawnQueue = [];
const MAX_FRAMES = 60 * 360;

function clearRun() {
  for (const m of marbles) marbleGroup.remove(m.mesh);
  marbles = []; spawnQueue = [];
  head = 0; playhead = 0; dir = 0; finished = false; calm = 0;
}

function spawnMarble(col) {
  const jitter = (Math.random() - 0.5) * 0.12;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnLocal.x, spawnLocal.y, spawnLocal.z + jitter).setCcdEnabled(true).setLinearDamping(0.01).setAngularDamping(0.05));
  world.createCollider(RAPIER.ColliderDesc.ball(MR).setDensity(2).setFriction(0.5).setRestitution(0.25), body);
  const mesh = new THREE.Mesh(marbleGeo, marbleMaterial(col));
  mesh.castShadow = true; mesh.visible = false;
  marbleGroup.add(mesh);
  const m = { body, mesh, spawn: head, data: new Float32Array(7 * 256), n: 0, dead: false, escaped: false };
  marbles.push(m);
  record(m);
  return m;
}
function record(m) {
  if ((m.n + 1) * 7 > m.data.length) { const d = new Float32Array(m.data.length * 2); d.set(m.data); m.data = d; }
  const t = m.body.translation(), r = m.body.rotation();
  m.data.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], m.n * 7);
  m.n++;
}

function applyBoosters(dt) {
  for (const m of marbles) {
    if (m.dead) continue;
    const t = m.body.translation();
    const v0 = m.body.linvel(), sp = Math.hypot(v0.x, v0.y, v0.z), kd = -0.2 * sp * m.body.mass() * dt;
    if (sp > 0.5) m.body.applyImpulse({ x: v0.x * kd, y: v0.y * kd, z: v0.z * kd }, true);
    for (const b of boosters) {
      const ab = b.b.clone().sub(b.a), len2 = ab.lengthSq();
      const tt = Math.max(0, Math.min(1, ((t.x - b.a.x) * ab.x + (t.y - b.a.y) * ab.y + (t.z - b.a.z) * ab.z) / len2));
      const cx = b.a.x + ab.x * tt, cy = b.a.y + ab.y * tt, cz = b.a.z + ab.z * tt;
      if ((t.x - cx) ** 2 + (t.y - cy) ** 2 + (t.z - cz) ** 2 < 0.09) {
        const d = ab.clone().normalize();
        const v = m.body.linvel();
        if (v.x * d.x + v.y * d.y + v.z * d.z < 6.5) { const k = m.body.mass() * 46 * dt; m.body.applyImpulse({ x: d.x * k, y: d.y * k, z: d.z * k }, true); }
      }
    }
  }
}

function nearCatcher(t) {
  for (const L of layout.values()) if (L.type === 'end') for (const d of L.dense) if ((d.p.x - t.x) ** 2 + (d.p.y - t.y) ** 2 + (d.p.z - t.z) ** 2 < 1.6) return true;
  return false;
}
function stepFrame() {
  while (spawnQueue.length && head >= spawnQueue[0].frame) { const q = spawnQueue.shift(); spawnMarble(q.color); blip(900, 0.08, 0.05); }
  for (let k = 0; k < 2; k++) { applyBoosters(1 / 120); world.step(); }
  head++;
  let moving = false;
  for (const m of marbles) {
    if (m.dead) continue;
    const t = m.body.translation();
    if (t.y < 0.26 && !m.escaped) { m.escaped = true; toast('A marble rolled off the track! Check for a gap, or finish the run with a Catcher.'); }
    if (t.y < 0.26) { m.body.setLinearDamping(1.2); m.body.setAngularDamping(1.5); }
    if (t.y < -6) { m.dead = true; world.removeRigidBody(m.body); continue; }
    record(m);
    const v = m.body.linvel(), sp2 = v.x * v.x + v.y * v.y + v.z * v.z;
    if (sp2 > 0.01) moving = true;
    // gentle "shake" if a marble gets wedged somewhere that isn't the catcher
    if (sp2 < 0.02 && t.y > 0.5 && !nearCatcher(t)) {
      m.stuck = (m.stuck || 0) + 1;
      if (m.stuck > 45) { m.stuck = 0; m.body.applyImpulse({ x: (Math.random() - 0.5) * 0.05, y: 0.04, z: (Math.random() - 0.5) * 0.05 }, true); moving = true; }
      else moving = true;
    } else m.stuck = 0;
  }
  calm = moving || spawnQueue.length ? 0 : calm + 1;
  if (calm > 90 || head >= MAX_FRAMES) finished = true;
}

function poseAt(m, f, out) {
  const idx = Math.max(0, Math.min(m.n - 1, f - m.spawn));
  const d = m.data;
  out.set(d[idx * 7], d[idx * 7 + 1], d[idx * 7 + 2]);
  return idx;
}
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
function applyPoses() {
  const f0 = Math.floor(playhead), a = playhead - f0;
  for (const m of marbles) {
    if (f0 < m.spawn) { m.mesh.visible = false; continue; }
    m.mesh.visible = true;
    const i0 = poseAt(m, f0, _p0);
    const i1 = poseAt(m, f0 + 1, _p1);
    const d = m.data;
    _q0.set(d[i0 * 7 + 3], d[i0 * 7 + 4], d[i0 * 7 + 5], d[i0 * 7 + 6]);
    _q1.set(d[i1 * 7 + 3], d[i1 * 7 + 4], d[i1 * 7 + 5], d[i1 * 7 + 6]);
    m.mesh.position.lerpVectors(_p0, _p1, a);
    m.mesh.quaternion.copy(_q0).slerp(_q1, a);
  }
}

function dropMarbles(n = 1) {
  if (!world) return;
  ensureAudio();
  if (finished) { finished = false; calm = 0; }
  playhead = head; dir = 1;
  spawnMarble(PALETTE[colorIdx]);
  blip(900, 0.08, 0.05);
  for (let i = 1; i < n; i++) spawnQueue.push({ frame: head + i * 22, color: PALETTE[(colorIdx + i) % PALETTE.length] });
}

/* ---------------------------------------------------------------- ride-along camera */
let riding = false;
const rideDir = new THREE.Vector3(1, 0, 0);
function rideTarget() {
  let best = null;
  for (const m of marbles) if (Math.floor(playhead) >= m.spawn) best = m;
  return best;
}
function updateRide(dt) {
  const m = rideTarget();
  if (!m) return;
  const f = Math.floor(playhead);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  poseAt(m, f - 6, a); poseAt(m, f + 6, b);
  const mv = b.sub(a); mv.y *= 0.3;
  if (mv.lengthSq() > 0.0004) rideDir.lerp(mv.normalize(), 1 - Math.pow(0.001, dt)).normalize();
  const p = m.mesh.position;
  const want = p.clone().addScaledVector(rideDir, -1.7).add(new THREE.Vector3(0, 0.95, 0));
  camera.position.lerp(want, 1 - Math.pow(0.0005, dt));
  controls.target.lerp(p.clone().addScaledVector(rideDir, 0.8), 1 - Math.pow(0.0005, dt));
}

/* ---------------------------------------------------------------- audio */
let actx = null;
function ensureAudio() { if (!actx && soundOn) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* ignore */ } } if (actx?.state === 'suspended') actx.resume(); }
function blip(freq, dur = 0.09, vol = 0.06) {
  if (!soundOn) return; ensureAudio(); if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
}

/* ---------------------------------------------------------------- editing actions */
function snapshot() { undoStack.push(JSON.stringify(build)); if (undoStack.length > 60) undoStack.shift(); }
function place(type, parentId) {
  const v = validate(type, parentId);
  if (!v.ok) { toast(v.msg); blip(180, 0.15, 0.05); return false; }
  snapshot();
  const id = build.nextId++;
  build.pieces.push({ id, type, parent: parentId });
  activeConn = getDef(type).exit ? id : null;
  if (!getDef(type).exit) selectedType = null;
  hoverConn = null; selectedPiece = null;
  rebuild();
  keepEndVisible();
  blip(520 + Math.random() * 80, 0.08, 0.07);
  return true;
}
// if the open end drifts off-screen (or under the control bar), glide the camera back to show the whole run
function keepEndVisible() {
  if (activeConn == null || !layout.get(activeConn)?.exit) return;
  const p = layout.get(activeConn).exit.pos.clone().project(camera);
  const mobile = narrow();
  if (p.z > 1 || Math.abs(p.x) > 0.82 || p.y > 0.8 || p.y < (mobile ? -0.2 : -0.6) || (!mobile && p.x < -0.72)) frameAll();
}
function removePiece(id) {
  if (id === 1) return;
  snapshot();
  const kill = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const p of build.pieces) if (!kill.has(p.id) && kill.has(p.parent)) { kill.add(p.id); grew = true; } }
  const parent = build.pieces.find((p) => p.id === id).parent;
  build.pieces = build.pieces.filter((p) => !kill.has(p.id));
  activeConn = parent; selectedPiece = null;
  rebuild(); blip(300, 0.1, 0.05);
}
function undo() {
  if (!undoStack.length) return;
  build = JSON.parse(undoStack.pop()); selectedPiece = null; activeConn = null;
  rebuild(); blip(380, 0.07, 0.05);
}
function loadBuild(b, frame = true) {
  snapshot(); build = b; selectedPiece = null; activeConn = null; hoverConn = null;
  rebuild(); if (frame) frameAll();
}
function raiseAll() {
  snapshot(); build.startY += 2; rebuild(); frameAll(); blip(560, 0.07, 0.05);
}

/* ---------------------------------------------------------------- hint + toast */
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3800);
}
function updateHint() {
  const h = $('hintText'), btn = $('hintBtn');
  btn.style.display = 'none';
  const name = selectedType ? getDef(selectedType).name : '';
  if (selectedPiece != null) {
    h.textContent = 'Piece selected.'; btn.style.display = ''; btn.textContent = 'Remove it (and everything after)';
    btn.onclick = () => removePiece(selectedPiece);
  } else if (selectedType) {
    h.textContent = ghost && !ghost.ok ? ghost.msg : `Tap the glowing ring to add a ${name}. Tap the piece again to cancel.`;
  } else if (!openConns().length) {
    h.textContent = 'This run is closed. Press Drop marble!';
  } else {
    h.textContent = 'Pick a piece, then tap a glowing ring – or drag a piece right onto one.';
  }
  const last = build.pieces[build.pieces.length - 1];
  $('stats').textContent = `${build.pieces.length} pieces`;
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.type === selectedType));
}

/* ---------------------------------------------------------------- tray */
function iconSvg(type) {
  const def = getDef(type);
  const pts = def.samples.map((s) => [s.p[0], s.p[2]]);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const wx = Math.max(0.6, maxX - minX), wz = Math.max(0.6, maxZ - minZ);
  const sc = Math.min(44 / wx, 30 / wz);
  const ox = 30 - ((minX + maxX) / 2) * sc, oz = 21 - ((minZ + maxZ) / 2) * sc;
  const d = pts.map(([x, z], i) => `${i ? 'L' : 'M'}${(x * sc + ox).toFixed(1)} ${(z * sc + oz).toFixed(1)}`).join('');
  let extra = '';
  for (const e of def.extras) if (e.k === 'peg') extra += `<circle cx="${(e.x * sc + ox).toFixed(1)}" cy="${(e.z * sc + oz).toFixed(1)}" r="1.6" fill="#facc15"/>`;
  const wide = Math.max(...def.samples.map((s) => s.w));
  return `<svg viewBox="0 0 60 42" width="60" height="42"><path d="${d}" fill="none" stroke="${def.color}" stroke-width="${Math.max(5, wide * sc * 0.55).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${wide > 1 ? 0.55 : 1}"/>${extra}</svg>`;
}
function buildTray() {
  const tray = $('tray');
  tray.innerHTML = '';
  for (const t of ORDER) {
    const d = document.createElement('div');
    d.className = 'card'; d.dataset.type = t;
    d.innerHTML = `${iconSvg(t)}<span>${getDef(t).name}</span>`;
    tray.appendChild(d);
    wireCard(d, t);
  }
}
let drag = null;
const dragChip = $('dragChip');
function narrow() { return window.matchMedia('(max-width: 820px)').matches; }
function wireCard(el, type) {
  el.addEventListener('pointerdown', (e) => {
    ensureAudio();
    drag = { type, x: e.clientX, y: e.clientY, active: false, id: e.pointerId, el };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.active) {
      const away = narrow() ? -dy > 12 && -dy > Math.abs(dx) : dx > 12 && dx > Math.abs(dy);
      const any = e.pointerType === 'mouse' && Math.hypot(dx, dy) > 8;
      if (!(away || any)) return;
      drag.active = true; dragChip.innerHTML = iconSvg(type); dragChip.style.display = 'block';
      selectedType = type; selectedPiece = null;
    }
    dragChip.style.transform = `translate(${e.clientX - 30}px, ${e.clientY - 56}px)`;
    const c = nearestConn(e.clientX, e.clientY, 170);
    hoverConn = c; refreshGhost(); updateHint();
  });
  const end = (e, cancel) => {
    if (!drag || drag.id !== e.pointerId) return;
    const was = drag; drag = null;
    dragChip.style.display = 'none';
    if (was.active) {
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const ok = !cancel && over === canvas && ghost && hoverConn != null;
      const conn = hoverConn;
      selectedType = null; hoverConn = null;
      if (ok) place(was.type, conn); else { refreshGhost(); updateHint(); }
    } else if (!cancel) {
      selectedType = selectedType === was.type ? null : was.type;
      selectedPiece = null; hoverConn = null; refreshGhost(); updateHint(); blip(700, 0.04, 0.04);
    }
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
}
function nearestConn(cx, cy, maxPx) {
  const r = canvas.getBoundingClientRect();
  let best = null, bd = maxPx;
  for (const id of openConns()) {
    const p = layout.get(id).exit.pos.clone().project(camera);
    if (p.z > 1) continue;
    const sx = r.left + (p.x * 0.5 + 0.5) * r.width, sy = r.top + (-p.y * 0.5 + 0.5) * r.height;
    const d = Math.hypot(sx - cx, sy - cy);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

/* ---------------------------------------------------------------- canvas interaction */
const ray = new THREE.Raycaster();
let down = null;
canvas.addEventListener('pointerdown', (e) => { ensureAudio(); down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || !selectedType || drag) return;
  const c = nearestConn(e.clientX, e.clientY, 140);
  if (c !== hoverConn) { hoverConn = c; refreshGhost(); updateHint(); }
});
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 8 || dt > 500) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hitsM = ray.intersectObjects(markerGroup.children, true).find((h) => h.object.userData.marker);
  if (hitsM) {
    const id = hitsM.object.userData.pieceId;
    if (selectedType) place(selectedType, id);
    else { activeConn = id; updateHint(); }
    return;
  }
  if (selectedType && ghost && ray.intersectObjects(ghostGroup.children, true).length) { place(selectedType, ghost.conn); return; }
  const hp = ray.intersectObjects(trackGroup.children, true).find((h) => h.object.userData.pieceId != null);
  if (hp && !selectedType) { selectedPiece = hp.object.userData.pieceId === 1 ? null : hp.object.userData.pieceId; highlight(); updateHint(); }
  else { selectedPiece = null; highlight(); updateHint(); }
});
function highlight() {
  trackGroup.traverse((o) => {
    if (o.isMesh && o.userData.pieceId != null && o.material?.emissive) o.material.emissive?.setHex(0);
  });
  if (selectedPiece == null) return;
  trackGroup.traverse((o) => {
    if (o.isMesh && o.userData.pieceId === selectedPiece && o.material?.emissive) {
      o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffd166); o.material.emissiveIntensity = 0.5;
    }
  });
}
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPiece != null) removePiece(selectedPiece);
  else if ((e.ctrlKey || e.metaKey) && e.key === 'z') undo();
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Escape') { selectedType = null; selectedPiece = null; hoverConn = null; refreshGhost(); updateHint(); highlight(); }
});

/* ---------------------------------------------------------------- transport UI */
const slider = $('scrub');
let scrubbing = false;
function togglePlay() {
  if (!marbles.length) { dropMarbles(1); return; }
  if (dir !== 0) { dir = 0; return; }
  if (finished && playhead >= head - 1) playhead = 0;
  dir = 1;
}
function reversePlay() {
  if (!marbles.length) return;
  if (dir === -1) { dir = 0; return; }
  if (playhead <= 0) return;
  dir = -1;
}
slider.addEventListener('pointerdown', () => { scrubbing = true; dir = 0; });
slider.addEventListener('input', () => { playhead = +slider.value; dir = 0; });
window.addEventListener('pointerup', () => { scrubbing = false; });
$('btnDrop').onclick = () => dropMarbles(1);
$('btnDrop5').onclick = () => dropMarbles(5);
$('btnPlay').onclick = togglePlay;
$('btnRev').onclick = reversePlay;
$('btnStepB').onclick = () => { dir = 0; playhead = Math.max(0, Math.floor(playhead) - 1); };
$('btnStepF').onclick = () => { dir = 0; playhead = Math.min(head, Math.floor(playhead) + 1); };
$('btnReset').onclick = () => { clearRun(); rebuild(); };
document.querySelectorAll('.spd').forEach((b) => b.onclick = () => {
  speed = +b.dataset.s;
  document.querySelectorAll('.spd').forEach((x) => x.classList.toggle('on', x === b));
});
function swatches() {
  const box = $('swatches'); box.innerHTML = '';
  PALETTE.forEach((c, i) => {
    const s = document.createElement('button');
    s.className = 'sw' + (i === colorIdx ? ' on' : ''); s.style.background = c; s.setAttribute('aria-label', 'marble colour');
    s.onclick = () => { colorIdx = i; swatches(); };
    box.appendChild(s);
  });
}
function fmt(f) { const s = f / 60; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; }
function updateTransport() {
  const has = marbles.length > 0;
  slider.max = Math.max(1, head); if (!scrubbing) slider.value = playhead;
  slider.disabled = !has;
  $('time').textContent = `${fmt(playhead)} / ${fmt(head)}`;
  $('btnPlay').textContent = dir === 1 ? '❚❚' : '▶';
  $('btnPlay').setAttribute('aria-label', dir === 1 ? 'Pause' : 'Play');
  $('btnRev').classList.toggle('on', dir === -1);
  for (const id of ['btnPlay', 'btnRev', 'btnStepB', 'btnStepF']) $(id).disabled = !has;
  slider.style.setProperty('--p', `${(playhead / Math.max(1, head)) * 100}%`);
}

/* ---------------------------------------------------------------- top bar buttons */
$('btnUndo').onclick = undo;
$('btnFrame').onclick = () => { riding = false; $('btnRide').classList.remove('on'); controls.enabled = true; frameAll(); };
$('btnHigher').onclick = raiseAll;
$('btnNew').onclick = () => { loadBuild(newBuild(9)); };
$('btnRide').onclick = () => {
  riding = !riding; $('btnRide').classList.toggle('on', riding); controls.enabled = !riding;
  if (riding && !marbles.length) toast('Drop a marble, then ride along with it!');
  if (!riding) frameAll();
};
$('btnSound').onclick = () => { soundOn = !soundOn; localStorage.setItem('marble.sound', soundOn ? '1' : '0'); $('btnSound').textContent = soundOn ? '🔊' : '🔇'; ensureAudio(); blip(600); };
$('btnSound').textContent = soundOn ? '🔊' : '🔇';

/* ---------------------------------------------------------------- library + saved runs */
function thumb(seq) {
  const b = buildFromSeq(seq), lay = computeAll(b);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const L of lay.values()) for (const s of L.smp) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
  const w = 200, h = 120, pad = 14;
  const sc = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ));
  const ox = w / 2 - ((minX + maxX) / 2) * sc, oz = h / 2 - ((minZ + maxZ) / 2) * sc;
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%">`;
  // draw high pieces last so the overall height ordering reads naturally
  const list = [...lay.values()].sort((a, c) => a.E.y - c.E.y);
  for (const L of list) {
    const d = L.smp.map((s, i) => `${i ? 'L' : 'M'}${(s.x * sc + ox).toFixed(1)} ${(s.z * sc + oz).toFixed(1)}`).join('');
    const wide = Math.max(...L.W);
    svg += `<path d="${d}" fill="none" stroke="${L.def.color}" stroke-width="${Math.max(3, wide * sc * 0.5).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${wide > 1 ? 0.6 : 1}"/>`;
  }
  return svg + '</svg>';
}
function savedRuns() { try { return JSON.parse(localStorage.getItem('marble.saved') || '[]'); } catch (_) { return []; } }
function openLibrary() {
  const box = $('libGrid'); box.innerHTML = '';
  for (const item of LIBRARY) {
    const c = document.createElement('button');
    c.className = 'lib'; c.innerHTML = `${thumb(item.seq)}<b>${item.name}</b><span>${item.blurb} · ${item.seq.length} pieces</span>`;
    c.onclick = () => { loadBuild(buildFromSeq(item.seq)); closeModals(); toast(`Loaded “${item.name}”. Press Drop marble!`); };
    box.appendChild(c);
  }
  const mine = $('mineGrid'); mine.innerHTML = '';
  const saved = savedRuns();
  $('mineHead').style.display = saved.length ? '' : 'none';
  saved.forEach((s, i) => {
    const c = document.createElement('div'); c.className = 'lib mine';
    const seq = s.build.pieces.map((p) => p.type);
    c.innerHTML = `${thumbFromBuild(s.build)}<b>${escapeHtml(s.name)}</b><span>${s.build.pieces.length} pieces</span><i class="del" title="Delete">✕</i>`;
    c.onclick = (e) => {
      if (e.target.classList.contains('del')) { const a = savedRuns(); a.splice(i, 1); localStorage.setItem('marble.saved', JSON.stringify(a)); openLibrary(); return; }
      loadBuild(JSON.parse(JSON.stringify(s.build))); closeModals();
    };
    mine.appendChild(c);
  });
  $('libModal').classList.add('on');
}
function thumbFromBuild(b) {
  const lay = computeAll(b);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const L of lay.values()) for (const s of L.smp) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
  const w = 200, h = 120, pad = 14;
  const sc = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ));
  const ox = w / 2 - ((minX + maxX) / 2) * sc, oz = h / 2 - ((minZ + maxZ) / 2) * sc;
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%">`;
  for (const L of [...lay.values()].sort((a, c) => a.E.y - c.E.y)) {
    const d = L.smp.map((s, i) => `${i ? 'L' : 'M'}${(s.x * sc + ox).toFixed(1)} ${(s.z * sc + oz).toFixed(1)}`).join('');
    svg += `<path d="${d}" fill="none" stroke="${L.def.color}" stroke-width="${Math.max(3, Math.max(...L.W) * sc * 0.5).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return svg + '</svg>';
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function closeModals() { document.querySelectorAll('.modal').forEach((m) => m.classList.remove('on')); }
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = closeModals);
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModals(); }));
$('btnLib').onclick = openLibrary;
$('btnSave').onclick = () => { $('saveName').value = ''; $('saveModal').classList.add('on'); setTimeout(() => $('saveName').focus(), 50); };
$('saveGo').onclick = () => {
  const name = $('saveName').value.trim() || `My run ${savedRuns().length + 1}`;
  const a = savedRuns(); a.unshift({ name, build: JSON.parse(JSON.stringify(build)) });
  localStorage.setItem('marble.saved', JSON.stringify(a.slice(0, 40)));
  closeModals(); toast(`Saved “${name}” in the Library.`);
};
$('saveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('saveGo').click(); });

/* ---------------------------------------------------------------- main loop */
const clock = { last: performance.now(), elapsedTime: 0, getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; this.elapsedTime += d; return d; } };
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (dir !== 0) {
    playhead += dir * speed * 60 * dt;
    if (dir < 0 && playhead <= 0) { playhead = 0; dir = 0; }
    if (dir > 0) {
      let g = 0;
      while (playhead > head && (marbles.length || spawnQueue.length) && !finished && g++ < 6) stepFrame();
      if (playhead > head) { playhead = head; if (finished || !marbles.length) dir = 0; }
    }
  }
  applyPoses();
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
    const k = 1 - Math.pow(1 - camTween.t, 3);
    camera.position.lerpVectors(camTween.from, camTween.to, k);
    controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
    if (camTween.t >= 1) camTween = null;
  }
  if (riding) updateRide(dt);
  controls.update();
  updateMarkers(clock.elapsedTime);
  updateTransport();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- boot */
async function boot() {
  await RAPIER.init();
  $('ver').textContent = `v${VERSION}`;
  resize(); buildTray(); swatches();
  let b = null;
  try { b = JSON.parse(localStorage.getItem('marble.current') || 'null'); } catch (_) { /* ignore */ }
  if (!b || !b.pieces || !b.pieces.length) b = buildFromSeq(LIBRARY[0].seq);
  build = b; rebuild(); frameAll(false);
  $('loading').remove();
  frame();
  window.__mr = {
    get state() { return { head, playhead, dir, finished, marbles: marbles.map((m) => ({ n: m.n, dead: m.dead, escaped: m.escaped, last: [...m.data.slice((m.n - 1) * 7, (m.n - 1) * 7 + 3)] })), pieces: build.pieces.length }; },
    trace(mi, step = 10) { const m = marbles[mi], o = []; for (let i = 0; i < m.n; i += step) o.push([i, ...[...m.data.slice(i * 7, i * 7 + 3)].map((v) => +v.toFixed(2))]); return o; },
    sim(n) { while (n-- > 0 && !finished && (marbles.length || spawnQueue.length)) stepFrame(); playhead = head; },
    pieces() { return [...layout.values()].map((L) => ({ id: L.id, t: L.type, e: [L.E.x, L.E.y, L.E.z].map((v) => +v.toFixed(2)), x: L.exit ? [L.exit.pos.x, L.exit.pos.y, L.exit.pos.z].map((v) => +v.toFixed(2)) : null })); },
    load(i) { loadBuild(buildFromSeq(LIBRARY[i].seq)); }, drop: dropMarbles, validateLibrary() {
      return LIBRARY.map((it) => {
        const b2 = newBuild(Math.max(3, totalDrop(it.seq) + 1.3)); const lay = new Map(); let parent = null; const bad = [];
        for (const [i, t] of it.seq.entries()) {
          if (i === 0) { b2.pieces = [{ id: 1, type: 'start', parent: null }]; }
          else { const v = validate(t, parent, lay); if (!v.ok) bad.push(`${i}:${t}:${v.msg}`); b2.pieces.push({ id: i + 1, type: t, parent }); }
          parent = i + 1; const lays = computeAll(b2); lay.clear(); lays.forEach((v2, k) => lay.set(k, v2));
        }
        return { name: it.name, bad };
      });
    }, connScreen() { const r = canvas.getBoundingClientRect(); return openConns().map((id) => { const p = layout.get(id).exit.pos.clone().project(camera); return { id, x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }); },
    place, setSel(t) { selectedType = t; refreshGhost(); updateHint(); }, get build() { return build; }, camera, playhead: (p) => { playhead = p; dir = 0; }, setDir: (d) => { dir = d; },
  };
}
boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#b00;background:#fff;padding:16px;z-index:99">${escapeHtml(String(e && e.stack || e))}</pre>`); });
