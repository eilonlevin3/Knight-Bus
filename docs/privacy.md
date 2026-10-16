# Privacy and usage data

Requirements: REQ-ANL-1 to REQ-ANL-5. Decision: [ADR-0008](adr/0008-usage-insights.md).
Code: [src/analytics.js](../src/analytics.js), [src/views/privacy.js](../src/views/privacy.js),
[src/views/home.js](../src/views/home.js), [firestore.rules](../firestore.rules).

This is the source for what the app tells people on its *Privacy & usage data* screen. If
you change what is collected, change this file, the screen text and the code together.

## The rules

1. **Nothing is recorded until the person agrees.** The home screen asks once: *Help improve Knight
   Bus?* with *Share usage* and *No thanks*. No answer means off.
2. **It can be turned off any time**: *Menu → Privacy & usage data*.
3. **The user version collects only "safe" data** (table below): no names, emails, account
   ids, stop or route ids, addresses or coordinates.
4. **The debug version is counted apart and also keeps details**, and says so in its own
   words before the person agrees.

## What the app keeps in order to work (not analytics)

| Data | Where | Who can read it |
|------|-------|-----------------|
| Sign-in: email or Google account | Firebase Authentication | The account owner; project admins |
| Favorite Commutes: stops, routes, start/destination | Firestore `users/{uid}/favorites` | The account owner; project admins |
| Location | Used on the phone to pick the city, center the home map and draw "you are here". The last position is remembered **on the phone only** (`kb.lastPosition`), for a quick start | Never sent |
| Opening view | The map view chosen for a Favorite Commute (center, zoom, panel height, key open or folded) is remembered **on the phone only** (`kb.view.…`) | Never sent |
| Language | The language chosen in Options is remembered **on the phone only** (`kb.language`) | Never sent, except the usage event `language_changed` below, if you agreed |

## Who else sees a request

The app fetches things from other services, and each of them sees the phone's network
address, as any website does:

| Service | What it is asked | What that reveals |
|---------|------------------|-------------------|
| GitHub Pages | The app and the city data | That the app is in use |
| OpenStreetMap | Map tiles; address searches you type | The area you look at; the address you searched |
| Our live relay (Cloudflare), or Open Bus Stride | Live buses of route ids | Which routes are on your screen. Not which stop, not who you are. The relay stores nothing ([realtime.md](realtime.md#the-relay)) |
| Google Firebase | Sign-in, Favorite Commutes, usage data if you agreed | See the tables in this file |

## Safe usage data: everyone who agreed (user and debug versions)

Sent to **Google Analytics for Firebase** with `track()`. Each phone is a random Analytics
id; the account is never attached.

| Event | What is recorded |
|-------|------------------|
| `app_open` | installed app or browser, hour, weekday |
| `signed_in` | method: google / password |
| `screen_view`, `screen_time` | screen name (login, city, home, editor, commute, privacy, report), seconds on it (background time not counted) |
| `city_chosen` | city, how: GPS or list |
| `stop_picked` | how: map, search, or from the home map |
| `stop_explored` | city, number of routes at the stop (as a range). Not which stop |
| `place_set` | start or destination, how: tap / search / my location |
| `commute_saved` | slot, city, new or edited, number of stops, routes (as a range: 1–2, 3–5, 6+), has start, has destination, includes a weekend route |
| `commute_opened` | slot, city, **hour and weekday**, number of stops, routes (range), has start/destination, whether an opening view was chosen |
| `live_seen` | city, routes (range), buses on the way (range), any error |
| `line_toggled` | on or off |
| `stop_info_opened` | how many stops share the number, whether platforms tell them apart. Not which stop |
| `line_info_opened`, `line_map_opened`, `line_stop_tapped`, `schedule_opened` | that it happened, the number of stop patterns, whether a timetable existed. Not which route or stop |
| `route_search_opened`, `direction_switched` | that a route was opened from Search routes, or its direction switched. Not which route, and never what was typed in the search |
| `language_changed` | the language chosen (`en` or `he`) |
| `rail_station_opened`, `rail_search`, `rail_all_on_map`, `rail_trip_shown` | that a train station or light rail panel was opened or used: train or light rail, whether a search found trains. Not which station or train |
| `heading_toggled` | that a direction button of a station was used, on which screen, and whether it checked or unchecked |
| `routes_select_all`, `routes_clear_all` | that the button was used, and on which screen (home, editor or Favorite Commute) |
| `opening_view_set` | that an opening view was chosen, its zoom level (a number from 1 to 19), the panel height and whether the key was open. Not where the map was |
| `ghost_toggled` | that a ghost (estimated position) was turned on or off. Not for which bus |
| `bus_info_opened`, `route_card_opened` | that a bus's or a route's pop-up was opened, whether the bus signal was late, whether the route has several stop patterns. Not which bus or route |
| `panel_dragged` | small / half / large |
| `commute_cleared`, `update_applied`, `usage_sharing_on` | that it happened |

Google Analytics also records, by itself: device type, operating system, browser, language,
and country/city from the internet address.

**Physical places:** only the **city** and the **hour**. No coordinates, no stops, no routes.

## Detailed data: debug version only

Recorded with `trackDetail()` **only when the app runs as the debug (or local) version**
and the person agreed. Saved in **our own Firestore**, at `users/{uid}/debugEvents`, not in
Google Analytics. Google's rules forbid precise locations there.

| Event | Extra detail |
|-------|--------------|
| `city_chosen` | exact location, if GPS was used |
| `stop_explored` | which stop was opened on the home map |
| `commute_saved` | the whole Favorite Commute: stop ids and names, route ids, start and destination coordinates |
| `commute_opened` | the whole Favorite Commute, plus the phone's exact location at that moment |
| `live_seen` | per stop and route: how many stops away each bus was |
| `line_toggled` | which stop and route |
| `line_map_opened`, `schedule_opened` | which route and stop |

Each person can read and delete their own detail events; the rules do not allow editing
them, and refuse any event that claims to come from the user version.

## Keeping test use apart

- Debug and local versions send their Analytics events with `debug_mode`. Google Analytics
  keeps those **out of the normal reports**; they appear in *Analytics → DebugView*.
- Every event also carries `channel` (`main` / `debug` / `local`).
- Debug has its own answer to the sharing question: saying yes in one app does not turn it
  on in the other.

## Where to look

| Question | Where |
|----------|-------|
| How many users, how often, which screens, how long | Firebase console → **Analytics** (Dashboard, Events, Realtime). New data takes up to a day to reach the reports. |
| Debug testing as it happens | Firebase console → **Analytics → DebugView** |
| Detailed debug events | Firebase console → **Firestore → users → (your id) → debugEvents** |
| What Favorite Commutes people save | In the app: **Menu → 📊 Favorite Commutes report** (admins only, below) |

## The Favorite Commutes report (admin only)

*Menu → 📊 Favorite Commutes report* (REQ-ANL-2, REQ-ANL-5). Code: [src/views/report.js](../src/views/report.js),
[src/lib/report.js](../src/lib/report.js), tests in [tests/report.test.mjs](../tests/report.test.mjs).

It reads every Favorite Commute and shows **counts only**: people with a Favorite Commute,
Favorite Commutes per person, by city, one or two stops, with start/destination, the most saved
routes, and Favorite Commutes by month. It has two tabs: *Real users* and *Debug testers*.

- **No person is shown.** Account ids are used only to count "different people" and never
  leave the counting function. A unit test checks this.
- **Stops are places**, so a stop is listed only when at least **3 different people** saved
  it. Routes are listed from 1, since a route alone does not locate anyone.
- **Who can open it:** people with a document at `admins/{their uid}` in Firestore. That
  document can only be created in the Firebase console. The rules refuse the query to
  everyone else, so hiding the menu link is not what protects it.
- An admin can already see the same raw data in the Firebase console. The report adds no
  access; it adds a summary.

## Before a public launch

- Have a lawyer check this notice against Israel's Privacy Protection Law (Amendment 13)
  and, if you expect visitors from Europe, GDPR.
- Set Analytics data retention (Admin → Data settings) to the shortest period that works:
  2 or 14 months.
- The debug address is public. Share it only with testers who should be asked for the
  detailed data.
