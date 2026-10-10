// Service worker: makes the app open offline, caches map tiles, and handles updates.
// Docs: docs/architecture.md#offline, docs/release-process.md#what-users-see-when-you-release
// @req REQ-PWA-2 @req REQ-DATA-3 @req REQ-PWA-3 @req REQ-REL-2
//
// SHELL_VERSION and CHANNEL are filled in by scripts/build-site.sh at deploy time
// (commit id and 'main' | 'debug'). The browser compares this file byte for byte;
// a new commit id means a new version.

const SHELL_VERSION = 'dev';
const CHANNEL = 'local';
const SHELL_PREFIX = `kb-${CHANNEL}-shell-`;
const SHELL_CACHE = `${SHELL_PREFIX}${SHELL_VERSION}`;
const TILE_CACHE = 'kb-tiles-v1'; // shared by main and debug: same map images
const MAX_TILES = 3000; // ~50 MB at most
// City data has its own cache (src/cityData.js) and is never touched here.

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles.css',
  'src/build.js',
  'src/app.js',
  'src/updates.js',
  'src/config.js',
  'src/auth.js',
  'src/store.js',
  'src/location.js',
  'src/cityData.js',
  'src/realtime.js',
  'src/map.js',
  'src/liveLines.js',
  'src/lib/dom.js',
  'src/lib/polyline.js',
  'src/views/login.js',
  'src/views/city.js',
  'src/views/menu.js',
  'src/views/editor.js',
  'src/views/commute.js',
  'src/views/liveInfo.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Download the complete new version. It waits until the app says "update now"
// (the user taps the banner) or until every window of the app is closed.
self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never precaches old files.
  const fresh = SHELL.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(fresh)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// The new version takes over: delete this channel's older app files (never the other channel's).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => (k.startsWith(SHELL_PREFIX) && k !== SHELL_CACHE) || k === 'kb-shell-v1') // kb-shell-v1: first release
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache first, keep the most recent MAX_TILES.
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(tileFirst(req));
    return;
  }

  // App files come only from this version's cache, so a running app never mixes versions.
  // The main app's scope also covers /debug/, which belongs to the debug app: leave it alone.
  const scope = new URL(self.registration.scope);
  const inScope = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  const rest = inScope ? url.pathname.slice(scope.pathname.length) : '';
  const isOwnFile = inScope && !rest.startsWith('data/') && !rest.startsWith('debug/');
  if (isOwnFile || url.hostname === 'unpkg.com') event.respondWith(shellFirst(req));
  // Everything else (live bus API, Firebase, city data) goes straight to the network.
});

async function shellFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  // On your own computer the version never changes ('dev'), so prefer fresh files there.
  if (CHANNEL === 'local') {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  }
  const hit = await cache.match(req, { ignoreSearch: true }) ||
    (req.mode === 'navigate' ? await cache.match('index.html') : null);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function tileFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    trimTiles(cache);
  }
  return res;
}

let trimming = false;
async function trimTiles(cache) {
  if (trimming) return;
  trimming = true;
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  trimming = false;
}
