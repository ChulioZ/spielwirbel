'use strict';

/* Ocean's shared vote (#1214 — O4.3 Geteilte Wertung at 1440, O6.5 Sichtblende
 * at 390): the pass-device blind in deep water, and the live vote with its
 * „Noch in der Tiefe" block.
 *
 * Driven through the jsdom harness under Ocean AND Klassisch
 * (.claude/rules/testing-views-under-jsdom.md). jsdom applies no stylesheet, so
 * the layout was measured in the browser (see the PR); the stylesheet half here
 * pins the contracts the issue names — the 44px controls, the deep tokens, and
 * the light-scheme gate on every rule of the section.
 *
 * Named for the design and the slice (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, declaredValue } = require('./support/css');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/ocean.css'), 'utf8');
const HEAD = '/* ===== #1214 — Shared vote: the pass-device blind and the live vote ===== */';
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"]) ';

function section() {
  const start = RAW.indexOf(HEAD);
  assert.ok(start >= 0, 'the section header is the merge seam other Ocean slices rely on');
  const next = RAW.indexOf('/* ===== #', start + HEAD.length);
  return RAW.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
}
const bodyFor = (sel) => {
  const hit = rulesOf(section()).find(([s]) => s === GATE + sel);
  assert.ok(hit, `ocean.css has no #1214 rule for ${sel}`);
  return hit[1];
};

const ME = 'user-me';
const roundFixture = () => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }],
  tags: [],
  sessions: [],
  games: [
    { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
    { id: 'g3', title: 'Dixit', minPlayers: 1, maxPlayers: 8 },
  ],
});
const sessionFixture = (over = {}) => ({
  id: 's1',
  createdAt: '2026-09-25T18:00:00.000Z',
  gameIds: ['g1', 'g2', 'g3'],
  memberIds: ['m1', 'm2', 'm3'],
  guests: [],
  votes: {},
  votedIds: ['m2'],
  done: false,
  cancelled: false,
  finished: false,
  winnerIds: [],
  chosenGameId: null,
  ...over,
});

const q = (dom, sel) => dom.app.querySelector(sel);
const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

function boot(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.set('api', async () => roundFixture());
  if (design) dom.call('applyDesign', design);
  return dom;
}

// ------------------------------------------------------------------ the blind

async function blind(t, design) {
  const dom = boot(t, design);
  // Clara is handed the device: not the seat's own voter, so the intro shows.
  const clara = { id: 'm3', name: 'Clara', guest: false };
  await dom.call('startVoting', roundFixture(), sessionFixture(), roundFixture().games, [clara], {
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  return dom;
}

test('the Ocean blind is full-screen and says whose turn it is, to the table', async (t) => {
  const dom = await blind(t, 'ocean');
  const screen = q(dom, '.handover');
  assert.ok(screen.classList.contains('handover--ocean'));
  assert.ok(dom.document.body.classList.contains('vote-screen'), 'the blind hides the top bar, like the card');
  assert.equal(dom.document.querySelector('.dock'), null, 'no dock on the blind');
  assert.equal(text(q(dom, '.handover__name')), 'Clara ist dran.');
  assert.equal(text(q(dom, '#goBtn')), 'Ich bin Clara — Karten zeigen');
  assert.equal(screen.querySelector('.vote-progress'), null, 'the relay row carries where the table is');
});

test('the relay row names every seat\'s state in words', async (t) => {
  const dom = await blind(t, 'ocean');
  assert.deepEqual(qa(dom, '.ocean-relay__seat').map(text), [
    'AN Anna noch offen', 'BE Ben hat gewertet', 'CL Clara ist dran',
  ]);
  assert.ok(q(dom, '.ocean-relay__seat.is-now'));
});

test('„Karten zeigen" opens the first card', async (t) => {
  const dom = await blind(t, 'ocean');
  q(dom, '#goBtn').click();
  await flush();
  assert.equal(q(dom, '.handover'), null);
  assert.equal(q(dom, '.vote__title').textContent.trim(), 'Azul');
});

test('Klassisch keeps its handover: coloured card, own sentence, progress bar, top bar', async (t) => {
  const dom = await blind(t);
  const screen = q(dom, '.handover');
  assert.ok(!screen.classList.contains('handover--ocean'));
  assert.equal(text(q(dom, '.handover__name')), 'Clara, du bist dran!');
  assert.ok(screen.querySelector('.vote-progress'));
  assert.equal(q(dom, '.ocean-relay'), null);
  assert.ok(!dom.document.body.classList.contains('vote-screen'));
});

// ------------------------------------------------------------------ the live vote

async function lobby(t, design, session = sessionFixture()) {
  const dom = boot(t, design);
  await dom.call('showSessionLobby', roundFixture(), session, false);
  t.after(() => dom.call('stopLobbyPoll'));
  return dom;
}

test('„Noch in der Tiefe" names what is hidden, under the roster', async (t) => {
  const dom = await lobby(t, 'ocean');
  assert.ok(q(dom, '.live-vote').classList.contains('live-vote--ocean'));
  const deep = q(dom, '.live-vote__people > .ocean-deep');
  assert.ok(deep, 'inside the roster, so .live-vote keeps its five children');
  assert.equal(text(deep.querySelector('.ocean-side__title')), 'Noch in der Tiefe');
  assert.match(text(deep.querySelector('.ocean-deep__text')), /^Die Karten von Ben liegen schon unten\./);
  assert.equal(deep.querySelectorAll('.ocean-deep__card').length, 1);
});

test('the block counts several voters, and stands down while nothing is hidden', async (t) => {
  const two = await lobby(t, 'ocean', sessionFixture({ votedIds: ['m2', 'm3'] }));
  assert.match(text(q(two, '.ocean-deep__text')), /^Die Karten von 2 Personen liegen schon unten\./);
  assert.equal(qa(two, '.ocean-deep__card').length, 2);
  const none = await lobby(t, 'ocean', sessionFixture({ votedIds: [] }));
  assert.equal(q(none, '.ocean-deep'), null);
});

test('Klassisch keeps its lobby', async (t) => {
  const dom = await lobby(t);
  assert.ok(!q(dom, '.live-vote').classList.contains('live-vote--ocean'));
  assert.equal(q(dom, '.ocean-deep'), null);
});

// ------------------------------------------------------------------ stylesheet

test('the blind is deep water with light ink, and its controls meet the 44px token', () => {
  // The water is on the body, the surface that reaches the viewport's edges.
  const page = bodyFor('body.vote-screen:has(.handover--ocean)');
  assert.match(declaredValue(page, 'background'), /var\(--deep\).*var\(--deep-bottom\).*var\(--deep-ground\)/);
  assert.equal(declaredValue(bodyFor('.handover.handover--ocean'), 'color'), 'var(--deep-ink)');
  assert.equal(declaredValue(bodyFor('.handover--ocean .handover__go'), 'min-height'), 'var(--target-button)');
  assert.equal(declaredValue(bodyFor('.handover--ocean .handover__back'), 'min-height'), 'var(--target-button)');
});

test('the lobby\'s deep block is shown at every width and never takes the card\'s named area', () => {
  // #1213 names `.ocean-deep`'s area `deep` from 1100px. Inside the roster,
  // which defines no such area, the browser invents one and the roster's single
  // track collapsed to „0px 161px 307px" — measured on this slice.
  const body = bodyFor('.live-vote--ocean .ocean-deep');
  assert.equal(declaredValue(body, 'display'), 'block');
  assert.equal(declaredValue(body, 'grid-area'), 'auto');
});

test('every rule in the #1214 section is gated on Ocean\'s light scheme', () => {
  const rules = rulesOf(section());
  assert.ok(rules.length > 20, `only ${rules.length} rules found — did the parse break?`);
  // Split on top-level commas only, so `:is(.a, .b)` stays one selector.
  const ungated = rules.flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((x) => x.trim()))
    .filter((x) => !x.startsWith('@') && !x.startsWith(GATE.trim()));
  assert.deepEqual(ungated, []);
});
