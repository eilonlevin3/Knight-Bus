// Downloads and caches one city's transit bundle. Docs: docs/data-model.md#city-bundle
// @req REQ-DATA-1 @req REQ-DATA-10 @req REQ-ROUTE-1 @req REQ-ROUTE-2

import { dataBaseUrl, scheduleBaseUrl } from './config.js';
import { t, cityName } from './i18n.js';
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
      t('Could not load the city list. If this is a new install, the data pipeline has not run yet (docs/setup.md).'),
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
    onProgress(t('Downloading {city} ({mb} MB)…', { city: cityName(cityMeta), mb: (cityMeta.bytes / 1e6).toFixed(1) }));
    res = await fetch(url);
    if (!res.ok) throw new Error(t('Download failed (HTTP {status}).', { status: res.status }));
    if (cache) {
      await cache.put(url, res.clone());
      await removeOldVersions(cache, cityMeta);
    }
  }
  onProgress(t('Preparing map data…'));
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

// A route's timetable for the coming week, or null when there is none (weekend-service routes).
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
    this.sources = raw.sources || {}; // routes from outside the government feed: { id: { name, hours, info } }

    this.stops = new Map();
    // The optional 6th entry is "platform/floor", given for stops that share their stop
    // number with others (the platforms of a terminal) (REQ-STOP-1).
    this.byCode = new Map(); // stop number -> [stop, ...]
    this.stopList = raw.stops.map(([id, code, name, lat, lon, place = '']) => {
      const [platform = '', floor = ''] = place.split('/');
      const s = { id, code, name, lat, lon, platform, floor, routeIds: [] };
      this.stops.set(id, s);
      if (code) {
        if (!this.byCode.has(code)) this.byCode.set(code, []);
        this.byCode.get(code).push(s);
      }
      return s;
    });

    this.routes = new Map();
    // An older route id -> the route it is now part of (REQ-DATA-10). Favorite Commutes
    // saved with such an id keep working.
    this.aliases = new Map();
    // Each company's place in the list of companies sorted by name: its color (REQ-HOME-3).
    const agencyRank = new Map([...raw.agencies].sort((a, b) => a.localeCompare(b, 'he')).map((name, i) => [name, i]));
    for (const [id, short, dest, agencyIdx, type, seq, shape, times = null, source = null, alts = [], opposite = null, members = []] of raw.routes) {
      for (const m of members) this.aliases.set(m, id);
      // A route can have more than one stop pattern: the most common one, plus others that
      // skip or add stops (REQ-DATA-8). patterns[0] is the most common.
      //   times: scheduled minutes from the first stop (may be missing)
      //   share: % of the week's trips that use this pattern
      const pattern = (stopIdx, encodedShape, minutes, share) => ({
        stops: stopIdx.map((i) => this.stopList[i]), times: minutes, encodedShape, _shape: null, share,
      });
      const altShare = alts.reduce((n, a) => n + a[3], 0);
      const patterns = [pattern(seq, shape, times, Math.max(1, 100 - altShare)), ...alts.map((a) => pattern(a[0], a[1], a[2], a[3]))];
      // source: set for routes outside the government feed; those have no live buses (REQ-RT-5).
      // opposite: id of the route that runs the same service the other way (REQ-ROUTE-2).
      const route = {
        id, short, dest, agency: this.agencies[agencyIdx], agencyRank: agencyRank.get(this.agencies[agencyIdx]), type,
        patterns, multi: patterns.length > 1,
        stops: patterns[0].stops, times: patterns[0].times, // the most common pattern, for code that needs just one
        source, live: !source, hours: source ? this.sources[source]?.hours || null : null,
        opposite,
        // Every id live buses of this route report under: its own, and those of the
        // ministry's "alternatives" merged into it (REQ-DATA-10).
        liveIds: [id, ...members],
      };
      this.routes.set(id, route);
      // The route is listed at every stop that any of its patterns serves.
      for (const s of new Set(patterns.flatMap((p) => p.stops))) s.routeIds.push(id);
    }
  }

  // Saved route ids as they are today: an id that was merged into another route becomes
  // that route's id, and nothing is listed twice.
  currentRouteIds(ids) {
    return [...new Set((ids || []).map((id) => this.aliases.get(id) || id))];
  }

  // The path of a pattern (or of a route's most common pattern), decoded on first use.
  shapeOf(patternOrRoute) {
    const p = patternOrRoute.patterns ? patternOrRoute.patterns[0] : patternOrRoute;
    if (!p._shape) p._shape = decode(p.encodedShape);
    return p._shape;
  }

  // All stops that carry this stop's number, itself included, in platform order.
  // More than one = a terminal with several platforms under one number.
  sameCodeStops(stop) {
    const group = (stop?.code && this.byCode.get(stop.code)) || (stop ? [stop] : []);
    return [...group].sort((a, b) => a.platform.localeCompare(b.platform, 'en', { numeric: true }) || a.id.localeCompare(b.id));
  }

  // The patterns of a route that pass a stop, most common first.
  patternsAt(route, stopId) {
    return route.patterns.filter((p) => p.stops.some((s) => s.id === stopId));
  }

  // Routes serving a stop, sorted by route number.
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

  // Every route of the city for the search screen, sorted by number. A bus service runs in
  // two directions, which are two routes in the data: each pair is listed once, as
  // { route, opposite } (opposite is null for a one-way or circular route).
  routePairs() {
    if (!this._pairs) {
      const seen = new Set();
      this._pairs = [];
      const sorted = [...this.routes.values()]
        .sort((a, b) => a.short.localeCompare(b.short, 'he', { numeric: true }) || a.dest.localeCompare(b.dest, 'he'));
      for (const route of sorted) {
        if (seen.has(route.id)) continue;
        const opposite = (route.opposite && this.routes.get(route.opposite)) || null;
        seen.add(route.id);
        if (opposite) seen.add(opposite.id);
        this._pairs.push({ route, opposite });
      }
    }
    return this._pairs;
  }

  // Search the route pairs by route number (from its start), or by part of a destination,
  // a first stop or the operator's name. No text = everything.
  searchRoutes(query, pairs = this.routePairs()) {
    const q = query.trim().toLowerCase();
    if (!q) return pairs;
    const has = (text) => (text || '').toLowerCase().includes(q);
    const out = pairs.filter(({ route, opposite }) => route.short.toLowerCase().startsWith(q) ||
      has(route.dest) || has(opposite?.dest) || has(route.agency) || has(route.stops[0]?.name));
    // An exact number first, then numbers that start with the text, then the rest.
    const rank = ({ route }) => (route.short.toLowerCase() === q ? 0 : route.short.toLowerCase().startsWith(q) ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b));
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
