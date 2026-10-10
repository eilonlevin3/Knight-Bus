// Home screen: a map around you, tap any stop to see its lines and live buses, and your
// saved commutes. Docs: docs/user-flows.md#2-home-screen
// @req REQ-HOME-1 @req REQ-HOME-2 @req REQ-HOME-3 @req REQ-FAV-1 @req REQ-FAV-2 @req REQ-AUTH-3 @req REQ-ANL-3

import { h, toast } from '../lib/dom.js';
import { FAVORITE_SLOTS, storagePrefix } from '../config.js';
import { signOut } from '../auth.js';
import { createMap, stopLayer, userMarker } from '../map.js';
import { watchPosition, getPosition } from '../location.js';
import { LiveLines } from '../liveLines.js';
import { approachPoints } from '../lib/mapFit.js';
import { draggableSheet } from '../lib/sheetDrag.js';
import { commuteName } from '../lib/names.js';
import { consent, setConsent, detailed, track, trackDetail, bucket } from '../analytics.js';
import { SAFE_SUMMARY, DEBUG_SUMMARY } from './privacy.js';
import { liveSummary, lineBadge, lineTitle } from './liveInfo.js';

const MAX_LINES_SHOWN_AT_FIRST = 30; // very busy stops: the rest start unchecked
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
      b.title = 'Go to my location';
      b.setAttribute('aria-label', 'Go to my location');
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
    state.hidden = new Set(routes.slice(MAX_LINES_SHOWN_AT_FIRST).map((r) => r.id));
    state.rows = [];
    lines.set(shownEntries());
    stops.refresh();
    paint();
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
  }

  const saved = () => FAVORITE_SLOTS.filter((slot) => ctx.favorites[slot]);
  const freeSlot = () => FAVORITE_SLOTS.find((slot) => !ctx.favorites[slot]);

  // ---------- Panel ----------

  function commuteButtons() {
    if (!saved().length) {
      return h('p', { class: 'muted small' }, 'No saved commutes yet. Use ＋ New commute to save the stops and lines you ride often.');
    }
    return h('div', { class: 'commute-list' }, ...saved().map((slot) => {
      const fav = ctx.favorites[slot];
      const lineCount = new Set(fav.stops.flatMap((s) => s.routeIds)).size;
      return h('div', { class: 'commute-item' },
        h('button', { class: 'commute-go', onclick: () => ctx.go(`#/commute/${slot}`) },
          h('b', {}, commuteName(fav, slot)),
          h('small', {}, `${fav.stops.map((s) => s.stopName).join(' → ')} · ${lineCount} line${lineCount === 1 ? '' : 's'}`)),
        h('button', { class: 'commute-edit', 'aria-label': `Edit ${commuteName(fav, slot)}`, onclick: () => ctx.go(`#/edit/${slot}`) }, '✎'));
    }));
  }

  function stopSection() {
    if (!state.stop) {
      return h('p', { class: 'muted' }, 'Tap a bus stop on the map to see its lines and live buses. Zoom in if you see no stops.');
    }
    const s = state.stop;
    const routes = city.routesAtStop(s.id);
    const rows = routes.map((r) => {
      const on = !state.hidden.has(r.id);
      const live = on ? state.rows.find((x) => x.route.id === r.id) : null;
      return h('label', { class: `line-row ${on ? 'on' : 'off'}` },
        h('input', {
          type: 'checkbox',
          checked: on,
          'aria-label': `Show line ${r.short} on the map`,
          onchange: (e) => {
            if (e.target.checked) state.hidden.delete(r.id); else state.hidden.add(r.id);
            lines.set(shownEntries());
            paint();
          },
        }),
        lineBadge(r, on ? lines.colorOf(r.id) : null),
        h('span', { class: 'line-text' },
          lineTitle(r),
          on ? liveSummary(live) : h('small', { class: 'muted' }, 'Hidden from the map')));
    });
    return h('div', { class: 'stop-section' },
      h('div', { class: 'row between' },
        h('button', { class: 'stop-title', onclick: () => map.setView([s.lat, s.lon], 17) },
          `🚏 ${s.name}`, h('span', { class: 'muted' }, ` · ${s.code}`)),
        h('button', { class: 'link', 'aria-label': 'Close this stop', onclick: closeStop }, '✕ Close')),
      h('p', { class: 'muted small' },
        `${routes.length} line${routes.length === 1 ? '' : 's'} stop here. Solid = coming to this stop, lighter = after it. Uncheck a line to hide it.`,
        routes.length > MAX_LINES_SHOWN_AT_FIRST ? ` Showing the first ${MAX_LINES_SHOWN_AT_FIRST}; check more below.` : ''),
      ...rows,
      h('div', { class: 'row between' },
        h('small', { class: 'muted' }, state.updatedAt ? `Updated ${state.updatedAt.toLocaleTimeString()} · refreshes every 30 s` : 'Loading live buses…'),
        h('button', { class: 'link small', onclick: () => lines.refresh() }, '↻ Refresh')));
  }

  // Asked once. No answer = nothing recorded.
  function consentCard() {
    if (consent() !== null) return null;
    const card = h('div', { class: 'card stack consent' },
      h('b', {}, 'Help improve Knight Bus?'),
      h('small', {}, SAFE_SUMMARY),
      detailed ? h('small', { class: 'notice' }, DEBUG_SUMMARY) : null,
      h('div', { class: 'row' },
        h('button', { onclick: async () => { await setConsent(false); card.remove(); } }, 'No thanks'),
        h('button', { class: 'primary', onclick: async () => { await setConsent(true); card.remove(); } }, 'Share usage')),
      h('button', { class: 'link small', onclick: () => ctx.go('#/privacy') }, 'Details'));
    return card;
  }

  function paint() {
    const scroll = sheet.scrollTop;
    const parts = [
      h('header', { class: 'topbar' },
        h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }),
        h('h1', {}, 'Knight Bus'),
        h('button', { class: 'link small', onclick: () => ctx.go('#/city') }, `📍 ${city.meta.name}`)),
      // While a stop is open it comes first; the commutes stay one scroll away.
      state.stop ? stopSection() : null,
      h('h2', {}, 'My commutes'),
      commuteButtons(),
      state.stop ? null : stopSection(),
      consentCard(),
      h('footer', { class: 'footer' },
        h('span', { class: 'muted small' }, ctx.user.email || ctx.user.displayName),
        h('button', { class: 'link small', onclick: async () => { await signOut(); ctx.setUser(null); } }, 'Sign out'),
        h('button', { class: 'link small', onclick: () => ctx.go('#/privacy') }, 'Privacy & usage data'),
        ctx.isAdmin ? h('button', { class: 'link small', onclick: () => ctx.go('#/report') }, '📊 Commute report') : null,
        h('span', { class: 'muted small' },
          `Bus data ${new Date(ctx.cityIndex.generatedAt).toLocaleDateString()} · Live: Ministry of Transport SIRI via Open Bus`)),
      h('div', { class: 'fab-space' }),
    ];
    sheet.replaceChildren(...parts.filter(Boolean));
    sheet.scrollTop = scroll;
  }

  // Small "new commute" button, bottom right, while a slot is free.
  // With a stop open, the new commute starts at that stop.
  if (freeSlot()) {
    screen.append(h('button', {
      class: 'fab',
      onclick: () => {
        ctx.newCommuteStopId = state.stop?.id || null;
        ctx.go(`#/edit/${freeSlot()}`);
      },
    }, '＋ New commute'));
  }

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
