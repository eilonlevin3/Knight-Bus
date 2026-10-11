// Edit a Favorite Commute: pick up to 2 stops, check routes, save. Docs: docs/user-flows.md#3-editing-a-favorite-commute
// @req REQ-EDIT-1 @req REQ-EDIT-2 @req REQ-EDIT-3 @req REQ-EDIT-5 @req REQ-EDIT-6 @req REQ-FAV-2 @req REQ-FAV-4 @req REQ-FAV-5

import { h, toast } from '../lib/dom.js';
import { t, tn } from '../i18n.js';
import { MAX_STOPS_PER_FAVORITE } from '../config.js';
import { createMap, stopLayer, userMarker, flagMarker, flagHtml } from '../map.js';
import { watchPosition, getPosition } from '../location.js';
import { searchPlaces, placeName } from '../geocode.js';
import { LiveLines } from '../liveLines.js';
import { saveFavorite, deleteFavorite } from '../store.js';
import { liveSummary, routeBadge, routeTitle } from './liveInfo.js';
import { showRouteInfo } from './lineInfo.js';
import { stopSuffix, stopHazard, platformText } from './stopInfo.js';
import { commuteName, isDefaultName } from '../lib/names.js';
import { track, trackDetail, bucket } from '../analytics.js';

export async function render(root, ctx, { slot }) {
  const existing = ctx.favorites[slot];
  const city = existing ? await ctx.getCity(existing.cityId) : ctx.city;

  // Working copy; nothing is saved until "Save Favorite Commute".
  const draft = existing
    ? structuredClone(existing)
    : { name: '', cityId: city.id, stops: [] };
  // A default name ("Favorite Commute 2", in either language) shows as an empty box with a hint.
  if (isDefaultName(draft.name)) draft.name = '';
  // Optional start point and destination: { lat, lon, label } or null.
  draft.origin ??= null;
  draft.destination ??= null;

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
  root.append(h('main', { class: 'map-screen' }, mapEl, sheet));

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
    // Default: no lines shown, unless re-editing the same stop (keep what was saved).
    state.checked = new Set(saved?.stopId === s.id ? saved.routeIds : []);
    state.mode = 'lines';
    map.panTo([s.lat, s.lon]);
    update();
  }

  // Which (stop, line) pairs should be on the map right now.
  function shownEntries() {
    if (state.mode === 'lines') return [...state.checked].map((routeId) => ({ stopId: state.stop.id, routeId }));
    if (state.mode === 'summary') return draft.stops.flatMap((s) => s.routeIds.map((routeId) => ({ stopId: s.stopId, routeId })));
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
    state.mode = mode;
    state.index = index;
    if (mode === 'pick') state.stop = null;
    update();
    if (mode === 'summary') fitSummary();
  };

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
    const routes = city.routesAtStop(s.id);
    // Same number + destination twice = two routes of one number; show where each starts to tell them apart.
    const seen = {};
    for (const r of routes) seen[`${r.short}|${r.dest}`] = (seen[`${r.short}|${r.dest}`] || 0) + 1;
    const rows = routes.map((r) => {
      const variant = seen[`${r.short}|${r.dest}`] > 1 ? t(' · from {stop}, {n} stops', { stop: r.stops[0].name, n: r.stops.length }) : '';
      const on = state.checked.has(r.id);
      const live = on ? state.live.get(`${s.id}|${r.id}`) : null;
      return h('label', { class: `line-row ${on ? 'on' : ''}` },
        h('input', {
          type: 'checkbox',
          checked: on,
          onchange: (e) => {
            if (e.target.checked) state.checked.add(r.id);
            else state.checked.delete(r.id);
            update();
          },
        }),
        routeBadge(r, on ? lines.colorOf(r.id) : null),
        h('span', { class: 'line-text' },
          routeTitle(r, () => showRouteInfo(ctx, city, r, s.id)),
          h('small', { class: 'muted' }, r.agency + (r.hours ? ` · ${t(r.hours)}` : '') + variant),
          on ? liveSummary(live) : null));
    });
    return [
      h('h2', {}, t('Stop {n}: {name}', { n: state.index + 1, name: s.name })),
      h('p', { class: 'muted' }, `${t('Stop code {code}', { code: s.code })}${platformText(s) ? ` · ${platformText(s)}` : ''} `, stopHazard(city, s, (other) => pickStop(other, 'platform')),
        ` · ${tn(routes.length, '1 route.', '{n} routes.')} ${t('Check the routes you want to see.')}`,
        ' ', h('button', { class: 'link small', onclick: () => go('pick') }, t('Change stop'))),
      h('div', { class: 'line-list' }, ...rows),
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
      h('div', { class: 'row sticky' },
        h('button', { onclick: () => ctx.go('#/home') }, t('Cancel')),
        h('button', {
          class: 'primary',
          disabled: draft.stops.length === 0,
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await saveFavorite(ctx.user, slot, { ...draft, name: commuteName(draft, slot) });
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
    const content = { pick: paintPick, lines: paintLines, place: paintPlace, summary: paintSummary }[state.mode]();
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
    stopWatch();
    lines.destroy();
    stops.destroy();
    map.remove();
  };
}
