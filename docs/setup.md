# Setup, deploy and install

## 1. Hosting on GitHub Pages

1. The repo is on GitHub. **GitHub Pages is free only for public repos.** If the repo is
   private, either make it public (*Settings → General → Danger zone → Change visibility*)
   or use a paid plan.
2. *Settings → Pages → Build and deployment → Source:* choose **GitHub Actions**.
   Then *Settings → Environments → github-pages → Deployment branches*: allow **main**
   and **debug**. Without `debug` there, pushes to the debug branch build but are refused
   at the publish step ([release-process.md](release-process.md)). Command-line version:
   `gh api -X POST repos/<user>/Knight-Bus/environments/github-pages/deployment-branch-policies -f name=debug -f type=branch`
3. *Actions → Build data and deploy → Run workflow*, or push to `main`.
4. When it finishes (about 5 minutes; the data step takes ~2–3), the app is at
   `https://<your-user>.github.io/Knight-Bus/`.

Without Firebase, the app already works in **local demo mode**.

## 2. Turn on accounts (Firebase)

1. Go to <https://console.firebase.google.com> → **Add project** → name it `knight-bus`.
   Google Analytics is not needed.
2. **Build → Authentication → Get started** →
   - *Sign-in method*: enable **Email/Password** and **Google**.
   - *Settings → Authorized domains*: add `<your-user>.github.io`.
3. **Build → Firestore Database → Create database**. Choose production mode and a location
   such as `me-west1` (Tel Aviv).
4. *Firestore → Rules*: paste the contents of [firestore.rules](../firestore.rules) and
   **Publish**. Or run `npx firebase-tools deploy --only firestore:rules`.
5. *Project settings → General → Your apps → Web (`</>`)*: register an app and copy
   `apiKey`, `authDomain`, `projectId` and `appId` into
   [src/config.js](../src/config.js).
6. Commit and push. Test on `debug` first ([release-process.md](release-process.md)).

**Done for this repo on 2026-10-10:** project `knight-bus-a91d3`, Google and Email/Password
sign-in, authorized domain `eilonlevin3.github.io`, Firestore in `me-west1`, rules published.

### Make yourself an admin (for the Favorite Commutes report)

1. Sign in to the app once, so your account exists.
2. Firebase console → **Authentication → Users**: copy your **User UID**.
3. **Firestore → Data → Start collection**: collection ID `admins`, document ID = your UID,
   add one field (`role` = `owner`, any field works), **Save**.
4. Publish the current [firestore.rules](../firestore.rules) (*Firestore → Rules*).
5. Reopen the app: the home screen's panel now shows **📊 Favorite Commutes report**.

The Firebase web config is **not a secret**. It only identifies the project. The Firestore
rules are what protect user data.

## 3. Install on your phone

Open the site URL on the phone, then:

- **Android (Chrome):** tap ⋮ → **Install app** (or *Add to Home screen*).
- **iPhone (Safari):** tap Share (□↑) → **Add to Home Screen**. On iOS this works only from
  Safari.

The Knight Bus icon appears on the home screen. It opens full screen like a store app. It
updates itself: when you release a new version, the app offers *Update*; otherwise the
new version starts the next time it is opened. To try changes before users get them,
install the debug version too; see [release-process.md](release-process.md).

> iPhone note: in an installed app, Google's sign-in pop-up sometimes fails. If it does,
> sign in once in Safari first, or use email sign-in.

## 4. Developing on your computer

Install [Node.js 22+](https://nodejs.org), then:

```sh
npm install
CITIES=tel-aviv npm run build:data   # builds data/cities/ (git-ignored)
npm start                            # http://localhost:8080
```

`localhost` counts as secure, so GPS and the service worker work on it. To test on a phone
over Wi-Fi you need HTTPS: use the deployed site, or a tunnel such as `npx localtunnel --port 8080`.

On your computer the app runs as the `local` version (grey `LOCAL` badge). There, the
service worker always fetches fresh files, so reloading shows your edits.

## 5. Before you push

```sh
npm run check:docs            # docs and code agree?
node scripts/check-docs.mjs --matrix   # which file implements each requirement
```

CI runs the same check, and a pull request fails if it does not pass.
