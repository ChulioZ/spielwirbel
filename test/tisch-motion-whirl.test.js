'use strict';

/* Der Tisch's motion ritual 2 (#1200, T10.2): „Loswirbeln" — the pot turns once
 * on the press, and the lobby it opens deals the drawn games out.
 *
 * Two gates, both one-shots. The turn must fire only on a press that got past
 * the draw's own guards (an empty seat list or an empty pot refuses the draw,
 * and a pot that turns for a refusal lies). The deal must fire only on the one
 * lobby render that comes straight from the draw: never on a cold load, on a
 * language switch (`currentView`) or on the poll's re-render — the lobby is
 * re-rendered constantly, and a deal on every re-render would be a pulse.
 *
 * The motion itself is judged from a recording; the CSS half pins the shared
 * contract (Tisch only, inside the motion gate, ≤ 900ms, no `infinite`, no end
 * frame).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const ME = 'user-me';
const MEMBERS = [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }];
const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
];
const roundFixture = (games = GAMES) => ({
  id: 'r1', name: 'Freitagsrunde', background: null, tags: [], sessions: [],
  members: MEMBERS.map((m) => ({ ...m })), games: games.map((g) => ({ ...g })),
});
const sessionFixture = () => ({
  id: 's1', createdAt: '2026-09-24T18:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
  guests: [], votes: {}, votedIds: [], done: false, cancelled: false, finished: false,
  winnerIds: [], chosenGameId: null,
});

async function setup(t, design, games) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const lobbyCalls = [];
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  dom.set('api', async () => ({ session: sessionFixture() }));
  dom.set('showSessionLobby', (...args) => { lobbyCalls.push(args); });
  dom.call('applyDesign', design);
  await dom.call('showStartSession', roundFixture(games));
  await flush();
  return { dom, lobbyCalls, go: dom.app.querySelector('#go') };
}

test('a draw turns the pot and opens the lobby dealt — under Der Tisch only', async (t) => {
  const { go, lobbyCalls } = await setup(t, 'tisch');
  assert.equal(go.classList.contains('is-whirling'), false, 'nothing turns before the press');
  go.click();
  assert.equal(go.classList.contains('is-whirling'), true, 'the press turns the pot');
  await flush();
  assert.equal(lobbyCalls.length, 1, 'the lobby opens as soon as the draw returns — never held for the turn');
  assert.equal(lobbyCalls[0][3], true, 'and it is told this is the arrival from the draw');
});

test('a refused draw does not turn', async (t) => {
  // Every box is Ben's: unseat him and the pot is empty, which the draw refuses
  // before it starts — a pot that turned for a refusal would be lying.
  const { dom, go, lobbyCalls } = await setup(t, 'tisch', GAMES.map((g) => ({ ...g, ownerIds: ['m2'] })));
  [...dom.app.querySelectorAll('.nr-seat')].find((s) => s.textContent.includes('Ben')).click();
  assert.equal(dom.app.querySelectorAll('.pool-tile').length, 0, 'the pot is empty');
  go.click();
  await flush();
  assert.equal(go.classList.contains('is-whirling'), false);
  assert.equal(lobbyCalls.length, 0);
});

test('Klassisch neither turns nor deals', async (t) => {
  const { go, lobbyCalls } = await setup(t, 'klassisch');
  go.click();
  await flush();
  assert.equal(go.classList.contains('is-whirling'), false);
  assert.equal(lobbyCalls[0][3], false);
});

async function lobby(t, design, dealt) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => roundFixture());
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.call('applyDesign', design);
  await dom.call('showSessionLobby', roundFixture(), sessionFixture(), false, dealt);
  return dom;
}
const dealtRoot = (dom) => dom.app.querySelector('.live-vote[data-dealt]');

test('the lobby is dealt only on the arrival from the draw', async (t) => {
  const fresh = await lobby(t, 'tisch', true);
  assert.ok(dealtRoot(fresh), 'straight from „Loswirbeln": dealt');
  assert.equal(fresh.app.querySelectorAll('.live-vote[data-dealt] .live-person__dot').length, 4,
    'two people, two drawn games each — the boxes the deal lays out');

  // A language switch re-renders through currentView: not a draw.
  await fresh.run('currentView()');
  assert.equal(dealtRoot(fresh), null, 'a re-render must not deal again');

  const cold = await lobby(t, 'tisch', undefined);
  assert.equal(dealtRoot(cold), null, 'a cold load (router, ticket, poll) is not dealt');

  const klassisch = await lobby(t, 'klassisch', true);
  assert.equal(dealtRoot(klassisch), null, 'Klassisch never carries the attribute');
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

for (const [name, selector, timing] of [
  ['tisch-pot-turn', ':root[data-design="tisch"] .setup-bar .btn.is-whirling .ti-tornado', /tisch-pot-turn 900ms /],
  ['tisch-deal', ':root[data-design="tisch"] .live-vote[data-dealt] .live-person__dot',
    /tisch-deal 380ms [^;]*calc\(var\(--deal-i, 0\) \* 120ms\)/],
]) {
  test(`${name}: Tisch only, inside the motion gate, ≤ 900ms, no end frame`, () => {
    const users = rulesOf(TISCH_CSS).filter(([, b]) => new RegExp(`animation[-a-z]*:[^;]*${name}`).test(b));
    assert.deepEqual(users.map(([s]) => s), [selector], 'exactly one rule runs it, under Der Tisch');
    const gated = motionRules.filter(([s, b]) => s === selector && b.includes(name));
    assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
    const body = gated[0][1];
    assert.match(body, timing);
    assert.doesNotMatch(body, /infinite|pointer-events/);
    const frames = keyframes(name);
    assert.ok(frames, 'the keyframes exist');
    assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it ends on the rest state');
  });
}

test('the deal stagger is capped so the last box lands by 900ms', () => {
  const caps = motionRules.filter(([s]) => /\.live-person__dot:nth-child/.test(s));
  const steps = caps.map(([, b]) => Number(/--deal-i:\s*(\d+)/.exec(b)[1]));
  assert.deepEqual(steps, [1, 2, 3, 4]);
  assert.ok(caps.some(([s]) => /nth-child\(n \+ 5\)/.test(s)), 'the fifth and every later box share the last step');
  assert.ok(380 + Math.max(...steps) * 120 <= 900);
});
