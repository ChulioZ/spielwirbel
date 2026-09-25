'use strict';

/* Der Tisch's motion ritual 3 (#1200, T10.3): the vote card tips to the next.
 *
 * The gate is the risk. The card is rebuilt on EVERY render: on the rating tap
 * itself (to show the chosen face through the beat), on the advance, on Back,
 * on a language switch. Only the advance is a hand-over, so only the card the
 * beat delivered may tip — a tip on the tap's own re-render would turn the
 * acknowledgement frame away, and one on Back or a language switch would be
 * motion nobody caused. Both card renderers (hot-seat wizard and shared link)
 * must agree, because vote-advance.js exists so that they do.
 *
 * The motion itself is judged from a recording; the CSS half pins the shared
 * contract (Tisch only, inside the motion gate, ≤ 900ms, no `infinite`, no end
 * frame, no `pointer-events`).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');
const { setMotion, beat } = require('./support/vote-card');

const GAMES = [
  { id: 'g1', title: 'Kartographen', minPlayers: 2, maxPlayers: 5 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
  { id: 'g3', title: 'Cascadia', minPlayers: 1, maxPlayers: 4 },
];
const roundFixture = () => ({
  id: 'r1', name: 'Donnerstagsrunde', background: null, tags: [], sessions: [],
  members: [{ id: 'm1', name: 'Anna' }], games: GAMES.map((g) => ({ ...g })),
});
const sessionFixture = () => ({
  id: 's1', createdAt: '2026-09-24T18:00:00.000Z', gameIds: GAMES.map((g) => g.id), memberIds: ['m1'],
  guests: [], votes: {}, votedIds: [], done: false, cancelled: false, finished: false,
  winnerIds: [], chosenGameId: null,
});

async function wizard(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async () => roundFixture());
  dom.set('currentUserId', () => null);
  await dom.call('startVoting', roundFixture(), sessionFixture(), GAMES, [{ id: 'm1', name: 'Anna', guest: false }], {
    skipIntro: true, saveVotes: async () => {}, onSaved: async () => {},
  });
  return dom;
}

const card = (dom) => dom.app.querySelector('.vote');
const title = (dom) => dom.app.querySelector('.vote__title').firstChild.textContent.trim();
const tap = (dom, n) => dom.app.querySelectorAll('.mood')[n - 1].click();

test('hot-seat: only the card the beat delivered tips', async (t) => {
  const dom = await wizard(t, 'tisch');
  assert.equal(title(dom), 'Kartographen');
  assert.equal(card(dom).classList.contains('is-tipped'), false, 'the first card is simply there');

  tap(dom, 4);
  assert.equal(title(dom), 'Kartographen', 'the beat still holds the rated card');
  assert.equal(card(dom).classList.contains('is-tipped'), false,
    'the tap\'s own re-render is the acknowledgement frame — it must not turn away');

  await beat(dom);
  assert.equal(title(dom), 'Azul');
  assert.equal(card(dom).classList.contains('is-tipped'), true, 'the delivered card tips in');

  // A language switch rebuilds the same card: nothing was handed over.
  dom.run('currentView()');
  assert.equal(title(dom), 'Azul');
  assert.equal(card(dom).classList.contains('is-tipped'), false, 'a re-render must not tip again');
});

test('Klassisch never tips', async (t) => {
  const dom = await wizard(t, 'klassisch');
  tap(dom, 4);
  await beat(dom);
  assert.equal(title(dom), 'Azul');
  assert.equal(card(dom).classList.contains('is-tipped'), false);
});

const BALLOT = {
  roundName: 'Donnerstagsrunde',
  demo: false,
  games: GAMES.map((g) => ({ ...g })),
  people: [{ id: 'm1', name: 'Anna', color: null, hasVoted: false, linked: false }],
};

test('the shared-link card tips on the same moment, and not on Zurück', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  dom.run('applyDesign("tisch")');
  dom.call('renderVoteLinkCards', 'tok', BALLOT, BALLOT.people[0]);
  assert.equal(card(dom).classList.contains('is-tipped'), false, 'the first card is simply there');

  tap(dom, 3);
  assert.equal(card(dom).classList.contains('is-tipped'), false, 'not on the tap itself');
  await beat(dom);
  assert.equal(title(dom), 'Azul');
  assert.equal(card(dom).classList.contains('is-tipped'), true, 'the delivered card tips in');

  dom.app.querySelector('#backBtn').click();
  assert.equal(title(dom), 'Kartographen');
  assert.equal(card(dom).classList.contains('is-tipped'), false, 'going back is not a hand-over');
});

/* ---------------------------------------------------------- the CSS contract */

const TISCH_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const motionRules = mediaBlocks(TISCH_CSS)
  .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
  .flatMap(([, css]) => rulesOf(css));

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

test('the tip: Tisch only, inside the motion gate, ≤ 900ms, no end frame', () => {
  const selector = ':root[data-design="tisch"] .vote--tisch.is-tipped .vote__card';
  const users = rulesOf(TISCH_CSS).filter(([, b]) => /animation[-a-z]*:[^;]*tisch-vote-tip/.test(b));
  assert.deepEqual(users.map(([s]) => s), [selector], 'exactly one rule runs it, on the paper card, under Der Tisch');
  const gated = motionRules.filter(([s, b]) => s === selector && b.includes('tisch-vote-tip'));
  assert.equal(gated.length, 1, 'and it sits inside prefers-reduced-motion: no-preference');
  assert.match(gated[0][1], /tisch-vote-tip 380ms /);
  assert.doesNotMatch(gated[0][1], /infinite|pointer-events/);
  const frames = keyframes('tisch-vote-tip');
  assert.ok(frames, 'the keyframes exist');
  assert.match(frames, /rotateY\(90deg\)/, 'it comes back from edge-on — the unreadable middle of the turn');
  assert.doesNotMatch(frames, /(^|[\s}])(to|100%)\s*\{/, 'no end frame: it ends on the rest state');
});
