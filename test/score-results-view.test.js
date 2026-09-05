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

// One vote per game from a single member, stored the way the vote card writes
// it: `{ rating }` and nothing else (#909).
const session = (id, ratings, over = {}) => ({
  id,
  createdAt: '2026-09-01T18:00:00.000Z',
  gameIds: Object.keys(ratings),
  memberIds: ['m1'],
  guests: [],
  votes: {
    m1: Object.fromEntries(Object.entries(ratings).map(([g, r]) => [g, { rating: r }])),
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
  // `null` when the element is absent, which is a different statement from an
  // empty string and is what the zero-vote row asserts.
  label: row.querySelector('.score-label') && row.querySelector('.score-label').textContent.trim(),
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
  // #902 moved it off the page head, where it hung on the date line and read
  // as an annotation on „3. September" rather than on the scores.
  assert.equal(
    dom.app.querySelector('.page-head .score-info'), null,
    'and not in the page head either — it belongs beside the numbers'
  );
  const rows = [...dom.app.querySelectorAll('.result-row')];
  assert.equal(
    rows[0].querySelectorAll('.score-label .score-info').length, 1,
    'it rides the FIRST result row\'s label — the highest-scoring game'
  );
});

test('the row names the score instead of counting the votes', async (t) => {
  const dom = await show(t, session('s1', { g1: 5, g2: 4, g3: 3 }));

  assert.deepEqual(
    rowsOf(dom).map((r) => r.label.replace(/\s+/g, ' ')),
    ['Spielwirbel-Score', 'Spielwirbel-Score', 'Spielwirbel-Score'],
    'every scored row names the number under it'
  );
  // The label it replaced printed `n = ratings.length`, which is the same on
  // every row of a session — the vote card will not advance until each drawn
  // game is somewhere on the scale — so it said nothing three times over.
  assert.doesNotMatch(
    dom.app.textContent, /Score aus/,
    'no row states a vote count any more'
  );
});

test('a game nobody voted on gets no label at all, not an empty one', async (t) => {
  // g3 is in the session but carries no vote: `–` stands alone, because there
  // is no score there to name. This is the branch most likely to throw.
  const s = session('s1', { g1: 5, g2: 4 }, { gameIds: ['g1', 'g2', 'g3'] });
  const dom = await show(t, s);
  const by = Object.fromEntries(rowsOf(dom).map((r) => [r.title, r]));

  assert.equal(by.Splendor.score, '–', 'the unvoted game shows the dash');
  assert.equal(by.Splendor.label, null, 'no element, not an empty element');
  assert.equal(by.Catan.label, 'Spielwirbel-Score', 'while the voted rows are labelled');
});

test('a session nobody voted in renders no ⓘ and does not throw', async (t) => {
  const s = session('s1', {}, {
    gameIds: ['g1', 'g2'],
    votes: {},
    votedIds: [],
    winnerIds: [],
    chosenGameId: null,
  });
  const dom = await show(t, s);

  assert.equal(dom.app.querySelectorAll('.result-row').length, 2, 'the rows still render');
  assert.equal(dom.app.querySelectorAll('.score-label').length, 0, 'nothing to name');
  // Correct rather than a miss: with no number on screen there is nothing for
  // the sheet to explain. The point of the assertion is that the empty case is
  // a deliberate branch and not a crash on rows[0].
  assert.equal(dom.app.querySelectorAll('.score-info').length, 0, 'and therefore no ⓘ');
});

test('the score, not the mean, ranks the rows', async (t) => {
  // A lone „gar nicht" against a clean 3 and a clean 5. On the raw mean the 1
  // and the 3 are just one apart; on the curve the veto is worth -5, so it
  // sorts last by a wide margin. This is the ordering the whole of #893 is
  // about, asserted where a user would see it.
  const dom = await show(t, session('s1', { g1: 1, g2: 3, g3: 5 }));
  const rows = rowsOf(dom);
  assert.deepEqual(rows.map((r) => r.title), ['Splendor', 'Azul', 'Catan']);
  assert.equal(rows[2].score, '0,0', 'a lone veto is negative, so it prints the floored 0,0');
});

test('the reason line appears only where there IS something to say', async (t) => {
  const dom = await show(t, session('s1', { g1: 2, g2: 1, g3: 4 }));
  const by = Object.fromEntries(rowsOf(dom).map((r) => [r.title, r]));

  // The veto clause is the whole of the reason line since #909 removed the
  // „1× aussortieren" sentence that used to sit beside it.
  assert.equal(by.Azul.why, '1× gar nicht', 'the 1 phrases the reason');
  assert.equal(by.Catan.why, null, 'a 2 diverges from its mean but has no sentence of its own');
  // The common case, and the one that is invisible when it regresses: a game
  // nobody rated below 3 scores its plain average, so there is nothing to
  // explain and NO element at all — not an empty one.
  assert.equal(by.Splendor.why, null, 'no element, not an empty element');
  assert.equal(by.Splendor.score, '4,0', 'and its score is the familiar number');
});
