# Data model

## Favorite

Stored in Firestore at `users/{uid}/favorites/{slot}`, where `slot` is `"1"`, `"2"` or `"3"`.
Written by [src/store.js](../src/store.js). Protected by [firestore.rules](../firestore.rules):
a user can read and write only their own favorites, and a favorite has 1–2 stops.

```json
{
  "name": "To work",
  "cityId": "tel-aviv",
  "stops": [
    { "stopId": "12345", "stopName": "Dizengoff Center", "stopCode": "21471", "routeIds": ["10931", "10936"] },
    { "stopId": "23456", "stopName": "Azrieli",          "stopCode": "21233", "routeIds": ["10931"] }
  ],
  "updatedAt": "2026-10-09T18:00:00.000Z"
}
```

- `stopId` and `routeIds` are GTFS IDs, and they match the city bundle.
- `stopName` and `stopCode` are copies, so the menu can show them without loading the bundle.
- `cityId` lets a favorite from another city still open; the app loads that city's bundle.

In local demo mode the same objects are stored in `localStorage` under `kb.favorites.local`.

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
  "routes": [[ "10931", "5", "Bat Yam", 0, 3, [17, 4, 88, …], "encodedPolyline" ], …]
}
```

| Field | Row layout |
|-------|------------|
| `stops[i]` | `[stopId, stopCode, name, lat, lon]` |
| `routes[j]` | `[routeId, lineNumber, destination, agencyIndex, routeType, stopIndexes[], shape]` |

- `stopIndexes` are positions in `stops[]`, in travel order, from first stop to last.
- `shape` is a Google encoded polyline, precision 5. The encoder and decoder are shared in
  [src/lib/polyline.js](../src/lib/polyline.js).

When the app loads a bundle, it builds a `stop → lines` index in memory. That index
answers "which lines serve this stop" (REQ-EDIT-2).

## Device storage

| Store | Key | What |
|-------|-----|------|
| Cache `kb-shell-v1` | URLs | App files (sw.js) |
| Cache `kb-tiles-v1` | tile URLs | Map tiles, up to 3,000 (sw.js) |
| Cache `kb-city-data-v1` | `<file>?v=<version>` | City index and bundles (cityData.js) |
| localStorage `kb.cityId` | | Selected city |
| localStorage `kb.localUser`, `kb.favorites.*` | | Local demo mode only |
| Firestore offline cache | | Favorites, readable offline (store.js) |
