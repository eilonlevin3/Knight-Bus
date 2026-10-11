// The pop-up for one live bus: when its last signal arrived and everything that signal says.
// Opened by tapping a bus on any map. Docs: docs/realtime.md#what-a-bus-tells-us
// @req REQ-RT-10

import { h } from '../lib/dom.js';
import { t, arrow, locale } from '../i18n.js';
import { track } from '../analytics.js';
import { ageLabel, isLate } from '../realtime.js';
import { routeBadge, weekendTag } from './liveInfo.js';

const compass = (degrees) => [t('N'), t('NE'), t('E'), t('SE'), t('S'), t('SW'), t('W'), t('NW')][Math.round(degrees / 45) % 8];
const dateTime = (value) => new Date(value).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'medium' });
const has = (v) => v !== null && v !== undefined && v !== '';

// bus: from fetchLiveBuses + classifyBuses. route: its route. where: sentences such as
// "2 stops before Dizengoff" (one per chosen stop the bus matters for).
export function showBusInfo({ bus, route, where = [] }) {
  const raw = bus.raw || {};
  const close = () => overlay.remove();
  track('bus_info_opened', { late: isLate(bus.recordedAt) ? 1 : 0 });

  // The signal's fields in plain words. A field the signal left empty is not listed here;
  // the raw list below shows everything.
  const facts = [
    [t('Position'), `${bus.lat.toFixed(5)}, ${bus.lon.toFixed(5)}`],
    has(raw.velocity) ? [t('Speed'), t('{n} km/h', { n: raw.velocity })] : null,
    has(raw.bearing) ? [t('Heading'), `${raw.bearing}° ${compass(raw.bearing)}`] : null,
    has(raw.distance_from_journey_start) ? [t('Driven since the trip started'), t('{n} km', { n: (raw.distance_from_journey_start / 1000).toFixed(1) })] : null,
    has(raw.siri_ride__scheduled_start_time) ? [t('This trip was scheduled to start'), dateTime(raw.siri_ride__scheduled_start_time)] : null,
    has(bus.vehicle) ? [t('Vehicle number'), bus.vehicle] : null,
    has(raw.siri_ride__journey_ref) ? [t('Trip reference'), raw.siri_ride__journey_ref] : null,
    has(raw.siri_route__operator_ref) ? [t('Operator code'), raw.siri_route__operator_ref] : null,
    has(bus.offRouteMeters) ? [t('Distance from the route on our map'), t('{n} m', { n: bus.offRouteMeters })] : null,
    has(raw.siri_snapshot__snapshot_id) ? [t('Batch it arrived in'), raw.siri_snapshot__snapshot_id] : null,
  ].filter(Boolean);

  const table = (rows, cls = '') => h('dl', { class: `facts ${cls}` },
    ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, has(v) ? String(v) : '—')]));

  const overlay = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('About this bus'),
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    h('div', { class: 'card stack modal-card' },
      h('div', { class: 'row' }, routeBadge(route), h('h2', { class: 'grow' }, `${arrow()} ${route.dest}`), weekendTag(route)),
      h('p', { class: 'muted small' }, route.agency),
      ...where.map((x) => h('p', {}, x)),
      h('div', { class: 'summary-box stack' },
        h('b', {}, t('Last signal')),
        h('span', {}, `${dateTime(bus.recordedAt)} · ${ageLabel(bus.recordedAt)}`),
        isLate(bus.recordedAt)
          ? h('span', { class: 'late' }, t('⚠ This is late. The bus has moved on since; the map shows where it was then.'))
          : null),
      h('b', { class: 'small' }, t('What the signal says')),
      table(facts),
      h('details', {},
        h('summary', {}, t('Everything in the signal, as it was sent')),
        table(Object.entries(raw), 'raw')),
      h('p', { class: 'muted small' }, t('Source: Ministry of Transport SIRI feed, through Open Bus Stride.')),
      h('button', { onclick: close }, t('Close'))));
  document.body.append(overlay);
}
