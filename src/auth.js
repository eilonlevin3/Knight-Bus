// Sign-in, sign-up, sign-out. Docs: docs/architecture.md#accounts
// @req REQ-AUTH-1 @req REQ-AUTH-2 @req REQ-AUTH-3 @req REQ-AUTH-4

import { firebaseConfig, FIREBASE_SDK, storagePrefix } from './config.js';

export const firebaseConfigured = !firebaseConfig.apiKey.startsWith('REPLACE');

let app = null;
let fa = null; // firebase-auth module
let auth = null;
const LOCAL_USER_KEY = `${storagePrefix}localUser`;

export async function getFirebaseApp() {
  if (!app) {
    const { initializeApp } = await import(`${FIREBASE_SDK}firebase-app.js`);
    app = initializeApp(firebaseConfig);
  }
  return app;
}

// Calls onChange(user | null) now and whenever the user signs in or out.
// user = { uid, email, displayName, local: boolean }
export async function watchUser(onChange) {
  if (!firebaseConfigured) {
    const local = readLocalUser();
    onChange(local);
    return;
  }
  fa = await import(`${FIREBASE_SDK}firebase-auth.js`);
  auth = fa.getAuth(await getFirebaseApp());
  await fa.setPersistence(auth, fa.browserLocalPersistence);
  fa.onAuthStateChanged(auth, (u) =>
    onChange(u ? { uid: u.uid, email: u.email, displayName: u.displayName, local: false } : null),
  );
}

export async function signInEmail(email, password) {
  await fa.signInWithEmailAndPassword(auth, email, password);
}

export async function signUpEmail(email, password) {
  await fa.createUserWithEmailAndPassword(auth, email, password);
}

export async function resetPassword(email) {
  await fa.sendPasswordResetEmail(auth, email);
}

export async function signInGoogle() {
  const provider = new fa.GoogleAuthProvider();
  await fa.signInWithPopup(auth, provider);
}

export function startLocalDemo() {
  const user = { uid: 'local', email: null, displayName: 'Local demo', local: true };
  try { localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user)); } catch {}
  return user;
}

export async function signOut() {
  if (!firebaseConfigured) {
    try { localStorage.removeItem(LOCAL_USER_KEY); } catch {}
    return;
  }
  await fa.signOut(auth);
}

function readLocalUser() {
  try { return JSON.parse(localStorage.getItem(LOCAL_USER_KEY)); } catch { return null; }
}

// Firebase error codes -> short human messages.
export function authErrorMessage(err) {
  const map = {
    'auth/invalid-email': 'That email address is not valid.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with that email. Create one?',
    'auth/email-already-in-use': 'An account with that email already exists. Sign in instead.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/popup-closed-by-user': 'Google sign-in was closed.',
    'auth/popup-blocked': 'The browser blocked the Google pop-up. Allow pop-ups and try again.',
    'auth/unauthorized-domain': 'This web address is not allowed in Firebase yet (docs/setup.md, step 2).',
    'auth/network-request-failed': 'No connection. Try again.',
  };
  return map[err?.code] || err?.message || 'Something went wrong.';
}
