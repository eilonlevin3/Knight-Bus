// Text summary of live buses for one (stop, route) row, and how a route is labelled.
// Shared by the home, editor and commute screens.
// @req REQ-RT-3 @req REQ-RT-5 @req REQ-RT-6 @req REQ-RT-9 @req REQ-LINE-2

import { h } from '../lib/dom.js';
import { t, tn, arrow } from '../i18n.js';
import { ageLabel, isLate } from '../realtime.js';

export function liveSummary(row) {
  if (!row) return h('small', { class: 'muted' }, t('Loading live buses…'));
  if (row.noLive) {
    return h('small', { class: 'muted' },
      t('{agency}: buses on this route cannot be tracked', { agency: row.route.agency }) +
      (row.route.hours ? t('. Runs {hours}', { hours: t(row.route.hours) }) : ''));
  }
  if (row.error) return h('small', { class: 'error' }, t('Live data unavailable right now.'));
  const parts = [];
  if (row.next.length) {
    parts.push(h('span', { class: 'live-next' },
      t('Next: '), row.next.map((b) => (b.stopsAway === 0 ? t('arriving') : tn(b.stopsAway, '1 stop away', '{n} stops away'))).join(', ')));
  } else {
    parts.push(h('span', { class: 'muted' }, t('No bus on the way right now')));
  }
  if (row.passed.length) {
    parts.push(h('span', { class: 'live-passed' }, ` · ${tn(-row.passed[0].stopsAway, 'Passed 1 stop ago', 'Passed {n} stops ago')}`));
  }
  const newest = [...row.next, ...row.passed].map((b) => b.recordedAt).sort((a, b) => b - a)[0];
  // When the feed runs late the positions are still shown, with a clear warning.
  if (newest && isLate(newest)) {
    parts.push(h('span', { class: 'late' }, ` · ⚠ ${t('Live data is late: positions are from {age}', { age: ageLabel(newest) })}`));
  } else if (newest) {
    parts.push(h('span', { class: 'muted' }, ` · ${ageLabel(newest)}`));
  }
  return h('small', {}, ...parts);
}

// Routes from outside the government feed (the weekend services) are marked the same way
// wherever they appear: a dashed ring on the number, and a WEEKEND tag by the name.
export const isWeekendRoute = (route) => !!route?.source;

export function routeBadge(route, color) {
  return h('span', {
    class: `line-badge${isWeekendRoute(route) ? ' weekend' : ''}`,
    style: color ? `--c:${color}` : '',
    title: isWeekendRoute(route) ? t('Weekend route, no live tracking') : null,
  }, route.label);
}

export function weekendTag(route) {
  return isWeekendRoute(route)
    ? h('span', { class: 'tag-weekend', title: `${route.agency}${route.hours ? ` · ${t(route.hours)}` : ''}` }, t('Weekend · no live tracking'))
    : null;
}

// A route as a small icon: a checkbox (show it on the map or not) and the route number in
// its map color. Pressing the number, not the box, calls onInfo. When the same number is
// in the list more than once (both directions stop here, or two operators use the number),
// the icon gets a thick frame in the color of the company that runs the route; where it
// goes is in the pop-up behind the number (REQ-HOME-3, REQ-EDIT-2).
export function routeChip(route, { on, color, repeated, onToggle, onInfo }) {
  return h('div', {
    class: `route-chip ${on ? 'on' : 'off'}${repeated ? ' by-operator' : ''}`,
    style: repeated ? `--op:${operatorColor(route.agencyRank)}` : '',
    title: repeated ? route.agency : null,
  },
    h('input', {
      type: 'checkbox', checked: on,
      'aria-label': t('Show route {n} on the map', { n: route.label }),
      onchange: (e) => onToggle(e.target.checked),
    }),
    h('button', {
      type: 'button', class: `chip-number${isWeekendRoute(route) ? ' weekend' : ''}`,
      style: on && color ? `--c:${color}` : '',
      'aria-label': t('About route {n}', { n: route.label }),
      onclick: onInfo,
    // A train has no number: its icon says where it comes from and where it goes.
    }, route.short ? route.label : `${route.label} ${route.stops[0].name} ${arrow()} ${route.dest}`, route.multi ? h('span', { class: 'chip-mark' }, '⚠') : null));
}

// One color per company, the same on every screen: by the company's place in the city's
// list of companies sorted by name (route.agencyRank). Chosen to stand apart from each
// other, not to match company branding.
const OPERATOR_COLORS = [
  '#d00000', '#0077b6', '#2b9348', '#f48c06', '#7b2cbf', '#00a6a6', '#b5179e', '#6c584c',
  '#1d3557', '#70e000', '#ff5d8f', '#ffd60a', '#495057', '#3a86ff', '#9d0208', '#588157',
  '#e0aaff', '#ca6702', '#48cae4', '#000000', '#a5a58d', '#ff006e', '#06d6a0', '#8338ec',
];
export const operatorColor = (rank) => OPERATOR_COLORS[(rank || 0) % OPERATOR_COLORS.length];

// "Select all" and "Clear all" above a list of route icons (REQ-HOME-3, REQ-EDIT-3).
export function selectAllRow(onAll, onNone) {
  return h('div', { class: 'row select-row' },
    h('button', { type: 'button', class: 'small-button', onclick: onAll }, t('☑ Select all')),
    h('button', { type: 'button', class: 'small-button', onclick: onNone }, t('☐ Clear all')));
}

// The route numbers that appear more than once in a list of routes.
export function repeatedNumbers(routes) {
  const count = new Map();
  for (const r of routes) if (r.short) count.set(r.short, (count.get(r.short) || 0) + 1); // trains have no number
  return new Set([...count].filter(([, n]) => n > 1).map(([short]) => short));
}

// "→ destination", the weekend tag when it applies, and a ⚠ for a route that has more than
// one stop pattern. onInfo opens its explanation (REQ-LINE-2).
export function routeTitle(route, onInfo) {
  const hazard = route.multi && onInfo
    ? h('button', {
        type: 'button', class: 'hazard', title: t('This route does not always follow the same stop pattern'),
        'aria-label': t('Route {n} does not always follow the same stop pattern. Details', { n: route.label }),
        // Inside a checkbox row: do not tick the box.
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); onInfo(); },
      }, '⚠')
    : null;
  return h('span', { class: 'line-title' }, h('span', {}, `${arrow()} ${route.dest}`), hazard, weekendTag(route));
}
