# ADR-0006: A debug version in a sub-folder of the same site

**Status:** Accepted · 2026-10-10

## Context

We want to try a change on a real phone before users get it. GitHub Pages hosts **one site
per repository**. Options:

1. A second repo, for a second Pages site. That means two copies of the code to keep in sync.
2. Another host for previews (Netlify, Cloudflare). That means another account and service.
3. One site holding both versions: `main` at the root and `debug` at `/debug/`.

## Decision

Option 3. One workflow ([deploy.yml](../../.github/workflows/deploy.yml)) checks out both
branches, builds each with its own code and data pipeline
([build-site.sh](../../scripts/build-site.sh)), and publishes the result as one site.
The debug build may fail without blocking main.

Updates switch from *stale-while-revalidate* to **versioned, all-at-once** updates. The
service worker is stamped with the commit id. A new version is downloaded whole, then
activated on *Update* or at the next cold start ([src/updates.js](../../src/updates.js)).
This removes the risk of a phone running a mix of old and new files, and it removes the
manual "bump SHELL_VERSION" step.

## Consequences

- No new accounts or services. The test version is a real installed app on the phone.
- Both versions share one origin, so storage must be namespaced. That covers Favorite Commutes,
  settings and caches; see [release-process.md](../release-process.md). Sign-in is shared.
- Every run builds two sites (about 4–5 minutes instead of 2).
- Pushing to `debug` also redeploys `main`, with no change to main's content.
