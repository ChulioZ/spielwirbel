'use strict';

/* Ocean's one ambient movement (#1221, O10.3 „Tidenlinie"): the lobby tiles'
 * tide lines lift 6px and settle, 6s, endlessly — on the Küste and nowhere
 * else, and still under reduced motion.
 *
 * "Nowhere else" is the gate, and the selector is a class, so it holds only as
 * long as the class is drawn only by the lobby. The spec pins both halves: the
 * lobby draws one per tile, and nothing else in public/js emits the class.
 * The CSS half pins O10.3's loop and O10.4's rules.
 *
 * Named for the design and the ritual (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"]) ';
const TIDE = `${GATE}.round-card__tide`;

const summary = (id, name) => ({
  id, name, marker: 2, background: null,
  members: [{ id: 'm1', name: 'Marco' }], gameCount: 12, playedCount: 23,
  lastPlayed: null, openSessions: [],
});

async function lobby(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('accountsActive', () => false);
  dom.set('api', async () => [summary('r1', 'Donnerstagsrunde'), summary('r2', 'Familie')]);
  await dom.call('showHome');
  return dom;
}

test('the Ocean lobby: every tile\'s tide line is the one that moves', async (t) => {
  const dom = await lobby(t, 'ocean');
  const tiles = dom.app.querySelectorAll('.round-card--ocean');
  assert.equal(tiles.length, 2);
  const tides = dom.document.querySelectorAll(TIDE);
  assert.equal(tides.length, 2, 'one per tile');
  tides.forEach((el) => assert.ok(el.closest('.round-card__water'), 'inside the tile\'s water'));
});

test('Klassisch draws no tide line to move', async (t) => {
  const dom = await lobby(t, 'klassisch');
  assert.equal(dom.document.querySelector('.round-card__tide'), null);
});

test('nothing but the lobby tile emits the class — the movement stays on the Küste', () => {
  const dir = path.join(__dirname, '..', 'public', 'js');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  });
  walk(dir);
  assert.ok(files.length > 50, `scanned ${files.length} files`);
  const hits = files.filter((f) => fs.readFileSync(f, 'utf8').includes('round-card__tide'))
    .map((f) => path.relative(dir, f));
  assert.deepEqual(hits, ['ocean-hub.js']);
  const hub = fs.readFileSync(path.join(dir, 'ocean-hub.js'), 'utf8');
  assert.equal(hub.split('round-card__tide').length - 1, 1, 'drawn once, by oceanRoundCard');
  const callers = files.filter((f) => /\boceanRoundCard\(/.test(fs.readFileSync(f, 'utf8'))
    && !f.endsWith('ocean-hub.js')).map((f) => path.relative(dir, f));
  assert.deepEqual(callers, ['views-home.js'], 'and oceanRoundCard is the lobby\'s alone');
});

/* ---------------------------------------------------------- the CSS contract */

const OCEAN_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

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

test('the tide: 6s ease-in-out, endless, only inside the motion gate', () => {
  const users = rulesOf(OCEAN_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*ocean-tide/.test(b));
  assert.deepEqual(users.map(([s]) => s), [TIDE], 'exactly one rule runs it');
  const gated = mediaBlocks(OCEAN_CSS).filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .flatMap(([, css]) => rulesOf(css)).filter(([s, b]) => s === TIDE && b.includes('ocean-tide'));
  assert.equal(gated.length, 1, 'and it stands still under reduced motion');
  assert.match(gated[0][1], /animation:\s*ocean-tide 6s ease-in-out infinite;/);
});

test('the tide: 0 → -6px → 0, beginning and ending on the resting line, never into the water', () => {
  const frames = keyframes('ocean-tide');
  assert.ok(frames, 'the keyframes exist');
  assert.doesNotMatch(frames, /(^|[\s}])(from|to|0%|100%)\s*\{/, 'no end frames: both ends are the rest');
  const ys = [...frames.matchAll(/translateY\((-?\d+(?:\.\d+)?)px\)/g)].map((m) => Number(m[1]));
  assert.deepEqual(ys, [-6], 'one lift of 6px, at the half');
  assert.match(frames, /50%\s*\{\s*transform:\s*translateY\(-6px\);\s*\}/);
});
