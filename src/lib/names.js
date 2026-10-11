// What a saved commute is called on screen. Docs: docs/user-flows.md#2-home-screen
// @req REQ-FAV-1
// A saved commute is called a "Favorite Commute". Without a name of its own it shows as
// "Favorite Commute N" in the app's language. Default names saved earlier, in either
// language or in an older wording ("Favorite N", "Commute N"), show the same way; a name
// the user typed is kept.
import { t } from '../i18n.js';

export const isDefaultName = (name) => !name?.trim() || /^(Favorite|Commute|Favorite Commute|נסיעה מועדפת) \d$/.test(name.trim());

export function commuteName(fav, slot) {
  return isDefaultName(fav?.name) ? t('Favorite Commute {n}', { n: slot }) : fav.name.trim();
}
