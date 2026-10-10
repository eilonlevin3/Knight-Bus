// Choose the metropolitan area: GPS first, list as fallback. Docs: docs/user-flows.md#1-first-launch
// @req REQ-LOC-1 @req REQ-LOC-2

import { h } from '../lib/dom.js';
import { getPosition, cityForPosition } from '../location.js';
import { track, trackDetail } from '../analytics.js';

export function render(root, ctx) {
  const status = h('p', { class: 'muted', role: 'status' });
  const list = h('div', { class: 'stack' });

  const choose = async (meta, how = 'list') => {
    root.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await ctx.setCity(meta, (msg) => (status.textContent = msg));
      track('city_chosen', { city: meta.id, how });
      trackDetail('city_chosen', { city: meta.id, how, position: ctx.position });
      ctx.go('#/menu');
    } catch (e) {
      status.textContent = e.message;
      root.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  };

  const showList = () => {
    list.replaceChildren(
      h('p', {}, 'Or pick your city:'),
      ...ctx.cityIndex.cities.map((c) =>
        h('button', { class: 'choice', onclick: () => choose(c) },
          h('b', {}, c.name), h('span', { class: 'muted', dir: 'rtl' }, c.nameHe))),
    );
  };

  const useGps = async () => {
    status.textContent = 'Finding your location…';
    try {
      const pos = await getPosition();
      ctx.position = pos;
      const city = cityForPosition(ctx.cityIndex.cities, pos);
      if (city) {
        status.textContent = `You are in ${city.name}.`;
        await choose(city, 'gps');
      } else {
        status.textContent = 'You seem to be outside the areas we cover so far.';
        showList();
      }
    } catch (e) {
      status.textContent = e.message;
      showList();
    }
  };

  root.append(
    h('main', { class: 'screen center' },
      h('div', { class: 'card stack' },
        h('h2', {}, 'Where do you ride?'),
        h('p', {}, 'Knight Bus uses your location to download only your city\'s bus map, so it stays small and fast.'),
        h('button', { class: 'primary', onclick: useGps }, '📍 Use my location'),
        status,
        list,
        ctx.city ? h('button', { class: 'link', onclick: () => ctx.go('#/menu') }, 'Cancel') : null)),
  );
  showList();
}
