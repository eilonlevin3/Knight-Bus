// App configuration. See docs/setup.md for how to fill in the Firebase values.
// These values are NOT secret: Firebase web config is meant to be public.
// Access is protected by firestore.rules.

import { build } from './build.js';

// Main and debug run on the same web address, so they share the browser's storage.
// Everything they save is kept apart by these names (docs/release-process.md).
// @req REQ-REL-2
export const channel = build.channel;
export const isDebug = channel === 'debug';
export const storagePrefix = isDebug ? 'kb.debug.' : 'kb.';
export const favoritesCollection = isDebug ? 'favoritesDebug' : 'favorites';

export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

// Live bus positions (docs/realtime.md).
export const realtime = {
  baseUrl: 'https://open-bus-stride-api.hasadna.org.il',
  refreshMs: 30_000,
  windowMinutes: 7, // ignore positions older than this
  maxOffRouteMeters: 250, // ignore buses this far from the line's path
};

// City bundles produced by pipeline/build-city-data.mjs.
export const dataBaseUrl = './data/cities/';

export const MAX_STOPS_PER_FAVORITE = 2;
export const FAVORITE_SLOTS = [1, 2, 3];
