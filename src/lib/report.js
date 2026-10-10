// Turns everyone's saved commutes into counts. No names, emails or account ids come out.
// Docs: docs/privacy.md#the-commute-report-admin-only
// @req REQ-ANL-2
//
// Stops are places, so a stop is listed only when at least MIN_PEOPLE_PER_STOP different
// people saved it; below that it could point at one person's home or work.

export const MIN_PEOPLE_PER_STOP = 3;

// docs: [{ uid, slot, fav }]  ->  plain counts
export function summarize(docs, { minPeoplePerStop = MIN_PEOPLE_PER_STOP } = {}) {
  const people = new Set();
  const perPerson = new Map();
  const byCity = new Map();
  const stopsPerCommute = { 1: 0, 2: 0 };
  const lines = new Map(); // `${cityId}|${routeId}` -> { cityId, routeId, commutes, people:Set }
  const stops = new Map(); // `${cityId}|${stopId}` -> { cityId, stopId, name, code, commutes, people:Set }
  const byMonth = new Map(); // 'YYYY-MM' -> commutes last saved that month
  let withStart = 0;
  let withDestination = 0;
  let withBoth = 0;
  let lineTotal = 0;
  let commutes = 0;

  for (const { uid, fav } of docs) {
    if (!fav || !Array.isArray(fav.stops) || !fav.stops.length) continue;
    commutes++;
    people.add(uid);
    perPerson.set(uid, (perPerson.get(uid) || 0) + 1);
    byCity.set(fav.cityId, (byCity.get(fav.cityId) || 0) + 1);
    stopsPerCommute[Math.min(2, fav.stops.length)]++;
    if (fav.origin) withStart++;
    if (fav.destination) withDestination++;
    if (fav.origin && fav.destination) withBoth++;
    if (fav.updatedAt) byMonth.set(fav.updatedAt.slice(0, 7), (byMonth.get(fav.updatedAt.slice(0, 7)) || 0) + 1);

    const lineIds = new Set();
    for (const st of fav.stops) {
      const sKey = `${fav.cityId}|${st.stopId}`;
      const s = stops.get(sKey) || { cityId: fav.cityId, stopId: st.stopId, name: st.stopName, code: st.stopCode, commutes: 0, people: new Set() };
      s.commutes++;
      s.people.add(uid);
      stops.set(sKey, s);
      for (const id of st.routeIds || []) lineIds.add(id);
    }
    lineTotal += lineIds.size;
    for (const id of lineIds) {
      const lKey = `${fav.cityId}|${id}`;
      const l = lines.get(lKey) || { cityId: fav.cityId, routeId: id, commutes: 0, people: new Set() };
      l.commutes++;
      l.people.add(uid);
      lines.set(lKey, l);
    }
  }

  const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);
  const commutesPerPerson = { 1: 0, 2: 0, 3: 0 };
  for (const n of perPerson.values()) commutesPerPerson[Math.min(3, n)]++;
  const allStops = [...stops.values()];

  return {
    people: people.size,
    commutes,
    commutesPerPerson,
    byCity: sorted(byCity).map(([cityId, count]) => ({ cityId, count })),
    stopsPerCommute,
    withStart,
    withDestination,
    withBoth,
    averageLines: commutes ? Math.round((lineTotal / commutes) * 10) / 10 : 0,
    byMonth: [...byMonth.entries()].sort().map(([month, count]) => ({ month, count })),
    topLines: [...lines.values()]
      .map((l) => ({ cityId: l.cityId, routeId: l.routeId, commutes: l.commutes, people: l.people.size }))
      .sort((a, b) => b.people - a.people || b.commutes - a.commutes),
    topStops: allStops
      .filter((s) => s.people.size >= minPeoplePerStop)
      .map((s) => ({ cityId: s.cityId, stopId: s.stopId, name: s.name, code: s.code, commutes: s.commutes, people: s.people.size }))
      .sort((a, b) => b.people - a.people || b.commutes - a.commutes),
    stopsHidden: allStops.filter((s) => s.people.size < minPeoplePerStop).length,
  };
}
