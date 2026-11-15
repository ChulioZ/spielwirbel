'use strict';

/* „Wer zu kurz kommt, ist dran" on the client (#1777, redefined by #1830): the
 * Einstellungen toggle, the hint naming who is boosted (lobby and result), and
 * the result screen weighting the ballots of a flagged session. The accrual is
 * test/vote-boost.test.js's; this file runs the real views. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

function round(extra = {}) {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cem' }],
    games: [{ id: 'g1', title: 'Azul', tagIds: [] }, { id: 'g2', title: 'Brass', tagIds: [] }, { id: 'g9', title: 'Uno', tagIds: [] }],
    sessions: [],
    ...extra,
  };
}

function boot(t, data, calls = []) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (/\/draw-boost$/.test(url)) return { drawBoost: body.on };
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return data;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const toggle = (dom) => {
  const label = [...dom.app.querySelectorAll('label.draw-boost__row')];
  assert.equal(label.length, 1, 'one toggle row');
  return label[0].querySelector('input[type="checkbox"]');
};

test('Einstellungen: the toggle is off by default and PATCHes the round setting', async (t) => {
  const calls = [];
  const dom = boot(t, round(), calls);
  await dom.call('showRoundSettings', RID);
  const heads = [...dom.app.querySelectorAll('h2.rs-section__h')].map((el) => el.textContent);
  assert.ok(heads.includes('Ziehung'));
  assert.ok(dom.app.textContent.includes('Wer zu kurz kommt, ist dran'));
  const box = toggle(dom);
  assert.equal(box.checked, false);

  box.checked = true;
  box.dispatchEvent(new dom.window.Event('change'));
  await new Promise((r) => setTimeout(r, 0));
  // Through JSON: the body object was built inside the jsdom realm.
  assert.equal(JSON.stringify(calls.find((c) => c.method === 'PATCH')),
    JSON.stringify({ method: 'PATCH', url: `/api/rounds/${RID}/draw-boost`, body: { on: true } }));
});

test('Einstellungen: a round with the boost on renders it checked', async (t) => {
  const dom = boot(t, round({ drawBoost: true }));
  await dom.call('showRoundSettings', RID);
  assert.equal(toggle(dom).checked, true);
});

// Three evenings of Uno that Anna rated 1 — she is +150, weight 250.
const history = [1, 2, 3].map((d) => ({
  id: `h${d}`, createdAt: `2026-06-0${d}T20:00:00.000Z`, gameIds: ['g9'], memberIds: ['m1', 'm2', 'm3'],
  votes: { m1: { g9: { rating: 1 } } }, chosenGameId: 'g9', finished: true, cancelled: false, done: true, winnerIds: [], events: [],
}));

const open = (extra = {}) => ({
  id: 's1', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2', 'm3'],
  votes: {}, votedIds: [], finished: false, cancelled: false, done: false, winnerIds: [],
  chosenGameId: null, events: [], ...extra,
});

test('lobby: names who has a little more say, once, with no number', async (t) => {
  const session = open({ voteBoost: true });
  const data = round({ sessions: [...history, session] });
  const dom = boot(t, data);
  dom.call('showSessionLobby', data, session, false);
  const notes = dom.app.querySelectorAll('.vote-boost-note');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].textContent.trim(), 'Anna hat heute etwas mehr Mitsprache');
  assert.doesNotMatch(notes[0].textContent, /\d/);
});

test('lobby: no line when the session was not flagged, or nobody is boosted', async (t) => {
  for (const [label, sessions, extra] of [['unflagged', history, {}], ['nobody boosted', [], { voteBoost: true }]]) {
    const session = open(extra);
    const data = round({ sessions: [...sessions, session] });
    const dom = boot(t, data);
    dom.call('showSessionLobby', data, session, false);
    assert.ok(dom.app.querySelector('.live-vote'), `${label}: the lobby rendered`);
    assert.equal(dom.app.querySelector('.vote-boost-note'), null, label);
  }
});

/* Anna loves Azul and dislikes Brass; Ben and Cem the reverse. Unweighted Brass
   wins (2.67 to 1.67); with Anna at 250, Azul does (2.78 to 1.78). */
const voted = (extra = {}) => open({
  done: true, votedIds: ['m1', 'm2', 'm3'],
  votes: {
    m1: { g1: { rating: 5 }, g2: { rating: 2 } },
    m2: { g1: { rating: 2 }, g2: { rating: 4 } },
    m3: { g1: { rating: 2 }, g2: { rating: 4 } },
  },
  ...extra,
});
const order = (dom) => [...dom.app.querySelectorAll('.trow .trow__title')].map((el) => el.textContent.trim());

test('result: a flagged session weighs the boosted ballot — the ranking flips', async (t) => {
  const session = voted({ voteBoost: true });
  const data = round({ sessions: [...history, session] });
  const dom = boot(t, data);
  await dom.call('showResults', data, session);
  assert.deepEqual(order(dom).slice(0, 2), ['Azul', 'Brass']);
  const note = dom.app.querySelector('.page-head--result .vote-boost-note');
  assert.ok(note, 'the result names who had more say');
  assert.equal(note.textContent.trim(), 'Anna hat heute etwas mehr Mitsprache');
});

test('result: the same votes in an UNFLAGGED session rank as they always did', async (t) => {
  const session = voted();
  const data = round({ sessions: [...history, session] });
  const dom = boot(t, data);
  await dom.call('showResults', data, session);
  assert.deepEqual(order(dom).slice(0, 2), ['Brass', 'Azul']);
  assert.equal(dom.app.querySelector('.vote-boost-note'), null);
});

// Every design that renders the result names the boosted member — the hint
// lives inside the heading's text column, which each composition keeps.
const { DESIGN_REGISTRY } = require('../public/js/designs');
for (const design of DESIGN_REGISTRY.map((d) => d.id)) {
  test(`result: the hint survives the ${design} composition`, async (t) => {
    const session = voted({ voteBoost: true });
    const data = round({ sessions: [...history, session] });
    const dom = loadApp({ locale: 'de', design });
    t.after(() => dom.close());
    dom.set('api', async (method, url) => (/^\/api\/rounds\/[^/]+$/.test(url) ? data : url === '/api/rounds' ? [] : {}));
    dom.set('accountsActive', () => false);
    dom.set('isLoggedIn', () => false);
    await dom.call('showResults', data, session);
    const notes = dom.app.querySelectorAll('.vote-boost-note');
    assert.equal(notes.length, 1, `${design}: one hint`);
    assert.equal(notes[0].textContent.trim(), 'Anna hat heute etwas mehr Mitsprache');
  });
}
