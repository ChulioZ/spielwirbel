'use strict';

/* Die Brücke's motion ritual 2 (#1248, B10.2): „Der Pool zählt hoch" — when a
 * seat or a filter changes the pool, the numeral counts to its new value in
 * 500ms and the titles that enter the list drive in.
 *
 * Two halves, one gate. The rows take Der Tisch's T10.1 pot bookkeeping (as
 * Das Programmheft's P10.2 does): the first paint is still (#1122), leaving
 * rows mark nothing, and a re-render marks nothing. The count runs only on a
 * numeral that was already on screen, asks the motion gate POSITIVELY, and
 * writes the final value first — so a tab that never runs a frame, reduced
 * motion and jsdom all show the right number.
 *
 * Named for the design and the ritual (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
// Clara owns seven boxes, so unseating her takes the pool from 8 to 1 and
// reseating her brings seven rows back — enough to reach the stagger cap.
const GAMES = [
  { id: 'g01', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `g${10 + i}`, title: `Spiel ${i + 1}`, minPlayers: 1, maxPlayers: 8, ownerIds: ['m3'] })),
];
const roundFixture = () => ({
  id: 'r1', name: 'Freitagsrunde', tags: [], sessions: [],
  members: MEMBERS.map((m) => ({ ...m })), games: GAMES.map((g) => ({ ...g })),
});

/* `motion`: whether the page answers prefers-reduced-motion: no-preference.
   Frames are held in a queue the test runs by hand, with the timestamps it
   chooses — jsdom's own clock would make the run's values a race. */
async function setup(t, design, motion = false) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  dom.set('showSessionLobby', () => {});
  dom.set('toast', () => {});
  dom.set('api', async () => roundFixture());
  dom.run(`window.matchMedia = (q) => ({ matches: ${motion} && /no-preference/.test(q), addEventListener() {}, removeEventListener() {} });
    window.__frames = []; window.requestAnimationFrame = (cb) => { window.__frames.push(cb); return window.__frames.length; };`);
  dom.call('applyDesign', design);
  await dom.call('showStartSession', roundFixture());
  await flush();
  return dom;
}
// Run every frame queued so far at time `ms`; return how many ran.
const frame = (dom, ms) => dom.run(`(() => { const q = window.__frames; window.__frames = []; q.forEach((cb) => cb(${ms})); return q.length; })()`);

const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const seat = (dom, name) => qa(dom, '.nr-seat').find((s) => s.textContent.includes(name));
const count = (dom) => dom.app.querySelector('#poolTitle .pool-count').textContent;
const set = (dom) => qa(dom, '.bruecke-pool .pool-tile.is-set');

test('the first paint is still: the numeral reads the count, no row is marked, no frame is asked for', async (t) => {
  const dom = await setup(t, 'bruecke', true);
  assert.equal(count(dom), '8');
  assert.equal(set(dom).length, 0, 'an arriving screen must not be in motion (#1122)');
  assert.equal(frame(dom, 0), 0, 'nothing counts on arrival');
});

test('a seat tap counts the numeral from the old value to the new in 500ms', async (t) => {
  const dom = await setup(t, 'bruecke', true);
  seat(dom, 'Clara').click();
  assert.equal(count(dom), '1', 'the final value is written first');
  frame(dom, 1000);
  assert.equal(count(dom), '8', 'the first frame puts the old value back before anything is painted');
  frame(dom, 1250);
  const mid = Number(count(dom));
  assert.ok(mid > 1 && mid < 8, `half way it stands between the two (${mid})`);
  frame(dom, 1500);
  assert.equal(count(dom), '1', 'and lands on the new value at 500ms');
  assert.equal(frame(dom, 1600), 0, 'then it stops asking for frames');
});

test('a change mid-run carries on from the number on screen, and the detached numeral stops', async (t) => {
  const dom = await setup(t, 'bruecke', true);
  seat(dom, 'Clara').click();
  frame(dom, 0);
  frame(dom, 100);
  const shown = Number(count(dom));
  seat(dom, 'Clara').click();
  assert.equal(frame(dom, 200), 2, 'the old run and the new one each had a frame queued');
  assert.equal(count(dom), String(shown), 'the new run starts where the old one stood');
  assert.equal(frame(dom, 300), 1, 'the detached numeral asked for no more frames — only the new run goes on');
  frame(dom, 700);
  assert.equal(count(dom), '8');
  assert.equal(frame(dom, 800), 0);
});

test('reduced motion, a re-render and Klassisch never count', async (t) => {
  const reduced = await setup(t, 'bruecke', false);
  seat(reduced, 'Clara').click();
  assert.equal(count(reduced), '1');
  assert.equal(frame(reduced, 0), 0, 'reduced motion: the number simply stands');

  const rerender = await setup(t, 'bruecke', true);
  await rerender.run('currentView()');
  await flush();
  assert.equal(frame(rerender, 0), 0, 'a language switch is not a change to the pool');

  const klassisch = await setup(t, 'klassisch', true);
  seat(klassisch, 'Clara').click();
  assert.equal(frame(klassisch, 0), 0);
});

test('a seat tap marks exactly the titles that enter, the stagger index from the shared pot bookkeeping', async (t) => {
  const dom = await setup(t, 'bruecke');
  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.bruecke-pool .pool-tile').length, 1);
  assert.equal(set(dom).length, 0, 'titles leaving mark nothing, and the one staying stays put');

  seat(dom, 'Clara').click();
  assert.deepEqual(set(dom).map((el) => el.getAttribute('title')), GAMES.slice(1).map((g) => g.title),
    'the seven games Clara brought back, and not Azul');
  assert.deepEqual(set(dom).map((el) => el.style.getPropertyValue('--set-i')), ['0', '1', '2', '3', '4', '5', '6']);
  assert.equal(qa(dom, '.pool-tile.is-thrown, .pool-tile[data-throw]').length, 0, 'Der Tisch’s throw is not borrowed');

  await dom.run('currentView()');
  await flush();
  assert.equal(set(dom).length, 0, 'a re-render marks nothing');
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

const ROW = ':root[data-design="bruecke"][data-scheme="dark"] .bruecke-pool .setup-panel__body .pool-tile.is-set';

test('bruecke-pool-in: Brücke only, inside the motion gate, any pool lands by 500ms, no end frame', () => {
  const users = rulesOf(CSS).filter(([, b]) => /animation[-a-z]*:[^;]*bruecke-pool-in\b/.test(b));
  assert.deepEqual(users.map(([s]) => s), [ROW], 'exactly one rule runs it, on a marked row of the Brücke pool');
  const gated = motionRules.filter(([s, b]) => s === ROW && b.includes('bruecke-pool-in'));
  assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
  const body = gated[0][1];
  const m = /bruecke-pool-in (\d+)ms [^;]*calc\(min\(var\(--set-i, 0\), (\d+)\) \* (\d+)ms\) backwards/.exec(body);
  assert.ok(m, 'duration, the capped stagger and a backwards fill');
  const [, dur, cap, step] = m.map(Number);
  assert.ok(dur + cap * step <= 500, `the last row lands by ${dur + cap * step}ms, inside B10.2's 500ms`);
  assert.doesNotMatch(body, /infinite|pointer-events/);
  assert.doesNotMatch(body, /\b(both|forwards)\b/, 'no forwards fill');
  const frames = keyframes('bruecke-pool-in');
  assert.ok(frames, 'the keyframes exist');
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it ends on the rest state');
});
