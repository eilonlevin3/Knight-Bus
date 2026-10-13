// Edit a Favorite Commute: pick up to 2 stops, check routes, save. Docs: docs/user-flows.md#3-editing-a-favorite-commute
// @req REQ-FAV-6 @req REQ-EDIT-1 @req REQ-EDIT-2 @req REQ-EDIT-3 @req REQ-EDIT-5 @req REQ-EDIT-6 @req REQ-FAV-2 @req REQ-FAV-4 @req REQ-FAV-5

import { h, toast } from '../lib/dom.js';
import { t, tn } from '../i18n.js';
import { MAX_STOPS_PER_FAVORITE } from '../config.js';
import { createMap, stopLayer, userMarker, flagMarker, flagHtml, legendControl, legendHtml } from '../map.js';
import { draggableSheet, PANEL_SIZES } from '../lib/sheetDrag.js';
import { watchPosition, getPosition } from '../location.js';
import { searchPlaces, placeName } from '../geocode.js';
import { LiveLines } from '../liveLines.js';
import { saveFavorite, deleteFavorite } from '../store.js';
import { routeBadge, routeChip, repeatedNumbers, selectAllRow, directionRow } from './liveInfo.js';
import { showRouteCard } from './lineInfo.js';
import { stopSuffix, stopHazard, platformText } from './stopInfo.js';
import { commuteName, isDefaultName } from '../lib/names.js';
import { commuteViewPoints } from '../lib/mapFit.js';
import { readView, writeView, clearView } from '../lib/savedView.js';
import { track, trackDetail, bucket } from '../analytics.js';

export async function render(root, ctx, { slot }) {
  const existing = ctx.favorites[slot];
  const city = existing ? await ctx.getCity(existing.cityId) : ctx.city;

  // Working copy; nothing is saved until "Save Favorite Commute".
  const draft = existing
    ? structuredClone(existing)
    : { name: '', cityId: city.id, stops: [] };
  for (const st of draft.stops) st.routeIds = city.currentRouteIds(st.routeIds); // REQ-DATA-10
  // A default name ("Favorite Commute 2", in either language) shows as an empty box with a hint.
  if (isDefaultName(draft.name)) draft.name = '';
  // Optional start point and destination: { lat, lon, label } or null.
  draft.origin ??= null;
  draft.destination ??= null;

  // How this Favorite Commute opens: { lat, lon, zoom, panel, keyOpen }, or null = automatic.
  //   panel: 'small' | 'half' | 'large' (how high the bottom panel is); keyOpen: is the map key open
  // Kept on this device (REQ-FAV-6); written when the Favorite Commute is saved.
  let openingView = existing ? readView(ctx.user, slot) : null;
  // While the opening view is being chosen, this screen looks like the Favorite Commute
  // screen: the same draggable panel and the same map key.
  let viewPanel = null;
  let viewLegend = null;
  let viewDraft = { panel: 'half', keyOpen: true };

  const state = {
    mode: draft.stops.length ? 'summary' : 'pick', // 'summary' | 'pick' | 'lines' | 'place'
    index: 0, // which stop (0 or 1) is being edited
    placeKind: null, // 'origin' | 'destination' while setting one on the map
    placeResults: [], // address search results
    stop: null, // stop picked on the map
    checked: new Set(), // route ids checked for that stop
    live: new Map(), // `${stopId}|${routeId}` -> live row
  };

  const mapEl = h('div', { class: 'map' });
  const sheet = h('section', { class: 'sheet' });
  const screen = h('main', { class: 'map-screen' }, mapEl, sheet);
  root.append(screen);

  const first = draft.stops[0] && city.stops.get(draft.stops[0].stopId);
  const center = first ? [first.lat, first.lon] : ctx.position ? [ctx.position.lat, ctx.position.lon] : city.meta.center;
  const map = createMap(mapEl, center, 16);
  const showMe = userMarker(map);
  showMe(ctx.position);
  const stopWatch = watchPosition((p) => { ctx.position = p; showMe(p); });

  const lines = new LiveLines(map, city, {
    onUpdate: (rows) => {
      state.live = new Map(rows.map((r) => [`${r.stop.id}|${r.route.id}`, r]));
      if (state.mode === 'lines') paint(); // other modes show no live info; keeps typing undisturbed
    },
  });

  const stops = stopLayer(map, city, {
    selectedIds: () => [state.stop?.id, ...draft.stops.map((s) => s.stopId)].filter(Boolean),
    onPick: (s) => {
      if (state.mode === 'pick' || state.mode === 'lines') pickStop(s);
    },
  });

  // Start point and destination flags.
  let flags = [];
  function drawFlags() {
    flags.forEach((m) => m.remove());
    flags = ['origin', 'destination'].filter((k) => draft[k]).map((k) => flagMarker(map, k, draft[k]));
  }

  // While setting a start point or destination, a tap anywhere on the map places it.
  map.on('click', (e) => {
    if (state.mode !== 'place') return;
    track('place_set', { kind: state.placeKind, how: 'tap' });
    setPlace(state.placeKind, { lat: e.latlng.lat, lon: e.latlng.lng, label: t('Pinned point') }, true);
  });

  function setPlace(kind, place, lookUpName = false) {
    const p = { lat: +place.lat.toFixed(6), lon: +place.lon.toFixed(6), label: place.label };
    draft[kind] = p;
    go('summary');
    if (lookUpName) {
      placeName(p.lat, p.lon).then((name) => {
        if (name && draft[kind] === p) { p.label = name; drawFlags(); paint(); }
      });
    }
  }

  function pickStop(s, how = 'map') {
    if (state.mode === 'pick') track('stop_picked', { how });
    const saved = draft.stops[state.index];
    state.stop = s;
    state.heading = city.defaultHeading(s.id);
    // Default: no lines shown, unless re-editing the same stop (keep what was saved).
    state.checked = new Set(saved?.stopId === s.id ? saved.routeIds : []);
    state.mode = 'lines';
    map.panTo([s.lat, s.lon]);
    update();
  }

  // Which (stop, line) pairs should be on the map right now.
  function shownEntries() {
    if (state.mode === 'lines') return [...state.checked].map((routeId) => ({ stopId: state.stop.id, routeId }));
    if (state.mode === 'summary' || state.mode === 'view') return draft.stops.flatMap((s) => s.routeIds.map((routeId) => ({ stopId: s.stopId, routeId })));
    return [];
  }

  function update() {
    lines.set(shownEntries());
    stops.refresh();
    drawFlags();
    paint();
  }

  // Summary view: the chosen lines plus the flags.
  function fitSummary() {
    const layers = [...lines.lineLayers.values()].flat().concat(flags);
    if (layers.length) map.fitBounds(L.featureGroup(layers).getBounds(), { padding: [30, 30], maxZoom: 16 });
  }

  const go = (mode, index = state.index) => {
    if (state.mode === 'view' && mode !== 'view') leaveView();
    state.mode = mode;
    state.index = index;
    if (mode === 'pick') state.stop = null;
    update();
    if (mode === 'summary') fitSummary();
    if (mode === 'view') enterView();
  };

  // Choosing the opening view. The screen is laid out like the Favorite Commute screen, so
  // what is seen here is what opens there: the panel can be dragged, the key folded.
  function enterView() {
    viewDraft = { panel: openingView?.panel || 'half', keyOpen: openingView ? openingView.keyOpen !== false : true };
    screen.classList.add('dynamic');
    viewLegend = legendControl(map, { onToggle: (open) => { viewDraft.keyOpen = open; paint(); } });
    viewLegend.update(legendHtml(lines.legendItems(), draft));
    viewLegend.setOpen(viewDraft.keyOpen);
    viewPanel = draggableSheet(screen, sheet, {
      start: PANEL_SIZES[viewDraft.panel],
      onResize: () => map.invalidateSize({ pan: false }),
      onSnap: (size) => { if (PANEL_SIZES[size]) { viewDraft.panel = size; paint(); } },
    });
    paint();
    // Once the panel has its size: the chosen view, or the automatic one.
    setTimeout(() => {
      if (state.mode !== 'view') return;
      map.invalidateSize();
      if (openingView) return map.setView([openingView.lat, openingView.lon], openingView.zoom);
      const pts = commuteViewPoints(city, draft);
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 17 });
    }, 0);
  }

  function leaveView(resizeMap = true) {
    viewPanel?.destroy();
    viewLegend?.remove();
    viewPanel = null;
    viewLegend = null;
    screen.classList.remove('dynamic', 'snapping');
    screen.style.removeProperty('--sheet-h');
    if (resizeMap) setTimeout(() => { if (state.mode !== 'view') map.invalidateSize(); }, 0);
  }

  // ---------- Sheet contents per mode ----------

  function paintPick() {
    const results = h('div', { class: 'results' });
    const search = h('input', {
      type: 'search',
      placeholder: t('Search stop name or code'),
      oninput: () => {
        results.replaceChildren(...city.searchStops(search.value).map((s) =>
          h('button', { class: 'result', onclick: () => { map.setView([s.lat, s.lon], 17); pickStop(s, 'search'); } },
            h('b', {}, s.name), h('span', { class: 'muted' }, `${stopSuffix(s)} · ${tn(s.routeIds.length, '1 route', '{n} routes')}`))));
      },
    });
    return [
      h('h2', {}, t('Stop {n}: choose a bus stop', { n: state.index + 1 })),
      h('p', { class: 'muted' }, t('Tap a stop on the map (zoom in to see stops), or search:')),
      search,
      results,
      h('div', { class: 'row' },
        h('button', { onclick: () => (draft.stops.length ? go('summary') : ctx.go('#/home')) }, t('Cancel'))),
    ];
  }

  function paintLines() {
    const s = state.stop;
    // At a train station the trains of one direction are listed at a time; routes checked
    // in the other direction stay checked.
    const routes = city.routesAtStopHeading(s.id, state.heading);
    // The same small icons as on the home screen: a checkbox and the route number; the
    // number opens more about the route (REQ-EDIT-2).
    const repeated = repeatedNumbers(routes);
    const rows = routes.map((r) => {
      const on = state.checked.has(r.id);
      return routeChip(r, {
        on,
        color: lines.colorOf(r.id),
        repeated: repeated.has(r.short),
        onToggle: (checked) => {
          if (checked) state.checked.add(r.id); else state.checked.delete(r.id);
          update();
        },
        onInfo: () => showRouteCard(ctx, city, r, s, {
          live: on ? state.live.get(`${s.id}|${r.id}`) : null, shown: on,
          // Leaving for the full-route screen would drop what was not saved yet.
          confirmLeave: t('Open the full route? What you have not saved in this Favorite Commute will be lost.'),
        }),
      });
    });
    return [
      h('h2', {}, t('Stop {n}: {name}', { n: state.index + 1, name: s.name })),
      h('p', { class: 'muted' }, `${t('Stop code {code}', { code: s.code })}${platformText(s) ? ` · ${platformText(s)}` : ''} `, stopHazard(city, s, (other) => pickStop(other, 'platform')),
        ` · ${tn(routes.length, '1 route.', '{n} routes.')} ${t('Check the routes you want to see. Tap a number for details.')}`,
        ' ', h('button', { class: 'link small', onclick: () => go('pick') }, t('Change stop'))),
      directionRow(city.trainHeadings(s.id), state.heading, () => {
        state.heading = state.heading === 'north' ? 'south' : 'north';
        track('train_direction_switched', { where: 'editor' });
        paint();
      }),
      selectAllRow(
        () => { state.checked = new Set([...state.checked, ...routes.map((r) => r.id)]); update(); track('routes_select_all', { where: 'editor' }); },
        () => { state.checked = new Set(); update(); track('routes_clear_all', { where: 'editor' }); }),
      h('div', { class: 'route-chips' }, ...rows),
      h('div', { class: 'row sticky' },
        h('button', { onclick: () => (draft.stops.length ? go('summary') : ctx.go('#/home')) }, t('Cancel')),
        h('button', {
          class: 'primary',
          disabled: state.checked.size === 0,
          onclick: () => {
            draft.stops[state.index] = { stopId: s.id, stopName: s.name, stopCode: s.code, routeIds: [...state.checked] };
            state.stop = null;
            go('summary');
          },
        }, state.checked.size ? tn(state.checked.size, 'Save stop (1 route)', 'Save stop ({n} routes)') : t('Check at least one route'))),
    ];
  }

  function paintPlace() {
    const kind = state.placeKind;
    const input = h('input', { type: 'search', placeholder: t('Address or place'), enterKeyHint: 'search' });
    const status = h('p', { class: 'muted small', role: 'status' }, state.placeStatus || '');
    const results = h('div', { class: 'results' }, ...state.placeResults.map((r) =>
      h('button', { class: 'result', onclick: () => { map.setView([r.lat, r.lon], 16); track('place_set', { kind, how: 'search' }); setPlace(kind, r); } }, r.label)));
    const form = h('form', {
      class: 'row',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        status.textContent = t('Searching…');
        try {
          state.placeResults = await searchPlaces(input.value.trim(), city.meta);
          state.placeStatus = state.placeResults.length ? '' : t('Nothing found. Try another spelling, or tap the map.');
        } catch (err) {
          state.placeStatus = err.message;
        }
        paint();
      },
    }, input, h('button', { type: 'submit' }, t('Search')));
    return [
      h('h2', {}, h('span', { class: 'flag-inline', innerHTML: flagHtml(kind) }), ` ${kind === 'origin' ? t('Set start point') : t('Set destination')}`),
      h('p', { class: 'muted' }, kind === 'origin'
        ? t('Tap the map where your start point is, or search for an address:')
        : t('Tap the map where your destination is, or search for an address:')),
      form,
      status,
      results,
      kind === 'origin'
        ? h('button', {
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const p = await getPosition();
                track('place_set', { kind: 'origin', how: 'my_location' });
                setPlace('origin', { ...p, label: t('My location') }, true);
              } catch (err) {
                toast(err.message);
                e.target.disabled = false;
              }
            },
          }, t('📍 Use my current location'))
        : null,
      h('div', { class: 'row' }, h('button', { onclick: () => go('summary') }, t('Cancel'))),
    ];
  }

  function placeCard(kind) {
    const place = draft[kind];
    const title = kind === 'origin' ? t('Start point') : t('Destination');
    const startSetting = () => {
      state.placeKind = kind;
      state.placeResults = [];
      state.placeStatus = '';
      go('place');
    };
    return h('div', { class: 'card place-card' },
      h('div', { class: 'row between' },
        h('span', {}, h('span', { class: 'flag-inline', innerHTML: flagHtml(kind) }), ' ', h('b', {}, title),
          h('span', { class: 'muted small' }, place ? '' : t(' (optional)'))),
        h('span', {},
          h('button', { class: 'link small', onclick: startSetting }, place ? t('Change') : t('Set')),
          place ? h('button', { class: 'link small danger', onclick: () => { draft[kind] = null; update(); } }, t('Remove')) : null)),
      place ? h('small', { class: 'muted place-label' }, place.label) : null);
  }

  // Choosing the opening view: everything is drawn; the person moves and zooms the map,
  // sets how high the panel is and whether the key is open. The buttons come first, so
  // they stay in reach when the panel is low.
  const panelNames = () => ({ small: t('Low'), half: t('Half'), large: t('High') });
  function paintView() {
    const choice = (on, label, onclick) => h('button', { class: on ? 'primary' : '', 'aria-pressed': String(on), onclick }, label);
    return [
      h('div', { class: 'row' },
        h('button', { onclick: () => go('summary') }, t('Cancel')),
        h('button', {
          class: 'primary',
          onclick: () => {
            const c = map.getCenter();
            openingView = { lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), zoom: map.getZoom(), panel: viewDraft.panel, keyOpen: viewDraft.keyOpen };
            track('opening_view_set', { zoom: openingView.zoom, panel: openingView.panel, key_open: openingView.keyOpen ? 1 : 0 });
            go('summary');
          },
        }, t('Use this view'))),
      h('b', { class: 'small' }, t('Bottom panel')),
      h('div', { class: 'row lang-row' }, ...Object.entries(panelNames()).map(([size, label]) =>
        choice(viewDraft.panel === size, label, () => { viewDraft.panel = size; viewPanel.setSize(size); paint(); }))),
      h('b', { class: 'small' }, t('Map key')),
      h('div', { class: 'row lang-row' },
        choice(viewDraft.keyOpen, t('Open'), () => { viewDraft.keyOpen = true; viewLegend.setOpen(true); paint(); }),
        choice(!viewDraft.keyOpen, t('Folded'), () => { viewDraft.keyOpen = false; viewLegend.setOpen(false); paint(); })),
      h('p', { class: 'muted small' }, t('Move and zoom the map until it shows what you want to see each time you open this Favorite Commute. Your stops, routes, start point and destination are drawn; they do not all have to be in view.'),
        ' ', t('You can also drag this panel up or down, and tap the key on the map.')),
    ];
  }

  function viewCard() {
    return h('div', { class: 'card place-card' },
      h('div', { class: 'row between' },
        h('span', {}, '🔍 ', h('b', {}, t('Opening view'))),
        h('span', {},
          h('button', { class: 'link small', onclick: () => go('view') }, openingView ? t('Change') : t('Set')),
          openingView ? h('button', { class: 'link small danger', onclick: () => { openingView = null; paint(); } }, t('Automatic')) : null)),
      h('small', { class: 'muted place-label' }, openingView
        ? `${t('The map opens the way you set it.')} ${t('Bottom panel')}: ${panelNames()[openingView.panel || 'half']} · ${t('Map key')}: ${openingView.keyOpen === false ? t('Folded') : t('Open')}`
        : t('Automatic: your stops and about 1 km of each route coming to them.')));
  }

  function paintSummary() {
    const name = h('input', {
      type: 'text', value: draft.name, maxLength: 40, placeholder: t('e.g. To work (otherwise: Favorite Commute {n})', { n: slot }),
      oninput: (e) => (draft.name = e.target.value),
    });
    const stopCards = draft.stops.map((st, i) => h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('b', {}, t('Stop {n}: {name}', { n: i + 1, name: st.stopName })),
        h('span', {},
          h('button', { class: 'link small', onclick: () => {
            const stop = city.stops.get(st.stopId);
            if (stop) { state.index = i; pickStop(stop); } else go('pick', i); // stop removed from newer data
          } }, t('Edit')),
          h('button', { class: 'link small danger', onclick: () => { draft.stops.splice(i, 1); draft.stops.length ? update() : go('pick', 0); } }, t('Remove')))),
      h('div', { class: 'chips' }, ...st.routeIds.map((id) => {
        const r = city.routes.get(id);
        return r ? routeBadge(r, lines.colorOf(id)) : null;
      }))));

    return [
      h('h2', {}, t('Favorite Commute {n}', { n: slot })),
      h('label', { class: 'field' }, t('Name (shown on its home-screen button)'), name),
      placeCard('origin'),
      ...stopCards,
      draft.stops.length < MAX_STOPS_PER_FAVORITE
        ? h('button', { onclick: () => go('pick', draft.stops.length) }, t('+ Add stop {n}', { n: draft.stops.length + 1 }))
        : null,
      placeCard('destination'),
      viewCard(),
      h('div', { class: 'row sticky' },
        h('button', { onclick: () => ctx.go('#/home') }, t('Cancel')),
        h('button', {
          class: 'primary',
          disabled: draft.stops.length === 0,
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await saveFavorite(ctx.user, slot, { ...draft, name: commuteName(draft, slot) });
              if (openingView) writeView(ctx.user, slot, openingView); else clearView(ctx.user, slot);
              const lineIds = draft.stops.flatMap((st) => st.routeIds);
              track('commute_saved', {
                slot, city: city.id, is_new: existing ? 0 : 1, stops: draft.stops.length, lines: bucket(lineIds.length),
                has_start: draft.origin ? 1 : 0, has_destination: draft.destination ? 1 : 0,
                weekend_lines: lineIds.filter((id) => city.routes.get(id)?.source).length ? 1 : 0,
              });
              trackDetail('commute_saved', { slot, commute: draft });
              await ctx.reloadFavorites();
              toast(t('Favorite Commute saved'));
              ctx.go('#/home');
            } catch (err) {
              toast(t('Could not save: {error}', { error: err.message }));
              e.target.disabled = false;
            }
          },
        }, t('Save Favorite Commute'))),
      existing
        ? h('button', {
            class: 'link small danger',
            onclick: async () => {
              await deleteFavorite(ctx.user, slot);
              clearView(ctx.user, slot);
              track('commute_cleared', { slot });
              await ctx.reloadFavorites();
              toast(t('Favorite Commute cleared'));
              ctx.go('#/home');
            },
          }, t('Clear this Favorite Commute'))
        : null,
    ];
  }

  function paint() {
    const scroll = sheet.scrollTop;
    const content = { pick: paintPick, lines: paintLines, place: paintPlace, view: paintView, summary: paintSummary }[state.mode]();
    sheet.replaceChildren(...content.filter(Boolean)); // optional parts are null when hidden
    sheet.scrollTop = scroll;
  }

  update();
  if (state.mode === 'summary') fitSummary();
  setTimeout(() => map.invalidateSize(), 0);

  // "New commute" pressed while a stop was open on the home map: start with that stop.
  const startStop = !existing && ctx.newCommuteStopId ? city.stops.get(ctx.newCommuteStopId) : null;
  ctx.newCommuteStopId = null;
  if (startStop) { map.setView([startStop.lat, startStop.lon], 16); pickStop(startStop, 'home'); }

  return () => {
    if (state.mode === 'view') leaveView(false);
    state.mode = 'closed';
    stopWatch();
    lines.destroy();
    stops.destroy();
    map.remove();
  };
}
