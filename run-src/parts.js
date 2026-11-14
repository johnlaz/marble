// Piece catalogue. Local frame: entry at origin, forward = +x, right = +z, up = +y.
// A piece is a centreline (samples with widths), an exit connector, and some extras.
export const HW = 0.25;      // inner half width of a normal channel
export const WT = 0.07;      // wall thickness
export const FT = 0.07;      // floor thickness
export const MR = 0.14;      // marble radius

const S = (x, y, z, w = 0.5) => ({ p: [x, y, z], w });
const line = (len, slope, w = 0.5) => [S(0, 0, 0, w), S(len, -len * slope, 0, w)];
function arc(dir, R, turn, drop, n, w = 0.5) {
  const a = [];
  for (let i = 0; i <= n; i++) {
    const th = (turn * i) / n;
    a.push(S(R * Math.sin(th), (-drop * i) / n, dir * (-R + R * Math.cos(th)), w));
  }
  return a;
}
const last = (s) => s[s.length - 1];
// banking: tilt a curve so the outer edge is higher (negative = left turn, positive = right turn)
function banks(n, deg, dir) {
  const r = (deg * Math.PI) / 180, out = [];
  for (let i = 0; i <= n; i++) out.push(-dir * r * Math.min(1, i / 3, (n - i) / 3));
  return out;
}

function plain(name, color, samples, yaw, extra = {}) {
  return { name, color, samples, exit: { p: last(samples).p, yaw }, H: 0.42, extras: [], ...extra };
}

export const ORDER = ['straight', 'long', 'left', 'right', 'steep', 'spiralL', 'spiralR', 'pegs', 'tunnel', 'boost', 'end'];

const GEN = {
  start() {
    const smp = [S(0, 0, 0, 1.0), S(0.9, -0.18, 0, 0.5), S(2.0, -0.4, 0, 0.5)];
    const H = 0.42;
    return {
      name: 'Start', color: '#f1f5f9', samples: smp, exit: { p: smp[2].p, yaw: 0 }, H,
      extras: [{ k: 'box', c: [-WT / 2, (H - FT) / 2, 0], h: [WT / 2, (H + FT) / 2, 0.5 + WT], color: '#f1f5f9' }],
      spawn: [0.5, 0.5, 0], pillars: [[0.9, -0.18, 0]],
    };
  },
  straight: () => plain('Straight', '#3b82f6', line(2, 0.2), 0),
  long: () => plain('Long', '#2563eb', line(4, 0.15), 0, { pillars: [[0, 0, 0], [2, -0.3, 0]] }),
  left: () => plain('Curve L', '#f97316', arc(1, 1.8, Math.PI / 2, 0.5, 12), Math.PI / 2, { bank: banks(12, 16, 1) }),
  right: () => plain('Curve R', '#fb923c', arc(-1, 1.8, Math.PI / 2, 0.5, 12), -Math.PI / 2, { bank: banks(12, 16, -1) }),
  steep: () => plain('Steep', '#ef4444', line(2, 0.6), 0, { pillars: [[0, 0, 0], [2, -1.2, 0]] }),
  spiralL: () => plain('Spiral L', '#a855f7', arc(1, 1.3, Math.PI * 2, 2.4, 36), 0, { pillars: [[0, 0, -1.3]], pillarTop: true, bank: banks(36, 14, 1) }),
  spiralR: () => plain('Spiral R', '#c084fc', arc(-1, 1.3, Math.PI * 2, 2.4, 36), 0, { pillars: [[0, 0, 1.3]], pillarTop: true, bank: banks(36, 14, -1) }),
  pegs() {
    const sl = 0.4, y = (x) => -x * sl;
    const smp = [S(0, 0, 0, 0.5), S(0.8, y(0.8), 0, 1.8), S(2.2, y(2.2), 0, 1.8), S(3, y(3), 0, 0.5)];
    const extras = [];
    const rows = [[1.1, [-0.5, 0, 0.5]], [1.5, [-0.25, 0.25]], [1.9, [-0.5, 0, 0.5]]];
    for (const [x, zs] of rows) for (const z of zs) extras.push({ k: 'peg', x, z, y: y(x), color: '#fde047' });
    return { ...plain('Pegs', '#14b8a6', smp, 0), extras, pillars: [[0, 0, 0], [1.5, y(1.5), 0]] };
  },
  tunnel() {
    const smp = line(2, 0.2), H = 0.62, ry = (x) => -x * 0.2 + H + 0.04;
    return {
      ...plain('Tunnel', '#22c55e', smp, 0), H,
      extras: [{ k: 'roof', a: [0.15, ry(0.15), 0], b: [1.85, ry(1.85), 0], hs: HW + WT, hh: 0.04, color: '#a7f3d0' }],
    };
  },
  boost() {
    const sl = 0.04, smp = line(2, sl), y = (x) => -x * sl;
    return {
      ...plain('Boost', '#facc15', smp, 0),
      extras: [0.55, 1.0, 1.45].map((x) => ({ k: 'chev', x, y: y(x), color: '#7c2d12' })),
      boosters: [{ a: [0.25, y(0.25), 0], b: [1.9, y(1.9), 0] }],
    };
  },
  end() {
    const H = 0.42, smp = [S(0, 0, 0, 0.5), S(0.5, -0.02, 0, 1.2), S(1.9, -0.08, 0, 1.2)];
    return {
      name: 'Catcher', color: '#ec4899', samples: smp, exit: null, H,
      extras: [{ k: 'box', c: [1.9 + WT / 2, -0.08 + (H - FT) / 2, 0], h: [WT / 2, (H + FT) / 2, 0.6 + WT], color: '#ec4899' }],
      pillars: [[0.9, -0.04, 0]],
    };
  },
};

const memo = {};
export function getDef(type) {
  if (!memo[type]) memo[type] = GEN[type]();
  return memo[type];
}

// Prebuilt runs, written as chains of pieces.
export const LIBRARY = [
  { name: 'First Roll', blurb: 'A gentle starter run', seq: ['start', 'straight', 'straight', 'right', 'straight', 'straight', 'end'] },
  { name: 'Zig-Zag Zoom', blurb: 'Left, right, left, right', seq: ['start', 'straight', 'left', 'right', 'straight', 'right', 'left', 'straight', 'left', 'right', 'straight', 'end'] },
  { name: 'Spiral Tower', blurb: 'Three big loops down', seq: ['start', 'straight', 'spiralL', 'spiralL', 'spiralL', 'straight', 'end'] },
  { name: 'Plinko Pegs', blurb: 'Bouncy peg boards', seq: ['start', 'straight', 'pegs', 'right', 'straight', 'pegs', 'left', 'straight', 'end'] },
  { name: 'Big Drop', blurb: 'Steep slides and a tunnel', seq: ['start', 'steep', 'steep', 'left', 'steep', 'tunnel', 'right', 'straight', 'end'] },
  { name: 'Rocket Run', blurb: 'Speed boosters!', seq: ['start', 'straight', 'boost', 'straight', 'left', 'left', 'straight', 'boost', 'straight', 'pegs', 'boost', 'straight', 'right', 'right', 'spiralR', 'long', 'end'] },
  { name: 'Marble Mountain', blurb: 'The big one', seq: ['start', 'straight', 'spiralL', 'tunnel', 'left', 'left', 'pegs', 'boost', 'right', 'right', 'steep', 'spiralR', 'long', 'left', 'tunnel', 'straight', 'end'] },
  { name: 'Switchback Slalom', blurb: 'Six hairpins down a hillside', seq: ['start', 'straight', 'left', 'left', 'straight', 'right', 'right', 'straight', 'left', 'left', 'straight', 'right', 'right', 'straight', 'left', 'left', 'long', 'end'] },
  { name: 'Pretzel Crossover', blurb: 'The track passes under itself', seq: ['start', 'straight', 'straight', 'left', 'left', 'left', 'straight', 'straight', 'right', 'left', 'straight', 'end'] },
  { name: 'Spiral Duet', blurb: 'Left spiral, right spiral, left spiral', seq: ['start', 'straight', 'spiralL', 'straight', 'spiralR', 'straight', 'spiralL', 'tunnel', 'end'] },
  { name: 'Peg Palace', blurb: 'Five peg boards in a row', seq: ['start', 'straight', 'pegs', 'pegs', 'left', 'pegs', 'pegs', 'right', 'pegs', 'straight', 'end'] },
  { name: 'Tunnel Express', blurb: 'Boosters and covered tunnels', seq: ['start', 'boost', 'tunnel', 'tunnel', 'boost', 'tunnel', 'left', 'tunnel', 'long', 'right', 'tunnel', 'straight', 'end'] },
  { name: 'Corkscrew Canyon', blurb: 'Steep drops into corkscrews', seq: ['start', 'steep', 'spiralL', 'steep', 'spiralR', 'steep', 'left', 'long', 'spiralL', 'end'] },
  { name: 'Grand Tour', blurb: 'One of every piece', seq: ['start', 'straight', 'boost', 'tunnel', 'spiralL', 'pegs', 'left', 'steep', 'right', 'spiralR', 'long', 'tunnel', 'left', 'left', 'pegs', 'boost', 'straight', 'right', 'steep', 'end'] },
];

export function totalDrop(seq) {
  let d = 0;
  for (const t of seq) { const e = getDef(t).exit; if (e) d -= e.p[1]; }
  return d;
}
