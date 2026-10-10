// Reading a line's timetable file (data/schedules/<line>.json). Docs: docs/data-model.md#line-timetable
// @req REQ-LINE-4

// Scheduled times of a line at one stop on one weekday. schedule: the line's timetable file.
// Returns [{ minute, pattern }] sorted.
export function timesAtStop(schedule, stopId, day) {
  const out = [];
  const index = schedule.patterns.map((p) => p.stops.indexOf(stopId));
  for (const [mask, start, pi] of schedule.trips) {
    if (!(mask & (1 << day)) || index[pi] < 0) continue;
    const offset = schedule.patterns[pi].offsets?.[index[pi]];
    if (offset == null) continue;
    out.push({ minute: start + offset, pattern: pi });
  }
  return out.sort((a, b) => a.minute - b.minute);
}
