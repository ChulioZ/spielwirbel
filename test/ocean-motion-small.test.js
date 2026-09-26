'use strict';

/* Ocean's O10.3 small movements (#1221): the rating pick, the new crown, the
 * sheet and the toast. Each is a block of the one ocean.css section, droppable
 * on its own.
 *
 * Two of them rest on a premise about the DOM that the CSS cannot see, and
 * those premises are the gates, so they are tested against the app:
 * - the pick rides `.vote--advancing`, which only the card showing the fresh
 *   pick carries — the ritual's selector must match that card and no other;
 * - the crown is a TRANSITION, which only runs if the people column survives a
 *   winner tap. Were it rebuilt, the crown would simply appear.
 *
 * The motion itself is proved in a browser by sampled values; the CSS half pins
 * O10.3's timings and O10.4's rules (inside the motion gate, Ocean's light
 * scheme only, no `infinite`).
 *
 * Named for the design and the ritual (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');
const { setMotion, beat } = require('./support/vote-card');

const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"]) ';

/* ------------------------------------------------------------- the rating pick */

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

const PICK = `${GATE}.vote--ocean.vote--advancing .rating .mood.is-selected .ti`;
const title = (dom) => dom.app.querySelector('.vote__title').firstChild.textContent.trim();

test('the pick lifts only the bubble just chosen, on the card showing it', async (t) => {
  const dom = await wizard(t, 'ocean');
  assert.equal(dom.document.querySelector(PICK), null, 'the first card: nothing chosen, nothing lifts');

  dom.app.querySelectorAll('.mood')[3].click();
  const lifted = dom.document.querySelectorAll(PICK);
  assert.equal(lifted.length, 1, 'exactly one bubble lifts');
  assert.equal(lifted[0].closest('.mood'), dom.app.querySelectorAll('.mood')[3], 'and it is the one tapped');

  await beat(dom);
  assert.equal(title(dom), 'Azul');
  assert.equal(dom.document.querySelector(PICK), null, 'the next card arrives at rest');
});

test('Klassisch never matches the pick', async (t) => {
  const dom = await wizard(t, 'klassisch');
  dom.app.querySelectorAll('.mood')[3].click();
  assert.equal(dom.document.querySelector(PICK), null);
});

/* ---------------------------------------------------------------- the crown */

const ME = 'user-me';
function resultFixture() {
  const session = {
    id: 's1', createdAt: '2026-08-02T18:00:00.000Z', finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: ['g1', 'g2'], memberIds: ['m1', 'm2'],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } }, m2: { g1: { rating: 4 }, g2: { rating: 2 } } },
    votedIds: ['m1', 'm2'], done: true, cancelled: false, finished: true, winnerIds: [],
    chosenGameId: 'g1', events: [],
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

test('the people column survives a winner tap, so the crown transition can run', async (t) => {
  const { round, session } = resultFixture();
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, p, body) => {
    if (method === 'POST' && /\/finish$/.test(p)) {
      return { ...session, finished: true, winnerIds: body.winnerIds || [], finishedAt: session.finishedAt };
    }
    return round;
  });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.call('applyDesign', 'ocean');
  await dom.call('showResults', round, session, round.games, false);
  await flush();

  const change = [...dom.app.querySelectorAll('.tisch button')].find((b) => /Ändern/.test(b.textContent));
  assert.ok(change, 'the finished band offers „Ändern"');
  change.click();
  await flush();

  const anna = dom.app.querySelector('.result-people__person[data-pid="m1"]');
  assert.ok(anna, 'Anna sits in the people column');
  assert.ok(dom.document.querySelector(`${GATE}.result-people__person:not(.is-winner) .result-people__crown`),
    'a crown not yet won is at its scale-0 start');
  const chip = [...dom.app.querySelectorAll('.tisch button')].find((b) => /Anna/.test(b.textContent));
  chip.click();
  await flush();
  assert.equal(dom.app.querySelector('.result-people__person[data-pid="m1"]'), anna,
    'the same node — rebuilt, the crown would appear without its transition');
  assert.ok(anna.classList.contains('is-winner'), 'and the class moved on it');
});

/* ---------------------------------------------------------- the CSS contract */

const OCEAN_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(OCEAN_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));
const CURVE = 'cubic-bezier\\(0\\.2, 0\\.8, 0\\.3, 1\\)';

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
const users = (name) => rulesOf(OCEAN_CSS).filter(([, b]) => new RegExp(`animation[-a-z]*:[^;]*\\b${name}\\b`).test(b));
const gatedBody = (selector) => {
  const hits = motionRules.filter(([s]) => s === selector);
  assert.equal(hits.length, 1, `${selector} sits once inside prefers-reduced-motion: no-preference`);
  return hits[0][1];
};

test('the pick: 260ms ease-out to 8px up and 1.06, only on the advancing Ocean card', () => {
  assert.deepEqual(users('ocean-pick').map(([s]) => s), [PICK]);
  assert.match(gatedBody(PICK), /ocean-pick 260ms ease-out forwards/);
  assert.match(keyframes('ocean-pick'), /to\s*\{\s*transform:\s*translateY\(-8px\) scale\(1\.06\);/);
});

test('the crown: a 420ms scale transition that peaks at 1.18, and nothing else transitions', () => {
  const body = gatedBody(`${GATE}.result-people__crown`);
  const m = /transition:\s*scale 420ms cubic-bezier\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\);/.exec(body);
  assert.ok(m, 'scale alone, 420ms, on a bezier');
  // With both y control points at k the curve is 3k·t(1−t) + t³; its peak is the overshoot.
  const [, , y1, , y2] = m.map(Number);
  assert.equal(y1, y2, 'equal y controls, so the peak below is exact');
  let peak = 0;
  for (let t = 0; t <= 1; t += 0.0005) peak = Math.max(peak, 3 * y1 * t * (1 - t) + t ** 3);
  assert.ok(Math.abs(peak - 1.18) < 0.01, `O10.3's 1.18 — got ${peak.toFixed(3)}`);
  assert.match(body, /transform-origin:\s*0 100%/);
  assert.match(gatedBody(`${GATE}.result-people__person:not(.is-winner) .result-people__crown`), /^\s*scale:\s*0;\s*$/);
});

test('the sheet: 320ms up (docked phone sheets from their full height), scrim 160ms by colour', () => {
  const scrim = `${GATE}.sheet-backdrop`;
  assert.deepEqual(users('ocean-scrim').map(([s]) => s), [scrim]);
  assert.match(gatedBody(scrim), /ocean-scrim 160ms ease-out/);
  assert.match(keyframes('ocean-scrim'), /from\s*\{\s*background-color:\s*transparent;\s*\}/);
  assert.doesNotMatch(keyframes('ocean-scrim'), /opacity/, 'opacity would fade the sheet inside the backdrop too');

  const docked = `${GATE}:is(.sheet-backdrop:not(.sheet-backdrop--center), .sheet-backdrop--editor) > .sheet`;
  assert.deepEqual(users('ocean-sheet-up').map(([s]) => s), [docked]);
  const phone = mediaBlocks(OCEAN_CSS).filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .flatMap(([, css]) => mediaBlocks(css)).filter(([q]) => /max-width:\s*639px/.test(q));
  assert.ok(phone.some(([, css]) => rulesOf(css).some(([s, b]) => s === docked && new RegExp(`ocean-sheet-up 320ms ${CURVE}`).test(b))),
    'the full-height ride is the phone\'s docked sheet only, inside the motion gate');
  assert.match(keyframes('ocean-sheet-up'), /from\s*\{\s*transform:\s*translateY\(100%\);\s*\}/);
  assert.match(gatedBody(`${GATE}.sheet-backdrop > .sheet`), new RegExp(`sheet-up 320ms ${CURVE}`));
});

test('the toast: 180ms in from 20px below, by `translate` so its centring stands', () => {
  const sel = `${GATE}.toast.is-on`;
  assert.deepEqual(users('ocean-toast-in').map(([s]) => s), [sel]);
  assert.match(gatedBody(sel), new RegExp(`ocean-toast-in 180ms ${CURVE}`));
  const frames = keyframes('ocean-toast-in');
  assert.match(frames, /from\s*\{\s*translate:\s*0 20px;\s*opacity:\s*0;\s*\}/);
  assert.doesNotMatch(frames, /\btransform\s*:/, 'transform would replace translateX(-50%)');
});

test('none of the four loops, and every one is Ocean\'s light scheme only', () => {
  for (const name of ['ocean-pick', 'ocean-scrim', 'ocean-sheet-up', 'ocean-toast-in']) {
    for (const [s, b] of users(name)) {
      assert.ok(s.startsWith(GATE), `${s} is gated on Ocean's light scheme`);
      assert.doesNotMatch(b, /infinite/);
    }
  }
});
