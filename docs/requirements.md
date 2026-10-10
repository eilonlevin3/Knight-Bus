# Requirements

This file is the **source of truth** for what Knight Bus does. Every requirement has a
stable ID. Code that implements a requirement carries a `@req <ID>` comment, and
`npm run check:docs` (also run in CI) fails if:

- a requirement with status **Done** has no `@req` reference in the code, or
- the code references an ID that does not exist in this file.

To change behaviour, change this file first (in the same pull request as the code).

Status values: **Done** = implemented in MVP · **Planned** = agreed, not built yet.

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
| REQ-REL-2 | The debug version installs as a separate app (name *KB Debug*, orange icon), shows a badge with its commit, and keeps its favorites and settings separate from the main version. | Done |
| REQ-REL-3 | A broken debug build never stops or breaks the main site from deploying. | Done |

## Accounts

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-AUTH-1 | A user can create an account and sign in with email and password. | Done |
| REQ-AUTH-2 | A user can sign in with a Google account. | Done |
| REQ-AUTH-3 | All screens except sign-in need a signed-in user. The user can sign out. | Done |
| REQ-AUTH-5 | On the first sign-in on a device, commutes saved there in demo mode are copied into the account (empty slots only), then removed from the device. | Done |
| REQ-AUTH-4 | If Firebase is not configured yet, the app offers a *local demo mode*, which stores data only on the device. This is for development. | Done |

## Location and city data

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-LOC-1 | The app asks for GPS permission and uses the device location. | Done |
| REQ-LOC-2 | The app picks the user's metropolitan area from the location. If the user is outside every area, or denies GPS, they pick a city from a list. The user can change city from the menu. | Done |
| REQ-DATA-1 | The app downloads transit data **only for the selected city**, keeps it on the device, and downloads again only when a newer version is published. | Done |
| REQ-DATA-2 | A pipeline turns the national GTFS feed of the Ministry of Transport into one small file per city. The file holds stops, lines, the stop order of each line, and its route shape. The pipeline runs every night. | Done |
| REQ-DATA-3 | Base map tiles are cached on the device as they are viewed, so areas already seen work with a weak connection. | Done |
| REQ-DATA-4 | Download the whole city base map ahead of time for full offline use (vector tiles, see ADR-0003). | Planned |
| REQ-DATA-5 | Every bus line in the government feed is included, whatever days it runs: weekdays, Friday, Saturday, Saturday night. There is no filter by day. | Done |
| REQ-DATA-6 | Each line in a city bundle carries its scheduled travel minutes from the first stop to each stop, so the app knows where a bus is "5 minutes before your stop". | Done |
| REQ-DATA-7 | Include bus lines that are **not** in the government feed: the municipal weekend service *Naaim BeSofash* (lines 705–729, e.g. 708), read from the Tel Aviv municipality's public map server. They appear at the same stops as other lines. | Done |

## Favorite commutes

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-FAV-1 | The main menu shows three saved-commute buttons, labeled **Commute 1, 2, 3** (or the name the user gave). Older saves named "Favorite N" show as "Commute N". | Done |
| REQ-FAV-2 | Each favorite has an edit option. | Done |
| REQ-FAV-3 | Favorites are saved to the user's account, so they follow the user to other devices. | Done |
| REQ-FAV-4 | A favorite has a name the user can edit, and the user can clear it. | Done |
| REQ-FAV-5 | A favorite can have an optional **start point** and **destination**. The user sets each by tapping the map or searching an address; the start point can also be the current location. | Done |

## Editing a favorite commute

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-EDIT-1 | A favorite has up to **2** bus stops. The user picks a stop by tapping it on the map or by searching its name or code. | Done |
| REQ-EDIT-2 | When a stop is picked, the app lists all bus lines that serve it. | Done |
| REQ-EDIT-3 | Each line has a checkbox. **By default none are checked.** The user checks the lines they want. | Done |
| REQ-EDIT-4 | A checked line is drawn on the map along its whole route, from its first stop to its last. | Done |
| REQ-EDIT-5 | "Save stop" stores the stop and its checked lines. The user then adds the next stop or finishes. | Done |
| REQ-EDIT-6 | "Save commute" saves the commute and returns to the main menu. | Done |

## Live buses

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-RT-1 | For every line shown, the app shows up to three live buses relative to the chosen stop: **the next two approaching buses and the one that passed most recently**, when they exist. | Done |
| REQ-RT-2 | Live positions come from the government SIRI real-time feed of the Ministry of Transport, read through the public Open Bus Stride mirror (ADR-0002). They refresh every 30 seconds while the screen is visible. | Done |
| REQ-RT-3 | Each bus shows how old its position is, and how many stops it is from the chosen stop. | Done |
| REQ-RT-5 | Lines without live data (from outside the government feed) say so, with their service hours, instead of "No bus on the way". | Done |
| REQ-RT-4 | Read the Ministry of Transport SIRI SM service directly, through our own proxy, for lower latency and arrival predictions. | Planned |

## Using a favorite commute

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-COMM-1 | Opening a favorite shows its stops and selected lines with live buses, the same as in the editor. | Done |
| REQ-COMM-2 | The commute view opens zoomed so that the start point, destination and chosen stops are all visible, plus each chosen line's last **~5 minutes of travel before** its stop (by timetable, or ~1.5 km when the timetable is missing). | Done |
| REQ-COMM-3 | The start point is marked with a **green flag**, the destination with a **checkered flag**, on the map and in the editor. | Done |
| REQ-COMM-4 | Each line is drawn in two parts: before the chosen stop (incoming) **solid**; after the stop (outbound) lighter and partly transparent, but still clearly visible. | Done |
| REQ-COMM-5 | Where lines share a street, they are drawn **side by side**, so every line passing there is visible. Shifting must not create loops or knots at corners at any zoom. | Done |
| REQ-COMM-6 | A **map key** in the top-left corner lists each line's color, number and destination, the flags, and the bus symbols. It can be collapsed. | Done |
| REQ-COMM-7 | The panel lists every line of every stop in the favorite with a **checkbox, all checked** when the view opens. Unchecking hides that line from the current view (map, buses, key) but does **not** change the favorite. | Done |
| REQ-COMM-8 | The panel can be **dragged**: down (by its handle, or swiping down while the list is at its top) for more map, up for more list. It settles at small, half or large. | Done |
| REQ-COMM-9 | On installed phone apps, nothing is drawn under the status bar (clock/battery): the map, its key and buttons start below it, so they are sharp and can be tapped. | Done |

## Usage insights (proposal: see ADR-0008)

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-ANL-1 | Count users and how they use the app (active users per day/week, screens opened, time on each screen, which features are used), with **privacy-first** tracking: consent first, no names/emails/precise location in analytics. | Planned |
| REQ-ANL-2 | Report what commutes people save: cities, lines, number of stops, start/destination set or not, as aggregate counts only. | Planned |
| REQ-ANL-3 | A privacy notice in the app and the option to turn usage tracking off at any time. | Planned |
