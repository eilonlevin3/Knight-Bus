// Knight Bus live relay: a small Cloudflare Worker that makes live bus positions arrive
// about one minute old instead of 15-25. Docs: docs/realtime.md#the-relay
// @req REQ-RT-11 @req REQ-TRAIN-6
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
// It also answers, for a train station, which platform each train leaves from (REQ-TRAIN-6):
//   GET /rail-board?station=3700&ends=2800,1600&date=2026-10-16
//   -> { "station": "3700", "date": "...", "trains": [{ "train": 2, "time": "00:27",
//        "platform": 1, "to": 2300, "from": 400 }, ...] }
// Platforms are not in the ministry's data; they come from Israel Railways' own timetable
// service (the one its website uses), asked from this station to each end station given.
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

// Israel Railways' timetable service. Not a documented, public API: it is what rail.co.il
// itself calls, with the key that site sends to every visitor. It can change without notice;
// the app then shows its timetable without platforms.
const RAIL_API = 'https://rail-api.rail.co.il/rjpa/api/v1/timetable/searchTrain';
const RAIL_KEY = '5e64d66cf03f4547bcac5de2de06b566';
const RAIL_BOARD_FOR_MS = 10 * 60000; // a station's day of platforms is asked again after this
const railBoards = new Map(); // "station|date|ends" -> { at, trains }

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

// The day's trains leaving a station, with their platforms: from this station to each end
// station given (every train going that way). Asked from Israel Railways, kept 10 minutes.
async function railBoard(request, url) {
  const station = url.searchParams.get('station') || '';
  const date = url.searchParams.get('date') || '';
  const ends = [...new Set((url.searchParams.get('ends') || '').split(',').filter((s) => /^[0-9]{1,5}$/.test(s) && s !== station))].slice(0, 25);
  if (!/^[0-9]{1,5}$/.test(station) || !/^\d{4}-\d\d-\d\d$/.test(date) || !ends.length) {
    return json(request, 400, { error: 'Give station, ends and date: /rail-board?station=3700&ends=2800&date=2026-10-16' });
  }
  const key = `${station}|${date}|${ends.sort().join(',')}`;
  const kept = railBoards.get(key);
  if (kept && Date.now() - kept.at < RAIL_BOARD_FOR_MS) return json(request, 200, { station, date, trains: kept.trains }, { 'x-relay': 'rail memo' });
  const trains = new Map(); // train number + time -> train
  const problems = []; // what went wrong, for the error answer
  const answers = await Promise.all(ends.map(async (end) => {
    try {
      const res = await fetch(RAIL_API, {
        method: 'POST',
        // The headers the website's own page sends.
        headers: {
          'content-type': 'application/json',
          'ocp-apim-subscription-key': RAIL_KEY,
          accept: 'application/json, text/plain, */*',
          origin: 'https://www.rail.co.il',
          referer: 'https://www.rail.co.il/',
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        },
        body: JSON.stringify({ fromStation: station, toStation: end, date, hour: '00:00', scheduleType: 'ByDeparture', systemType: '2', languageId: 'Hebrew' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) { problems.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`); return false; }
      const travels = (await res.json())?.result?.travels || [];
      for (const travel of travels) {
        for (const train of travel.trains || []) {
          if (String(train.orignStation) !== station) continue; // a connection's later leg
          const stops = train.routeStations || [];
          const here = stops.find((s) => String(s.stationId) === station);
          const time = (here?.arrivalTime || train.departureTime?.slice(11, 16) || '').slice(0, 5);
          const k = `${train.trainNumber}|${time}`;
          if (!trains.has(k)) {
            trains.set(k, {
              train: train.trainNumber, time, platform: here?.platform ?? train.originPlatform ?? null,
              to: stops.at(-1)?.stationId ?? train.destinationStation, from: stops[0]?.stationId ?? null,
            });
          }
        }
      }
      return true;
    } catch (e) {
      problems.push(`${e.name}: ${e.message}`);
      return false;
    }
  }));
  if (!answers.some(Boolean)) return json(request, 502, { error: 'Israel Railways did not answer.', problems: [...new Set(problems)].slice(0, 3) });
  const list = [...trains.values()].sort((a, b) => a.time.localeCompare(b.time));
  railBoards.set(key, { at: Date.now(), trains: list });
  if (railBoards.size > 300) railBoards.delete(railBoards.keys().next().value);
  return json(request, 200, { station, date, trains: list }, { 'x-relay': 'rail' });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'access-control-allow-methods': 'GET' } });
    if (request.method !== 'GET') return json(request, 405, { error: 'GET only' });
    if (url.pathname === '/rail-board') return railBoard(request, url);
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
