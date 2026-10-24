// Backtest of the ghost estimate on 90 minutes of recorded signals (2026-10-18 08:00-09:30 Israel).
// For each bus signal (the "last signal" the ghost starts from) and a horizon H, the ghost's
// predicted position H seconds later is compared with where the same bus really was.
// Methods: hold (no ghost), timetable, month history (today's ghost), and three ideas.
// The numbers in 2026-10-19-ghost-estimation-dr.html come from this script.
//
// Run (from the repo root, with Node on PATH; takes ~2 min once the speeds files are cached):
//   1. Make a work folder W with data/cities/ (index.json and the four city files, e.g. from
//      https://eilonlevin3.github.io/Knight-Bus/debug/data/cities/), an empty data/speeds/
//      (filled from the debug site on first run), and snap/ with per-minute bus files
//      named HH-MM.br from https://openbus-stride-public.s3.eu-west-1.amazonaws.com/stride-siri-requester/YYYY/MM/DD/HH/MM.br
//      (UTC times; Israel is UTC+3 in summer, +2 in winter).
//   2. node docs/reviews/backtest-ghost.mjs W [snap folder name, default snap] > result.json
// Window label in the output is fixed text; note the real window yourself.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const REPO = new URL('../../', import.meta.url).href; // the repo root
const { CityData } = await import(REPO + 'src/cityData.js');
const G = await import(REPO + 'src/lib/routeGeometry.js');
const { segmentSeconds, cellAt } = await import(REPO + 'src/lib/speeds.js');
const { DayCounter } = await import(REPO + 'pipeline/build-speeds.mjs');

const B = process.argv[2];
const SPEEDS_URL = 'https://eilonlevin3.github.io/Knight-Bus/debug/data/speeds/';
const HORIZONS = [60, 120, 180, 300, 480];

// ---------- Cities ----------
const index = JSON.parse(fs.readFileSync(path.join(B, 'data/cities/index.json'), 'utf8'));
const lineRefs = new Map();
for (const meta of index.cities) {
  const city = new CityData(JSON.parse(fs.readFileSync(path.join(B, 'data/cities', meta.file), 'utf8')), meta);
  for (const route of city.routes.values()) {
    if (!route.live) continue;
    for (const id of route.liveIds) lineRefs.set(String(id), { city, route });
  }
}

// ---------- Signals, and live stretch times from every bus (for idea B) ----------
const live = new Map(); // "from>to" -> [{ time, seconds }]
class LiveCounter extends DayCounter {
  add(record) { this.now = Date.parse(record.RecordedAtTime); super.add(record); }
  count(lineRef, from, to, cell, seconds) {
    const k = `${from}>${to}`;
    if (!live.has(k)) live.set(k, []);
    live.get(k).push({ time: this.now, seconds });
  }
}
const counter = new LiveCounter((ref) => lineRefs.get(String(ref)));
const rides = new Map();
const files = fs.readdirSync(path.join(B, process.argv[3] || 'snap')).filter((f) => f.endsWith('.br')).sort();
let bad = 0;
for (const f of files) {
  let recs;
  try {
    recs = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(path.join(B, process.argv[3] || 'snap', f)))).Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit || [];
  } catch { bad++; continue; }
  recs.sort((a, b) => Date.parse(a.RecordedAtTime) - Date.parse(b.RecordedAtTime));
  for (const r of recs) {
    counter.add(r);
    const j = r.MonitoredVehicleJourney;
    const found = lineRefs.get(String(j?.LineRef));
    if (!found) continue;
    const t = Date.parse(r.RecordedAtTime);
    const lat = Number(j.VehicleLocation?.Latitude), lon = Number(j.VehicleLocation?.Longitude);
    if (!Number.isFinite(t) || !Number.isFinite(lat)) continue;
    const key = `${j.LineRef}|${j.FramedVehicleJourneyRef?.DatedVehicleJourneyRef}|${j.VehicleRef}`;
    if (!rides.has(key)) rides.set(key, { ...found, pts: [] });
    const ride = rides.get(key);
    if (ride.pts.length && ride.pts.at(-1).t >= t) continue;
    ride.pts.push({ t, lat, lon });
  }
}
// How often a bus reports: gap between its signals.
const gaps = [];
for (const r of rides.values()) for (let i = 1; i < r.pts.length; i++) gaps.push((r.pts[i].t - r.pts[i - 1].t) / 1000);

// ---------- Speeds files ----------
const speedsCache = new Map();
async function speedsOf(routeId) {
  if (speedsCache.has(routeId)) return speedsCache.get(routeId);
  const file = path.join(B, 'data/speeds', `${routeId}.json`);
  let v = null;
  if (fs.existsSync(file)) v = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    try {
      const res = await fetch(SPEEDS_URL + encodeURIComponent(routeId) + '.json');
      v = res.ok ? await res.json() : null;
    } catch { v = null; }
    fs.writeFileSync(file, JSON.stringify(v));
  }
  speedsCache.set(routeId, v);
  return v;
}

// ---------- Geometry ----------
function cumOf(pathPts) {
  const cum = new Float64Array(pathPts.length);
  for (let i = 1; i < pathPts.length; i++) cum[i] = cum[i - 1] + G.metersBetween(pathPts[i - 1], pathPts[i]);
  return cum;
}
const metersAt = (cum, pos) => {
  const i = Math.min(cum.length - 1, Math.floor(pos));
  return i >= cum.length - 1 ? cum[cum.length - 1] : cum[i] + (cum[i + 1] - cum[i]) * (pos - i);
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };

// ---------- Run ----------
const METHODS = ['hold', 'timetable', 'history', 'A_bus', 'B_live', 'AB', 'slow10', 'B_blend'];
let liveHit = 0, liveAsk = 0, factorUsed = 0, origins = 0;
const res = Object.fromEntries(METHODS.map((m) => [m, Object.fromEntries(HORIZONS.map((h) => [h, { m: [], s: [], signed: [] }]))]));
let used = 0, ridesUsed = 0;
const routeIds = new Set();
// Jumps: how far the ghost (history) is from the new signal when it arrives = error at the
// next signal's time.
const jumps = [];

for (const ride of rides.values()) {
  if (ride.pts.length < 4) continue;
  // The pattern this ride fits best (first few signals).
  let best = null;
  for (const pattern of ride.route.patterns) {
    const p = ride.city.shapeOf(pattern);
    const offs = ride.pts.slice(0, 5).map((pt) => G.projectOnPath(pt, p).meters);
    const off = median(offs);
    if (!best || off < best.off) best = { pattern, path: p, off };
  }
  if (!best || best.off > 80) continue;
  const { pattern, path: p } = best;
  const cum = cumOf(p);
  const stopPos = G.stopPositions(pattern.stops, p);
  const firstStop = stopPos[0], lastStop = stopPos.at(-1);
  // Positions along the path, moving forward only.
  let start = 0;
  const pts = [];
  for (const pt of ride.pts) {
    const { pos, meters } = G.projectOnPath(pt, p, Math.max(0, Math.floor(start) - 2));
    if (meters > 120) continue;
    if (pts.length && metersAt(cum, pos) < metersAt(cum, pts.at(-1).pos) - 30) continue;
    start = pos;
    pts.push({ t: pt.t, pos, m: metersAt(cum, pos) });
  }
  if (pts.length < 4) continue;
  const speeds = await speedsOf(ride.route.id);
  routeIds.add(ride.route.id);
  ridesUsed++;
  for (let i = 0; i < pts.length; i++) {
    const o = pts[i];
    if (o.pos < firstStop + 0.5 || o.pos >= lastStop - 0.5) continue; // at the terminals: layovers
    const cell = cellAt(new Date(o.t));
    const hist = speeds ? (k) => segmentSeconds(speeds, pattern.stops[k - 1].id, pattern.stops[k].id, cell) : null;
    // Idea A: this bus's own pace over the last 3-10 minutes, against history.
    let factor = 1;
    const back = pts.slice(0, i).reverse().find((x) => o.t - x.t >= 180000 && o.t - x.t <= 600000);
    if (back && o.m - back.m > 50) {
      const expect = G.travelSeconds(pattern, p, back.pos, o.pos, stopPos, hist);
      if (expect > 30) {
        const raw = Math.max(0.5, Math.min(2, ((o.t - back.t) / 1000) / expect));
        factor = 1 + 0.6 * (raw - 1);
      }
    }
    const busOf = (k) => { const s = hist?.(k); if (s != null) return s * factor; return null; };
    // Idea B: what buses on this stretch (any route) took in the last 20 minutes.
    const liveOf = (k) => {
      const list = (live.get(`${pattern.stops[k - 1].id}>${pattern.stops[k].id}`) || []).filter((x) => x.time <= o.t && x.time >= o.t - 1200000);
      liveAsk++;
      if (list.length >= 2) { liveHit++; return median(list.map((x) => x.seconds)); }
      return hist?.(k) ?? null;
    };
    // Idea B, blended: live times count more the more buses they come from (n / (n + 4)).
    const blendOf = (k) => {
      const list = (live.get(`${pattern.stops[k - 1].id}>${pattern.stops[k].id}`) || []).filter((x) => x.time <= o.t && x.time >= o.t - 1200000);
      const h = hist?.(k) ?? null;
      if (!list.length) return h;
      const med = median(list.map((x) => x.seconds));
      if (h == null) return list.length >= 2 ? med : null;
      const w = list.length / (list.length + 4);
      return w * med + (1 - w) * h;
    };
    const abOf = (k) => { const s = liveOf(k); return s != null ? s * (1 + 0.5 * (factor - 1)) : null; };
    origins++; if (factor !== 1) factorUsed++;
    const fns = { timetable: null, history: hist, A_bus: hist ? busOf : null, B_live: liveOf, AB: abOf, B_blend: blendOf, ...Object.fromEntries([10].map((n) => [`slow${String(n).padStart(2, '0')}`, hist ? (k) => { const s = hist(k); return s != null ? s * (1 + n / 100) : null; } : null])) };
    for (let j = i + 1; j < pts.length; j++) {
      const dt = (pts[j].t - o.t) / 1000;
      if (j === i + 1 && hist) {
        const g = G.advanceOnPath(pattern, p, o.pos, dt, stopPos, hist);
        jumps.push(Math.abs(metersAt(cum, g) - pts[j].m));
      }
      for (const H of HORIZONS) {
        if (Math.abs(dt - H) > 20) continue;
        if (pts[j].pos >= lastStop - 0.5) continue;
        used++;
        const actual = pts[j];
        for (const m of METHODS) {
          const pred = m === 'hold' ? o.pos : G.advanceOnPath(pattern, p, o.pos, dt, stopPos, fns[m]);
          const errM = metersAt(cum, pred) - actual.m;
          // As time: how long the bus takes between the two positions (history, else timetable).
          const lo = Math.min(pred, actual.pos), hi = Math.max(pred, actual.pos);
          const errS = G.travelSeconds(pattern, p, lo, hi, stopPos, hist) * Math.sign(errM);
          res[m][H].m.push(Math.abs(errM));
          res[m][H].s.push(Math.abs(errS));
          res[m][H].signed.push(errS);
        }
      }
    }
  }
}

const out = { liveCoverage: liveHit / liveAsk, factorShare: factorUsed / origins, bad, window: '2026-10-18 08:00-09:30 Israel (Sunday)', files: files.length, rides: rides.size, ridesUsed, routes: routeIds.size, samples: used,
  reportGapMedian: median(gaps), reportGapP90: pct(gaps, 0.9), jumpMedian: median(jumps), jumpP90: pct(jumps, 0.9), results: {} };
for (const m of METHODS) {
  out.results[m] = {};
  for (const H of HORIZONS) {
    const r = res[m][H];
    out.results[m][H] = {
      n: r.m.length,
      medM: Math.round(median(r.m)), p90M: Math.round(pct(r.m, 0.9)),
      medS: Math.round(median(r.s)), p90S: Math.round(pct(r.s, 0.9)),
      biasS: Math.round(r.signed.reduce((a, b) => a + b, 0) / r.signed.length),
      within30s: Math.round(100 * r.s.filter((x) => x <= 30).length / r.s.length),
    };
  }
}
console.log(JSON.stringify(out, null, 1));
