// Sababus (סבבוס): Ramat Gan's free weekend buses, four colour-named lines. They are not in
// the government GTFS feed. Read from the operator's public Google map ("נוע תנוע | רשת
// הקווים", https://www.noat.co.il/routes), exported as KML.
// Docs: docs/data-pipeline.md#weekend-lines-outside-the-government-feed
// @req REQ-DATA-7
//
// The map has, per line: one or two route shapes per direction, and stops labelled with
// their line and direction ("לרמת גן" = to Ramat Gan). Stops have names and positions but
// no national stop codes; the pipeline matches them to national stops by position.

import { placeOnPath } from './busofash.mjs';

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const strip = (s) => unescapeXml(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '')).trim();
const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1];

// Minimal KML reading: enough for Google My Maps exports.
export function parseKmlPlacemarks(kml) {
  const out = [];
  for (const folder of kml.split('<Folder>').slice(1)) {
    const folderName = strip(tag(folder, 'name'));
    for (const pm of folder.split('<Placemark>').slice(1)) {
      const data = {};
      for (const m of pm.matchAll(/<Data name="([^"]+)">\s*<value>([\s\S]*?)<\/value>/g)) data[m[1]] = strip(m[2]);
      const coords = (block) => strip(tag(block, 'coordinates')).split(/\s+/).filter(Boolean).map((c) => c.split(',').map(Number));
      const line = pm.includes('<LineString>') ? coords(pm.slice(pm.indexOf('<LineString>'))) : null;
      const point = !line && pm.includes('<Point>') ? coords(pm.slice(pm.indexOf('<Point>')))[0] : null;
      out.push({ folder: folderName, name: strip(tag(pm, 'name')), data, line, point });
    }
  }
  return out;
}

// Returns [{ id, short, dest, path: [[lat, lon]], stops: [{ name, lat, lon }] }]
export async function loadNoatKml(source, log = console.log) {
  const res = await fetch(source.kmlUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${source.kmlUrl}: HTTP ${res.status}`);
  const placemarks = parseKmlPlacemarks(await res.text()).filter((p) => p.folder === source.folder);
  if (!placemarks.length) throw new Error(`no "${source.folder}" folder in the map`);

  const shapes = new Map(); // line name -> [path, ...]
  const stops = new Map(); // "line|direction" -> [stop, ...]
  for (const p of placemarks) {
    if (p.line) {
      if (!shapes.has(p.name)) shapes.set(p.name, []);
      shapes.get(p.name).push(p.line.map(([lon, lat]) => [lat, lon]));
    } else if (p.point && p.data.Route) {
      const key = `${p.data.Route}|${p.data.Direction}`;
      if (!stops.has(key)) stops.set(key, []);
      stops.get(key).push({ name: p.name, lat: Number(p.data.stop_lat) || p.point[1], lon: Number(p.data.stop_lon) || p.point[0] });
    }
  }

  const routes = [];
  for (const [key, list] of [...stops.entries()].sort()) {
    const [line, direction] = key.split('|');
    // Pick the shape this direction's stops fit best: closest on average, on the right-hand side.
    let best = null;
    for (const path of shapes.get(line) || []) {
      const fits = list.map((s) => placeOnPath(s.lat, s.lon, path));
      const cost = fits.reduce((n, f) => n + f.meters + (f.side === 'left' && f.meters > 6 ? 40 : 0), 0) / fits.length;
      if (!best || cost < best.cost) best = { path, fits, cost };
    }
    if (!best) continue;
    const ordered = list
      .map((s, i) => ({ ...s, pos: best.fits[i].pos, meters: best.fits[i].meters }))
      .filter((s) => s.meters <= 60)
      .sort((a, b) => a.pos - b.pos)
      .map(({ name, lat, lon }) => ({ name, lat, lon }));
    if (ordered.length < 2) continue;
    const short = line.replace(source.folder, '').trim() || line; // "סבבוס ירוק" -> "ירוק"
    const dest = direction.replace(/^ל/, ''); // "לרמת גן" -> "רמת גן"
    routes.push({ id: `${source.id}-${routes.length + 1}`, short: `${source.shortPrefix || ''}${short}`, dest, path: best.path, stops: ordered });
  }
  // Stable ids from the line and direction names, so saved commutes keep working when the
  // map changes. (A small text hash: the names are Hebrew, ids must be plain.)
  for (const r of routes) {
    let hsh = 5381;
    for (const ch of `${r.short}|${r.dest}`) hsh = ((hsh * 33) ^ ch.codePointAt(0)) >>> 0;
    r.id = `${source.id}-${hsh.toString(36)}`;
  }
  log(`  ${source.id}: ${routes.length} line directions from ${placemarks.filter((p) => p.point).length} stops and ${placemarks.filter((p) => p.line).length} shapes`);
  return routes;
}
