// Languages: English and Hebrew. Docs: docs/user-flows.md#language
// @req REQ-LANG-1 @req REQ-LANG-2
//
// How it works: code writes on-screen text in English through t('…'). In Hebrew, t() looks
// the English text up in src/i18n/he.js. A text with no Hebrew entry shows in English, and
// tests/i18n.test.mjs fails, so nothing is silently left untranslated.
//   t('Stop {n}: choose a bus stop', { n: 2 })     values go into {…} places
//   tn(count, '1 route', '{n} routes')            singular / plural
// Stop, route and operator names come from the transit data and are Hebrew in both languages.

import { storagePrefix } from './config.js';
import { he } from './i18n/he.js';

export const LANGUAGES = [
  { id: 'en', name: 'English', dir: 'ltr', locale: 'en-GB' },
  { id: 'he', name: 'עברית', dir: 'rtl', locale: 'he-IL' },
];
const DICTIONARIES = { he };
const KEY = `${storagePrefix}language`;

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGUAGES.some((l) => l.id === saved)) return saved;
  } catch {}
  // First visit: follow the phone's language. (Outside a browser, in the tests: English.)
  const phone = typeof window !== 'undefined' && typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return phone.toLowerCase().startsWith('he') ? 'he' : 'en';
}

let current = initial();

export const language = () => current;
export const isRtl = () => LANGUAGES.find((l) => l.id === current).dir === 'rtl';
export const locale = () => LANGUAGES.find((l) => l.id === current).locale;

// Puts the language and reading direction on the page itself.
export function applyLanguage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
}

// Changes the language, remembers it on this device, and asks the app to redraw the screen.
export function setLanguage(id) {
  if (!LANGUAGES.some((l) => l.id === id) || id === current) return;
  current = id;
  try { localStorage.setItem(KEY, id); } catch {}
  applyLanguage();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('kb-language'));
}

export function t(text, values) {
  let s = DICTIONARIES[current]?.[text] ?? text;
  if (values) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  return s;
}

// Singular or plural. {n} is the count.
export function tn(count, one, many, values) {
  return t(count === 1 ? one : many, { n: count, ...values });
}

// "to" arrow and "back" arrow point the other way in a right-to-left language.
export const arrow = () => (isRtl() ? '←' : '→');
export const backArrow = () => (isRtl() ? '→' : '←');

// City names come in both languages from pipeline/cities.json.
export const cityName = (meta) => (current === 'he' && meta?.nameHe ? meta.nameHe : meta?.name || '');
