'use strict';

/* Forest's motion ritual 3 (#1476, F10.3 „Die Stimme glimmt"):
 * Forest-F10-Motion.dc.html. Behind the face just chosen a halo opens, and the
 * face lifts 6px; the others stay still, and „Weiter" is usable throughout.
 *
 * The gate is `.vote--advancing` (vote-advance.js), as for Ocean's O10.3 pick
 * and Das Programmheft's P10.3 stamp: only the card showing a FRESH tap carries
 * it, so a choice already made — „Zurück", the review — arrives at rest. The
 * next card comes at 340ms (VOTE_ADVANCE_MS), so the whole ritual is over by
 * 300ms: the sheet's ≈ 0,5 s, fitted inside the beat.
 *
 * The END frame is static, not animated: the chosen face rests 6px up with its
 * halo, at every motion setting — the sheet's „Endzustand / reduziert".
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { mediaBlocks, rulesOf, topLevel } = require('./support/css');
const { setMotion, beat } = require('./support/vote-card');

const GATE = ':root[data-design="forest"]:not([data-scheme="dark"]) ';

const GAMES = [
  { id: 'g1', title: 'Kartographen', minPlayers: 2, maxPlayers: 5 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
];
const voteRound = () => ({
  id: 'r1', name: 'Donnerstagsrunde', background: null, tags: [], sessions: [],
  members: [{ id: 'm1', name: 'Anna' }], games: GAMES.map((g) => ({ ...g })),
});
const voteSession = () => ({
  id: 's1', createdAt: '2026-09-24T18:00:00.000Z', gameIds: GAMES.map((g) => g.id), memberIds: ['m1'],
  guests: [], votes: {}, votedIds: [], done: false, cancelled: false, finished: false,
  winnerIds: [], chosenGameId: null,
});

async function wizard(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async () => voteRound());
  dom.set('currentUserId', () => null);
  await dom.call('startVoting', voteRound(), voteSession(), GAMES, [{ id: 'm1', name: 'Anna', guest: false }], {
    skipIntro: true, saveVotes: async () => {}, onSaved: async () => {},
  });
  return dom;
}

const GLOW = `${GATE}.vote--forest.vote--advancing .rating .mood.is-selected .ti`;
const title = (dom) => dom.app.querySelector('.vote__title').firstChild.textContent.trim();

test('the glow is on the face just chosen, on the card showing it, and only there', async (t) => {
  const dom = await wizard(t, 'forest');
  assert.equal(dom.document.querySelector(GLOW), null, 'the first card: nothing chosen, nothing glows');

  dom.app.querySelectorAll('.mood')[3].click();
  const lit = dom.document.querySelectorAll(GLOW);
  assert.equal(lit.length, 1, 'exactly one face glows');
  assert.equal(lit[0].closest('.mood'), dom.app.querySelectorAll('.mood')[3], 'and it is the one tapped');

  await beat(dom);
  assert.equal(title(dom), 'Azul');
  assert.equal(dom.document.querySelector(GLOW), null, 'the next card arrives at rest');
});

test('Klassisch never matches the glow', async (t) => {
  const dom = await wizard(t, 'klassisch');
  dom.app.querySelectorAll('.mood')[3].click();
  assert.equal(dom.document.querySelector(GLOW), null);
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

test('the chosen face RESTS 6px up with its halo, at every motion setting (the end frame)', () => {
  const rest = rulesOf(topLevel(FOREST_CSS)).find(([s]) => s.trim() === `${GATE}.vote--forest .rating .mood.is-selected .ti`);
  assert.ok(rest, 'the chosen face\'s own rule, outside any media block');
  assert.match(rest[1], /translate:\s*0 -6px/, 'lifted 6px at rest');
  assert.match(rest[1], /box-shadow:\s*0 0 0 6px var\(--gold-soft\)/, 'its halo at rest');
});

test('forest-glow and forest-lift: on the advancing Forest card only, gated, over inside the 340ms beat', () => {
  for (const name of ['forest-glow', 'forest-lift']) {
    const users = rulesOf(FOREST_CSS).filter(([, b]) => new RegExp(`animation[-a-z]*:[^;]*\\b${name}\\b`).test(b));
    assert.deepEqual(users.map(([s]) => s.trim()), [GLOW], `${name}: exactly one rule runs it`);
    const frames = keyframes(name);
    assert.ok(frames, `${name}: the keyframes exist`);
    assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, `${name}: no end frame — it lands on the rest state`);
  }
  const gated = motionRules.filter(([s]) => s.trim() === GLOW);
  assert.equal(gated.length, 1, 'the rule sits inside prefers-reduced-motion: no-preference');
  const body = gated[0][1];
  assert.doesNotMatch(body, /infinite|pointer-events|\b(both|forwards)\b/);
  const spans = [...body.matchAll(/forest-(?:glow|lift) (\d+)ms [^,;]*?(?: (\d+)ms)?(?=[,;]|\s*backwards)/g)]
    .map(([, dur, delay]) => Number(dur) + Number(delay || 0));
  assert.equal(spans.length, 2, 'both timings read');
  assert.ok(Math.max(...spans) <= 300, `over by 300ms, inside the 340ms beat — got ${Math.max(...spans)}ms`);
  assert.match(keyframes('forest-lift'), /translate:\s*0 0/, 'the face lifts from its place');
  assert.match(keyframes('forest-glow'), /box-shadow:\s*0 0 0 0 var\(--gold-soft\)/, 'the halo opens from nothing');
});
