// Privacy notice and the usage-sharing switch. Docs: docs/privacy.md
// @req REQ-ANL-3 @req REQ-ANL-4

import { h, toast } from '../lib/dom.js';
import { t, backArrow } from '../i18n.js';
import { consent, setConsent, detailed } from '../analytics.js';

// The same wording is used on the home-screen card and here, so people always see what they agree to.
export const safeSummary = () => t('Anonymous usage only: which screens you open and for how long, which features you use, your city and the hour. Never your name, email, stops, routes, addresses or location.');
export const debugSummary = () => t('This is the DEBUG test version. If you agree, it ALSO records details to help fix problems: the stops and routes of your Favorite Commutes, your start and destination points, and your exact location while a Favorite Commute is open. These are saved under your account, apart from real users.');

export function render(root, ctx) {
  const state = h('p', { role: 'status' });
  const paint = () => {
    const c = consent();
    state.replaceChildren(h('b', {}, c === 'on' ? t('Usage sharing is ON.') : c === 'off' ? t('Usage sharing is OFF.') : t('You have not chosen yet.')));
  };
  const choose = async (on) => {
    await setConsent(on);
    paint();
    toast(on ? t('Thank you! Usage sharing is on.') : t('Usage sharing is off.'));
  };
  paint();

  root.append(
    h('main', { class: 'screen' },
      h('header', { class: 'topbar sticky-top' },
        h('button', { class: 'nav-button', onclick: () => ctx.go('#/home') }, `${backArrow()} ${t('Home')}`),
        h('h1', {}, t('Privacy & usage data'))),
      h('div', { class: 'card stack' },
        h('h2', {}, t('What Knight Bus keeps to work')),
        h('ul', { class: 'plain' },
          h('li', {}, t('Your sign-in (email or Google account), kept by Google Firebase.')),
          h('li', {}, t('Your Favorite Commutes: stops, routes, and start/destination if you set them. Only you can read them.')),
          h('li', {}, t('Your location is used on your phone to pick your city, center the map and show you on it. Your last position is remembered on this phone only, for a quick start. It is never sent to us.')),
          h('li', {}, t('Your language choice is remembered on this phone only.')))),
      h('div', { class: 'card stack' },
        h('h2', {}, t('Optional: help improve Knight Bus')),
        h('p', {}, safeSummary()),
        detailed ? h('p', { class: 'notice' }, debugSummary()) : null,
        h('p', { class: 'muted small' }, t('Sent to Google Analytics for Firebase. Nothing is recorded unless you turn this on, and you can turn it off here at any time.')),
        state,
        h('div', { class: 'row' },
          h('button', { onclick: () => choose(false) }, t('Turn off')),
          h('button', { class: 'primary', onclick: () => choose(true) }, t('Turn on')))),
      h('p', { class: 'muted small' }, t('Bus data: Israel Ministry of Transport, Tel Aviv municipality and the weekend-service operators. Live positions: Open Bus Stride. Maps and address search: OpenStreetMap.'))),
  );
}
