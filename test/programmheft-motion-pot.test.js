'use strict';

/* Das Programmheft's motion ritual 2 (#1382, P10.2): „Der Topf" — the rows a
 * seat tap or a filter brings into the pot are SET, not poured: each moves in
 * 16px from the left, 120ms after the one before it.
 *
 * The gate is Der Tisch's T10.1 (test/tisch-motion-throw.test.js): the first
 * paint is still (#1122) — the sheet sets the whole arriving pot and counts the
 * numeral up, and both were dropped at the PR — rows leaving set nothing, and a
 * re-render of the screen on show sets nothing.
 *
 * The stagger index is capped at 9, so any number of entering rows is set
 * inside the sheet's 1 400ms: the tenth onward lands with the ninth.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
// Clara owns eleven boxes, so reseating her brings eleven rows back — enough to
// reach the stagger cap.
const GAMES = [
  { id: 'g01', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  ...Array.from({ length: 11 }, (_, i) => ({ id: `g${10 + i}`, title: `Spiel ${i + 1}`, minPlayers: 1, maxPlayers: 8, ownerIds: ['m3'] })),
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

test('the first paint sets nothing — the pot is simply there', async (t) => {
  const dom = await setup(t, 'programmheft');
  assert.equal(qa(dom, '.pool-tile').length, 12);
  assert.equal(set(dom).length, 0, 'an arriving screen must not be in motion (#1122)');
  assert.equal(dom.app.querySelector('#poolTitle .pool-count').textContent, '12', 'and the numeral simply reads the count');
});

test('a seat tap sets exactly the rows that enter, the stagger capped at the ninth', async (t) => {
  const dom = await setup(t, 'programmheft');
  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.pool-tile').length, 1);
  assert.equal(set(dom).length, 0, 'rows leaving the pot set nothing, and the one staying stays put');

  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.pool-tile').length, 12);
  assert.deepEqual(set(dom).map((el) => el.getAttribute('title')), GAMES.slice(1).map((g) => g.title),
    'the eleven games Clara brought back, and not Azul');
  assert.deepEqual(set(dom).map((el) => el.style.getPropertyValue('--set-i')),
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '9'],
    'the tenth row onward lands with the ninth, so any number is set inside 1 400ms');
  assert.equal(qa(dom, '.pool-tile.is-thrown, .pool-tile[data-throw]').length, 0, 'Der Tisch’s throw is not borrowed');
});

test('a re-render of the screen on show sets nothing', async (t) => {
  const dom = await setup(t, 'programmheft');
  seat(dom, 'Clara').click();
  seat(dom, 'Clara').click();
  await dom.run('currentView()');
  await flush();
  assert.equal(qa(dom, '.pool-tile').length, 12);
  assert.equal(set(dom).length, 0, 'a language switch is not a change to the pot');
});

test('Klassisch and Der Tisch never set a row', async (t) => {
  for (const design of ['klassisch', 'tisch']) {
    const dom = await setup(t, design);
    seat(dom, 'Clara').click();
    seat(dom, 'Clara').click();
    assert.equal(set(dom).length, 0, design);
  }
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
