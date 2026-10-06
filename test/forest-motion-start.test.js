'use strict';

/* Forest's motion ritual 1 (#1476, F10.1 „Start"): Forest-F10-Motion.dc.html.
 *
 * The sheet plays it on the HUB — the stump's heart gives (scale .96) and eight
 * leaves whirl out of it — and then changes to Neue Session. The second half
 * cannot be shown there: the press replaces the hub in the same task, so a
 * whirl on the hub is never painted, and holding the navigation for it is
 * #1122's mistake (Das Programmheft's P10.1 met the same wall). So it splits
 * along what IS painted:
 *
 *   - the PRESS stays on the hub — `:active` is painted while the pointer is
 *     down, before the click navigates;
 *   - the LEAVES whirl in on arrival at Neue Session — the count's leaves
 *     (F4.1), the picture of how many fly. Decoration only: the covers on the
 *     stump arrive still, as the #1122 ruling and Das Programmheft's P10.2 PR
 *     decided for every pot.
 *
 * What is testable is the gate: only an ARRIVAL whirls, never a re-render of
 * the screen on show, never a count change after it, never Klassisch.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const roundFixture = () => ({
  id: 'r1', name: 'Freitagsrunde', background: null, tags: [], sessions: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, title: `Spiel ${i + 1}`, minPlayers: 1, maxPlayers: 8 })),
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
const opening = (dom) => dom.app.querySelector('.forest-leaves[data-opening]');

test('arriving at Neue Session whirls the count\'s leaves in, under Forest', async (t) => {
  const dom = await setup(t, 'forest');
  assert.ok(opening(dom), 'an arrival marks the leaves');
  assert.ok(opening(dom).children.length > 0, 'and there are leaves to whirl');
  assert.equal(dom.app.querySelectorAll('.pool-tile.is-whirl, .pool-tile.is-set').length, 0,
    'the covers on the stump arrive still (#1122)');
});

test('a re-render of the screen on show does not whirl again', async (t) => {
  const dom = await setup(t, 'forest');
  await dom.run('currentView()');
  await flush();
  assert.ok(dom.app.querySelector('.forest-leaves'), 'still the Forest setup');
  assert.equal(opening(dom), null, 'a language switch must not replay the arrival');
});

test('a count change after the arrival repaints the leaves still', async (t) => {
  const dom = await setup(t, 'forest');
  const row = dom.app.querySelector('.forest-leaves');
  const before = row.children.length;
  dom.app.querySelector('.stepper button:last-child').click();
  await flush();
  assert.notEqual(row.children.length, before, 'the stepper did change the count');
  assert.equal(opening(dom), null, 'the new leaves do not whirl — only the arrival does');
});

test('Klassisch has no leaves and no opening', async (t) => {
  const dom = await setup(t, 'klassisch');
  assert.equal(dom.app.querySelector('.forest-leaves'), null);
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

const LEAF = ':root[data-design="forest"]:not([data-scheme="dark"]) .forest-leaves[data-opening] .forest-leaves__leaf';

test('forest-whirl: Forest only, inside the motion gate, ends on the rest state', () => {
  const users = rulesOf(FOREST_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*forest-whirl/.test(b));
  assert.deepEqual(users.map(([s]) => s.trim()), [LEAF], 'exactly one rule runs it, on the leaves');
  const gated = motionRules.filter(([s, b]) => s.trim() === LEAF && b.includes('forest-whirl'));
  assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
  const body = gated[0][1];
  assert.match(body, /forest-whirl 900ms /);
  assert.doesNotMatch(body, /infinite|\b(both|forwards)\b/, 'no loop, nothing held after the ritual');
  const frames = keyframes('forest-whirl');
  assert.ok(frames, 'the keyframes exist');
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it lands on the leaves as they rest');
  assert.doesNotMatch(frames, /(^|[;\s{])transform\s*:/,
    'it moves `translate`/`rotate`/`scale`, never `transform`, which holds each leaf\'s resting tilt');
});

test('the stagger is 40ms a leaf, so eight leaves land by 1 180ms (F10.1)', () => {
  const lines = motionRules.filter(([s]) => s.includes('.forest-leaves[data-opening] .forest-leaves__leaf:nth-child'));
  const delays = lines.map(([, b]) => /animation-delay:\s*(\d+)ms/.exec(b)[1]).map(Number);
  assert.deepEqual(delays, [40, 80, 120, 160, 200, 240, 280], 'leaves 2–8, each 40ms after the one before');
});

test('the hub\'s stump gives under the press: scale .96, the focus ring untouched', () => {
  const press = rulesOf(FOREST_CSS).find(([s]) => /\.forest-stump__core:not\(:disabled\):active\s*$/.test(s.trim()));
  assert.ok(press, 'a press rule on the stump\'s heart');
  assert.match(press[1], /scale:\s*\.96/);
  assert.doesNotMatch(press[1], /outline/, 'the focus ring stays as it is');
  const eased = motionRules.find(([s, b]) => /\.forest-stump__core\s*$/.test(s.trim()) && /transition:[^;]*scale/.test(b));
  assert.ok(eased, 'the give is eased only where motion is welcome');
});
