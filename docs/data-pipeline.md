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

### Weekend lines outside the government feed

*Naaim BeSofash* ([busofash.co.il](https://busofash.co.il/)) is a weekend service run by
12 Gush Dan municipalities: 18 lines (705–718, 721–723, 729, e.g. 708 Ramat HaChayal ↔
Fighters' Terminal), Fri 16:30–02:00 and Sat 09:00–17:30. It is **not** in the ministry's
GTFS, and its buses are not in the SIRI live feed. On Saturday 2026-10-10, every live bus
in the feed belonged to a GTFS line.

The pipeline reads it from the **Tel Aviv municipality's public ArcGIS server** (REQ-DATA-7,
[pipeline/sources/busofash.mjs](../pipeline/sources/busofash.mjs)). This is the server
behind busofash.co.il's own map:

| Layer | Content |
|-------|---------|
| `IView2/MapServer/992` | one path per line direction ("מכפר סבא אל תל אביב" = from Kfar Saba to Tel Aviv) |
| `IView2/MapServer/993` | stops per line, with national stop codes (98% match GTFS stops) |

How it becomes lines like the others:
1. **Stops per direction.** The server lists a line's stops without direction. A stop goes
   to a direction when it is within 35 m of that direction's path and on its **right-hand
   side** (Israel drives on the right). A stop that fits neither direction goes to the
   nearest one.
2. **Order.** Stops are sorted by their position along the path.
3. **Same stops.** Stop codes are matched to national stops, so 708 shows up in the line
   list of Dizengoff/Sheinkin together with the government lines. The few unknown codes
   (18) become extra stops.
4. Marked with `source: "busofash"` in the bundle. The app shows **no live tracking**
   for these lines, with their hours (REQ-RT-5).

The source is set in `extraSources` in [pipeline/cities.json](../pipeline/cities.json). If
the server is down or blocks GitHub's runners, the build logs a warning and continues
without these lines. There is no timetable, so the "5 minutes before your stop" zoom uses
the ~1.5 km fallback.

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
