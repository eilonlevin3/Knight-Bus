# 🚌 Knight Bus

**Live buses for your favorite commutes.** You save up to three commutes, each with up to two
bus stops and the routes you care about. Open one, and the map shows those routes with the
**next two buses coming to your stop and the last one that passed it**, live from the
Ministry of Transport feed.

MVP: **Israel** (Tel Aviv–Gush Dan, Jerusalem, Haifa & Krayot, Be'er Sheva).

---

## How it works (the short version)

Knight Bus is a **Progressive Web App (PWA)**: a website that a phone can install as an app.

1. **The code sits in this GitHub repo.** It is plain HTML, CSS and JavaScript, with no build step.
2. **GitHub Actions** runs every night. It downloads the national bus timetable (GTFS)
   from the Ministry of Transport, cuts it into **one small file per city**, and publishes
   the app plus those files to **GitHub Pages** (free HTTPS hosting).
3. **On your phone** you open the Pages URL in Chrome or Safari and choose
   **Add to Home Screen**. You get a Knight Bus icon that opens full screen, like a store app.
   A **service worker** (`sw.js`) keeps the app files on the phone, so it opens instantly
   and works offline.
4. **When the app runs**, it:
   - signs you in through **Firebase** (email or Google) and loads your favorites;
   - uses **GPS** to find your city, downloads only that city's file (0.6–3 MB) once, and keeps it;
   - draws the map with **OpenStreetMap** and fetches **live bus positions** every 30 s
     from the government SIRI feed, through the open **Open Bus Stride** API.

```
 GitHub repo ──► GitHub Actions (nightly) ──► GitHub Pages ──HTTPS──► 📱 your phone
   code + docs     GTFS → city files            app + data              │
                                                                         ├─► Firebase (login, favorites)
                                                                         ├─► Stride API (live buses)
                                                                         └─► OpenStreetMap (map tiles)
```

There is **no server of our own** to run or pay for. The full picture is in
[docs/architecture.md](docs/architecture.md).

---

## Docs as code

The docs are the spec. They live here, next to the code, and change in the same pull request.
Every requirement in [docs/requirements.md](docs/requirements.md) has an ID such as
`REQ-EDIT-3`. The code that implements it carries a `@req REQ-EDIT-3` comment.
[`npm run check:docs`](scripts/check-docs.mjs) runs in CI and fails the build when docs and
code disagree: a *Done* requirement with no code, code pointing at an unknown requirement, or
a broken doc link. Why and how: [ADR-0005](docs/adr/0005-docs-as-code.md).

### Docs map: which doc explains what, and the code behind it

| Doc | What it explains | Code behind it |
|-----|------------------|----------------|
| [requirements.md](docs/requirements.md) | **The spec.** Every feature as a numbered requirement, Done or Planned | All files with `@req` tags; run `node scripts/check-docs.mjs --matrix` for the full table |
| [architecture.md](docs/architecture.md) | The parts of the system, how they connect, offline, hosting | [src/app.js](src/app.js), [sw.js](sw.js), [index.html](index.html) |
| [user-flows.md](docs/user-flows.md) | Every screen and what the user does on it, with diagrams | [src/views/](src/views/) |
| [realtime.md](docs/realtime.md) | Where live bus data comes from, and the "next two + last passed" rule | [src/realtime.js](src/realtime.js), [src/liveLines.js](src/liveLines.js) |
| [data-pipeline.md](docs/data-pipeline.md) | How the national GTFS feed becomes small per-city files, and how to add a city | [pipeline/build-city-data.mjs](pipeline/build-city-data.mjs), [pipeline/cities.json](pipeline/cities.json) |
| [data-model.md](docs/data-model.md) | The shape of a favorite, a city bundle, and what is stored on the device | [src/store.js](src/store.js), [src/cityData.js](src/cityData.js), [firestore.rules](firestore.rules) |
| [setup.md](docs/setup.md) | Deploying, turning on Firebase, installing on a phone, local development | [.github/workflows/](.github/workflows/), [src/config.js](src/config.js), [firebase.json](firebase.json) |
| [privacy.md](docs/privacy.md) | **What is recorded about use, and what never is:** consent, the safe event list, debug-only details, where to see the numbers | [src/analytics.js](src/analytics.js), [src/views/privacy.js](src/views/privacy.js), [firestore.rules](firestore.rules) |
| [release-process.md](docs/release-process.md) | **Test on your phone first:** the debug version, releasing to users, how updates reach phones, rollback | [deploy.yml](.github/workflows/deploy.yml), [scripts/build-site.sh](scripts/build-site.sh), [sw.js](sw.js), [src/updates.js](src/updates.js) |
| [adr/](docs/adr/) | Why we chose what we chose ([PWA](docs/adr/0001-pwa.md), [live data](docs/adr/0002-realtime-source.md), [maps](docs/adr/0003-maps.md), [Firebase](docs/adr/0004-firebase.md), [docs as code](docs/adr/0005-docs-as-code.md), [debug version](docs/adr/0006-release-channels.md), [address search](docs/adr/0007-address-search.md), [usage insights](docs/adr/0008-usage-insights.md)) | — |

### Where the code sits

```
Knight Bus/
├── index.html               App shell: loads Leaflet, styles and src/app.js
├── manifest.webmanifest     Name, icon, full-screen mode → "Add to Home Screen"
├── sw.js                    Service worker: offline app files + map tile cache
├── icons/                   Home-screen icons (made by scripts/make-icons.ps1)
├── icons-debug/             Orange icons for the debug version
├── src/
│   ├── app.js               Start-up, sign-in/city guards, #/hash screen router
│   ├── build.js             Which version this is (main / debug / local); stamped at deploy
│   ├── updates.js           Notices new versions, shows the Update banner
│   ├── config.js            Firebase keys, live-data settings  ← you edit this
│   ├── auth.js              Email + Google sign-in (Firebase Auth), local demo mode
│   ├── store.js             Save/load favorites (Firestore)
│   ├── location.js          GPS, which city am I in
│   ├── cityData.js          Download + cache the city bundle; stop/route lookups
│   ├── realtime.js          Live bus positions; next two + last passed
│   ├── liveLines.js         Draw the chosen routes as lines + live buses; refresh every 30 s
│   ├── map.js               Leaflet map, stop dots, bus icons, flags, map key
│   ├── geocode.js           Address search (start point / destination)
│   ├── analytics.js         Usage insights: consent first, safe events, debug-only details
│   ├── styles.css
│   ├── lib/                 dom.js (UI helper), polyline.js (shape encoding), routeGeometry.js (positions along a route's path)
│   └── views/               One file per screen: login, city, home, editor, commute, line, privacy, report
├── pipeline/
│   ├── cities.json          Which cities exist and their boundaries
│   ├── build-city-data.mjs  National GTFS → data/cities/<city>.json + data/schedules/<route>.json
│   └── sources/             Weekend routes from outside the government feed (Busofash, Sababus)
├── scripts/
│   ├── build-site.sh        Builds one version (main or debug) for publishing
│   ├── check-docs.mjs       Docs-as-code check (runs in CI)
│   └── make-icons.ps1       Draws the PNG icons
├── tests/                   Unit tests for the bus logic (npm test)
├── docs/                    ← everything described in the docs map above
├── CLAUDE.md                Working memory for AI chat sessions: how we work, traps, open items
├── firestore.rules          Who can read/write favorites
└── .github/workflows/       deploy.yml (main + debug, nightly data, Pages), docs-check.yml (PRs)
```

`data/cities/` is generated by the pipeline and published by CI. It is not committed.

---

**Starting a new AI chat on this project?** It should read [CLAUDE.md](CLAUDE.md) first:
the owner's way of working, what was decided and why, traps already hit, and open items.

## Quick start

| I want to… | Do this |
|------------|---------|
| Put it online | Make the repo public → *Settings → Pages → Source: GitHub Actions* → push. See [setup.md §1](docs/setup.md#1-hosting-on-github-pages) |
| Turn on real accounts | Create a Firebase project, paste its config into `src/config.js`. See [setup.md §2](docs/setup.md#2-turn-on-accounts-firebase) |
| Install on my phone | Open the site → Chrome ⋮ *Install app* / Safari Share → *Add to Home Screen* |
| Test a change on my phone first | Commit to the `debug` branch, push, open `/Knight-Bus/debug/` on the phone, then merge to `main`. See [release-process.md](docs/release-process.md) |
| Run it on my computer | Install Node 22+, then `npm install && CITIES=tel-aviv npm run build:data && npm start` |
| Change a feature | Edit `docs/requirements.md` first, then the code with `@req` tags, then `npm run check:docs && npm test` |

## Status

MVP. What is planned next (see *Planned* rows in [requirements.md](docs/requirements.md)):
fully offline city maps (REQ-DATA-4) and direct ministry SIRI arrival predictions through a
small proxy (REQ-RT-4).

Data: Israel Ministry of Transport GTFS and SIRI, through the
[Open Bus Stride API](https://open-bus-stride-api.hasadna.org.il/docs) by the Public Knowledge
Workshop. Maps © OpenStreetMap contributors.
