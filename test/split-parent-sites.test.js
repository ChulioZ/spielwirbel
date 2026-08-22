'use strict';

/* The sites that branch on what became of a session, met by a SPLIT parent
   (#796).

   This is the file the whole `sessionOutcome` helper exists for. Sixteen sites
   read `session.cancelled` to mean "this evening did not happen at one table",
   and a split parent is neither played nor cancelled — so every one of them
   fails *silently*: the Chronik draws it with the played icon, the hub offers to
   resume it, and the recommender learns the round routinely plays nine-handed.
   Nothing throws at any of them, which is why they are asserted here rather than
   trusted to review.

   The two view halves run through the jsdom harness
   (.claude/rules/testing-views-under-jsdom.md) — what regressed is what the
   screen renders, which no assertion over the view's source can see. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { partyDistribution } = require('../lib/recommend');

const MEMBERS = ['Anna', 'Ben', 'Dana', 'Eli', 'Frida', 'Georg'].map((name, i) => ({ id: 'm' + i, name }));
const GAMES = [{ id: 'g1', title: 'Catan' }, { id: 'g2', title: 'Azul' }];

const parent = {
  id: 'p1',
  createdAt: '2026-08-20T18:00:00.000Z',
  memberIds: MEMBERS.map((m) => m.id),
  gameIds: ['g1', 'g2'],
  votes: {},
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
const CHILDREN = [
  child('c1', 'g1', ['m0', 'm1', 'm2']),
  child('c2', 'g2', ['m3', 'm4', 'm5']),
];

const round = (sessions) => ({
  id: 7,
  name: 'Donnerstagsrunde',
  members: MEMBERS,
  games: GAMES,
  sessions,
  tags: [],
});

/* ---- The Chronik ---- */

test('a split parent is not drawn as a played night, and its tables nest under it', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.call('renderChronikTab', round([parent, ...CHILDREN]), []);

  // One top-level card — the parent — with its two tables nested beneath it,
  // rather than three cards at the same minute.
  const items = [...dom.app.querySelectorAll('.timeline .tl-item')];
  assert.equal(items.length, 1);
  assert.equal(items[0].querySelectorAll('.tl-nest .session-card').length, 2);

  const card = items[0].querySelector('.session-card');
  assert.match(card.querySelector('.session-card__meta').textContent, /Aufgeteilt/);
  // `ti-cards` is the icon a done-but-unresolved session gets, i.e. what a split
  // parent rendered as before the outcome helper.
  const icon = card.querySelector('.session-card__img i');
  assert.equal(icon.className, 'ti ti-layout-grid');
});

test('an ordinary session is untouched by any of it', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const played = child('s9', 'g1', ['m0'], { finished: true, parentSessionId: undefined, winnerIds: ['m0'] });
  dom.call('renderChronikTab', round([played]), []);
  const card = dom.app.querySelector('.timeline .session-card');
  assert.match(card.textContent, /Catan/);
  assert.equal(dom.app.querySelectorAll('.tl-nest').length, 0);
});

test('a table whose parent was deleted stands on its own again', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Stored `parentSessionId`s dangle — the parent can be deleted — so the
  // grouping resolves the parent rather than trusting the key.
  dom.call('renderChronikTab', round(CHILDREN), []);
  assert.equal(dom.app.querySelectorAll('.timeline .tl-item').length, 2);
  assert.equal(dom.app.querySelectorAll('.tl-nest').length, 0);
});

/* ---- The round hub ---- */

async function hub(t, sessions) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const r = round(sessions);
  dom.set('api', async (method, url) => (/\/activities$/.test(url) ? [] : r));
  dom.set('roundCan', () => true);
  await dom.call('showRound', 7, 'start');
  return dom;
}

test('the hub offers no resume for a split parent, and groups its tables', async (t) => {
  const dom = await hub(t, [parent, ...CHILDREN]);
  const tickets = [...dom.app.querySelectorAll('.ticket--live')];
  // Two tickets — the tables — and neither of them the parent. Without the
  // outcome check the parent is `done && !finished && !cancelled`, so it would be
  // offered as a third "resume where you left off".
  assert.equal(tickets.length, 2);
  const group = dom.app.querySelector('.split-group');
  assert.ok(group, 'the two tables are one evening, not two');
  assert.equal(group.querySelectorAll('.ticket--live').length, 2);
  assert.equal(group.querySelector('.split-group__head').getAttribute('href'), '/round/7/session/p1');
});

test('an unparented in-progress session keeps its own ticket', async (t) => {
  const dom = await hub(t, [child('s9', 'g1', ['m0'], { parentSessionId: undefined })]);
  assert.equal(dom.app.querySelectorAll('.ticket--live').length, 1);
  assert.equal(dom.app.querySelectorAll('.split-group').length, 0);
});

/* ---- The recommender ---- */

test('a split parent does not teach the recommender a party size nobody played', () => {
  // Its children each seated three; the parent held all six but nobody ever
  // played a six-handed game.
  const both = partyDistribution(round([parent, ...CHILDREN]));
  assert.deepEqual(both, [{ players: 3, share: 1 }]);

  // The control: without the exclusion the six shows up and takes a third of the
  // distribution.
  const asIfNotSplit = partyDistribution(round([{ ...parent, childSessionIds: [] }, ...CHILDREN]));
  assert.deepEqual(
    asIfNotSplit.map((x) => x.players).sort((a, b) => a - b),
    [3, 6]
  );
});
