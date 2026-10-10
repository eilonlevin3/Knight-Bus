// Favorite commutes, saved per user. Docs: docs/data-model.md#favorite
// @req REQ-FAV-3
//
// Firestore path: users/{uid}/favorites/{slot}   (slot = "1" | "2" | "3")
// The debug version uses users/{uid}/favoritesDebug/{slot} instead (@req REQ-REL-2).
// Local demo mode keeps the same shape in localStorage.

import { FIREBASE_SDK, FAVORITE_SLOTS, storagePrefix, favoritesCollection } from './config.js';
import { firebaseConfigured, getFirebaseApp } from './auth.js';

let fs = null;
let db = null;

async function firestore() {
  if (!db) {
    fs = await import(`${FIREBASE_SDK}firebase-firestore.js`);
    db = fs.initializeFirestore(await getFirebaseApp(), {
      localCache: fs.persistentLocalCache(), // favorites still load offline
    });
  }
  return db;
}

const localKey = (uid) => `${storagePrefix}favorites.${uid}`;
const readLocal = (uid) => {
  try { return JSON.parse(localStorage.getItem(localKey(uid))) || {}; } catch { return {}; }
};
const writeLocal = (uid, all) => {
  try { localStorage.setItem(localKey(uid), JSON.stringify(all)); } catch {}
};

// Returns { 1: favorite | null, 2: ..., 3: ... }
export async function loadFavorites(user) {
  const result = Object.fromEntries(FAVORITE_SLOTS.map((s) => [s, null]));
  if (!firebaseConfigured || user.local) {
    Object.assign(result, readLocal(user.uid));
    return result;
  }
  const d = await firestore();
  const snap = await fs.getDocs(fs.collection(d, 'users', user.uid, favoritesCollection));
  snap.forEach((doc) => { result[Number(doc.id)] = doc.data(); });
  return result;
}

export async function saveFavorite(user, slot, favorite) {
  const fav = { ...favorite, updatedAt: new Date().toISOString() };
  if (!firebaseConfigured || user.local) {
    const all = readLocal(user.uid);
    all[slot] = fav;
    writeLocal(user.uid, all);
    return;
  }
  const d = await firestore();
  await fs.setDoc(fs.doc(d, 'users', user.uid, favoritesCollection, String(slot)), fav);
}

export async function deleteFavorite(user, slot) {
  if (!firebaseConfigured || user.local) {
    const all = readLocal(user.uid);
    delete all[slot];
    writeLocal(user.uid, all);
    return;
  }
  const d = await firestore();
  await fs.deleteDoc(fs.doc(d, 'users', user.uid, favoritesCollection, String(slot)));
}
