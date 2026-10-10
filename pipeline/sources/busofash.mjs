// Weekend lines run by municipalities ("Naaim BeSofash", https://busofash.co.il/), which are
// NOT in the government GTFS feed. Read from the Tel Aviv municipality's public map server.
// Docs: docs/data-pipeline.md#weekend-lines-outside-the-government-feed
// @req REQ-DATA-7
//
// The server has one shape per line direction ("מכפר סבא אל תל אביב" = from Kfar Saba to Tel Aviv)
// and a list of stops per line (both directions together, with national stop codes).
// We work out which stops belong to which direction: a stop must be close to that direction's
// path, and on its right-hand side (Israel drives on the right).

const MAX_STOP_DISTANCE_M = 35;
const SIDE_TOLERANCE_M = 6; // closer than this to the path, either side is fine

async function queryGeoJson(layerUrl) {
  const url = `${layerUrl}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${layerUrl}: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.features) throw new Error(`${layerUrl}: no features in response`);
  return json.features;
}

// "מקריית אונו אל אזורי חן" -> "אזורי חן"; "מהרצליה לכרמלית" -> "כרמלית"
export function destinationFromName(name) {
  const s = String(name || '').trim();
  if (s.includes(' אל ')) return s.split(' אל ').pop().trim();
  const words = s.split(/\s+/);
  const i = words.findIndex((w, k) => k > 0 && w.startsWith('ל') && w.length > 2);
  return i > 0 ? [words[i].slice(1), ...words.slice(i + 1)].join(' ') : s;
}

// Nearest point of a path ([[lat, lon], ...]) to a point, with side of travel.
export function placeOnPath(lat, lon, path) {
  const k = Math.cos(lat * (Math.PI / 180));
  let best = { meters: Infinity, pos: 0, cross: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i][1] * k, ay = path[i][0];
    const bx = path[i + 1][1] * k, by = path[i + 1][0];
    const px = lon * k, py = lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const cx = ax + t * dx, cy = ay + t * dy;
    const meters = Math.hypot(px - cx, py - cy) * 111320;
    if (meters < best.meters) best = { meters, pos: i + t, cross: dx * (py - cy) - dy * (px - cx) };
  }
  // cross > 0: left of travel direction (x = east, y = north); < 0: right.
  return { meters: best.meters, pos: best.pos, side: best.cross > 0 ? 'left' : 'right' };
}

// Returns [{ id, short, dest, agencyName, path: [[lat, lon]], stops: [{ code, name, lat, lon }] }]
export async function loadBusofash(source, log = console.log) {
  const [lineFeatures, stopFeatures] = await Promise.all([queryGeoJson(source.linesUrl), queryGeoJson(source.stopsUrl)]);

  const stopsByLine = new Map();
  for (const f of stopFeatures) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const line = String(p.Line);
    if (!stopsByLine.has(line)) stopsByLine.set(line, []);
    stopsByLine.get(line).push({ code: String(p.stop_code), name: p.Name, lat, lon });
  }

  // Directions per line, in a stable order (by name), so ids stay the same between imports.
  const directions = lineFeatures
    .map((f) => {
      const g = f.geometry;
      const coords = g.type === 'MultiLineString' ? g.coordinates.flat() : g.coordinates;
      return { line: String(f.properties.Line), name: f.properties.Name, path: coords.map(([lon, lat]) => [lat, lon]) };
    })
    .filter((d) => d.path.length > 1)
    .sort((a, b) => a.line.localeCompare(b.line, 'en', { numeric: true }) || a.name.localeCompare(b.name, 'he'));

  const byLine = new Map();
  for (const d of directions) {
    if (!byLine.has(d.line)) byLine.set(d.line, []);
    byLine.get(d.line).push(d);
  }

  const routes = [];
  let unplaced = 0;
  for (const [line, dirs] of byLine) {
    const placed = dirs.map(() => []);
    for (const stop of stopsByLine.get(line) || []) {
      const fits = dirs.map((d) => placeOnPath(stop.lat, stop.lon, d.path));
      let any = false;
      fits.forEach((fit, k) => {
        const ok = fit.meters <= MAX_STOP_DISTANCE_M && (fit.side === 'right' || fit.meters <= SIDE_TOLERANCE_M);
        if (ok) { placed[k].push({ ...stop, pos: fit.pos }); any = true; }
      });
      // No direction on the right-hand side (e.g. a stop in a road's middle): take the nearest one.
      if (!any) {
        const k = fits.reduce((a, f, i) => (f.meters < fits[a].meters ? i : a), 0);
        if (fits[k].meters <= 2 * MAX_STOP_DISTANCE_M) placed[k].push({ ...stop, pos: fits[k].pos });
        else unplaced++;
      }
    }
    dirs.forEach((d, k) => {
      const seen = new Set();
      const stops = placed[k]
        .sort((a, b) => a.pos - b.pos)
        .filter((s) => !seen.has(s.code) && seen.add(s.code))
        .map(({ code, name, lat, lon }) => ({ code, name, lat, lon }));
      if (stops.length < 2) return;
      routes.push({ id: `${source.id}-${line}-${k + 1}`, short: line, dest: destinationFromName(d.name), path: d.path, stops });
    });
  }
  log(`  ${source.id}: ${routes.length} line directions, ${stopFeatures.length} stop records${unplaced ? `, ${unplaced} stops too far from any path` : ''}`);
  return routes;
}
