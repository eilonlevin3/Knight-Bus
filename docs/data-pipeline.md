# Data pipeline: national GTFS → one bundle per city

Requirement: REQ-DATA-2. Code: [pipeline/build-city-data.mjs](../pipeline/build-city-data.mjs).
Runs in: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml), every night and on every push to `main`.

## Why

The Ministry of Transport publishes **one zip for the whole country**
(`https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip`). It is hundreds of MB,
and `stop_times.txt` alone has tens of millions of rows. A phone cannot download that.
The pipeline keeps only what the app needs and splits it by city, so a phone downloads
only its own city, in a few MB.

## What it keeps

For each bus line (GTFS `route_id`; in Israel this is one direction and one variant of a line):

- line number, destination, operator;
- the **ordered list of stops** from first to last (taken from one representative trip);
- the **scheduled minutes** from the first stop to each stop, from the same trip
  (REQ-DATA-6). It is used to zoom the commute view to the last 5 minutes before your stop;
- the **route shape** (the road path), simplified to about 4 m accuracy and stored as an
  encoded polyline.

For each stop: ID, the code printed on the sign, name, position.

It drops timetables, calendars and fares. Live data covers "when is my bus", and see
[realtime.md](realtime.md).

## Steps

1. **Download** the national zip, or reuse `.cache/gtfs.zip` if it is less than 20 hours old.
2. **Stream** the CSV files out of the zip, without unzipping them to disk:
   `agency.txt` → `routes.txt` (bus only, `route_type = 3`) → `trips.txt` (first trip of
   each route) → `stop_times.txt` (stop order for those trips only) → `stops.txt` →
   `shapes.txt` (only the shapes used).
3. **Simplify** each shape with the Ramer–Douglas–Peucker algorithm.
4. **For each city** in [pipeline/cities.json](../pipeline/cities.json): keep every line with
   **at least one stop inside the city box**. The whole line is kept, so a line that leaves
   the city still draws from end to end. Keep the stops those lines use.
5. **Write** `data/cities/<city>.json` and `data/cities/index.json`. Each bundle gets a
   content hash as its version, and the app re-downloads only when the version changes.

## Which lines are included

**All bus lines in the government feed, on every day they run** (REQ-DATA-5). The pipeline
has no calendar filter, so weekday, Friday, Saturday and Saturday-night lines are all in. In
the feed of 2026-10-09, the Tel Aviv bundle held 174 weekend-only lines, and 929 lines that
run at some point on Saturday.

**Lines outside the government feed are missing** (REQ-DATA-7, planned). Some weekend
services are run by municipalities, for example Tel Aviv's Shabbat lines, and are not
published in the ministry's GTFS or SIRI feeds. In the 2026-10-09 feed, the only `708`
is a Kavim weekday line outside our four cities, and the Stride archive shows no other
`708` in recent weeks. To add such lines we need a source: an official GTFS from the
operator or municipality, or hand-entered routes. Without SIRI data they would also have
no live buses.

## Adding a city

Add an entry to [pipeline/cities.json](../pipeline/cities.json):

```json
{ "id": "netanya", "name": "Netanya", "nameHe": "נתניה",
  "bbox": [34.83, 32.27, 34.90, 32.36], "center": [32.3215, 34.8532] }
```

`bbox` is `[minLon, minLat, maxLon, maxLat]`. When boxes overlap, the app picks the smallest
box that contains the user. Push the change; the next deploy builds the new city.

## Running it locally

Needs Node 22 or newer.

```sh
npm install
npm run build:data                  # all cities, about 3 minutes
CITIES=jerusalem npm run build:data # one city
GTFS_ZIP=~/Downloads/israel.zip npm run build:data
```

## Known risks

- **Access from abroad.** The ministry server is sometimes reported to block foreign IPs. It worked for a test download when this was
  written. If it starts blocking GitHub's US runners, download the zip from Israel and run
  the pipeline with `GTFS_ZIP`. Another option is a self-hosted runner.
- **Feed format changes.** The parser reads columns by header name, so new columns are fine.
  Renamed columns would break it.
