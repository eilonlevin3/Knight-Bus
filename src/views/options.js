// The Options pop-up (bottom right of the home screen): language, and shortcuts.
// Docs: docs/user-flows.md#language
// @req REQ-LANG-2

import { h } from '../lib/dom.js';
import { t, LANGUAGES, language, setLanguage, cityName } from '../i18n.js';
import { track } from '../analytics.js';

export function showOptions(ctx) {
  const close = () => overlay.remove();
  const go = (hash) => { close(); ctx.go(hash); };

  const languageButtons = LANGUAGES.map((l) => h('button', {
    class: l.id === language() ? 'primary' : '',
    'aria-pressed': String(l.id === language()),
    lang: l.id,
    onclick: () => {
      close();
      track('language_changed', { to: l.id });
      setLanguage(l.id); // the app redraws the screen in the new language
    },
  }, l.name));

  const overlay = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Options'),
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    h('div', { class: 'card stack modal-card' },
      h('h2', {}, t('Options')),
      h('b', { class: 'small' }, t('Language')),
      h('div', { class: 'row lang-row' }, ...languageButtons),
      h('b', { class: 'small' }, t('City')),
      h('button', { onclick: () => go('#/city') }, `📍 ${cityName(ctx.city.meta)} · ${t('Change city')}`),
      h('button', { class: 'link', onclick: () => go('#/privacy') }, t('Privacy & usage data')),
      h('button', { onclick: close }, t('Close'))));
  document.body.append(overlay);
}
