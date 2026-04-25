export const PALETTE = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // green
  '#fbbf24', // amber
  '#a78bfa', // purple
  '#f87171', // red
  '#22d3ee', // cyan
  '#fb923c', // orange
];

// Pick the next color, walking the palette in fixed order so colors rotate
// predictably even after deletes/reorders. Rule: start AFTER the last
// measurement's color, then return the first palette entry not already used
// by any existing measurement. If all 8 colors are in use, fall back to
// stepping one slot forward from the last (so adjacent measurements still
// never share a color).
export function nextColor(existing) {
  if (existing.length === 0) return PALETTE[0];
  const used     = new Set(existing.map((m) => m.color));
  const lastIdx  = PALETTE.indexOf(existing[existing.length - 1].color);
  const startAt  = lastIdx >= 0 ? (lastIdx + 1) % PALETTE.length : 0;
  for (let i = 0; i < PALETTE.length; i++) {
    const c = PALETTE[(startAt + i) % PALETTE.length];
    if (!used.has(c)) return c;
  }
  // Every palette slot in use — at least guarantee a different neighbor.
  return PALETTE[startAt];
}

export function formatName(date = new Date()) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = months[date.getMonth()];
  const d = date.getDate();
  const pad = (n) => String(n).padStart(2, '0');
  return `${m} ${d} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Generate a fake but plausible frequency response curve.
// Returns an array of { freq, db } points on a log-spaced frequency axis.
export function generateFakeCurve(seed = Math.random()) {
  const points = 64;
  const fMin = 20;
  const fMax = 20000;
  const data = [];
  // Random-ish resonances
  const rand = mulberry32(Math.floor(seed * 1e9));
  const bumps = [
    { f: 40 + rand() * 40, g: 4 + rand() * 6, q: 1 + rand() },
    { f: 200 + rand() * 300, g: -3 + rand() * 6, q: 1 + rand() * 2 },
    { f: 1000 + rand() * 1500, g: -4 + rand() * 8, q: 1 + rand() * 2 },
    { f: 5000 + rand() * 3000, g: -6 + rand() * 10, q: 1 + rand() },
    { f: 10000 + rand() * 4000, g: -8 + rand() * 4, q: 1 + rand() },
  ];
  const baseline = 70 + rand() * 10;
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const freq = fMin * Math.pow(fMax / fMin, t);
    let db = baseline;
    // gentle low-end rolloff
    db -= Math.max(0, (Math.log10(60) - Math.log10(freq)) * 20);
    // gentle high-end rolloff
    db -= Math.max(0, (Math.log10(freq) - Math.log10(14000)) * 15);
    for (const b of bumps) {
      const x = Math.log2(freq / b.f);
      db += b.g * Math.exp(-(x * x) * b.q * 2);
    }
    data.push({ freq: Math.round(freq), db: +db.toFixed(2) });
  }
  return data;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeMeasurement(existing, curve) {
  const now = new Date();
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    name: formatName(now),
    color: nextColor(existing),
    visible: true,
    createdAt: now.toISOString(),
    curve: curve || generateFakeCurve(Math.random()),
  };
}
