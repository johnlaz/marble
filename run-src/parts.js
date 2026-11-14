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

export const ORDER = ['straight', 'long', 'left', 'right', 'steep', 'spiralL', 'spiralR', 'pegs', 'tunnel', 'boost', 'splitter', 'wheel', 'lift', 'chime', 'bell', 'glow', 'end', 'loop'];
export const LIFT_H = 2.4;

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

  splitter() {
    const ease = (t) => t * t * (3 - 2 * t);
    const trunk = [S(0, 0, 0, 0.5), S(0.8, -0.16, 0, 0.5), S(1.3, -0.26, 0, 1.0)];
    const br = (sd) => {
      const a = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10, x = 1.3 + 1.5 * t; a.push(S(x, -0.26 - 0.2 * (x - 1.3) - 0.0, sd * (0.25 + 0.55 * ease(t)), 0.5)); }
      return a;
    };
    const A = br(-1), B = br(1);
    return {
      name: 'Splitter', color: '#06b6d4', samples: trunk, paths: [trunk, A, B], H: 0.42, extras: [],
      exit: { p: last(A).p, yaw: 0 }, exits: [{ p: last(A).p, yaw: 0 }, { p: last(B).p, yaw: 0 }],
      pillars: [[0.6, -0.12, 0], [2.2, -0.53, -0.7], [2.2, -0.53, 0.7]],
    };
  },
  wheel() {
    const A = [S(0, 0, 0, 0.5), S(0.9, -0.12, 0, 0.5)];
    // marbles drop onto the wheel, or slip past it, and land in the sloping channel below
    const B = [S(0.7, -1.2, 0, 0.5), S(2.2, -1.47, 0, 0.5), S(3.0, -1.62, 0, 0.5)];
    const zs = HW + WT / 2;
    return {
      name: 'Paddle Wheel', color: '#f472b6', samples: A, paths: [A, B], H: 0.42,
      exit: { p: last(B).p, yaw: 0 },
      extras: [
        { k: 'box', c: [0.66, -0.66, 0], h: [0.04, 0.6, 0.3], color: '#f9a8d4' },
        { k: 'box', c: [1.5, -0.7, -zs], h: [0.85, 0.77, WT / 2], color: '#f9a8d4', glass: true },
        { k: 'box', c: [1.5, -0.7, zs], h: [0.85, 0.77, WT / 2], color: '#f9a8d4', glass: true },
        { k: 'wheel', c: [1.5, -0.5, 0], R: 0.5, n: 6 },
      ],
      pillars: [[0.4, -0.06, 0], [2.7, -1.55, 0]],
      denseExtra: [[1.5, -0.5, 0, 0.6], [1.5, -1.0, 0, 0.6]],
    };
  },
  lift() {
    const H = LIFT_H, ax = 1.35, r = 0.32;
    const A = [S(0, 0, 0, 0.5), S(1.0, -0.05, 0, 0.5)];
    const B = [S(ax + 0.2, H - 0.06, 0, 0.5), S(ax + 1.05, H - 0.23, 0, 0.5)];
    const dx = [];
    for (let y = 0; y <= H + 0.01; y += 0.3) dx.push([ax, y, 0, 0.7]);
    return {
      name: 'Lift', color: '#38bdf8', samples: A, paths: [A, B], H: 0.42,
      exit: { p: last(B).p, yaw: 0 },
      extras: [
        { k: 'box', c: [ax, -0.05 - FT / 2, 0], h: [0.45, FT / 2, 0.38], color: '#38bdf8' },
        { k: 'tube', c: [ax, 0, 0], r, h: H + 0.3, color: '#bae6fd' },
        { k: 'slats', c: [ax, 0, 0], r, H },
      ],
      lift: { x: ax, z: 0, y0: -0.05, y1: H + 0.12, r: 0.3 },
      pillars: [[ax + 0.9, H - 0.17, 0]],
      denseExtra: dx,
    };
  },
  chime() {
    const sl = 0.1, smp = line(2.4, sl), y = (x) => -x * sl;
    const xs = [0.35, 0.85, 1.35, 1.85];
    return {
      ...plain('Chimes', '#fb7185', smp, 0), pillars: [[0.4, y(0.4), 0], [2.0, y(2.0), 0]],
      extras: xs.map((x, i) => ({ k: 'bar', x, y: y(x), color: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'][i], slope: sl })),
      sensors: xs.map((x) => ({ p: [x, y(x) + 0.1, 0], r: 0.17, kind: 'note' })),
    };
  },
  bell() {
    const smp = line(2, 0.18);
    return {
      ...plain('Bell Gate', '#fbbf24', smp, 0),
      extras: [{ k: 'arch', x: 1.0, y: -0.18, color: '#f59e0b' }],
      sensors: [{ p: [1.0, -0.18 + 0.2, 0], r: 0.22, kind: 'bell' }],
    };
  },
  glow() {
    const smp = line(2, 0.18);
    return { ...plain('Glow', '#a3e635', smp, 0), glow: true, sensors: [{ p: [1.0, -0.18 + 0.2, 0], r: 0.4, kind: 'glow' }] };
  },
  loop() {
    const H = 0.42, smp = [S(0, 0, 0, 0.5), S(0.5, -0.02, 0, 1.2), S(1.9, -0.08, 0, 1.2)];
    return {
      name: 'Hyper-Loop', color: '#22d3ee', samples: smp, exit: null, H,
      extras: [
        { k: 'box', c: [1.9 + WT / 2, -0.08 + (H - FT) / 2, 0], h: [WT / 2, (H + FT) / 2, 0.6 + WT], color: '#22d3ee' },
        { k: 'portal', c: [1.8, -0.08 + 0.2, 0] },
      ],
      sensors: [{ p: [1.72, -0.08 + 0.18, 0], r: 0.55, kind: 'portal' }],
      pillars: [[0.9, -0.04, 0]],
    };
  },
  end() {
    const H = 0.42, smp = [S(0, 0, 0, 0.5), S(0.5, -0.02, 0, 1.2), S(1.9, -0.08, 0, 1.2)];
    return {
      name: 'Catcher', color: '#ec4899', samples: smp, exit: null, H,
      extras: [{ k: 'box', c: [1.9 + WT / 2, -0.08 + (H - FT) / 2, 0], h: [WT / 2, (H + FT) / 2, 0.6 + WT], color: '#ec4899' }],
      pillars: [[0.9, -0.04, 0]],
      sensors: [{ p: [1.4, -0.06 + 0.18, 0], r: 0.45, kind: 'goal' }],
    };
  },
};

const memo = {};
export function getDef(type) {
  if (!memo[type]) {
    const d = GEN[type]();
    d.paths = d.paths || [d.samples];
    d.exits = d.exits || (d.exit ? [d.exit] : []);
    d.exit = d.exits[0] || null;
    d.sensors = d.sensors || [];
    d.denseExtra = d.denseExtra || [];
    memo[type] = d;
  }
  return memo[type];
}
export const MELODIES = {
  twinkle: [261.63, 261.63, 392, 392, 440, 440, 392, null, 349.23, 349.23, 329.63, 329.63, 293.66, 293.66, 261.63, null],
  ode: [329.63, 329.63, 349.23, 392, 392, 349.23, 329.63, 293.66, 261.63, 261.63, 293.66, 329.63, 329.63, null, 293.66, 293.66],
  scale: [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25],
};

// Prebuilt runs. A seq is a chain of pieces; after a splitter, an array of branches (one per exit).
export function flatten(seq, out = [], parent = null, ex = 0) {
  for (const item of seq) {
    if (typeof item === 'string') { out.push({ t: item, parent, ex }); parent = out.length - 1; ex = 0; }
    else item.forEach((br, k) => flatten(br, out, parent, k));
  }
  return out;
}

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
  { name: 'Twin Rivers', blurb: 'The track splits in two – which way will the marble go?', seq: ['start', 'straight', 'splitter', [
    ['left', 'straight', 'pegs', 'straight', 'end'],
    ['right', 'straight', 'spiralR', 'straight', 'end'],
  ]] },
  { name: 'Triple Cascade', blurb: 'Split, split again – three finish lines', seq: ['start', 'straight', 'splitter', [
    ['left', 'straight', 'splitter', [['left', 'straight', 'end'], ['right', 'straight', 'end']]],
    ['right', 'straight', 'pegs', 'straight', 'end'],
  ]] },
  { name: 'Paddle Palace', blurb: 'Marbles spin the paddle wheels', seq: ['start', 'straight', 'wheel', 'straight', 'left', 'wheel', 'straight', 'right', 'wheel', 'long', 'end'] },
  { name: 'Twinkle Star Lullaby', blurb: 'Roll a marble and it plays the tune', melody: 'twinkle', seq: ['start', 'straight', 'chime', 'left', 'chime', 'right', 'chime', 'left', 'chime', 'straight', 'end'] },
  { name: 'Ode to Joy', blurb: 'Beethoven on a marble run', melody: 'ode', seq: ['start', 'straight', 'chime', 'right', 'chime', 'left', 'chime', 'right', 'chime', 'straight', 'end'] },
  { name: 'Bell Tower', blurb: 'Lift up, then ring every bell on the way down', seq: ['start', 'straight', 'lift', 'long', 'bell', 'left', 'bell', 'straight', 'spiralL', 'bell', 'chime', 'straight', 'end'] },
  { name: 'Endless Loop Engine', blurb: 'Marbles go round and round forever', melody: 'scale', seq: ['start', 'straight', 'left', 'bell', 'straight', 'glow', 'chime', 'pegs', 'right', 'boost', 'glow', 'long', 'loop'] },
];
