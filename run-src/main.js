import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { HW, WT, FT, MR, ORDER, getDef, LIBRARY, MELODIES, LIFT_H, flatten } from './parts.js';

const VERSION = '1.7';
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

function ribbonGeometry(def, samples) {
  const P = samples.map((s) => V3(s.p));
  const W = samples.map((s) => s.w);
  const H = def.H;
  const bank = samples === def.samples ? def.bank : null;
  const fr = sampleFrames(P, bank);
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
  let tm = ghostMat || trackMat(def.color);
  if (def.glow && !ghostMat) { tm = new THREE.MeshPhysicalMaterial({ color: def.color, roughness: 0.35, clearcoat: 0.4, emissive: new THREE.Color(def.color), emissiveIntensity: 0.12, side: THREE.DoubleSide }); g.userData.glowMat = tm; }
  for (const path of def.paths) {
    const rib = new THREE.Mesh(ribbonGeometry(def, path), tm);
    rib.castShadow = !ghostMat; rib.receiveShadow = !ghostMat;
    g.add(rib);
  }
  for (const e of def.extras) {
    let m = null;
    if (e.k === 'wheel') {
      m = new THREE.Group();
      const cols = ['#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
      const hr = 0.09, half = (e.R - hr) / 2;
      for (let i = 0; i < e.n; i++) {
        const a = (i / e.n) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.04, 0.44), ghostMat || trackMat(cols[i % cols.length]));
        p.position.set(Math.cos(a) * (hr + half), Math.sin(a) * (hr + half), 0); p.rotation.z = a;
        p.castShadow = !ghostMat; m.add(p);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 20).rotateX(Math.PI / 2), ghostMat || trackMat('#e2e8f0'));
      m.add(hub);
      m.position.set(...e.c); m.userData.isWheel = true;
      g.add(m); continue;
    }
    if (e.k === 'slats') continue;
    if (e.k === 'spinpost') {
      const grp = new THREE.Group(), gm = ghostMat || trackMat('#cbd5e1');
      for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10), gm); post.position.set(0, 0.25, sd * (HW + WT + 0.04)); grp.add(post); }
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, (HW + WT + 0.04) * 2, 10).rotateX(Math.PI / 2), gm); rod.position.set(0, 0.46, 0); grp.add(rod);
      grp.position.set(e.x, e.y, 0); g.add(grp); continue;
    }
    if (e.k === 'tube') {
      m = new THREE.Mesh(new THREE.CylinderGeometry(e.r + 0.03, e.r + 0.03, e.h, 32, 1, true),
        ghostMat || new THREE.MeshPhysicalMaterial({ color: e.color, transparent: true, opacity: 0.28, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      m.position.set(e.c[0], e.c[1] + e.h / 2 - 0.05, e.c[2]);
      g.add(m);
      if (!ghostMat) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(e.r + 0.03, 0.025, 8, 32).rotateX(Math.PI / 2), trackMat('#0ea5e9'));
        ring.position.set(e.c[0], e.c[1] + e.h - 0.05, e.c[2]); g.add(ring);
        const ring2 = ring.clone(); ring2.position.y = e.c[1] - 0.03; g.add(ring2);
      }
      continue;
    }
    if (e.k === 'bar') {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.44), ghostMat || trackMat(e.color));
      m.position.set(e.x, e.y + 0.015, 0); m.rotation.z = -Math.atan(e.slope);
      g.add(m); continue;
    }
    if (e.k === 'arch') {
      const grp = new THREE.Group(), gm = ghostMat || trackMat(e.color);
      for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.78, 10), gm); post.position.set(0, 0.39, sd * (HW + WT + 0.04)); grp.add(post); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, (HW + WT + 0.04) * 2 + 0.06), gm); top.position.set(0, 0.78, 0); grp.add(top);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.72), ghostMat || new THREE.MeshStandardMaterial({ color: '#fcd34d', metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide }));
      bell.position.set(0, 0.6, 0); grp.add(bell);
      grp.position.set(e.x, e.y, 0); g.add(grp); continue;
    }
    if (e.k === 'portal') {
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 12, 40).rotateY(Math.PI / 2), ghostMat || new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32).rotateY(-Math.PI / 2), ghostMat || new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      grp.add(ring, disc); grp.position.set(e.c[0] - 0.02, e.c[1] + 0.12, e.c[2]); g.add(grp); continue;
    }
    if (e.k === 'box') {
      m = new THREE.Mesh(new THREE.BoxGeometry(e.h[0] * 2, e.h[1] * 2, e.h[2] * 2), ghostMat || (e.glass ? new THREE.MeshPhysicalMaterial({ color: e.color, transparent: true, opacity: 0.3, roughness: 0.1, depthWrite: false }) : trackMat(e.color)));
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
  const paths = def.paths.map((path) => ({ smp: path.map((s) => V3(s.p).applyMatrix4(M)), W: path.map((s) => s.w) }));
  // dense polyline (≤0.25 spacing) used for collision checks between pieces
  const dense = [];
  for (const { smp, W } of paths) {
    for (let i = 0; i < smp.length - 1; i++) {
      const a = smp[i], b = smp[i + 1], d = a.distanceTo(b), k = Math.max(1, Math.ceil(d / 0.25));
      for (let j = 0; j < k; j++) dense.push({ p: a.clone().lerp(b, j / k), w: W[i] + (W[i + 1] - W[i]) * (j / k) });
    }
    dense.push({ p: smp[smp.length - 1].clone(), w: W[W.length - 1] });
  }
  for (const [x, y, z, w] of def.denseExtra) dense.push({ p: V3([x, y, z]).applyMatrix4(M), w });
  const exits = def.exits.map((e) => ({ pos: V3(e.p).applyMatrix4(M), yaw: yaw + e.yaw }));
  const lift = def.lift ? { pos: V3([def.lift.x, 0, def.lift.z]).applyMatrix4(M), y0: E.y + def.lift.y0, y1: E.y + def.lift.y1, r: def.lift.r, dir: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)) } : null;
  return {
    type, def, E: E.clone(), yaw, M, paths, smp: paths.flatMap((p) => p.smp), W: paths.flatMap((p) => p.W), dense,
    exits, exit: exits[0] || null, lift,
    sensors: def.sensors.map((s) => ({ pos: V3(s.p).applyMatrix4(M), r: s.r, kind: s.kind })),
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
  return { startY, nextId: 2, pieces: [{ id: 1, type: 'start', parent: null, ex: 0 }] };
}
function buildFromSeq(seq, melody) {
  const flat = flatten(seq);
  const b = { startY: 0, nextId: flat.length + 1, pieces: flat.map((f, i) => ({ id: i + 1, type: f.t, parent: f.parent == null ? null : f.parent + 1, ex: f.ex })) };
  if (melody) b.melody = melody;
  // choose the start height so the lowest part of the run sits about 1.0 above the table
  let lo = 1e9;
  for (const L of computeAll(b).values()) for (const d of L.dense) lo = Math.min(lo, d.p.y);
  b.startY = Math.max(3, Math.round((1.05 - lo) * 10) / 10);
  return b;
}
const _lc = new Map();
function cachedLayout(type, pos, yaw) {
  const k = type + '|' + pos.x.toFixed(4) + '|' + pos.y.toFixed(4) + '|' + pos.z.toFixed(4) + '|' + yaw.toFixed(5);
  let L = _lc.get(k);
  if (!L) { if (_lc.size > 4000) _lc.clear(); L = computeLayout(type, pos, yaw); _lc.set(k, L); }
  return L;
}
function computeAll(b) {
  const m = new Map();
  for (const p of b.pieces) {
    const par = p.parent == null ? null : m.get(p.parent);
    const ex = par ? par.exits[p.ex || 0] : null;
    const L0 = ex ? cachedLayout(p.type, ex.pos, ex.yaw) : cachedLayout(p.type, new THREE.Vector3(0, b.startY, 0), 0);
    const L = Object.create(L0); L.id = p.id; L.parent = p.parent;
    m.set(p.id, L);
  }
  return m;
}
/* Edit checks: a stitched run may already overlap itself, so an edit only fails if it creates NEW overlaps (or hits the table). */
function clashKeys(b) {
  const lay = computeAll(b), list = [...lay.values()], out = new Set();
  const bb = list.map((L) => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9, w = 0; for (const d of L.dense) { const p = d.p; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; if (d.w > w) w = d.w; } const m = 0.3 + 0.5 * w; return [x0 - m, x1 + m, y0 - m, y1 + m, z0 - m, z1 + m]; });
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = list[i], B = list[j];
    if (A.parent === B.id || B.parent === A.id) continue;
    const p = bb[i], q = bb[j];
    if (p[1] < q[0] || q[1] < p[0] || p[3] < q[2] || q[3] < p[2] || p[5] < q[4] || q[5] < p[4]) continue;
    let hit = false;
    for (const a of A.dense) { for (const c of B.dense) { const thr = 0.3 + 0.5 * Math.max(a.w, c.w); if (a.p.distanceToSquared(c.p) < thr * thr) { hit = true; break; } } if (hit) break; }
    if (hit) out.add(A.id + '-' + B.id);
  }
  return out;
}
let _oldKeys = null;
function editFault(nb) {
  for (const L of computeAll(nb).values()) for (const d of L.dense) if (d.p.y < 0.3) return GROUND_MSG;
  if (!_oldKeys) _oldKeys = clashKeys(build);
  for (const k of clashKeys(nb)) if (!_oldKeys.has(k)) return 'That would crash into another piece.';
  return null;
}
/* lifts the whole run a little if the edit only fails because it would touch the table */
function fitEdit(nb) {
  let msg = editFault(nb);
  for (let k = 0; k < 4 && msg === GROUND_MSG; k++) { nb.startY += 2; msg = editFault(nb); }
  return msg;
}
// a connection is a number: piece id * 4 + exit index
const connId = (c) => c >> 2, connEx = (c) => c & 3;
const hasChild = (id, ex = 0) => build.pieces.some((p) => p.parent === id && (p.ex || 0) === ex);
function openConns() {
  const out = [];
  for (const p of build.pieces) layout.get(p.id).exits.forEach((_, ex) => { if (!hasChild(p.id, ex)) out.push(p.id * 4 + ex); });
  return out;
}
const connExit = (c) => layout.get(connId(c))?.exits[connEx(c)];

const GROUND_MSG = 'Too low – that would hit the table. Try a flatter piece, or lift the whole run with "Higher".';
function clash(L, lay, skip) {
  for (const d of L.dense) if (d.p.y < 0.3) return GROUND_MSG;
  for (const [id, q] of lay) {
    if (id === L.id || skip?.has(id)) continue;
    for (const a of q.dense) for (const b of L.dense) {
      const thr = 0.3 + 0.5 * Math.max(a.w, b.w);
      if (a.p.distanceToSquared(b.p) < thr * thr) return 'That would crash into another piece.';
    }
  }
  return null;
}
function validate(type, conn, lay = layout) {
  const par = lay.get(connId(conn)), ex = par?.exits[connEx(conn)];
  if (!ex) return { ok: false, msg: 'That piece has no open end.' };
  const L = computeLayout(type, ex.pos, ex.yaw);
  const msg = clash(L, lay, new Set([connId(conn)]));
  return msg ? { ok: false, msg } : { ok: true, L };
}
// check a whole build (used when inserting a piece in the middle)
function validateBuild(b) {
  const lay = computeAll(b), list = [...lay.values()];
  for (const L of list) for (const d of L.dense) if (d.p.y < 0.3) return GROUND_MSG;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = list[i], B = list[j];
    if (A.parent === B.id || B.parent === A.id) continue;
    for (const a of A.dense) for (const c of B.dense) {
      const thr = 0.3 + 0.5 * Math.max(a.w, c.w);
      if (a.p.distanceToSquared(c.p) < thr * thr) return 'That would crash into another piece.';
    }
  }
  return null;
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
const hemi = new THREE.HemisphereLight(0xdbeafe, 0xe9dfc9, 0.45); scene.add(hemi);

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

/* ---------------------------------------------------------------- themes */
const THEMES = [
  { name: 'Daylight', bg: 'linear-gradient(180deg,#cfe3fb 0%,#eaf1fb 55%,#f5f1e8 100%)', table: 0xd3deec, g1: 0xaebdd2, g2: 0xbccadc, sun: 0xfff1dc, sunI: 2.1, sky: 0xdbeafe, gnd: 0xe9dfc9, hemiI: 0.45, exp: 0.82, env: 0.55 },
  { name: 'Sunset', bg: 'linear-gradient(180deg,#fdba74 0%,#fca5a5 45%,#c4b5fd 100%)', table: 0xe9c8b4, g1: 0xcfa58f, g2: 0xdbb7a2, sun: 0xffb36b, sunI: 2.3, sky: 0xffd2b0, gnd: 0xb08968, hemiI: 0.5, exp: 0.78, env: 0.4 },
  { name: 'Night', bg: 'linear-gradient(180deg,#0b1026 0%,#1a2150 60%,#2b2f6b 100%)', table: 0x1b2442, g1: 0x34406b, g2: 0x2a3558, sun: 0xaabfff, sunI: 1.3, sky: 0x5468b8, gnd: 0x1a1f3d, hemiI: 0.55, exp: 0.9, env: 0.3 },
  { name: 'Forest', bg: 'linear-gradient(180deg,#cdeac0 0%,#e6f2d6 55%,#f0ead6 100%)', table: 0xb8d4a6, g1: 0x8fb57d, g2: 0xa3c690, sun: 0xfff6d0, sunI: 2.0, sky: 0xdff3cf, gnd: 0xb9a57a, hemiI: 0.45, exp: 0.8, env: 0.5 },
];
let themeIdx = Math.max(0, Math.min(THEMES.length - 1, +(localStorage.getItem('marble.theme') || 0)));
function applyTheme() {
  const t = THEMES[themeIdx];
  document.body.style.background = t.bg;
  table.material.color.setHex(t.table);
  grid.material.color.setHex(t.g1); // single-colour grid look
  sun.color.setHex(t.sun); sun.intensity = t.sunI;
  hemi.color.setHex(t.sky); hemi.groundColor.setHex(t.gnd); hemi.intensity = t.hemiI;
  renderer.toneMappingExposure = t.exp; scene.environmentIntensity = t.env;
  document.body.classList.toggle('night', themeIdx === 2);
  $('btnTheme').title = `Scenery: ${t.name}`;
}

/* ---------------------------------------------------------------- build → scene + physics */
let world = null;
let spawnLocal = new THREE.Vector3();
let boosters = [];
let pillarMeshes = [];
let wheelMeshes = [], wheelBodies = [], wheelRec = { data: new Float32Array(4 * 512), n: 0 }, glows = [];
let lifters = [], sensors = [];
let events = [];                   // {f, kind, freq} recorded while simulating; played back as sound

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
  L.paths.forEach((path, pi) => trackPath(L, path, pi === 0 ? L.def.bank : null));
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
    } else if (e.k === 'slats') {
      // ring of vertical slats around the lift shaft, with an entry gap low on the back and an exit gap at the top front
      const N = 12;
      for (let k = 0; k < N; k++) {
        const th = (k / N) * Math.PI * 2, deg = Math.round((th * 180) / Math.PI);
        let y0 = 0, y1 = e.H + 0.4;
        if (deg === 150 || deg === 180 || deg === 210) y0 = 0.5;
        if (deg === 330 || deg === 0 || deg === 30) y1 = e.H - 0.12;
        const c = V3([e.c[0] + Math.cos(th) * (e.r + 0.04), (y0 + y1) / 2 - 0.02, e.c[2] - Math.sin(th) * (e.r + 0.04)]).applyMatrix4(L.M);
        const q = new THREE.Quaternion().setFromAxisAngle(Y, L.yaw + th);
        addBeam(c, q, [0.04, (y1 - y0) / 2, 0.1]);
      }
    }
  }
}

function trackPath(L, path, bk) {
  const P = path.smp, W = path.W, H = L.def.H, n = P.length;
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
}

function makeWheels(L) {
  const qy = new THREE.Quaternion().setFromAxisAngle(Y, L.yaw);
  for (const e of L.def.extras) {
    if (e.k !== 'wheel') continue;
    const c = V3(e.c).applyMatrix4(L.M);
    const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z).setRotation({ x: qy.x, y: qy.y, z: qy.z, w: qy.w }));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setRotation({ x: qy.x, y: qy.y, z: qy.z, w: qy.w })
      .setAngularDamping(1.5).setCanSleep(false));
    const hr = 0.09, half = (e.R - hr) / 2;
    for (let i = 0; i < e.n; i++) {
      const a = (i / e.n) * Math.PI * 2, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
      world.createCollider(RAPIER.ColliderDesc.cuboid(half, 0.02, 0.22)
        .setTranslation(Math.cos(a) * (hr + half), Math.sin(a) * (hr + half), 0).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setDensity(3).setFriction(0.4).setRestitution(0.05), body);
    }
    world.createCollider(RAPIER.ColliderDesc.ball(hr).setDensity(3), body);
    world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), anchor, body, true);
    wheelBodies.push({ body, qyInv: qy.clone().invert() });
  }
}

function rebuild({ keepCamera = true } = {}) {
  layout = computeAll(build);
  // visuals
  for (const g of [trackGroup, markerGroup]) { while (g.children.length) { const c = g.children.pop(); c.traverse((o) => { if (o.geometry && o.geometry !== CHEV) o.geometry.dispose(); }); } }
  wheelMeshes = []; glows = [];
  for (const p of build.pieces) {
    const L = layout.get(p.id);
    const g = pieceVisual(p.type);
    g.position.copy(L.E); g.rotation.y = L.yaw;
    g.userData.pieceId = p.id;
    g.traverse((o) => { o.userData.pieceId = p.id; if (o.userData.isWheel) wheelMeshes.push(o); });
    if (g.userData.glowMat) glows.push({ mat: g.userData.glowMat, c: L.sensors[0].pos.clone() });
    trackGroup.add(g);
  }
  const pillMat = new THREE.MeshStandardMaterial({ color: 0xa9b7cb, roughness: 0.6 });
  const placed = [];
  for (const p of build.pieces) {
    for (const pl of pillarsFor(layout.get(p.id))) {
      if (!layout.get(p.id).lift && placed.some((q) => Math.hypot(q.x - pl.x, q.z - pl.z) < 1.6 && Math.abs(q.y1 - pl.y1) < 2.2)) continue;
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
  boosters = []; lifters = []; sensors = []; wheelBodies = [];
  let noteIdx = 0;
  const mel = build.melody ? MELODIES[build.melody] : null;
  const scale = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880];
  for (const p of build.pieces) {
    const L = layout.get(p.id);
    trackColliders(L); boosters.push(...L.boosters);
    if (L.lift) lifters.push(L.lift);
    for (const sn of L.sensors) {
      const o = { pos: sn.pos, r2: sn.r * sn.r, kind: sn.kind, freq: 0 };
      if (sn.kind === 'note') { o.freq = mel ? mel[noteIdx % mel.length] : scale[noteIdx % scale.length]; noteIdx++; }
      sensors.push(o);
    }
    makeWheels(L);
  }
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
    const ex = connExit(id);
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 12, 40).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 16).rotateZ(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    cone.position.x = 0.05;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    g.add(ring, cone, hit);
    g.position.copy(ex.pos).add(new THREE.Vector3(0, 0.12, 0)); g.rotation.y = ex.yaw;
    g.userData = { marker: true, conn: id, ring, cone };
    hit.userData = { marker: true, conn: id };
    markerGroup.add(g); markerMeshes.push(g);
  }
  if (!openConns().includes(activeConn)) activeConn = openConns().slice(-1)[0] ?? null;
}
function updateMarkers(time) {
  for (const g of markerMeshes) {
    const act = g.userData.conn === activeConn;
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
  if (!selectedType || cid == null || !connExit(cid)) return;
  const v = validate(selectedType, cid);
  const par = connExit(cid);
  const L = v.L || computeLayout(selectedType, par.pos, par.yaw);
  const g = pieceVisual(selectedType, v.ok ? ghostOk : ghostBad);
  g.position.copy(L.E); g.rotation.y = L.yaw;
  g.traverse((o) => { o.userData.ghost = true; });
  ghostGroup.add(g);
  ghost = { conn: cid, ok: v.ok, msg: v.msg };
}

/* ---------------------------------------------------------------- marbles + recording */
const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f8fafc', 'chrome', 'rainbow', 'gold'];
let colorIdx = 1;
const marbleTex = {};
function marbleMaterial(col) {
  if (marbleTex[col]) return marbleTex[col];
  if (col === 'chrome') return (marbleTex[col] = new THREE.MeshPhysicalMaterial({ color: 0xe5e7eb, metalness: 1, roughness: 0.04, envMapIntensity: 2.2 }));
  if (col === 'gold') return (marbleTex[col] = new THREE.MeshPhysicalMaterial({ color: 0xf5c04a, metalness: 1, roughness: 0.14, envMapIntensity: 2 }));
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  if (col === 'rainbow') {
    for (let i = 0; i < 128; i++) { x.fillStyle = `hsl(${(i / 128) * 360},85%,58%)`; x.fillRect(0, i, 256, 1.2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (marbleTex[col] = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4 }));
  }
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
  marbles = []; spawnQueue = []; events = [];
  head = 0; playhead = 0; dir = 0; finished = false; calm = 0; soundF = 0;
  wheelRec.n = 0; recordWheels();
}
let soundF = 0;
function recordWheels() {
  const need = (wheelRec.n + 1) * wheelBodies.length * 4;
  if (need > wheelRec.data.length) { const d = new Float32Array(Math.max(need * 2, 4096)); d.set(wheelRec.data); wheelRec.data = d; }
  wheelBodies.forEach((w, i) => {
    const r = w.body.rotation();
    const q = w.qyInv.clone().multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    wheelRec.data.set([q.x, q.y, q.z, q.w], (wheelRec.n * wheelBodies.length + i) * 4);
  });
  wheelRec.n++;
}

function spawnMarble(col) {
  const jitter = (Math.random() - 0.5) * 0.12;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnLocal.x, spawnLocal.y, spawnLocal.z + jitter).setCcdEnabled(true).setLinearDamping(0.01).setAngularDamping(0.05));
  world.createCollider(RAPIER.ColliderDesc.ball(MR).setDensity(2).setFriction(0.5).setRestitution(0.25), body);
  const mesh = new THREE.Mesh(marbleGeo, marbleMaterial(col));
  mesh.castShadow = true; mesh.visible = false;
  marbleGroup.add(mesh);
  const m = { body, mesh, spawn: head, data: new Float32Array(7 * 256), n: 0, dead: false, escaped: false, inside: new Array(sensors.length).fill(false), cool: new Array(sensors.length).fill(0), color: col };
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
    for (const lf of lifters) {
      const dx = t.x - lf.pos.x, dz = t.z - lf.pos.z;
      if (dx * dx + dz * dz < lf.r * lf.r && t.y > lf.y0 && t.y < lf.y1 + 0.4) {
        const v = m.body.linvel();
        const up = Math.max(0, Math.min(3.2, (lf.y1 - t.y) * 7));
        if (t.y < lf.y1 - 0.03) m.body.setLinvel({ x: -dx * 5, y: Math.max(up, 0.6), z: -dz * 5 }, true);
        else {
          // at the top: hover, then roll out through the front opening
          m.body.setLinvel({ x: lf.dir.x * 2.4, y: Math.min(v.y, 0), z: lf.dir.z * 2.4 }, true);
        }
      }
    }
    for (const b of boosters) {
      const ab = b.b.clone().sub(b.a), len2 = ab.lengthSq();
      const tt = Math.max(0, Math.min(1, ((t.x - b.a.x) * ab.x + (t.y - b.a.y) * ab.y + (t.z - b.a.z) * ab.z) / len2));
      const cx = b.a.x + ab.x * tt, cy = b.a.y + ab.y * tt, cz = b.a.z + ab.z * tt;
      if ((t.x - cx) ** 2 + (t.y - cy) ** 2 + (t.z - cz) ** 2 < 0.09) {
        const d = ab.clone().normalize();
        const v = m.body.linvel();
        if (v.x * d.x + v.y * d.y + v.z * d.z < 5.4) { const k = m.body.mass() * 46 * dt; m.body.applyImpulse({ x: d.x * k, y: d.y * k, z: d.z * k }, true); }
      }
    }
  }
}

function nearCatcher(t) {
  for (const L of layout.values()) if (L.type === 'end' || L.type === 'loop') for (const d of L.dense) if ((d.p.x - t.x) ** 2 + (d.p.y - t.y) ** 2 + (d.p.z - t.z) ** 2 < 1.6) return true;
  return false;
}
function stepFrame() {
  while (spawnQueue.length && head >= spawnQueue[0].frame) { const q = spawnQueue.shift(); spawnMarble(q.color); blip(900, 0.08, 0.05); }
  for (let k = 0; k < 2; k++) { applyBoosters(1 / 120); world.step(); }
  head++;
  recordWheels();
  let moving = false;
  for (const m of marbles) {
    if (m.dead) continue;
    const t = m.body.translation();
    if (t.y < 0.26 && !m.escaped) { m.escaped = true; toast('A marble rolled off the track! Check for a gap, or finish the run with a Catcher.'); }
    if (t.y < 0.26) { m.body.setLinearDamping(1.2); m.body.setAngularDamping(1.5); }
    if (t.y < -6) { m.dead = true; world.removeRigidBody(m.body); continue; }
    record(m);
    for (let si = 0; si < sensors.length; si++) {
      const sn = sensors[si];
      const inside = (t.x - sn.pos.x) ** 2 + (t.y - sn.pos.y) ** 2 + (t.z - sn.pos.z) ** 2 < sn.r2;
      if (inside && !m.inside[si] && head - m.cool[si] > 20) {
        m.cool[si] = head;
        if (sn.kind === 'portal') {
          events.push({ f: head, kind: 'portal' });
          m.body.setTranslation({ x: spawnLocal.x, y: spawnLocal.y, z: spawnLocal.z + (Math.random() - 0.5) * 0.1 }, true);
          m.body.setLinvel({ x: 0, y: 0, z: 0 }, true); m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        } else if (sn.kind !== 'glow') events.push({ f: head, kind: sn.kind, freq: sn.freq });
      }
      m.inside[si] = inside;
    }
    const v = m.body.linvel(), sp2 = v.x * v.x + v.y * v.y + v.z * v.z;
    if (m.pv) {
      const dv = Math.hypot(v.x - m.pv[0], v.y - m.pv[1], v.z - m.pv[2]);
      // a sudden change in velocity = the marble clicked against something (gravity alone changes it by ~0.17 per frame)
      if (dv > 0.55 && head - (m.lastHit || -99) > 4) { m.lastHit = head; events.push({ f: head, kind: 'hit', v: Math.min(1, (dv - 0.55) / 3), c: m.color }); }

    }
    m.pv = [v.x, v.y, v.z];
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
    if (_p0.distanceToSquared(_p1) > 1) { m.mesh.position.copy(a < 0.5 ? _p0 : _p1); m.mesh.quaternion.copy(_q0); continue; }
    m.mesh.position.lerpVectors(_p0, _p1, a);
    m.mesh.quaternion.copy(_q0).slerp(_q1, a);
  }
  const nw = wheelMeshes.length;
  if (nw && wheelRec.n) {
    const w0 = Math.max(0, Math.min(wheelRec.n - 1, f0)), w1 = Math.max(0, Math.min(wheelRec.n - 1, f0 + 1));
    wheelMeshes.forEach((wm, i) => {
      const d = wheelRec.data;
      _q0.set(d[(w0 * nw + i) * 4], d[(w0 * nw + i) * 4 + 1], d[(w0 * nw + i) * 4 + 2], d[(w0 * nw + i) * 4 + 3]);
      _q1.set(d[(w1 * nw + i) * 4], d[(w1 * nw + i) * 4 + 1], d[(w1 * nw + i) * 4 + 2], d[(w1 * nw + i) * 4 + 3]);
      wm.quaternion.copy(_q0).slerp(_q1, a);
    });
  }
  for (const gl of glows) {
    let dmin = 9;
    for (const m of marbles) if (m.mesh.visible) dmin = Math.min(dmin, m.mesh.position.distanceTo(gl.c));
    gl.mat.emissiveIntensity = 0.12 + 1.6 * Math.max(0, 1 - dmin / 1.3) ** 1.5;
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

function tone(freq, dur, vol, type = 'sine', when = 0, partials = [[1, 1]], sweepTo = 0) {
  if (!soundOn) return; ensureAudio(); if (!actx) return;
  const t0 = actx.currentTime + when;
  for (const [mul, amp] of partials) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq * mul, t0);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo * mul, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * amp * (mix.music / 100)), t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
}
// ---- realistic marble sounds -------------------------------------------------------------
// Sound model, tuned against a recording of a real plastic marble run with glass marbles:
//  - Impact: a very short, rounded click (about 1.5-3 kHz) plus a soft body "thock" and a smooth little tail. No hard noise tick.
//  - Rolling: a continuous, dense band of noise (about 0.7-3.5 kHz) that follows speed, with fine irregular roughness – not separate ticks.
//  - A small room reverb ties it together so it sounds soothing rather than ticky.
const mix = (() => { try { return Object.assign({ hit: 70, roll: 35, music: 100 }, JSON.parse(localStorage.getItem('marble.mix') || '{}')); } catch (_) { return { hit: 70, roll: 35, music: 100 }; } })();
let masterOut = null, noiseBuf = null, roughBuf = null, rollBed = null;
function audioOut() {
  if (masterOut) return masterOut;
  const bus = actx.createGain(), comp = actx.createDynamicsCompressor(), lp = actx.createBiquadFilter();
  comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  lp.type = 'lowpass'; lp.frequency.value = 11000; lp.Q.value = 0.5;
  bus.connect(comp); comp.connect(lp); lp.connect(actx.destination);
  // short, dark room: exponentially decaying noise, low-passed by averaging
  const len = Math.floor(actx.sampleRate * 0.32), ir = actx.createBuffer(2, len, actx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let z = 0; for (let i = 0; i < len; i++) { z += ((Math.random() * 2 - 1) - z) * 0.45; d[i] = z * Math.exp(-i / (len * 0.2)) * (i < 40 ? i / 40 : 1); } }
  const conv = actx.createConvolver(), wet = actx.createGain(); conv.buffer = ir; wet.gain.value = 0.22;
  bus.connect(conv); conv.connect(wet); wet.connect(comp);
  masterOut = bus; return bus;
}
function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const n = actx.sampleRate * 2; noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function roughBuffer() {
  // smooth random 0..1 curve (about 40-80 Hz wiggle) used to make the rolling bed irregular like glass on a rough plastic track
  if (roughBuf) return roughBuf;
  const n = actx.sampleRate, d0 = new Float32Array(n); let z = 0, mx = 0.001;
  for (let i = 0; i < n; i++) { z += ((Math.random() * 2 - 1) - z) * 0.12; d0[i] = z; }
  for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d0[i]));
  roughBuf = actx.createBuffer(1, n, actx.sampleRate);
  const d = roughBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = d0[i] / mx * 0.5 + 0.5;
  return roughBuf;
}
function marbleClick(vel, color) {
  if (!soundOn || mix.hit <= 0) return; ensureAudio(); if (!actx) return;
  const t0 = actx.currentTime, out = audioOut(), vol = (0.05 + vel * 0.3) * (mix.hit / 70);
  const metal = color === 'chrome' || color === 'gold';
  const base = (metal ? 2400 : 1900) * (0.8 + Math.random() * 0.45) * (1 + vel * 0.12);
  // body "thock" (the track itself) – low, soft, short
  { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(520 * (0.85 + Math.random() * 0.3), t0); o.frequency.exponentialRampToValueAtTime(330, t0 + 0.05);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol * 0.07, t0 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + 0.06); }
  // glassy click: two close partials with a smooth tail
  const parts = metal ? [[1, 1, 0.18], [2.76, 0.4, 0.1], [4.1, 0.2, 0.06]] : [[1, 1, 0.034], [1.47, 0.55, 0.045], [2.31, 0.3, 0.022]];
  for (const [mul, amp, dur] of parts) {
    const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = base * mul;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol * amp * 0.7, t0 + 0.0009); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.01);
  }
  // very short band-limited burst gives the click its "contact" without a harsh tick
  const n = actx.createBufferSource(), g = actx.createGain(), bp = actx.createBiquadFilter();
  n.buffer = noiseBuffer(); bp.type = 'bandpass'; bp.frequency.value = base * 2.2; bp.Q.value = 0.45;
  g.gain.setValueAtTime(vol * 1.5, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.0065);
  n.connect(bp).connect(g).connect(out); n.start(t0, Math.random() * 1.5); n.stop(t0 + 0.01);
}
function ensureRollBed() {
  if (rollBed) return rollBed;
  const out = audioOut(), src = actx.createBufferSource(), bp = actx.createBiquadFilter(), lp = actx.createBiquadFilter(), g = actx.createGain(), mod = actx.createGain();
  src.buffer = noiseBuffer(); src.loop = true; bp.type = 'bandpass'; bp.Q.value = 0.9; lp.type = 'lowpass'; lp.frequency.value = 7500; lp.Q.value = 0.5;
  const rs = actx.createBufferSource(), rg = actx.createGain(); rs.buffer = roughBuffer(); rs.loop = true; rg.gain.value = 0.55; mod.gain.value = 0.45;
  rs.connect(rg); rg.connect(mod.gain);   // mod gain = 0.45 + 0.55*rough(0..1)
  g.gain.value = 0;
  const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 520; hp.Q.value = 0.6;
  src.connect(hp); hp.connect(bp); bp.connect(lp); lp.connect(mod); mod.connect(g); g.connect(out);
  src.start(); rs.start();
  rollBed = { g, bp, rs }; return rollBed;
}
function setRoll(level, speedN) {
  const b = ensureRollBed(), t = actx.currentTime;
  b.g.gain.setTargetAtTime(level, t, 0.05);
  b.bp.frequency.setTargetAtTime(1100 + speedN * 1700, t, 0.06);
  b.rs.playbackRate.setTargetAtTime(0.7 + speedN * 1.3, t, 0.06);
}
let rollPrev = new Map(), seamCarry = 0;
function updateRoll(dt) {
  if (!soundOn || !actx || actx.state !== 'running' || mix.roll <= 0 || dir === 0) { rollPrev.clear(); if (rollBed) setRoll(0, 0); return; }
  let loud = 0, cnt = 0;
  for (const m of marbles) {
    if (!m.mesh.visible) continue;
    const p = m.mesh.position, q = rollPrev.get(m);
    if (q && dt > 0) {
      const sp = Math.hypot(p.x - q.x, p.z - q.z) / dt, fall = Math.abs(p.y - q.y) / dt;
      if (sp > 0.3 && fall < sp * 1.1 + 0.4 && p.y > 0.4) { loud = Math.max(loud, Math.min(sp, 7) / 7); cnt++; }
    }
    rollPrev.set(m, p.clone());
  }
  const sp = loud * Math.max(0.35, Math.min(1.4, speed));
  setRoll(cnt ? (0.012 + Math.pow(loud, 1.3) * 0.075 * (1 + Math.min(cnt, 4) * 0.12)) * (mix.roll / 35) : 0, Math.min(1, sp));
  // faint seams/ridges in the track: soft, irregular little taps while a marble rolls
  seamCarry += cnt ? (1.5 + loud * 7) * dt * Math.max(0.35, speed) : 0;
  if (seamCarry >= 1) { seamCarry = Math.random() * 0.6; marbleClick(0.05 + loud * 0.1, 'glass'); }
}
function playEvent(ev) {
  if (ev.kind === 'hit') { marbleClick(ev.v, ev.c); return; }
  if (ev.kind === 'note') { if (ev.freq) tone(ev.freq, 0.7, 0.16, 'sine', 0, [[1, 1], [2.01, 0.28], [4.1, 0.08]]); }
  else if (ev.kind === 'bell') tone(660, 1.6, 0.11, 'sine', 0, [[1, 1], [2.76, 0.45], [5.4, 0.25], [8.9, 0.1]]);
  else if (ev.kind === 'goal') { marbleClick(0.45, ev.c); }
  else if (ev.kind === 'portal') blip(700, 0.12, 0.05);
}
function playEventsBetween(a, b) {
  // events are stored in frame order
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].f <= a) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < events.length && events[i].f <= b; i++) playEvent(events[i]);
}

/* ---------------------------------------------------------------- editing actions */
function snapshot() { undoStack.push(JSON.stringify(build)); if (undoStack.length > 60) undoStack.shift(); }
function place(type, conn) {
  const v = validate(type, conn);
  if (!v.ok) { toast(v.msg); blip(180, 0.15, 0.05); return false; }
  snapshot();
  const id = build.nextId++;
  build.pieces.push({ id, type, parent: connId(conn), ex: connEx(conn) });
  const nExits = getDef(type).exits.length;
  hoverConn = null; selectedPiece = null;
  if (!nExits) selectedType = null;
  rebuild();
  const open = openConns();
  activeConn = nExits ? id * 4 : (open.includes(conn ^ 1) ? conn ^ 1 : (open.slice(-1)[0] ?? null));
  rebuildMarkers();
  keepEndVisible();
  blip(520 + Math.random() * 80, 0.08, 0.07);
  playPlaceSound(type);
  return true;
}
function playPlaceSound(type) { if (type === 'chime') tone(523.25, 0.3, 0.07, 'sine', 0.05); }
// put a new piece into the middle of the run, just before an existing piece
function insertBefore(type, pieceId) {
  const X = build.pieces.find((p) => p.id === pieceId);
  if (!X || X.parent == null || !getDef(type).exits.length) return false;
  const saved = JSON.stringify(build);
  const nb = JSON.parse(saved);
  const nid = nb.nextId++;
  const x = nb.pieces.find((p) => p.id === pieceId);
  const np = { id: nid, type, parent: x.parent, ex: x.ex || 0 };
  x.parent = nid; x.ex = 0;
  nb.pieces.splice(nb.pieces.indexOf(x), 0, np);
  _oldKeys = null;
  const msg = fitEdit(nb);
  if (msg) { toast(msg.startsWith('Too low') ? 'No room to insert that here – lift the run with “Higher” first.' : 'That would crash into another piece.'); blip(180, 0.15, 0.05); return false; }
  snapshot(); build = nb; selectedPiece = null; selectedType = null;
  rebuild(); highlight(); blip(560, 0.08, 0.07);
  toast('Inserted! Everything after it moved along.');
  return true;
}
// if the open end drifts off-screen (or under the control bar), glide the camera back to show the whole run
function keepEndVisible() {
  if (activeConn == null || !connExit(activeConn)) return;
  const p = connExit(activeConn).pos.clone().project(camera);
  const mobile = narrow();
  if (p.z > 1 || Math.abs(p.x) > 0.82 || p.y > 0.8 || p.y < (mobile ? -0.2 : -0.6) || (!mobile && p.x < -0.72)) frameAll();
}
function removePiece(id) {
  if (id === 1) return;
  snapshot();
  const kill = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const p of build.pieces) if (!kill.has(p.id) && kill.has(p.parent)) { kill.add(p.id); grew = true; } }
  const rp = build.pieces.find((p) => p.id === id);
  build.pieces = build.pieces.filter((p) => !kill.has(p.id));
  selectedPiece = null;
  rebuild(); activeConn = rp.parent * 4 + (rp.ex || 0); rebuildMarkers(); blip(300, 0.1, 0.05);
}
function reopenEnds() {
  const ends = build.pieces.filter((p) => (p.type === 'end' || p.type === 'loop') && !hasChild(p.id));
  if (!ends.length) return;
  snapshot();
  const kill = new Set(ends.map((p) => p.id));
  build.pieces = build.pieces.filter((p) => !kill.has(p.id));
  selectedPiece = null; rebuild();
  activeConn = openConns().slice(-1)[0] ?? null; rebuildMarkers(); updateHint(); blip(420, 0.08, 0.05);
  toast('End removed. Add pieces, then close it again with a Finish piece.');
}
function undo() {
  _oldKeys = null;
  if (!undoStack.length) return;
  build = JSON.parse(undoStack.pop()); selectedPiece = null; activeConn = null; selectedType = null;
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
const tryInsert = {};
function mkChip(t, label, fn, cls) {
  const c = document.createElement('button'); c.className = 'chip' + (cls ? ' ' + cls : '');
  c.innerHTML = `${iconSvg(t)}<span>${label || getDef(t).name}</span>`;
  c.onclick = () => { ensureAudio(); fn(t); };
  return c;
}
function chipRow(label, chips) {
  const row = document.createElement('div'); row.className = 'chiprow';
  const lab = document.createElement('span'); lab.className = 'chipLab'; lab.textContent = label; row.appendChild(lab);
  chips.forEach((c) => row.appendChild(c)); return row;
}
function swapPiece(type, id) {
  const nb = JSON.parse(JSON.stringify(build)), x = nb.pieces.find((p) => p.id === id);
  if (!x) return false;
  x.type = type; _oldKeys = null;
  const msg = fitEdit(nb);
  if (msg) { toast(msg.startsWith('Too low') ? 'No room for that here – lift the run with “Higher” first.' : 'That would crash into another piece.'); blip(180, 0.15, 0.05); return false; }
  snapshot(); build = nb; selectedPiece = null; selectedType = null; rebuild(); highlight(); blip(560, 0.08, 0.07);
  toast(`Swapped to ${getDef(type).name}.`); return true;
}
/* remove only this piece and close the gap (its follower takes its place) */
function removeJustThis(id) {
  const nb = JSON.parse(JSON.stringify(build)), x = nb.pieces.find((p) => p.id === id);
  if (!x || x.parent == null) return false;
  const kids = nb.pieces.filter((p) => p.parent === id);
  if (kids.length > 1 || (kids.length === 1 && (kids[0].ex || 0) !== 0)) { toast('This piece splits the track – use “Remove it and everything after”.'); return false; }
  if (kids[0]) { kids[0].parent = x.parent; kids[0].ex = x.ex || 0; }
  nb.pieces = nb.pieces.filter((p) => p.id !== id); _oldKeys = null;
  const msg = fitEdit(nb);
  if (msg) { toast('The pieces after it would not line up there. Try “Swap” instead.'); blip(180, 0.15, 0.05); return false; }
  snapshot(); build = nb; selectedPiece = null; rebuild(); highlight(); blip(300, 0.1, 0.05);
  toast('Piece removed and the gap closed.'); return true;
}
function renderChips() {
  const box = $('chips'); box.innerHTML = '';
  if (selectedType || drag?.active) { box.style.display = 'none'; return; }
  _oldKeys = null;
  if (selectedPiece != null) {
    const X = build.pieces.find((p) => p.id === selectedPiece);
    if (!X) { box.style.display = 'none'; return; }
    const used = Math.max(-1, ...build.pieces.filter((p) => p.parent === X.id).map((p) => p.ex || 0)) + 1;
    const ins = [], swp = [];
    for (const t of ORDER) {
      if (getDef(t).exits.length) {
        const nb = JSON.parse(JSON.stringify(build)), nid = nb.nextId++, x = nb.pieces.find((p) => p.id === selectedPiece);
        nb.pieces.splice(nb.pieces.indexOf(x), 0, { id: nid, type: t, parent: x.parent, ex: x.ex || 0 }); x.parent = nid; x.ex = 0;
        if (!fitEdit(nb)) ins.push(mkChip(t, null, (tt) => insertBefore(tt, selectedPiece)));
      }
      if (t !== X.type && getDef(t).exits.length >= used) {
        const nb = JSON.parse(JSON.stringify(build)); nb.pieces.find((p) => p.id === selectedPiece).type = t;
        if (!fitEdit(nb)) swp.push(mkChip(t, null, (tt) => swapPiece(tt, selectedPiece)));
      }
    }
    if (!ins.length && !swp.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    if (ins.length) box.appendChild(chipRow('Add before it:', ins));
    if (swp.length) box.appendChild(chipRow('Swap it for:', swp));
    return;
  }
  const list = [];
  if (activeConn == null) { box.style.display = 'none'; return; }
  for (const t of ORDER) if (validate(t, activeConn).ok) list.push(t);
  if (!list.length || list.length === ORDER.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  box.appendChild(chipRow('Fits here:', list.map((t) => mkChip(t, null, (tt) => place(tt, activeConn)))));
}
function updateHint() {
  const h = $('hintText'), btn = $('hintBtn');
  btn.style.display = 'none'; $('hintBtn2').style.display = 'none';
  const name = selectedType ? getDef(selectedType).name : '';
  renderChips();
  if (selectedPiece != null) {
    h.textContent = 'Piece selected. Add a piece before it, swap it, or remove it.'; btn.style.display = ''; btn.textContent = 'Remove it and everything after';
    btn.onclick = () => removePiece(selectedPiece);
    const b2 = $('hintBtn2'); b2.style.display = ''; b2.textContent = 'Remove just this piece'; b2.onclick = () => removeJustThis(selectedPiece);
  } else if (selectedType) {
    h.textContent = ghost && !ghost.ok ? ghost.msg : `Tap a glowing ring to add a ${name}. Tap the piece again to cancel.`;
  } else if (!openConns().length) {
    const ends = build.pieces.filter((p) => (p.type === 'end' || p.type === 'loop') && !hasChild(p.id));
    h.textContent = 'This run is closed. Press Drop marble, or reopen the end to keep building.';
    if (ends.length) { btn.style.display = ''; btn.textContent = 'Reopen the end'; btn.onclick = reopenEnds; }
  } else {
    h.textContent = 'Tap a suggested piece, or pick one and tap a glowing ring – or drag it right onto one.';
  }
  const last = build.pieces[build.pieces.length - 1];
  $('stats').textContent = `${build.pieces.length} pieces`;
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.type === selectedType));
}

/* ---------------------------------------------------------------- tray */
function iconSvg(type) {
  const def = getDef(type);
  const paths = def.paths.map((p) => p.map((s) => [s.p[0], s.p[2]]));
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const pts of paths) for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const wx = Math.max(0.6, maxX - minX), wz = Math.max(0.6, maxZ - minZ);
  const sc = Math.min(44 / wx, 30 / wz);
  const ox = 30 - ((minX + maxX) / 2) * sc, oz = 21 - ((minZ + maxZ) / 2) * sc;
  const d = paths.map((pts) => pts.map(([x, z], i) => `${i ? 'L' : 'M'}${(x * sc + ox).toFixed(1)} ${(z * sc + oz).toFixed(1)}`).join('')).join('');
  let extra = '';
  for (const e of def.extras) if (e.k === 'wheel') extra += `<circle cx="${(e.c[0] * sc + ox).toFixed(1)}" cy="${(e.c[2] * sc + oz).toFixed(1)}" r="${(e.R * sc).toFixed(1)}" fill="#f9a8d4" opacity=".8"/>`;
  if (def.lift) extra += `<circle cx="${(def.lift.x * sc + ox).toFixed(1)}" cy="${(def.lift.z * sc + oz).toFixed(1)}" r="${(0.32 * sc).toFixed(1)}" fill="#bae6fd" stroke="#0ea5e9" stroke-width="1.5"/>`;
  if (def.sensors.some((q) => q.kind === 'note')) for (const q of def.sensors) extra += `<circle cx="${(q.p[0] * sc + ox).toFixed(1)}" cy="${(q.p[2] * sc + oz).toFixed(1)}" r="1.8" fill="#fff"/>`;
  if (def.sensors.some((q) => q.kind === 'bell')) extra += `<circle cx="${(def.sensors[0].p[0] * sc + ox).toFixed(1)}" cy="${(def.sensors[0].p[2] * sc + oz).toFixed(1)}" r="3" fill="#92400e"/>`;
  if (def.sensors.some((q) => q.kind === 'portal')) extra += `<circle cx="${(def.sensors[0].p[0] * sc + ox).toFixed(1)}" cy="${(def.sensors[0].p[2] * sc + oz).toFixed(1)}" r="4" fill="none" stroke="#06b6d4" stroke-width="2"/>`;
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
    const p = connExit(id).pos.clone().project(camera);
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
    const id = hitsM.object.userData.conn;
    if (selectedType) place(selectedType, id);
    else { activeConn = id; updateHint(); }
    return;
  }
  if (selectedType && ghost && ray.intersectObjects(ghostGroup.children, true).length) { place(selectedType, ghost.conn); return; }
  const hp = ray.intersectObjects(trackGroup.children, true).find((h) => h.object.userData.pieceId != null);
  if (hp && !selectedType) { selectedPiece = hp.object.userData.pieceId === 1 ? null : (selectedPiece === hp.object.userData.pieceId ? null : hp.object.userData.pieceId); highlight(); updateHint(); }
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
$('btnReset').onclick = () => { clearRun(); rebuild(); };
document.querySelectorAll('.spd').forEach((b) => b.onclick = () => {
  speed = +b.dataset.s;
  document.querySelectorAll('.spd').forEach((x) => x.classList.toggle('on', x === b));
});
function swatches() {
  const box = $('swatches'); box.innerHTML = '';
  PALETTE.forEach((c, i) => {
    const s = document.createElement('button');
    s.className = 'sw' + (i === colorIdx ? ' on' : ''); s.setAttribute('aria-label', 'marble colour');
    s.style.background = c === 'chrome' ? 'radial-gradient(circle at 35% 30%,#fff,#9ca3af 55%,#374151)' : c === 'gold' ? 'radial-gradient(circle at 35% 30%,#fff7d1,#f5c04a 50%,#92641a)' : c === 'rainbow' ? 'conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)' : c;
    s.onclick = () => { colorIdx = i; swatches(); };
    box.appendChild(s);
  });
}
$('spdCycle').onclick = () => { const order = [1, 2, 0.5, 0.25]; speed = order[(order.indexOf(speed) + 1) % 4]; $('spdCycle').textContent = speed === 0.25 ? '¼×' : speed === 0.5 ? '½×' : speed + '×'; document.querySelectorAll('.spd[data-s]').forEach((x) => x.classList.toggle('on', +x.dataset.s === speed)); };
function fmt(f) { const s = f / 60; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; }
function updateTransport() {
  const has = marbles.length > 0;
  slider.max = Math.max(1, head); if (!scrubbing) slider.value = playhead;
  slider.disabled = !has;
  $('time').textContent = `${fmt(playhead)} / ${fmt(head)}`;
  $('btnPlay').textContent = dir === 1 ? '❚❚' : '▶';
  $('btnPlay').setAttribute('aria-label', dir === 1 ? 'Pause' : 'Play');
  $('btnRev').classList.toggle('on', dir === -1);
  for (const id of ['btnPlay', 'btnRev']) $(id).disabled = !has;
  slider.style.setProperty('--p', `${(playhead / Math.max(1, head)) * 100}%`);
}

/* hide / show all the controls so a run can be watched full screen */
$('uiToggle').onclick = () => {
  const off = !document.body.classList.contains('clean');
  document.body.classList.toggle('clean', off);
  $('uiToggle').textContent = off ? '☰' : '👁'; $('uiToggle').title = off ? 'Show controls' : 'Hide controls';
};
/* ---------------------------------------------------------------- top bar buttons */
$('btnUndo').onclick = undo;
$('btnFrame').onclick = () => { riding = false; ['btnRide', 'btnRide2'].forEach((i) => $(i).classList.remove('on')); $('btnRide2').textContent = '🎥'; controls.enabled = true; frameAll(); };
$('btnHigher').onclick = raiseAll;
$('btnNew').onclick = () => { loadBuild(newBuild(9)); };
function setRide(on) {
  riding = on; ['btnRide', 'btnRide2'].forEach((i) => $(i).classList.toggle('on', riding)); controls.enabled = !riding;
  $('btnRide2').textContent = riding ? '🌍' : '🎥'; $('btnRide2').title = riding ? 'Back to the whole run' : 'Ride along with the marble';
  if (riding && !marbles.length) toast('Drop a marble, then ride along with it!');
  if (!riding) frameAll(); /* leaving ride always pulls back to the whole run */
}
$('btnRide').onclick = () => setRide(!riding);
$('btnRide2').onclick = () => setRide(!riding);
const MIX_DEFAULTS = { hit: 70, roll: 35, music: 100 };
function showMix(k) { const el = $('mix_' + k); $('mixv_' + k).textContent = Math.round(mix[k] / (+el.max) * 100) + '%'; el.style.setProperty('--p', (mix[k] / (+el.max) * 100) + '%'); }
$('btnMix').onclick = () => { for (const k of ['hit', 'roll', 'music']) { $('mix_' + k).value = mix[k]; showMix(k); } $('mixModal').classList.add('on'); };
$('mixReset').onclick = () => { for (const k of ['hit', 'roll', 'music']) { mix[k] = MIX_DEFAULTS[k]; $('mix_' + k).value = mix[k]; showMix(k); } localStorage.setItem('marble.mix', JSON.stringify(mix)); marbleClick(0.6); };
for (const k of ['hit', 'roll', 'music']) $('mix_' + k).oninput = (e) => { mix[k] = +e.target.value; showMix(k); localStorage.setItem('marble.mix', JSON.stringify(mix)); if (k === 'hit') marbleClick(0.6); if (k === 'music') tone(523.25, 0.5, 0.16, 'sine', 0, [[1, 1], [2.01, 0.28]]); };
$('btnSound').onclick = () => { soundOn = !soundOn; localStorage.setItem('marble.sound', soundOn ? '1' : '0'); $('btnSound').textContent = soundOn ? '🔊' : '🔇'; ensureAudio(); blip(600); };
$('btnSound').textContent = soundOn ? '🔊' : '🔇';
$('btnTheme').onclick = () => { themeIdx = (themeIdx + 1) % THEMES.length; localStorage.setItem('marble.theme', themeIdx); applyTheme(); toast(`Scenery: ${THEMES[themeIdx].name}`); };

/* ---------------------------------------------------------------- library + saved runs */
function thumb(seq) {
  const b = typeof seq.pieces === 'object' && !Array.isArray(seq) ? seq : buildFromSeq(seq), lay = computeAll(b);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const L of lay.values()) for (const s of L.smp) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
  const w = 200, h = 120, pad = 14;
  const sc = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ));
  const ox = w / 2 - ((minX + maxX) / 2) * sc, oz = h / 2 - ((minZ + maxZ) / 2) * sc;
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%">`;
  // draw high pieces last so the overall height ordering reads naturally
  const list = [...lay.values()].sort((a, c) => a.E.y - c.E.y);
  for (const L of list) {
    const wide = Math.max(...L.W);
    for (const pth of L.paths) {
      const d = pth.smp.map((s, i) => `${i ? 'L' : 'M'}${(s.x * sc + ox).toFixed(1)} ${(s.z * sc + oz).toFixed(1)}`).join('');
      svg += `<path d="${d}" fill="none" stroke="${L.def.color}" stroke-width="${Math.max(3, wide * sc * 0.5).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${wide > 1 ? 0.6 : 1}"/>`;
    }
  }
  return svg + '</svg>';
}

/* ---------------------------------------------------------------- stitch several library runs into one */
const STITCH_MAX = 6;
const MIRROR = { left: 'right', right: 'left', spiralL: 'spiralR', spiralR: 'spiralL' };
const mirrorSeq = (seq) => seq.map((it) => (typeof it === 'string' ? (MIRROR[it] || it) : it.map(mirrorSeq)));
function appendSeq(seq, tail) {
  // continue a run from its finish: replace the final 'end' (or drop a final 'loop'); after a splitter the first branch carries on
  const out = seq.slice(), last = out[out.length - 1];
  if (Array.isArray(last)) { out[out.length - 1] = last.map((br, k) => (k === 0 ? appendSeq(br, tail) : br)); return out; }
  if (last === 'end' || last === 'loop') out.pop();
  return out.concat(tail);
}
function clashPairs(b) {
  const list = [...computeAll(b).values()]; let n = 0;
  for (const L of list) for (const d of L.dense) if (d.p.y < 0.3) { n += 1; break; }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = list[i], B = list[j];
    if (A.parent === B.id || B.parent === A.id) continue;
    let hit = false;
    for (const a of A.dense) { for (const c of B.dense) { const thr = 0.3 + 0.5 * Math.max(a.w, c.w); if (a.p.distanceToSquared(c.p) < thr * thr) { hit = true; break; } } if (hit) break; }
    if (hit) n++;
  }
  return n;
}
function stitchItems(items) {
  // each run is added either as-is or mirrored (left<->right), whichever crosses itself least
  let seq = items[0].seq.slice(), melody = items[0].melody;
  for (let k = 1; k < items.length; k++) {
    const tail = items[k].seq.slice(1);               // drop that run's 'start'
    const a = appendSeq(seq, tail), m = appendSeq(seq, mirrorSeq(tail));
    const ca = clashPairs(buildFromSeq(a)), cm = clashPairs(buildFromSeq(m));
    seq = cm < ca ? m : a;
    melody = melody || items[k].melody;
  }
  return { seq, melody };
}
function askConfirm(title, body, okLabel, onOk) {
  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:20px';
  o.innerHTML = `<div style="background:#fff;color:#0f172a;border-radius:20px;padding:20px;max-width:340px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:inherit"><div style="font-weight:800;font-size:18px;margin-bottom:6px"></div><div style="font-size:14px;opacity:.75;margin-bottom:16px"></div><div style="display:flex;gap:10px"><button style="flex:1;padding:13px;border-radius:12px;background:#e2e8f0;font-weight:800;font-size:15px">Keep it</button><button style="flex:1;padding:13px;border-radius:12px;background:#ef4444;color:#fff;font-weight:800;font-size:15px"></button></div></div>`;
  const d = o.firstChild.children; d[0].textContent = title; d[1].textContent = body;
  const b = d[2].children; b[1].textContent = okLabel;
  b[0].onclick = () => o.remove(); b[1].onclick = () => { o.remove(); onOk(); };
  o.onclick = (e) => { if (e.target === o) o.remove(); };
  document.body.appendChild(o);
}
function savedRuns() { try { return JSON.parse(localStorage.getItem('marble.saved') || '[]'); } catch (_) { return []; } }
let stitchMode = false, stitchSel = [];
function updateStitchBar() {
  const bar = $('stitchBar'); bar.style.display = stitchMode ? '' : 'none';
  $('btnStitch').classList.toggle('on', stitchMode);
  $('stitchInfo').textContent = stitchSel.length ? `${stitchSel.length} of ${STITCH_MAX} picked` : `Tap runs in the order you want them (up to ${STITCH_MAX})`;
  $('stitchGo').disabled = stitchSel.length < 2;
  $('stitchClear').style.visibility = stitchSel.length ? 'visible' : 'hidden';
  document.querySelectorAll('#libGrid .lib').forEach((c, i) => {
    const n = stitchSel.indexOf(i); c.classList.toggle('sel', stitchMode && n >= 0);
    const badge = c.querySelector('.pick'); if (badge) badge.textContent = stitchMode && n >= 0 ? n + 1 : '';
  });
  $('mineHead').style.display = !stitchMode && savedRuns().length ? '' : 'none'; $('mineGrid').style.display = stitchMode ? 'none' : '';
}
function openLibrary() {
  const box = $('libGrid'); box.innerHTML = ''; if ($('bkInfo')) bkInfo();
  LIBRARY.forEach((item, idx) => {
    const c = document.createElement('button');
    const bld = buildFromSeq(item.seq, item.melody);
    c.className = 'lib'; c.innerHTML = `<i class="pick"></i>${thumb(bld)}<b>${item.name}</b><span>${item.blurb} · ${bld.pieces.length} pieces</span>`;
    c.onclick = () => {
      if (stitchMode) {
        const at = stitchSel.indexOf(idx);
        if (at >= 0) stitchSel.splice(at, 1); else if (stitchSel.length < STITCH_MAX) stitchSel.push(idx); else toast(`You can stitch up to ${STITCH_MAX} runs.`);
        updateStitchBar(); return;
      }
      loadBuild(buildFromSeq(item.seq, item.melody)); closeModals(); toast(`Loaded “${item.name}”. Press Drop marble!`);
    };
    box.appendChild(c);
  });
  const mine = $('mineGrid'); mine.innerHTML = '';
  const saved = savedRuns();
  $('mineHead').style.display = saved.length ? '' : 'none';
  saved.forEach((s, i) => {
    const c = document.createElement('div'); c.className = 'lib mine';
    c.innerHTML = `${thumbFromBuild(s.build)}<b>${escapeHtml(s.name)}</b><span>${s.build.pieces.length} pieces</span><i class="del" title="Delete">✕</i>`;
    c.onclick = (e) => {
      if (e.target.classList.contains('del')) { e.stopPropagation(); askConfirm(`Delete “${s.name}”?`, 'This saved run will be removed from this device. Back it up first if you want a copy.', 'Delete', () => { const a = savedRuns(); a.splice(i, 1); localStorage.setItem('marble.saved', JSON.stringify(a)); openLibrary(); toast('Deleted.'); }); return; }
      loadBuild(JSON.parse(JSON.stringify(s.build))); closeModals();
    };
    mine.appendChild(c);
  });
  $('libModal').classList.add('on'); updateStitchBar();
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
    for (const pth of L.paths) {
      const d = pth.smp.map((s, i) => `${i ? 'L' : 'M'}${(s.x * sc + ox).toFixed(1)} ${(s.z * sc + oz).toFixed(1)}`).join('');
      svg += `<path d="${d}" fill="none" stroke="${L.def.color}" stroke-width="${Math.max(3, Math.max(...L.W) * sc * 0.5).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  return svg + '</svg>';
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function closeModals() { document.querySelectorAll('.modal').forEach((m) => m.classList.remove('on')); }
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = closeModals);
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModals(); }));
/* back-button guard: back closes a menu first, then asks once before leaving */
(() => {
  let armed = 0;
  try { history.pushState({ mr: 1 }, ''); } catch (e) {}
  const onBack = () => {
    try { history.pushState({ mr: 1 }, ''); } catch (e) {}
    if (document.querySelector('.modal.on')) { closeModals(); return; }
    if (Date.now() - armed < 2500) { armed = 0; window.removeEventListener('popstate', onBack); history.go(-2); return; }
    armed = Date.now(); toast('Press back again to leave the game');
  };
  window.addEventListener('popstate', onBack);
})();
$('btnLib').onclick = () => { stitchMode = false; stitchSel = []; openLibrary(); };
$('btnStitch').onclick = () => { stitchMode = !stitchMode; if (!stitchMode) stitchSel = []; updateStitchBar(); };
$('stitchClear').onclick = () => { stitchSel = []; updateStitchBar(); };
$('stitchRandom').onclick = () => {
  const n = 5 + Math.floor(Math.random() * 2), ids = LIBRARY.map((_, i) => i);
  let best = null, bestBad = 1e9;
  for (let t = 0; t < 12; t++) {
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const pick = ids.slice(0, Math.min(n, ids.length)), r = stitchItems(pick.map((i) => LIBRARY[i])), bad = clashPairs(buildFromSeq(r.seq, r.melody)) || 0;
    if (bad < bestBad) { bestBad = bad; best = pick.slice(); if (!bad) break; }
  }
  stitchSel = best; stitchGo();
};
function stitchGo() {
  if (stitchSel.length < 2) return;
  const items = stitchSel.map((i) => LIBRARY[i]), r = stitchItems(items), b = buildFromSeq(r.seq, r.melody);
  const bad = clashPairs(b);
  closeModals(); stitchMode = false; stitchSel = []; loadBuild(b);
  setTimeout(() => toast(`Stitched ${items.length} runs into one: ${b.pieces.length} pieces.` + (bad ? ' A few pieces overlap – try a different order if marbles get stuck.' : ' Press Drop marble!')), 120);
}
$('stitchGo').onclick = stitchGo;
/* ---- backup / restore (saved runs live only in this browser, so a file copy is the safe way to keep them) ---- */
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
function bkInfo() {
  const n = savedRuns().length, t = +localStorage.getItem('marble.lastBackup') || 0;
  $('bkInfo').textContent = `${n} saved run${n === 1 ? '' : 's'} · ` + (t ? 'last backup ' + new Date(t).toLocaleDateString() : 'not backed up yet');
}
$('btnBackup').onclick = async () => {
  const data = JSON.stringify({ app: 'marble-run', version: 1, saved: savedRuns(), when: new Date().toISOString() });
  const file = new File([data], 'marble-run-backup.json', { type: 'application/json' });
  try {
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Marble Run backup' }); shared = true; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (!shared) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000); }
    localStorage.setItem('marble.lastBackup', Date.now()); bkInfo(); toast(shared ? 'Backup ready. Keep the file somewhere safe.' : 'Backup saved to your Downloads folder.');
  } catch (e) { toast('Could not make the backup.'); }
};
$('btnRestore').onclick = () => $('fileRestore').click();
$('fileRestore').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.app !== 'marble-run' || !Array.isArray(d.saved)) throw new Error('bad');
    const have = savedRuns(), seen = new Set(have.map((x) => x.name + JSON.stringify(x.build)));
    let added = 0;
    for (const r of d.saved) { if (r && r.build && Array.isArray(r.build.pieces) && !seen.has(String(r.name) + JSON.stringify(r.build))) { have.push({ name: String(r.name || 'Restored run').slice(0, 60), build: r.build }); seen.add(String(r.name) + JSON.stringify(r.build)); added++; } }
    localStorage.setItem('marble.saved', JSON.stringify(have.slice(0, 200))); openLibrary(); bkInfo();
    toast(added ? `Restored ${added} run${added === 1 ? '' : 's'}.` : 'Everything in that file is already here.');
  } catch (err) { toast('That is not a Marble Run backup file.'); }
};
$('btnSave').onclick = () => { $('saveName').value = ''; $('saveModal').classList.add('on'); setTimeout(() => $('saveName').focus(), 50); };
$('saveGo').onclick = () => {
  const name = $('saveName').value.trim() || `My run ${savedRuns().length + 1}`;
  const a = savedRuns(); a.unshift({ name, build: JSON.parse(JSON.stringify(build)) });
  localStorage.setItem('marble.saved', JSON.stringify(a.slice(0, 200)));
  closeModals(); toast(`Saved “${name}” in the Library.` + (a.length % 5 === 0 ? ' Tip: Library → Back up keeps a copy.' : ''));
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
  updateRoll(dt);
  if (document.body.classList.contains('riding') !== riding) document.body.classList.toggle('riding', riding);
  const nf = Math.floor(playhead);
  if (dir > 0 && nf > soundF && nf - soundF < 40) playEventsBetween(soundF, nf);
  soundF = nf;
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
  resize(); buildTray(); swatches(); applyTheme();
  const measure = () => { document.documentElement.style.setProperty('--top-h', $('top').offsetHeight + 'px'); document.documentElement.style.setProperty('--bar-h', $('bar').offsetHeight + 'px'); };
  measure(); new ResizeObserver(measure).observe($('bar')); new ResizeObserver(measure).observe($('top'));
  let b = null;
  try { b = JSON.parse(localStorage.getItem('marble.current') || 'null'); } catch (_) { /* ignore */ }
  if (!b || !b.pieces || !b.pieces.length) b = buildFromSeq(LIBRARY[0].seq);
  else if (!b.pieces.every((p) => typeof p.type === 'string' && (p.parent == null || b.pieces.some((q) => q.id === p.parent)))) b = buildFromSeq(LIBRARY[0].seq);
  build = b; rebuild(); frameAll(false);
  $('loading').remove();
  frame();
  window.__mr = {
    get state() { return { head, playhead, dir, finished, marbles: marbles.map((m) => ({ n: m.n, dead: m.dead, escaped: m.escaped, last: [...m.data.slice((m.n - 1) * 7, (m.n - 1) * 7 + 3)] })), pieces: build.pieces.length }; },
    trace(mi, step = 10) { const m = marbles[mi], o = []; for (let i = 0; i < m.n; i += step) o.push([i, ...[...m.data.slice(i * 7, i * 7 + 3)].map((v) => +v.toFixed(2))]); return o; },
    sim(n) { while (n-- > 0 && !finished && (marbles.length || spawnQueue.length)) stepFrame(); playhead = head; },
    pieces() { return [...layout.values()].map((L) => ({ id: L.id, t: L.type, e: [L.E.x, L.E.y, L.E.z].map((v) => +v.toFixed(2)), x: L.exits.map((q) => [q.pos.x, q.pos.y, q.pos.z].map((v) => +v.toFixed(2))) })); },
    stitch(idx) { const items = idx.map((i) => LIBRARY[i]), r = stitchItems(items), b = buildFromSeq(r.seq, r.melody); loadBuild(b); return { pieces: b.pieces.length, clashes: clashPairs(b) }; },
    select(id) { selectedPiece = id; highlight(); updateHint(); },
    load(i) { loadBuild(buildFromSeq(LIBRARY[i].seq, LIBRARY[i].melody)); }, drop: dropMarbles, validateLibrary() {
      return LIBRARY.map((it) => {
        const full = buildFromSeq(it.seq, it.melody);
        const b2 = { startY: full.startY, nextId: 2, pieces: [] }; let lay = new Map(); const bad = [];
        for (const p of full.pieces) {
          if (p.parent != null) { const v = validate(p.type, p.parent * 4 + p.ex, lay); if (!v.ok) bad.push(`${p.id}:${p.type}:${v.msg}`); }
          b2.pieces.push(p); lay = computeAll(b2);
        }
        return { name: it.name, bad };
      });
    }, connScreen() { const r = canvas.getBoundingClientRect(); return openConns().map((id) => { const p = connExit(id).pos.clone().project(camera); return { id, x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }); },
    events: () => events, wheelRec: () => ({ n: wheelRec.n, wheels: wheelBodies.length }), wheelAng: (w, step) => { const o = []; for (let f = 0; f < wheelRec.n; f += step) { const k = (f * wheelBodies.length + w) * 4; o.push(+(2 * Math.atan2(wheelRec.data[k + 2], wheelRec.data[k + 3])).toFixed(2)); } return o; }, insertBefore, validateBuild, openConns: () => openConns(),
    loadSeq(seq, mel) { loadBuild(buildFromSeq(seq, mel)); }, controls, place, setSel(t) { selectedType = t; refreshGhost(); updateHint(); }, get build() { return build; }, camera, playhead: (p) => { playhead = p; dir = 0; }, setDir: (d) => { dir = d; },
  };
}
boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#b00;background:#fff;padding:16px;z-index:99">${escapeHtml(String(e && e.stack || e))}</pre>`); });
