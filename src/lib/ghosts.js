// Which ghosts a Favorite Commute shows by itself (REQ-RT-13), and the timer under a ghost (REQ-RT-14).
// Docs: docs/realtime.md#ghosts-in-a-favorite-commute
//
// Pure function, so it is unit tested.

export const KEEP_AFTER_PASSING = 120; // seconds a ghost stays on after it passes the stop (owner, 2026-10-25)
export const NEXT_BEFORE_ARRIVING = 60; // seconds before a ghost reaches the stop, the one behind it comes on

// buses: [{ id, seconds }] for one route at one stop. `seconds` is when the bus's ghost
// reaches the stop: in that many seconds (positive), or that many seconds ago (negative).
// Returns the ids to show:
//   - the ghost closest to the stop, as long as it has not passed it more than two minutes ago;
//   - and the one behind it, once that first ghost is a minute or less from the stop (or
//     past it).
export function pickAutoGhosts(buses) {
  const waiting = buses
    .filter((b) => Number.isFinite(b.seconds) && b.seconds >= -KEEP_AFTER_PASSING)
    .sort((a, b) => a.seconds - b.seconds);
  if (!waiting.length) return [];
  const [first, second] = waiting;
  return first.seconds <= NEXT_BEFORE_ARRIVING && second ? [first.id, second.id] : [first.id];
}

// The timer under a ghost (REQ-RT-14): seconds until it reaches the stop, as "m:ss"; after
// it has passed the stop, counting on below zero ("-0:35").
export function countdown(seconds) {
  const s = Math.round(seconds || 0);
  const a = Math.abs(s);
  return `${s < 0 ? '-' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

// The ± beside the timer (REQ-RT-14): "±25s" under a minute, "±1:20" from a minute up.
export function plusMinus(seconds) {
  const s = Math.max(1, Math.round(seconds));
  return s < 60 ? `±${s}s` : `±${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Which stop a ghost's timer is about. rows: [{ row, seconds }] for every stop on screen the
// bus matters for (seconds as in pickAutoGhosts). A stop the ghost passed less than two
// minutes ago comes first (the timer runs below zero); otherwise the next one it reaches.
export function timerStop(rows) {
  const known = rows.filter((x) => Number.isFinite(x.seconds));
  const passed = known.filter((x) => x.seconds < 0 && x.seconds >= -KEEP_AFTER_PASSING).sort((a, b) => b.seconds - a.seconds);
  if (passed.length) return passed[0];
  return known.filter((x) => x.seconds >= 0).sort((a, b) => a.seconds - b.seconds)[0] || null;
}
