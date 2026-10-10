// Draws a line shifted sideways by a few screen pixels, so lines that share a street sit
// side by side. Docs: docs/adr/0007-address-search.md#lines-side-by-side-req-comm-5
// @req REQ-COMM-5
//
// Shifting a detailed line naively makes little knots ("circles") at sharp corners and
// U-turns, especially zoomed out where many points fall within a few pixels. So, for each
// zoom level: (1) simplify the line in screen pixels, (2) shift each segment, joining
// corners with a miter (bevel when very sharp), (3) cut out the small loops the shift created.
// The pure functions work on {x, y} points so they can be unit tested without a browser.

// Shift a polyline of screen points by `offset` pixels (positive = left of travel direction on screen).
export function offsetPoints(pts, offset) {
  const p = pts.filter((q, i) => i === 0 || q.x !== pts[i - 1].x || q.y !== pts[i - 1].y);
  if (p.length < 2 || !offset) return p.map((q) => ({ x: q.x, y: q.y }));
  const segs = [];
  for (let i = 0; i < p.length - 1; i++) {
    const dx = p[i + 1].x - p[i].x;
    const dy = p[i + 1].y - p[i].y;
    const len = Math.hypot(dx, dy);
    const nx = (dy / len) * offset;
    const ny = (-dx / len) * offset;
    segs.push([{ x: p[i].x + nx, y: p[i].y + ny }, { x: p[i + 1].x + nx, y: p[i + 1].y + ny }]);
  }
  const out = [segs[0][0]];
  for (let i = 1; i < segs.length; i++) {
    const [a1, b1] = segs[i - 1];
    const [a2, b2] = segs[i];
    const x = lineIntersection(a1, b1, a2, b2);
    // Very sharp corner: the miter point would shoot far away. Use a bevel instead.
    if (!x || Math.hypot(x.x - p[i].x, x.y - p[i].y) > 2 * Math.abs(offset)) out.push(b1, a2);
    else out.push(x);
  }
  out.push(segs.at(-1)[1]);
  return out;
}

// Remove small self-crossings: if segment i crosses a segment up to `span` segments later,
// jump straight from the crossing point to the later segment.
export function removeLoops(pts, span = 12) {
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    out.push(pts[i]);
    let jumped = false;
    for (let j = Math.min(pts.length - 2, i + span); j >= i + 2; j--) {
      const x = segmentIntersection(pts[i], pts[i + 1], pts[j], pts[j + 1]);
      if (x) { out.push(x); i = j + 1; jumped = true; break; }
    }
    if (!jumped) i++;
  }
  out.push(pts.at(-1));
  return out;
}

function lineIntersection(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function segmentIntersection(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

// A Leaflet polyline with an `offset` option (pixels). Re-shifted at every zoom.
export function makeOffsetPolyline(L) {
  return L.Polyline.extend({
    options: { offset: 0 },
    _projectLatlngs(latlngs, result, projectedBounds) {
      if (!latlngs.length) return;
      if (!(latlngs[0] instanceof L.LatLng)) {
        for (const part of latlngs) this._projectLatlngs(part, result, projectedBounds);
        return;
      }
      let ring = latlngs.map((ll) => this._map.latLngToLayerPoint(ll));
      const off = this.options.offset || 0;
      if (off) {
        ring = L.LineUtil.simplify(ring, Math.max(1, Math.abs(off)));
        ring = removeLoops(offsetPoints(ring, off)).map((q) => L.point(q.x, q.y));
      }
      for (const q of ring) projectedBounds.extend(q);
      result.push(ring);
    },
  });
}
