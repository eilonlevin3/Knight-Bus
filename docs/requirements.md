# Requirements

This file is the **source of truth** for what Knight Bus does. Every requirement has a
stable ID. Code that implements a requirement carries a `@req <ID>` comment, and
`npm run check:docs` (also run in CI) fails if:

- a requirement with status **Done** has no `@req` reference in the code, or
- the code references an ID that does not exist in this file.

To change behaviour, change this file first (in the same pull request as the code).

Status values: **Done** = implemented in MVP · **Planned** = agreed, not built yet.

## Words we use

These words mean one thing each, in every doc.

| Word | Means |
|------|-------|
| **Route** | A bus service: a number, a direction, and the path it drives. "Route 62 to Ramat Gan." In the timetable data this is a `route_id`. |
| **Stop pattern** | One exact list of stops that a route's trips serve. Most routes have one. Some have several, because some trips skip or add stops. The **most common pattern** is the one most trips use. |
| **Line** | Something **drawn on the map** to show a route: a solid, dashed or dotted line. A line is never the bus service itself. |
| **Stop** | A place where buses stop, with a stop number. A terminal can have several stops that share one number (its platforms). |
| **Favorite Commute** | What a person saves: up to two stops and the routes chosen at each, with an optional start point and destination. Up to three per person. Always written with both words; "commute" alone means the trip in general. |

The app's screens use the same words ("Route 62", "Show the full route on the map", "Most
common pattern", "Other pattern"). In Hebrew: route = קו, stop = תחנה, stop pattern = מסלול,
Favorite Commute = נסיעה מועדפת (the full word list is at the top of `src/i18n/he.js`).

Two places still say "line" for a route, on purpose:

- **Requirement IDs** `REQ-LINE-1a` to `REQ-LINE-4` keep the word LINE, because IDs never change. They are about routes with more than one stop pattern.
- **File, address and usage-event names** (`views/line.js`, `lineInfo.js`, `#/line/…`, `line_map_opened`). `liveLines.js` and `offsetLine.js` really are about drawn lines.

## Scope

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-SCOPE-1 | The MVP covers Israel only. Cities are defined in `pipeline/cities.json`. | Done |

## Installable web app (PWA)

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-PWA-1 | The app runs in a phone browser and can be added to the home screen with its own icon and name, opening full screen with no browser bar. | Done |
| REQ-PWA-2 | The app shell (HTML/JS/CSS/icons) works offline after the first visit. | Done |
| REQ-PWA-3 | When a new version is published, an open app downloads it in the background and offers *Update*. If the user ignores the offer, the new version starts the next time the app is opened from closed. A running app never mixes files from two versions. | Done |

## Releases: test before users get it

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-REL-1 | There are two versions of the site, built from two branches: **main** at `/Knight-Bus/` (what users get) and **debug** at `/Knight-Bus/debug/` (for testing on a phone before release). Both deploy on every push to either branch, and every night. | Done |
| REQ-REL-2 | The debug version installs as a separate app (name *KB Debug*, orange icon), shows a badge with its commit, and keeps its Favorite Commutes and settings separate from the main version. | Done |
| REQ-REL-3 | A broken debug build never stops or breaks the main site from deploying. | Done |

## Accounts

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-AUTH-1 | A user can create an account and sign in with email and password. | Done |
| REQ-AUTH-2 | A user can sign in with a Google account. | Done |
| REQ-AUTH-3 | All screens except sign-in need a signed-in user. The user can sign out. | Done |
| REQ-AUTH-5 | On the first sign-in on a device, Favorite Commutes saved there in demo mode are copied into the account (empty slots only), then removed from the device. | Done |
| REQ-AUTH-4 | If Firebase is not configured yet, the app offers a *local demo mode*, which stores data only on the device. This is for development. | Done |

## Location and city data

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-LOC-1 | The app asks for GPS permission and uses the device location. | Done |
| REQ-LOC-2 | The app picks the user's metropolitan area from the location. If the user is outside every area, or denies GPS, they pick a city from a list. The user can change city from the menu. | Done |
| REQ-DATA-1 | The app downloads transit data **only for the selected city**, keeps it on the device, and downloads again only when a newer version is published. | Done |
| REQ-DATA-2 | A pipeline turns the national GTFS feed of the Ministry of Transport into one small file per city. The file holds stops, routes, the stop order of each route, and the shape of its path. The pipeline runs every night. | Done |
| REQ-DATA-3 | Base map tiles are cached on the device as they are viewed, so areas already seen work with a weak connection. | Done |
| REQ-DATA-4 | Download the whole city base map ahead of time for full offline use (vector tiles, see ADR-0003). | Planned |
| REQ-DATA-5 | Every bus route in the government feed is included, whatever days it runs: weekdays, Friday, Saturday, Saturday night. There is no filter by day. | Done |
| REQ-DATA-6 | Each route in a city bundle carries its scheduled travel minutes from the first stop to each stop, so the app knows where a bus is "5 minutes before your stop". | Done |
| REQ-DATA-7 | Include bus routes that are **not** in the government feed: the municipal weekend services *Naaim BeSofash* (routes 705–729, from the Tel Aviv municipality's map server) and *Sababus* (Ramat Gan's green, blue, red and white routes, from the operator's public map). They appear at the same stops as other routes. Where the operator's map and Moovit disagree on a stop, the app follows Moovit: a stop the map places where no bus stop exists is attached to the nearest real stop on the route's path. | Done |
| REQ-DATA-8 | A route whose trips do not all serve the same stops keeps **every stop pattern** (the most common one and up to three others), each with its share of the week's trips. The route is listed at every stop any pattern serves. | Done |
| REQ-DATA-9 | The pipeline writes one small **timetable file per route** for the coming week (start times per weekday and pattern, minutes to each stop). The app loads a file only when a stop's schedule is opened. | Done |

## Home screen

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-HOME-1 | The first screen after sign-in is the **home screen** (formerly "main menu"). Its upper half is a map centered on the user's location, with a button to return to it. | Done |
| REQ-HOME-2 | Tapping a bus stop on the home map selects it: the map zooms to the stop and the last ~5 minutes of every route before it, **all routes through the stop are drawn** (each as a line: solid where it comes to the stop, lighter after it) with their **live buses**, and the panel lists them with live status, the same as in a Favorite Commute. | Done |
| REQ-HOME-3 | The stop's routes are shown as **small icons, not full rows**: each is a checkbox and the route number. All are checked (at a busy stop, the first 16). Unchecking hides a route. Pressing the **number** (not the box) opens a pop-up with more about the route and a link to its full-route screen. Closing the stop returns to the plain map. **＋ New Favorite Commute** with a stop selected starts the new Favorite Commute at that stop. | Done |

## Favorite Commutes

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-FAV-1 | The home screen shows a button for each **saved** Favorite Commute (up to three), labeled with the name the user gave it. Empty slots are not shown. A small **＋ New Favorite Commute** button sits at the bottom right while a slot is free. | Done |
| REQ-FAV-2 | Each Favorite Commute has an edit option. | Done |
| REQ-FAV-3 | Favorite Commutes are saved to the user's account, so they follow the user to other devices. | Done |
| REQ-FAV-4 | The user names each Favorite Commute in the editor; that name is the text of its home-screen button. Without a name it is called "Favorite Commute N". The user can rename or clear a Favorite Commute. | Done |
| REQ-FAV-5 | A Favorite Commute can have an optional **start point** and **destination**. The user sets each by tapping the map or searching an address; the start point can also be the current location. | Done |

## Editing a Favorite Commute

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-EDIT-1 | A Favorite Commute has up to **2** bus stops. The user picks a stop by tapping it on the map or by searching its name or code. | Done |
| REQ-EDIT-2 | When a stop is picked, the app lists all bus routes that serve it. | Done |
| REQ-EDIT-3 | Each route has a checkbox. **By default none are checked.** The user checks the routes they want. | Done |
| REQ-EDIT-4 | A checked route is drawn on the map as a line along its whole path, from its first stop to its last. | Done |
| REQ-EDIT-5 | "Save stop" stores the stop and its checked routes. The user then adds the next stop or finishes. | Done |
| REQ-EDIT-6 | "Save Favorite Commute" saves the Favorite Commute and returns to the home screen. | Done |

## Live buses

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-RT-1 | For every route shown, the app shows up to three live buses relative to the chosen stop: **the next two approaching buses and the one that passed most recently**, when they exist. | Done |
| REQ-RT-2 | Live positions come from the government SIRI real-time feed of the Ministry of Transport, read through the public Open Bus Stride mirror (ADR-0002). They refresh every 30 seconds while the screen is visible. | Done |
| REQ-RT-3 | Each bus shows how old its position is, and how many stops it is from the chosen stop. | Done |
| REQ-RT-5 | Routes without live data (from outside the government feed) say so, with their service hours, instead of "No bus on the way". | Done |
| REQ-RT-6 | Routes without live data are **marked clearly wherever they appear**: a *Weekend · no live tracking* tag and a dashed ring on the route number in every list (home stop list, editor, commute, summary), a **dashed line on the map**, a dashed entry in the map key, and the note in the report. | Done |
| REQ-RT-8 | A live bus is shown **where it really is**, whichever stop pattern of its route it is driving. A bus is never hidden or moved because it is on a less common pattern; it is left out only when it is on none of the route's paths. | Done |
| REQ-RT-9 | When the live feed runs late, the app still shows the newest positions it has, up to 30 minutes old, and **says clearly that they are late** and how old they are. A bus whose last position is more than 7 minutes behind the newest one on its route is taken as finished and left out. | Done |
| REQ-RT-10 | Tapping a live bus on any map shows **everything we know about it**: when its last signal arrived and how old it is, and all the information in that signal (position, speed, heading, distance driven, scheduled start of the trip, vehicle number, trip reference and the rest), in plain words and as the raw record. | Done |
| REQ-RT-7 | Live positions for the weekend *Naaim BeSofash* routes. Blocked: no public source exists (see data-pipeline.md). Needs an agreement with the operator, or a feed they publish. | Planned |
| REQ-RT-4 | Read the Ministry of Transport SIRI SM service directly, through our own proxy, for lower latency and arrival predictions. | Planned |

## Using a Favorite Commute

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-COMM-1 | Opening a Favorite Commute shows its stops and selected routes with live buses, the same as in the editor. | Done |
| REQ-COMM-2 | The Favorite Commute view opens zoomed so that the start point, destination and chosen stops are all visible, plus each chosen route's last **~5 minutes of travel before** its stop (by timetable, or ~1.5 km when the timetable is missing). | Done |
| REQ-COMM-3 | The start point is marked with a **green flag**, the destination with a **checkered flag**, on the map and in the editor. | Done |
| REQ-COMM-4 | Each route's line is drawn in two parts: before the chosen stop (incoming) **solid**; after the stop (outbound) lighter and partly transparent, but still clearly visible. | Done |
| REQ-COMM-5 | Where routes share a street, their lines are drawn **side by side**, so every route passing there is visible. Shifting the lines must not create loops or knots at corners at any zoom. | Done |
| REQ-COMM-6 | A **map key** in the top-left corner lists each route's color, number and destination, the flags, and the bus symbols. It can be collapsed. | Done |
| REQ-COMM-7 | The panel lists every route of every stop in the Favorite Commute with a **checkbox, all checked** when the view opens. Unchecking hides that route from the current view (map, buses, key) but does **not** change the Favorite Commute. | Done |
| REQ-COMM-8 | The panel can be **dragged**: down (by its handle, or swiping down while the list is at its top) for more map, up for more list. It settles at small, half or large. | Done |
| REQ-COMM-9 | On installed phone apps, nothing is drawn under the status bar (clock/battery): the map, its key and buttons start below it, so they are sharp and can be tapped. | Done |

## Stops that share a number

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-STOP-1 | Where several stops share one stop number (the platforms of a terminal), each is shown with what tells it apart, when the data has it: its **platform** and **floor** ("20277 · Platform 2"), in search results, stop titles and pop-ups. | Done |
| REQ-STOP-2 | Such a stop always shows a **⚠ hazard sign**. Pressing it says how many bus stops share the number and to make sure you are at the right one, and lists each stop with its platform (if known) and its routes. Where a stop is being chosen (home screen, editor), the pop-up can switch to another of them. | Done |

## Routes with more than one stop pattern

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-LINE-1a | When a route is shown from a stop and only **one** of its stop patterns passes that stop, only that pattern is drawn. | Done |
| REQ-LINE-1b | When **several** of its stop patterns pass that stop, the most common is drawn as the normal line and the others as **dotted** lines. | Done |
| REQ-LINE-1c | Where two stop patterns are identical on the map (they take the same path), only the full (solid) line is shown; the other gets no dotted line. | Done |
| REQ-LINE-1d | For a route with more than one stop pattern, pressing the hazard sign shows a **summary that explains the difference** between the patterns: what share of trips each takes, which stops each skips or adds, whether they take the same path, and what that means at this stop. | Done |
| REQ-LINE-2 | A route with more than one stop pattern shows a small **⚠ hazard sign** next to it in every list. Pressing it opens a pop-up about the route: the summary of REQ-LINE-1d first, then each pattern's share of trips, how it differs (stops skipped or added), whether it stops at this stop, and what is drawn. | Done |
| REQ-LINE-3 | The pop-up links to a **full-route screen**: the route on the map with all its stop patterns (the most common as a solid line, the others as dotted lines, each in its own color) and all their stops. | Done |
| REQ-LINE-4 | On the full-route screen, pressing a stop shows a link to that stop's **full schedule**: every scheduled time of the route at the stop, by weekday, with trips of the less common patterns marked. Routes without a published timetable say so. | Done |

## Searching routes

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-ROUTE-1 | The home screen has a **Search routes** button, below *New Favorite Commute*. It opens a list of every route in the city's data, searchable by route number, destination or operator. Tapping a result opens the full-route screen with the route's map. | Done |
| REQ-ROUTE-2 | A bus service that runs in two directions is listed **once** in the search, and the full-route screen shows **one direction only**, with a **Switch direction** button that shows the opposite direction instead. Both directions are never drawn together. | Done |
| REQ-ROUTE-3 | The full-route screen has a **Timetable** button (the times at the route's first stop, or at the stop already chosen) and the route's **stops in order**; choosing a stop shows the timetable there (REQ-LINE-4). | Done |

## Languages

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-LANG-1 | Every on-screen text is available in **English and Hebrew**. In Hebrew the screens read right to left; the map stays as it is. Names that come from the transit data (stops, destinations, operators) are Hebrew in both languages. A test fails when a text has no Hebrew translation. | Done |
| REQ-LANG-2 | The home screen has an **Options** button, bottom right, where the language is changed; the screen changes at once. The choice is remembered on the device. On a first visit the app follows the phone's language. The sign-in screen also offers the other language. | Done |

## Usage insights (see privacy.md and ADR-0008)

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-ANL-1 | With the person's agreement, record **safe, anonymous** usage: app opens, sign-in method, screens and time on each, features used, city and hour. Never names, emails, account ids, stop or route ids, addresses or coordinates. The exact list is in privacy.md. | Done |
| REQ-ANL-2 | A report of what Favorite Commutes people save, as **counts only**: people and Favorite Commutes, Favorite Commutes per person, by city, 1 or 2 stops, start/destination set or not, most saved routes, by month. A stop is listed only when at least 3 different people saved it. Real users and debug testers are shown separately. | Done |
| REQ-ANL-3 | Nothing is recorded until the person agrees. The home screen asks once; a *Privacy & usage data* screen explains what is kept and lets them turn sharing on or off at any time. | Done |
| REQ-ANL-5 | The report is open only to **admins**. Admins are listed by hand in the database (`admins/{uid}`); the app cannot add one. The database rules refuse the report's query to anyone else. | Done |
| REQ-ANL-4 | The **debug** version is counted apart from real users (kept out of the normal reports), and, with agreement to its own clearer notice, also records details: the stops and routes of Favorite Commutes, start/destination points, and exact location when a Favorite Commute is opened. Details are stored in our own database under the tester's account, never in Google Analytics. | Done |
