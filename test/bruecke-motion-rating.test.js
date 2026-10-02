'use strict';

/* Die Brücke's motion ritual 3 (#1248, B10.3): „Wertung abgeben" — the chosen
 * key fills in 220ms and takes its glow, the other four stay wire; then the
 * next card drives in from below (260ms). The change must not be faster than
 * the acknowledgement, or the rating reads as taken away.
 *
 * Two gates, both the app's own. The fill rides `.vote--advancing`, as Das
 * Programmheft's P10.3 and Ocean's O10.3 do: only the card showing a FRESH
 * tap carries it, so a choice already made („Zurück", a re-render) arrives at
 * rest. The incoming card rides Der Tisch's T10.3 gate: `wanted.kind ===
 * 'title'` is exactly "the beat brought this card", so the first card, a Back
 * and a language switch arrive still.
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

const GATE = ':root[data-design="bruecke"][data-scheme="dark"] ';
const FILL = `${GATE}.vote--bruecke.vote--advancing .rating .mood.is-selected`;
const INCOMING = `${GATE}.vote--bruecke.is-incoming .vote__card`;

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
const incoming = (dom) => dom.app.querySelector('.vote.is-incoming');

test('the fill lands only on the key just chosen, and the beat brings the next card in', async (t) => {
  const dom = await wizard(t, 'bruecke');
  assert.equal(dom.document.querySelector(FILL), null, 'the first card: nothing chosen, nothing filling');
  assert.equal(incoming(dom), null, 'and the first card arrives still');

  dom.app.querySelectorAll('.mood')[3].click();
  const filling = dom.document.querySelectorAll(FILL);
  assert.equal(filling.length, 1, 'exactly one key fills');
  assert.equal(filling[0], dom.app.querySelectorAll('.mood')[3], 'and it is the one tapped');

  await beat(dom);
  assert.equal(title(dom), 'Azul');
  assert.ok(incoming(dom), 'the card the beat delivered drives in');
  assert.equal(dom.document.querySelector(FILL), null, 'and arrives with nothing filling');
});

test('„Zurück" brings the rated card back at rest — no fill, no drive-in', async (t) => {
  const dom = await wizard(t, 'bruecke');
  dom.app.querySelectorAll('.mood')[3].click();
  await beat(dom);
  dom.app.querySelector('#backBtn').click();
  await beat(dom);
  assert.equal(title(dom), 'Kartographen');
  assert.ok(dom.app.querySelector('.mood.is-selected'), 'the rated game shows its choice');
  assert.equal(dom.document.querySelector(FILL), null, 'not filled again');
  assert.equal(incoming(dom), null, 'and a Back is not the beat');
});

test('Klassisch neither fills nor drives in', async (t) => {
  const dom = await wizard(t, 'klassisch');
  dom.app.querySelectorAll('.mood')[3].click();
  assert.equal(dom.document.querySelector(FILL), null);
  await beat(dom);
  assert.equal(incoming(dom), null);
});

/* ---------------------------------------------------------- the CSS contract */

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'bruecke.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));
const VOTE_ADVANCE_MS = 340;

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

// Every `name 123ms … [delay]` entry of a rule's animation list, as [name, ms, delay].
function runsOf(body, prefix) {
  const list = /(?:^|;)\s*animation:\s*([^;]+)/.exec(body)[1];
  return list.split(new RegExp(`,\\s*(?=${prefix})`)).map((part) => {
    const ms = [...part.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
    return [new RegExp(`${prefix}[a-z-]+`).exec(part)[0], ms[0], ms[1] || 0, part];
  });
}

test('the fill: gated, over inside the beat, a cover lifting off the key\'s own colour', () => {
  const users = rulesOf(CSS).filter(([, b]) => /animation[-a-z]*:[^;]*bruecke-rate-fill/.test(b));
  assert.deepEqual(users.map(([s]) => s), [FILL], 'exactly one rule runs it, on the advancing Brücke card');
  const body = motionRules.find(([s]) => s === FILL);
  assert.ok(body, 'inside prefers-reduced-motion: no-preference');
  assert.doesNotMatch(body[1], /infinite|pointer-events|\b(both|forwards)\b/);
  const runs = runsOf(body[1], 'bruecke-rate-');
  assert.deepEqual(runs.map(([n]) => n).sort(), ['bruecke-rate-fill', 'bruecke-rate-ink']);
  for (const [name, ms, delay] of runs) {
    assert.ok(ms + delay <= VOTE_ADVANCE_MS, `${name} ends by ${ms + delay}ms, inside the ${VOTE_ADVANCE_MS}ms beat`);
    assert.doesNotMatch(keyframes(name), /(^|[\s}])(to|100%)\s*\{/, `${name}: no end frame`);
  }
  assert.equal(runs.find(([n]) => n === 'bruecke-rate-fill')[1], 220, 'B10.3: 220ms');
  // The key's chosen colour IS the fill; the ritual covers it with the card's
  // surface and lifts the cover upward. At rest the cover is zero tall.
  assert.match(body[1], /background-image:\s*linear-gradient\(var\(--surface\), var\(--surface\)\)/);
  assert.match(body[1], /background-size:\s*100% 0/);
  assert.match(body[1], /background-position:\s*top/);
  assert.match(keyframes('bruecke-rate-fill'), /background-size:\s*100% 100%/, 'it starts as the unchosen key: all cover');
  assert.match(keyframes('bruecke-rate-fill'), /box-shadow:\s*none/, 'the glow comes with the fill');
});

test('the next card: gated, 260ms from below, no end frame', () => {
  const users = rulesOf(CSS).filter(([, b]) => /animation[-a-z]*:[^;]*bruecke-card-in/.test(b));
  assert.deepEqual(users.map(([s]) => s), [INCOMING]);
  const body = motionRules.find(([s]) => s === INCOMING);
  assert.ok(body, 'inside prefers-reduced-motion: no-preference');
  assert.match(body[1], /bruecke-card-in 260ms [^;]*backwards/);
  assert.doesNotMatch(body[1], /infinite|\b(both|forwards)\b/);
  assert.match(keyframes('bruecke-card-in'), /translateY\(14px\)/);
  assert.doesNotMatch(keyframes('bruecke-card-in'), /(^|[\s}])(to|100%)\s*\{/);
});
