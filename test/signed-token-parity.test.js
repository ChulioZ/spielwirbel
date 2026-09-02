'use strict';

/*
 * `lib/auth.js` and `lib/admin.js` each carry their own copy of the same four
 * signed-token primitives, and `lib/accounts.js` a third copy of one of them:
 *
 *   safeEqual    auth == admin == accounts   (timing-safe compare)
 *   mintToken    auth == admin
 *   verifyToken  auth == admin
 *   readCookie   auth == admin
 *
 * All byte-identical today, and all correct — constant-time compare, signature
 * verified before `exp`, domain-separated. `sign` differs only by the `admin.`
 * prefix, which is the point of the separation and is not asserted here.
 *
 * The finding is the DRIFT SURFACE, not a live defect: `lib/admin.js` carries
 * the "same as lib/auth.js" comment that
 * .claude/rules/shared-constants-across-the-stack.md is written about, without
 * the parity test that licenses the one duplicate that file permits
 * (TAG_ICONS). A fix applied to one of these reaches none of the others, and
 * nothing would go red.
 *
 * This is the cheaper of the two remedies the audit offered. The other — one
 * `lib/signed-token.js` parameterised by domain prefix, TTL and secret resolver
 * — is a refactor of live auth code and belongs in its own change, not folded
 * into a documentation sweep. Until then this is what makes a one-sided edit
 * fail loudly.
 *
 * Comparing SOURCE TEXT rather than behaviour is deliberate: behavioural parity
 * is exactly what a subtly-drifted copy would still satisfy for the inputs a
 * test happens to pick (a compare that stopped being constant-time still
 * returns the right booleans). The question here is "are these still the same
 * function", and only the text answers it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* Extract a top-level `function <name>(…) { … }` by brace matching. Returns
   null when absent, so a renamed function fails as "missing" rather than
   silently comparing two nulls as equal. */
function body(text, name) {
  const start = text.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Whitespace only — comments are NOT stripped, so a copy whose reasoning has
// been edited away also reddens. That is intended: the comment on these is the
// explanation of why the compare is timing-safe.
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const SHARED = [
  { fn: 'safeEqual', files: ['lib/auth.js', 'lib/admin.js', 'lib/accounts.js'] },
  { fn: 'mintToken', files: ['lib/auth.js', 'lib/admin.js'] },
  { fn: 'verifyToken', files: ['lib/auth.js', 'lib/admin.js'] },
  { fn: 'readCookie', files: ['lib/auth.js', 'lib/admin.js'] },
];

test('the duplicated signed-token primitives are still byte-identical', () => {
  for (const { fn, files } of SHARED) {
    const bodies = files.map((f) => [f, body(src(f), fn)]);

    for (const [file, b] of bodies) {
      assert.ok(b, `${fn} is missing from ${file} — if it moved, update this spec with it`);
    }

    const [[refFile, ref], ...rest] = bodies;
    for (const [file, b] of rest) {
      assert.equal(
        norm(b), norm(ref),
        `${fn} has drifted between ${refFile} and ${file}. These are copies of one `
        + 'primitive; a fix to one must be applied to all, or consolidate them into a '
        + 'shared module (see the header of this file).',
      );
    }
  }
});

test('accounts.js readCookie is deliberately NOT one of them', () => {
  /* The anti-vacuous half. Without this, the list above could be trimmed to a
     single file per entry — or to entries that happen to agree — and the test
     would keep passing while guarding nothing. accounts.js has its own
     readCookie that genuinely differs, so this pins that the comparison is
     capable of telling two implementations apart at all. */
  const a = body(src('lib/auth.js'), 'readCookie');
  const c = body(src('lib/accounts.js'), 'readCookie');
  assert.ok(a && c, 'both readCookie implementations should exist');
  assert.notEqual(
    norm(a), norm(c),
    'lib/accounts.js readCookie now matches lib/auth.js — if that is intended, move it '
    + 'into the SHARED list above so it is held there',
  );
});
