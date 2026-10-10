// Docs-as-code check. Docs: docs/adr/0005-docs-as-code.md
// 1. Every requirement marked "Done" in docs/requirements.md is referenced by `@req <ID>` in code.
// 2. Every `@req <ID>` in code exists in docs/requirements.md.
// 3. Every relative link in README.md and docs/**/*.md points to a file that exists.
// No dependencies: run with plain `node scripts/check-docs.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE_DIRS = ['src', 'pipeline', 'scripts'];
const CODE_FILES = ['index.html', 'sw.js', 'manifest.webmanifest', 'firestore.rules'];
const errors = [];

const walk = (dir, exts) =>
  !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p, exts);
    return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
  });
const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

// --- Requirements table ---
const reqText = fs.readFileSync(path.join(ROOT, 'docs/requirements.md'), 'utf8');
const reqs = new Map();
for (const m of reqText.matchAll(/^\|\s*(REQ-[A-Z]+-\d+)\s*\|.*\|\s*(Done|Planned)\s*\|\s*$/gm)) {
  if (reqs.has(m[1])) errors.push(`Duplicate requirement ID ${m[1]}`);
  reqs.set(m[1], { status: m[2], refs: [] });
}

// --- @req references in code ---
const codeFiles = [
  ...CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d), ['.js', '.mjs', '.css', '.html', '.ps1', '.sh'])),
  ...walk(path.join(ROOT, '.github/workflows'), ['.yml']),
  ...CODE_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
];
for (const file of codeFiles) {
  if (rel(file) === 'scripts/check-docs.mjs') continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/@req\s+(REQ-[A-Z]+-\d+)/g)) {
    const r = reqs.get(m[1]);
    if (!r) errors.push(`${rel(file)} references ${m[1]}, which is not in docs/requirements.md`);
    else r.refs.push(rel(file));
  }
}
for (const [id, r] of reqs) {
  if (r.status === 'Done' && !r.refs.length) errors.push(`${id} is "Done" but no code has "@req ${id}"`);
  if (r.status === 'Planned' && r.refs.length) errors.push(`${id} is "Planned" but code references it (${r.refs[0]}). Mark it Done?`);
}

// --- Links in markdown ---
const mdFiles = [path.join(ROOT, 'README.md'), path.join(ROOT, 'CLAUDE.md'), ...walk(path.join(ROOT, 'docs'), ['.md'])].filter((f) => fs.existsSync(f));
for (const md of mdFiles) {
  const text = fs.readFileSync(md, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(md), decodeURI(target)))) {
      errors.push(`${rel(md)} links to missing file: ${m[1]}`);
    }
  }
}

// --- Report ---
const done = [...reqs.values()].filter((r) => r.status === 'Done').length;
console.log(`Requirements: ${reqs.size} (${done} done, ${reqs.size - done} planned). Code files scanned: ${codeFiles.length}. Docs scanned: ${mdFiles.length}.`);
if (process.argv.includes('--matrix')) {
  for (const [id, r] of reqs) console.log(`${id.padEnd(13)} ${r.status.padEnd(8)} ${[...new Set(r.refs)].join(', ')}`);
}
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('Docs and code agree. ✔');
