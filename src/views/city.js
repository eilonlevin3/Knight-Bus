// Choose the metropolitan area: GPS first, list as fallback. Docs: docs/user-flows.md#1-first-launch
// @req REQ-LOC-1 @req REQ-LOC-2

import { h } from '../lib/dom.js';
import { t, language, cityName } from '../i18n.js';
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
      ctx.go('#/home');
    } catch (e) {
      status.textContent = e.message;
      root.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  };

  const showList = () => {
    list.replaceChildren(
      h('p', {}, t('Or pick your city:')),
      ...ctx.cityIndex.cities.map((c) =>
        h('button', { class: 'choice', onclick: () => choose(c) },
          // The name in the app's language first, the other language beside it.
          h('b', {}, cityName(c)), h('span', { class: 'muted', dir: 'auto' }, language() === 'he' ? c.name : c.nameHe))),
    );
  };

  const useGps = async () => {
    status.textContent = t('Finding your location…');
    try {
      const pos = await getPosition();
      ctx.position = pos;
      const city = cityForPosition(ctx.cityIndex.cities, pos);
      if (city) {
        status.textContent = t('You are in {city}.', { city: cityName(city) });
        await choose(city, 'gps');
      } else {
        status.textContent = t('You seem to be outside the areas we cover so far.');
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
        h('h2', {}, t('Where do you ride?')),
        h('p', {}, t("Knight Bus uses your location to download only your city's bus map, so it stays small and fast.")),
        h('button', { class: 'primary', onclick: useGps }, t('📍 Use my location')),
        status,
        list,
        ctx.city ? h('button', { class: 'link', onclick: () => ctx.go('#/home') }, t('Cancel')) : null)),
  );
  showList();
}
