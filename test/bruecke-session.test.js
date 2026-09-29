'use strict';

/* Die Brücke's session loop (#1240 — B2.3–B2.5, B4.1–B4.4, B16.1, B16.3).
 *
 * Driven through the jsdom harness under Die Brücke AND Klassisch
 * (.claude/rules/testing-views-under-jsdom.md): the setup's step rail, pool
 * panel and themed words, the vote card's side panels, the result's two panels
 * with the winner split out of the headline, and the split tables. jsdom
 * applies no stylesheet, so the layout was measured in the browser (see the
 * PR); the stylesheet half here asserts the contracts the issue names — the
 * 44px back control, the seat grid from nine places, only the two scale ends
 * printed, and every rule gated on the dark scheme.
 *
 * Named for the design and the slice (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, declaredValue } = require('./support/css');

const HEAD = '/* ===== #1240 — Session loop: setup, vote card, result, several tables ===== */';
const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8');
/* Up to the NEXT slice's header, not to EOF: sibling Brücke slices append their
   own sections, and whichever merges later lands after this one. */
const START = RAW.indexOf(HEAD);
const NEXT = RAW.indexOf('/* ===== #', START + HEAD.length);
const SECTION = RAW.slice(START, NEXT === -1 ? undefined : NEXT).replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SECTION);
const GATE = ':root[data-design="bruecke"][data-scheme="dark"] ';
const bodyFor = (sel) => {
  const hit = RULES.find(([s]) => s === GATE + sel);
  assert.ok(hit, `bruecke.css has no #1240 rule for ${sel}`);
  return hit[1];
};

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
  { id: 'g3', title: 'Dixit', minPlayers: 1, maxPlayers: 8 },
];
const roundFixture = (sessions = []) => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  members: MEMBERS.map((m) => ({ ...m })),
  tags: [],
  sessions,
  games: GAMES.map((g) => ({ ...g })),
});

function boot(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  dom.set('showSessionLobby', () => {});
  if (design) dom.call('applyDesign', design);
  return dom;
}

const q = (dom, sel) => dom.app.querySelector(sel);
const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ setup

async function setup(t, design) {
  const dom = boot(t, design);
  await dom.call('showStartSession', roundFixture());
  await flush();
  return dom;
}

test('Die Brücke is worn: the design hook the stylesheet gates on is set', async (t) => {
  const dom = await setup(t, 'bruecke');
  const root = dom.document.documentElement;
  assert.equal(root.getAttribute('data-design'), 'bruecke');
  assert.equal(root.getAttribute('data-scheme'), 'dark');
});

test('the step rail reads 1 ▸ 2 ▸ 3 — Wer spielt mit?, Pool, Zündung — with no leading zero', async (t) => {
  const dom = await setup(t, 'bruecke');
  const steps = qa(dom, '.page-head--bruecke .bruecke-steps__step');
  assert.deepEqual(steps.map((s) => s.querySelector('.bruecke-steps__n').textContent), ['1', '2', '3']);
  assert.deepEqual(steps.map(text), ['1 Wer spielt mit?', '2 Pool', '3 Zündung']);
  assert.ok(steps[0].classList.contains('is-current'));
  assert.equal(dom.document.querySelector('h1').textContent, 'Neue Session', 'the page title stays the app\'s');
});

test('the pool is its own panel: the kicker and the filter, the count „3 Spiele im Pool", the reset', async (t) => {
  const dom = await setup(t, 'bruecke');
  const pool = q(dom, '.bruecke-pool');
  assert.ok(pool, 'no pool panel');
  assert.equal(pool.getAttribute('aria-labelledby'), 'poolTitle');
  assert.ok(pool.querySelector('.bruecke-pool__head .setup-filterbar'), 'the filter row heads the panel');
  assert.equal(text(q(dom, '#poolTitle')), '3 Spiele im Pool');
  assert.ok(pool.querySelector('#poolReset'));
  assert.equal(q(dom, '.setup-grid__aside').firstElementChild, pool, 'the pool leads the aside');
});

test('the count asks „Sonden · wie viele werden gezogen?", the button reads „Zündung", and the ratings are sealed', async (t) => {
  const dom = await setup(t, 'bruecke');
  assert.equal(q(dom, '.setup-bar__count label').textContent, 'Sonden · wie viele werden gezogen?');
  assert.equal(q(dom, '#go').textContent.trim(), 'Zündung');
  assert.match(q(dom, '.bruecke-setup__sealed').textContent, /entschlüsselt/);
  assert.equal(q(dom, '#barSummary').nextElementSibling, q(dom, '.bruecke-setup__sealed'));
});

test('an empty pool is „0 Spiele im Pool" under the button too, never „im Topf"', async (t) => {
  const dom = boot(t, 'bruecke');
  const round = roundFixture();
  round.games.forEach((g) => { g.maxPlayers = 2; });
  await dom.call('showStartSession', round);
  await flush();
  assert.equal(text(q(dom, '#poolTitle')), '0 Spiele im Pool');
  assert.equal(q(dom, '#barSummary').textContent, '3 spielen mit · 0 Spiele im Pool');
});

test('Brücke seats carry their state as a word, and a guest reads „Gast · nur heute"', async (t) => {
  const dom = await setup(t, 'bruecke');
  const anna = qa(dom, '.nr-seat').find((s) => s.textContent.includes('Anna'));
  assert.ok(anna.querySelector('.nr-seat__state'), 'the seat names its state');
  assert.equal(anna.getAttribute('aria-label'), 'Anna, spielt mit');
  // Add a guest through the „+" seat's own form.
  q(dom, '.nr-seat--add').click();
  const input = dom.app.querySelector('.nr-guest-add input');
  input.value = 'Lea';
  input.form
    ? input.form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }))
    : input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  const guest = q(dom, '.nr-seat--guest .nr-seat__guest');
  assert.ok(guest, 'the guest seat rendered');
  assert.equal(guest.textContent, 'Gast · nur heute');
});

test('Klassisch keeps its setup: no rail, its own pot word, count label, button and guest word', async (t) => {
  const dom = await setup(t, null);
  assert.equal(q(dom, '.bruecke-steps'), null);
  assert.equal(q(dom, '.bruecke-pool'), null);
  assert.equal(q(dom, '.setup-grid--bruecke'), null);
  assert.match(q(dom, '#poolTitle').textContent, /Spiele im Topf/);
  assert.equal(q(dom, '.setup-bar__count label').textContent, 'Wie viele wirbeln?');
  assert.match(q(dom, '#go').textContent, /Loswirbeln/);
  assert.equal(q(dom, '.bruecke-setup__sealed'), null);
  assert.equal(dom.run("t('startSession.guestSeat')"), 'Gast');
});

// ------------------------------------------------------------------ vote card

const sessionFixture = (over = {}) => ({
  id: 's1',
  createdAt: '2026-09-24T18:00:00.000Z',
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

async function wizard(t, design) {
  const dom = boot(t, design);
  dom.set('api', async () => roundFixture());
  dom.set('currentUserId', () => null);
  await dom.call('startVoting', roundFixture(), sessionFixture(), GAMES, [{ id: 'm1', name: 'Anna', guest: false }], {
    skipIntro: true,
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  return dom;
}

test('the Brücke vote card is full-screen, with a back control; who rated and what is sealed follow the card', async (t) => {
  const dom = await wizard(t, 'bruecke');
  const card = q(dom, '.vote');
  assert.ok(card.classList.contains('vote--bruecke'));
  assert.ok(dom.document.body.classList.contains('vote-screen'), 'the rating step hides the top bar');
  assert.equal(dom.document.querySelector('.dock'), null, 'no dock on the rating step');
  assert.ok(card.querySelector('#backBtn.vote__undo'));
  const kids = [...card.children].map((el) => el.classList[0]);
  assert.deepEqual(kids.slice(0, 4), ['vote-felt', 'vote__card', 'bruecke-raters', 'bruecke-sealed'],
    'DOM order is the phone\'s reading order; the desktop grid places the columns');
});

test('the question asks for „Schub", and only the two ends are themed', async (t) => {
  const dom = await wizard(t, 'bruecke');
  assert.equal(q(dom, '#voteQ').textContent, 'Wie viel Schub gibst du diesem Spiel heute?');
  const faces = qa(dom, '.rating .mood');
  assert.equal(faces.length, 5);
  assert.equal(faces[0].querySelector('.mood__word').textContent, 'kein Schub');
  assert.equal(faces[4].querySelector('.mood__word').textContent, 'volle Kraft');
  assert.equal(faces[3].querySelector('.mood__word').textContent, 'gern', 'the middle keeps the app\'s word');
  assert.equal(faces[0].getAttribute('aria-label'), '1 von 5 – kein Schub');
});

test('who has rated, in words; „Verdeckt" counts the cards still to come and stands down on the last', async (t) => {
  const dom = await wizard(t, 'bruecke');
  assert.deepEqual(qa(dom, '.bruecke-raters__row').map(text), [
    'AN Anna wertet gerade', 'BE Ben hat gewertet', 'CL Clara noch offen',
  ]);
  assert.equal(q(dom, '#brueckeSealedTitle').textContent, 'Verdeckt');
  assert.equal(q(dom, '.bruecke-sealed__text').textContent, 'Noch 2 Spiele bleiben verschlüsselt, bis du sie erreichst.');
  assert.equal(qa(dom, '.bruecke-sealed__card').length, 2);
  for (let i = 0; i < 2; i++) {
    qa(dom, '.rating .mood')[2].click();
    await new Promise((r) => setTimeout(r, 900));
  }
  assert.equal(q(dom, '.vote__title').textContent.trim(), 'Dixit');
  assert.equal(q(dom, '.bruecke-sealed'), null, 'the last card has nothing after it');
  assert.ok(q(dom, '.bruecke-raters'), 'who rated stays');
});

test('Klassisch keeps its vote card and its plain faces', async (t) => {
  const dom = await wizard(t, null);
  assert.equal(q(dom, '.vote--bruecke'), null);
  assert.equal(q(dom, '.bruecke-raters'), null);
  assert.equal(q(dom, '.mood__word'), null);
  assert.ok(q(dom, '.vote__who'), 'Klassisch keeps its own card');
  assert.doesNotMatch(dom.app.textContent, /Schub/);
});

// ------------------------------------------------------------------ result

function resultFixture(over = {}) {
  const session = {
    id: 's1',
    createdAt: '2026-09-14T18:00:00.000Z',
    finishedAt: '2026-09-14T22:10:00.000Z',
    gameIds: ['g1', 'g2', 'g3'],
    memberIds: ['m1', 'm2', 'm3'],
    votes: {
      m1: { g1: { rating: 5 }, g2: { rating: 3 }, g3: { rating: 1 } },
      m2: { g1: { rating: 4 }, g2: { rating: 4 }, g3: { rating: 4 } },
      m3: { g1: { rating: 5 }, g2: { rating: 3 }, g3: { rating: 4 } },
    },
    votedIds: ['m1', 'm2', 'm3'],
    done: true,
    cancelled: false,
    finished: true,
    winnerIds: ['m2'],
    chosenGameId: 'g1',
    events: [],
    ...over,
  };
  return { round: roundFixture([session]), session };
}

async function result(t, design, over) {
  const { round, session } = resultFixture(over);
  const dom = boot(t, design);
  dom.set('api', async () => round);
  dom.set('currentUserId', () => null);
  await dom.call('showResults', round, session);
  return dom;
}

test('the Brücke result stands in two panels: the sentence and the Tafel, then the game and the foot', async (t) => {
  const dom = await result(t, 'bruecke');
  const screen = q(dom, '.result-screen');
  assert.ok(screen.classList.contains('result-screen--bruecke'));
  assert.deepEqual([...screen.children].map((el) => el.className),
    ['bruecke-result__main', 'bruecke-result__side']);
  const main = q(dom, '.bruecke-result__main');
  assert.ok(main.querySelector('.page-head--result'));
  assert.ok(main.querySelector('.tafel'));
  const side = q(dom, '.bruecke-result__side');
  assert.ok(side.querySelector('.tisch[data-state="done"]'), 'the played game heads the side panel');
  assert.ok(side.lastElementChild.classList.contains('result-foot'), 'the foot stays the last block');
});

test('the headline names the winner in its own voice, and the sentence stays the app\'s', async (t) => {
  const dom = await result(t, 'bruecke');
  const title = q(dom, '.result-title');
  assert.equal(title.textContent, '„Azul“ wurde gespielt. Ben hat gewonnen!');
  assert.equal(title.querySelector('.result-title__won').textContent, 'Ben hat gewonnen!');
});

test('a tie names both players, in the accent (B16.3)', async (t) => {
  const dom = await result(t, 'bruecke', { winnerIds: ['m2', 'm3'] });
  const won = q(dom, '.result-title__won');
  assert.ok(won, 'the winners are split out');
  assert.match(won.textContent, /Ben/);
  assert.match(won.textContent, /Clara/);
  assert.equal(qa(dom, '.result-people__person.is-winner').length, 2);
});

test('the veto pill reads „1× kein Schub", never „kein Veto"', async (t) => {
  const dom = await result(t, 'bruecke');
  assert.deepEqual(qa(dom, '.score-why').map((el) => el.textContent), ['1× kein Schub']);
  assert.doesNotMatch(dom.app.textContent, /kein Veto/);
});

test('Klassisch keeps its one-column result and one-voice headline', async (t) => {
  const dom = await result(t, null);
  assert.equal(q(dom, '.result-screen--bruecke'), null);
  assert.equal(q(dom, '.bruecke-result__main'), null);
  assert.equal(q(dom, '.result-title__won'), null);
  assert.doesNotMatch(dom.app.textContent, /Schub/);
});

// ------------------------------------------------------------------ several tables

test('several tables: Die Brücke takes the one-screen split, one panel per table', async (t) => {
  const parent = {
    id: 'p1', createdAt: '2026-09-20T18:00:00.000Z', memberIds: ['m1', 'm2', 'm3'], gameIds: ['g1', 'g2'],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 2 } } }, multiTable: true, done: true, finished: false,
    cancelled: false, chosenGameId: null, winnerIds: [], childSessionIds: ['c1', 'c2'],
  };
  const child = (id, gid, ids) => ({
    id, createdAt: '2026-09-20T18:01:00.000Z', memberIds: ids, gameIds: [gid], votes: {}, done: true,
    finished: true, cancelled: false, chosenGameId: gid, parentSessionId: 'p1', winnerIds: [ids[0]],
  });
  const round = roundFixture([parent, child('c1', 'g1', ['m1']), child('c2', 'g2', ['m2', 'm3'])]);
  const dom = boot(t, 'bruecke');
  dom.set('roundCan', () => false);
  await dom.call('showTableBuilder', round, parent);
  assert.equal(qa(dom, '.split-tables--composed .split-table').length, 2);
});

// ------------------------------------------------------------------ stylesheet

test('the back control is a 44px key, and the faces at least as wide', () => {
  const undo = bodyFor('.vote--bruecke .vote__undo');
  assert.equal(declaredValue(undo, 'width'), 'var(--target-key)');
  assert.equal(declaredValue(undo, 'height'), 'var(--target-key)');
  assert.equal(declaredValue(bodyFor('.vote--bruecke .rating .mood'), 'min-width'), 'var(--target-key)');
  assert.equal(declaredValue(bodyFor('.setup-grid--bruecke .nr-seat'), 'min-height'), 'var(--target-key)');
});

test('only the two scale ends print a word; the middle keeps its height', () => {
  const middle = bodyFor('.vote--bruecke .rating .mood:not(:first-child):not(:last-child) .mood__word');
  assert.equal(declaredValue(middle, 'visibility'), 'hidden');
});

test('from nine places the seat list becomes a grid (B16.1)', () => {
  const grid = bodyFor('.setup-grid--bruecke .nr-table:has(> .nr-seat:nth-of-type(9))');
  assert.equal(declaredValue(grid, 'display'), 'grid');
});

test('every inline score pill is pinned back into the flow', () => {
  for (const sel of ['.result-screen--bruecke .trow__pill', '.split-row__pill']) {
    assert.equal(declaredValue(bodyFor(sel), 'position'), 'static', sel);
  }
});

test('every rule in the #1240 section is gated on Die Brücke\'s dark scheme', () => {
  assert.ok(START > 0, 'the section header is the merge seam other Brücke slices rely on');
  assert.ok(RULES.length > 60, `only ${RULES.length} rules found — did the parse break?`);
  const ungated = RULES.flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((s) => s.trim()))
    .filter((s) => !s.startsWith('@') && !s.startsWith(GATE.trim()));
  assert.deepEqual(ungated, []);
});
