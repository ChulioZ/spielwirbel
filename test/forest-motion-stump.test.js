'use strict';

/* Forest's motion ritual 2 (#1476, F10.2 „Der Stumpf füllt sich"):
 * Forest-F10-Motion.dc.html. Each game that newly fits drops onto the stump as
 * a leaf and springs 6px, 80ms after the one before it.
 *
 * The gate is the one Der Tisch's T10.1, Das Programmheft's P10.2 and Die
 * Brücke's B10.2 share (views-session-setup-pool.js `potThrows`): the first paint is still
 * (#1122), games LEAVING the stump set nothing, and a re-render of the screen
 * on show sets nothing. Forest takes the shared `is-set` mark and `--set-i`
 * index; only forest.css says what a set cover does.
 *
 * The stagger index is capped at 9 in views-session.js, so any number of
 * entering covers is down inside the sheet's ≈ 1,2 s.
 *
 * Not built: the sheet's „fällt ein Spiel heraus, weht es in 300 ms zur Seite".
 * The pot is rebuilt from scratch on every change, so a leaving cover is gone
 * before anything could move it — no design's pot animates an exit.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
// Clara owns eleven boxes, so reseating her brings eleven covers back — enough
// to reach the stagger cap.
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
const set = (dom) => qa(dom, '.forest-pot .pool-tile.is-set');

test('the first paint drops nothing — the stump is simply set', async (t) => {
  const dom = await setup(t, 'forest');
  assert.equal(qa(dom, '.forest-pot .pool-tile').length, 12);
  assert.equal(set(dom).length, 0, 'an arriving screen must not be in motion (#1122)');
});

test('a seat tap drops exactly the covers that enter, the stagger capped at the ninth', async (t) => {
  const dom = await setup(t, 'forest');
  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.forest-pot .pool-tile').length, 1);
  assert.equal(set(dom).length, 0, 'covers leaving the stump drop nothing, and the one staying stays put');

  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.forest-pot .pool-tile').length, 12);
  assert.deepEqual(set(dom).map((el) => el.getAttribute('title')), GAMES.slice(1).map((g) => g.title),
    'the eleven games Clara brought back, and not Azul');
  assert.deepEqual(set(dom).map((el) => el.style.getPropertyValue('--set-i')),
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '9'],
    'the tenth cover onward lands with the ninth');
  assert.equal(qa(dom, '.pool-tile.is-thrown, .pool-tile[data-throw]').length, 0, 'Der Tisch’s throw is not borrowed');
});

test('a re-render of the screen on show drops nothing', async (t) => {
  const dom = await setup(t, 'forest');
  seat(dom, 'Clara').click();
  seat(dom, 'Clara').click();
  await dom.run('currentView()');
  await flush();
  assert.equal(qa(dom, '.forest-pot .pool-tile').length, 12);
  assert.equal(set(dom).length, 0, 'a language switch is not a change to the stump');
});

/* ---------------------------------------------------------- the CSS contract */

const FOREST_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'forest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(FOREST_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));

function keyframes(name) {
  const m = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(FOREST_CSS);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; depth > 0; i++) {
    if (FOREST_CSS[i] === '{') depth++;
    else if (FOREST_CSS[i] === '}') depth--;
  }
  return FOREST_CSS.slice(m.index + m[0].length, i - 1);
}

const COVER = ':root[data-design="forest"]:not([data-scheme="dark"]) .forest-pot .pool-tile.is-set .pool-tile__img';

test('forest-drop: Forest only, inside the motion gate, the ninth cover down by ≈ 1,2 s, no end frame', () => {
  const users = rulesOf(FOREST_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*forest-drop/.test(b));
  assert.deepEqual(users.map(([s]) => s.trim()), [COVER], 'exactly one rule runs it, on the cover');
  const gated = motionRules.filter(([s, b]) => s.trim() === COVER && b.includes('forest-drop'));
  assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
  const body = gated[0][1];
  const m = /forest-drop (\d+)ms [^;]*calc\(var\(--set-i, 0\) \* (\d+)ms\)/.exec(body);
  assert.ok(m, 'duration and stagger read from --set-i');
  assert.equal(Number(m[1]), 520, 'F10.2: 520ms a leaf');
  assert.equal(Number(m[2]), 80, 'F10.2: 80ms between leaves');
  assert.ok(9 * Number(m[2]) + Number(m[1]) <= 1250, 'the ninth cover is down by ≈ 1,2 s');
  assert.doesNotMatch(body, /infinite|pointer-events/);
  assert.doesNotMatch(body, /\b(both|forwards)\b/, 'no forwards fill');
  const frames = keyframes('forest-drop');
  assert.ok(frames, 'the keyframes exist');
  assert.match(frames, /translate:\s*0 6px/, 'it springs 6px past its place');
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it lands on the cover as it rests');
  assert.doesNotMatch(frames, /(^|[;\s{])transform\s*:/,
    'it moves `translate`, never `transform`, which holds each cover\'s resting tilt');
});
