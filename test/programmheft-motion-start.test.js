'use strict';

/* Das Programmheft's motion ritual 1 (#1382, P10.1): „Start" — the setup
 * opens as an issue being set: the title „Neue Session" is wiped in from the
 * left and the 4px page rule runs out after it.
 *
 * The sheet (Programmheft-P10-Motion.dc.html) opens with the hub box's whirl
 * turning and the box growing down into the page. Both happen on the HUB,
 * which the press replaces in the same task — nothing there is ever painted,
 * and holding the navigation for it would be the #1122 mistake. So the ritual
 * is the setup's half: the setting of the head.
 *
 * One gate, a one-shot: the head opens only when the setup ARRIVES — from the
 * hub, the rail, a deep link or „Noch eine Session" — never when it re-renders
 * itself (a language switch through currentView), which would replay a ritual
 * nobody asked for.
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
  games: [{ id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 }],
});

async function setup(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  dom.set('api', async () => roundFixture());
  dom.call('applyDesign', design);
  await dom.call('showStartSession', roundFixture());
  await flush();
  return dom;
}
const opening = (dom) => dom.app.querySelector('.page-head[data-opening]');

test('the setup head opens on arrival, under Das Programmheft only', async (t) => {
  const dom = await setup(t, 'programmheft');
  assert.ok(opening(dom), 'arriving at the setup sets the head');
  assert.ok(opening(dom).classList.contains('page-head--ph-setup'));

  // A language switch re-renders through currentView: the screen was already
  // there, so nothing is set again.
  await dom.run('currentView()');
  await flush();
  assert.ok(dom.app.querySelector('.page-head--ph-setup'), 'still the programme setup');
  assert.equal(opening(dom), null, 'a re-render must not replay the opening');
});

test('Klassisch never opens', async (t) => {
  const dom = await setup(t, 'klassisch');
  assert.equal(opening(dom), null);
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

const HEAD = ':root[data-design="programmheft"] .page-head--ph-setup[data-opening] h1';
const RULE = ':root[data-design="programmheft"]:not([data-scheme="dark"]) .page-head--ph-setup[data-opening] h1::after';

for (const [name, selector, timing] of [
  ['ph-set', HEAD, /ph-set 360ms /],
  ['ph-rule-run', RULE, /ph-rule-run 360ms [^;]*135ms/],
]) {
  test(`${name}: Programmheft only, inside the motion gate, ends by 900ms, no end frame`, () => {
    const users = rulesOf(PH_CSS).filter(([, b]) => new RegExp(`animation[-a-z]*:[^;]*${name}`).test(b));
    assert.deepEqual(users.map(([s]) => s), [selector], 'exactly one rule runs it, under Das Programmheft');
    const gated = motionRules.filter(([s, b]) => s === selector && b.includes(name));
    assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
    const body = gated[0][1];
    assert.match(body, timing);
    assert.doesNotMatch(body, /infinite|pointer-events/);
    assert.doesNotMatch(body, /\b(both|forwards)\b/, 'no forwards fill: nothing is held after the ritual');
    const frames = keyframes(name);
    assert.ok(frames, 'the keyframes exist');
    assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it ends on the rest state');
  });
}

test('while the head opens, the rule is drawn by the pseudo-element alone', () => {
  // The h1's own border would be wiped in WITH the title; the ritual wants the
  // rule to run after it. So inside the gate the border goes transparent and
  // ::after carries the rule — at rest the same 4px of ink in the same place.
  const swap = motionRules.find(([s]) => s === ':root[data-design="programmheft"]:not([data-scheme="dark"]) .page-head--ph-setup[data-opening] h1');
  assert.ok(swap, 'the border swap is gated too');
  assert.match(swap[1], /border-bottom-color:\s*transparent/);
  const rule = motionRules.find(([s]) => s === RULE);
  assert.match(rule[1], /height:\s*var\(--rule-page\)/);
  assert.match(rule[1], /background:\s*var\(--ink\)/);
});

test('the title rests on inset(0), so the wipe has something to interpolate to', () => {
  // inset(…) → none is not interpolable: the clip jumps instead of wiping
  // (measured in the Browser pane — the whole title stood at 90ms of 360).
  const head = motionRules.find(([s]) => s === HEAD);
  assert.match(head[1], /clip-path:\s*inset\(0\)/);
  assert.match(keyframes('ph-set'), /clip-path:\s*inset\(0 100% 0 0\)/);
});
