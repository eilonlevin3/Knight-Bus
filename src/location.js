// GPS position and choosing the metropolitan area. Docs: docs/user-flows.md#1-first-launch
// @req REQ-LOC-1 @req REQ-LOC-2

import { t } from './i18n.js';

export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error(t('This browser has no GPS support.')));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(
        e.code === 1 ? t('Location permission was denied.') : t('Could not get your location.'),
      )),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

// Keeps calling onPosition while the map is open. Returns a stop function.
export function watchPosition(onPosition) {
  if (!('geolocation' in navigator)) return () => {};
  const id = navigator.geolocation.watchPosition(
    (p) => onPosition({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 15000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

const contains = ([minLon, minLat, maxLon, maxLat], { lat, lon }) =>
  lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
const area = ([minLon, minLat, maxLon, maxLat]) => (maxLon - minLon) * (maxLat - minLat);

// The smallest city box that holds the position, or null when outside them all.
export function cityForPosition(cities, pos) {
  const hits = cities.filter((c) => contains(c.bbox, pos)).sort((a, b) => area(a.bbox) - area(b.bbox));
  return hits[0] || null;
}

export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
