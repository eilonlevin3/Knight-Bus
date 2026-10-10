# ADR-0007: Address search with Nominatim; side-by-side lines

**Status:** Accepted · 2026-10-10

## Address search (REQ-FAV-5)

A Favorite Commute's start point and destination can be found by address. We use
**OpenStreetMap Nominatim** ([src/geocode.js](../../src/geocode.js)). It is free, needs no
key, and is called straight from the phone.

Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) allows light
use with conditions, and we follow them:
- at most 1 request per second (enforced in code),
- no search-as-you-type: we search only when the user presses *Search*,
- results are attributed to OpenStreetMap (already shown on the map).

If use grows, switch to a hosted geocoder with a key, or run our own Nominatim. Only
`geocode.js` changes.

## Lines side by side (REQ-COMM-5)

Where several routes share a street, drawn normally they would sit on top of each other and
only the last one would show. Each line is shifted sideways by a few screen pixels,
recalculated at every zoom.

*First version (2026-10-10, superseded the same day):* the
[Leaflet.PolylineOffset](https://github.com/bbecquet/Leaflet.PolylineOffset) plugin. On the
phone, zoomed out, it drew small loops ("circles") at sharp corners and turnarounds. We
replaced it with our own [src/lib/offsetLine.js](../../src/lib/offsetLine.js), which:
1. simplifies the line in screen pixels first, so pieces shorter than the shift are gone,
2. shifts each piece and joins corners with a miter, or a bevel when very sharp,
3. cuts out any small loop the shift still creates.

Unit tests: [tests/offsetLine.test.mjs](../../tests/offsetLine.test.mjs). Loops that are
**real** stay visible, for example a bus going around a terminal or a block to turn back:
route 115 has two.

Each line shown gets its own shift: lines are `weight + 1` pixels apart, centered on the
road.

**Trade-off.** The shift applies along the whole line, so the line of a route that runs alone is drawn a
few pixels off the road center. Shifting only where lines actually overlap needs
segment-by-segment bundling. That is much more work, and we revisit it only if the simple
version looks wrong on real commutes.
