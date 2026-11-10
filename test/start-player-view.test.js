'use strict';

/* „Wer fängt an?" (#1769) — the DOM half, at both entry points: the results
 * screen of a decided session (every design) and the „Jetzt spielen" sheet. The
 * draw itself is unit-tested in test/start-player.test.js; here Math.random is
 * pinned inside the jsdom context so the landing is known.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush, waitFor } = require('./support/dom');
const { DESIGN_REGISTRY } = require('../public/js/designs');

function fixture(over = {}, members) {
  const session = {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2', 'm3'],
    votes: {},
    votedIds: [],
    done: true,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: 'g1',
    events: [],
    automa: { name: 'Automa' },
    ...over,
  };
  const round = {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    members: members || [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cem' }],
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [session],
  };
  return { round, session };
}

function boot(t, { design = 'klassisch', reduce = true, random = 0.5 } = {}) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.run(`window.matchMedia = (q) => ({ matches: ${reduce} && /prefers-reduced-motion:\\s*reduce/.test(q), addEventListener() {}, removeEventListener() {} });`);
  dom.run(`Math.random = () => ${random};`);
  return dom;
}

async function results(t, over, opts = {}) {
  const { round, session } = fixture(over, opts.members);
  const dom = boot(t, opts);
  dom.set('api', async () => round);
  await dom.call('showResults', round, session, round.games);
  return dom;
}

const box = (dom) => dom.app.querySelector('.start-player');
const go = (dom) => box(dom).querySelector('.start-player__go');
const answer = (dom) => box(dom).querySelector('.start-player__answer').textContent;

for (const { id } of DESIGN_REGISTRY) {
  test(`${id}: a decided session offers „Wer fängt an?" and lands on one seat`, async (t) => {
    const dom = await results(t, {}, { design: id });
    assert.ok(box(dom), 'the section is rendered');
    assert.equal(box(dom).hidden, false);
    assert.equal(go(dom).textContent.trim(), 'Wer fängt an?');
    go(dom).click();
    // Math.random 0.5 over three seats → index 1 → Ben.
    assert.equal(answer(dom), 'Ben fängt an');
    assert.equal(dom.document.getElementById('srLive').textContent, 'Ben fängt an', 'announced to screen readers');
    const picked = [...box(dom).querySelectorAll('.start-player__seat.is-picked')];
    assert.deepEqual(picked.map((s) => s.dataset.id), ['m2']);
    assert.equal(go(dom).textContent.trim(), 'Nochmal', 'the button re-spins');
  });
}

test('it is never offered before a game is chosen, after the play, when cancelled, or at a solo table', async (t) => {
  for (const over of [{ chosenGameId: null }, { finished: true }, { cancelled: true, chosenGameId: null }, { memberIds: ['m1'] }]) {
    const dom = await results(t, over);
    assert.equal(box(dom).hidden, true, JSON.stringify(over));
  }
});

test('the seats are the parties: the automa is never one, and a team is drawn as a team', async (t) => {
  const dom = await results(t, { teams: [{ id: 't1', personIds: ['m1', 'm2'] }] }, { random: 0 });
  const ids = [...box(dom).querySelectorAll('.start-player__seat')].map((s) => s.dataset.id);
  assert.deepEqual(ids, ['t1', 'm3'], 'no automa, no Anna or Ben on their own');
  go(dom).click();
  assert.equal(answer(dom), 'Anna und Ben fangen an');
});

test('with motion allowed the whirl runs first and then lands on the same answer', async (t) => {
  const dom = await results(t, {}, { reduce: false, random: 0.9 });
  go(dom).click();
  assert.equal(answer(dom), '', 'no answer while it spins');
  assert.equal(box(dom).getAttribute('aria-busy'), 'true');
  assert.ok(box(dom).querySelector('.start-player__seat.is-lit'), 'a seat is lit');
  go(dom).click(); // a tap mid-spin does not restart it
  await waitFor(() => answer(dom), { timeout: 5000, label: 'the whirl lands' });
  assert.equal(answer(dom), 'Cem fängt an');
  assert.equal(box(dom).hasAttribute('aria-busy'), false);
  assert.equal(box(dom).querySelectorAll('.is-lit').length, 0);
});

test('choosing a game on the screen brings the button in', async (t) => {
  const { round, session } = fixture({ chosenGameId: null });
  const dom = boot(t);
  dom.set('api', async (method, path, body) => {
    if (method === 'POST' && /\/choice$/.test(path)) { session.chosenGameId = body.gameId; return {}; }
    return round;
  });
  await dom.call('showResults', round, session, round.games);
  assert.equal(box(dom).hidden, true);
  dom.app.querySelector('.play-btn').click();
  await flush();
  await flush();
  assert.equal(box(dom).hidden, false);
});

test('„Jetzt spielen": offered once two seats are taken, hidden for one, following the ring', async (t) => {
  const { round } = fixture();
  const dom = boot(t);
  dom.set('api', async () => ({}));
  dom.call('startDirectSession', round, round.games[0]);
  const sheet = () => dom.document.querySelector('.sheet');
  const sp = () => sheet().querySelector('.start-player');
  assert.ok(sp(), 'the sheet carries the section');
  assert.equal(sp().hidden, false, 'three seated');
  const seat = (name) => [...sheet().querySelectorAll('.nr-seat')].find((s) => s.getAttribute('title') === name);
  seat('Anna').click();
  assert.equal(sp().hidden, false, 'two seated');
  sp().querySelector('.start-player__go').click();
  // 0.5 over [Ben, Cem] → Cem.
  assert.equal(sp().querySelector('.start-player__answer').textContent, 'Cem fängt an');
  seat('Ben').click();
  assert.equal(sp().hidden, true, 'a solo table gets no button');
  seat('Ben').click();
  assert.equal(sp().hidden, false);
  assert.equal(sp().querySelector('.start-player__answer').textContent, '', 'a different table clears the old answer');
});
