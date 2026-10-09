# ADR-0002: Live data through the Open Bus Stride mirror of the government SIRI feed

**Status:** Accepted for MVP · 2026-10-09

## Context

Live bus positions in Israel come from the Ministry of Transport **SIRI** service. Direct
access needs developer registration with the ministry and a **whitelisted server IP**. It
also has no CORS, so a phone browser cannot call it. We have no server.

The Public Knowledge Workshop's **Open Bus Stride API** reads the same government feed
every minute and offers it as a free, open, CORS-enabled REST API. Checked 2026-10-09:
fresh snapshots every minute, `Access-Control-Allow-Origin: *`, and SIRI `line_ref` equal
to the GTFS `route_id`.

## Decision

For the MVP the phone calls Stride's `siri_vehicle_locations` endpoint directly
([src/realtime.js](../../src/realtime.js)). The base URL lives in
[src/config.js](../../src/config.js), so we can switch it later.

## Consequences

- No server to run, no keys, and it works today.
- About 1–2 minutes of delay, and we depend on a volunteer-run service.
- We get positions, not predicted arrival times. "Next two buses" is computed from position
  along the route ([realtime.md](../realtime.md)).
- **Later (REQ-RT-4):** register with the ministry, run a small proxy (for example a
  Cloudflare Worker with a fixed egress IP) that calls SIRI-SM, and return the same shape
  from it. Only `fetchLiveBuses()` changes.
