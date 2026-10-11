// App start-up and screen router. Docs: docs/architecture.md#the-app
// Screens are chosen by the URL hash: #/login, #/city, #/home, #/edit/1, #/commute/1, #/routes
// (#/menu is the old name of #/home and still works, for apps installed before the rename.)
// @req REQ-AUTH-3 @req REQ-PWA-2 @req REQ-LANG-2

import { h } from './lib/dom.js';
import { t, applyLanguage } from './i18n.js';
import { storagePrefix } from './config.js';
import { build } from './build.js';
import { registerServiceWorker } from './updates.js';
import { watchUser } from './auth.js';
import { loadFavorites, adoptDemoFavorites, isAdmin } from './store.js';
import { loadCityIndex, loadCity } from './cityData.js';
import * as login from './views/login.js';
import * as cityView from './views/city.js';
import * as home from './views/home.js';
import * as editor from './views/editor.js';
import * as commute from './views/commute.js';
import * as privacy from './views/privacy.js';
import * as report from './views/report.js';
import * as line from './views/line.js';
import * as routes from './views/routes.js';
import * as analytics from './analytics.js';

applyLanguage();
const root = document.getElementById('app');
const CITY_KEY = `${storagePrefix}cityId`;

const ctx = {
  user: null,
  cityIndex: null,
  city: null, // CityData of the selected city
  favorites: {},
  isAdmin: false, // may open the commute report
  position: null, // last known GPS position

  go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },

  setUser(user) {
    ctx.user = user;
    if (!user) { ctx.favorites = {}; ctx.isAdmin = false; }
    start();
  },

  async setCity(meta, onProgress) {
    ctx.city = await loadCity(meta, onProgress);
    try { localStorage.setItem(CITY_KEY, meta.id); } catch {}
  },

  // A favorite may belong to another city than the selected one.
  async getCity(cityId) {
    if (ctx.city?.id === cityId) return ctx.city;
    const meta = ctx.cityIndex.cities.find((c) => c.id === cityId);
    if (!meta) throw new Error(t('City "{city}" is no longer available.', { city: cityId }));
    return loadCity(meta);
  },

  async reloadFavorites() {
    ctx.favorites = await loadFavorites(ctx.user);
  },
};

let cleanup = null;
let renderToken = 0;

async function route() {
  const token = ++renderToken;
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  root.replaceChildren();

  // #/commute/2 · #/edit/1 · #/routes · #/line/<city>/<route id>/<stop id>
  const [, name = 'home', param, param2, param3] = location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?(?:\/([\w-]+))?(?:\/([\w-]+))?/) || [];

  // Guards: signed in -> city chosen -> requested screen.
  if (!ctx.user) { analytics.screen('login'); return login.render(root, ctx); }
  if (name === 'city' || !ctx.city) { analytics.screen('city'); return cityView.render(root, ctx); }
  if (name === 'privacy') { analytics.screen('privacy'); return privacy.render(root, ctx); }

  const views = { home, menu: home, edit: editor, commute, line, routes, report: ctx.isAdmin ? report : home };
  const view = views[name] || home;
  const slot = Number(param);
  if ((view === editor || view === commute) && ![1, 2, 3].includes(slot)) return ctx.go('#/home');
  analytics.screen(view === home ? 'home' : view === editor ? 'editor' : view === report ? 'report' : view === line ? 'line' : view === routes ? 'routes' : 'commute');

  // Render into a container that is already in the page (the map needs its size),
  // with a loading overlay on top until the screen is ready.
  const container = h('div', { class: 'view' });
  const overlay = loading(t('Loading…'));
  root.append(container, overlay);
  try {
    const nextCleanup = await view.render(container, ctx, { slot, cityId: param, routeId: param2, stopId: param3 });
    if (token !== renderToken) return typeof nextCleanup === 'function' && nextCleanup();
    cleanup = nextCleanup;
    overlay.remove();
  } catch (e) {
    console.error(e);
    if (token === renderToken) root.replaceChildren(errorBox(e));
  }
}

function loading(text) {
  return h('main', { class: 'screen center loading' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, text));
}

function errorBox(e) {
  return h('main', { class: 'screen center' },
    h('div', { class: 'card stack' },
      h('h2', {}, t('Something went wrong')),
      h('p', {}, e.message),
      h('button', { class: 'primary', onclick: () => location.reload() }, t('Reload'))));
}

// After sign-in: load the city list, the remembered city (from the device cache) and favorites.
async function start() {
  if (!ctx.user) return route();
  root.replaceChildren(loading(t('Loading your city…')));
  try {
    ctx.cityIndex ||= await loadCityIndex();
    const saved = (() => { try { return localStorage.getItem(CITY_KEY); } catch { return null; } })();
    const meta = ctx.cityIndex.cities.find((c) => c.id === saved);
    const [, favs, admin] = await Promise.all([meta && !ctx.city ? ctx.setCity(meta) : null, loadFavorites(ctx.user), isAdmin(ctx.user)]);
    ctx.isAdmin = admin;
    ctx.favorites = await adoptDemoFavorites(ctx.user, favs).catch((e) => { console.warn('Demo commutes not copied', e); return favs; });
  } catch (e) {
    console.error(e);
    root.replaceChildren(errorBox(e));
    return;
  }
  route();
}

window.addEventListener('hashchange', route);
// The language was changed (Options): draw the current screen again in the new language.
window.addEventListener('kb-language', route);

watchUser((user) => {
  const changed = user?.uid !== ctx.user?.uid;
  ctx.user = user;
  analytics.setAnalyticsUser(user);
  if (changed && user) analytics.track('signed_in', { method: user.local ? 'demo' : user.provider || 'unknown' });
  if (changed || !ctx.cityIndex) start();
});

registerServiceWorker();
analytics.track('app_open', { display: analytics.displayMode(), hour: analytics.hourOfDay(), weekday: analytics.weekday() });

// Test versions wear a badge, so you always know which one you are looking at.
// @req REQ-REL-2
if (build.channel !== 'main') {
  document.body.append(h('div', { class: `channel-badge ${build.channel}`, title: build.builtAt || '' },
    `${build.channel.toUpperCase()} · ${build.commit}`));
}
