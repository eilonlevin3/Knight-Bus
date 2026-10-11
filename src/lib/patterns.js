// Plain-language summary of how a route's stop patterns differ. Shown first in the ⚠ pop-up.
// Docs: docs/user-flows.md#routes-with-more-than-one-stop-pattern
// @req REQ-LINE-1d
//
// Pure functions (no browser needed), so they are unit tested.

import { t, tn } from '../i18n.js';
import { samePath } from './routeGeometry.js';

// "A, B, C and 2 more"
export function stopNames(stops, limit) {
  const unique = [...new Map(stops.map((s) => [s.id, s.name])).values()];
  return unique.slice(0, limit).join(', ') + (unique.length > limit ? t(' and {n} more', { n: unique.length - limit }) : '');
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
  const out = [tn(main.stops.length,
    'Most trips ({share}%) follow the usual pattern: 1 stop.',
    'Most trips ({share}%) follow the usual pattern: {n} stops.', { share: main.share })];

  for (const p of others) {
    const d = patternDifference(main, p, shapeOf);
    const parts = [];
    if (d.skipped.length) {
      parts.push(tn(d.skipped.length, 'skip 1 stop ({names})', 'skip {n} stops ({names})', { names: stopNames(d.skipped, limit) }));
    }
    if (d.added.length) {
      parts.push((d.skipped.length ? t('and ') : '') +
        tn(d.added.length, 'stop at 1 other stop ({names})', 'stop at {n} other stops ({names})', { names: stopNames(d.added, limit) }));
    }
    if (!parts.length) parts.push(t('serve the same stops in a different order'));
    out.push(`${t('{share}% of trips ', { share: p.share })}${parts.join(' ')}. ${
      d.samePath ? t('They drive along the same streets.') : t('They leave the usual path for part of the way.')}`);
  }

  if (stop) {
    const here = route.patterns.filter((p) => p.stops.some((s) => s.id === stop.id));
    const share = Math.min(100, here.reduce((n, p) => n + p.share, 0));
    out.push(here.length === route.patterns.length
      ? t('At {stop}: every trip stops here.', { stop: stop.name })
      : t('At {stop}: only about {share}% of trips stop here. The others pass without stopping or take another way.', { stop: stop.name, share }));
  }
  return out;
}
