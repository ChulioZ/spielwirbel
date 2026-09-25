'use strict';

/* Der Tisch's motion ritual 4 (#1200, T10.4): the reveal — the bars rise, then
 * a gold streak crosses the winning row once.
 *
 * All CSS, keyed on hooks the result screen already sets: `.is-race` + `--dur`
 * on every row and `.is-reveal` on the gold group, ONLY when the screen opens
 * as the reveal („Auflösen"), and the distribution's own `hidden` disclosure.
 * So the jsdom half pins that those hooks still mean what the stylesheet
 * assumes — present on the reveal, absent on a cold load — and the CSS half
 * pins the timing arithmetic that keeps the whole reveal inside T10's 900ms,
 * derived from the race formula in views-session.js rather than copied from it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf, topLevel } = require('./support/css');

const ME = 'user-me';

function fixture() {
  const session = {
    id: 's1', createdAt: '2026-09-24T18:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } }, m2: { g1: { rating: 4 }, g2: { rating: 2 } } },
    votedIds: ['m1', 'm2'], done: true, cancelled: false, finished: false, winnerIds: [],
    chosenGameId: null, events: [],
  };
  const round = {
    id: 'r1', name: 'Freitagsrunde', background: null, tags: [],
    members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }],
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [session],
  };
  return { round, session };
}

async function show(t, reveal) {
  const { round, session } = fixture();
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.call('applyDesign', 'tisch');
  await dom.call('showResults', round, session, round.games, reveal);
  await flush();
  return dom;
}

test('the hooks the reveal keys on are set by „Auflösen" and by nothing else', async (t) => {
  const revealed = await show(t, true);
  assert.ok(revealed.app.querySelector('.result-screen .tafel-top.is-reveal .trow'),
    'the gold row sits inside the reveal group — the sweep\'s selector');
  const raced = [...revealed.app.querySelectorAll('.result-screen .trow.is-race')];
  assert.equal(raced.length, 2, 'every rated row races');
  raced.forEach((r) => assert.match(r.getAttribute('style'), /--dur:\d/, 'each carries its own race length'));
  // The distribution is closed until the reader opens it: its `hidden` IS the
  // bars' trigger, so it must exist, start hidden, and open on the count.
  const toggle = revealed.app.querySelector('.trow__votes');
  const bars = revealed.app.querySelector('.trow__bars');
  assert.equal(bars.hidden, true);
  toggle.click();
  assert.equal(bars.hidden, false, 'the reader\'s click is what shows the bars — and starts their rise');

  const cold = await show(t, false);
  assert.equal(cold.app.querySelector('.is-reveal, .is-race'), null, 'a cold load plays nothing');
});

/* ---------------------------------------------------------- the CSS contract */

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const TISCH_CSS = read('public', 'css', 'designs', 'tisch.css').replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(TISCH_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));
const gatedBody = (sel) => (motionRules.find(([s]) => s === sel) || [])[1] || null;

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

// The longest race the result screen can write: `--dur` = a + score × b at the
// scale's top. Read from the source, so a retune there re-checks the ceiling here.
const RACE = /--dur:\$\{\(([\d.]+) \+ r\.shown \* ([\d.]+)\)/.exec(read('public', 'js', 'views-session.js'));
const MAX_DUR = RACE ? Number(RACE[1]) + 5 * Number(RACE[2]) : NaN;

test('the race is retimed so the winner lands inside 900ms, order kept', () => {
  assert.ok(Number.isFinite(MAX_DUR), 'the race formula was found in views-session.js');
  const body = gatedBody(':root[data-design="tisch"] .result-screen .trow.is-race::before');
  assert.ok(body, 'the retime sits inside the motion gate, on the result screen only');
  const k = Number(/animation-duration:\s*calc\(var\(--dur, 1s\) \* ([\d.]+)\)/.exec(body)[1]);
  assert.ok(MAX_DUR * k <= 0.9, `the winner's race lands at ${(MAX_DUR * k).toFixed(3)}s`);
  assert.ok(MAX_DUR > 0.9, 'and without it the app\'s own race would run past the ceiling');
});

test('the sweep: once, 800ms, after the winner lands, behind the text, ending off the row', () => {
  const body = gatedBody(':root[data-design="tisch"][data-scheme="dark"] .result-screen .tafel-top.is-reveal .trow::after');
  assert.ok(body, 'the sweep sits inside the motion gate');
  assert.match(body, /animation:\s*tisch-gold-sweep 800ms ease-in-out calc\(var\(--dur, 1s\) \* 0\.42\) both/,
    'it waits for the same retimed race it follows');
  assert.match(body, /z-index:\s*-1/, 'behind the row\'s content — over brass, never over text');
  assert.doesNotMatch(body, /infinite/);
  const frames = keyframes('tisch-gold-sweep');
  const at = (f) => Number(new RegExp(`${f}\\s*\\{\\s*background-position:\\s*(-?[\\d.]+)%`).exec(frames)[1]);
  // 250% wide image: its 50% streak sits at x = 1.25W − 1.5·p·W. Both ends must
  // put it (and its ±8% of image = ±0.2W half-width) outside the row.
  const x = (p) => 1.25 - 1.5 * (p / 100);
  assert.ok(x(at('from')) + 0.2 < 0, 'it starts fully left of the row');
  assert.ok(x(at('to')) - 0.2 > 1, 'and ends fully right of it — its last frame shows nothing');
});

test('the app\'s 3.6s gold tint is stood down to its rest state on Der Tisch', () => {
  const unconditional = rulesOf(topLevel(TISCH_CSS))
    .find(([s]) => s === ':root[data-design="tisch"] .result-screen .tafel-top.is-reveal');
  assert.ok(unconditional, 'declared outside any media block, so it holds under reduced motion too');
  assert.match(unconditional[1], /animation:\s*none/);
});

test('the distribution rises when opened: Tisch only, ≤ 900ms, no end frame', () => {
  const sel = ':root[data-design="tisch"] .result-screen .trow__bars:not([hidden]) .bar';
  const users = rulesOf(TISCH_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*tisch-bar-rise/.test(b));
  assert.deepEqual(users.map(([s]) => s), [sel]);
  const body = gatedBody(sel);
  assert.ok(body, 'inside the motion gate');
  assert.match(body, /tisch-bar-rise 460ms [^;]*calc\(var\(--rise-i, 0\) \* 70ms\)/);
  const steps = motionRules.filter(([s]) => /\.bar-col:nth-child/.test(s))
    .map(([, b]) => Number(/--rise-i:\s*(\d+)/.exec(b)[1]));
  assert.ok(460 + Math.max(...steps) * 70 <= 900, 'the last rung lands by 900ms');
  assert.doesNotMatch(keyframes('tisch-bar-rise'), /(^|[\s}])(to|100%)\s*\{/, 'no end frame');
});
