// Plain-language summary of how a route's stop patterns differ. Shown first in the ⚠ pop-up.
// Docs: docs/user-flows.md#routes-with-more-than-one-stop-pattern
// @req REQ-LINE-1d
//
// Pure functions (no browser needed), so they are unit tested.

import { samePath } from './routeGeometry.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function names(stops, limit) {
  const unique = [...new Map(stops.map((s) => [s.id, s.name])).values()];
  return unique.slice(0, limit).join(', ') + (unique.length > limit ? ` and ${unique.length - limit} more` : '');
}

// How one pattern differs from the most common one.
// Returns { skipped: [stop], added: [stop], samePath: boolean }
export function patternDifference(main, pattern, shapeOf) {
  const inMain = new Set(main.stops.map((s) => s.id));
  const inPattern = new Set(pattern.stops.map((s) => s.id));
  return {
    skipped: main.stops.filter((s) => !inPattern.has(s.id)),
    added: pattern.stops.filter((s) => !inMain.has(s.id)),
    samePath: samePath(shapeOf(pattern), shapeOf(main)),
  };
}

// Sentences that explain the difference between a route's stop patterns, and what it means
// at one stop (optional). shapeOf(pattern) returns its path as [[lat, lon], ...].
export function patternSummary(route, stop, shapeOf, limit = 4) {
  const [main, ...others] = route.patterns;
  const out = [`Most trips (${main.share}%) follow the usual pattern: ${plural(main.stops.length, 'stop')}.`];

  for (const p of others) {
    const d = patternDifference(main, p, shapeOf);
    const parts = [];
    if (d.skipped.length) parts.push(`skip ${plural(d.skipped.length, 'stop')} (${names(d.skipped, limit)})`);
    if (d.added.length) parts.push(`${d.skipped.length ? 'and ' : ''}stop at ${plural(d.added.length, 'other stop')} (${names(d.added, limit)})`);
    if (!parts.length) parts.push('serve the same stops in a different order');
    out.push(`${p.share}% of trips ${parts.join(' ')}. ${d.samePath ? 'They drive along the same streets.' : 'They leave the usual path for part of the way.'}`);
  }

  if (stop) {
    const here = route.patterns.filter((p) => p.stops.some((s) => s.id === stop.id));
    const share = Math.min(100, here.reduce((n, p) => n + p.share, 0));
    out.push(here.length === route.patterns.length
      ? `At ${stop.name}: every trip stops here.`
      : `At ${stop.name}: only about ${share}% of trips stop here. The others pass without stopping or take another way.`);
  }
  return out;
}
