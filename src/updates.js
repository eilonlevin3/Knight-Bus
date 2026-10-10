// Registers the service worker and offers new versions to the user.
// Docs: docs/release-process.md#what-users-see-when-you-release
// @req REQ-PWA-3
//
// Flow: a new version is published -> the phone notices it (at start, or when the app
// comes back to the foreground) -> it downloads the whole version in the background ->
// a banner says "New version ready" -> tap Update to switch now. If the user ignores it,
// the new version starts the next time the app is fully closed and opened.

import { h } from './lib/dom.js';

let reloading = false;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      incoming?.addEventListener('statechange', () => {
        // "installed" with an existing controller = an update, not the first install.
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(incoming);
      });
    });
    // Installed apps can stay open for days: look for updates each time it comes back.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
  }).catch((e) => console.warn('Service worker not registered', e));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function offerUpdate(worker) {
  if (document.querySelector('.update-banner')) return;
  const banner = h('div', { class: 'update-banner', role: 'status' },
    h('span', {}, 'A new version of Knight Bus is ready.'),
    h('button', { class: 'primary', onclick: () => worker.postMessage('SKIP_WAITING') }, 'Update'),
    h('button', { class: 'link small', onclick: () => banner.remove(), 'aria-label': 'Later' }, 'Later'));
  document.body.append(banner);
}
