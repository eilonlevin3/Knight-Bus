// Knight Bus live relay: a small Cloudflare Worker that makes live bus positions arrive
// about one minute old instead of 15-25. Docs: docs/realtime.md#the-relay
// @req REQ-RT-11
//
// Why it exists: the Open Bus project saves one file a minute with every bus in the country,
// less than a minute after the buses report. A phone browser may not read those files (the
// file server sends no permission for it), and each is 4 MB unpacked. This relay reads the
// newest file once a minute, notes where each route's buses are in it, and answers the app
// with only the routes it asked for:
//   GET /live?routes=23918,24041
//   -> { "snapshot": "2026/10/13/15/56", "at": "<time the file was made>",
//        "routes": { "23918": [ <the bus's record, as the ministry sent it>, ... ], "24041": [] } }
//
// It keeps nothing about who asks: no accounts, no logs of its own, no cookies.
// To put it online: docs/setup.md#6-the-live-relay

const SOURCE = 'https://openbus-stride-public.s3.eu-west-1.amazonaws.com/stride-siri-requester';
// Only our own app (and a developer's computer) may read the answers from a browser.
const ALLOWED_ORIGINS = [/^https:\/\/eilonlevin3\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/];
const MAX_ROUTES = 80; // per question
const LOOK_BACK_MINUTES = 6; // how far back to look for the newest file
const LATEST_FOR_MS = 15000; // how long an answer to "which file is newest" is trusted
const CACHE_BASE = 'https://knight-bus-relay.internal/';
const RECORD_START = '{"RecordedAtTime"';
const LINE_REF = '"LineRef": "';
const BACKSLASH = String.fromCharCode(92);

// Kept between requests while this copy of the Worker stays warm.
let memo = null; // { id, at, text, index: Map(route id -> [start, end, start, end, ...]) }
let latest = { id: null, checkedAt: 0 };

const snapshotId = (date) => date.toISOString().slice(0, 16).replace(/[-T:]/g, '/'); // UTC "YYYY/MM/DD/HH/MM"

async function unpackBrotli(buffer) {
  try {
    const stream = new Response(buffer).body.pipeThrough(new DecompressionStream('brotli'));
    return await new Response(stream).text();
  } catch {
    // Runtimes without brotli in DecompressionStream: Node's zlib (compatibility flag nodejs_compat).
    const name = 'node:zlib';
    const zlib = await import(name);
    return new TextDecoder().decode(zlib.brotliDecompressSync(new Uint8Array(buffer)));
  }
}

// Finds every bus record in the file and notes, per route, where its records start and end.
// The file is not read as one big object and nothing is copied: that would take too long
// for a free Worker. Returns { at, text, index: Map(route id -> [start, end, start, end, ...]) }.
export function sortByRoute(text) {
  const index = new Map();
  let start = text.indexOf(RECORD_START);
  while (start >= 0) {
    const next = text.indexOf(RECORD_START, start + 1);
    // A record runs up to the ", " before the next one. The last record is followed by the
    // brackets that close the file, so its end is found by counting braces.
    let end = next < 0 ? closingBrace(text, start) + 1 : next - 2;
    while (end > start && text[end - 1] !== '}') end--; // other spacing: step back to the brace
    const ref = text.indexOf(LINE_REF, start);
    if (ref > 0 && ref < end) {
      const from = ref + LINE_REF.length;
      const id = text.slice(from, text.indexOf('"', from));
      if (/^[0-9]+$/.test(id)) {
        const spans = index.get(id);
        if (spans) spans.push(start, end); else index.set(id, [start, end]);
      }
    }
    start = next;
  }
  const at = (text.slice(0, 400).match(/"ResponseTimestamp": "([^"]+)"/) || [])[1] || null;
  return { at, text, index };
}

// The position of the brace that closes the object starting at `from`.
function closingBrace(text, from) {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === BACKSLASH) i++; // skip what it escapes
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return from - 1;
}

// One route's records as a JSON list.
export function recordsOf(snap, id) {
  const spans = snap.index.get(id);
  if (!spans) return '[]';
  const parts = [];
  for (let i = 0; i < spans.length; i += 2) parts.push(snap.text.slice(spans[i], spans[i + 1]));
  return `[${parts.join(',')}]`;
}

const cacheKey = (id) => `${CACHE_BASE}snapshot/${id}`;

// The shared cache keeps the unpacked file, so another copy of the Worker need not unpack it.
async function fromCache(id) {
  try {
    const hit = await caches.default.match(cacheKey(id));
    return hit ? { id, ...sortByRoute(await hit.text()) } : null;
  } catch {
    return null;
  }
}

function toCache(snap, ctx) {
  try {
    ctx.waitUntil(caches.default.put(cacheKey(snap.id), new Response(snap.text, { headers: { 'cache-control': 'public, max-age=600' } })));
  } catch { /* no cache here: the memo still works */ }
}

// The newest file, with its index. Tries: what this Worker already holds, the shared cache,
// then the file server, from this minute backwards.
async function newestSnapshot(ctx, now = new Date()) {
  const use = (snap, how) => {
    memo = snap;
    latest = { id: snap.id, checkedAt: now.getTime() };
    return { snap, how };
  };
  if (memo && latest.id === memo.id && now.getTime() - latest.checkedAt < LATEST_FOR_MS) return { snap: memo, how: 'memo' };
  for (let back = 0; back <= LOOK_BACK_MINUTES; back++) {
    const id = snapshotId(new Date(now.getTime() - back * 60000));
    if (memo && memo.id === id) return use(memo, 'memo');
    const cached = await fromCache(id);
    if (cached) return use(cached, 'cache');
    const res = await fetch(`${SOURCE}/${id}.br`);
    if (!res.ok) continue; // this minute's file is not there yet
    const snap = { id, ...sortByRoute(await unpackBrotli(await res.arrayBuffer())) };
    toCache(snap, ctx);
    return use(snap, 'built');
  }
  // The file server is not answering: better the last file than nothing.
  return { snap: memo, how: memo ? 'old memo' : 'none' };
}

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const headers = { vary: 'Origin' };
  if (ALLOWED_ORIGINS.some((re) => re.test(origin))) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-expose-headers'] = 'x-relay';
  }
  return headers;
}

const json = (request, status, body, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(request), ...extra },
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'access-control-allow-methods': 'GET' } });
    if (request.method !== 'GET') return json(request, 405, { error: 'GET only' });
    if (url.pathname !== '/live') {
      return json(request, 200, { name: 'Knight Bus live relay', use: '/live?routes=<route id>,<route id>', docs: 'https://github.com/eilonlevin3/Knight-Bus/blob/main/docs/realtime.md' });
    }
    const ids = [...new Set((url.searchParams.get('routes') || '').split(',').map((s) => s.trim()).filter((s) => /^[0-9]{1,9}$/.test(s)))];
    if (!ids.length || ids.length > MAX_ROUTES) return json(request, 400, { error: `Give 1 to ${MAX_ROUTES} route ids: /live?routes=23918,24041` });

    const started = Date.now();
    let found;
    try {
      found = await newestSnapshot(ctx);
    } catch (e) {
      return json(request, 502, { error: `Could not read the bus file: ${e.message}` });
    }
    const { snap, how } = found;
    if (!snap) return json(request, 503, { error: 'No bus file in the last few minutes.' });

    // Put the answer together from the pieces of the file, without reading them as objects.
    const routes = ids.map((id) => `${JSON.stringify(id)}:${recordsOf(snap, id)}`);
    const body = `{"snapshot":${JSON.stringify(snap.id)},"at":${JSON.stringify(snap.at)},"routes":{${routes.join(',')}}}`;
    return json(request, 200, body, {
      'cache-control': 'no-store',
      'x-relay': `${how}; ${Date.now() - started} ms`, // for checking how it runs
    });
  },
};
