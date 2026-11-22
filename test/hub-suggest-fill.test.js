'use strict';

/* The „Wie wär's mit" card's FILL (#1683, hub-fill.js): the runner-ups a
   stretched tile may show beyond its base rows. Split out of the old
   hub-previews spec when #1853 took the three previews off the Start tab — the
   suggestion card is the fill's one remaining user. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const game = (id, extra = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, image: 'c.jpg',
  createdAt: '2026-01-0' + (id % 9 + 1) + 'T10:00:00.000Z', ...extra,
});
const play = (id, gid, when, winnerIds = ['m1'], memberIds = ['m1', 'm2', 'm3']) => ({
  id, createdAt: when, done: true, finished: true,
  gameIds: [gid], chosenGameId: gid, winnerIds, memberIds,
  votes: { m1: { [gid]: { rating: 5 } }, m2: { [gid]: { rating: 4 } } },
});

/* Eight on the shelf, three off it (one per archive), and four evenings arranged
   so the STANDINGS ORDER AND THE RAW WIN COUNT DISAGREE.

   That is not incidental. Anna wins three solo evenings and Ben wins the one
   two-handed evening, so Anna has 3 wins to Ben's 1 while the Siegwertung — which
   weights a win by the field it beat, and scores a solo night exactly 0 (#895) —
   puts Ben at +0.5 and Anna at −0.5. Measured: with the preview re-sorting by
   raw win count, the ranking assertion goes red. Under a fixture where the two
   measures happen to agree it stayed green five runs out of five, which is the
   fixture-too-small-to-fail case in
   `.claude/rules/break-the-code-on-purpose.md` — the whole point of that
   assertion is that the preview must not be a second derivation, and only a
   fixture where the derivations differ can see it. */
const busyRound = (over = {}) => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cem' }],
  games: [
    ...Array.from({ length: 8 }, (_, i) => game(10 + i)),
    game(30, { retired: true, retiredAt: '2026-02-01T10:00:00.000Z' }),
    game(31, { completed: true, completedAt: '2026-02-02T10:00:00.000Z' }),
    game(32, { wish: true, wishAt: '2026-02-03T10:00:00.000Z' }),
  ],
  /* Anna 3, Ben 1, Cem 1 — a TIE for second, which is what makes the ranking
     assertion discriminating. Tie-aware places run 1, 2, 2 while a naive
     index+1 runs 1, 2, 3, so a preview that numbers its own rows instead of
     reading `rankOf` is visible. Measured: without the tie the two agree and
     the assertion passes against either. */
  sessions: [
    play(900, 10, '2026-03-01T18:00:00.000Z', ['m1']),
    play(901, 11, '2026-04-01T18:00:00.000Z', ['m1']),
    play(903, 13, '2026-04-15T18:00:00.000Z', ['m1']),
    play(902, 12, '2026-05-02T18:00:00.000Z', ['m2']),
    play(904, 14, '2026-05-03T18:00:00.000Z', ['m3']),
  ],
  tags: [],
  ...over,
});

const activeOf = (r) => r.games.filter((g) => !g.retired && !g.completed && !g.wish);


function hub(t, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => ({ recommendations: [] }));
  dom.call('renderStartTab', round, activeOf(round));
  return dom;
}

const fillOf = (card) => card.querySelector('.hub-card__body > .hub-fill');

test('the fill is OFF in the base stylesheet and switched on only by a stretched design', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { rulesOf, topLevel } = require('./support/css');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const base = rulesOf(topLevel()).find(([sel]) => sel.trim() === '.hub-fill');
  assert.ok(base && /display:\s*none/.test(base[1]), 'styles.css must keep .hub-fill off by default');
  // A hidden item must really be gone: `.hub-row` is flex and a session row is
  // grid, and any author `display` beats the bare `hidden` attribute — measured
  // in Chrome, the clipped suggestion links stayed focusable without this.
  const gone = rulesOf(topLevel()).find(([sel]) => sel.trim() === '.hub-fill > [hidden]');
  assert.ok(gone && /display:\s*none\s*!important/.test(gone[1]), 'a hidden fill item can still render');
  const designs = fs.readdirSync(path.join(__dirname, '..', 'public/css/designs'));
  const on = designs.filter((f) => /\.hub-fill\b/.test(read('public/css/designs/' + f).replace(/\/\*[\s\S]*?\*\//g, '')));
  // Der Tisch is the design whose hub grid stretches its tiles (#1496). A new
  // entry here is a design claiming spare height — measure it first.
  assert.deepEqual(on, ['tisch.css']);
});

test('„Wie wär\'s mit" keeps its base rows and adds the runner-ups as a hidden fill, every row with a cover thumb', (t) => {
  const r = busyRound();
  const dom = hub(t, r);
  const card = [...dom.app.querySelectorAll('.hub-card')].find(
    (c) => c.querySelector('.hub-card__title').textContent.trim() === dom.run("t('hub.suggest.title')"));
  assert.ok(card, 'no suggestion card on this fixture');
  const base = [...card.querySelectorAll('.hub-card__body > a.hub-row')];
  const fill = [...fillOf(card).querySelectorAll(':scope > a.hub-row')];
  assert.ok(base.length >= 1 && base.length <= 3, `today's card holds one to three rows, got ${base.length}`);
  assert.ok(fill.length >= 1, 'the fill offered no runner-up on a shelf that has them');
  assert.ok(fill.every((row) => row.hidden) && base.every((row) => !row.hidden));
  const hrefs = [...base, ...fill].map((row) => row.getAttribute('href'));
  assert.equal(new Set(hrefs).size, hrefs.length, 'a game was suggested twice');
  assert.ok([...base, ...fill].every((row) => row.querySelector('.hub-row__cover[aria-hidden="true"]')));
});
