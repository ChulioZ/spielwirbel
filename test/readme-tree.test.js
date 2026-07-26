'use strict';

/* README.md's architecture tree is the repo's file map — the thing a new
   contributor (or a new session) reads to find out what a module is for. It
   drifts in exactly one direction: someone adds `lib/<new>.js`, documents the
   *feature* in the surrounding prose, and never touches the tree. The omission
   is invisible, because a tree listing ~60 siblings reads as complete.

   `.claude/rules/keep-readme-current.md` already names "changes the file/folder
   structure shown in the README's architecture tree" as a trigger, and it was
   still missed eight times (six `lib/` modules and two `public/js/` ones, found
   by the 2026-07-26 claude-file-audit). A correct rule that gets skipped that
   often does not need rewording — it needs a check that cannot be skipped, which
   is this file.

   Deliberately a presence check on the entry name, not a structural parse of the
   ASCII tree: it catches the real failure (a module nobody documented) without
   pinning the tree's exact shape, so reformatting it stays free. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// The architecture tree is the one fenced block that starts with `server.js`.
const treeBlock = () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const block = /```\n(server\.js[\s\S]*?)```/.exec(readme);
  assert.ok(block, 'README.md: could not find the architecture tree fence (it starts with `server.js`)');
  return block[1];
};

// Every line's first token, i.e. the entry names the tree declares. A few
// entries carry a directory prefix (`lang/en.js`), so index the basename too.
const entryNames = (tree) => new Set(
  tree.split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
    .flatMap((token) => [token, path.basename(token)]),
);

// Source files a reader should be able to look up. Migrations are excluded: the
// tree documents `migrations/` as a directory on purpose — they are versioned,
// append-only, and listing each one would make the tree useless within a year.
const SOURCE_DIRS = ['lib', 'routes', 'public/js'];
const SKIP = [path.join('lib', 'repo', 'migrations')];

const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (SKIP.includes(rel)) return [];
    if (e.isDirectory()) return walk(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });

const sourceFiles = SOURCE_DIRS.flatMap((d) => walk(d));
const sourceBasenames = new Set(sourceFiles.map((rel) => path.basename(rel)));

test('every source module appears in the README architecture tree', () => {
  const names = entryNames(treeBlock());
  const undocumented = sourceFiles
    .filter((rel) => !names.has(path.basename(rel)))
    .sort();

  assert.deepEqual(undocumented, [],
    `these modules exist but are missing from README.md's architecture tree:\n  ${undocumented.join('\n  ')}`);
});

test('the README architecture tree names no module that was deleted', () => {
  // The other direction: a removed module leaves a tree entry pointing at
  // nothing, which is how a session ends up looking for `lib/ai.js` (removed
  // with the AI surface in #264) and concluding the checkout is broken.
  const stale = [];

  for (const line of treeBlock().split('\n')) {
    const token = line.trim().split(/\s+/)[0];
    if (!token || !/\.js$/.test(token)) continue;
    // Compare on the basename: a few entries carry a directory prefix
    // (`lang/en.js`), and those must be checked too rather than skipped.
    const name = path.basename(token);
    // An entry is fine as long as SOME source dir holds a file by that name —
    // the tree is indented ASCII, so the owning directory is not machine-readable.
    const exists = sourceBasenames.has(name)
      || ['', 'scripts', 'public'].some((d) => fs.existsSync(path.join(ROOT, d, name)));
    if (!exists) stale.push(token);
  }

  assert.deepEqual(stale, [],
    `README.md's architecture tree names modules that no longer exist:\n  ${stale.join('\n  ')}`);
});
