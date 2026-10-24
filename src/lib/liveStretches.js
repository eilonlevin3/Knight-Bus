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
export const READY_SHARE = 0.5; // live times for at least half the way: the live ghost is on
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
