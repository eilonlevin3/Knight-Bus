# ADR-0010: One route for the rider, however the ministry lists it

**Status:** Accepted · 2026-10-11

## The problem

A rider knows "route 6 to Yavne West". The ministry's timetable data lists that as several
entries (`route_id`s): one per direction, and within a direction one per "alternative"
(חלופה), where some trips skip or add stops. Shown as they come, a stop listed the same
route number two or three times, and the route search listed every service twice.

## Decision

The data pipeline shapes the entries into what a rider sees
([data-pipeline.md](../data-pipeline.md#alternatives-one-route-several-entries)):

| In the ministry's data | In the app | Requirement |
|------------------------|------------|-------------|
| Trips of one entry that serve different stops | One route with several **stop patterns** | REQ-DATA-8 |
| Entries with the same operator, code, direction and number ("alternatives") | **Merged** into one route; each becomes a stop pattern | REQ-DATA-10 |
| The same code and number under another "direction", passing the stops in the **opposite order** | A separate route, linked as the **opposite direction** | REQ-ROUTE-2 |
| The same code and number under another "direction", passing the stops in the **same order** (some circular routes, e.g. Haifa's 32) | **Merged**: it is the same route | REQ-DATA-10 |
| An alternative with its own number on the bus (62א) | A separate route | REQ-DATA-10 |

## Why merge in the pipeline and not on the screen

- Every screen gets it right at once: the stop list, the editor, the search, a Favorite Commute.
- A merged route gets one line on the map, one color, one timetable and one ⚠ explanation
  of how its patterns differ, which the app already had (REQ-LINE-1a to REQ-LINE-2).

## What it costs

- **Live buses** report under the original entry's id, so a merged route keeps the ids of
  its members and the app asks for each (`route.liveIds`).
- **Saved Favorite Commutes** may hold an id that was merged away. The route row lists the
  merged ids and the app reads such an id as the merged route (`city.currentRouteIds`).
  Which entry gives the route its id can change from week to week (the one with the most
  trips), so this mapping is needed in both directions and is rebuilt with every data build.
- **More ⚠ signs.** About one route in seven now has more than one stop pattern (it was
  1–2% before), because every alternative is a pattern. That is true to what the buses do.
- At most six patterns are kept per route; a very rare seventh is dropped.

## Not merged, on purpose

A number that appears twice at one stop because **both directions stop there**, or because
**two operators use the same number**. Those are different buses going to different places;
the route icon gets a frame in the company's color and the destination is in its pop-up
(REQ-HOME-3).
