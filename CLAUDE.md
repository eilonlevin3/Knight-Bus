# Knight Bus: working memory for Claude

Read this first in a new chat. It holds what the code and docs do **not** say: how the owner
works, what has been decided, the traps already hit, and what is still open.
For what the app does and how it is built, start at [README.md](README.md) (docs map) and
[docs/requirements.md](docs/requirements.md) (the spec).

**Keep this file current.** When a session ends with a new decision, a new trap, or a
changed open item, update the matching section and the "Last updated" line. Remove things
that stop being true. Do not copy what the docs already say; link to them.

Last updated: 2026-10-10 (Favorite Commute wording, REQ-LINE-1a–d, live buses not tied to a pattern; `debug` is ahead of main, which is still `34aad5a`).

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
- **Sababus rule (their words): "decide like Moovit unless I say otherwise".** When the
  operator's map and Moovit disagree about a stop or a route, follow what Moovit shows.
- **Words (the owner's rule, 2026-10-10):** a **route** is the bus service and its path
  ("route 62"); a **line** is only something drawn on the map (solid, dashed, dotted). A
  route's different stop lists are **stop patterns**, never "routes" or "variants". The
  glossary is at the top of docs/requirements.md. Docs follow this; the app's on-screen
  text and file names still say "line" for a route (see Open items).
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
- **Admin for the Favorite Commutes report:** a hand-made Firestore document `admins/{their uid}`
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
  bus on the way" on a weekend is normal, not a bug. To find a route that is live right
  now, query Stride for the last 5 minutes and match `siri_route__line_ref` to route ids.
- Nothing above replaces the iPhone: touch gestures, the status-bar area and installed-app
  sign-in can only be confirmed by the owner.

## Traps already hit (do not repeat)

- **Stride API:** always pass both `recorded_at_time_from` and `recorded_at_time_to`;
  some rows carry year-2038 timestamps and sort first otherwise. Stride `line_ref` equals
  the GTFS `route_id`. Positions are 1–2 minutes old on a good day, but the mirror can run
  **15–25 minutes behind for a whole day** (2026-10-11: the owner saw no live bus at all,
  because the app then ignored anything older than 7 minutes). Now positions up to 30
  minutes old are shown with a "Live data is late" warning (REQ-RT-9). To check the lag:
  `siri_snapshots/list?order_by=id desc` and compare `snapshot_id` (UTC) with `etl_end_time`.
- **Placing buses:** use the nearest point on the route *shape*, not the nearest stop.
  Nearest-stop dropped real buses (a bus can be 600 m from any stop yet on the road).
  Limit: 250 m from the path.
- **Route 708 and other weekend routes** (705–729) are the municipal *Naaim BeSofash*
  service. They are **not** in the government GTFS and have **no live positions** anywhere
  we can read. The owner sees them live in other apps (Moovit / Rav-Pass / Google Maps get
  private feeds) and expected the same here; checked three times, see
  docs/data-pipeline.md. Do not re-investigate without a new lead (REQ-RT-7). They are
  marked as weekend routes everywhere instead (REQ-RT-6). Routes and stops come from the Tel Aviv municipality map server
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
- **Stop patterns:** never assume a GTFS `route_id` has one stop list. 2% of routes have
  more than one stop pattern; the pipeline keeps them all (REQ-DATA-8). Code that needs "the stops of a
  route from this stop" must use `city.patternsAt(route, stopId)[0]`, not `route.stops`.
- **Stop codes are not unique:** at terminals several platform stops share one code and
  one position (236 codes nationally, e.g. 20277 Reading terminal ×3), each with its own
  routes. They are shown with platform/floor and a ⚠ pop-up (REQ-STOP-1/2). Never pick "the
  stop with code X": there may be several, plus a station record (`location_type` 1).
- **A background browser tab is not a frozen app.** When the test tab is hidden, Chrome
  stops `requestAnimationFrame` (no map drawing, screenshots time out) and slows timers,
  so scripts hit the 45 s limit. Check `document.visibilityState` before debugging a
  "hang". Headless Chrome always renders: use it for visual checks.
- **Docs check:** every *Done* requirement needs an `@req` tag in code, including CSS-only
  ones; every relative link in docs must resolve.
- **Bidi text:** stop and route names are Hebrew inside an English UI; text containers use
  `unicode-bidi: plaintext`.

## Weekend services and live data (state on 2026-10-10)

- **Operator:** "נוע תנוע" (noat.co.il) runs both Naaim BeSofash and Sababus for the
  municipalities. Contact: contact@noat.co.il (the owner once typed "naot": it is **noat**),
  phone *10930 / 03-6753495.
- **Live positions:** no public source. Moovit's APIs are enterprise-only
  (helpdesk@moovit.com); Bus Nearby's API is behind a Cloudflare challenge (do not work
  around it); government SIRI does not carry these buses. An email asking noat for a feed
  was sent by the owner on 2026-10-10 (see Open items for the answer).
- **Sababus data:** the operator's Google My Map, KML export
  (`mid=1zUQK4dHqJ4srilKzhYJM6t5vQfGkfo8`). The same map also has all Naaim BeSofash
  routes with direction per stop; switching Busofash to it was offered, not requested.
  Stops the map places where no bus stop exists are snapped to the nearest real stop on
  the route's path (so green and blue are at 25778, as in Moovit).

## Decisions and why (short; details in docs/adr/)

- Installable web app on GitHub Pages; no server of our own (ADR-0001).
- Live data from the Open Bus Stride mirror, because the ministry's own SIRI needs a
  registered server address (ADR-0002).
- Map tiles cached as viewed; bulk download is against OpenStreetMap's rules (ADR-0003).
- Firebase for sign-in and Favorite Commutes (ADR-0004). Docs as code (ADR-0005).
- Debug version in a sub-folder, versioned all-at-once updates (ADR-0006).
- Address search by OpenStreetMap Nominatim: only on pressing Search, 1 request per second (ADR-0007).
- Usage insights: opt-in; safe anonymous events for everyone; detail only in debug; an
  admin report with counts only, stops listed from 3 people up (ADR-0008, docs/privacy.md).
- The first screen is the **home screen** (the owner renamed it from "main menu"): map
  around the user on top, tap any stop to explore its routes, Favorite Commutes below. Address
  `#/home`; `#/menu` is kept as an alias for apps installed earlier.
- Only Favorite Commutes get a button, labeled with the user's own name for it; new ones are
  made with the small ＋ New Favorite Commute button (bottom right).
- **"Favorite Commute"** (the owner's term, 2026-10-10) is what a person saves, in the app
  and in every doc: "＋ New Favorite Commute", "My Favorite Commutes", default name
  "Favorite Commute N". (Earlier the same day it was "Commute N", before that "Favorite N";
  both still display correctly.) The code and data still say `favorite` (collections
  `favorites`, `favoritesDebug`): do not rename stored data.
- "Routes show up when a stop is picked" was read as: listed with checkboxes, none checked,
  drawn only when checked. The owner has not objected.
- **On-screen wording** (owner, 2026-10-10): the app says "route" for the bus service,
  never "line"; "Most common pattern" / "Other pattern" for stop patterns. Internal names
  keep "line" (`views/line.js`, `#/line/…`, CSS classes, usage events such as
  `line_map_opened`): renaming them would break links and analytics history.
- **Languages** (owner, 2026-10-10): English and Hebrew. Every on-screen text goes through
  `t('English text')` / `tn(count, one, many)` from `src/i18n.js`; Hebrew lives in
  `src/i18n/he.js`, keyed by the English text. `tests/i18n.test.mjs` fails on a missing,
  unused or `{place}`-mismatched entry, so: write text as a plain quoted string inside
  `t()` (no template strings, no variables), then add the Hebrew line. Hebrew words:
  route = קו, stop = תחנה, stop pattern = מסלול, Favorite Commute = נסיעה מועדפת, a drawn
  line = פס (because קו already means route). Changing language fires `kb-language` and
  the router redraws. Outside a browser (tests) the language is English.
- **Home stop list and bus details** (owner, 2026-10-11): a stop's routes are small icons
  (checkbox + number), not rows; the first 16 are checked; the number opens a route pop-up
  (`showRouteCard`) linking to the full-route screen. Tapping a live bus opens
  `views/busInfo.js` with the last signal's time and every field of it (`bus.raw`). The
  editor still lists routes as full rows; the owner asked only about the stop view.
- **Route search and directions** (owner, 2026-10-10): `#/routes` lists each two-direction
  service once (`city.routePairs()`); the route screen shows one direction with
  ⇄ Switch direction (`route.opposite`, paired in the pipeline from `route_desc`) and a
  🕒 Timetable button. The home screen's bottom-right stack is: ＋ New Favorite Commute,
  🔍 Search routes, ⚙ Options (language, city). It stays on the right in Hebrew too.

## Open items

- Email to contact@noat.co.il asking for a live-location feed: **sent by the owner on
  2026-10-10**, no answer yet. If they offer a feed, weekend routes can get live buses.
- Owner to confirm on the iPhone (round of 2026-10-11): Hebrew screens, Options → language,
  Search routes, ⇄ Switch direction, 🕒 Timetable, the three buttons bottom right.
- The Hebrew texts were written by Claude and not yet read through by the owner; expect
  wording fixes (they are one line each in `src/i18n/he.js`).
- Owner to confirm on the iPhone: the ⚠ pop-up, the full-route screen and schedules, Sababus
  routes, and that the first visit no longer reloads by itself.
- Owner to confirm on the iPhone: the new home screen (map around them, tapping a stop,
  named Favorite Commute buttons, ＋ New Favorite Commute). And from the round of 2026-10-10: top of screen not blurred, map key
  tappable, panel drags, incoming lines solid, no circles, 708 listed at their stop, the
  usage question card, the privacy screen.
- Owner to publish the latest Firestore rules and create their `admins` document (above).
- Google sign-in is confirmed in the debug app; not yet confirmed in the main app.

- Planned requirements: fully offline city maps (REQ-DATA-4), direct ministry SIRI with
  arrival times through a proxy (REQ-RT-4).
- Before a public launch: a lawyer should review docs/privacy.md; set Analytics data
  retention; the workflow actions still warn about an old Node runtime (`@v4` actions).
- Ideas not requested yet: more cities, light rail and trains (pipeline is
  bus-only: `routeTypes: [3]`), a version line on the main app's home screen.
