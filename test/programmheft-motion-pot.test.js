'use strict';

/* Das Programmheft's motion ritual 2 (#1382, P10.2): „Der Topf" — the pot is
 * SET line by line, not poured. Each row moves in 16px from the left, 120ms
 * apart, and the numeral counts up beside them.
 *
 * Where it parts from Der Tisch's T10.1 (test/tisch-motion-throw.test.js): the
 * sheet's end frame is the whole pot being set, so the ARRIVING setup sets
 * every row — Der Tisch leaves its first paint still. After that both behave
 * alike: a seat tap or a filter change sets only the rows that enter
 * („Filterwechsel setzen nur die geänderten Zeilen neu"), and a re-render of
 * the screen already on show (a language switch) sets nothing.
 *
 * The stagger index is capped at 9, so a pot of any size is set inside the
 * sheet's 1 400ms: the tenth row onward lands with the ninth.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
// Clara owns two boxes, so unseating and reseating her moves exactly those two.
const GAMES = [
  { id: 'g01', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  { id: 'g02', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
  { id: 'g03', title: 'Dixit', minPlayers: 1, maxPlayers: 8, ownerIds: ['m3'] },
  { id: 'g04', title: 'Just One', minPlayers: 1, maxPlayers: 8 },
  { id: 'g05', title: 'Kartographen', minPlayers: 1, maxPlayers: 8, ownerIds: ['m3'] },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `g${10 + i}`, title: `Spiel ${i + 1}`, minPlayers: 1, maxPlayers: 8 })),
];
const roundFixture = () => ({
  id: 'r1', name: 'Freitagsrunde', tags: [], sessions: [],
  members: MEMBERS.map((m) => ({ ...m })), games: GAMES.map((g) => ({ ...g })),
});

async function setup(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  dom.set('showSessionLobby', () => {});
  dom.set('toast', () => {});
  dom.set('api', async () => roundFixture());
  dom.call('applyDesign', design);
  await dom.call('showStartSession', roundFixture());
  await flush();
  return dom;
}

const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const seat = (dom, name) => qa(dom, '.nr-seat').find((s) => s.textContent.includes(name));
const set = (dom) => qa(dom, '.pool-tile.is-set');

test('the arriving pot is set row by row, the stagger capped at the ninth', async (t) => {
  const dom = await setup(t, 'programmheft');
  assert.equal(qa(dom, '.pool-tile').length, 12);
  assert.equal(set(dom).length, 12, 'every row of the arriving pot is set');
  assert.deepEqual(set(dom).map((el) => el.style.getPropertyValue('--set-i')),
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '9', '9'],
    'the tenth row onward lands with the ninth, so any pot is set inside 1 400ms');
  assert.equal(qa(dom, '.pool-tile.is-thrown').length, 0, 'Der Tisch’s throw is not borrowed');
  assert.equal(qa(dom, '.pool-tile[data-throw]').length, 0);
});

test('after arrival only the rows that ENTER are set again', async (t) => {
  const dom = await setup(t, 'programmheft');
  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.pool-tile').length, 10);
  assert.equal(set(dom).length, 0, 'rows leaving the pot set nothing, and the rest stay put');

  seat(dom, 'Clara').click();
  assert.deepEqual(set(dom).map((el) => el.getAttribute('title')), ['Dixit', 'Kartographen']);
  assert.deepEqual(set(dom).map((el) => el.style.getPropertyValue('--set-i')), ['0', '1']);
});

test('a re-render of the screen on show sets nothing', async (t) => {
  const dom = await setup(t, 'programmheft');
  await dom.run('currentView()');
  await flush();
  assert.equal(qa(dom, '.pool-tile').length, 12);
  assert.equal(set(dom).length, 0, 'a language switch is not an arrival');
});

test('Klassisch and Der Tisch never set a row', async (t) => {
  for (const design of ['klassisch', 'tisch']) {
    const dom = await setup(t, design);
    assert.equal(set(dom).length, 0, design);
  }
});

/* -------------------------------------------------------- the count-up */

test('the numeral counts up only while the arriving pot is set, and ends on the count', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const counts = [];
  dom.set('phCountUp', (el, n) => counts.push([el.className, n, el.textContent]));
  dom.set('isLoggedIn', () => false);
  dom.set('api', async () => roundFixture());
  dom.call('applyDesign', 'programmheft');
  await dom.call('showStartSession', roundFixture());
  await flush();
  assert.deepEqual(counts, [['pool-count', 12, '12']], 'once, on the panel numeral, which already reads the final count');

  seat(dom, 'Clara').click();
  seat(dom, 'Clara').click();
  await dom.run('currentView()');
  assert.equal(counts.length, 1, 'a seat tap, a filter or a re-render does not count again');
});

test('phCountUp: reduced motion leaves the final count standing', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run('window.matchMedia = (q) => ({ matches: /reduce\\)/.test(q) })');
  const frames = [];
  dom.run('window.requestAnimationFrame = (f) => 0');
  dom.set('requestAnimationFrame', (f) => { frames.push(f); return 0; });
  const el = dom.window.document.createElement('span');
  el.textContent = '9';
  dom.call('phCountUp', el, 9);
  assert.equal(el.textContent, '9');
  assert.equal(frames.length, 0, 'no frame is ever requested');
});

test('phCountUp: no answer to the motion query leaves the final count standing', async (t) => {
  // jsdom has no matchMedia — nor might an embedded view. A 0 waiting on a
  // frame is worse than a number that does not move.
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run('delete window.matchMedia');
  const el = dom.window.document.createElement('span');
  el.textContent = '9';
  dom.call('phCountUp', el, 9);
  assert.equal(el.textContent, '9');
});

test('phCountUp: counts from 0 to n and stops on n', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run('window.matchMedia = (q) => ({ matches: /no-preference/.test(q) })');
  const frames = [];
  dom.set('requestAnimationFrame', (f) => { frames.push(f); return frames.length; });
  const el = dom.window.document.createElement('span');
  dom.app.appendChild(el);
  el.textContent = '9';
  dom.call('phCountUp', el, 9);
  assert.equal(el.textContent, '0', 'the count starts from nothing');
  frames.shift()(0);           // the first frame fixes the clock
  frames.shift()(600);
  const mid = Number(el.textContent);
  assert.ok(mid > 0 && mid < 9, `part way: ${mid}`);
  frames.shift()(5000);
  assert.equal(el.textContent, '9', 'and it ends on the count');
  assert.equal(frames.length, 0, 'no frame after the end');
});

test('phCountUp: a detached numeral stops counting', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run('window.matchMedia = (q) => ({ matches: /no-preference/.test(q) })');
  const frames = [];
  dom.set('requestAnimationFrame', (f) => { frames.push(f); return frames.length; });
  const el = dom.window.document.createElement('span');
  dom.app.appendChild(el);
  dom.call('phCountUp', el, 9);
  frames.shift()(0);
  el.remove();                 // the pot was re-rendered under it
  frames.shift()(300);
  assert.equal(frames.length, 0, 'a numeral nobody can see is left alone');
});

/* ---------------------------------------------------------- the CSS contract */

const PH_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'programmheft.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(PH_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));

function keyframes(name) {
  const m = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(PH_CSS);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; depth > 0; i++) {
    if (PH_CSS[i] === '{') depth++;
    else if (PH_CSS[i] === '}') depth--;
  }
  return PH_CSS.slice(m.index + m[0].length, i - 1);
}

const ROW = ':root[data-design="programmheft"] .ph-pot .setup-panel__body .pool-tile.is-set';

test('ph-set-line: Programmheft only, inside the motion gate, ≤ 1 400ms with the capped stagger, no end frame', () => {
  const users = rulesOf(PH_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*ph-set-line/.test(b));
  assert.deepEqual(users.map(([s]) => s), [ROW], 'exactly one rule runs it');
  const gated = motionRules.filter(([s, b]) => s === ROW && b.includes('ph-set-line'));
  assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
  const body = gated[0][1];
  const m = /ph-set-line (\d+)ms [^;]*calc\(var\(--set-i, 0\) \* (\d+)ms\)/.exec(body);
  assert.ok(m, 'duration and stagger read from --set-i');
  assert.equal(Number(m[2]), 120);
  assert.ok(9 * Number(m[2]) + Number(m[1]) <= 1400, 'the ninth row lands by 1 400ms');
  assert.doesNotMatch(body, /infinite|pointer-events/);
  assert.doesNotMatch(body, /\b(both|forwards)\b/, 'no forwards fill');
  const frames = keyframes('ph-set-line');
  assert.match(frames, /translateX\(-16px\)/, 'in from 16px to the left, as P10.2 draws it');
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame');
});
