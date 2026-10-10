// Unit tests for side-by-side line drawing (REQ-COMM-5): no knots at corners and U-turns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetPoints, removeLoops } from '../src/lib/offsetLine.js';

const crosses = (pts) => {
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) {
      const [a, b, c, d] = [pts[i], pts[i + 1], pts[j], pts[j + 1]];
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return true;
    }
  }
  return false;
};

test('a straight line shifts sideways by the offset', () => {
  const out = offsetPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 6);
  assert.deepEqual(out.map((p) => Math.round(p.y)), [-6, -6]);
});

test('a right-angle corner keeps a clean miter point', () => {
  const out = offsetPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 6);
  assert.equal(out.length, 3);
  assert.deepEqual([Math.round(out[1].x), Math.round(out[1].y)], [106, -6]);
});

test('a tight turnaround made of short pieces does not leave a knot', () => {
  // Out along y=0, a turnaround of radius 3 px in 10 short pieces, back along y=6.
  // Shifted 6 px (more than the turn's radius) to either side, the result must not cross itself.
  const turn = Array.from({ length: 11 }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 10;
    return { x: 100 + 3 * Math.cos(a), y: 3 + 3 * Math.sin(a) };
  });
  const line = [{ x: 0, y: 0 }, ...turn, { x: 0, y: 6 }];
  for (const off of [6, -6]) assert.ok(!crosses(removeLoops(offsetPoints(line, off))), `offset ${off}`);
});

test('removeLoops cuts out a knot', () => {
  // A line that ties a small loop: right, up, back left across itself, then down and on.
  const knot = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: 40, y: 10 }];
  assert.ok(crosses(knot));
  const clean = removeLoops(knot);
  assert.ok(!crosses(clean));
  assert.deepEqual(clean.at(-1), { x: 40, y: 10 });
});

test('a zig-zag of tiny segments shifts without crossings', () => {
  const zig = Array.from({ length: 40 }, (_, i) => ({ x: i * 3, y: i % 2 ? 2 : 0 }));
  assert.ok(!crosses(removeLoops(offsetPoints(zig, 6))));
});
