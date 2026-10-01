'use strict';

/* Die Brücke's motion ritual 1 (#1248, B10.1): „Die Zündung" — the amber of
 * the „Zündung" bar runs in from the left over the whole bar and leaves it
 * filled, 900ms, cubic-bezier(.2,.8,.2,1).
 *
 * One gate, a one-shot: it fires only on a press that got past the draw's own
 * guards (an empty seat list or an empty pool refuses the draw, and a bar that
 * ignites for a refusal lies). It never holds the lobby (#1122) — the screen
 * changes as soon as the draw returns.
 *
 * The CSS half pins the shared contract: Brücke only, inside the motion gate,
 * ≤ 900ms, no `infinite`, no forwards fill, no end frame — so every run lands
 * on the resting button, which is what reduced motion shows at once.
 *
 * Named for the design and the ritual (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
];
const roundFixture = (games = GAMES) => ({
  id: 'r1', name: 'Freitagsrunde', background: null, tags: [], sessions: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: games.map((g) => ({ ...g })),
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

test('„Zündung" ignites on a press that draws, and the lobby is never held for it', async (t) => {
  const { go, lobbyCalls } = await setup(t, 'bruecke');
  assert.equal(go.classList.contains('is-igniting'), false, 'nothing runs before the press');
  go.click();
  assert.equal(go.classList.contains('is-igniting'), true, 'the press ignites the bar');
  await flush();
  assert.equal(lobbyCalls.length, 1, 'the lobby opens as soon as the draw returns');
});

test('a refused draw does not ignite', async (t) => {
  const { dom, go, lobbyCalls } = await setup(t, 'bruecke', GAMES.map((g) => ({ ...g, ownerIds: ['m2'] })));
  [...dom.app.querySelectorAll('.nr-seat')].find((s) => s.textContent.includes('Ben')).click();
  assert.equal(dom.app.querySelectorAll('.pool-tile').length, 0, 'the pool is empty');
  go.click();
  await flush();
  assert.equal(go.classList.contains('is-igniting'), false);
  assert.equal(lobbyCalls.length, 0);
});

test('Klassisch never ignites', async (t) => {
  const { go } = await setup(t, 'klassisch');
  go.click();
  await flush();
  assert.equal(go.classList.contains('is-igniting'), false);
});

/* ---------------------------------------------------------- the CSS contract */

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'bruecke.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));

function keyframes(name) {
  const m = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(CSS);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; depth > 0; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') depth--;
  }
  return CSS.slice(m.index + m[0].length, i - 1);
}

const IGNITE = ':root[data-design="bruecke"][data-scheme="dark"] .setup-grid--bruecke .setup-bar #go.is-igniting';

test('the ignition: one gated rule, three runs, all over by 900ms, none with an end frame', () => {
  const users = rulesOf(CSS).filter(([, b]) => /animation[-a-z]*:[^;]*bruecke-ignite-/.test(b));
  assert.deepEqual(users.map(([s]) => s), [IGNITE], 'exactly one rule runs them, on „Zündung" under Die Brücke');
  const gated = motionRules.filter(([s, b]) => s === IGNITE && /bruecke-ignite-/.test(b));
  assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
  const body = gated[0][1];
  assert.doesNotMatch(body, /infinite|pointer-events/);
  assert.doesNotMatch(body, /\b(both|forwards)\b/, 'no forwards fill: nothing is held after the ritual');

  const list = /(?:^|;)\s*animation:\s*([^;]+)/.exec(body)[1];
  const runs = list.split(/,\s*(?=bruecke-ignite-)/).map((part) => [
    /bruecke-ignite-[a-z]+/.exec(part)[0], Number(/(\d+)ms/.exec(part)[1]), part,
  ]);
  assert.deepEqual(runs.map(([n]) => n).sort(), ['bruecke-ignite-fill', 'bruecke-ignite-hold', 'bruecke-ignite-ink']);
  for (const [name, ms] of runs) {
    assert.ok(ms <= 900, `${name} ends by ${ms}ms`);
    const frames = keyframes(name);
    assert.ok(frames, `${name}: the keyframes exist`);
    assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, `${name}: no end frame — it lands on the resting button`);
  }
  const fill = runs.find(([n]) => n === 'bruecke-ignite-fill');
  assert.equal(fill[1], 900, 'B10.1: 900ms');
  assert.match(fill[2], /cubic-bezier\(\.2, \.8, \.2, 1\)/, 'fast off the mark, slow to land');
  assert.match(keyframes('bruecke-ignite-fill'), /background-size:\s*0% 100%/, 'the fill runs in from the left edge');
});

test('the rest is untouched: no image at rest, so a failed draw still hovers and presses', () => {
  const body = motionRules.find(([s]) => s === IGNITE)[1];
  assert.doesNotMatch(body, /background(-color|-image)?\s*:/, 'the static rule only sizes the image the run paints');
  assert.match(keyframes('bruecke-ignite-hold'), /background-image:\s*linear-gradient\(var\(--action\), var\(--action\)\)/);
  assert.match(keyframes('bruecke-ignite-hold'), /background-color:\s*transparent/);
});
