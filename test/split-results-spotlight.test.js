'use strict';

/* The finished split's results screen: one SPOTLIGHT per table (#957).

   Its sibling — the single-table results screen — opens with a winner
   spotlight, and this screen answered the same question (what was played, and
   by whom) with a flat list row. The recomposition reuses that component, so
   what is asserted here is what the screen BUILDS: the jsdom harness runs the
   real view (.claude/rules/testing-views-under-jsdom.md), because a regex over
   the view's source would only restate the source.

   The sharpest assertion is the score pill. It has to be the number the split
   was chosen on — the seated people's votes, weighed through the tile curve —
   and three plausible wrong implementations each print a different value, so
   one literal discriminates all of them. See the test for the arithmetic. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const MEMBERS = ['Anna', 'Ben', 'Dana', 'Eli', 'Frida', 'Georg'].map((name, i) => ({ id: 'm' + i, name }));
const GAMES = [{ id: 'g1', title: 'Catan' }, { id: 'g2', title: 'Azul' }];

/* Table 1 seats m0/m1/m2 and played g1. Their tiles are 1, 4 and 3
   (TILE_VALUE[2], [4], [3]), so the table's score is 8/3 = 2,7 — and each wrong
   source of ratings prints something else:

     raw mean of 2/4/3, no curve ........ 3,0
     everybody's votes, not the seated .. 3,2   (m3's 5 on g1 is there for this)
     the CHILD's own votes (always {}) ... 3,0   (every seat NEUTRAL_RATING) */
const VOTES = {
  m0: { g1: { rating: 2 } },
  m1: { g1: { rating: 4 } },
  m2: { g1: { rating: 3 } },
  m3: { g1: { rating: 5 } },
};

const parent = {
  id: 'p1',
  createdAt: '2026-08-20T18:00:00.000Z',
  memberIds: MEMBERS.map((m) => m.id),
  gameIds: ['g1', 'g2'],
  votes: VOTES,
  multiTable: true,
  done: true,
  finished: false,
  cancelled: false,
  chosenGameId: null,
  winnerIds: [],
  childSessionIds: ['c1', 'c2'],
};

const child = (id, gameId, memberIds, over = {}) => ({
  id,
  createdAt: '2026-08-20T18:01:00.000Z',
  memberIds,
  gameIds: [gameId],
  votes: {},
  done: true,
  finished: false,
  cancelled: false,
  chosenGameId: gameId,
  parentSessionId: 'p1',
  winnerIds: [],
  ...over,
});

const PLAYED = child('c1', 'g1', ['m0', 'm1', 'm2'], { finished: true, winnerIds: ['m0'] });
const OPEN = child('c2', 'g2', ['m3', 'm4', 'm5']);

const round = (sessions) => ({
  id: 7,
  name: 'Donnerstagsrunde',
  members: MEMBERS,
  games: GAMES,
  sessions,
  tags: [],
});

async function summary(t, children) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('roundCan', () => false);
  await dom.call('showTableBuilder', round([parent, ...children]), parent);
  return dom;
}

test('each table gets a spotlight card, not a flat list row', async (t) => {
  const dom = await summary(t, [PLAYED, OPEN]);

  const grid = dom.app.querySelector('.split-tables');
  assert.ok(grid, 'the tables are laid out as their own card flow');
  const cards = [...grid.querySelectorAll('.spotlight--table')];
  assert.equal(cards.length, 2, 'one spotlight per table');
  // The component it reuses, part for part — U-008 is the whole point of the
  // change, so a card built out of look-alike markup is a regression.
  cards.forEach((card) => {
    assert.ok(card.querySelector('.spotlight__kicker'), 'kicker');
    assert.ok(card.querySelector('.spotlight__winner .spotlight__img'), 'cover hero');
    assert.ok(card.querySelector('.spotlight__winner .spotlight__title'), 'title');
    assert.ok(card.querySelector('.spotlight__seats .spotlight__seat'), 'seats');
  });
  assert.equal(dom.app.querySelectorAll('.tables-card').length, 0, 'no card is left on the old component');

  // Each card is still the link to that table's own results — the recomposition
  // is visual (#957 scope), it does not re-point anything.
  assert.equal(cards[0].getAttribute('href'), '/round/7/session/c1');
  assert.equal(cards[1].getAttribute('href'), '/round/7/session/c2');
  assert.equal(cards[0].querySelector('.spotlight__title').textContent.trim(), 'Catan');
  assert.equal(cards[1].querySelector('.spotlight__title').textContent.trim(), 'Azul');
});

test('the played table is scored on its OWN seats, through the tile curve', async (t) => {
  const dom = await summary(t, [PLAYED, OPEN]);
  const played = dom.app.querySelectorAll('.spotlight--table')[0];

  const pill = played.querySelector('.spotlight__pill');
  assert.ok(pill, 'a played table carries the score pill');
  // 1 + 4 + 3 over three seats. Measured against each wrong source in turn: the
  // raw mean and the child's own (empty) votes both print 3,0, everybody's
  // votes print 3,2. All four values are distinct from this one.
  assert.equal(pill.textContent.trim(), '2,7');
});

test('an unplayed table wears the same card without the celebration', async (t) => {
  const dom = await summary(t, [PLAYED, OPEN]);
  const [played, open] = dom.app.querySelectorAll('.spotlight--table');

  // The anti-vacuous half: `is-off` has to be a decision about the table, not a
  // class every card happens to carry.
  assert.equal(played.classList.contains('is-off'), false);
  assert.equal(open.classList.contains('is-off'), true);

  assert.equal(open.querySelector('.spotlight__pill'), null, 'no score for an evening nobody has played');
  assert.match(played.querySelector('.spotlight__state').textContent, /Gespielt/);
  assert.match(open.querySelector('.spotlight__state').textContent, /Läuft noch/);
  assert.equal(played.querySelector('.spotlight__kicker i').className, 'ti ti-crown spotlight__crown');
  assert.equal(open.querySelector('.spotlight__kicker i').className, 'ti ti-hourglass spotlight__crown');
});

test('a cancelled table is its own state, not folded into „unplayed"', async (t) => {
  const off = child('c2', 'g2', ['m3', 'm4', 'm5'], { cancelled: true });
  const dom = await summary(t, [PLAYED, off]);
  const card = dom.app.querySelectorAll('.spotlight--table')[1];

  assert.equal(card.classList.contains('is-off'), true);
  assert.match(card.querySelector('.spotlight__state').textContent, /Abgebrochen/);
  assert.equal(card.querySelector('.spotlight__kicker i').className, 'ti ti-ban spotlight__crown');
});

test('every seat is named, not only coloured', async (t) => {
  const dom = await summary(t, [PLAYED, OPEN]);
  const seats = [...dom.app.querySelectorAll('.spotlight--table')[0].querySelectorAll('.spotlight__seat')];

  assert.equal(seats.length, 3);
  // An avatar alone would drop every participant's name out of the accessible
  // name of the only link to that table.
  assert.deepEqual(seats.map((s) => s.querySelector('.spotlight__seat-name').textContent), ['Anna', 'Ben', 'Dana']);
  assert.equal(seats.filter((s) => s.querySelector('.avatar')).length, 3);
});

test('the tables are numbered in the order the split made them', async (t) => {
  const dom = await summary(t, [PLAYED, OPEN]);
  const kickers = [...dom.app.querySelectorAll('.spotlight__kicker')].map((k) => k.textContent.trim());
  assert.deepEqual(kickers, ['Tisch 1', 'Tisch 2']);
});
