// Every on-screen text has a Hebrew translation. Docs: docs/user-flows.md#language
// @req REQ-LANG-1
//
// Reads the app's source for t('…') and tn(count, '…', '…') and checks that each English
// text is a key of src/i18n/he.js. Run: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { he } from '../src/i18n/he.js';
import { t, tn, setLanguage, language, isRtl, arrow, cityName } from '../src/i18n.js';
import { patternSummary } from '../src/lib/patterns.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : sourceFiles(full);
    return e.name.endsWith('.js') && e.name !== 'i18n.js' ? [full] : []; // i18n.js defines t(), it shows no text
  });
}

// Reads a quoted text starting at src[i]. Returns [text, index after it], or null.
function readString(src, i) {
  const quote = src[i];
  if (quote !== "'" && quote !== '"') return null;
  let out = '';
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === '\\') { out += src[++k]; continue; }
    if (src[k] === quote) return [out, k + 1];
    out += src[k];
  }
  return null;
}

const skipSpace = (src, i) => { while (/\s/.test(src[i])) i++; return i; };

// All English texts the code can show: [{ text, file }]
export function usedTexts() {
  const found = [];
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    const name = path.relative(root, file);
    for (const m of src.matchAll(/(?<![\w.$])(tn?)\(/g)) {
      let i = skipSpace(src, m.index + m[0].length);
      if (m[1] === 'tn') {
        i = skipSpace(src, src.indexOf(',', i) + 1); // past the count
        const one = readString(src, i);
        assert.ok(one, `${name}: tn() needs its texts written out, near: ${src.slice(m.index, m.index + 60)}`);
        const many = readString(src, skipSpace(src, skipSpace(src, one[1]) + 1));
        assert.ok(many, `${name}: tn() needs two texts, near: ${src.slice(m.index, m.index + 60)}`);
        found.push({ text: one[0], file: name }, { text: many[0], file: name });
      } else {
        const s = readString(src, i);
        if (s) found.push({ text: s[0], file: name }); // t(variable) is covered below
      }
    }
  }
  return found;
}

const places = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every on-screen text has a Hebrew translation', () => {
  const used = usedTexts();
  assert.ok(used.length > 150, 'the source scan found too few texts; did the code layout change?');
  const missing = [...new Set(used.filter((u) => !(u.text in he)).map((u) => `${u.file}: ${JSON.stringify(u.text)}`))];
  assert.deepEqual(missing, [], `Add these to src/i18n/he.js:\n${missing.join('\n')}`);
});

test('texts that come from the transit data settings have a Hebrew translation', () => {
  // The running hours of weekend services (pipeline/cities.json) are shown through t(hours).
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pipeline/cities.json'), 'utf8'));
  for (const source of config.extraSources || []) {
    if (source.hours) assert.ok(source.hours in he, `Add to src/i18n/he.js: ${JSON.stringify(source.hours)}`);
  }
});

test('a Hebrew text keeps the same {places} as the English one', () => {
  for (const [english, hebrew] of Object.entries(he)) {
    assert.equal(places(hebrew), places(english), `Different {places} in the translation of ${JSON.stringify(english)}`);
  }
});

test('no translation is left over from text the app no longer shows', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pipeline/cities.json'), 'utf8'));
  const known = new Set([...usedTexts().map((u) => u.text), ...(config.extraSources || []).map((s) => s.hours)]);
  const unused = Object.keys(he).filter((k) => !known.has(k));
  assert.deepEqual(unused, [], 'Remove these from src/i18n/he.js');
});

test('t() fills in values and tn() picks singular or plural', () => {
  // Outside a browser the app starts in English.
  assert.equal(language(), 'en');
  assert.equal(t('Stop {n}: {name}', { n: 2, name: 'Arlozorov' }), 'Stop 2: Arlozorov');
  assert.equal(tn(1, '1 route', '{n} routes'), '1 route');
  assert.equal(tn(5, '1 route', '{n} routes'), '5 routes');
  assert.equal(t('A text nobody translated'), 'A text nobody translated');
});

test('changing the language changes the texts, the reading direction and the arrows', () => {
  const stop = (id) => ({ id, name: `Stop ${id}` });
  const route = { patterns: [
    { share: 70, stops: ['A', 'B', 'C'].map(stop) },
    { share: 30, stops: ['A', 'C'].map(stop) },
  ] };
  const shape = () => [[32, 34.7], [32.01, 34.71]];
  const city = { name: 'Jerusalem', nameHe: 'ירושלים' };
  try {
    setLanguage('he');
    assert.equal(language(), 'he');
    assert.equal(isRtl(), true);
    assert.equal(arrow(), '←');
    assert.equal(cityName(city), 'ירושלים');
    assert.equal(tn(1, '1 route', '{n} routes'), 'קו אחד');
    assert.equal(tn(4, '1 route', '{n} routes'), '4 קווים');
    assert.deepEqual(patternSummary(route, null, shape), [
      'רוב הנסיעות (70%) נוסעות במסלול הנפוץ: 3 תחנות.',
      '30% מהנסיעות מדלגות על תחנה אחת (Stop B). הן נוסעות באותם רחובות.',
    ]);
  } finally {
    setLanguage('en');
  }
  assert.equal(isRtl(), false);
  assert.equal(arrow(), '→');
  assert.equal(cityName(city), 'Jerusalem');
  assert.equal(patternSummary(route, null, shape)[0], 'Most trips (70%) follow the usual pattern: 3 stops.');
});
