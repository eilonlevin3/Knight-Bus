# Fun facts

Things we noticed in the bus data while building Knight Bus. Not requirements, just
curiosities. Each one says when it was measured, because the data changes every week.

## The same route, both ways, at one stop

You would expect a route's two directions to use stops on opposite sides of the street. So
a stop should serve route 18 *to* Modi'in or *from* it, never both.

Mostly that is true. But at some stops **the same route stops going both ways**, and not
only at the first and last stops (where a bus turns around, which would be no surprise).

Measured on 2026-10-11. Only stops in the **middle half of both directions** are counted,
so loops at either end of a route are left out:

| City file | Two-way routes | …with a mid-route stop used both ways | Such stops |
|-----------|---------------:|--------------------------------------:|-----------:|
| Tel Aviv – Gush Dan | 769 | 170 (22%) | 371 |
| Jerusalem | 383 | 78 (20%) | 156 |
| Haifa & Krayot | 173 | 41 (24%) | 120 |
| Be'er Sheva | 125 | 38 (30%) | 98 |

So for about one two-way route in five, there is a stop in the middle of the route where
you can board the bus going either way. Read the sign on the bus.

Why it happens: **the bus leaves the main road, drives into a place, and comes back out
the way it went in.** Inside, it drives a small loop in one direction, so the stops on the
loop serve the bus whichever way it is headed. Examples:

- **Route 200 in Haifa** (אגד) goes through the Technion campus in both directions: 15
  stops used both ways.
- **Route 18 Ramla ↔ Modi'in** (קווים) drives into Kfar Shmuel and back out: 9 stops.
- **Route 440 Jerusalem ↔ Be'er Sheva** enters Efrat and Kiryat Arba on the way: 9 stops.
- **Route 392 Be'er Sheva ↔ Eilat** turns into army bases along the road: 7 stops.
- **Route 173 Elad ↔ Ramat Gan** (מטרופולין): 12 stops inside a neighborhood.

Inside Tel Aviv-Yafo itself it is rare: only 6 routes have such a stop. Two to look at:

- **Route 16** (דן, Carmelit terminal ↔ Sheba): three stops in a row in Yad Eliyahu,
  מעפילי אגוז/מח"ל (26055), ביה"ס תל חי/מעפילי אגוז (26056) and דרך הטייסים/עודד (21218).
  They are stops 29–31 one way and 13–15 the other.
- **Route 445** (מטרופולין, Reading ↔ Ben Gurion Airport): הירקון/שדרות בן גוריון (20654) is
  stop 7 one way and stop 17 the other.

What the app does about it: at such a stop the route number appears twice. Each icon gets a
frame in the color of the company that runs it, and the destination is in the pop-up
behind the number ([user flows](../user-flows.md#2-home-screen), REQ-HOME-3).

### A correction, and a second fun fact

The first version of this page (2026-10-11) gave much higher numbers and named Haifa's
route 32 as a record holder, with 51 stops shared by its "two directions". The owner
checked route 32 on the street: its stops are on opposite sides of the road, as expected.

The data was read wrongly. **Route 32 is a circular route, and the ministry publishes it as
two "directions" that both drive the same way around.** They are two versions of one loop,
one starting a few stops earlier. They share stops because they are the same bus route,
not because a bus stops there both ways.

So: **in the ministry's data, "direction" does not always mean direction.** 89 such
entries were found in the feed. The data build now checks on the map which way each entry
really drives ([data-pipeline.md](../data-pipeline.md#alternatives-one-route-several-entries)),
and the table above counts only routes that truly run opposite ways.

How it was measured: for every route that has a real opposite direction
([data-pipeline.md](../data-pipeline.md#opposite-directions)), the stops of the two
directions' most common stop patterns were compared, in the city files built on 2026-10-11.
A stop counts when it is in the middle half of the stop list of both directions.
