// Sign-in, sign-up, sign-out. Docs: docs/architecture.md#accounts
// @req REQ-AUTH-1 @req REQ-AUTH-2 @req REQ-AUTH-3 @req REQ-AUTH-4

import { firebaseConfig, FIREBASE_SDK, storagePrefix } from './config.js';
import { t } from './i18n.js';

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
  // Finishes a Google sign-in that went through a full-page redirect (see signInGoogle).
  fa.getRedirectResult(auth).catch((e) => { lastRedirectError = e; });
  fa.onAuthStateChanged(auth, (u) =>
    onChange(u ? { uid: u.uid, email: u.email, displayName: u.displayName, local: false, provider: u.providerData[0]?.providerId || 'unknown' } : null),
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

// A pop-up first: it works in browsers and in installed iPhone/Android apps. Where pop-ups are
// blocked or unsupported, fall back to a full-page redirect to Google and back.
export async function signInGoogle() {
  const provider = new fa.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await fa.signInWithPopup(auth, provider);
  } catch (e) {
    const usePageRedirect = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'];
    if (!usePageRedirect.includes(e?.code)) throw e;
    await fa.signInWithRedirect(auth, provider);
  }
}

let lastRedirectError = null;
// An error from a redirect sign-in, shown once on the sign-in screen.
export function takeRedirectError() {
  const e = lastRedirectError;
  lastRedirectError = null;
  return e;
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
    'auth/invalid-email': t('That email address is not valid.'),
    'auth/invalid-credential': t('Wrong email or password.'),
    'auth/wrong-password': t('Wrong email or password.'),
    'auth/user-not-found': t('No account with that email. Create one?'),
    'auth/email-already-in-use': t('An account with that email already exists. Sign in instead.'),
    'auth/weak-password': t('Password must be at least 6 characters.'),
    'auth/popup-closed-by-user': t('Google sign-in was closed.'),
    'auth/popup-blocked': t('The browser blocked the Google pop-up. Allow pop-ups and try again.'),
    'auth/unauthorized-domain': t('This web address is not allowed in Firebase yet (docs/setup.md, step 2).'),
    'auth/network-request-failed': t('No connection. Try again.'),
  };
  return map[err?.code] || err?.message || t('Something went wrong.');
}
