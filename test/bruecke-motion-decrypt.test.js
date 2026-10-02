'use strict';

/* Die Brücke's motion ritual 4 (#1248, B10.4): „Entschlüsseln" — the one big
 * moment. On the reveal the hatch slides off the headline to the right in 14
 * steps over 1200ms, then the Tafel's rows drive in one after another, 60ms
 * apart (the stagger capped at the tenth row, shared with Das Programmheft's
 * P10.4), so any Tafel is in by 2000ms.
 *
 * One gate: „Auflösen" (`reveal`). A cold load, a Chronik visit and a
 * re-render arrive decrypted.
 *
 * And a fold-in: the app's 3.6s `tafel-gold` tint fills `both`, so it left the
 * gold group painted --gold-soft after every reveal where a cold load shows the
 * plate; stood down, as Der Tisch and Das Programmheft do.
 *
 * Named for the design and the ritual (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const ME = 'user-me';
const GAMES = Array.from({ length: 12 }, (_, i) => ({ id: `g${i + 1}`, title: `Spiel ${i + 1}`, tagIds: [], minPlayers: 1, maxPlayers: 8 }));

function fixture() {
  const votes = { m1: {}, m2: {} };
  GAMES.forEach((g, i) => { votes.m1[g.id] = { rating: 1 + (i % 5) }; votes.m2[g.id] = { rating: 5 - (i % 5) }; });
  const session = {
    id: 's1', createdAt: '2026-08-02T18:00:00.000Z', finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: GAMES.map((g) => g.id), memberIds: ['m1', 'm2'], votes,
    votedIds: ['m1', 'm2'], done: true, cancelled: false, finished: false, winnerIds: [],
    chosenGameId: null, events: [],
  };
  const round = {
    id: 'r1', name: 'Freitagsrunde', background: null, tags: [],
    members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }],
    games: GAMES.map((g) => ({ ...g })), sessions: [session],
  };
  return { round, session };
}

async function show(t, design, reveal) {
  const { round, session } = fixture();
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.call('applyDesign', design);
  await dom.call('showResults', round, session, round.games, reveal);
  await flush();
  return dom;
}

const decrypting = (dom) => dom.app.querySelector('.result-screen--bruecke .page-head--result[data-decrypt]');
const rowIdx = (dom) => [...dom.app.querySelectorAll('.tafel .trow')].map((r) => r.style.getPropertyValue('--print-i'));

test('the reveal decrypts the head and indexes every row, top first, capped at the tenth', async (t) => {
  const dom = await show(t, 'bruecke', true);
  assert.ok(decrypting(dom), 'the head is decrypted');
  assert.ok(decrypting(dom).querySelector('.result-title'), 'and the headline is inside it');
  assert.deepEqual(rowIdx(dom), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '9', '9']);
  assert.equal(dom.app.querySelectorAll('.tafel .trow.is-race').length, 12, 'every row carries the reveal mark');
});

test('only the reveal: a cold load or a Chronik visit arrives decrypted', async (t) => {
  const dom = await show(t, 'bruecke', false);
  assert.equal(decrypting(dom), null);
  assert.ok(rowIdx(dom).every((v) => v === ''), 'no row carries an index');
});

test('Klassisch and Der Tisch never decrypt', async (t) => {
  for (const design of ['klassisch', 'tisch']) {
    const dom = await show(t, design, true);
    assert.equal(dom.app.querySelector('[data-decrypt]'), null, design);
    assert.ok(rowIdx(dom).every((v) => v === ''), design);
  }
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

const G = ':root[data-design="bruecke"][data-scheme="dark"] .result-screen--bruecke ';
const HATCH = `${G}.page-head--result[data-decrypt] .result-title::after`;
const ROW = `${G}.tafel .trow.is-race`;
const ROW_LIFT = `${G}.tafel .trow.is-race.is-lift`;

test('the hatch: 14 steps over 1200ms, opaque, resting fully clipped, no end frame', () => {
  const users = rulesOf(CSS).filter(([, b]) => /animation[-a-z]*:[^;]*bruecke-decrypt\b/.test(b));
  assert.deepEqual(users.map(([s]) => s), [HATCH]);
  const body = motionRules.find(([s]) => s === HATCH);
  assert.ok(body, 'the overlay exists only inside prefers-reduced-motion: no-preference');
  assert.match(body[1], /bruecke-decrypt 1200ms steps\(14, end\) backwards/, 'B10.4: steps(), not a cross-fade');
  assert.match(body[1], /clip-path:\s*inset\(0 0 0 100%\)/, 'at rest nothing of it is left — it neither paints nor takes a pointer');
  assert.match(body[1], /pointer-events:\s*none/);
  assert.match(body[1], /repeating-linear-gradient\(45deg, var\(--sunken-soft\) 0 8px, var\(--surface\) 8px 16px\)/,
    'two opaque tokens, so nothing of the result reads through');
  assert.doesNotMatch(body[1], /content:\s*['"][^'"]/, 'no user-facing word in a stylesheet');
  assert.match(keyframes('bruecke-decrypt'), /from\s*\{\s*clip-path:\s*inset\(0\);?\s*\}/, 'it starts covering the whole headline');
  assert.doesNotMatch(keyframes('bruecke-decrypt'), /(^|[\s}])(to|100%)\s*\{/);
});

test('the rows drive in after the hatch, 60ms apart, every Tafel in by 2000ms', () => {
  const body = motionRules.find(([s]) => s === ROW);
  assert.ok(body, 'inside prefers-reduced-motion: no-preference');
  const m = /bruecke-row-in (\d+)ms [^;]*calc\((\d+)ms \+ var\(--print-i, 0\) \* (\d+)ms\) backwards/.exec(body[1]);
  assert.ok(m, 'duration, the delay after the hatch and the stagger');
  const [, dur, after, step] = m.map(Number);
  assert.equal(after, 1200, 'the rows wait for the headline');
  assert.equal(step, 60, 'B10.4: 60ms apart');
  assert.ok(after + 9 * step + dur <= 2000, 'the tenth row onward is in by 2000ms');
  assert.doesNotMatch(body[1], /infinite|\b(both|forwards)\b/);
  assert.doesNotMatch(keyframes('bruecke-row-in'), /(^|[\s}])(to|100%)\s*\{/);
});

test('„Spielen" still lifts a revealed row, and the lift does not replay the drive-in', () => {
  // The drive-in rule outranks styles.css's `.trow.is-lift`; listing the lift
  // BESIDE it keeps both, and a list that keeps the drive-in's name does not
  // restart it when `is-lift` comes and goes.
  const body = motionRules.find(([s]) => s === ROW_LIFT);
  assert.ok(body, 'the lifted row has its own rule inside the gate');
  const runs = /(?:^|;)\s*animation:\s*([^;]+)/.exec(body[1])[1].split(/,\s*(?=[a-z])/).map((p) => p.trim());
  assert.equal(runs.length, 2);
  assert.equal(runs[0], /animation:\s*([^;]+)/.exec(motionRules.find(([s]) => s === ROW)[1])[1].trim(),
    'the drive-in, exactly as the plain row has it');
  assert.match(runs[1], /^trow-lift 0\.35s var\(--ease-out\) both$/, 'and the app\'s lift, exactly as styles.css has it');
});

test('fold-in: the gold group\'s tint is stood down under Die Brücke', () => {
  const rule = rulesOf(CSS).find(([s]) => s === `${G}.tafel-top.is-reveal`);
  assert.ok(rule, 'the rule exists');
  assert.match(rule[1], /animation:\s*none/);
  assert.equal(motionRules.some(([s]) => s === `${G}.tafel-top.is-reveal`), false,
    'outside the motion gate — the tint is the app\'s, and reduced motion never ran it anyway');
});
