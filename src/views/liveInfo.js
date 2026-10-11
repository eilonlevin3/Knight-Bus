// Text summary of live buses for one (stop, route) row, and how a route is labelled.
// Shared by the home, editor and commute screens.
// @req REQ-RT-3 @req REQ-RT-5 @req REQ-RT-6 @req REQ-LINE-2

import { h } from '../lib/dom.js';
import { t, tn, arrow } from '../i18n.js';
import { ageLabel } from '../realtime.js';

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
  if (newest) parts.push(h('span', { class: 'muted' }, ` · ${ageLabel(newest)}`));
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
  }, route.short);
}

export function weekendTag(route) {
  return isWeekendRoute(route)
    ? h('span', { class: 'tag-weekend', title: `${route.agency}${route.hours ? ` · ${t(route.hours)}` : ''}` }, t('Weekend · no live tracking'))
    : null;
}

// "→ destination", the weekend tag when it applies, and a ⚠ for a route that has more than
// one stop pattern. onInfo opens its explanation (REQ-LINE-2).
export function routeTitle(route, onInfo) {
  const hazard = route.multi && onInfo
    ? h('button', {
        type: 'button', class: 'hazard', title: t('This route does not always follow the same stop pattern'),
        'aria-label': t('Route {n} does not always follow the same stop pattern. Details', { n: route.short }),
        // Inside a checkbox row: do not tick the box.
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); onInfo(); },
      }, '⚠')
    : null;
  return h('span', { class: 'line-title' }, h('span', {}, `${arrow()} ${route.dest}`), hazard, weekendTag(route));
}
