'use strict';

/* The vote link's path shape (#652, #1170) — the one string the client and the
 * server both BUILD.
 *
 * Its failure mode is what makes it worth its own file. Every other shared
 * constant in `.claude/rules/shared-constants-inventory.md` has a validating
 * end, so a drift surfaces as a 400 the same day. Here both ends build: a
 * server that drew `/v/<token>` would produce a code that scans perfectly and
 * opens a 404, and the only instrument that reports it is a phone in somebody's
 * hand at a real table, days later.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { votePath } = require('../public/js/vote-path');

test('a token becomes the path the SPA routes on', () => {
  assert.equal(votePath('abc123'), '/vote/abc123');
});

test('the token is encoded by the builder, not by each call site', () => {
  // base64url needs no escaping, which is exactly why this is easy to drop:
  // every real token round-trips unchanged, so only a hostile one shows it.
  assert.equal(votePath('a/b?c#d'), '/vote/a%2Fb%3Fc%23d');
});

/* The load-order half. `router.js` and `views-vote-link.js` reach for `votePath`
 * as a shared-scope global, so the file must be in index.html AHEAD of them —
 * and since #1170 a route requires the same module, which means a session
 * editing the server side never loads the page that would reveal a missing tag.
 */
test('index.html loads vote-path.js before the scripts that use it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const at = (file) => html.indexOf(`/js/${file}`);
  assert.ok(at('vote-path.js') > 0, 'vote-path.js is not loaded by index.html at all');
  for (const user of ['router.js', 'views-vote-link.js', 'views-session-live.js']) {
    assert.ok(at(user) > at('vote-path.js'), `${user} is loaded before vote-path.js`);
  }
});

test('nothing else declares votePath — one home, or the two can drift', () => {
  const dir = path.join(__dirname, '..', 'public', 'js');
  const declaring = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'vote-path.js')
    .filter((f) => /\b(const|let|var|function)\s+votePath\b/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(declaring, []);
});
