'use strict';

/* Ocean's session loop (#1213 — O2.2–O2.4, O4.1, O4.2, O4.4, O4.5, O6.6).
 *
 * Driven through the jsdom harness under Ocean AND Klassisch
 * (.claude/rules/testing-views-under-jsdom.md): the setup re-composed around
 * the Muschel, the vote card's side columns, the result in columns and the
 * split tables. jsdom applies no stylesheet, so the layout was measured in the
 * browser (see the PR); the stylesheet half here asserts the contracts the
 * issue names — the vote card's 44px back control, the 96px faces, only the two
 * scale ends printed, the inline score pills pinned into the flow.
 *
 * Named for the design and the slice (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, declaredValue } = require('./support/css');

const OCEAN_CSS = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/ocean.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const SECTION = OCEAN_CSS.slice(OCEAN_CSS.indexOf('.setup-grid--ocean'));
const RULES = rulesOf(SECTION);
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"]) ';
const bodyFor = (sel) => {
  const hit = RULES.find(([s]) => s === GATE + sel);
  assert.ok(hit, `ocean.css has no rule for ${sel}`);
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

// ------------------------------------------------------------------ setup

async function setup(t, design) {
  const dom = boot(t, design);
  await dom.call('showStartSession', roundFixture());
  await flush();
  return dom;
}

test('Klassisch keeps its setup: no shell, its own pot word, count label and button', async (t) => {
  const dom = await setup(t, null);
  assert.equal(q(dom, '.setup-grid--ocean'), null);
  assert.equal(q(dom, '.ocean-muschel'), null);
  assert.equal(q(dom, '.ocean-count'), null);
  assert.match(q(dom, '#poolTitle').textContent, /Spiele im Topf/);
  assert.equal(q(dom, '.setup-bar__count label').textContent, 'Wie viele wirbeln?');
  assert.match(q(dom, '#go').textContent, /Loswirbeln/);
  assert.equal(q(dom, '.nr-seat__state'), null, 'Klassisch seats carry no state line');
});

test('Ocean puts the pool in the Muschel, the count under the covers, the filter and owners under the shell', async (t) => {
  const dom = await setup(t, 'ocean');
  const shell = q(dom, '.ocean-muschel');
  assert.ok(shell, 'no shell');
  assert.equal(shell.getAttribute('aria-labelledby'), 'poolTitle');
  const panel = shell.querySelector('.setup-panel');
  assert.equal(panel.lastElementChild.id, 'poolTitle', 'the count is the pill UNDER the covers');
  assert.equal(q(dom, '#poolTitle').textContent.replace(/\s+/g, ' ').trim(), '3 Spiele in der Muschel');
  // DOM order is the phone's reading order: covers, pill, filter row, reset, owners line.
  const order = [...shell.children].map((el) => el.id || el.className);
  assert.deepEqual(order.slice(0, 3), ['setup-panel', 'setup-filterbar', 'poolReset']);
  assert.ok(shell.querySelector('.pool-owners-note'), 'the owners line is the shell\'s footnote');
  // The shell leads the aside; the bar with the one action comes after it.
  const aside = q(dom, '.setup-grid__aside');
  assert.equal(aside.firstElementChild, shell);
  assert.ok(aside.querySelector('.setup-bar'));
});

test('Ocean asks its count question, dives with „Abtauchen" and states the draw under it', async (t) => {
  const dom = await setup(t, 'ocean');
  assert.equal(q(dom, '.setup-bar__count label').textContent, 'Wie viele holen wir hoch?');
  assert.equal(q(dom, '#go').textContent.trim(), 'Abtauchen');
  assert.equal(dom.document.querySelector('h1').textContent, 'Neue Session', 'the page title stays the app\'s');
  const bar = q(dom, '.setup-bar');
  assert.equal(bar.lastElementChild.id, 'barSummary', 'the summary sits under the button');
  assert.equal(q(dom, '#barSummary').textContent, '3 spielen mit · 3 von 3 Spielen werden gezogen');
});

test('the count bubbles follow the stepper, one per game, capped', async (t) => {
  const dom = await setup(t, 'ocean');
  const bubbles = () => qa(dom, '.ocean-count .ocean-count__bubble').length;
  assert.equal(bubbles(), 3);
  q(dom, '.stepper__btn[data-d="-1"]').click();
  assert.equal(bubbles(), 2);
  const input = q(dom, '#count');
  input.value = '12';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(bubbles(), dom.run('OCEAN_COUNT_BUBBLES'));
  assert.ok(q(dom, '.ocean-count').classList.contains('is-more'));
  assert.equal(q(dom, '.ocean-count').getAttribute('aria-hidden'), 'true', 'the number says it; the bubbles are its picture');
});

test('Ocean seats carry their state as text, and the accessible name says it', async (t) => {
  const dom = await setup(t, 'ocean');
  const anna = qa(dom, '.nr-seat').find((s) => s.textContent.includes('Anna'));
  assert.ok(anna.querySelector('.nr-seat__state'));
  assert.equal(anna.getAttribute('aria-label'), 'Anna, spielt mit');
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

test('the Ocean vote card is full-screen, with a back control, the card between who rated and what is below', async (t) => {
  const dom = await wizard(t, 'ocean');
  const card = q(dom, '.vote');
  assert.ok(card.classList.contains('vote--ocean'));
  assert.ok(dom.document.body.classList.contains('vote-screen'), 'the rating step hides the top bar');
  assert.equal(dom.document.querySelector('.dock'), null, 'no dock on the rating step');
  assert.ok(card.querySelector('#backBtn.vote__undo'));
  const kids = [...card.children].map((el) => el.classList[0]);
  assert.deepEqual(kids.slice(0, 4), ['vote-felt', 'ocean-raters', 'vote__card', 'ocean-deep'],
    'DOM order is the 1440 reading order: header, who rated, the card, what is below');
});

test('who has rated: the one rating now, the ones done, the ones open — in words', async (t) => {
  const dom = await wizard(t, 'ocean');
  const rows = qa(dom, '.ocean-raters__row');
  assert.deepEqual(rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()), [
    'AN Anna wertet gerade', 'BE Ben hat gewertet', 'CL Clara noch offen',
  ]);
  assert.equal(q(dom, '#oceanRatersTitle').textContent, '1 von 3 gewertet');
});

test('„in der Tiefe" counts the cards still below, and stands down on the last one', async (t) => {
  const dom = await wizard(t, 'ocean');
  assert.equal(q(dom, '#oceanDeepTitle').textContent, 'Noch in der Tiefe');
  assert.match(q(dom, '.ocean-deep__text').textContent, /^Noch 2 Karten warten unten\. Das Ergebnis taucht erst auf/);
  assert.equal(qa(dom, '.ocean-deep__card').length, 2);
  // Rate the first two games; the third card has nothing below it.
  for (let i = 0; i < 2; i++) {
    qa(dom, '.rating .mood')[2].click();
    await new Promise((r) => setTimeout(r, 900));
  }
  assert.equal(q(dom, '.vote__title').textContent.trim(), 'Dixit');
  assert.equal(q(dom, '.ocean-deep'), null);
});

test('the faces carry their words, and Klassisch keeps its card and plain faces', async (t) => {
  const ocean = await wizard(t, 'ocean');
  const faces = qa(ocean, '.rating .mood');
  assert.equal(faces.length, 5);
  assert.equal(faces[0].querySelector('.mood__word').textContent, 'gar nicht');
  assert.equal(faces[4].querySelector('.mood__word').textContent, 'unbedingt');
  assert.equal(faces[3].getAttribute('aria-label'), '4 von 5 – gern');

  const klassisch = await wizard(t, null);
  assert.equal(q(klassisch, '.vote--ocean'), null);
  assert.equal(q(klassisch, '.ocean-raters'), null);
  assert.equal(q(klassisch, '.mood__word'), null);
  assert.ok(q(klassisch, '.vote__who'), 'Klassisch keeps its own card');
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

async function result(t, design) {
  const { round, session } = resultFixture();
  const dom = boot(t, design);
  dom.set('api', async () => round);
  dom.set('currentUserId', () => null);
  await dom.call('showResults', round, session);
  return dom;
}

test('the Ocean result stands in three columns: the people, the sentence with the whale, the Tafel with its foot', async (t) => {
  const dom = await result(t, 'ocean');
  const screen = q(dom, '.result-screen');
  assert.ok(screen.classList.contains('result-screen--ocean'));
  assert.deepEqual([...screen.children].map((el) => el.className),
    ['ocean-result__people', 'ocean-result__main', 'ocean-result__side']);
  const main = q(dom, '.ocean-result__main');
  assert.ok(main.querySelector('.page-head--result'));
  assert.ok(main.querySelector('.tisch[data-state="done"]'), 'the played game is the whale\'s band');
  const side = q(dom, '.ocean-result__side');
  assert.ok(side.firstElementChild.classList.contains('tafel'));
  assert.ok(side.lastElementChild.classList.contains('result-foot'), 'the foot stays the last block');
  assert.ok(q(dom, '.ocean-result__people .result-people__person.is-winner'), 'the winner wears the crown');
  assert.equal(q(dom, '.result-title').textContent, '„Azul“ wurde gespielt. Ben hat gewonnen!');
});

test('the veto pill reads „1× gar nicht", never „kein Veto"', async (t) => {
  const dom = await result(t, 'ocean');
  const why = qa(dom, '.score-why').map((el) => el.textContent);
  assert.deepEqual(why, ['1× gar nicht']);
  assert.doesNotMatch(dom.app.textContent, /kein Veto/);
});

test('Klassisch keeps its one-column result', async (t) => {
  const dom = await result(t, null);
  assert.equal(q(dom, '.result-screen--ocean'), null);
  assert.equal(q(dom, '.ocean-result__main'), null);
  assert.equal(q(dom, '.result-foot'), null);
});

// ------------------------------------------------------------------ several tables

test('several tables: Ocean takes the one-screen split, one card per table', async (t) => {
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
  const dom = boot(t, 'ocean');
  dom.set('roundCan', () => false);
  await dom.call('showTableBuilder', round, parent);
  assert.equal(qa(dom, '.split-tables--tisch .split-table').length, 2);
  assert.equal(dom.document.querySelector('h1').textContent, '2 Tische, eine Session');
});

// ------------------------------------------------------------------ stylesheet

test('the vote card\'s back control and faces meet the 44px token; only the two ends print a word', () => {
  const undo = bodyFor('.vote--ocean .vote__undo');
  assert.equal(declaredValue(undo, 'width'), 'var(--target-button)');
  assert.equal(declaredValue(undo, 'height'), 'var(--target-button)');
  const mood = bodyFor('.vote--ocean .rating .mood');
  assert.equal(declaredValue(mood, 'min-height'), '96px');
  assert.equal(declaredValue(mood, 'min-width'), 'var(--target-button)');
  const middle = bodyFor('.vote--ocean .rating .mood:not(:first-child):not(:last-child) .mood__word');
  assert.equal(declaredValue(middle, 'visibility'), 'hidden', 'hidden, not removed: the columns keep one height');
});

test('every inline score pill is pinned back into the flow', () => {
  // `.score-pill` is absolutely positioned for a cover's corner
  // (.claude/rules/absolutely-positioned-components-escape-a-new-host.md).
  for (const sel of ['.result-screen--ocean .trow__pill', '.split-row__pill']) {
    assert.equal(declaredValue(bodyFor(sel), 'position'), 'static', sel);
  }
});

test('every rule in the #1213 section is gated on Ocean\'s light scheme', () => {
  const head = '/* ===== #1213 — Session loop: setup, vote card, result, several tables ===== */';
  const raw = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/ocean.css'), 'utf8');
  assert.ok(raw.includes(head), 'the section header is the merge seam other Ocean slices rely on');
  const section = raw.slice(raw.indexOf(head)).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = rulesOf(section);
  assert.ok(rules.length > 60, `only ${rules.length} rules found — did the parse break?`);
  const ungated = rules.flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((s) => s.trim()))
    .filter((s) => !s.startsWith('@') && !s.startsWith(':root[data-design="ocean"]:not([data-scheme="dark"])'));
  assert.deepEqual(ungated, []);
});
