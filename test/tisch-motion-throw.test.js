'use strict';

/* Der Tisch's motion ritual 1 (#1200, T10.1): games thrown into the pot.
 *
 * What jsdom can see is the GATE, and the gate is where this goes wrong: the pot
 * is re-rendered wholesale on every seat tap, stepper press and filter change,
 * so a mark that is not computed against what was already there would re-throw
 * the whole pot on every tap — and one set on the first paint would make the
 * setup screen arrive in motion, which is exactly what #1122 took out of the
 * app. The motion itself (timing, the arc) is not observable here and is judged
 * from a recording.
 *
 * The CSS half pins the contract every ritual shares: declared only inside the
 * motion gate, only under Der Tisch, no `to` frame (so it cannot end anywhere a
 * reduced-motion reader would not see at once), ≤ 900ms including the stagger,
 * never infinite, never touching `pointer-events`.
 *
 * Named for the ritual, colliding with no module basename
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
// Clara owns two boxes, so re-seating her throws TWO games — enough to see the
// index count up and the direction change.
const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
  { id: 'g3', title: 'Dixit', minPlayers: 1, maxPlayers: 8, ownerIds: ['m3'] },
  { id: 'g4', title: 'Just One', minPlayers: 1, maxPlayers: 8 },
  { id: 'g5', title: 'Kartographen', minPlayers: 1, maxPlayers: 8, ownerIds: ['m3'] },
];
const roundFixture = () => ({
  id: 'r1',
  name: 'Freitagsrunde',
  members: MEMBERS.map((m) => ({ ...m })),
  tags: [],
  sessions: [],
  games: GAMES.map((g) => ({ ...g })),
});

async function setup(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  dom.set('showSessionLobby', () => {});
  dom.set('toast', () => {});
  dom.call('applyDesign', design);
  await dom.call('showStartSession', roundFixture());
  await flush();
  return dom;
}

const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const seat = (dom, name) => qa(dom, '.nr-seat').find((s) => s.textContent.includes(name));
const thrownTitles = (dom, sel) => qa(dom, `${sel}.is-thrown`).map((el) => el.getAttribute('title'));

test('the first paint throws nothing — the pot is simply there', async (t) => {
  const dom = await setup(t, 'tisch');
  assert.equal(qa(dom, '.pool-tile').length, 5, 'the whole pot is rendered');
  assert.deepEqual(thrownTitles(dom, '.pool-tile'), [], 'an arriving screen must not be in motion (#1122)');
  assert.deepEqual(thrownTitles(dom, '.pool-thumb'), []);
});

test('a seat tap that adds games throws exactly those, indexed and aimed', async (t) => {
  const dom = await setup(t, 'tisch');
  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.pool-tile').length, 3);
  assert.deepEqual(thrownTitles(dom, '.pool-tile'), [], 'games LEAVING the pot are not thrown anywhere');

  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.pool-tile').length, 5);
  for (const sel of ['.pool-tile', '.pool-thumb']) {
    const thrown = qa(dom, `${sel}.is-thrown`);
    assert.deepEqual(thrown.map((el) => el.getAttribute('title')), ['Dixit', 'Kartographen'],
      `${sel}: only the two games Clara brought back are thrown`);
    assert.deepEqual(thrown.map((el) => el.style.getPropertyValue('--throw-i')), ['0', '1'], `${sel}: the stagger index`);
    assert.deepEqual(thrown.map((el) => el.dataset.throw), ['0', '1'], `${sel}: each from its own direction`);
  }
  // The thumb keeps its cover declaration beside the index (the variadic style
  // attribute exists for exactly this).
  assert.equal(qa(dom, '.pool-thumb.is-thrown')[0].getAttribute('style'), '--throw-i:0');

  // The next write that adds nothing — the stepper — clears the marks rather
  // than re-throwing the same two.
  dom.app.querySelector('.stepper__btn[data-d="1"]').click();
  assert.deepEqual(thrownTitles(dom, '.pool-tile'), [], 'a re-render must not throw again');
});

test('Klassisch never carries a mark', async (t) => {
  const dom = await setup(t, 'klassisch');
  seat(dom, 'Clara').click();
  seat(dom, 'Clara').click();
  assert.equal(qa(dom, '.is-thrown, [data-throw]').length, 0);
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

test('the throw is declared only under Der Tisch, inside the motion gate', () => {
  const users = rulesOf(TISCH_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*tisch-pot-throw/.test(b));
  assert.deepEqual(users.map(([s]) => s.split(',').map((x) => x.trim())).flat(), [
    ':root[data-design="tisch"] .pool-tile.is-thrown',
    ':root[data-design="tisch"] .pool-thumb.is-thrown',
  ]);
  const gated = motionRules.filter(([, b]) => /tisch-pot-throw/.test(b));
  assert.equal(gated.length, users.length, 'every rule running it sits inside prefers-reduced-motion: no-preference');
  const body = gated[0][1];
  assert.doesNotMatch(body, /infinite/);
  assert.doesNotMatch(body, /pointer-events/);
  // 540ms + the capped stagger (4 × 90ms) is the 900ms ceiling, not over it.
  assert.match(body, /tisch-pot-throw 540ms /);
  assert.match(body, /calc\(min\(var\(--throw-i, 0\), 4\) \* 90ms\)/);
  assert.ok(540 + 4 * 90 <= 900);
});

test('the throw has no end frame, so it ends in the rest state', () => {
  const frames = keyframes('tisch-pot-throw');
  assert.ok(frames, 'the keyframes exist');
  assert.match(frames, /\bfrom\s*\{/);
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'an explicit end frame could disagree with the rest state');
  // Five directions, one per `data-throw` value the view can write.
  for (let d = 0; d < 5; d++) {
    assert.ok(motionRules.some(([s]) => s === `:root[data-design="tisch"] .is-thrown[data-throw="${d}"]`),
      `direction ${d} is declared`);
  }
});
