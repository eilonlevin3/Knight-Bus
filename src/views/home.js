// Home screen: a map around you, tap any stop to see its routes and live buses, and your
// Favorite Commutes. Docs: docs/user-flows.md#2-home-screen
// @req REQ-HOME-1 @req REQ-HOME-2 @req REQ-HOME-3 @req REQ-HOME-4 @req REQ-FAV-1 @req REQ-FAV-2 @req REQ-AUTH-3 @req REQ-ANL-3 @req REQ-ROUTE-1 @req REQ-LANG-2

import { h, toast } from '../lib/dom.js';
import { t, tn, locale, cityName } from '../i18n.js';
import { FAVORITE_SLOTS, storagePrefix } from '../config.js';
import { signOut } from '../auth.js';
import { createMap, stopLayer, userMarker } from '../map.js';
import { watchPosition, getPosition } from '../location.js';
import { LiveLines } from '../liveLines.js';
import { approachPoints } from '../lib/mapFit.js';
import { draggableSheet } from '../lib/sheetDrag.js';
import { commuteName } from '../lib/names.js';
import { consent, setConsent, detailed, track, trackDetail, bucket } from '../analytics.js';
import { safeSummary, debugSummary } from './privacy.js';
import { routeChip, repeatedNumbers } from './liveInfo.js';
import { showRouteCard } from './lineInfo.js';
import { stopSuffix, stopHazard } from './stopInfo.js';
import { showOptions } from './options.js';

const MAX_ROUTES_SHOWN_AT_FIRST = 16; // busy stops: the rest start unchecked
const LAST_POSITION_KEY = `${storagePrefix}lastPosition`; // kept on this phone only, for a quick start

const readLastPosition = () => {
  try { return JSON.parse(localStorage.getItem(LAST_POSITION_KEY)); } catch { return null; }
};
const saveLastPosition = (p) => {
  try { localStorage.setItem(LAST_POSITION_KEY, JSON.stringify({ lat: p.lat, lon: p.lon })); } catch {}
};

export async function render(root, ctx) {
  const city = ctx.city;
  const mapEl = h('div', { class: 'map' });
  const sheet = h('section', { class: 'sheet' });
  const screen = h('main', { class: 'map-screen dynamic home' }, mapEl, sheet);
  root.append(screen);

  // Start where you are (or were last time); the city center until the phone knows.
  const known = ctx.position || readLastPosition();
  const map = createMap(mapEl, known ? [known.lat, known.lon] : city.meta.center, 16);
  const showMe = userMarker(map);
  showMe(ctx.position);
  let centeredOnMe = !!ctx.position;
  const stopWatch = watchPosition((p) => {
    ctx.position = p;
    saveLastPosition(p);
    showMe(p);
    if (!centeredOnMe && !state.stop) map.setView([p.lat, p.lon], 16);
    centeredOnMe = true;
  });

  const state = {
    stop: null, // the stop being explored
    hidden: new Set(), // route ids unchecked for this stop
    rows: [], // live rows from LiveLines
    updatedAt: null,
  };

  // "Back to my location" button on the map.
  const Locate = L.Control.extend({
    onAdd() {
      const b = L.DomUtil.create('button', 'map-button');
      b.type = 'button';
      b.textContent = '◎';
      b.title = t('Go to my location');
      b.setAttribute('aria-label', t('Go to my location'));
      L.DomEvent.disableClickPropagation(b);
      b.onclick = async () => {
        try {
          const p = ctx.position || await getPosition();
          ctx.position = p;
          showMe(p);
          map.setView([p.lat, p.lon], 16);
        } catch (e) {
          toast(e.message);
        }
      };
      return b;
    },
  });
  new Locate({ position: 'bottomright' }).addTo(map);

  const lines = new LiveLines(map, city, {
    onUpdate: (r) => { state.rows = r; state.updatedAt = new Date(); paint(); },
  });

  const stops = stopLayer(map, city, {
    selectedIds: () => (state.stop ? [state.stop.id] : []),
    onPick: selectStop,
  });

  const shownEntries = () => city.routesAtStop(state.stop.id)
    .filter((r) => !state.hidden.has(r.id))
    .map((r) => ({ stopId: state.stop.id, routeId: r.id }));

  function selectStop(stop) {
    state.stop = stop;
    const routes = city.routesAtStop(stop.id);
    state.hidden = new Set(routes.slice(MAX_ROUTES_SHOWN_AT_FIRST).map((r) => r.id));
    state.rows = [];
    lines.set(shownEntries());
    stops.refresh();
    paint();
    dockButtons(true);
    sheet.scrollTop = 0;
    // Zoom to the stop and where its buses are in their last ~5 minutes before it.
    const pts = [[stop.lat, stop.lon], ...approachPoints(city, shownEntries())];
    map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 17 });
    track('stop_explored', { city: city.id, lines: bucket(routes.length) });
    trackDetail('stop_explored', { stop: stop.id, code: stop.code, lines: routes.length });
  }

  function closeStop() {
    state.stop = null;
    state.rows = [];
    lines.set([]);
    stops.refresh();
    paint();
    dockButtons(false);
  }

  const saved = () => FAVORITE_SLOTS.filter((slot) => ctx.favorites[slot]);
  const freeSlot = () => FAVORITE_SLOTS.find((slot) => !ctx.favorites[slot]);

  // ---------- Panel ----------

  function commuteButtons() {
    if (!saved().length) {
      return h('p', { class: 'muted small' }, t('No Favorite Commutes yet. Use ＋ New Favorite Commute to save the stops and routes you ride often.'));
    }
    return h('div', { class: 'commute-list' }, ...saved().map((slot) => {
      const fav = ctx.favorites[slot];
      const routeCount = new Set(fav.stops.flatMap((s) => s.routeIds)).size;
      return h('div', { class: 'commute-item' },
        h('button', { class: 'commute-go', onclick: () => ctx.go(`#/commute/${slot}`) },
          h('b', {}, commuteName(fav, slot)),
          h('small', {}, `${fav.stops.map((s) => s.stopName).join(' · ')} · ${tn(routeCount, '1 route', '{n} routes')}`)),
        h('button', { class: 'commute-edit', 'aria-label': t('Edit {name}', { name: commuteName(fav, slot) }), onclick: () => ctx.go(`#/edit/${slot}`) }, '✎'));
    }));
  }

  function stopSection() {
    if (!state.stop) {
      return h('p', { class: 'muted' }, t('Tap a bus stop on the map to see its routes and live buses. Zoom in if you see no stops.'));
    }
    const s = state.stop;
    const routes = city.routesAtStop(s.id);
    // One small icon per route: a checkbox (show on the map or not) and the route number.
    // Tapping the number opens more about the route (REQ-HOME-3).
    const repeated = repeatedNumbers(routes);
    const rows = routes.map((r) => {
      const on = !state.hidden.has(r.id);
      return routeChip(r, {
        on,
        color: lines.colorOf(r.id),
        repeated: repeated.has(r.short),
        onToggle: (checked) => {
          if (checked) state.hidden.delete(r.id); else state.hidden.add(r.id);
          lines.set(shownEntries());
          paint();
        },
        onInfo: () => showRouteCard(ctx, city, r, s, { live: on ? state.rows.find((x) => x.route.id === r.id) : null, shown: on }),
      });
    });
    return h('div', { class: 'stop-section' },
      h('div', { class: 'row between' },
        h('span', { class: 'stop-head' },
          h('button', { class: 'stop-title', onclick: () => map.setView([s.lat, s.lon], 17) },
            `🚏 ${s.name}`, h('span', { class: 'muted' }, stopSuffix(s))),
          stopHazard(city, s, selectStop)),
        h('button', { class: 'link', 'aria-label': t('Close this stop'), onclick: closeStop }, t('✕ Close'))),
      h('p', { class: 'muted small' },
        tn(routes.length, '1 route stops here.', '{n} routes stop here.'),
        t(' Tap a number for details; uncheck its box to hide the route. Solid line = coming to this stop, lighter = after it.'),
        routes.length > MAX_ROUTES_SHOWN_AT_FIRST ? t(' Showing the first {n}; check more below.', { n: MAX_ROUTES_SHOWN_AT_FIRST }) : ''),
      h('div', { class: 'route-chips' }, ...rows),
      h('div', { class: 'row between' },
        h('small', { class: 'muted' }, state.updatedAt
          ? t('Updated {time} · refreshes every 30 s', { time: state.updatedAt.toLocaleTimeString(locale()) })
          : t('Loading live buses…')),
        h('button', { class: 'link small', onclick: () => lines.refresh() }, t('↻ Refresh'))));
  }

  // Asked once. No answer = nothing recorded.
  function consentCard() {
    if (consent() !== null) return null;
    const card = h('div', { class: 'card stack consent' },
      h('b', {}, t('Help improve Knight Bus?')),
      h('small', {}, safeSummary()),
      detailed ? h('small', { class: 'notice' }, debugSummary()) : null,
      h('div', { class: 'row' },
        h('button', { onclick: async () => { await setConsent(false); card.remove(); } }, t('No thanks')),
        h('button', { class: 'primary', onclick: async () => { await setConsent(true); card.remove(); } }, t('Share usage'))),
      h('button', { class: 'link small', onclick: () => ctx.go('#/privacy') }, t('Details')));
    return card;
  }

  function paint() {
    const scroll = sheet.scrollTop;
    const parts = [
      h('header', { class: 'topbar' },
        h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }),
        h('h1', {}, 'Knight Bus'),
        h('button', { class: 'link small', onclick: () => ctx.go('#/city') }, `📍 ${cityName(city.meta)}`)),
      // While a stop is open it comes first; the Favorite Commutes stay one scroll away.
      state.stop ? stopSection() : null,
      h('h2', {}, t('My Favorite Commutes')),
      commuteButtons(),
      state.stop ? null : stopSection(),
      consentCard(),
      h('footer', { class: 'footer' },
        h('span', { class: 'muted small' }, ctx.user.email || ctx.user.displayName),
        h('button', { class: 'link small', onclick: async () => { await signOut(); ctx.setUser(null); } }, t('Sign out')),
        h('button', { class: 'link small', onclick: () => ctx.go('#/privacy') }, t('Privacy & usage data')),
        ctx.isAdmin ? h('button', { class: 'link small', onclick: () => ctx.go('#/report') }, t('📊 Favorite Commutes report')) : null,
        h('span', { class: 'muted small' },
          t('Bus data {date} · Live: Ministry of Transport SIRI via Open Bus', { date: new Date(ctx.cityIndex.generatedAt).toLocaleDateString(locale()) }))),
      h('div', { class: 'fab-space' }),
    ];
    sheet.replaceChildren(...parts.filter(Boolean));
    sheet.scrollTop = scroll;
  }

  // Bottom right, one under the other: New Favorite Commute (while a slot is free),
  // Search routes, Options. While a stop is open they are tucked against the right edge so
  // they do not cover the route numbers: swipe them left to bring them out, right to tuck
  // them away again (the small handle does the same when tapped) (REQ-HOME-4).
  const handle = h('button', { class: 'fab-handle', type: 'button', onclick: () => tuckButtons(!fabs.classList.contains('min')) });
  function tuckButtons(min) {
    fabs.classList.toggle('min', min);
    handle.textContent = min ? '‹' : '›';
    handle.setAttribute('aria-label', min ? t('Show the buttons') : t('Hide the buttons'));
    handle.setAttribute('aria-expanded', String(!min));
  }
  function dockButtons(docked) {
    fabs.classList.toggle('docked', docked);
    tuckButtons(docked);
  }
  let swipeStart = null;
  let swiped = false;
  const fabs = h('div', {
    class: 'fab-stack',
    onpointerdown: (e) => { swipeStart = e.clientX; swiped = false; },
    onpointerup: (e) => {
      if (swipeStart === null || !fabs.classList.contains('docked')) return;
      const dx = e.clientX - swipeStart;
      swipeStart = null;
      if (Math.abs(dx) < 24) return;
      swiped = true; // a swipe is not a tap on the button under the finger
      tuckButtons(dx > 0);
    },
    onpointercancel: () => { swipeStart = null; },
  },
    handle,
    h('div', { class: 'fab-column' },
    freeSlot()
      ? h('button', {
          class: 'fab',
          // With a stop open, the new Favorite Commute starts at that stop.
          onclick: () => {
            ctx.newCommuteStopId = state.stop?.id || null;
            ctx.go(`#/edit/${freeSlot()}`);
          },
        }, t('＋ New Favorite Commute'))
      : null,
    h('button', { class: 'fab small', onclick: () => ctx.go('#/routes') }, t('🔍 Search routes')),
    h('button', { class: 'fab small', onclick: () => showOptions(ctx) }, t('⚙ Options'))));
  fabs.addEventListener('click', (e) => { if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); } }, true);
  screen.append(fabs);
  dockButtons(false);

  const panel = draggableSheet(screen, sheet, { onResize: () => map.invalidateSize({ pan: false }) });
  paint();
  setTimeout(() => map.invalidateSize(), 0);

  return () => {
    panel.destroy();
    stopWatch();
    lines.destroy();
    stops.destroy();
    map.remove();
  };
}
