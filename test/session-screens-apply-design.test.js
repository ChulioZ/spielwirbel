'use strict';

/* The session screens a URL can COLD-LOAD apply the round's marker themselves.
 *
 * Every screen inside a round used to inherit its look from the hub: showRound
 * applied it and the session flow only ever followed from there. But
 * two of the flow's screens are also reached from a bare URL — the results
 * (shared through session-share.js, opened from the Chronik on another device)
 * and the lobby (the very link a second device joins a live vote through, #209)
 * — and router.js's showResultsById resolves both without passing the hub. So
 * a shared link rendered without the round's own look. Since the flip (#1202)
 * that look is the round's colour MARKER alone.
 *
 * Found by #940, whose victory scene has to be on the spotlight a later visit
 * shows; fixed by applying the design at the top of each screen, which is
 * idempotent for the finale's path. Route 1 red: both assertions failed before
 * the two lines existed.
 *
 * SINCE #1191 THE FILE HOLDS A SECOND CLAIM, and it is the load-bearing one for
 * every per-user design. A round that has no design of its own — which is what
 * every round becomes once #1187's colour marker replaces one, and what the
 * flip (#1202) makes universal — must land on the USER's `data-design` AND on
 * that design's SCHEME, because a design's whole component layer is gated on
 * the scheme (.claude/rules/design-colour-blocks-are-scheme-gated.md). Get that
 * wrong and nothing throws, nothing 404s and no other test moves: the screen
 * simply renders in the :root defaults, i.e. Klassisch, on a design that is
 * otherwise fully implemented. That is the failure this half exists to make
 * loud. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { LEGACY_MARKER_INDEX } = require('../public/js/round-marker');
const { designMarkers } = require('../public/js/designs');

// A round that wore Forest before the flip and never picked a marker: the
// screens must resolve the marker Forest maps to.
const stored = { type: 'theme', id: 'forest', page: '#ecf1e4', accent: '#356427' };
const forestMarker = (design) => designMarkers(design)[LEGACY_MARKER_INDEX.forest].color;

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
  assert.equal(root.style.getPropertyValue('--marker'), forestMarker('klassisch'),
    'the results screen must apply the round\'s marker');
  assert.equal(root.dataset.world, undefined, 'no world hook survives the flip');
  assert.equal(root.style.getPropertyValue('--brand'), '', 'the old world accent is not painted');
});

test('a results URL for a round with NO design of its own wears the account design', async (t) => {
  /* The #1187 shape, and the one every round has after the flip: a marker, no
     background. The screen must keep the user's design rather than fall to the
     :root defaults — and must carry that design's SCHEME
     with it, which is the half a spec asserting only `data-design` would miss.

     Der Tisch is dark, so `data-scheme` is what decides whether ~200 component
     rules match at all. A results screen that landed on data-design="tisch"
     with no scheme would look exactly like Klassisch and pass any check that
     stopped at the attribute. */
  const s = {
    id: 's3', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1'],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } } },
    votedIds: ['m1'], finished: true, cancelled: false, done: true, winnerIds: ['m1'],
    chosenGameId: 'g1', events: [],
  };
  const r = { ...round(s), background: null, marker: 2 };
  const dom = boot(t, r);
  dom.run('applyDesign("tisch")');
  await dom.call('showResults', r, s, r.games, false);
  const root = dom.document.documentElement;
  assert.equal(root.dataset.design, 'tisch', 'the account design must survive entering a session screen');
  assert.equal(root.dataset.scheme, 'dark',
    'without the scheme every one of the design\'s component rules is inert');
  assert.equal(root.dataset.world, undefined, 'a markered round has no world to set');
});

test('the vote card keeps the account design — it is the one screen with no chrome', (t) => {
  /* `voteScreen(true)` strips the dock and the top bar (#1185), so the vote card
     is the only screen whose GROUND is the body itself. Der Tisch paints the
     felt there (#1191), which makes `data-design` + the scheme on <html> the
     only thing standing between a felt table and a bare page. */
  const s = {
    id: 's4', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1'], memberIds: ['m1'],
    votes: {}, votedIds: [], finished: false, cancelled: false, done: false, events: [],
  };
  const r = { ...round(s), background: null, marker: 2 };
  const dom = boot(t, r);
  dom.run('applyDesign("tisch")');
  // `skipIntro`, so the first step IS the rating card: with the handover in
  // front of it the screen under test would not be on yet, and the assertion
  // below would be about the wrong step.
  dom.call('startVoting', r, s, [r.games[0]], [{ id: 'm1', name: 'Anna' }], { skipIntro: true });
  const root = dom.document.documentElement;
  assert.equal(root.dataset.design, 'tisch');
  assert.equal(root.dataset.scheme, 'dark');
  assert.ok(dom.document.body.classList.contains('vote-screen'),
    'the felt is painted on body.vote-screen, so the class has to be on');
});

test('the lobby dresses the round too — it is the link a second device arrives through', (t) => {
  const s = {
    id: 's2', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
    votes: {}, votedIds: [], finished: false, cancelled: false, done: false, events: [],
  };
  const r = round(s);
  const dom = boot(t, r);
  dom.run('applyDesign("tisch")');
  dom.call('showSessionLobby', r, s);
  const root = dom.document.documentElement;
  assert.equal(root.style.getPropertyValue('--marker'), forestMarker('tisch'),
    'the lobby must apply the round\'s marker, in the design the viewer wears');
  assert.equal(root.dataset.scheme, 'dark', 'and the round must not undo the design\'s scheme');
});
