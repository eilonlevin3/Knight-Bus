# Handoff: where the last chat stopped

Written 2026-10-24 at the owner's request, so the work can continue in a new chat (or the
same one, reopened). Read [CLAUDE.md](../../CLAUDE.md) first; this file adds what happened in
the long session of 2026-10-11 → 2026-10-24 and what is still waiting.

## How to continue

- **Reopen the same chat** (keeps everything it knew): in VS Code, open the Claude panel →
  past conversations → the one about Knight Bus. Or in a terminal opened in `C:\Repos`:

  ```
  claude --resume 265363a2-e900-4a16-8049-9960a70f2e39
  ```

  The chat was started in `C:\Repos`, not in the project folder, so resume it from there.
- **Start a new chat** and say: *"Read CLAUDE.md and docs/handoff/latest.md in
  C:\Repos\Knight Bus, then continue."*
- **The whole chat, word for word,** is backed up at
  `C:\Repos\Knight Bus\.sessions\2026-10-24-session-265363a2.jsonl` (69 MB, one JSON object per
  line). It is **git-ignored on purpose**: the repo is public and the chat holds personal
  details and screenshots. It stays on this PC only. Search it rather than reading it whole.

## State when the chat stopped

| | |
|-|-|
| Branch `debug` | `c93baca` (2026-10-20): live traffic for Favorite Commute ghosts, REQ-RT-15 |
| Branch `main` | still `34aad5a` (released 2026-10-10). Release **only** when the owner says so |
| Relay | Cloudflare Worker at `https://relay.knightbusapp.com` (own domain, bought by the owner; `*.workers.dev` is blocked by the owner's work-phone filter). The owner pastes `relay/worker.js` by hand; the Connection test shows whether the live relay answers both `/live` and `/rail-board` |
| Tests | 86 pass (`node --test tests/*.test.mjs`); `node scripts/check-docs.mjs` green |

`git log --oneline 34aad5a..debug` lists everything waiting for release.

## What this session built (newest first)

- **Live traffic for commute ghosts** (REQ-RT-15, `c93baca`): the phone learns stretch times
  of the last 20 minutes from the buses it already fetches, blends them with the month's
  history (n ÷ (n+4)); ⏳ learning / ⚡ on; ring green / yellow / red; per-ghost on/off in the
  pop-up. Only in Favorite Commutes (the owner's choice). Code: `src/lib/liveStretches.js`,
  `learnFrom` / `liveOf` in `src/liveLines.js`. Checked by replaying recorded buses: ⏳ → ⚡
  within ~5–10 min on a city route; intercity routes learn slowly.
- **Design review of the ghost** ([reviews/2026-10-19-ghost-estimation-dr.html](../reviews/2026-10-19-ghost-estimation-dr.html),
  dark theme): measured on ~2 million predictions from recorded buses
  ([reviews/backtest-ghost.mjs](../reviews/backtest-ghost.mjs)). Idea 1 (live stretch
  times) was chosen by the owner and built phone-only; idea 2 (bus's own pace) measured
  worse; **idea 3 (glide instead of jump, a range on the timer, fade old ghosts) is not
  built yet**.
- Blue dot follows the GPS twice a second (REQ-LOC-3); closing a route or stop removes its
  ghosts at once (`c6362cb`).
- Ghost timer m:ss to the selected stop (REQ-RT-14); ghosts move twice a second.
- Relay on its own domain; connection test screen in Options (REQ-DIAG-1).
- Trains: station panel with timetable, From/To search with date and leave/arrive, platforms
  from Israel Railways through the relay, one train's trip on the map with its timetable
  (REQ-TRAIN-1..7); light rail panel in its own file (REQ-LIGHT-1).
- Ghosts (REQ-RT-12/13) with a month of real travel times (REQ-DATA-12), automatic ghosts in
  commutes, manual ghosts elsewhere.
- Earlier in the session: Hebrew, route search, timetables, bus info pop-up, chips with a
  16-route limit, merged duplicate routes, fun facts, Favorite Commute opening view, select
  all / clear all, sticky Close / Home, direction buttons at stations, the relay itself.

## Waiting for the owner

1. **Nightly statistics: choose A, B or C.** Scheduled (nightly) runs use **main's**
   `deploy.yml`, which does not have the `speed-days` cache, so each night rebuilds from only
   ~6 days instead of 30.
   - **A (recommended):** copy only `.github/workflows/deploy.yml` from debug to main.
   - **B:** release everything (debug → main).
   - **C:** leave it.
2. **iPhone test of the relay's new address:** open `https://relay.knightbusapp.com/` in
   Safari, then run Options → Connection test, and paste the results. (The work phone's
   filter blocked `*.workers.dev`.)
3. **Try on the iPhone:** the live-traffic marks and rings in a commute; the blue dot moving
   live; ghosts disappearing with their route; the timer under ghosts.
4. Open questions from the design review: show the timer as a range or a single number that
   turns into "due"? Build idea 3? Live traffic also outside commutes?

## Rules from this session (also in CLAUDE.md)

- **No automatic updates.** The owner presses Update themselves (an auto-update was built
  and reverted, `3c1054b`).
- **Push to debug after finishing each request**, unless the owner says not to.
- **Do not help get around the owner's work-phone web filter**, and do not hunt for
  addresses that slip past it. The owner can ask their IT.
- The owner pastes `relay/worker.js` into Cloudflare by hand after every change to it.
- Purchases and passwords are always done by the owner.

## How things were tested without the owner's phone

- The app needs sign-in, which Claude must not do. Logic was checked with unit tests and by
  **replaying recorded buses through the real modules in Node** with a stub Leaflet (`L`)
  and `document` (see the backtest script for loading the city data and per-minute files).
- Node is not installed: a portable Node was used from the session's scratchpad folder
  (temporary). Download one again if needed (see CLAUDE.md, "This computer").
