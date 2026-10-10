'use strict';

/* Two sessions logged for the SAME past day list the later-entered one on top
   (#1622). „Session nachtragen" (#1616) stores every session for a given day
   at 20:00 local, so those two carry one identical `createdAt`. The Chronik
   sorted its entries with a descending comparator, and a stable sort keeps a
   tie in its ascending insertion order — so the session entered FIRST sat on
   top, the opposite of two sessions on different days.

   Runs the real view in every selectable design, because each design renders
   the Chronik with its own card markup, and all of them must order alike. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { selectableDesignIds } = require('../public/js/designs');

const DAY = '2026-03-14T19:00:00.000Z';
const round = {
  id: 7,
  name: 'Runde',
  members: [{ id: 1, name: 'Anna' }],
  games: [{ id: 10, title: 'Azul' }, { id: 11, title: 'Carcassonne' }, { id: 12, title: 'Dixit' }],
  // The repo's order: chronological, insertion order on a tie.
  sessions: [
    { id: 'older', done: true, finished: true, createdAt: '2026-03-01T19:00:00.000Z', gameIds: [12], chosenGameId: 12, winnerIds: [1], votes: {} },
    { id: 'first', done: true, finished: true, createdAt: DAY, gameIds: [10], chosenGameId: 10, winnerIds: [1], votes: {} },
    { id: 'second', done: true, finished: true, createdAt: DAY, gameIds: [11], chosenGameId: 11, winnerIds: [1], votes: {} },
  ],
};

const designs = selectableDesignIds({ production: false });

test('the design list is not empty, so the loop below tests something', () => {
  assert.ok(designs.includes('klassisch') && designs.length >= 3, designs.join(','));
});

for (const design of designs) {
  test(`${design}: of two sessions on one day, the later-entered is listed first`, (t) => {
    const dom = loadApp({ locale: 'de', design });
    t.after(() => dom.close());
    dom.call('renderChronikTab', round, []);
    const titles = [...dom.app.querySelectorAll('.session-card')]
      .map((c) => c.textContent)
      .map((text) => ['Carcassonne', 'Azul', 'Dixit'].find((g) => text.includes(g)));
    assert.deepEqual(titles, ['Carcassonne', 'Azul', 'Dixit']);
  });
}
