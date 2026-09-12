'use strict';

/* The results screen's second chip row (#1038), rendered for real through the
   jsdom harness (.claude/rules/testing-views-under-jsdom.md).

   What is under test is the EXCLUSIVITY as the user experiences it: the party
   chips and the ending chips answer one question, so exactly one of the two rows
   may show a selection. That is enforced by the route, and the screen re-renders
   from what the route returned — so the fake `api` here answers the way the real
   one does, and an assertion about the screen is therefore also an assertion
   that the screen trusts the server rather than its own optimism. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

const ME = 'user-me';

function fixture(sessionOver = {}) {
  const session = {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1'],
    memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 5 } }, m2: { g1: { rating: 4 } } },
    votedIds: ['m1', 'm2'],
    done: true,
    cancelled: false,
    finished: true,
    winnerIds: [],
    chosenGameId: 'g1',
    ...sessionOver,
  };
  const round = {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }],
    games: [{ id: 'g1', title: 'Pandemie', minPlayers: 1, maxPlayers: 8 }],
    sessions: [session],
  };
  return { round, session };
}

// The POST the chips make, recorded — and answered the way the real route does,
// including the clearing rule, so the screen is exercised against the real
// contract rather than against a stub that agrees with it.
async function results(t, sessionOver = {}) {
  const { round, session } = fixture(sessionOver);
  const dom = loadApp();
  t.after(() => dom.close());
  const sent = [];
  dom.set('api', async (method, path, body) => {
    if (method !== 'POST' || !/\/finish$/.test(path)) return round;
    sent.push(JSON.parse(JSON.stringify(body)));
    const winnerIds = body.winnerIds || [];
    const ending = body.ending && !winnerIds.length ? body.ending : undefined;
    const saved = { ...session, finished: body.finished !== false, winnerIds, finishedAt: 'x' };
    if (ending) saved.ending = ending; else delete saved.ending;
    return saved;
  });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showResults', round, session);
  return { dom, sent };
}

const rows = (dom) => [...dom.app.querySelectorAll('.winner-chips')];
const selected = (row) => [...row.querySelectorAll('.winner-chip.is-selected')];

test('a finished session offers the three endings under the party chips', async (t) => {
  const { dom } = await results(t);
  const [parties, endings] = rows(dom);
  assert.ok(parties && endings, 'both chip rows render');
  assert.equal(endings.querySelectorAll('.winner-chip').length, 3);
  const labels = [...endings.querySelectorAll('.winner-chip')].map((c) => c.textContent.trim());
  assert.deepEqual(labels, ['Verloren', 'Kein Sieger', 'Fortsetzung folgt']);
  // The icons come from the shared map, so a site cannot invent its own.
  assert.deepEqual(
    [...endings.querySelectorAll('.winner-chip i')].map((i) => i.className),
    ['ti ti-skull', 'ti ti-scale', 'ti ti-player-track-next'],
  );
  assert.equal(selected(endings).length, 0, 'nothing recorded yet');
});

test('an unfinished session offers no endings at all', async (t) => {
  // Finishing comes first and needs no winners (#254); the endings belong to the
  // same later step the winner chips do.
  const { dom } = await results(t, { finished: false });
  assert.equal(rows(dom).length, 0);
});

test('tapping an ending selects it, sends it, and titles the screen with it', async (t) => {
  const { dom, sent } = await results(t);
  const endings = rows(dom)[1];
  endings.querySelectorAll('.winner-chip')[0].click();
  await flush();

  assert.deepEqual(sent, [{ finished: true, winnerIds: [], ending: 'lost' }]);
  assert.deepEqual(selected(rows(dom)[1]).map((c) => c.textContent.trim()), ['Verloren']);
  assert.equal(
    dom.app.querySelector('.result-title').textContent,
    '„Pandemie“ wurde gespielt – und hat gewonnen.',
  );
  assert.match(dom.app.querySelector('.winner-result').textContent, /Verloren – das Spiel hat gewonnen/);
});

test('tapping the selected ending again returns to unrecorded', async (t) => {
  const { dom, sent } = await results(t, { ending: 'noWinner' });
  assert.deepEqual(selected(rows(dom)[1]).map((c) => c.textContent.trim()), ['Kein Sieger']);

  rows(dom)[1].querySelectorAll('.winner-chip')[1].click();
  await flush();
  assert.deepEqual(sent, [{ finished: true, winnerIds: [] }], 'no ending field at all');
  assert.equal(selected(rows(dom)[1]).length, 0);
  assert.equal(dom.app.querySelector('.result-title').textContent, '„Pandemie“ wurde gespielt.');
});

test('a winner and an ending are never selected at the same time', async (t) => {
  // The whole invariant, seen from the screen: recording a winner must drop the
  // ending WITHOUT the client sending a second field, and vice versa.
  const { dom, sent } = await results(t, { ending: 'lost' });
  rows(dom)[0].querySelectorAll('.winner-chip')[0].click();
  await flush();

  assert.deepEqual(sent[0], { finished: true, winnerIds: ['m1'] });
  assert.equal(selected(rows(dom)[1]).length, 0, 'the ending chip deselected itself');
  assert.equal(selected(rows(dom)[0]).length, 1);

  rows(dom)[1].querySelectorAll('.winner-chip')[2].click();
  await flush();
  assert.deepEqual(selected(rows(dom)[1]).map((c) => c.textContent.trim()), ['Fortsetzung folgt']);
  assert.equal(selected(rows(dom)[0]).length, 0, 'and the party chip deselected itself');
});

test('Reset clears the ending along with everything else', async (t) => {
  const { dom } = await results(t, { ending: 'ongoing' });
  [...dom.app.querySelectorAll('button')].find((b) => /Zurücksetzen/.test(b.textContent)).click();
  await flush();
  assert.equal(rows(dom).length, 0, 'back to the un-finished state');
});
