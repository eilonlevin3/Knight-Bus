// Privacy notice and the usage-sharing switch. Docs: docs/privacy.md
// @req REQ-ANL-3 @req REQ-ANL-4

import { h, toast } from '../lib/dom.js';
import { consent, setConsent, detailed } from '../analytics.js';

// The same wording is used on the home-screen card and here, so people always see what they agree to.
export const SAFE_SUMMARY = 'Anonymous usage only: which screens you open and for how long, which features you use, your city and the hour. Never your name, email, stops, lines, addresses or location.';
export const DEBUG_SUMMARY = 'This is the DEBUG test version. If you agree, it ALSO records details to help fix problems: the stops and lines of your Favorite Commutes, your start and destination points, and your exact location while a Favorite Commute is open. These are saved under your account, apart from real users.';

export function render(root, ctx) {
  const state = h('p', { role: 'status' });
  const paint = () => {
    const c = consent();
    state.replaceChildren(h('b', {}, c === 'on' ? 'Usage sharing is ON.' : c === 'off' ? 'Usage sharing is OFF.' : 'You have not chosen yet.'));
  };
  const choose = async (on) => {
    await setConsent(on);
    paint();
    toast(on ? 'Thank you! Usage sharing is on.' : 'Usage sharing is off.');
  };
  paint();

  root.append(
    h('main', { class: 'screen' },
      h('header', { class: 'topbar' },
        h('button', { class: 'link', onclick: () => ctx.go('#/home') }, '← Home'),
        h('h1', {}, 'Privacy & usage data')),
      h('div', { class: 'card stack' },
        h('h2', {}, 'What Knight Bus keeps to work'),
        h('ul', { class: 'plain' },
          h('li', {}, 'Your sign-in (email or Google account), kept by Google Firebase.'),
          h('li', {}, 'Your Favorite Commutes: stops, lines, and start/destination if you set them. Only you can read them.'),
          h('li', {}, 'Your location is used on your phone to pick your city, center the map and show you on it. Your last position is remembered on this phone only, for a quick start. It is never sent to us.'))),
      h('div', { class: 'card stack' },
        h('h2', {}, 'Optional: help improve Knight Bus'),
        h('p', {}, SAFE_SUMMARY),
        detailed ? h('p', { class: 'notice' }, DEBUG_SUMMARY) : null,
        h('p', { class: 'muted small' }, 'Sent to Google Analytics for Firebase. Nothing is recorded unless you turn this on, and you can turn it off here at any time.'),
        state,
        h('div', { class: 'row' },
          h('button', { onclick: () => choose(false) }, 'Turn off'),
          h('button', { class: 'primary', onclick: () => choose(true) }, 'Turn on'))),
      h('p', { class: 'muted small' }, 'Bus data: Israel Ministry of Transport and Tel Aviv municipality. Live positions: Open Bus Stride. Maps and address search: OpenStreetMap.')),
  );
}
