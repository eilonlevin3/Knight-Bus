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

// Firebase project "knight-bus" (console.firebase.google.com/project/knight-bus-a91d3).
export const firebaseConfig = {
  apiKey: 'AIzaSyCYVKARDk1rmCuBo16avHQYR429ychDAHY',
  authDomain: 'knight-bus-a91d3.firebaseapp.com',
  projectId: 'knight-bus-a91d3',
  storageBucket: 'knight-bus-a91d3.firebasestorage.app',
  messagingSenderId: '443434520716',
  appId: '1:443434520716:web:9e5d3efecbabb07eefaba9',
  measurementId: 'G-91J047X5GH',
};

export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

// Live bus positions (docs/realtime.md).
export const realtime = {
  baseUrl: 'https://open-bus-stride-api.hasadna.org.il',
  // Our own relay (relay/worker.js, docs/realtime.md#the-relay): positions about a minute
  // old. Empty = not set up; the app then asks baseUrl (Open Bus Stride) directly. Stride is
  // also the fallback whenever the relay does not answer. No trailing slash.
  relayUrl: 'https://relay.knightbusapp.com', // the relay's own address; also at knight-bus-relay.eilonlevin3.workers.dev
  ghostStepMs: 500, // how often an estimated ("ghost") position moves: twice a second
  ghostMaxMinutes: 30, // an estimate never runs further ahead than this
  relayTimeoutMs: 8000, // no answer from the relay in this time: ask Stride
  timeoutMs: 20_000, // no answer from Stride in this time: say live data is unavailable
  // The relay's file changes once a minute; asking twice as often shows a new one sooner.
  refreshMs: 15_000,
  freshFeedMinutes: 3, // the feed's newest file is at most this old: it is up to date
  // The public mirror sometimes runs 15-25 minutes behind (seen all day on 2026-10-11).
  // Positions up to this old are still shown, marked as late (REQ-RT-9).
  windowMinutes: 30,
  rideGapMinutes: 7, // a bus this far behind the newest position on its route has finished its trip
  lateMinutes: 5, // older than this, a position is called late
  maxOffRouteMeters: 250, // ignore buses this far from the line's path
};

// City bundles produced by pipeline/build-city-data.mjs.
export const dataBaseUrl = './data/cities/';
// One small timetable file per line, loaded only when a stop's schedule is opened.
export const scheduleBaseUrl = './data/schedules/';

// A month of real travel times between stops, one file per route; loaded only for a ghost.
export const speedsBaseUrl = './data/speeds/';

export const MAX_STOPS_PER_FAVORITE = 2;
export const FAVORITE_SLOTS = [1, 2, 3];
