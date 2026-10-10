# ADR-0004: Firebase for accounts and Favorite Commutes

**Status:** Accepted · 2026-10-09

## Context

We need email and Google sign-in, and Favorite Commutes that follow the user across devices. We
want no server of our own.

## Decision

- **Firebase Authentication** for email/password, password reset and Google sign-in
  ([src/auth.js](../../src/auth.js)).
- **Cloud Firestore** for Favorite Commutes at `users/{uid}/favorites/{slot}`
  ([src/store.js](../../src/store.js)), with security rules in
  [firestore.rules](../../firestore.rules), versioned in this repo.
- The Firebase SDK loads as ES modules from Google's CDN, so no build step is needed.
- **Local demo mode** runs when `src/config.js` has placeholder values. This keeps the app
  usable before Firebase is set up.

## Consequences

- The free *Spark* plan covers this MVP: unlimited Auth users, plus 50k document reads per
  day.
- Firestore's offline cache shows Favorite Commutes without a connection.
- Lock-in is small: Favorite Commutes are one small document per slot, easy to move elsewhere.
