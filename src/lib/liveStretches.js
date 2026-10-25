// Live traffic for the ghost: how long buses took between two stops in the last 20 minutes,
// learned on the phone from the live positions a Favorite Commute already fetches.
// Docs: docs/realtime.md#live-traffic-for-ghosts
// @req REQ-RT-15
//
// No server does this: every time a map asks for its routes' buses (every 15 s), each bus's
// place along its route is noted; when a bus is seen passing two stops in a row, the time
// between them is one "live stretch time". To start at once instead of after minutes of
// watching, the last 20 minutes of each route's positions are read from Open Bus Stride
// (its answer has every position, not only the newest) and learned the same way. What is
// learned is kept on the phone, so reopening the app does not start again. The ghost then
// blends these with the month's history (REQ-DATA-12): the more buses, the more the live
// times count. Measured on recorded buses in docs/reviews/2026-10-19-ghost-estimation-dr.html
// ("idea 1, blended").
//
// Pure (no map, no network), so it is unit tested.

export const WINDOW_MS = 20 * 60000; // live times older than this are forgotten
export const PRIOR = 4; // n live times count n / (n + PRIOR) against the month's history
const MAX_GAP_SECONDS = 150; // two signals further apart than this are not joined
const MAX_SPEED = 33; // meters a second: faster is a wrong match, not a bus
const BACK_METERS = 30; // GPS may step back a little; more is a new start
const MIN_SECONDS = 3;
const MAX_SECONDS = 1500;

export const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

// How much n live times count against the history.
export const liveWeight = (n) => n / (n + PRIOR);

// One stretch's time: history blended with what buses took there in the last 20 minutes.
// Without history, the live times alone (from two of them up), else null (the caller falls
// back to the timetable).
export function blend(history, samples) {
  if (!samples.length) return history ?? null;
  const live = median(samples);
  if (history == null) return samples.length >= 2 ? live : null;
  const w = liveWeight(samples.length);
  return w * live + (1 - w) * history;
}

export class LiveStretches {
  constructor() {
    this.rides = new Map(); // ride id -> { time, m, stops, cross: { i, time } }
    this.times = new Map(); // "from stop id>to stop id" -> [{ time, seconds }]
  }

  // One signal of a ride: `m` meters along its route's path, at `time` (ms).
  // stops: [{ id, m }], the route's stops with their meters along the same path.
  observe(rideId, time, m, stops) {
    const ride = this.rides.get(rideId);
    if (!ride || ride.stops !== stops) {
      this.rides.set(rideId, { time, m, stops, cross: null });
      return;
    }
    if (time <= ride.time) return; // the same signal again
    const seconds = (time - ride.time) / 1000;
    const moved = m - ride.m;
    if (seconds > MAX_GAP_SECONDS || moved < -BACK_METERS || moved > seconds * MAX_SPEED) {
      ride.cross = null; // lost for too long, or a jump that is not driving
    } else if (moved > 0) {
      // Each stop passed between the two signals, at a time shared out by distance.
      for (let i = 0; i < stops.length; i++) {
        if (stops[i].m <= ride.m || stops[i].m > m) continue;
        const passed = ride.time + (time - ride.time) * ((stops[i].m - ride.m) / moved);
        if (ride.cross && ride.cross.i === i - 1) {
          const took = (passed - ride.cross.time) / 1000;
          if (took >= MIN_SECONDS && took <= MAX_SECONDS) this.add(stops[i - 1].id, stops[i].id, passed, took);
        }
        ride.cross = { i, time: passed };
      }
    }
    ride.m = Math.max(ride.m, m);
    ride.time = time;
  }

  add(fromId, toId, time, seconds) {
    const k = `${fromId}>${toId}`;
    if (!this.times.has(k)) this.times.set(k, []);
    this.times.get(k).push({ time, seconds });
  }

  // The live times of one stretch in the last 20 minutes, in seconds.
  samples(fromId, toId, now = Date.now()) {
    const list = this.times.get(`${fromId}>${toId}`);
    return list ? list.filter((x) => x.time >= now - WINDOW_MS && x.time <= now).map((x) => x.seconds) : [];
  }

  // The live times only (not the rides), for keeping on the phone: [[stretch, [[time, seconds], ...]], ...].
  save(now = Date.now()) {
    this.prune(now);
    return JSON.stringify([...this.times].map(([k, list]) => [k, list.map((x) => [Math.round(x.time), Math.round(x.seconds)])]));
  }

  // Adds the live times kept by save(); those older than the window are left out.
  load(text, now = Date.now()) {
    let list;
    try { list = JSON.parse(text); } catch { return; }
    if (!Array.isArray(list)) return;
    for (const [k, items] of list) {
      if (typeof k !== 'string' || !Array.isArray(items)) continue;
      const [fromId, toId] = k.split('>');
      for (const [time, seconds] of items) {
        if (time >= now - WINDOW_MS && time <= now && seconds >= MIN_SECONDS && seconds <= MAX_SECONDS) this.add(fromId, toId, time, seconds);
      }
    }
  }

  // Forget what is older than the window.
  prune(now = Date.now()) {
    for (const [k, list] of this.times) {
      const kept = list.filter((x) => x.time >= now - WINDOW_MS);
      if (kept.length) this.times.set(k, kept); else this.times.delete(k);
    }
    for (const [id, ride] of this.rides) if (ride.time < now - WINDOW_MS) this.rides.delete(id);
  }
}

// One for the whole app: every map learns into it and every ghost reads from it.
export const sharedStretches = new LiveStretches();

// How good a live ghost's estimate is believed to be: 'good' | 'fair' | 'poor', for the ring
// around it. From the recorded-bus test: 90% of the timer's errors were within these many
// seconds, by the age of the bus's last signal (rush hour, live times blended).
export const P90_BY_AGE = [[60, 56], [120, 91], [180, 119], [300, 164], [480, 219]];

export function expectedError(ageSeconds) {
  const t = P90_BY_AGE;
  if (ageSeconds <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (ageSeconds <= t[i][0]) {
      const [a, ea] = t[i - 1];
      const [b, eb] = t[i];
      return ea + (eb - ea) * ((ageSeconds - a) / (b - a));
    }
  }
  const [a, ea] = t.at(-2);
  const [b, eb] = t.at(-1);
  return eb + (eb - ea) * ((ageSeconds - b) / (b - a));
}

// weight: how much the live times count on the way to the stop (0..1).
// Green: a fresh signal (90% of errors under 1.5 min) and live times from enough buses.
// Yellow: 90% of errors under about 2.75 min. Red: rougher than that.
export function confidence(ageSeconds, weight) {
  const e = expectedError(ageSeconds);
  if (e <= 90 && weight >= 0.4) return 'good';
  if (e <= 165) return 'fair';
  return 'poor';
}

// The ± beside a ghost's timer (REQ-RT-14): the mean error of the timer, in seconds, by how
// far ahead the estimate reaches (seconds: the age of the bus's last signal plus the time
// still to go), from the recorded-bus test of 2026-10-18 (docs/reviews/backtest-ghost.mjs):
// [seconds ahead, mean error with the month's history, mean error with live traffic].
export const MEAN_ERROR = {
  rush: [[60, 31, 30], [120, 44, 43], [180, 56, 54], [300, 78, 73], [480, 109, 99], [720, 148, 131], [960, 188, 164], [1200, 228, 197], [1500, 279, 240], [1800, 332, 286]],
  other: [[60, 30, 30], [120, 40, 40], [180, 49, 48], [300, 64, 64], [480, 84, 82], [720, 107, 105], [960, 130, 127], [1200, 152, 149], [1500, 180, 175], [1800, 206, 200]],
};

// Weekday rush hours in Israel (Sunday to Thursday, 06:30-09:30 and 15:00-19:00), when the
// rush-hour table applies.
const israelClock = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  : null;
export function isRushHour(date = new Date()) {
  if (!israelClock) return false;
  const p = Object.fromEntries(israelClock.formatToParts(date).map((x) => [x.type, x.value]));
  if (p.weekday === 'Fri' || p.weekday === 'Sat') return false;
  const m = Number(p.hour) * 60 + Number(p.minute);
  return (m >= 390 && m < 570) || (m >= 900 && m < 1140);
}

export function expectedMeanError(aheadSeconds, live = false, rush = isRushHour()) {
  const t = MEAN_ERROR[rush ? 'rush' : 'other'];
  const k = live ? 2 : 1;
  const a = Math.max(0, aheadSeconds);
  if (a <= t[0][0]) return t[0][k];
  for (let i = 1; i < t.length; i++) {
    if (a <= t[i][0]) return t[i - 1][k] + (t[i][k] - t[i - 1][k]) * ((a - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
  }
  const [x0, y0] = [t.at(-2)[0], t.at(-2)[k]];
  const [x1, y1] = [t.at(-1)[0], t.at(-1)[k]];
  return y1 + (y1 - y0) * ((a - x1) / (x1 - x0));
}
