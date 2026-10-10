// App start-up and screen router. Docs: docs/architecture.md#the-app
// Screens are chosen by the URL hash: #/login, #/city, #/menu, #/edit/1, #/commute/1
// @req REQ-AUTH-3 @req REQ-PWA-2

import { h } from './lib/dom.js';
import { storagePrefix } from './config.js';
import { build } from './build.js';
import { registerServiceWorker } from './updates.js';
import { watchUser } from './auth.js';
import { loadFavorites, adoptDemoFavorites, isAdmin } from './store.js';
import { loadCityIndex, loadCity } from './cityData.js';
import * as login from './views/login.js';
import * as cityView from './views/city.js';
import * as menu from './views/menu.js';
import * as editor from './views/editor.js';
import * as commute from './views/commute.js';
import * as privacy from './views/privacy.js';
import * as report from './views/report.js';
import * as analytics from './analytics.js';

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
    if (!meta) throw new Error(`City "${cityId}" is no longer available.`);
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

  const [, name = 'menu', param] = location.hash.match(/^#\/(\w+)(?:\/(\d))?/) || [];

  // Guards: signed in -> city chosen -> requested screen.
  if (!ctx.user) { analytics.screen('login'); return login.render(root, ctx); }
  if (name === 'city' || !ctx.city) { analytics.screen('city'); return cityView.render(root, ctx); }
  if (name === 'privacy') { analytics.screen('privacy'); return privacy.render(root, ctx); }

  const views = { menu, edit: editor, commute, report: ctx.isAdmin ? report : menu };
  const view = views[name] || menu;
  const slot = Number(param);
  if ((view === editor || view === commute) && ![1, 2, 3].includes(slot)) return ctx.go('#/menu');
  analytics.screen(view === menu ? 'menu' : view === editor ? 'editor' : view === report ? 'report' : 'commute');

  // Render into a container that is already in the page (the map needs its size),
  // with a loading overlay on top until the screen is ready.
  const container = h('div', { class: 'view' });
  const overlay = loading('Loading…');
  root.append(container, overlay);
  try {
    const nextCleanup = await view.render(container, ctx, { slot });
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
      h('h2', {}, 'Something went wrong'),
      h('p', {}, e.message),
      h('button', { class: 'primary', onclick: () => location.reload() }, 'Reload')));
}

// After sign-in: load the city list, the remembered city (from the device cache) and favorites.
async function start() {
  if (!ctx.user) return route();
  root.replaceChildren(loading('Loading your city…'));
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
