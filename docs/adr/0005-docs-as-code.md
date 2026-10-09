# ADR-0005: Docs as code, with requirement IDs checked in CI

**Status:** Accepted · 2026-10-09

## Context

We want the documentation to be the source of truth for what the app does, and to stay
correct as the code changes.

## Decision

1. **All docs live in the repo** as Markdown, next to the code, and change in the same pull
   request. Diagrams are [Mermaid](https://mermaid.js.org) text, which GitHub renders.
2. **[requirements.md](../requirements.md) is the spec.** Each requirement has a stable ID
   (`REQ-EDIT-3`) and a status (*Done* / *Planned*).
3. **Code points back to the spec** with `@req <ID>` comments in the file that implements it.
4. **[scripts/check-docs.mjs](../../scripts/check-docs.mjs) enforces the link**, and CI runs
   it on every pull request and deploy. It fails when:
   - a *Done* requirement has no code reference,
   - code references an unknown ID,
   - a *Planned* requirement already has code (its status must be updated),
   - a relative link in any doc points to a missing file.
5. **Decisions are ADRs** in `docs/adr/`: short, numbered, never deleted, only superseded.
6. Config that defines behaviour is also code: cities ([pipeline/cities.json](../../pipeline/cities.json)),
   security rules ([firestore.rules](../../firestore.rules)) and the deploy pipeline
   ([deploy.yml](../../.github/workflows/deploy.yml)).

## Workflow for a change

1. Edit `docs/requirements.md`: add or change the requirement.
2. Update the relevant doc (flows, data model, …).
3. Write the code with `@req` tags.
4. `npm run check:docs`. Open a PR; the template has a docs checklist.

## Consequences

- `node scripts/check-docs.mjs --matrix` prints a live traceability table: requirement →
  files.
- The check proves a reference exists, not that the code is right. Reviews and tests still
  matter.
