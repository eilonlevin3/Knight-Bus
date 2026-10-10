// What a saved commute is called on screen. Docs: docs/user-flows.md#2-home-screen
// @req REQ-FAV-1
// The slots are "Commute 1/2/3". Commutes saved before this label existed are named
// "Favorite N" by default; show those as "Commute N" too (a name the user typed is kept).
export function commuteName(fav, slot) {
  const name = fav?.name?.trim();
  return !name || /^(Favorite|Commute) \d$/.test(name) ? `Commute ${slot}` : name;
}
