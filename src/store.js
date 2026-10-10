// Favorite commutes, saved per user. Docs: docs/data-model.md#favorite-commute
// @req REQ-FAV-3
//
// Firestore path: users/{uid}/favorites/{slot}   (slot = "1" | "2" | "3")
// The debug version uses users/{uid}/favoritesDebug/{slot} instead (@req REQ-REL-2).
// Local demo mode keeps the same shape in localStorage.

import { FIREBASE_SDK, FAVORITE_SLOTS, storagePrefix, favoritesCollection, channel } from './config.js';
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

// Admins are listed by hand in the database: a document at admins/{uid} (docs/setup.md).
// @req REQ-ANL-5
export async function isAdmin(user) {
  if (!firebaseConfigured || !user || user.local) return false;
  try {
    const d = await firestore();
    return (await fs.getDoc(fs.doc(d, 'admins', user.uid))).exists();
  } catch {
    return false;
  }
}

// Every saved commute of every person, for the admin report (the rules refuse anyone else).
// which: 'favorites' (real users) or 'favoritesDebug' (testers).
export async function loadAllCommutes(which) {
  const d = await firestore();
  const snap = await fs.getDocs(fs.collectionGroup(d, which));
  return snap.docs.map((doc) => ({ uid: doc.ref.parent.parent.id, slot: Number(doc.id), fav: doc.data() }));
}

// Detailed usage events of the debug version (src/analytics.js). Saved under the person's own
// account at users/{uid}/debugEvents, never in the user version. @req REQ-ANL-4
export async function logDebugEvent(user, name, detail) {
  if (!firebaseConfigured || user.local) return;
  const d = await firestore();
  await fs.addDoc(fs.collection(d, 'users', user.uid, 'debugEvents'), {
    name, channel, at: new Date().toISOString(), detail: JSON.parse(JSON.stringify(detail)),
  });
}

// The first time someone signs in on a device where they used demo mode, copy the commutes
// saved there into their account, so nothing is lost. Only fills empty slots; runs once.
// @req REQ-AUTH-5
export async function adoptDemoFavorites(user, current) {
  if (!firebaseConfigured || user.local) return current;
  const demo = readLocal('local');
  const slots = Object.keys(demo).filter((slot) => demo[slot] && !current[slot]);
  if (!slots.length) return current;
  const merged = { ...current };
  for (const slot of slots) {
    const { name, cityId, stops, origin = null, destination = null } = demo[slot];
    await saveFavorite(user, Number(slot), { name, cityId, stops, origin, destination });
    merged[slot] = demo[slot];
  }
  try { localStorage.removeItem(localKey('local')); } catch {}
  return merged;
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
