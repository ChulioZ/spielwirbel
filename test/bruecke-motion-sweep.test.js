'use strict';

/* Die Brücke's continuous movement (#1248, B10.5): the radar sweep on the
 * Missionskontrolle — a cyan cone turning round the ignition, 4s linear,
 * endless. The one ritual here that loops, and the first candidate to cut.
 *
 * What the sheet pins, and this spec with it:
 *   - only while the round is ready: the cone hangs off an ignition holding an
 *     ENABLED button, and an empty shelf locks that button — so the premise
 *     (ready ⇔ enabled) is tested against the hub itself;
 *   - under reduced motion it stands as a still cone: the cone is drawn
 *     outside the motion gate, only the turn sits inside it.
 *
 * Named for the design and the ritual (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const RID = 'r1';
const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [] },
  { id: 'g2', title: 'Carcassonne', minPlayers: 2, maxPlayers: 5, tagIds: [] },
];
const roundWith = (games) => ({
  id: RID, name: 'WG Kastanienallee', background: null, tags: [], providers: [],
  members: [{ id: 'm1', name: 'Aylin' }, { id: 'm2', name: 'Ben' }], games, sessions: [],
});

async function hub(t, design, games) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  const round = roundWith(games);
  dom.set('api', async (method, url) => {
    if (/recommendations/.test(url)) return { recommendations: [] };
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('canImportBgg', () => false);
  await dom.call('showRound', RID, 'start');
  return dom;
}

const SWEEPING = '.bruecke-mission__ignition:has(> .bruecke-mission__fire:not(:disabled))';

test('a ready round sweeps; an empty shelf locks the ignition, so nothing sweeps', async (t) => {
  const ready = await hub(t, 'bruecke', GAMES);
  assert.equal(ready.app.querySelectorAll(SWEEPING).length, 1, 'the ready hub holds exactly one sweeping ignition');

  const empty = await hub(t, 'bruecke', []);
  assert.ok(empty.app.querySelector('.bruecke-mission__ignition'), 'the empty hub still draws the rings');
  assert.equal(empty.app.querySelector(SWEEPING), null, 'B7: the dashed ring stands still');
});

test('Klassisch has no ignition to sweep', async (t) => {
  const dom = await hub(t, 'klassisch', GAMES);
  assert.equal(dom.app.querySelector('.bruecke-mission__ignition'), null);
});

/* ---------------------------------------------------------- the CSS contract */

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'bruecke.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = mediaBlocks(CSS);
const motionRules = blocks
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));
const CONE = `:root[data-design="bruecke"][data-scheme="dark"] ${SWEEPING}::before`;

test('the cone stands outside the gate, so reduced motion keeps it still', () => {
  const gatedCss = blocks.map(([, css]) => css).join('\n');
  const outside = rulesOf(CSS).filter(([s, b]) => s === CONE && !gatedCss.includes(b));
  assert.equal(outside.length, 1, 'one ungated rule draws the cone');
  const body = outside[0][1];
  assert.match(body, /conic-gradient\(from 0deg, var\(--glow-accent\), transparent 26%\)/);
  assert.match(body, /pointer-events:\s*none/, 'pure picture');
  assert.doesNotMatch(body, /animation/, 'and does not turn it');
});

test('only the turn is gated: 4s linear, the one infinite run in the design', () => {
  const users = rulesOf(CSS).filter(([, b]) => /animation[-a-z]*:[^;]*bruecke-sweep\b/.test(b));
  assert.deepEqual(users.map(([s]) => s), [CONE], 'exactly one rule turns it');
  const gated = motionRules.filter(([s, b]) => s === CONE && b.includes('bruecke-sweep'));
  assert.equal(gated.length, 1, 'inside prefers-reduced-motion: no-preference');
  assert.match(gated[0][1], /animation:\s*bruecke-sweep 4s linear infinite/);
  const infinite = rulesOf(CSS).filter(([, b]) => /animation[-a-z]*:[^;]*\binfinite\b/.test(b));
  assert.deepEqual(infinite.map(([s]) => s), [CONE], 'nothing else in Die Brücke loops');
});
