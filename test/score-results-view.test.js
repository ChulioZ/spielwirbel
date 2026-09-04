'use strict';

/* The Spielwirbel-Score on the session results screen (#893).
 *
 * The unit arithmetic lives in test/vote-score.test.js; this is the CALL SITE
 * under jsdom — what the screen actually renders, which is where two of this
 * feature's failures can only be seen:
 *
 *  - the ⓘ placement. It was first written inside the results <h1>, which
 *    LOOKS right and passes every unit test, but `showResults` rewrites that
 *    heading with `titleEl.textContent = …` once the outcome is known (the
 *    winner sentence, „gespielt", „abgebrochen"). textContent replaces
 *    children, so the button was silently deleted on every real session and
 *    survived only in the momentary pre-outcome state nothing renders. Caught
 *    in a browser, not by a test, which is why there is now a test.
 *  - the reason line's ABSENCE. „nothing to say" is the common case, and a
 *    line that renders empty markup instead of no markup is invisible until
 *    someone looks at the spacing.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

// One vote per game from a single member. `null` means the retirement tile:
// the zero of the scale, stored the way the vote card writes it (#797).
const session = (id, ratings, over = {}) => ({
  id,
  createdAt: '2026-09-01T18:00:00.000Z',
  gameIds: Object.keys(ratings),
  memberIds: ['m1'],
  guests: [],
  votes: {
    m1: Object.fromEntries(Object.entries(ratings).map(([g, r]) =>
      [g, r === null ? { retire: true } : { rating: r, retire: false }])),
  },
  votedIds: ['m1'],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: ['m1'],
  chosenGameId: Object.keys(ratings)[0],
  events: [],
  ...over,
});

const round = (over = {}) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }],
  games: [
    { id: 'g1', title: 'Catan', tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
    { id: 'g3', title: 'Splendor', tagIds: [] },
  ],
  sessions: [],
  ...over,
});

const show = async (t, s) => {
  const r = round({ sessions: [s] });
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return r;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showResults', r, s, r.games, false);
  return dom;
};

const rowsOf = (dom) => [...dom.app.querySelectorAll('.result-row')].map((row) => ({
  title: row.querySelector('.result-row__title').textContent.trim(),
  score: row.querySelector('.score-big').textContent.trim(),
  why: row.querySelector('.score-why') && row.querySelector('.score-why').textContent.trim(),
}));

test('the ⓘ survives the heading rewrite that states the outcome', async (t) => {
  const dom = await show(t, session('s1', { g1: 5, g2: 4, g3: 3 }));

  // The precondition — without it the assertion below would pass against a
  // screen that simply never rewrites the title, i.e. against the wrong bug.
  assert.match(
    dom.app.querySelector('.result-title').textContent,
    /gespielt|gewonnen/,
    'this session must actually have an outcome, or the rewrite never runs'
  );
  assert.equal(dom.app.querySelectorAll('.score-info').length, 1, 'exactly one ⓘ, and it still exists');
  assert.equal(
    dom.app.querySelector('.result-title .score-info'), null,
    'it must NOT live inside the <h1> — textContent there deletes it'
  );
});

test('the score, not the mean, ranks the rows', async (t) => {
  // {5,4,0} vs a clean 3: the vetoed game's raw mean is 3.0, the same as the
  // game nobody objects to, so under the old arithmetic these were tied and
  // shelf order decided. This is the ordering flip the whole issue is about,
  // asserted where a user would see it.
  const dom = await show(t, session('s1', { g1: null, g2: 3, g3: 5 }));
  const rows = rowsOf(dom);
  assert.deepEqual(rows.map((r) => r.title), ['Splendor', 'Azul', 'Catan']);
  assert.equal(rows[2].score, '0,0', 'a lone retirement proposal is floored at the displayed 0,0');
});

test('the reason line appears only where there IS something to say', async (t) => {
  const dom = await show(t, session('s1', { g1: null, g2: 1, g3: 4 }));
  const by = Object.fromEntries(rowsOf(dom).map((r) => [r.title, r]));

  assert.equal(by.Catan.why, '1× aussortieren', 'the trash tile phrases its own sentence');
  assert.equal(by.Azul.why, '1× gar nicht', 'and the 1 phrases a different one');
  // The common case, and the one that is invisible when it regresses: a game
  // nobody rated below 3 scores its plain average, so there is nothing to
  // explain and NO element at all — not an empty one.
  assert.equal(by.Splendor.why, null, 'no element, not an empty element');
  assert.equal(by.Splendor.score, '4,0', 'and its score is the familiar number');
});
