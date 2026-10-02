'use strict';

/* Das Programmheft's motion ritual 4 (#1382, P10.4): „Aufdecken — der Andruck".
 *
 * The sheet draws the finished report: the headline printed line by line, the
 * score counted up, and „Gespielt" stamped last. The app reaches those in two
 * moments, so the ritual is split along them (operator decision at the PR):
 *
 * - the REVEAL („Auflösen", `reveal`): the headline is wiped in from the left
 *   (300ms), then the Tafel is printed row by row from the top, 120ms apart,
 *   each wipe 300ms — the stagger capped at the tenth row, so any Tafel is
 *   printed by 300 + 9 × 120 + 300 = 1 680ms, inside the sheet's 1 800ms. No
 *   count-up (dropped with P10.2's for the same reason).
 * - the FINISH: the one render after the reader records it carries
 *   `data-stamped` on the band's slot (set for every composed design since
 *   T10.5), and the box's „Gespielt" lands hard.
 *
 * And a fold-in: the app's 3.6s `tafel-gold` tint (both-filled) left the gold
 * group painted over the programme's `background: none`; stood down, as Der
 * Tisch does.
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

function fixture(over = {}) {
  const votes = { m1: {}, m2: {} };
  GAMES.forEach((g, i) => { votes.m1[g.id] = { rating: 1 + (i % 5) }; votes.m2[g.id] = { rating: 5 - (i % 5) }; });
  const session = {
    id: 's1', createdAt: '2026-08-02T18:00:00.000Z', finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: GAMES.map((g) => g.id), memberIds: ['m1', 'm2'], votes,
    votedIds: ['m1', 'm2'], done: true, cancelled: false, finished: false, winnerIds: [],
    chosenGameId: null, events: [], ...over,
  };
  const round = {
    id: 'r1', name: 'Freitagsrunde', background: null, tags: [],
    members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }],
    games: GAMES.map((g) => ({ ...g })), sessions: [session],
  };
  return { round, session };
}

async function show(t, design, reveal, over = {}) {
  const { round, session } = fixture(over);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, p, body) => {
    if (method === 'POST' && /\/choice$/.test(p)) { session.chosenGameId = body.gameId; return {}; }
    if (method === 'POST' && /\/finish$/.test(p)) {
      return { ...session, finished: body.finished !== false, winnerIds: body.winnerIds || [],
        finishedAt: '2026-08-02T22:10:00.000Z' };
    }
    return round;
  });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.call('applyDesign', design);
  await dom.call('showResults', round, session, round.games, reveal);
  await flush();
  return dom;
}

const printed = (dom) => dom.app.querySelector('.page-head--result[data-print]');
const printIdx = (dom) => [...dom.app.querySelectorAll('.tafel .trow')].map((r) => r.style.getPropertyValue('--print-i'));

test('the reveal prints the head and indexes every row, top first, capped at the tenth', async (t) => {
  const dom = await show(t, 'programmheft', true);
  assert.ok(printed(dom), 'the head is printed');
  assert.deepEqual(printIdx(dom), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '9', '9'],
    'in DOM order — the gold row first — and the tenth onward lands with the ninth');
});

test('only the reveal prints: a cold load, a Chronik visit or a shared link does not', async (t) => {
  const dom = await show(t, 'programmheft', false);
  assert.equal(printed(dom), null);
  assert.ok(printIdx(dom).every((v) => v === ''), 'no row carries an index');
});

test('Klassisch and Der Tisch never print', async (t) => {
  for (const design of ['klassisch', 'tisch']) {
    const dom = await show(t, design, true);
    assert.equal(printed(dom), null, design);
    assert.ok(printIdx(dom).every((v) => v === ''), design);
  }
});

test('recording the finish stamps once under Das Programmheft', async (t) => {
  const dom = await show(t, 'programmheft', false);
  const slot = () => dom.app.querySelector('.tisch-slot');
  [...dom.app.querySelectorAll('.trow')]
    .find((r) => r.querySelector('.trow__title').textContent.trim() === 'Spiel 1')
    .querySelector('.play-btn').click();
  await flush();
  assert.equal(slot().hasAttribute('data-stamped'), false, 'choosing a game is not the finish');
  [...dom.app.querySelectorAll('.tisch button')].find((b) => /Als gespielt markieren/.test(b.textContent)).click();
  await flush();
  assert.ok(dom.app.querySelector('.tisch__box .stamp--table'), 'the stamp is on the box');
  assert.equal(slot().hasAttribute('data-stamped'), true, 'and it lands');
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
const usersOf = (name) => rulesOf(PH_CSS).filter(([, b]) => new RegExp(`animation[-a-z]*:[^;]*${name}(?![\\w-])`).test(b)).map(([s]) => s);
const gatedBody = (selector, name) => {
  const hit = motionRules.filter(([s, b]) => s === selector && b.includes(name));
  assert.equal(hit.length, 1, `${name} on ${selector} sits inside prefers-reduced-motion: no-preference`);
  const body = hit[0][1];
  assert.doesNotMatch(body, /infinite|pointer-events/);
  assert.doesNotMatch(body, /\b(both|forwards)\b/, 'no forwards fill');
  return body;
};

const HEAD = ':root[data-design="programmheft"] .result-screen .page-head--result[data-print] .result-title';
const ROW = ':root[data-design="programmheft"] .result-screen .tafel .trow.is-race';
const ROW_LIFT = `${ROW}.is-lift`;
const STAMP = ':root[data-design="programmheft"] .result-screen .tisch-slot[data-stamped] .tisch__box .stamp--table';

test('ph-print: the head, then the rows, printed by 1 800ms', () => {
  assert.deepEqual(usersOf('ph-print').sort(), [HEAD, ROW, ROW_LIFT].sort(),
    'exactly the head and the racing rows (the lifted row repeats the print, below)');
  assert.match(gatedBody(HEAD, 'ph-print'), /ph-print 300ms /);
  const row = gatedBody(ROW, 'ph-print');
  const m = /ph-print (\d+)ms [^;]*calc\((\d+)ms \+ var\(--print-i, 0\) \* (\d+)ms\)/.exec(row);
  assert.ok(m, 'the row waits for the head, then staggers on --print-i');
  const [dur, wait, step] = m.slice(1).map(Number);
  assert.deepEqual([dur, wait, step], [300, 300, 120]);
  assert.ok(wait + 9 * step + dur <= 1800, 'the tenth row is printed inside the sheet’s 1 800ms');
  // A `to` frame on purpose: a row holds buttons, and a RESTING clip-path — what
  // ritual 1 uses to give its h1 something to interpolate to — would cut their
  // focus rings for good. With backwards fill only, the clip ends at `none`.
  const frames = keyframes('ph-print');
  assert.match(frames, /from\s*\{\s*clip-path:\s*inset\(0 100% 0 0\)/);
  assert.match(frames, /to\s*\{\s*clip-path:\s*inset\(0\)/);
  assert.doesNotMatch(row, /clip-path/, 'and the row itself rests unclipped');
});

test('„Spielen" still lifts a revealed row, and the lift does not replay the print', () => {
  // The print rule outranks styles.css's `.trow.is-lift`, so until this rule the
  // lift never played on a revealed row. Listing the lift BESIDE the print keeps
  // both, and a list that keeps the print's name does not restart it when
  // `is-lift` comes and goes.
  const body = motionRules.find(([s]) => s === ROW_LIFT);
  assert.ok(body, 'the lifted row has its own rule inside the gate');
  const runs = /(?:^|;)\s*animation:\s*([^;]+)/.exec(body[1])[1].split(/,\s*(?=[a-z])/).map((p) => p.trim());
  assert.equal(runs.length, 2);
  assert.equal(runs[0], /animation:\s*([^;]+)/.exec(motionRules.find(([s]) => s === ROW)[1])[1].trim(),
    'the print, exactly as the plain row has it');
  assert.match(runs[1], /^trow-lift 0\.35s var\(--ease-out\) both$/, 'and the app\'s lift, exactly as styles.css has it');
});

test('ph-land: „Gespielt" lands hard on the finish, straight, no end frame', () => {
  assert.deepEqual(usersOf('ph-land'), [STAMP]);
  const body = gatedBody(STAMP, 'ph-land');
  const m = /ph-land (\d+)ms [^;]*?(\d+)ms backwards/.exec(body);
  assert.ok(m, 'duration and a beat');
  assert.ok(Number(m[1]) + Number(m[2]) <= 400, 'a stamp, not a float');
  const frames = keyframes('ph-land');
  assert.match(frames, /scale:\s*1\.6/, 'from 1.6 down, as P10.4 draws it');
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it lands on the straight static stamp');
  assert.doesNotMatch(frames, /transform:/, 'individual scale/rotate, so the stamp’s own layout is never replaced');
});

test('the app’s 3.6s gold tint is stood down under Das Programmheft', () => {
  const rule = rulesOf(PH_CSS).find(([s]) => s === ':root[data-design="programmheft"] .result-screen .tafel-top.is-reveal');
  assert.ok(rule, 'the stand-down rule exists');
  assert.match(rule[1], /animation:\s*none/);
});
