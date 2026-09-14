'use strict';

/* Every name in `eslint.config.js`'s `frontendGlobals` must actually be declared
 * by a file in `public/js/**`.
 *
 * ONE direction only, on purpose. The other — a cross-file name that is *used*
 * but not listed — is already `no-undef`'s job and fails `npm run lint` loudly.
 * This direction has no signal at all: declaring a global that does not exist is
 * not an ESLint error, nothing else in the repo reads `eslint.config.js`, and the
 * list is 678 entries long, so a stale one is invisible forever.
 *
 * It rots exactly as you would expect. Written for #1122, which deleted four
 * whirl constants; the first run also turned up `formatCount`/`formatAverage`
 * (gone without trace) and `renderIncomingRequest`/`renderOutgoingRequest`/
 * `renderFriendRow` — the three #1092 replaced with one card, in a commit whose
 * own comment in `views-friends.js` NAMES all three as removed while this list
 * went on declaring them.
 *
 * Why a dead entry is worse than untidy: `frontendGlobals` is what stops
 * `no-undef` flagging legitimate cross-file calls, so every name in it is a hole
 * punched in the one check that guards the shared global scope
 * (`.claude/rules/eslint-frontend-shared-scope.md`). A name left behind keeps its
 * hole open, so a typo'd or since-renamed call to it lints clean.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Not provided by any file: `module` is Node's, and it is listed so the
 * `if (typeof module !== 'undefined' && module.exports)` export guard that makes
 * a helper testable does not trip `no-undef`
 * (`.claude/rules/frontend-helper-modules-and-coverage.md`). Any future entry
 * here needs the same kind of written reason. */
const NOT_OURS = new Set(['module']);

function listedGlobals() {
  const cfg = fs.readFileSync(path.join(ROOT, 'eslint.config.js'), 'utf8');
  const at = cfg.indexOf('const frontendGlobals = {');
  assert.ok(at >= 0, 'frontendGlobals is gone or renamed — this guard now checks nothing');
  const block = cfg.slice(at, cfg.indexOf('\n};', at));
  return [...block.matchAll(/(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*:\s*'(?:readonly|writable)'/g)]
    .map((m) => m[1]);
}

/* Joined into ONE string rather than kept per file: `^` under /m means "the
 * start of a line", so a declaration anywhere in the corpus still matches, and
 * it turns 678 x 118 regex runs into 678. */
function corpus(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return [corpus(p)];
    return e.name.endsWith('.js') ? [fs.readFileSync(p, 'utf8')] : [];
  }).join('\n');
}

/* Anchored at COLUMN 0, which is not a shortcut — it is the definition. A name
 * is global here only if it is declared at the top level of a shared-scope
 * script, and nothing else in these files starts a line that way: a comment
 * begins `/*`, `//` or ` *`, and `public/js/pages/*` wraps everything in an IIFE
 * (so its indented declarations are correctly NOT credited — those pages get no
 * SPA globals by design). Measured when this was written: the anchored and
 * unanchored forms agree exactly, 672 of the 672 that are ours, so it costs nothing
 * and it is what keeps a mention inside a comment from counting as a
 * declaration (`.claude/rules/source-scanning-guards-enumerate-shapes.md`).
 *
 * Collected into a Set in one pass rather than probed once per listed name:
 * 673 scans of a 2 MB corpus cost ~2.5s, and set membership is also a stricter
 * test than a `\b`-guarded name regex — `ghostly` cannot be read as `ghost`. */
const DECL = new RegExp(
  '^(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)'
  + '|^(?:async\\s+)?function\\s*\\*?\\s*([A-Za-z_$][\\w$]*)\\s*\\('
  + '|^class\\s+([A-Za-z_$][\\w$]*)',
  'gm',
);

function declaredIn(src) {
  const out = new Set();
  for (const m of src.matchAll(DECL)) out.add(m[1] || m[2] || m[3]);
  return out;
}

test('the matcher sees every shape these files declare, and nothing else', () => {
  for (const src of [
    'const MEMBER_COLORS = [];', 'let locale = "de";', 'var legacy = 1;',
    'function showHome() {}', 'async function showGameDetail(a) {}',
    'function* walk() {}', 'class Thing {}',
  ]) {
    const name = /(?:const|let|var|function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(src)[1];
    assert.ok(declaredIn(src).has(name), `the matcher misses: ${src}`);
  }
  // The negatives are what prove it credits a declaration rather than a mention.
  for (const src of [
    '// const ghost = 1;', ' * `ghost` was removed in #1092', 'return ghost;',
    '  const ghost = 1;', 'const ghostly = 1;', 'foo(function ghost() {});',
  ]) {
    assert.ok(!declaredIn(src).has('ghost'), `the matcher credits a non-declaration: ${src}`);
  }
});

test('every frontend global named in eslint.config.js is declared in public/js', () => {
  const names = listedGlobals();
  assert.ok(names.length > 500, `parsed only ${names.length} globals — the block regex stopped matching`);

  const declared = declaredIn(corpus(path.join(ROOT, 'public/js')));
  const missing = names.filter((n) => !NOT_OURS.has(n) && !declared.has(n));

  /* The floor counts names that MATCHED, never names attempted: a pattern that
     matched nothing at all would still satisfy an attempt count, which is the
     vacuous form this repo has shipped before. */
  const matched = names.length - missing.length - NOT_OURS.size;
  assert.ok(matched > 600, `only ${matched} globals matched — the declaration pattern is broken, not the list`);

  assert.deepEqual(missing, [],
    'these globals are declared by no file, so each keeps a no-undef hole open for a name that no longer exists');
});
