// Service worker: makes the app open offline and caches map tiles. Docs: docs/architecture.md#offline
// @req REQ-PWA-2 @req REQ-DATA-3
//
// Bump SHELL_VERSION when you change files in SHELL, so phones pick up the new version.

const SHELL_VERSION = 'v1';
const SHELL_CACHE = `kb-shell-${SHELL_VERSION}`;
const TILE_CACHE = 'kb-tiles-v1';
const MAX_TILES = 3000; // ~50 MB at most
// City data has its own cache (src/cityData.js) and is never touched here.
const KEEP = new Set([SHELL_CACHE, TILE_CACHE, 'kb-city-data-v1']);

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles.css',
  'src/app.js',
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

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never precaches old files.
  const fresh = SHELL.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache first, keep the most recent MAX_TILES.
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(cacheFirst(req, TILE_CACHE, true));
    return;
  }

  // Same-origin app files and Leaflet: show the cached copy now, update it in the background.
  const isShell = (url.origin === self.location.origin && !url.pathname.includes('/data/')) ||
    url.hostname === 'unpkg.com';
  if (isShell) event.respondWith(staleWhileRevalidate(req));
  // Everything else (live bus API, Firebase, city data) goes straight to the network.
});

async function cacheFirst(req, cacheName, trim) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    if (trim) trimCache(cache);
  }
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => hit || (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
  return hit || network;
}

let trimming = false;
async function trimCache(cache) {
  if (trimming) return;
  trimming = true;
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  trimming = false;
}
