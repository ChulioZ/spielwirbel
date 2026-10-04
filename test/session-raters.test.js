'use strict';

/* Removing a person from a session (#1538) splits its readers in two: the
 * SESSION's own numbers drop the person, while the SHELF keeps counting what
 * they had rated. `sessionRaters` is that second set, and the only thing keeping
 * it apart from `sessionPeople` at the shelf sites is that they call it — so the
 * red for this spec was taken by switching `rawGameStats` back to
 * `sessionPeople` (`.claude/rules/break-the-code-on-purpose.md`, route 2). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sessionRaters, sessionPeople } = require('../public/js/session-people');
const { loadApp } = require('./support/dom');

function roundFixture() {
  return {
    id: 'r1', name: 'R', background: null, tags: [], providers: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [{ id: 'g1', title: 'Catan', image: null, tagIds: [] }],
    sessions: [{
      id: 's1', createdAt: '2026-06-01T19:00:00.000Z', finished: true, done: true,
      gameIds: ['g1'], chosenGameId: 'g1', winnerIds: [],
      memberIds: ['m1'],
      guests: [],
      removedPeople: [{ id: 'm2' }, { id: 'gu1', guest: true, name: 'Dora' }],
      votes: { m1: { g1: { rating: 5 } }, m2: { g1: { rating: 1 } }, gu1: { g1: { rating: 3 } } },
    }],
  };
}

test('sessionRaters adds the removed people back, sessionPeople does not', () => {
  const round = roundFixture();
  const s = round.sessions[0];
  assert.deepEqual(sessionPeople(round, s).map((p) => p.id), ['m1']);
  assert.deepEqual(sessionRaters(round, s), [
    { id: 'm1', name: 'Anna', guest: false },
    { id: 'm2', name: 'Ben', guest: false },
    { id: 'gu1', name: 'Dora', guest: true },
  ]);
  // A removed member deleted from the round since resolves to nothing, like in
  // sessionPeople; and no removedPeople key means none.
  assert.deepEqual(sessionRaters({ ...round, members: [round.members[0]] }, s).map((p) => p.id), ['m1', 'gu1']);
  assert.deepEqual(sessionRaters(round, { ...s, removedPeople: undefined }).map((p) => p.id), ['m1']);
});

test('a removed person\'s rating counts on the shelf but not in the session', async (t_) => {
  const dom = loadApp();
  t_.after(() => dom.close());
  const round = roundFixture();
  const inSession = await dom.call('gameStatsForSession', round, round.sessions[0], 'g1');
  assert.equal(inSession.count, 1, 'the session itself only counts Anna');
  const shelf = await dom.call('rawGameStats', round, 'g1');
  assert.equal(shelf.count, 3, 'the shelf still counts Ben and Dora');
  const raters = await dom.call('gameRaters', round, 'g1');
  assert.deepEqual([...raters.map((r) => r.person.name)].sort(), ['Anna', 'Ben', 'Dora']);
  assert.equal(raters.find((r) => r.person.id === 'gu1').person.guest, true);
});
