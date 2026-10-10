// Downloads and caches one city's transit bundle. Docs: docs/data-model.md#city-bundle
// @req REQ-DATA-1

import { dataBaseUrl, scheduleBaseUrl } from './config.js';
import { decode } from './lib/polyline.js';

const CACHE_NAME = 'kb-city-data-v1';
const loaded = new Map(); // cityId -> CityData (in memory for this session)

// The list of cities with the current version of each bundle.
// Network first (to learn about new versions), cached copy when offline.
export async function loadCityIndex() {
  const url = `${dataBaseUrl}index.json`;
  const cache = await openCache();
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (cache) await cache.put(url, res.clone());
    return await res.json();
  } catch (err) {
    const cached = cache && (await cache.match(url));
    if (cached) return cached.json();
    throw new Error(
      'Could not load the city list. If this is a new install, the data pipeline has not run yet (docs/setup.md).',
    );
  }
}

// Returns a CityData. Downloads only if this device has no copy of the current version.
export async function loadCity(cityMeta, onProgress = () => {}) {
  const mem = loaded.get(cityMeta.id);
  if (mem && mem.version === cityMeta.version) return mem;

  const url = `${dataBaseUrl}${cityMeta.file}?v=${cityMeta.version}`;
  const cache = await openCache();
  let res = cache && (await cache.match(url));
  if (!res) {
    onProgress(`Downloading ${cityMeta.name} (${(cityMeta.bytes / 1e6).toFixed(1)} MB)…`);
    res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
    if (cache) {
      await cache.put(url, res.clone());
      await removeOldVersions(cache, cityMeta);
    }
  }
  onProgress('Preparing map data…');
  const city = new CityData(await res.json(), cityMeta);
  loaded.set(cityMeta.id, city);
  return city;
}

async function openCache() {
  try { return await caches.open(CACHE_NAME); } catch { return null; }
}

// Main and debug share this cache, so match the full address, not just the file name.
async function removeOldVersions(cache, cityMeta) {
  const base = new URL(`${dataBaseUrl}${cityMeta.file}?v=`, location.href).href;
  for (const req of await cache.keys()) {
    if (req.url.startsWith(base) && req.url !== `${base}${cityMeta.version}`) await cache.delete(req);
  }
}

// A line's timetable for the coming week, or null when there is none (weekend-service lines).
// { patterns: [{ stops: [stopId], offsets: [minutes] }], trips: [[dayMask, startMinute, patternIndex]] }
export async function loadSchedule(routeId) {
  try {
    const res = await fetch(`${scheduleBaseUrl}${encodeURIComponent(routeId)}.json`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// In-memory model of one city, with the lookups the screens need.
export class CityData {
  constructor(raw, meta) {
    this.id = raw.cityId;
    this.meta = meta;
    this.version = meta.version;
    this.agencies = raw.agencies;
    this.sources = raw.sources || {}; // lines from outside the government feed: { id: { name, hours, info } }

    this.stops = new Map();
    this.stopList = raw.stops.map(([id, code, name, lat, lon]) => {
      const s = { id, code, name, lat, lon, routeIds: [] };
      this.stops.set(id, s);
      return s;
    });

    this.routes = new Map();
    for (const [id, short, dest, agencyIdx, type, seq, shape, times = null, source = null, alts = []] of raw.routes) {
      // A line can take more than one route ("stop pattern"): the usual one, plus variants
      // that skip or add stops (REQ-DATA-8). patterns[0] is the most common.
      //   times: scheduled minutes from the first stop (may be missing)
      //   share: % of the week's trips that use this pattern
      const pattern = (stopIdx, encodedShape, minutes, share) => ({
        stops: stopIdx.map((i) => this.stopList[i]), times: minutes, encodedShape, _shape: null, share,
      });
      const altShare = alts.reduce((n, a) => n + a[3], 0);
      const patterns = [pattern(seq, shape, times, Math.max(1, 100 - altShare)), ...alts.map((a) => pattern(a[0], a[1], a[2], a[3]))];
      // source: set for lines outside the government feed; those have no live buses (REQ-RT-5).
      const route = {
        id, short, dest, agency: this.agencies[agencyIdx], type,
        patterns, multi: patterns.length > 1,
        stops: patterns[0].stops, times: patterns[0].times, // the usual route, for code that needs just one
        source, live: !source, hours: source ? this.sources[source]?.hours || null : null,
      };
      this.routes.set(id, route);
      // The line is listed at every stop that any of its patterns serves.
      for (const s of new Set(patterns.flatMap((p) => p.stops))) s.routeIds.push(id);
    }
  }

  // The path of a pattern (or of a line's usual route), decoded on first use.
  shapeOf(patternOrRoute) {
    const p = patternOrRoute.patterns ? patternOrRoute.patterns[0] : patternOrRoute;
    if (!p._shape) p._shape = decode(p.encodedShape);
    return p._shape;
  }

  // The patterns of a line that pass a stop, most common first.
  patternsAt(route, stopId) {
    return route.patterns.filter((p) => p.stops.some((s) => s.id === stopId));
  }

  // Lines serving a stop, sorted by line number.
  routesAtStop(stopId) {
    const stop = this.stops.get(stopId);
    if (!stop) return [];
    return stop.routeIds
      .map((id) => this.routes.get(id))
      .sort((a, b) => a.short.localeCompare(b.short, 'he', { numeric: true }) || a.dest.localeCompare(b.dest, 'he'));
  }

  stopsInBounds(south, west, north, east, limit = 800) {
    const out = [];
    for (const s of this.stopList) {
      if (s.lat >= south && s.lat <= north && s.lon >= west && s.lon <= east) {
        out.push(s);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // Search by stop code (exact or prefix) or by part of the name.
  searchStops(query, limit = 30) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const byCode = /^\d+$/.test(q);
    const out = [];
    for (const s of this.stopList) {
      if (byCode ? s.code.startsWith(q) : s.name.toLowerCase().includes(q)) {
        out.push(s);
        if (out.length >= limit) break;
      }
    }
    if (byCode) out.sort((a, b) => (a.code === q ? -1 : b.code === q ? 1 : a.code.length - b.code.length));
    return out;
  }
}
