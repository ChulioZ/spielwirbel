'use strict';

/* Das Programmheft's motion ritual 3 (#1382, P10.3): „Die Stimme" — the cell
 * just chosen is STAMPED: pressed 2px, then filled with ink from the bottom in
 * 180ms, the number flipping to the fill's ink as the fill passes it. The
 * progress dot's step is the next card arriving, which the vote beat already
 * delivers (vote-advance.js).
 *
 * The gate is `.vote--advancing`, as for Ocean's O10.3 pick
 * (test/ocean-motion-small.test.js): only the card showing a FRESH tap carries
 * it, for the beat it is held. A card rendered with a choice already in it —
 * „Zurück" to a rated game, the review — has `.is-selected` without it, and
 * must arrive at rest, never re-stamped. So the premise is tested against the
 * app, and the CSS half pins P10's rules: inside the motion gate, the light
 * scheme only, every animation over before the beat swaps the card.
 *
 * Named for the design and the ritual (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');
const { setMotion, beat } = require('./support/vote-card');

const GATE = ':root[data-design="programmheft"]:not([data-scheme="dark"]) ';
const STAMP = `${GATE}.vote--ph.vote--advancing .rating .mood.is-selected`;

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
const title = (dom) => dom.app.querySelector('.vote__title').firstChild.textContent.trim();

test('the stamp lands only on the cell just chosen, on the card showing it', async (t) => {
  const dom = await wizard(t, 'programmheft');
  assert.equal(dom.document.querySelector(STAMP), null, 'the first card: nothing chosen, nothing stamped');

  dom.app.querySelectorAll('.mood')[3].click();
  const stamped = dom.document.querySelectorAll(STAMP);
  assert.equal(stamped.length, 1, 'exactly one cell is stamped');
  assert.equal(stamped[0], dom.app.querySelectorAll('.mood')[3], 'and it is the one tapped');

  await beat(dom);
  assert.equal(title(dom), 'Azul');
  assert.equal(dom.document.querySelector(STAMP), null, 'the next card arrives at rest');
});

test('a choice already made arrives at rest — „Zurück" does not re-stamp it', async (t) => {
  const dom = await wizard(t, 'programmheft');
  dom.app.querySelectorAll('.mood')[3].click();
  await beat(dom);
  assert.equal(title(dom), 'Azul');
  dom.app.querySelector('#backBtn').click();
  await beat(dom);
  assert.equal(title(dom), 'Kartographen');
  assert.ok(dom.app.querySelector('.mood.is-selected'), 'the rated game shows its choice');
  assert.equal(dom.document.querySelector(STAMP), null, 'but it is not stamped again');
});

test('Klassisch never matches the stamp', async (t) => {
  const dom = await wizard(t, 'klassisch');
  dom.app.querySelectorAll('.mood')[3].click();
  assert.equal(dom.document.querySelector(STAMP), null);
});

/* ---------------------------------------------------------- the CSS contract */

const PH_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'programmheft.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(PH_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));
const VOTE_ADVANCE_MS = 340;

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

test('the stamp: one gated rule, three animations, all over before the beat swaps the card', () => {
  const users = rulesOf(PH_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*ph-stamp-/.test(b));
  assert.deepEqual(users.map(([s]) => s), [STAMP], 'exactly one rule runs them, on the advancing card in the light scheme');
  const gated = motionRules.filter(([s, b]) => s === STAMP && /ph-stamp-/.test(b));
  assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
  const body = gated[0][1];
  assert.doesNotMatch(body, /infinite|pointer-events/);
  assert.doesNotMatch(body, /\b(both|forwards)\b/, 'no forwards fill');

  // One `animation:` list; each entry reads `name duration timing [delay] backwards`.
  const list = /(?:^|;)\s*animation:\s*([^;]+)/.exec(body)[1];
  const runs = list.split(/,\s*(?=ph-stamp-)/).map((part) => {
    const ms = [...part.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
    return [/ph-stamp-[a-z]+/.exec(part)[0], ms[0], ms[1] || 0];
  });
  assert.deepEqual(runs.map(([n]) => n).sort(), ['ph-stamp-ink', 'ph-stamp-press', 'ph-stamp-text']);
  for (const [name, dur, delay] of runs) {
    assert.ok(dur + delay <= VOTE_ADVANCE_MS, `${name} ends by ${dur + delay}ms, inside the ${VOTE_ADVANCE_MS}ms beat`);
    const frames = keyframes(name);
    assert.ok(frames, `${name}: the keyframes exist`);
    assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, `${name}: no end frame`);
  }
  const ink = runs.find(([n]) => n === 'ph-stamp-ink');
  assert.deepEqual(ink.slice(1), [180, 70], 'P10.3: the fill takes 180ms');
  assert.match(keyframes('ph-stamp-press'), /translateY\(2px\)/, 'pressed 2px');
});

test('the fill is a cover of paper lifting off the ink, so the rest is the static chosen cell', () => {
  // The cell's chosen colour IS the ink; the ritual paints the paper over it
  // and lifts it. At rest the cover is zero tall, i.e. nothing.
  const body = motionRules.find(([s]) => s === STAMP)[1];
  assert.match(body, /background-image:\s*linear-gradient\(var\(--surface\), var\(--surface\)\)/);
  assert.match(body, /background-size:\s*100% 0/);
  assert.match(body, /background-position:\s*top/);
  assert.match(keyframes('ph-stamp-ink'), /background-size:\s*100% calc\(100% - 6px\)/,
    'it starts where the unchosen cell is: paper with the 6px ramp bar under it');
});
