'use strict';

/* #1777 — the two client surfaces of the draw boost: the Einstellungen toggle
 * and the lobby's one line. Neither computes anything; the server decides and
 * stores `drawBoostMemberId` (test/draw-boost-route.test.js). */

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
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [{ id: 'g1', title: 'Azul', tagIds: [] }, { id: 'g2', title: 'Brass', tagIds: [] }],
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

const open = (extra = {}) => ({
  id: 's1', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
  votes: {}, votedIds: [], finished: false, cancelled: false, done: false, winnerIds: [],
  chosenGameId: null, events: [], ...extra,
});

test('lobby: says once whose favourites got the extra chance, with no number', async (t) => {
  const session = open({ drawBoostMemberId: 'm2' });
  const data = round({ sessions: [session] });
  const dom = boot(t, data);
  dom.call('showSessionLobby', data, session, false);
  const notes = dom.app.querySelectorAll('.live-vote__boost');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].textContent.trim(), 'Heute mit Extra-Chance für die Lieblingsspiele von Ben');
  assert.doesNotMatch(notes[0].textContent, /\d/);
});

test('lobby: no line without a boosted member, or for one no longer in the round', async (t) => {
  for (const extra of [{}, { drawBoostMemberId: 'gone' }]) {
    const session = open(extra);
    const data = round({ sessions: [session] });
    const dom = boot(t, data);
    dom.call('showSessionLobby', data, session, false);
    assert.ok(dom.app.querySelector('.live-vote'), 'the lobby rendered');
    assert.equal(dom.app.querySelector('.live-vote__boost'), null);
  }
});
