# ADR-0008: Usage insights (proposed)

**Status:** Proposed · 2026-10-10 · not built. Waiting for the owner's choice of tool and
location detail (questions at the end). Requirements REQ-ANL-1 to REQ-ANL-3 are *Planned*.

## What we want to learn

- How many people use Knight Bus: new users, and active per day, week and month.
- How they use it: which screens, how long on each, which features (flags, toggles, panel
  drag, search).
- What they save: cities, lines, one or two stops, start/destination or not.
- Whether it works for them: does the live data answer their question, do they come back.

## Good practice

1. **Ask first.** Under Israel's Privacy Protection Law (strengthened by Amendment 13, in
   force since August 2025), and GDPR for any EU visitors, analytics that is not needed to
   run the app needs clear notice and, for anything identifying, consent. Show a short
   choice on first launch: *Help improve Knight Bus: share anonymous usage* (on/off). Keep
   it changeable in the menu.
2. **Collect the minimum.** Track events, not people. A random install id is fine; email,
   name and Firebase uid are not. Never put stop names typed by the user, addresses or
   exact coordinates into analytics.
3. **Location is the sensitive part.** "Time spent in places" could mean two things:
   - *Places in the app* (screens): fine, and standard.
   - *Physical places*: a location history of real people. It is the most sensitive data
     an app can hold, and a commute app can reveal home and work. Recommendation: do
     **not** record it. If needed, record only the **city/area** and **hour of day** when
     a commute is opened. That still answers "when and where is the app used?".
4. **Aggregate what's already there.** Saved commutes are already in Firestore. A small
   report script (admin only, run on demand) can count lines, cities and stops per commute
   without new tracking.
5. **Keep it short.** Raw events for 14 months at most, then aggregates only.
6. **Say it.** A one-page privacy notice linked from the menu.

## Options

| | Firebase / Google Analytics 4 | PostHog Cloud (EU) | Self-hosted (Umami / Plausible) |
|-|------|---------|-------------|
| Fits our stack | Same Firebase project as sign-in, no new account | New account | A server to run |
| Users, retention, events | ✔ | ✔ | Basic |
| Funnels, paths, time on screen | Basic | ✔ (strong) | Basic |
| Session replay | ✘ | ✔ (off by default; keep it off) | ✘ |
| Cost now | Free | Free tier (1M events/month) | Hosting cost |
| Data location | US (Google) | EU option | Ours |
| Privacy control | Medium (consent mode) | High (EU, can drop IPs) | Highest |

**Recommendation:** start with **Firebase Analytics (GA4)**, behind the consent switch,
with these events:

| Event | Fields (nothing personal) |
|-------|---------------------------|
| `screen_view` | screen (`menu`, `editor`, `commute`, …), time on screen |
| `commute_saved` | city, number of stops, number of lines, has start/destination |
| `commute_opened` | slot, city, hour of day |
| `line_toggled` | on/off (no line ids) |
| `panel_dragged` | to small / half / large |
| `place_set` | how: tap / search / my location (no coordinates) |
| `live_seen` | buses shown: 0 / 1–2 / 3 |

If funnels and path analysis turn out to matter more than a free tool in the same
project, move to PostHog EU. Only `src/analytics.js` would change.

## Questions for the owner

1. Tool: **Firebase Analytics** (recommended), or PostHog EU?
2. Location: **city + hour only** (recommended), or something finer? A finer level needs
   explicit opt-in and a stronger privacy notice.
3. Should test (debug) usage be counted separately, so your own testing doesn't skew the
   numbers? (Recommended: yes, tagged `channel=debug`.)
