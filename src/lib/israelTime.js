// Time in Israel, whatever the phone's own time zone. Timetables are in Israel time.
// Used by the train and light rail station screens (REQ-TRAIN-2).

const parts = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  : null;
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// { day: 0 (Sunday) .. 6, minutes: minutes since midnight } in Israel now (or at `date`).
export function israelNow(date = new Date()) {
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: DAYS[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// Minutes since midnight, Israel time, of a moment written as an ISO time; NaN if unreadable.
export function israelMinutesOf(iso) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? israelNow(new Date(time)).minutes : NaN;
}

// 1450 -> "00:10" (timetables count past midnight as 24:10)
export const clock = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.round(minutes) % 60).padStart(2, '0')}`;
