# Fun facts

Things we noticed in the bus data while building Knight Bus. Not requirements, just
curiosities. Each one says when it was measured, because the data changes every week.

## The same route, both ways, at one stop

You would expect a route's two directions to use stops on opposite sides of the street. So
a stop should serve route 6 *to* the station or *from* it, never both.

Not so. **At thousands of stops, the same route stops in both directions**, and these are
not only the first and last stops (where a bus turns around, which would be no surprise).

Measured on 2026-10-11, leaving out the first two and last two stops of each direction:

| City file | Two-way routes | …that share a stop in mid-route | Stops where it happens |
|-----------|---------------:|--------------------------------:|-----------------------:|
| Tel Aviv – Gush Dan | 882 | 380 (43%) | 1,316 of 12,159 |
| Jerusalem | 509 | 226 (44%) | 989 of 6,669 |
| Haifa & Krayot | 241 | 131 (54%) | 769 of 5,086 |
| Be'er Sheva | 134 | 59 (44%) | 242 of 2,936 |

So for almost half of all two-way routes there is at least one stop in the middle of the
route where you can board the bus going either way. Read the sign on the bus.

Some record holders:

- **Route 3 in Jerusalem** (אקסטרה ירושלים): its two directions share 55 stops.
- **Route 60 around Jerusalem**: 54 shared stops out of about 83 each way.
- **Route 32 in Haifa** (אגד): 51 shared stops.
- **Route 16א in Petah Tikva** (אלקטרה אפיקים): 34 shared stops.

Why it happens:

- **Neighborhood loops.** At the end of many routes the bus drives a loop through a
  neighborhood, always in the same direction around the loop. The stops on the loop serve
  the bus arriving and the bus leaving.
- **One-way streets.** Both directions are pushed onto the same street for a stretch.
- **Hills.** In Haifa and Jerusalem a road often winds up and down the same way for both.
- **Mid-route terminals.** A route can pass through a station on its way and use the same
  platform both ways.

What the app does about it: at such a stop the route number appears twice. Each icon gets a
frame in the color of the company that runs it, and the destination is in the pop-up
behind the number ([user flows](../user-flows.md#2-home-screen), REQ-HOME-3).

How it was measured: for every route that has an opposite direction
([data-pipeline.md](../data-pipeline.md#opposite-directions)), the stops of the two
directions' most common stop patterns were compared, in the city files built on 2026-10-11.
