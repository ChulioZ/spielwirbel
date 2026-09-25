'use strict';

/* Der Tisch's motion ritual 5 (#1200, T10.5): „Gespielt" is stamped.
 *
 * #1122 removed the stamp's entry press because it fired on ARRIVAL — every
 * visit to a finished session replayed it and read as a page still loading.
 * This ritual is only safe if it fires on the reader's own hand: the ONE
 * render after they record the finish. So the gate is the test: not a cold
 * load of a finished session, not a winner change on an already-finished one,
 * not the next re-render, never under Klassisch — and the finish itself, yes.
 *
 * The motion is judged from a recording; the CSS half pins the shared contract
 * (Tisch only, inside the motion gate, ≤ 900ms incl. the delay, no end frame,
 * individual transform properties so the stamp's own layout is not replaced).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const ME = 'user-me';

function fixture(over = {}) {
  const session = {
    id: 's1', createdAt: '2026-08-02T18:00:00.000Z', finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } }, m2: { g1: { rating: 4 }, g2: { rating: 2 } } },
    votedIds: ['m1', 'm2'], done: true, cancelled: false, finished: false, winnerIds: [],
    chosenGameId: null, events: [], ...over,
  };
  const round = {
    id: 'r1', name: 'Freitagsrunde', background: null, tags: [],
    members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }],
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [session],
  };
  return { round, session };
}

async function show(t, design, over = {}) {
  const { round, session } = fixture(over);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, p, body) => {
    if (method === 'POST' && /\/choice$/.test(p)) { session.chosenGameId = body.gameId; return {}; }
    if (method === 'POST' && /\/finish$/.test(p)) {
      return { ...session, finished: body.finished !== false, winnerIds: body.winnerIds || [],
        finishedAt: '2026-08-02T22:10:00.000Z' };
    }
    return round;
  });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.call('applyDesign', design);
  await dom.call('showResults', round, session, round.games, false);
  await flush();
  return dom;
}

const slot = (dom) => dom.app.querySelector('.tisch-slot');
const stamped = (dom) => slot(dom).hasAttribute('data-stamped');
const btn = (dom, rx) => [...dom.app.querySelectorAll('.tisch button')].find((b) => rx.test(b.textContent));
const play = (dom, title) => [...dom.app.querySelectorAll('.trow')]
  .find((r) => r.querySelector('.trow__title').textContent.trim() === title)
  .querySelector('.play-btn');

test('a cold load of a finished session is not stamped again', async (t) => {
  const dom = await show(t, 'tisch', { chosenGameId: 'g1', finished: true, winnerIds: ['m1'] });
  assert.ok(dom.app.querySelector('.tisch .stamp'), 'the stamp is there — the state that would replay');
  assert.equal(stamped(dom), false);
});

test('recording the finish stamps once, and the next write does not', async (t) => {
  const dom = await show(t, 'tisch');
  play(dom, 'Catan').click();
  await flush();
  assert.equal(stamped(dom), false, 'choosing a game is not the finish');

  btn(dom, /Als gespielt markieren/).click();
  await flush();
  assert.ok(dom.app.querySelector('.tisch .stamp'), 'the stamp is on the box');
  assert.equal(stamped(dom), true, 'the reader just recorded the finish — the stamp drops');

  // The picker is open now; naming a winner is a second finish write on a
  // session that is ALREADY finished. Not a new stamp.
  const winner = [...dom.app.querySelectorAll('.tisch button')].find((b) => /Anna/.test(b.textContent));
  assert.ok(winner, 'the winner picker offers Anna');
  winner.click();
  await flush();
  assert.equal(stamped(dom), false, 'a winner change must not re-stamp');
});

test('Klassisch never carries the hook', async (t) => {
  const dom = await show(t, 'klassisch');
  play(dom, 'Catan').click();
  await flush();
  btn(dom, /Als gespielt markieren/).click();
  await flush();
  assert.ok(dom.app.querySelector('.tisch .stamp'));
  assert.equal(stamped(dom), false);
});

/* ---------------------------------------------------------- the CSS contract */

const TISCH_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(TISCH_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));

function keyframes(name) {
  const m = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(TISCH_CSS);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; depth > 0; i++) {
    if (TISCH_CSS[i] === '{') depth++;
    else if (TISCH_CSS[i] === '}') depth--;
  }
  return TISCH_CSS.slice(m.index + m[0].length, i - 1);
}

test('the stamp drop: Tisch only, inside the motion gate, ≤ 900ms, no end frame', () => {
  const selector = ':root[data-design="tisch"] .tisch-slot[data-stamped] .tisch__box .stamp--table';
  const users = rulesOf(TISCH_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*tisch-stamp-drop/.test(b));
  assert.deepEqual(users.map(([s]) => s), [selector], 'exactly one rule runs it, under its one-shot hook');
  const gated = motionRules.filter(([s, b]) => s === selector && b.includes('tisch-stamp-drop'));
  assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
  const m = /tisch-stamp-drop (\d+)ms cubic-bezier\([^)]*\) (\d+)ms both/.exec(gated[0][1]);
  assert.ok(m, 'duration, the overshoot curve and a delay');
  assert.ok(Number(m[1]) + Number(m[2]) <= 900, `lands at ${Number(m[1]) + Number(m[2])}ms`);
  assert.doesNotMatch(gated[0][1], /infinite|pointer-events/);
  const frames = keyframes('tisch-stamp-drop');
  assert.ok(frames, 'the keyframes exist');
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it settles on the rest state');
  assert.doesNotMatch(frames, /\btransform\s*:/, 'individual scale/rotate, never `transform`, so nothing is replaced');
});
