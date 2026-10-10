// Text summary of live buses for one (stop, line) row. Shared by editor and commute screens.
// @req REQ-RT-3 @req REQ-RT-5 @req REQ-RT-6 @req REQ-LINE-2

import { h } from '../lib/dom.js';
import { ageLabel } from '../realtime.js';

export function liveSummary(row) {
  if (!row) return h('small', { class: 'muted' }, 'Loading live buses…');
  if (row.noLive) {
    return h('small', { class: 'muted' }, `${row.route.agency}: buses on this line cannot be tracked${row.route.hours ? `. Runs ${row.route.hours}` : ''}`);
  }
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

// Lines from outside the government feed (the weekend "Naaim BeSofash" service) are marked the
// same way wherever they appear: a dashed ring on the number, and a WEEKEND tag by the name.
export const isWeekendLine = (route) => !!route?.source;

export function lineBadge(route, color) {
  return h('span', {
    class: `line-badge${isWeekendLine(route) ? ' weekend' : ''}`,
    style: color ? `--c:${color}` : '',
    title: isWeekendLine(route) ? 'Weekend line, no live tracking' : null,
  }, route.short);
}

export function weekendTag(route) {
  return isWeekendLine(route)
    ? h('span', { class: 'tag-weekend', title: `${route.agency}${route.hours ? ` · ${route.hours}` : ''}` }, 'Weekend · no live tracking')
    : null;
}

// "→ destination", the weekend tag when it applies, and a ⚠ for a line that does not always
// take the same route. onInfo opens its explanation (REQ-LINE-2).
export function lineTitle(route, onInfo) {
  const hazard = route.multi && onInfo
    ? h('button', {
        type: 'button', class: 'hazard', title: 'This line does not always take the same route',
        'aria-label': `Line ${route.short} does not always take the same route. Details`,
        // Inside a checkbox row: do not tick the box.
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); onInfo(); },
      }, '⚠')
    : null;
  return h('span', { class: 'line-title' }, h('span', {}, `→ ${route.dest}`), hazard, weekendTag(route));
}
