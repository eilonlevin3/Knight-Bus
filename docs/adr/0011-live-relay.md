# ADR-0011: A small relay of our own for live buses

**Status:** Accepted · 2026-10-13. Deployed the same day at
`https://knight-bus-relay.eilonlevin3.workers.dev`. In a first three-minute watch: 26
questions, no failures, newest bus positions 26–100 seconds old. Since 2026-10-17 its
address is `https://relay.knightbusapp.com`, a domain of the project's own, because many
workplace and school filters block every `workers.dev` address (the owner's work phone
does).

## The problem

Live positions came from the Open Bus Stride service (ADR-0002). Stride loads the
ministry's data in batches, and the loading runs late: a median of 14 minutes on
2026-10-12, up to 27. On 2026-10-13 it did not answer at all for a while. A bus position
that old is of little use to someone waiting at a stop.

The same project also publishes its raw input: **one file a minute with every bus in the
country**, uploaded less than a minute after the buses report. Those files are fresh, but a
phone browser cannot use them: the file server gives browsers no permission to read them
(no CORS header), and each file is 4 MB unpacked.

## Decision (REQ-RT-11)

Run a small relay, [relay/worker.js](../../relay/worker.js), as a **Cloudflare Worker** on
the free plan. Once a minute it reads the newest file; for each question from the app it
returns only the buses of the routes asked for. The app asks the relay first and falls back
to Stride when the relay is not set up or does not answer.

## Why this, and not…

- **…asking the Open Bus project to open the files to browsers.** It depends on volunteers,
  with no date, and every phone would download the whole country every minute.
- **…the ministry's own feed (REQ-RT-4).** Registration is slow and needs a server with a
  fixed address, so a paid machine. Still the best source in the long run: it adds arrival
  predictions.
- **…staying with Stride only.** Free and simple, but the delay made live buses useless.

## What it costs

- **This breaks "no server of our own" (ADR-0001).** It is the first part that does not
  live on GitHub Pages. To keep that small: the relay is one file with no storage, no
  accounts and no secrets; the app works without it (Stride fallback); and its address is a
  single setting, `realtime.relayUrl` in `src/config.js`.
- **It is deployed by hand** (paste the file in Cloudflare's editor), not by GitHub Actions.
  Changing `relay/worker.js` in the repo does nothing until someone pastes it again.
- **The free plan allows about 10 ms of computing per request.** Unpacking a file takes
  about that long, so the relay is written to do as little as possible: it never reads the
  file as one object, it keeps the unpacked file for a minute, and most requests only cut
  pieces out of text it already holds. If Cloudflare still refuses the once-a-minute
  unpacking, the options are its paid plan ($5 a month) or another host; the app side does
  not change.
- **It depends on the Open Bus project's file layout**, which is not a promised interface.
  If it changes, the relay returns no buses and the app falls back to Stride.
- **Privacy:** Cloudflare, like any web host, sees the phone's network address and which
  route ids were asked for. The relay itself stores nothing. See
  [privacy.md](../privacy.md).
