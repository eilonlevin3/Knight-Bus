// Registers the service worker and offers new versions to the user.
// Docs: docs/release-process.md#what-users-see-when-you-release
// @req REQ-PWA-3 @req REQ-PWA-4
//
// Flow: a new version is published -> the phone notices it (at start, or when the app
// comes back to the foreground) -> it downloads the whole version in the background ->
// a banner says "New version ready" -> tap Update to switch now. If the user ignores it,
// the new version starts the next time the app is fully closed and opened.

import { h } from './lib/dom.js';
import { t } from './i18n.js';
import { track } from './analytics.js';
import { isDebug } from './config.js';

let updateRequested = false; // set when the person taps Update

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

  // Reload only for an update the person asked for. A service worker also "takes control" on
  // the very first visit; reloading then would interrupt whatever they are doing (signing in).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
}

function offerUpdate(worker) {
  // The debug version takes a new version by itself (REQ-PWA-4): it is for testing what was
  // just pushed, and a test phone that stays on an old version tests the wrong thing. It
  // waits while something is being typed.
  if (isDebug) {
    const apply = () => {
      const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if (typing) { setTimeout(apply, 5000); return; }
      track('update_applied', { auto: 1 });
      updateRequested = true;
      worker.postMessage('SKIP_WAITING');
    };
    apply();
    return;
  }
  if (document.querySelector('.update-banner')) return;
  const banner = h('div', { class: 'update-banner', role: 'status' },
    h('span', {}, t('A new version of Knight Bus is ready.')),
    h('button', { class: 'primary', onclick: () => { track('update_applied'); updateRequested = true; worker.postMessage('SKIP_WAITING'); } }, t('Update')),
    h('button', { class: 'link small', onclick: () => banner.remove(), 'aria-label': t('Later') }, t('Later')));
  document.body.append(banner);
}
