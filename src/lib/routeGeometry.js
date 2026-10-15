// Geometry along a bus line's path. Shared by live buses, line drawing and map zoom.
// Docs: docs/realtime.md, docs/user-flows.md#4-using-a-favorite-commute
// A position on a path is in "segment units": segment index + fraction (2.5 = halfway along segment 2).

// Position of each stop along the path.
// Walks forward so stops stay in order even where a line comes back along the same street.
const stopPosCache = new WeakMap();
export function stopPositions(routeStops, path) {
  const cached = stopPosCache.get(routeStops);
  if (cached && cached.path === path) return cached.pos;
  const pos = [];
  let from = 0;
  for (const s of routeStops) {
    const { pos: p } = projectOnPath(s, path, Math.floor(from), true);
    pos.push(p);
    from = p;
  }
  stopPosCache.set(routeStops, { path, pos });
  return pos;
}

// Nearest point on the path to a {lat, lon}. Returns { pos, meters }.
// With preferEarliest, takes the first segment within 30 m of the best match, so a stop
// on the way out does not jump to the same street on the way back.
export function projectOnPath(pt, path, startSeg = 0, preferEarliest = false) {
  const k = Math.cos(pt.lat * (Math.PI / 180));
  const candidates = [];
  let best = Infinity;
  for (let i = Math.max(0, startSeg); i < path.length - 1; i++) {
    const ax = path[i][1] * k, ay = path[i][0];
    const bx = path[i + 1][1] * k, by = path[i + 1][0];
    const px = pt.lon * k, py = pt.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const meters = Math.hypot(ax + t * dx - px, ay + t * dy - py) * 111320;
    candidates.push([i + t, meters]);
    if (meters < best) best = meters;
  }
  if (!candidates.length) return { pos: 0, meters: Infinity };
  const [pos, meters] = preferEarliest
    ? candidates.find(([, m]) => m <= best + 30)
    : candidates.find(([, m]) => m === best);
  return { pos, meters };
}

// The point at a position on the path.
export function pointAt(path, pos) {
  const i = Math.max(0, Math.min(path.length - 1, Math.floor(pos)));
  const t = pos - i;
  if (i >= path.length - 1 || t <= 0) return path[i];
  const [a, b] = [path[i], path[i + 1]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// The part of the path between two positions, as [[lat, lon], ...].
export function slicePath(path, from, to) {
  if (to < from) [from, to] = [to, from];
  const out = [pointAt(path, from)];
  for (let i = Math.floor(from) + 1; i <= Math.floor(to) && i < path.length; i++) out.push(path[i]);
  out.push(pointAt(path, to));
  return out;
}

// Splits the path at a position: [before, after]. Both include the split point.
export function splitPath(path, pos) {
  return [slicePath(path, 0, pos), slicePath(path, pos, path.length - 1)];
}

// Do two paths run along the same streets? True when every corner of each lies on the other.
// @req REQ-LINE-1c
const samePathCache = new WeakMap();
export function samePath(a, b, toleranceMeters = 20) {
  if (a === b) return true;
  const cached = samePathCache.get(a)?.get(b);
  if (cached !== undefined) return cached;
  const near = (p, q) => p.every(([lat, lon]) => projectOnPath({ lat, lon }, q).meters <= toleranceMeters);
  const same = near(a, b) && near(b, a);
  if (!samePathCache.has(a)) samePathCache.set(a, new WeakMap());
  samePathCache.get(a).set(b, same);
  return same;
}

export function metersBetween(a, b) {
  const k = Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot((b[1] - a[1]) * k, b[0] - a[0]) * 111320;
}

// The last `meters` of the path before a position on it (less if the path starts sooner).
// @req REQ-COMM-2
export function pathBefore(path, pos, meters) {
  let from = pos;
  let left = meters;
  let here = pointAt(path, pos);
  for (let i = Math.ceil(pos) - 1; i >= 0 && left > 0; i--) {
    const step = metersBetween(path[i], here);
    if (step >= left) {
      from -= (from - i) * (left / step); // the distance runs out between two corners
      left = 0;
    } else {
      left -= step;
      from = i;
      here = path[i];
    }
  }
  return slicePath(path, from, pos);
}

// Where a bus that was at position `pos` on the path would be `seconds` later (REQ-RT-12).
// Between two stops the bus is taken to move evenly. How long a stretch takes comes from,
// in this order:
//   1. secondsOf(i): seconds from stop i-1 to stop i, from a month of real trips (or null);
//   2. the timetable: pattern.times, the scheduled minutes from the first stop to each stop;
//   3. a city bus speed of 18 km/h.
// The bus never passes the last stop. Returns a position on the path.
export function advanceOnPath(pattern, path, pos, seconds, stopPos = stopPositions(pattern.stops, path), secondsOf = null) {
  const times = pattern.times;
  const last = stopPos.at(-1);
  if (seconds <= 0 || pos >= last) return Math.min(pos, last);
  const usable = times && times.length === stopPos.length && times.every((x) => Number.isFinite(x));
  if (!usable && !secondsOf) {
    // By distance: walk along the path at 5 meters a second.
    let left = seconds * 5;
    let here = pos;
    while (left > 0 && here < last) {
      const next = Math.min(Math.floor(here) + 1, last);
      const step = metersBetween(pointAt(path, here), pointAt(path, next));
      if (step > left) return here + (next - here) * (left / step);
      left -= step;
      here = next;
    }
    return Math.min(here, last);
  }
  let left = seconds / 60; // minutes still to spend
  let here = pos;
  // The stop the bus reaches next: the first one at or after its position.
  let i = stopPos.findIndex((p) => p > here + 1e-9);
  if (i < 0) return last;
  if (i === 0) i = 1; // before the first stop: treat as leaving it
  for (; i < stopPos.length; i++) {
    const from = stopPos[i - 1];
    const to = stopPos[i];
    if (to <= here) continue;
    const span = to - from;
    // Minutes for the whole stretch, then for the part of it still ahead of the bus.
    const known = secondsOf ? secondsOf(i) : null;
    const whole = known != null ? known / 60 : usable ? times[i] - times[i - 1] : metersAlong(path, from, to) / 5 / 60;
    const need = span > 0 ? whole * ((to - Math.max(here, from)) / span) : 0;
    if (need > left) return here + (to - Math.max(here, from)) * (left / need);
    left -= need;
    here = to;
  }
  return last;
}

// Seconds a bus takes from position `from` to position `to` on the path, by the same
// rules as advanceOnPath (real travel times, then the timetable, then 18 km/h).
export function travelSeconds(pattern, path, from, to, stopPos = stopPositions(pattern.stops, path), secondsOf = null) {
  if (to <= from) return 0;
  const times = pattern.times;
  const usable = times && times.length === stopPos.length && times.every((x) => Number.isFinite(x));
  let total = 0;
  for (let i = 1; i < stopPos.length; i++) {
    const a = stopPos[i - 1];
    const b = stopPos[i];
    const lo = Math.max(a, from);
    const hi = Math.min(b, to);
    if (hi <= lo || b <= a) continue;
    const known = secondsOf ? secondsOf(i) : null;
    const whole = known != null ? known : usable ? (times[i] - times[i - 1]) * 60 : metersAlong(path, a, b) / 5;
    total += whole * ((hi - lo) / (b - a));
  }
  return total;
}

// Meters along the path between two positions on it.
function metersAlong(path, from, to) {
  let meters = 0;
  let here = from;
  while (here < to) {
    const next = Math.min(Math.floor(here) + 1, to);
    meters += metersBetween(pointAt(path, here), pointAt(path, next));
    here = next;
  }
  return meters;
}

// The stretch of the line a bus covers in the `minutes` before it reaches stop `stopIndex`.
// Uses the timetable (route.times: scheduled minutes from the first stop) when available;
// otherwise assumes city bus speed (~18 km/h, so 5 min ≈ 1.5 km).
// @req REQ-HOME-2
export function approachPath(route, path, stopIndex, minutes = 5) {
  const pos = stopPositions(route.stops, path);
  let startIdx = stopIndex;
  if (route.times && route.times.length === route.stops.length) {
    const t = route.times;
    const arrive = t[stopIndex];
    while (startIdx > 0 && arrive - t[startIdx - 1] <= minutes) startIdx--;
    // The 5 minutes usually end between two stops: go back that fraction of the gap.
    const left = minutes - (arrive - t[startIdx]);
    const gap = startIdx > 0 ? t[startIdx] - t[startIdx - 1] : 0;
    const from = gap > 0 && left > 0
      ? pos[startIdx] - (left / gap) * (pos[startIdx] - pos[startIdx - 1])
      : pos[startIdx];
    return slicePath(path, from, pos[stopIndex]);
  } else {
    const limit = (minutes / 60) * 18000;
    let meters = 0;
    while (startIdx > 0 && meters < limit) {
      const a = route.stops[startIdx - 1];
      const b = route.stops[startIdx];
      meters += metersBetween([a.lat, a.lon], [b.lat, b.lon]);
      startIdx--;
    }
  }
  return slicePath(path, pos[startIdx], pos[stopIndex]);
}
