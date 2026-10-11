# ADR-0009: Two languages, with the English text as the key

**Status:** Accepted · 2026-10-11

## Decision (REQ-LANG-1, REQ-LANG-2)

The app is in English and Hebrew. Code writes every on-screen text in English through
`t('…')` ([src/i18n.js](../../src/i18n.js)). In Hebrew, `t()` looks that exact English text
up in one file, [src/i18n/he.js](../../src/i18n/he.js). There are no separate message ids.

## Why

- **The code stays readable.** `t('Save Favorite Commute')` says what the button says. With
  ids (`t('editor.save')`) you must open another file to know.
- **No build step.** The app is plain files (ADR-0001); a translation library or a
  compile step would be the first.
- **Nothing is silently untranslated.** [tests/i18n.test.mjs](../../tests/i18n.test.mjs)
  reads the source for `t('…')` and `tn(…)` and fails when a text has no Hebrew line, when
  a Hebrew line lost a `{place}` for a value, or when a line is no longer used.
- **Two languages only.** With many languages, ids and a translation service would pay off.

## What follows from it

- Text must be a plain quoted string inside `t()`: no template strings, no variables. The
  test cannot see anything else. Values go in `{places}`: `t('Stop {n}', { n: 2 })`.
- Changing an English text means changing its key in `he.js` in the same commit; the test
  says which.
- Hebrew reads right to left. The page direction is set on `<html>` and the layout follows
  through logical CSS (`text-align: start`, `padding-inline-start`). The map stays left to
  right; arrows come from `arrow()` / `backArrow()`.
- Names from the transit data are Hebrew in both languages. The ministry publishes English
  stop names in a separate file (`translations.txt`); using it is a possible next step.
- The language is remembered on the device (`kb.language`), not in the account.
