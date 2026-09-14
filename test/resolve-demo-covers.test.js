'use strict';

/*
 * scripts/resolve-demo-covers.js — the one behaviour of it that is not just
 * printing: it REFUSES to print a block when nothing resolved (#953).
 *
 * Why this is worth a spec. The script's output is pasted straight back into
 * lib/demo-seed.js, and without the BGG token every row resolves to no cover and
 * no metadata — so the block becomes a well-formed ERASURE of the ~500 lines the
 * last successful run produced. Pasting it looks exactly like a refresh: the
 * seed stays valid JavaScript, `npm test` stays green (every other spec tolerates
 * a row BGG has nothing for, because it must), and the only visible consequence
 * is that the demo silently goes back to placeholder covers and a Regal that
 * offers no filters until the lazy backfill hops BGG. Nothing else in the repo
 * can see that, which is what makes the guard load-bearing rather than polite.
 *
 * The tokenless path makes no network call — bgg.detail() short-circuits to a
 * null-shaped record when there is no token — so this runs offline in ~1s.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'resolve-demo-covers.js');

// The token is deliberately stripped rather than merely left unset: a developer
// machine (or a future CI job) that exports BGG_API_TOKEN would otherwise send
// this spec to the live API, where it would resolve everything and assert the
// opposite of its own name.
const run = () => {
  const env = { ...process.env };
  delete env.BGG_API_TOKEN;
  return spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8', env });
};

test('a run that resolves nothing refuses to print an erasing block', () => {
  const res = run();
  assert.notEqual(res.status, 0, 'a run that resolved nothing must not exit clean');
  assert.equal(res.stdout.trim(), '', 'printed a block that would erase the seed');
  assert.match(res.stderr, /Refusing to print a block/);
  // The message has to name the CAUSE, or the reader's next move is to paste the
  // (absent) block anyway rather than to go find the token.
  assert.match(res.stderr, /BGG_API_TOKEN/);
  assert.match(res.stderr, /ERASE/);
});

test('it still reports every row, so the refusal is diagnosable', () => {
  // The per-round report goes to stderr and must survive the refusal — it is how
  // you tell "no token" (every row bare) from "one game 404s" (one row bare).
  const res = run();
  const { DEMO_ROUNDS } = require('../lib/demo-seed');
  for (const round of DEMO_ROUNDS) {
    for (const game of round.games) {
      assert.ok(
        res.stderr.includes(game.title),
        `the report does not mention ${round.key}/${game.title}`
      );
    }
  }
  // Anti-vacuous: a report of nothing would satisfy an `includes` loop over an
  // empty seed, and would also satisfy it if the titles happened to appear only
  // in the refusal message.
  assert.ok(DEMO_ROUNDS.length >= 3);
  // Derived from the shared list rather than pinned at 7: the field set has been
  // widened twice (#724, #1005), and a literal here fails the whole spec over a
  // number nothing in this script decides
  // (.claude/rules/shared-constants-across-the-stack.md, applied to a test).
  const { PROVIDER_INFO_FIELDS } = require('../public/js/provider-info-fields');
  assert.match(res.stderr, new RegExp(`0/${PROVIDER_INFO_FIELDS.length} fields`),
    'the report does not state how much each row resolved');
});
