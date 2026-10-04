'use strict';

/* Das Programmheft's session loop (#1374 — P2.2–P2.4, P4.1–P4.4, P6.7, P7.7,
 * P7.9).
 *
 * Driven through the jsdom harness under Das Programmheft
 * (.claude/rules/testing-views-under-jsdom.md): the setup's kicker headings,
 * „Der Topf" with the games by name and playtime and the black box, the vote
 * card's labelled „Zurück" and scale ends, the report's kicker and two-voice
 * headline, the Tafel's per-step counts, the tie and the several tables.
 * Klassisch's side is test/programmheft-session-klassisch-golden.test.js.
 * jsdom applies no stylesheet, so the layout was measured in the browser (see
 * the PR); the stylesheet half here asserts the contracts the issue names — the
 * 44px back key and cells, and no step bar.
 *
 * Named for the design and the slice (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, declaredValue } = require('./support/css');

const HEAD = '/* ===== #1374 — the session loop: Neue Session, vote card, result, several tables ===== */';
const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/programmheft.css'), 'utf8');
const START = RAW.indexOf(HEAD);
const NEXT = RAW.indexOf('/* ===== #', START + HEAD.length);
const SECTION = RAW.slice(START, NEXT === -1 ? undefined : NEXT).replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SECTION);
const bodyFor = (sel) => {
  const hit = RULES.find(([s]) => s === sel);
  assert.ok(hit, `programmheft.css has no #1374 rule for ${sel}`);
  return hit[1];
};

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
const GAMES = [
  { id: 'g1', title: 'Nordlichter', minPlayers: 1, maxPlayers: 8, minPlaytime: 90, maxPlaytime: 90 },
  { id: 'g2', title: 'Moorgeister', minPlayers: 1, maxPlayers: 8, minPlaytime: 40, maxPlaytime: 40 },
  { id: 'g3', title: 'Salzwiesen', minPlayers: 1, maxPlayers: 8 },
];
const roundFixture = (sessions = []) => ({
  id: 'r1',
  name: 'Donnerstagsrunde',
  background: null,
  members: MEMBERS.map((m) => ({ ...m })),
  tags: [],
  sessions,
  games: GAMES.map((g) => ({ ...g })),
  activity: [],
});

function boot(t, design, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  dom.set('showSessionLobby', () => {});
  dom.set('currentUserId', () => null);
  dom.set('api', async () => round);
  dom.call('applyDesign', design);
  return dom;
}

const q = (dom, sel) => dom.app.querySelector(sel);
const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ setup

async function setup(t, round = roundFixture()) {
  const dom = boot(t, 'programmheft', round);
  await dom.call('showStartSession', round);
  await flush();
  return dom;
}

test('Das Programmheft is worn: the light scheme the stylesheet gates on', async (t) => {
  const dom = await setup(t);
  const root = dom.document.documentElement;
  assert.equal(root.getAttribute('data-design'), 'programmheft');
  assert.notEqual(root.getAttribute('data-scheme'), 'dark');
});

test('the setup has NO step bar (E1): the head is the marker rule and the app\'s title', async (t) => {
  const dom = await setup(t);
  const head = q(dom, '.page-head--ph-setup');
  assert.ok(head, 'the head is the programme\'s');
  assert.deepEqual([...head.children].map((el) => el.tagName.toLowerCase()), ['span', 'h1']);
  assert.ok(head.firstElementChild.classList.contains('ph-rule'));
  assert.equal(head.querySelector('h1').textContent, 'Neue Session');
  assert.equal(dom.document.querySelectorAll('ol, [class*="steps"]').length, 0, 'nothing step-shaped anywhere');
});

test('who plays is a kicker heading with the tap hint, and every seat states itself in words', async (t) => {
  const dom = await setup(t);
  const label = q(dom, '#seatsLabel');
  assert.equal(label.tagName, 'H2');
  assert.equal(label.textContent, 'Wer spielt mit?');
  assert.equal(q(dom, '.ph-setup__hint').textContent, 'Platz antippen = mitspielen');
  assert.equal(q(dom, '.nr-seats').getAttribute('aria-labelledby'), 'seatsLabel');
  assert.deepEqual(qa(dom, '.nr-seat:not(.nr-seat--add) .nr-seat__state').map((el) => el.textContent),
    ['spielt mit', 'spielt mit', 'spielt mit']);
});

test('„Der Topf" is its own section: the filter in its heading line, the count, the games by name and playtime', async (t) => {
  const dom = await setup(t);
  const pot = q(dom, '.ph-pot');
  assert.equal(pot.getAttribute('aria-labelledby'), 'potHeading');
  assert.equal(q(dom, '#potHeading').textContent, 'Der Topf');
  assert.ok(pot.querySelector('.ph-pot__head .setup-filterbar'), 'the filter row heads the section');
  assert.equal(text(pot.querySelector('#poolTitle')), '3 Spiele im Topf');
  assert.ok(pot.querySelector('#poolReset'));
  const tiles = [...pot.querySelectorAll('.pool-tile')];
  assert.deepEqual(tiles.map((el) => el.querySelector('.pool-tile__name').textContent), ['Nordlichter', 'Moorgeister', 'Salzwiesen']);
  assert.deepEqual(tiles.map((el) => (el.querySelector('.pool-tile__meta') || { textContent: null }).textContent),
    ['90 Min.', '40 Min.', null], 'a game with no playtime prints none rather than an empty cell');
  assert.equal(q(dom, '.setup-grid__aside').firstElementChild, pot, 'the pot leads the aside');
});

test('the box reads „Wie viele wirbeln?" over the summary, and the button „Loswirbeln →"', async (t) => {
  const dom = await setup(t);
  assert.equal(q(dom, '.setup-bar__count label').textContent, 'Wie viele wirbeln?');
  assert.equal(q(dom, '#go').textContent.trim(), 'Loswirbeln');
  assert.ok(q(dom, '#go .ti-arrow-right'));
  assert.equal(q(dom, '#barSummary').textContent, '3 spielen mit · 3 von 3 Spielen werden gezogen');
});

test('the section line stays on the setup, with no section current', async (t) => {
  const dom = await setup(t);
  const rail = dom.app.querySelector(':scope > .rail');
  assert.ok(rail, 'the rail is mounted');
  assert.equal(rail.querySelectorAll('.rail__item.is-active').length, 0);
});

// ------------------------------------------------------------------ vote card

async function wizard(t) {
  const round = roundFixture();
  const dom = boot(t, 'programmheft', round);
  const session = {
    id: 's1', createdAt: '2026-09-24T18:00:00.000Z', gameIds: ['g1', 'g2', 'g3'], memberIds: ['m1', 'm2', 'm3'],
    guests: [], votes: {}, votedIds: ['m2'], done: false, cancelled: false, finished: false, winnerIds: [], chosenGameId: null,
  };
  await dom.call('startVoting', round, session, round.games, [{ id: 'm1', name: 'Anna', guest: false }], {
    skipIntro: true,
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  return dom;
}

test('the vote card is the composed one, full-screen, with „Zurück" as a word and the two scale ends', async (t) => {
  const dom = await wizard(t);
  const card = q(dom, '.vote');
  assert.ok(card.classList.contains('vote--composed') && card.classList.contains('vote--ph'));
  assert.ok(dom.document.body.classList.contains('vote-screen'), 'the rating step hides the masthead');
  assert.equal(dom.document.querySelector('.dock'), null, 'no dock on the rating step (decision 8)');
  const back = card.querySelector('#backBtn');
  assert.equal(back.querySelector('.vote__undo-word').textContent, 'Zurück');
  assert.equal(back.getAttribute('aria-label'), 'Zurück');
  const faces = qa(dom, '.rating .mood');
  assert.deepEqual(faces.map((f) => f.querySelector('.mood__word').textContent),
    ['gar nicht', 'eher nicht', 'wäre okay', 'gern', 'unbedingt']);
  const ends = q(dom, '.rating-scale');
  assert.equal(ends.getAttribute('aria-hidden'), 'true', 'the cells already say their words');
  assert.deepEqual([...ends.children].map((el) => el.textContent), ['← gar nicht', 'unbedingt →']);
  assert.equal(q(dom, '.rating').nextElementSibling, ends, 'the ends sit directly under the cells');
});

// ------------------------------------------------------------------ result

function finished(over = {}) {
  return {
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
}

async function result(t, over) {
  const session = finished(over);
  const round = roundFixture([session]);
  const dom = boot(t, 'programmheft', round);
  await dom.call('showResults', round, session);
  await flush();
  return dom;
}

test('the report opens on its kicker — date, games, people — and the session\'s number', async (t) => {
  const dom = await result(t);
  const head = q(dom, '.page-head--result');
  const kicker = head.querySelector('.ph-report');
  assert.equal(head.firstElementChild.firstElementChild, kicker, 'the kicker leads, over the headline');
  assert.equal(kicker.firstChild.textContent, 'Spielbericht · Montag, 14. September 2026 · 3 Spiele · 3 dabei');
  assert.equal(kicker.querySelector('.ph-report__no').textContent, 'Session Nr. 1');
  assert.equal(head.querySelector('.muted'), null, 'the kicker replaces the subtitle rather than repeating it');
});

test('the headline names the winner in its own voice; the sentence stays the app\'s', async (t) => {
  const dom = await result(t);
  const title = q(dom, '.result-title');
  assert.equal(title.textContent, '„Nordlichter“ wurde gespielt. Ben hat gewonnen!');
  assert.equal(title.querySelector('.result-title__won').textContent, 'Ben hat gewonnen!');
});

test('a tie names both winners, in the accent (P7.9), and the band beside it carries both', async (t) => {
  const dom = await result(t, { winnerIds: ['m2', 'm3'] });
  const won = q(dom, '.result-title__won');
  assert.match(won.textContent, /Ben/);
  assert.match(won.textContent, /Clara/);
  assert.equal(qa(dom, '.result-people__person.is-winner').length, 2);
  assert.equal(qa(dom, '.tisch__seats .seat').length, 2);
});

test('the Tafel heads „Platz · Spiel · Wertungen · Score", and every step prints its count', async (t) => {
  const dom = await result(t);
  assert.deepEqual(qa(dom, '.tafel__cols .tafel__col').map((el) => el.textContent), ['Platz', 'Spiel', 'Wertungen', 'Score']);
  const first = q(dom, '.trow');
  const cols = [...first.querySelectorAll('.bar-col')];
  // Nordlichter: 5, 4, 5 — nobody gave 1–3.
  assert.deepEqual(cols.map((c) => c.querySelector('.bar-col__n').textContent), ['·', '·', '·', '1', '2']);
  assert.deepEqual(cols.map((c) => c.dataset.count), ['0', '0', '0', '1', '2']);
  assert.equal(cols[4].querySelector('.sr-only').textContent, '2× „unbedingt“', 'a reader hears the count, and the rung by its word');
  assert.equal(cols[4].querySelector('.bar-col__n').getAttribute('aria-hidden'), 'true');
});

test('the band and its foot share one slot, so they stand together beside the Tafel', async (t) => {
  const dom = await result(t);
  const slot = q(dom, '.tisch-slot');
  assert.ok(slot.querySelector('.tisch[data-state="done"]'));
  assert.equal(slot.lastElementChild.className, 'result-foot');
  assert.match(slot.querySelector('.result-foot__again').textContent, /Noch eine Session/);
  assert.equal(slot.querySelector('.tisch__actions-label').textContent, 'Falls etwas anders lief');
});

// ------------------------------------------------------------------ several tables

test('several tables: one report — the kicker with the tables and people, the app\'s split sentence', async (t) => {
  const parent = finished({
    id: 'p1', votes: { m1: { g1: { rating: 5 }, g2: { rating: 2 } } }, gameIds: ['g1', 'g2'],
    multiTable: true, finished: false, chosenGameId: null, winnerIds: [], childSessionIds: ['c1', 'c2'],
  });
  const child = (id, gid, ids) => finished({
    id, gameIds: [gid], memberIds: ids, votes: {}, votedIds: [], chosenGameId: gid, parentSessionId: 'p1', winnerIds: [ids[0]],
  });
  const round = roundFixture([parent, child('c1', 'g1', ['m1']), child('c2', 'g2', ['m2', 'm3'])]);
  const dom = boot(t, 'programmheft', round);
  dom.set('roundCan', () => false);
  await dom.call('showTableBuilder', round, parent);
  await flush();
  const head = q(dom, '.page-head--tables');
  assert.equal(head.querySelector('h1').textContent, 'Die Session wurde auf mehrere Tische aufgeteilt.');
  assert.equal(head.querySelector('.ph-report').textContent, 'Spielbericht · Montag, 14. September 2026 · 2 Tische · 3 dabei');
  assert.equal(head.querySelector('.muted').textContent, 'alle Ergebnisse stehen in derselben Chronik');
  assert.equal(qa(dom, '.split-tables--composed .split-table').length, 2);
});

// ------------------------------------------------------------------ stylesheet

const PH = ':root[data-design="programmheft"] ';

test('„Zurück" and the five cells are 44px keys (rule T7)', () => {
  const undo = bodyFor(PH + '.vote--ph .vote__undo');
  assert.equal(declaredValue(undo, 'height'), 'var(--target-key)');
  assert.equal(declaredValue(undo, 'min-width'), 'var(--target-key)');
  assert.equal(declaredValue(bodyFor(PH + '.vote--ph .rating .mood'), 'min-width'), 'var(--target-key)');
  assert.equal(declaredValue(bodyFor(PH + '.setup-grid--ph .stepper__btn'), 'height'), 'var(--target-key)');
});

test('the veto cell is the stamp — paper, a vermilion edge — and the other chosen cells take their ramp step', () => {
  const veto = bodyFor(':root[data-design="programmheft"]:not([data-scheme="dark"]) .vote--ph .rating .mood.is-selected:nth-child(1)');
  assert.equal(declaredValue(veto, 'background'), 'var(--veto-fill)');
  assert.equal(declaredValue(veto, 'color'), 'var(--veto-ink)');
  for (let n = 2; n <= 5; n++) {
    const body = bodyFor(`:root[data-design="programmheft"]:not([data-scheme="dark"]) .vote--ph .rating .mood.is-selected:nth-child(${n})`);
    assert.equal(declaredValue(body, 'background'), `var(--ramp-${n})`);
    assert.equal(declaredValue(body, 'color'), `var(--ramp-ink-${n})`);
  }
});

test('the winning rows are the gold-tint, printed in ink', () => {
  assert.equal(declaredValue(bodyFor(':root[data-design="programmheft"]:not([data-scheme="dark"]) .result-screen .tafel-top .trow'), 'background'), 'var(--gold-soft)');
  assert.equal(declaredValue(bodyFor(':root[data-design="programmheft"]:not([data-scheme="dark"]) .result-screen .tafel .trow .trow__title'), 'color'), 'var(--ink)');
});
