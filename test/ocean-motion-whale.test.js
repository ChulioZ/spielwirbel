'use strict';

/* Ocean's motion ritual O10.2 „Der Wal taucht auf" (#1221): the whale surfaces
 * once per result.
 *
 * The whale is the result band's resting picture once the chosen game is
 * played (#1213, O4.4), so "once per result" is the one render after the
 * reader records the finish — the render Der Tisch's T10.5 already marks with
 * `data-stamped` (test/tisch-motion-stamp.test.js). This spec proves the hook
 * reaches Ocean and that the ritual's CSS selectors actually match the DOM that
 * render produces (a selector that matches nothing would be a ritual that never
 * plays, with every other assertion green): not on a cold load, not on a winner
 * change, not under Klassisch.
 *
 * The motion itself is proved in a browser by sampled computed values; the CSS
 * half pins O10.2 and O10.4: Ocean's light scheme only, inside the motion gate,
 * 700ms on O10's curve, a 3px Nachwiegen and no more, no fill, no end frame.
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
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"]) ';
const BAND = `${GATE}.result-screen--ocean .tisch-slot[data-stamped] > .tisch:is([data-state="done"], [data-state="picking"])`;

function fixture(over = {}) {
  const session = {
    id: 's1', createdAt: '2026-08-02T18:00:00.000Z', finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } }, m2: { g1: { rating: 4 }, g2: { rating: 2 } } },
    votedIds: ['m1', 'm2'], done: true, cancelled: false, finished: false, winnerIds: [],
    chosenGameId: null, events: [], ...over,
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

async function show(t, design, over = {}) {
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
  await dom.call('showResults', round, session, round.games, false);
  await flush();
  return dom;
}

const btn = (dom, rx) => [...dom.app.querySelectorAll('.tisch button')].find((b) => rx.test(b.textContent));
const play = (dom, title) => [...dom.app.querySelectorAll('.trow')]
  .find((r) => r.querySelector('.trow__title').textContent.trim() === title)
  .querySelector('.play-btn');
// The ritual's own selectors, run against the document: the whale is the
// band's ::before, so the band standing in for it is what jsdom can match.
const surfacing = (dom) => ({
  band: dom.document.querySelector(BAND),
  box: dom.document.querySelector(`${BAND} .tisch__box`),
  card: dom.document.querySelector(`${BAND} .tisch__main`),
});

test('recording the finish under Ocean surfaces the whale once; the next write does not', async (t) => {
  const dom = await show(t, 'ocean');
  play(dom, 'Catan').click();
  await flush();
  assert.equal(surfacing(dom).band, null, 'choosing a game is not the finish — no whale yet');

  btn(dom, /Als gespielt markieren/).click();
  await flush();
  const now = surfacing(dom);
  assert.ok(now.band, 'the ritual\'s band selector matches the render after the finish');
  assert.ok(now.box, 'the box that rides on the whale\'s back');
  assert.ok(now.card, 'the text card re-stacked over the water');

  const winner = [...dom.app.querySelectorAll('.tisch button')].find((b) => /Anna/.test(b.textContent));
  assert.ok(winner, 'the winner picker offers Anna');
  winner.click();
  await flush();
  assert.equal(surfacing(dom).band, null, 'naming a winner must not surface the whale again');
});

test('a cold load of a finished session shows the whale already surfaced', async (t) => {
  const dom = await show(t, 'ocean', { chosenGameId: 'g1', finished: true, winnerIds: ['m1'] });
  assert.ok(dom.document.querySelector(`${GATE}.result-screen--ocean .tisch[data-state="done"]`),
    'the resting whale is there — the state that would replay');
  assert.equal(surfacing(dom).band, null);
});

test('Klassisch never matches the ritual', async (t) => {
  const dom = await show(t, 'klassisch');
  play(dom, 'Catan').click();
  await flush();
  btn(dom, /Als gespielt markieren/).click();
  await flush();
  assert.equal(surfacing(dom).band, null);
});

/* ---------------------------------------------------------- the CSS contract */

const OCEAN_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(OCEAN_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));

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

test('ocean-surface: the whale and its box, inside the motion gate, 700ms on O10\'s curve, no fill', () => {
  const selectors = [`${BAND}::before`, `${BAND} .tisch__box`];
  const users = rulesOf(OCEAN_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*ocean-surface/.test(b));
  assert.deepEqual(users.map(([s]) => s), selectors, 'exactly the whale and the box run it, under the one-shot hook');
  for (const selector of selectors) {
    const gated = motionRules.filter(([s, b]) => s === selector && b.includes('ocean-surface'));
    assert.equal(gated.length, 1, `${selector} sits inside prefers-reduced-motion: no-preference`);
    const body = gated[0][1];
    assert.match(body, /ocean-surface 700ms cubic-bezier\(0\.2, 0\.8, 0\.3, 1\)\s*;/);
    assert.doesNotMatch(body, /\b(both|forwards|backwards|infinite)\b/, 'no fill, no loop: nothing is held after it');
  }
  const box = motionRules.find(([s]) => s === `${BAND} .tisch__box`)[1];
  assert.match(box, /transform-origin:\s*calc\(50% - 10px\) 150px/, 'the box pivots on the whale\'s centre');
});

test('ocean-surface: from 70px below, a 3px Nachwiegen and no more, no end frame', () => {
  const frames = keyframes('ocean-surface');
  assert.ok(frames, 'the keyframes exist');
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it settles on the rest state');
  assert.match(frames, /from\s*\{\s*transform:\s*translateY\(70px\) rotate\(-3deg\);/);
  const lifts = [...frames.matchAll(/translateY\((-?\d+(?:\.\d+)?)px\)/g)].map((m) => Number(m[1]));
  assert.ok(Math.min(...lifts) >= -3, `never more than 3px past rest (O10.4: no overshoot) — got ${Math.min(...lifts)}`);
});

test('the re-stacking lives only inside the gate, under the hook: whale, box, water, card', () => {
  const z = (sel) => {
    const hit = motionRules.find(([s]) => s === sel);
    return hit && Number(/z-index:\s*(\d+)/.exec(hit[1])[1]);
  };
  const order = [z(`${BAND} .tisch__box`), z(`${BAND}::after`), z(`${BAND} .tisch__main`)];
  assert.deepEqual(order, [2, 3, 4]);
  // The resting whale is z-index 1 (#1213); every re-stacked layer sits above it.
  const whale = rulesOf(OCEAN_CSS).find(([s]) => /\.tisch:is\(\[data-state="done"\], \[data-state="picking"\]\)::before$/.test(s)
    && !s.includes('data-stamped'));
  assert.match(whale[1], /z-index:\s*1\s*;/);
  const outside = rulesOf(OCEAN_CSS).filter(([s]) => s.includes('[data-stamped]') && s.includes('ocean'));
  assert.equal(outside.length, motionRules.filter(([s]) => s.includes('[data-stamped]')).length,
    'no data-stamped rule of Ocean\'s outside the motion gate');
});
