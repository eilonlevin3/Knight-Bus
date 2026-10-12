// The map view a person chose for opening a Favorite Commute: its center and zoom.
// Docs: docs/user-flows.md#3-editing-a-favorite-commute
// @req REQ-FAV-6
//
// Kept on this device only, per account and Favorite Commute. A zoom chosen on one screen
// does not suit another screen size, and the database rules need no change this way.

import { storagePrefix } from '../config.js';

const key = (user, slot) => `${storagePrefix}view.${user?.uid || 'local'}.${slot}`;

// { lat, lon, zoom } or null
export function readView(user, slot) {
  try {
    const v = JSON.parse(localStorage.getItem(key(user, slot)));
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
}

export function writeView(user, slot, view) {
  try { localStorage.setItem(key(user, slot), JSON.stringify(view)); } catch {}
}

export function clearView(user, slot) {
  try { localStorage.removeItem(key(user, slot)); } catch {}
}
