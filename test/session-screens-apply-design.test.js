'use strict';

/* The session screens a URL can COLD-LOAD apply the round's design themselves.
 *
 * Every screen inside a round used to inherit its design from the hub: showRound
 * calls applyBackground() and the session flow only ever followed from there. But
 * two of the flow's screens are also reached from a bare URL — the results
 * (shared through session-share.js, opened from the Chronik on another device)
 * and the lobby (the very link a second device joins a live vote through, #209)
 * — and router.js's showResultsById resolves both without passing the hub. So
 * a shared link rendered on the Standard design: no accent, no scheme, no world.
 *
 * Found by #940, whose victory scene has to be on the spotlight a later visit
 * shows; fixed by applying the design at the top of each screen, which is
 * idempotent for the finale's path. Route 1 red: both assertions failed before
 * the two lines existed. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { WORLDS } = require('../public/js/round-designs');

const forest = WORLDS.find((w) => w.id === 'forest');
const stored = { type: 'theme', id: forest.id, page: forest.page, accent: forest.accent };

const round = (session) => ({
  id: 'r1',
  name: 'Waldläufer',
  background: stored,
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
    { id: 'g1', title: 'Catan', tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
  ],
  sessions: [session],
});

function boot(t, r) {
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
  return dom;
}

test('the results screen dresses the round, so a shared or cold-loaded results URL is themed', async (t) => {
  const s = {
    id: 's1', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1'],
    votes: { m1: { g1: { rating: 5, retire: false }, g2: { rating: 3, retire: false } } },
    votedIds: ['m1'], finished: true, cancelled: false, done: true, winnerIds: ['m1'], chosenGameId: 'g1', events: [],
  };
  const r = round(s);
  const dom = boot(t, r);
  await dom.call('showResults', r, s, r.games, false);
  const root = dom.document.documentElement;
  assert.equal(root.dataset.world, 'forest', 'the results screen must apply the round\'s design');
  assert.equal(root.style.getPropertyValue('--brand'), forest.accent);
});

test('the lobby dresses the round too — it is the link a second device arrives through', (t) => {
  const s = {
    id: 's2', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
    votes: {}, votedIds: [], finished: false, cancelled: false, done: false, events: [],
  };
  const r = round(s);
  const dom = boot(t, r);
  dom.call('showSessionLobby', r, s);
  const root = dom.document.documentElement;
  assert.equal(root.dataset.world, 'forest', 'the lobby must apply the round\'s design');
  assert.equal(root.style.getPropertyValue('--page-bg'), forest.page);
});
