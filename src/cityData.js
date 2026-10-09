// Downloads and caches one city's transit bundle. Docs: docs/data-model.md#city-bundle
// @req REQ-DATA-1

import { dataBaseUrl } from './config.js';
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

async function removeOldVersions(cache, cityMeta) {
  for (const req of await cache.keys()) {
    if (req.url.includes(`/${cityMeta.file}?v=`) && !req.url.endsWith(`?v=${cityMeta.version}`)) {
      await cache.delete(req);
    }
  }
}

// In-memory model of one city, with the lookups the screens need.
export class CityData {
  constructor(raw, meta) {
    this.id = raw.cityId;
    this.meta = meta;
    this.version = meta.version;
    this.agencies = raw.agencies;

    this.stops = new Map();
    this.stopList = raw.stops.map(([id, code, name, lat, lon]) => {
      const s = { id, code, name, lat, lon, routeIds: [] };
      this.stops.set(id, s);
      return s;
    });

    this.routes = new Map();
    for (const [id, short, dest, agencyIdx, type, seq, shape] of raw.routes) {
      const stops = seq.map((i) => this.stopList[i]);
      const route = { id, short, dest, agency: this.agencies[agencyIdx], type, stops, encodedShape: shape, _shape: null };
      this.routes.set(id, route);
      for (const s of new Set(stops)) s.routeIds.push(id);
    }
  }

  // Full route line from first stop to last, decoded on first use.
  shapeOf(route) {
    if (!route._shape) route._shape = decode(route.encodedShape);
    return route._shape;
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
