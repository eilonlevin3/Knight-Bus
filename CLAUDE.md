# Knight Bus: working memory for Claude

Read this first in a new chat. It holds what the code and docs do **not** say: how the owner
works, what has been decided, the traps already hit, and what is still open.
For what the app does and how it is built, start at [README.md](README.md) (docs map) and
[docs/requirements.md](docs/requirements.md) (the spec).

**Keep this file current.** When a session ends with a new decision, a new trap, or a
changed open item, update the matching section and the "Last updated" line. Remove things
that stop being true. Do not copy what the docs already say; link to them.

Last updated: 2026-10-10 (home screen round, on `debug` only; main is still `34aad5a`).

## The owner and how to work with them

- Owner: GitHub user `eilonlevin3`. Not a professional developer: explain setups step by
  step, give direct links to console pages, one action per step.
- Their terminal is **Windows PowerShell 5.1**: no `&&`. Give commands one per line.
- They test on an **iPhone**, with both apps installed from the home screen: *Knight Bus*
  (purple, main) and *KB Debug* (orange, debug). Feedback arrives as numbered notes and
  screenshots.
- They want **docs as code for everything**: change `docs/requirements.md` first (stable
  `REQ-…` ids), tag code with `@req`, keep `npm run check:docs` green. Decisions go in
  `docs/adr/`.
- Privacy stance (their words): "play it safe with all users and collect as much safe data
  as possible"; sensitive detail only in the debug version.

## State of things

| | |
|-|-|
| Repo | `C:\Repos\Knight Bus`, GitHub `eilonlevin3/Knight-Bus` (public) |
| User site | `https://eilonlevin3.github.io/Knight-Bus/` (branch `main`) |
| Debug site | `https://eilonlevin3.github.io/Knight-Bus/debug/` (branch `debug`) |
| Released | `34aad5a` on 2026-10-10: main and debug were identical at that point |
| Firebase | project `knight-bus-a91d3`: Google + email sign-in, Firestore in `me-west1`, Analytics `G-91J047X5GH` |
| Cities | Tel Aviv–Gush Dan, Jerusalem, Haifa & Krayot, Be'er Sheva (`pipeline/cities.json`) |

Confirmed working on the owner's iPhone: installing both apps, **Google sign-in in the
installed debug app** (2026-10-10).

## How work flows

1. Work on branch **`debug`**. Push. About 4 minutes later it is live at `/debug/`.
2. Tell the owner the commit id; they check the orange badge (bottom-right) shows it.
3. Release **only when the owner says so**: fast-forward main to debug with
   `git push origin origin/debug:main`.
4. Every push to either branch rebuilds **both** sites. Details: [docs/release-process.md](docs/release-process.md).

After a push, verify the live site. GitHub Pages caches about 10 minutes: add
`?nocache=<number>` to URLs when checking with curl, or you will read the old version.
The version is in `src/build.js` and `sw.js` on the live site.

## Things only the owner can do

Claude could not do these in this setup; ask the owner, with exact steps:

- **Firestore rules are pasted by hand** in the Firebase console. Whenever
  `firestore.rules` changes, give the owner the full text to paste and publish.
  *Open as of 2026-10-10:* the rules for `debugEvents` and the admin report may not be
  published yet. Until they are, debug detail events are silently dropped and the report
  shows an error.
- **Admin for the commute report:** a hand-made Firestore document `admins/{their uid}`
  (steps in [docs/setup.md](docs/setup.md)). *Open: not confirmed done.*
- `gh auth refresh -s workflow` (needed once to push workflow files; done).
- Making the repo public, and anything else that publishes content, was blocked for
  Claude by the permission settings; the owner ran the command.
- Signing in to the app. Claude must not create accounts or sign in, so screens behind
  sign-in (home, editor, commute, privacy, report) cannot be clicked through by Claude on
  the real backend.

## This computer

- **Node.js is not installed.** Earlier sessions used a portable copy in a temporary
  folder, which gets cleaned up. For checks and tests, download a portable Node zip from
  nodejs.org into the session scratchpad and put it on `PATH`. If its `npm` is damaged,
  call `node` directly: `node scripts/check-docs.mjs`, `node --test tests/*.test.mjs`,
  `node pipeline/build-city-data.mjs`.
- Python 3, git, `gh`, Chrome and Edge are installed.
- `data/cities/`, `.cache/` (141 MB GTFS zip) and `node_modules/` are git-ignored and may
  exist locally. Rebuild data with `GTFS_ZIP=.cache/gtfs.zip node pipeline/build-city-data.mjs` (about 3 minutes).
- Git warns about CRLF/LF on every commit. Harmless (`.gitattributes` forces LF).

## How to test without the owner

- **Unit tests** cover the logic that matters: bus classification, route geometry, line
  shifting, the report. Run them before every push.
- **Screens behind sign-in:** with Firebase configured there is no demo mode, so:
  - load a view module in the browser with its data call replaced (fetch the file, swap
    the `store.js` import for a stub, import it from a Blob URL), or
  - best: copy `index.html manifest.webmanifest sw.js src icons data` to a scratch folder,
    set the Firebase `apiKey` there to `REPLACE_ME` (demo mode comes back), and serve that
    copy. The repo itself stays untouched. This is how the home screen was clicked through.
- **Leftover servers:** stopping a background server task does not always kill the Python
  process, and Windows lets a second server bind the same port, so requests go to the
  *old* one. Before starting a server, check `netstat -ano | grep :8081` and `taskkill`
  leftovers. If the page shows the wrong files, this is why.
- **Clicking a bus stop** in an automated browser needs exact pixel coordinates; zoom into
  a screenshot region first to find the marker's center.
- **Serving locally:** use a small Python server that sends `Cache-Control: no-store`.
  The plain `python -m http.server` let Chrome serve stale files and wasted a lot of time.
  A fresh port is a fresh origin (clean service worker and storage).
- **Headless Chrome:** do **not** use `--virtual-time-budget`. With it, the Cache API
  never finishes and the app hangs on "Loading your city…". Run in real time and have the
  test page report results to the local server (a request the server logs, or a POST).
- **Line drawings** can be captured from the map's `<canvas>` (`toDataURL`) for a visual check.
- **Live buses:** Israel has almost no buses from Friday afternoon to Saturday night. "No
  bus on the way" on a weekend is normal, not a bug. To find a line that is live right
  now, query Stride for the last 5 minutes and match `siri_route__line_ref` to route ids.
- Nothing above replaces the iPhone: touch gestures, the status-bar area and installed-app
  sign-in can only be confirmed by the owner.

## Traps already hit (do not repeat)

- **Stride API:** always pass both `recorded_at_time_from` and `recorded_at_time_to`;
  some rows carry year-2038 timestamps and sort first otherwise. Stride `line_ref` equals
  the GTFS `route_id`. Positions are 1–2 minutes old.
- **Placing buses:** use the nearest point on the route *shape*, not the nearest stop.
  Nearest-stop dropped real buses (a bus can be 600 m from any stop yet on the road).
  Limit: 250 m from the path.
- **Line 708 and other weekend lines** (705–729) are the municipal *Naaim BeSofash*
  service. They are **not** in the government GTFS and have **no live positions** anywhere
  we can read. Routes and stops come from the Tel Aviv municipality map server
  (`pipeline/sources/busofash.mjs`). GitHub's runners can reach it.
- **Side-by-side lines:** the Leaflet.PolylineOffset plugin drew little circles at corners
  when zoomed out. Replaced by `src/lib/offsetLine.js`. Some loops are real route geometry
  (terminal turnarounds); do not "fix" those.
- **iPhone status bar:** the installed app draws under it, iOS blurs that strip, and taps
  there do not reach the page. Keep the solid strip and the top padding on map screens.
  Do not put controls or badges at the top.
- **"Sliding down"** to the owner means dragging the bottom panel down with a finger, not
  scrolling the list.
- **Google Analytics forbids precise location.** Detailed debug data therefore goes to our
  own Firestore, never to Analytics.
- **Service worker:** the version is the commit id, stamped at deploy. Never hand-edit
  `SHELL_VERSION`. When adding a source file, add it to the `SHELL` list in `sw.js` or it
  will not work offline. Every pushed commit shows users an "Update" banner, even a
  docs-only one, so batch small changes before releasing to main.
- **`src/lib/dom.js`:** `h()` sets string values as attributes; `innerHTML` is special-cased.
  `null` children are skipped by `h()`, but `replaceChildren(...list)` prints "null", so
  filter lists first.
- **GitHub Pages:** one site per repo, so debug lives in `/debug/`. The `github-pages`
  environment must allow both branches. Main and debug share one origin, so storage keys,
  caches and Firestore collections are namespaced per channel (`src/config.js`).
- **Docs check:** every *Done* requirement needs an `@req` tag in code, including CSS-only
  ones; every relative link in docs must resolve.
- **Bidi text:** stop and line names are Hebrew inside an English UI; text containers use
  `unicode-bidi: plaintext`.

## Decisions and why (short; details in docs/adr/)

- Installable web app on GitHub Pages; no server of our own (ADR-0001).
- Live data from the Open Bus Stride mirror, because the ministry's own SIRI needs a
  registered server address (ADR-0002).
- Map tiles cached as viewed; bulk download is against OpenStreetMap's rules (ADR-0003).
- Firebase for sign-in and saved commutes (ADR-0004). Docs as code (ADR-0005).
- Debug version in a sub-folder, versioned all-at-once updates (ADR-0006).
- Address search by OpenStreetMap Nominatim: only on pressing Search, 1 request per second (ADR-0007).
- Usage insights: opt-in; safe anonymous events for everyone; detail only in debug; an
  admin report with counts only, stops listed from 3 people up (ADR-0008, docs/privacy.md).
- The first screen is the **home screen** (the owner renamed it from "main menu"): map
  around the user on top, tap any stop to explore its lines, saved commutes below. Route
  `#/home`; `#/menu` is kept as an alias for apps installed earlier.
- Only saved commutes get a button, labeled with the user's own name for it; new ones are
  made with the small ＋ New commute button (bottom right).
- UI wording: saved items are "Commute 1/2/3" on screen. The code and data still say
  `favorite` (collections `favorites`, `favoritesDebug`): do not rename stored data.
- "Lines show up when a stop is picked" was read as: listed with checkboxes, none checked,
  drawn only when checked. The owner has not objected.

## Open items

- Owner to confirm on the iPhone: the new home screen (map around them, tapping a stop,
  named commute buttons, ＋ New commute). And from the round of 2026-10-10: top of screen not blurred, map key
  tappable, panel drags, incoming lines solid, no circles, 708 listed at their stop, the
  usage question card, the privacy screen.
- Owner to publish the latest Firestore rules and create their `admins` document (above).
- Google sign-in is confirmed in the debug app; not yet confirmed in the main app.
- Planned requirements: fully offline city maps (REQ-DATA-4), direct ministry SIRI with
  arrival times through a proxy (REQ-RT-4).
- Before a public launch: a lawyer should review docs/privacy.md; set Analytics data
  retention; the workflow actions still warn about an old Node runtime (`@v4` actions).
- Ideas not requested yet: Hebrew UI, more cities, light rail and trains (pipeline is
  bus-only: `routeTypes: [3]`), a version line on the main app's home screen.
