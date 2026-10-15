// Which ghosts a Favorite Commute shows by itself (REQ-RT-13).
// Docs: docs/realtime.md#ghosts-in-a-favorite-commute
//
// Pure function, so it is unit tested.

export const KEEP_AFTER_PASSING = 60; // seconds a ghost stays on after it passes the stop
export const NEXT_BEFORE_ARRIVING = 60; // seconds before a ghost reaches the stop, the one behind it comes on

// buses: [{ id, seconds }] for one route at one stop. `seconds` is when the bus's ghost
// reaches the stop: in that many seconds (positive), or that many seconds ago (negative).
// Returns the ids to show:
//   - the ghost closest to the stop, as long as it has not passed it more than a minute ago;
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
