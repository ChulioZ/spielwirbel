'use strict';

/* Ocean's motion ritual O10.1 „Abtauchen" (#1221): the Muschel opens once on
 * the press, and the lobby it opens sinks the drawn games into place.
 *
 * The same two gates as Der Tisch's T10.2 (test/tisch-motion-whirl.test.js),
 * both one-shots. The shell must open only on a press that got past the draw's
 * own guards (a refused draw that opened the shell would lie). The sink must
 * fire only on the one lobby render that comes straight from the draw — never
 * on a cold load, a language switch (`currentView`) or the poll's re-render,
 * or the lobby would pulse.
 *
 * The motion itself is proved in a browser by sampled computed values; the CSS
 * half pins the contract O10.4 sets: Ocean's light scheme only, inside the
 * motion gate, ≤ 900ms, the O10 curve, no `infinite`, no end frame (so reduced
 * motion and the finished motion are the same resting screen).
 *
 * Named for the design and the ritual (.claude/rules/test-file-names-collide-silently.md).
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
  { id: 'g3', title: 'Dixit', minPlayers: 1, maxPlayers: 8 },
];
const roundFixture = (games = GAMES) => ({
  id: 'r1', name: 'Freitagsrunde', background: null, tags: [], sessions: [],
  members: MEMBERS.map((m) => ({ ...m })), games: games.map((g) => ({ ...g })),
});
const sessionFixture = () => ({
  id: 's1', createdAt: '2026-09-25T18:00:00.000Z', gameIds: ['g1', 'g2', 'g3'], memberIds: ['m1', 'm2'],
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
  if (design) dom.call('applyDesign', design);
  await dom.call('showStartSession', roundFixture(games));
  await flush();
  return { dom, lobbyCalls, go: dom.app.querySelector('#go'), shell: dom.app.querySelector('.ocean-muschel') };
}

test('a draw opens the Muschel and opens the lobby for the sink — under Ocean', async (t) => {
  const { go, shell, lobbyCalls } = await setup(t, 'ocean');
  assert.ok(shell, 'the setup is Ocean’s');
  assert.equal(shell.classList.contains('is-diving'), false, 'the shell is at rest before the press');
  go.click();
  assert.equal(shell.classList.contains('is-diving'), true, 'the press opens the shell');
  await flush();
  assert.equal(lobbyCalls.length, 1, 'the lobby opens as soon as the draw returns — never held for the motion');
  assert.equal(lobbyCalls[0][3], true, 'and it is told this is the arrival from the draw');
});

test('a refused draw does not open the shell', async (t) => {
  // Every box is Ben's: unseat him and the Muschel is empty, which the draw
  // refuses before it starts.
  const { dom, go, shell, lobbyCalls } = await setup(t, 'ocean', GAMES.map((g) => ({ ...g, ownerIds: ['m2'] })));
  [...dom.app.querySelectorAll('.nr-seat')].find((s) => s.textContent.includes('Ben')).click();
  assert.equal(dom.app.querySelectorAll('.pool-tile').length, 0, 'the Muschel is empty');
  go.click();
  await flush();
  assert.equal(shell.classList.contains('is-diving'), false);
  assert.equal(lobbyCalls.length, 0);
});

test('Klassisch has no shell to open and arrives undealt', async (t) => {
  const { dom, go, lobbyCalls } = await setup(t, null);
  go.click();
  await flush();
  assert.equal(dom.app.querySelector('.is-diving'), null);
  assert.equal(lobbyCalls[0][3], false);
});

async function lobby(t, design, dealt) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => roundFixture());
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  if (design) dom.call('applyDesign', design);
  await dom.call('showSessionLobby', roundFixture(), sessionFixture(), false, dealt);
  return dom;
}
const sunk = (dom) => dom.app.querySelector('.live-vote--ocean[data-dealt]');

test('the lobby sinks the drawn games only on the arrival from the draw', async (t) => {
  const fresh = await lobby(t, 'ocean', true);
  assert.ok(sunk(fresh), 'straight from „Abtauchen": the sink is armed');
  assert.equal(fresh.app.querySelectorAll('.live-vote--ocean[data-dealt] .live-person__dot').length, 6,
    'two people, three drawn games each — the bubbles that sink');

  await fresh.run('currentView()');
  assert.equal(sunk(fresh), null, 'a re-render (language switch) must not sink them again');

  const cold = await lobby(t, 'ocean', undefined);
  assert.equal(sunk(cold), null, 'a cold load (router, ticket, poll) does not sink');

  const klassisch = await lobby(t, null, true);
  assert.equal(klassisch.app.querySelector('.live-vote[data-dealt]'), null, 'Klassisch never carries the attribute');
});

/* ---------------------------------------------------------- the CSS contract */

const OCEAN_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(OCEAN_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"]) ';

function keyframes(name) {
  const m = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(OCEAN_CSS);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; depth > 0; i++) {
    if (OCEAN_CSS[i] === '{') depth++;
    else if (OCEAN_CSS[i] === '}') depth--;
  }
  return OCEAN_CSS.slice(m.index + m[0].length, i - 1);
}

const CURVE = 'cubic-bezier\\(0\\.2, 0\\.8, 0\\.3, 1\\)';
for (const [name, selector, timing] of [
  ['ocean-shell-open', `${GATE}.ocean-muschel.is-diving .setup-panel`, new RegExp(`ocean-shell-open 420ms ${CURVE}`)],
  ['ocean-sink', `${GATE}.live-vote--ocean[data-dealt] .live-person__dot`,
    new RegExp(`ocean-sink 520ms ${CURVE} calc\\(var\\(--sink-i, 0\\) \\* 120ms\\) backwards`)],
]) {
  test(`${name}: Ocean's light scheme only, inside the motion gate, O10's curve, no end frame`, () => {
    const users = rulesOf(OCEAN_CSS).filter(([, b]) => new RegExp(`animation[-a-z]*:[^;]*${name}`).test(b));
    assert.deepEqual(users.map(([s]) => s), [selector], 'exactly one rule runs it, under Ocean');
    const gated = motionRules.filter(([s, b]) => s === selector && b.includes(name));
    assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
    const body = gated[0][1];
    assert.match(body, timing);
    assert.doesNotMatch(body, /infinite|pointer-events/);
    // A forwards fill would hold an identity transform on the element for good —
    // the resting screen must carry no trace of the ritual.
    assert.doesNotMatch(body, /\b(both|forwards)\b/, 'no forwards fill: nothing is held after the ritual');
    const frames = keyframes(name);
    assert.ok(frames, 'the keyframes exist');
    assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it ends on the rest state');
  });
}

test('the sink stagger is O10.1’s 0 / 120 / 240ms and lands by 900ms', () => {
  const caps = motionRules.filter(([s]) => /\.live-person__dot:nth-child/.test(s));
  const steps = caps.map(([, b]) => Number(/--sink-i:\s*(\d+)/.exec(b)[1]));
  assert.deepEqual(steps, [1, 2]);
  assert.ok(caps.some(([s]) => /nth-child\(n \+ 3\)/.test(s)), 'the third and every later bubble share the last step');
  assert.ok(520 + Math.max(...steps) * 120 <= 900);
});
