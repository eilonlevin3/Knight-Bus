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

## The relay

Stride's delay comes from its loading step, not from the buses (REQ-RT-11,
[ADR-0011](adr/0011-live-relay.md)). The Open Bus project also publishes what it loads
*from*: one file a minute with every bus in the country.

```
https://openbus-stride-public.s3.eu-west-1.amazonaws.com/stride-siri-requester/YYYY/MM/DD/HH/MM.br   (UTC)
```

Each file appears less than a minute after its minute, is about 250 KB packed (brotli) and
4 MB unpacked, and holds about 9,000 bus records in the ministry's own wording. A browser
cannot read it directly, so [relay/worker.js](../relay/worker.js) stands in between:

```mermaid
sequenceDiagram
  participant App
  participant Relay as Relay (Cloudflare Worker)
  participant Files as Open Bus files
  participant Stride as Open Bus Stride
  App->>Relay: /live?routes=23918,24041
  Relay->>Files: newest file (once a minute)
  Relay-->>App: only those routes' buses
  Note over App,Stride: relay not set up, or no answer in 8 s
  App->>Stride: one request per route id (as before)
```

- **The question:** `GET <relay>/live?routes=<id>,<id>…`, up to 80 route ids. One request
  covers every route on the screen, with all the ids of merged alternatives (REQ-DATA-10).
- **The answer:** `{ snapshot, at, routes: { "<id>": [records…] } }`. `snapshot` is the
  file's minute, `at` the time it was made. The app turns each record into the same bus
  object as a Stride row (`busFromRecord`), so everything after it is unchanged.
- **The file also holds buses last heard long ago.** The app keeps positions from the last
  30 minutes and drops finished rides, exactly as with Stride (REQ-RT-9).
- **Only our app may read the answers from a browser:** the relay allows
  `https://eilonlevin3.github.io` and a developer's `localhost`.
- **Turning it on:** `realtime.relayUrl` in [src/config.js](../src/config.js). Empty means
  Stride only. Putting the relay online: [setup.md](setup.md#6-the-live-relay).
- **Time limits:** 8 seconds for the relay, then Stride; 20 seconds for Stride, then the
  row says *Live data unavailable right now*.
- **Buses that went quiet.** A bus stays in the file for about half an hour after its last
  signal (its trip ended, or its radio stopped). When the file itself is up to date (made
  in the last 3 minutes), such a bus is left out once it has said nothing for 7 minutes.
  Only when the whole feed is late are older positions shown, marked as late (REQ-RT-9).
  Until 2026-10-15 these quiet buses were shown as "late" positions up to 30 minutes old.
- **Every 15 seconds.** The file changes once a minute; asking every 15 seconds picks up a
  new one within 15 seconds of the relay having it.
- **The line under each list** says when it was updated, how old the newest position is,
  and which way it came: *via our relay*, or *via Open Bus Stride (the relay did not
  answer: …)* with the reason. That is the first thing to look at when buses seem late.

The header `x-relay` on every answer says how the relay got its data (`built`, `cache` or
`memo`) and how long it took, for checking that it runs within Cloudflare's limits.

## Train platforms

Platforms are not in the ministry's timetable data. Israel Railways has them, in the
timetable service its own website (rail.co.il) uses. The relay asks it (REQ-TRAIN-6):

```
GET <relay>/rail-board?station=3700&ends=2800,1600,7320&date=2026-10-16
-> { station, date, trains: [{ train: 6131, time: "10:47", platform: 3, to: 400, from: 3700 }, …] }
```

- `station` and `ends` are **Israel Railways' station numbers**, which differ from the
  ministry's. The table that links the two is
  [lib/railStations.js](../src/lib/railStations.js), matched by name and checked by hand.
- The service only answers "from A to B", so the relay asks from this station to each end
  station of the trains leaving it (the app sends those), and keeps the trains that leave
  from this station. It keeps a station's answer for 10 minutes. At Tel Aviv Merkaz that is
  about 110 trains a day, in under a second.
- The app puts each platform on its own timetable: the Israel Railways train to the same
  end station that is closest in time (up to 10 minutes apart), each used once.
- **This is not a documented, public interface.** It is what the website calls, with the
  key the website gives every visitor. It can change or stop without notice; then the
  station timetable is simply shown by time, without platforms. Israel Railways sees the
  relay's address, not the person's.
- The light rail is not run by Israel Railways, so light rail stops have no platforms.

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

The pop-up can be longer than the screen. Its **Close** button stays at the bottom while
the rest scrolls, so it can be closed without scrolling (the same in every pop-up).

Nothing here is about a person: it is public data about a vehicle. Opening the pop-up is
counted as `bus_info_opened` (privacy.md); which bus is not recorded.

Code: [views/busInfo.js](../src/views/busInfo.js), [liveLines.js](../src/liveLines.js).

## The ghost: an estimate of where the bus is now

A bus's last signal is always a little old: about a minute through the relay, much more
when the feed is late. The ghost (REQ-RT-12) shows where the bus has probably got to since.

- **Only on request.** Tap a bus, and in its pop-up press **Show the ghost on the map**.
  It is for that one bus. Tap the bus or its ghost again and press **Remove the ghost**.
- **How it is worked out.** The last signal is placed on the route's path. The time since
  the signal is then spent moving forward along the path, stretch by stretch. How long a
  stretch between two stops takes comes from, in this order:
  1. **a month of real trips** (REQ-DATA-12): the average time buses took on that stretch
     in this half hour of the day, weekdays and the weekend apart; if that half hour has
     too few trips, the stretch's average over the whole day;
  2. the **timetable**: the scheduled minutes between the two stops;
  3. 18 km/h, where there is neither.

  Within a stretch the ghost moves evenly. It never passes the last stop and never runs
  more than 30 minutes ahead.
- **The month's numbers are fetched only now.** Turning a ghost on downloads one small file
  for that route ([data-model.md](data-model.md#travel-times-of-a-route)). With no ghost
  on, the app never asks for it. How the numbers are made and kept up to date:
  [data-pipeline.md](data-pipeline.md#travel-times-a-month-of-history).
- **How it looks.** A see-through marker with a dashed edge and a 👻, in the route's color,
  with a dotted trail from the real position to it. It moves twice a second. The real
  marker stays where the last signal was.
- **What it does not know.** Today's traffic: it knows what is usual for this hour, not
  what is happening now. It is an estimate, and the pop-up says so. When a new signal arrives, the ghost
  starts again from it.
- If the bus is more than 250 m from the route as our map has it, no ghost is offered.

- **The timer under it** (REQ-RT-14). Opened from a selected station or a Favorite Commute,
  the ghost has a small timer under it, in minutes and seconds (`4:07`): the estimated time
  until the ghost reaches that stop, with the same travel times that move it. It changes
  every time the ghost moves (twice a second). When the bus is coming to more than one
  stop on screen, it counts to the first one it reaches. At or past the stop it reads
  `0:00`; a bus that has passed every stop on screen has no timer.

"Stops away" in the lists still counts from the real signal, not from the ghost.

## Ghosts in a Favorite Commute

In a Favorite Commute (REQ-RT-13) ghosts come on by themselves, so the bus you wait for is
always moving on the map between signals:

- For **every route shown at every stop**, the ghost of the bus whose ghost will reach the
  stop next is on.
- When that ghost is **one minute or less from the stop**, the ghost of the bus behind it
  comes on as well.
- **One minute after a ghost passes the stop**, it goes off; the one behind it is then the
  closest.
- A route that is unchecked shows no ghost. A ghost you remove in the bus's pop-up stays
  off for that bus; you can turn it on again there.

The rule is checked twice a second, with the same estimate as a ghost turned on by hand.
Code: [lib/ghosts.js](../src/lib/ghosts.js) (`pickAutoGhosts`), [liveLines.js](../src/liveLines.js)
(`autoGhostIds`).

## Live traffic in a Favorite Commute

The month's history knows what is usual, not today's traffic: in rush hour the ghost runs
ahead of the bus. In a Favorite Commute (REQ-RT-15) the phone also learns how long buses
are taking **right now**, with no server and no cost. The idea and its measurement are in
the design review [reviews/2026-10-19-ghost-estimation-dr.html](reviews/2026-10-19-ghost-estimation-dr.html)
("idea 1"), done here on the phone instead of on the relay.

- **What is learned.** Every 15 s the commute already asks for its routes' buses, all along
  the routes. Each bus's place along its route is noted; a bus seen passing two stops in a
  row gives that stretch a **live time** (the time between the two stops, shared out by
  distance between its signals, as the nightly statistics do). Times are kept for **20
  minutes**, by stop pair, so routes that share a street share what they learn. They stay
  while the app is open, also when the commute is closed and opened again.
- **How it is used.** On each stretch the ghost moves by
  `w × median(live times) + (1 − w) × history`, with `w = n ÷ (n + 4)` for n live times. One
  bus counts a fifth, four buses half. Without history, two live times or more are used as
  they are. In the recorded-bus test this was 5–9% better in rush hour and the same at
  midday.
- **⏳ Learning / ⚡ On.** A ghost uses live traffic only once **at least half of its way**
  from the last signal to your stop (counted in time) has live times. Until then it shows ⏳
  and moves as before, by the month's history; then ⚡. Right after a commute is opened
  this takes a few minutes: buses have to be seen driving.
- **The ring** (only while ⚡). How good the estimate is believed to be, from the recorded-bus
  test: by the age of the last signal, 90% of errors were within 56 s (1 min old), 91 s (2
  min), 119 s (3 min), 164 s (5 min). **Green**: that is 90 s or less and the live times
  count at least 40% on the way. **Yellow**: 165 s or less. **Red**: more.
- **On or off.** In each ghost's pop-up: *Turn off live traffic for this ghost* (then it uses
  the month's history only) or *Turn on*. It is on by default, and the choice holds while
  the commute is open.
- Only in a Favorite Commute: stations and the home map do not learn.

Code: [lib/liveStretches.js](../src/lib/liveStretches.js) (`LiveStretches`, `blend`,
`confidence`), [liveLines.js](../src/liveLines.js) (`learnFrom`, `liveOf`, `secondsOfFor`).

Code: [liveLines.js](../src/liveLines.js) (`ghostOf`, `drawGhosts`),
[lib/routeGeometry.js](../src/lib/routeGeometry.js) (`advanceOnPath`),
[lib/speeds.js](../src/lib/speeds.js),
[views/busInfo.js](../src/views/busInfo.js).

## The "next two + last passed" rule

For one route and one chosen stop:

0. A route can report under several ids: its own and those of the alternatives merged into
   it (REQ-DATA-10, [data-pipeline.md](data-pipeline.md#alternatives-one-route-several-entries)).
   The app asks for each and puts the answers together.
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
