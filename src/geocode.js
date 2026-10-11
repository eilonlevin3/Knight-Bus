// Address search for a favorite's start point and destination, using OpenStreetMap Nominatim.
// Docs: docs/adr/0007-address-search.md. Usage policy: at most 1 request per second and no
// search-as-you-type, so we search only when the user presses Search.
// @req REQ-FAV-5

import { t } from './i18n.js';

const BASE = 'https://nominatim.openstreetmap.org';
let last = 0;

async function politeFetch(url) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(url, { headers: { 'Accept-Language': 'he,en' } });
  if (!res.ok) throw new Error(t('Address search failed (HTTP {status}).', { status: res.status }));
  return res.json();
}

// Places matching the text, nearest the city first. Returns [{ lat, lon, label }].
export async function searchPlaces(query, cityMeta) {
  const [minLon, minLat, maxLon, maxLat] = cityMeta.bbox;
  const params = new URLSearchParams({
    q: query, format: 'jsonv2', countrycodes: 'il', limit: '6', addressdetails: '0',
    viewbox: `${minLon},${maxLat},${maxLon},${minLat}`, // prefer, don't require, the city
  });
  const rows = await politeFetch(`${BASE}/search?${params}`);
  return rows.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), label: shortLabel(r.display_name) }));
}

// A short name for a tapped point, or null.
export async function placeName(lat, lon) {
  try {
    const params = new URLSearchParams({ lat, lon, format: 'jsonv2', zoom: '18' });
    const r = await politeFetch(`${BASE}/reverse?${params}`);
    return r?.display_name ? shortLabel(r.display_name) : null;
  } catch {
    return null;
  }
}

// "Dizengoff 50, Tel Aviv, Gush Dan, Israel, 6433222" -> "Dizengoff 50, Tel Aviv"
function shortLabel(displayName) {
  return displayName.split(',').map((s) => s.trim()).filter((s) => !/^\d{5,7}$/.test(s)).slice(0, 2).join(', ');
}
