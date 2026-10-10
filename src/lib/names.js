// What a saved commute is called on screen. Docs: docs/user-flows.md#2-home-screen
// @req REQ-FAV-1
// A saved commute is called a "Favorite Commute". Without a name of its own it shows as
// "Favorite Commute N". Older default names ("Favorite N", "Commute N") show the same way;
// a name the user typed is kept.
export function commuteName(fav, slot) {
  const name = fav?.name?.trim();
  return !name || /^(Favorite|Commute|Favorite Commute) \d$/.test(name) ? `Favorite Commute ${slot}` : name;
}
