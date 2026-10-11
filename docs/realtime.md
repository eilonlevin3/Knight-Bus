# Live buses

Requirements: REQ-RT-1, REQ-RT-2, REQ-RT-3. Code: [src/realtime.js](../src/realtime.js),
[src/liveLines.js](../src/liveLines.js). Decision: [ADR-0002](adr/0002-realtime-source.md).

## Where the data comes from

Israeli bus operators report every bus position to the **Ministry of Transport SIRI
service**. The government gives direct access only to registered developers, from a fixed
server IP address, so a phone browser cannot call it.

The **Open Bus Stride API** by the Public Knowledge Workshop (Hasadna) reads that government
feed every minute and republishes it as an open, CORS-enabled API. This MVP reads it from the
phone:

```
GET https://open-bus-stride-api.hasadna.org.il/siri_vehicle_locations/list
    ?siri_routes__line_ref=<GTFS route_id>
    &recorded_at_time_from=<now − 30 min>
    &recorded_at_time_to=<now + 2 min>
    &order_by=recorded_at_time desc
    &limit=300
```

The SIRI `LineRef` is the same number as the GTFS `route_id`, so a route from the city bundle
maps straight to its live buses. When this was written, positions were about 1–2 minutes old.

**When the feed runs late** (REQ-RT-9). The mirror loads the ministry's data in batches and
can fall behind: on 2026-10-11 it was 15–25 minutes behind all day. The app therefore asks
for the last 30 minutes, and any position older than 5 minutes is shown with
*⚠ Live data is late: positions are from 17 min ago*. The bus is drawn where it was then;
it has moved on since. This is another reason for REQ-RT-4 (reading the ministry directly).

The upper time bound matters: the feed has some rows with wrong future timestamps (year
2038), and they would otherwise sort first.

## What a bus tells us

Tap a bus on any map (REQ-RT-10). The pop-up shows the route, where the bus is relative to
your stop, and:

- **Last signal:** the date and time the bus reported, and how long ago that was. If it is
  more than 5 minutes old, a warning says the bus has moved on since.
- **What the signal says**, in plain words: position, speed (km/h), heading, kilometers
  driven since the trip started, when the trip was scheduled to start, the vehicle number,
  the trip reference, the operator code, how far the position is from the route on our map,
  and the batch the signal arrived in.
- **Everything in the signal, as it was sent:** the raw record, field by field, including
  the fields the feed leaves empty.

Nothing here is about a person: it is public data about a vehicle. Opening the pop-up is
counted as `bus_info_opened` (privacy.md); which bus is not recorded.

Code: [views/busInfo.js](../src/views/busInfo.js), [liveLines.js](../src/liveLines.js).

## The "next two + last passed" rule

For one route and one chosen stop:

1. Fetch the newest position of each ride (`siri_ride__id`) on the route in the last 30
   minutes. Drop rides whose newest position is more than 7 minutes behind the newest
   position on the route: those buses finished their trip.
2. **Place every stop on the route's path** (its shape), walking forward from the
   first stop. This keeps the stops in order even where a route comes back along the same
   street. The result is cached per route.
3. **Place each bus on the path:** take the nearest point on the path. The path is the most
   common stop pattern that passes the chosen stop. A bus is dropped only when it is more
   than 250 m from **every** stop pattern of the route (depot, bad GPS). A bus driving
   another pattern of the route stays, shown where it really is (REQ-RT-8). In a test on 2026-10-09,
   most live buses were within 30 m.
4. `nextStop` = the first stop at or after the bus's position.
   `stopsAway = index of chosen stop − nextStop`. Here 0 means "your stop is its next stop"
   (shown as *arriving*), and −1 means it passed your stop at its last stop.
5. **Next two** = the buses with `stopsAway ≥ 0`, closest first, at most 2.
6. **Last passed** = the bus with the largest negative `stopsAway`, at most 1.

Unit tests: [tests/core.test.mjs](../tests/core.test.mjs) (`npm test`).

On the map, approaching buses are solid and pulse; the passed bus is faded and dashed. Each
popup and panel row shows how old the position is.

When a Favorite Commute has two stops on the same route, one bus can be "passed" for stop 1 and
"next" for stop 2. It gets one marker that shows both facts.

## Refresh

Every 30 seconds (`realtime.refreshMs` in [src/config.js](../src/config.js)) while the screen
is visible. Updates pause when the app goes to the background and resume when it returns.
The app sends one request per route, all in parallel.

## Limits and next steps

- **Loops:** a *bus* is placed at its nearest point on the path. Where a route passes the
  same street twice, the bus can be put on the wrong leg. Using the previous position, or
  the feed's `distance_from_journey_start`, would fix it.
- **No arrival times yet.** REQ-RT-4 (Planned) adds a small proxy, for example a Cloudflare
  Worker, holding a ministry SIRI-SM key. SIRI-SM gives predicted arrival minutes per stop.
- **Third-party dependency.** If Stride is down, the panel says *Live data unavailable* and
  the map still works.
