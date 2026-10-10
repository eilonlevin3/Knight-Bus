// Usage insights, privacy first. Docs: docs/adr/0008-usage-insights.md, docs/privacy.md
// @req REQ-ANL-1 @req REQ-ANL-3 @req REQ-ANL-4
//
// Rules this file enforces:
// 1. Nothing is recorded until the person says yes (and they can say no again any time).
// 2. track():       "safe" events for everyone who agreed. Goes to Firebase / Google Analytics.
//                   Never contains names, emails, the account id, stop or line ids, addresses
//                   or coordinates. Only screens, counts, the city and the hour.
// 3. trackDetail(): the full picture (stops, lines, exact location). ONLY in the debug
//                   version, and stored in our own Firestore, never in Google Analytics
//                   (whose rules forbid precise locations).
// 4. Debug and local versions mark their Analytics events as debug_mode, which Google
//    Analytics keeps out of the normal reports (they show in DebugView), so testing never
//    skews the real numbers.

import { FIREBASE_SDK, storagePrefix, channel } from './config.js';
import { firebaseConfigured, getFirebaseApp } from './auth.js';
import { logDebugEvent } from './store.js';

const CONSENT_KEY = `${storagePrefix}usageConsent`;
export const detailed = channel !== 'main'; // debug + local: detailed data, kept apart

let fa = null; // firebase-analytics module
let analytics = null;
let starting = null;
let user = null;

// 'on' | 'off' | null (not asked yet)
export function consent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

export async function setConsent(on) {
  try { localStorage.setItem(CONSENT_KEY, on ? 'on' : 'off'); } catch {}
  if (on) {
    await start();
    if (analytics) fa.setAnalyticsCollectionEnabled(analytics, true);
    track('usage_sharing_on');
  } else if (analytics) {
    fa.setAnalyticsCollectionEnabled(analytics, false);
  }
}

// Used only for the debug detail log (which lives under the person's own account).
export function setAnalyticsUser(u) {
  user = u && !u.local ? u : null;
}

function start() {
  if (!firebaseConfigured) return Promise.resolve(null);
  starting ||= (async () => {
    fa = await import(`${FIREBASE_SDK}firebase-analytics.js`);
    if (!(await fa.isSupported())) return null;
    analytics = fa.initializeAnalytics(await getFirebaseApp(), {
      config: { send_page_view: false, ...(detailed ? { debug_mode: true } : {}) },
    });
    fa.setUserProperties(analytics, { channel });
    return analytics;
  })().catch((e) => { console.warn('Analytics unavailable', e); return null; });
  return starting;
}

// A safe, anonymous event. params: short strings and numbers only.
export function track(name, params = {}) {
  if (consent() !== 'on') return;
  start().then((a) => {
    if (a) fa.logEvent(a, name, { channel, ...params, ...(detailed ? { debug_mode: true } : {}) });
  });
}

// The detailed version of an event. Debug only; a no-op in the user version.
export function trackDetail(name, detail = {}) {
  if (!detailed || consent() !== 'on' || !user) return;
  logDebugEvent(user, name, detail).catch((e) => console.warn('Debug event not saved', e));
}

// ---- Time per screen ----
let current = null; // { name, since }

function flushScreen() {
  if (!current) return;
  const seconds = Math.round((Date.now() - current.since) / 1000);
  if (seconds >= 1) track('screen_time', { screen: current.name, seconds: Math.min(seconds, 3600) });
  current.since = Date.now();
}

export function screen(name) {
  if (current?.name === name) return;
  flushScreen();
  current = { name, since: Date.now() };
  track('screen_view', { firebase_screen: name, screen: name });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushScreen();
  else if (current) current.since = Date.now(); // time in the background doesn't count
});

// ---- Small helpers so screens send consistent, safe values ----
export const hourOfDay = () => new Date().getHours();
export const weekday = () => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
export const displayMode = () =>
  (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'installed' : 'browser');
// Counts are sent as buckets, not exact numbers.
export const bucket = (n) => (n === 0 ? '0' : n <= 2 ? '1-2' : n <= 5 ? '3-5' : '6+');
