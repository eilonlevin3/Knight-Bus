# ADR-0007: Address search with Nominatim; side-by-side lines with PolylineOffset

**Status:** Accepted · 2026-10-10

## Address search (REQ-FAV-5)

A favorite's start point and destination can be found by address. We use
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

Where several lines share a street, drawn normally they would sit on top of each other and
only the last one would show. We use
[Leaflet.PolylineOffset](https://github.com/bbecquet/Leaflet.PolylineOffset) (MIT, 7 KB,
loaded from unpkg in `index.html`). It shifts a line sideways by a number of screen pixels,
and the shift is recalculated at every zoom.

Each line shown gets its own shift: lines are `weight + 1` pixels apart, centered on the
road.

**Trade-off.** The shift applies along the whole line, so a line that runs alone is drawn a
few pixels off the road center. Shifting only where lines actually overlap needs
segment-by-segment bundling. That is much more work, and we revisit it only if the simple
version looks wrong on real commutes.
