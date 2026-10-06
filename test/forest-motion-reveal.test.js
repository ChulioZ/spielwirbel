'use strict';

/* Forest's motion ritual 4 (#1476, F10.4 „Aufleuchten und der Baum"):
 * Forest-F10-Motion.dc.html. The sheet plays one ≈ 3 s sequence — the three
 * face-down cards light up one after another, then a tree grows, then
 * fireflies rise twice. In the app those are TWO moments, each caused by its
 * own click, so the ritual is split along them:
 *
 *   1. „Sieger enthüllen" (the reveal) — the Tafel's rows light up, 350ms
 *      apart, the third and every later row together, all lit by 1 020ms.
 *      Keyed on the app's own reveal marks: `.is-race` on every row and
 *      `--print-i` (the index Das Programmheft and Die Brücke already read).
 *   2. „Als gespielt markieren" (the finish) — the tree that has grown for
 *      the played game (F4.3's resting picture, already static in forest.css)
 *      grows: the trunk 0–600ms, the crown 400–780ms, the fireflies rise twice
 *      700–1 900ms. Keyed on `data-stamped`, which only the render after a
 *      finish the reader just recorded carries (#1200's gate).
 *
 * The tree cannot play on the reveal: until a game is played there is no tree
 * on the screen. Both halves end on the static screen, which is what reduced
 * motion shows, and both are over well inside 3 s.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const ME = 'user-me';
const GAMES = ['Catan', 'Azul', 'Carcassonne', 'Codenames', 'Dixit'].map((title, i) => ({
  id: `g${i + 1}`, title, tagIds: [], minPlayers: 1, maxPlayers: 8,
}));

function fixture() {
  const votes = {};
  for (const m of ['m1', 'm2']) {
    votes[m] = Object.fromEntries(GAMES.map((g, i) => [g.id, { rating: 5 - i }]));
  }
  const session = {
    id: 's1', createdAt: '2026-08-02T18:00:00.000Z', finishedAt: null,
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

const rows = (dom) => [...dom.app.querySelectorAll('.tafel .trow')];
const lightIdx = (dom) => rows(dom).map((r) => r.style.getPropertyValue('--print-i'));

test('the reveal marks every Forest row with its place in the light-up', async (t) => {
  const dom = await show(t, 'forest', true);
  assert.equal(rows(dom).length, 5);
  assert.ok(rows(dom).every((r) => r.classList.contains('is-race')), 'the app\'s own reveal mark');
  assert.deepEqual(lightIdx(dom), ['0', '1', '2', '3', '4'], 'one index per row (forest.css caps it at the third)');
});

test('a cold load or a Chronik visit lights nothing up', async (t) => {
  const dom = await show(t, 'forest', false);
  assert.ok(rows(dom).every((r) => !r.classList.contains('is-race') && r.style.getPropertyValue('--print-i') === ''));
});

test('Klassisch never takes the index', async (t) => {
  const dom = await show(t, 'klassisch', true);
  assert.ok(rows(dom).length > 0);
  assert.ok(rows(dom).every((r) => r.style.getPropertyValue('--print-i') === ''));
});

test('marking the game played grows the tree once; the picture is the resting one', async (t) => {
  const dom = await show(t, 'forest', true);
  const slot = () => dom.app.querySelector('.tisch-slot');
  rows(dom)[0].querySelector('.play-btn').click();
  await flush();
  assert.equal(slot().hasAttribute('data-stamped'), false, 'choosing a game is not the finish — no tree yet');
  [...dom.app.querySelectorAll('.tisch button')].find((b) => /Als gespielt markieren/.test(b.textContent)).click();
  await flush();
  assert.equal(slot().hasAttribute('data-stamped'), true, 'the finish the reader just recorded');
  assert.match(dom.app.querySelector('.tisch').dataset.state, /^(done|picking)$/, 'the state the tree is drawn in');
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

const GATE = ':root[data-design="forest"]:not([data-scheme="dark"]) .result-screen--forest ';
const COVER = `${GATE}.tafel .trow.is-race::after`;
const TREE = `${GATE}.tisch-slot[data-stamped] .tisch:is([data-state="done"], [data-state="picking"])`;

// [keyframe, the one selector running it, its end in ms]
const RITUALS = [
  ['forest-light', COVER, 1020],
  ['forest-grow', `${TREE}::after`, 600],
  ['forest-crown', `${TREE}::before`, 780],
  ['forest-fireflies', TREE, 1900],
];

for (const [name, selector, end] of RITUALS) {
  test(`${name}: Forest only, inside the motion gate, over by ${end}ms, no end frame`, () => {
    const users = rulesOf(FOREST_CSS).filter(([, b]) => new RegExp(`animation[-a-z]*:[^;]*\\b${name}\\b`).test(b));
    assert.deepEqual(users.map(([s]) => s.trim()), [selector], 'exactly one rule runs it');
    const gated = motionRules.filter(([s, b]) => s.trim() === selector && b.includes(name));
    assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
    const body = gated[0][1];
    assert.doesNotMatch(body, /infinite|\b(both|forwards)\b/, 'no loop, nothing held after the ritual');
    const frames = keyframes(name);
    assert.ok(frames, 'the keyframes exist');
    assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it lands on the resting screen');
  });
}

test('the timings add up to the stated ends, and nothing runs past 3 s (#1476)', () => {
  const ms = (selector, name) => {
    // The easing's own commas would end the match early, so it is named out first.
    const body = motionRules.find(([s]) => s.trim() === selector)[1].replace(/cubic-bezier\([^)]*\)/g, 'curve');
    const m = new RegExp(`${name} (\\d+)ms [^,;]*?(?:(\\d+)ms )?(?:(\\d+) )?backwards`).exec(body);
    assert.ok(m, `${name}: duration, delay and count read`);
    return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 1)];
  };
  // The light-up's delay is a calc() over the row index, read by the match below.
  const dLight = Number(/forest-light (\d+)ms /.exec(motionRules.find(([s]) => s.trim() === COVER)[1])[1]);
  assert.equal(dLight, 320);
  assert.match(motionRules.find(([s]) => s.trim() === COVER)[1], /calc\(min\(var\(--print-i, 0\), 2\) \* 350ms\)/,
    'the third row and every later one light together, 350ms apart');
  assert.ok(2 * 350 + dLight <= 1020);
  for (const [name, selector, end] of RITUALS.slice(1)) {
    const [dur, delay, count] = ms(selector, name);
    assert.equal(delay + dur * count, end, `${name} ends at ${end}ms`);
    assert.ok(end <= 3000);
  }
  assert.equal(ms(TREE, 'forest-fireflies')[2], 2, 'the fireflies rise twice and stop');
});

test('the light-up covers the row without taking its clicks', () => {
  const body = motionRules.find(([s]) => s.trim() === COVER)[1];
  assert.match(body, /pointer-events:\s*none/, '„Spielen" stays usable from 0ms');
  assert.match(body, /inset:\s*0/);
  assert.match(keyframes('forest-light'), /from\s*\{\s*opacity:\s*1;\s*\}/, 'dark at first, then lit');
  assert.match(body, /(^|;)\s*opacity:\s*0/, 'at rest the cover is gone');
});

test('the fireflies move the three dot layers and never the clearing under them', () => {
  const frames = keyframes('forest-fireflies');
  assert.match(frames, /background-position:\s*0 -46px, 0 -46px, 0 -46px, 0 0;/,
    'the dots rise 46px; the fourth layer, the band and the grass, stays put');
});
