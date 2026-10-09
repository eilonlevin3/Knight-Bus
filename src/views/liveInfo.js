// Text summary of live buses for one (stop, line) row. Shared by editor and commute screens.
// @req REQ-RT-3

import { h } from '../lib/dom.js';
import { ageLabel } from '../realtime.js';

export function liveSummary(row) {
  if (!row) return h('small', { class: 'muted' }, 'Loading live buses…');
  if (row.error) return h('small', { class: 'error' }, 'Live data unavailable right now.');
  const parts = [];
  if (row.next.length) {
    parts.push(h('span', { class: 'live-next' },
      'Next: ', row.next.map((b) => (b.stopsAway === 0 ? 'arriving' : `${b.stopsAway} stop${b.stopsAway === 1 ? '' : 's'} away`)).join(', ')));
  } else {
    parts.push(h('span', { class: 'muted' }, 'No bus on the way right now'));
  }
  if (row.passed.length) {
    const b = row.passed[0];
    parts.push(h('span', { class: 'live-passed' }, ` · Passed ${-b.stopsAway} stop${b.stopsAway === -1 ? '' : 's'} ago`));
  }
  const newest = [...row.next, ...row.passed].map((b) => b.recordedAt).sort((a, b) => b - a)[0];
  if (newest) parts.push(h('span', { class: 'muted' }, ` · ${ageLabel(newest)}`));
  return h('small', {}, ...parts);
}

export function lineBadge(route, color) {
  return h('span', { class: 'line-badge', style: color ? `--c:${color}` : '' }, route.short);
}
