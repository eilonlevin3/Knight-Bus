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
- the **ordered list of stops** from first to last, for **every stop pattern** the line has
  (see below);
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
   `agency.txt` → `routes.txt` (bus only, `route_type = 3`) → `calendar.txt` → `trips.txt`
   → `stop_times.txt` (every trip, one at a time) → `stops.txt` → `shapes.txt` (only the
   shapes used).
3. **Simplify** each shape with the Ramer–Douglas–Peucker algorithm.
4. **For each city** in [pipeline/cities.json](../pipeline/cities.json): keep every line with
   **at least one stop inside the city box**. The whole line is kept, so a line that leaves
   the city still draws from end to end. Keep the stops those lines use.
5. **Write** `data/cities/<city>.json` and `data/cities/index.json`. Each bundle gets a
   content hash as its version, and the app re-downloads only when the version changes.

## Stop patterns: a line is not always one route

Until 2026-10-10 the pipeline kept the stops of each line's *first* trip, assuming all
trips of a GTFS `route_id` serve the same stops. They don't: in that day's feed 142 of
6,596 bus lines had two stop patterns or more. So line 62 was missing at Dizengoff/Sheinkin
(94 of its trips stop there, 92 don't), and line 445 was there one day and gone the next.

Now (REQ-DATA-8) every trip is read. Trips with the same stop list form a **pattern**, and
a line keeps its patterns sorted by how many trips of the **coming week** use them (up to
four). The most common is the "usual route"; the others carry their share in percent. The
line is listed at every stop any pattern serves. In the feed of 2026-10-10: 68 lines had
variants this week, 36 of them in the Tel Aviv file.

## Timetable files

For the schedule screen (REQ-DATA-9) the pipeline writes `data/schedules/<line id>.json`
for every published government line: the patterns with minutes to each stop, and one
entry per trip of the coming week. Only services whose dates overlap the next seven days
count. 4,246 files, 3.5 MB in total, each loaded only on demand.

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

**Live positions: looked for, not found.** Moovit, Rav-Pass and Google Maps do show these
buses live, so the operators send positions to those companies. No public source carries
them (checked 2026-10-10, a Saturday, at 09:10 and at 13:18 local time):
- the ministry's SIRI feed through Stride: 1,650 live vehicle records at 13:18, every one
  on a GTFS line, and none within 400 m of a stop served only by 705/710/716;
- busofash.co.il: no live map, it points to the three apps;
- the Tel Aviv municipality map server: lines and stops only, no vehicle layer.

So the app marks these lines clearly as weekend lines without live tracking (REQ-RT-6).
Getting live data needs the operator or the municipalities to share a feed (REQ-RT-7).

### Sababus

*Sababus* (סבבוס) is Ramat Gan's free weekend service: four lines named by color (green,
blue, red, white), Friday evening and Saturday. Like Naaim BeSofash it is run by the
"נוע תנוע" organisation ([noat.co.il](https://www.noat.co.il/routes)) and is in neither
government feed.

The pipeline reads the operator's public Google map, exported as KML
([pipeline/sources/noat.mjs](../pipeline/sources/noat.mjs)). It has route shapes per line
and stops labelled with **line and direction**, but no stop codes. So:
1. each direction takes the shape its stops fit best;
2. stops are ordered along that shape;
3. each stop is matched to the national stop within 25 m, or to one with the same name
   within 100 m ("דיזנגוף/שד' נורדאו" = "שדרות נורדאו/דיזנגוף"). On 2026-10-10: 294
   matched, 11 became stops of their own.

4. **Follow Moovit where the map and Moovit disagree** (the owner's rule, 2026-10-10). A
   stop the operator's map places where no national stop exists is attached to the
   nearest real bus stop within 200 m that lies on the line's own path, on the side buses
   stop on (`snapMeters` in `cities.json`). Example: the map puts the green and blue lines
   at "Dizengoff/Ben Gurion" and "Dizengoff/Gordon", where there is no stop; Moovit shows
   them at Dizengoff/Sheinkin (25778) between the two, and so do we. After this step 306
   stops are matched and 4 remain stops of their own.

Both sources are set in `extraSources` in [pipeline/cities.json](../pipeline/cities.json). If
a server is down or blocks GitHub's runners, the build logs a warning and continues
without these lines. There is no timetable, so the "5 minutes before your stop" zoom uses
the ~1.5 km fallback.

## Platforms: stops that share a number

At a terminal the feed has one "station" record and one stop record per platform, all with
the same `stop_code` and position (236 codes nationally). The pipeline:
- reads the platform and floor out of `stop_desc` ("… רציף: 12 קומה: 6"); a platform or
  floor of `0` means "none";
- writes them as the stop's optional 6th entry, only for stops whose code is shared
  (REQ-STOP-1);
- ignores the station record when matching stops by code or position, so weekend lines
  attach to a real platform.

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
