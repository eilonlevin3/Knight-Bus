# Data model

## Favorite Commute

Stored in Firestore at `users/{uid}/favorites/{slot}`, where `slot` is `"1"`, `"2"` or `"3"`.
The debug version uses `users/{uid}/favoritesDebug/{slot}` ([release-process.md](release-process.md)).
Written by [src/store.js](../src/store.js). Protected by [firestore.rules](../firestore.rules):
a user can read and write only their own Favorite Commutes, and a Favorite Commute has 1–2 stops.

```json
{
  "name": "To work",
  "cityId": "tel-aviv",
  "stops": [
    { "stopId": "12345", "stopName": "Dizengoff Center", "stopCode": "21471", "routeIds": ["10931", "10936"] },
    { "stopId": "23456", "stopName": "Azrieli",          "stopCode": "21233", "routeIds": ["10931"] }
  ],
  "origin":      { "lat": 32.0791, "lon": 34.7739, "label": "Dizengoff 50, Tel Aviv" },
  "destination": { "lat": 32.0741, "lon": 34.7922, "label": "Azrieli Center, Tel Aviv" },
  "updatedAt": "2026-10-09T18:00:00.000Z"
}
```

- `origin` and `destination` are optional (REQ-FAV-5): missing or `null` means not set.
  Older versions of the app ignore them, so Favorite Commutes saved by a newer version still open
  in an older one.

- `stopId` and `routeIds` are GTFS IDs, and they match the city bundle.
- `stopName` and `stopCode` are copies, so the home screen can show them without loading the bundle.
- `cityId` lets a Favorite Commute from another city still open; the app loads that city's bundle.

In local demo mode the same objects are stored in `localStorage` under `kb.favorites.local`.

## Admins

`admins/{uid}`: any document here makes that account an admin (may open the Favorite Commute
report). Created by hand in the Firebase console; the rules allow the app only to read
your own entry.

## Debug detail events

Only written by the debug version, after the tester agreed ([privacy.md](privacy.md)).
`users/{uid}/debugEvents/{auto id}`:

```json
{ "name": "commute_opened", "channel": "debug", "at": "2026-10-10T07:30:00.000Z",
  "detail": { "slot": 1, "commute": { "…": "the saved commute" }, "position": { "lat": 32.08, "lon": 34.78, "accuracy": 12 } } }
```

## City index

`data/cities/index.json`, written by the pipeline:

```json
{
  "v": 1, "country": "IL", "generatedAt": "2026-10-09T01:40:00Z",
  "cities": [
    { "id": "tel-aviv", "name": "Tel Aviv – Gush Dan", "nameHe": "תל אביב – גוש דן",
      "bbox": [34.70, 31.86, 35.02, 32.22], "center": [32.0853, 34.7818],
      "file": "tel-aviv.json", "version": "a1b2c3d4e5f6", "bytes": 5123456, "stops": 9000, "routes": 2500 }
  ]
}
```

## City bundle

`data/cities/<id>.json`. The format is compact: rows are arrays, not objects, to keep
downloads small. It is read by [src/cityData.js](../src/cityData.js).

```json
{
  "v": 1,
  "cityId": "tel-aviv",
  "generatedAt": "…",
  "agencies": ["Dan", "Egged", "…"],
  "stops":  [[ "12345", "21471", "Dizengoff Center", 32.075, 34.775 ], …],
  "routes": [[ "10931", "5", "Bat Yam", 0, 3, [17, 4, 88, …], "encodedPolyline", [0, 2, 4, …] ],
             [ "busofash-708-1", "708", "רמת החייל", 6, 3, [ … ], "encodedPolyline", null, "busofash" ], …],
  "sources": { "busofash": { "name": "נעים בסופ\"ש", "hours": "Fri 16:30–02:00 · Sat 09:00–17:30", "info": "https://busofash.co.il/" } }
}
```

| Field | Row layout |
|-------|------------|
| `stops[i]` | `[stopId, stopCode, name, lat, lon, place?]` |
| `routes[j]` | `[routeId, routeNumber, destination, agencyIndex, routeType, stopIndexes[], shape, minutes[], source?, otherPatterns?, oppositeRouteId?, mergedIds?]` |

- `place` (optional) is `"platform/floor"`, for example `"634/6"` or `"2"`. It is given only
  for stops that share their stop code with other stops (REQ-STOP-1).
- `stopIndexes` are positions in `stops[]`, in travel order, from first stop to last.
- `minutes[]` (REQ-DATA-6) has one entry per stop: scheduled minutes from the first stop,
  from the route's representative trip. It may be `null`. Older apps ignore it.
- `mergedIds` (optional, 12th entry) lists the `route_id`s of the ministry's "alternatives"
  that were merged into this route (REQ-DATA-10). The app asks for live buses under each of
  them, and reads a Favorite Commute saved with one of them as this route.
- `oppositeRouteId` (optional, 11th entry; the two before it are then `null` and `[]` if
  not set) is the route that runs the same service in the other direction (REQ-ROUTE-2).
  Missing for circular and one-way routes.
- `source` (optional, 9th entry) marks a route from outside the government feed (REQ-DATA-7).
  Its details are in `sources`. These routes have no live buses.
- `otherPatterns` (optional, 10th entry; `source` is then `null` if not set) lists the route's
  less common stop patterns (REQ-DATA-8): `[[stopIndexes[], shape, minutes[], share], …]`,
  where `share` is the percent of the week's trips. Entries 6–8 describe the most common pattern,
  whose share is 100 minus the others. Older apps ignore the entry.
- `shape` is a Google encoded polyline, precision 5. The encoder and decoder are shared in
  [src/lib/polyline.js](../src/lib/polyline.js).

When the app loads a bundle, it builds a `stop → lines` index in memory. That index
answers "which routes serve this stop" (REQ-EDIT-2).

## Route timetable

`data/schedules/<routeId>.json` (REQ-DATA-9), read by [src/lib/schedule.js](../src/lib/schedule.js):

```json
{ "v": 1, "routeId": "23918",
  "patterns": [ { "stops": ["51529", "13662", "…"], "offsets": [0, 2, 3, 5] }, { "stops": ["…"], "offsets": [0, 2, 4] } ],
  "trips": [ [62, 350, 0], [62, 365, 1], [64, 540, 0] ] }
```

- `patterns` are in the same order as in the city bundle: most common first.
- `offsets`: scheduled minutes from the first stop to each stop.
- `trips`: `[day mask, start minute of the day, pattern index]`. Day mask bit 0 is Sunday,
  bit 6 Saturday (62 = Monday to Friday). A time at a stop is start + that stop's offset.

## Travel times of a route

`data/speeds/<route id>.json`, made by [pipeline/build-speeds.mjs](../pipeline/build-speeds.mjs)
(REQ-DATA-12). Loaded by [src/lib/speeds.js](../src/lib/speeds.js) only when a ghost is
turned on for a bus of that route.

```json
{
  "v": 1, "days": 30, "from": "2026-09-13", "to": "2026-10-12",
  "segments": {
    "12345>12346": [null, null, 41, 38, "…96 half hours…", 52, 44]
  }
}
```

- A key is a stretch: the stop id it starts at, `>`, the stop id it ends at.
- The list has 98 entries, each the average **seconds** for that stretch, or `null` when
  fewer than 3 trips were seen:
  - 0–47: the half hours of a **weekday** (Sunday to Thursday); entry 34 is 17:00–17:30;
  - 48–95: the half hours of the **weekend** (Friday and Saturday);
  - 96: the whole-day average on weekdays; 97: on the weekend.
- `days` says how many days are in the average (fewer than 30 while the month fills in).
- Times are Israel time. A route with no measured stretch has no file.

`data/speeds/index.json` lists the days in the average.

## Device storage

| Store | Key | What |
|-------|-----|------|
| Cache `kb-shell-v1` | URLs | App files (sw.js) |
| Cache `kb-tiles-v1` | tile URLs | Map tiles, up to 3,000 (sw.js) |
| Cache `kb-city-data-v1` | `<file>?v=<version>` | City index and bundles (cityData.js) |
| localStorage `kb.cityId` | | Selected city |
| localStorage `kb.view.<account>.<slot>` | | The opening view chosen for a Favorite Commute: `{ lat, lon, zoom, panel, keyOpen }` (REQ-FAV-6); `panel` is `small`, `half` or `large`. Not in the account: a zoom chosen on one screen does not suit another, and it needs no change to the database rules |
| localStorage `kb.localUser`, `kb.favorites.*` | | Local demo mode only |
| Firestore offline cache | | Favorite Commutes, readable offline (store.js) |
