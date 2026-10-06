'use strict';

/* Forest's session loop (#1468 — F2.2–F2.4, F4.1–F4.4, F6.7, F7.7, F7.9).
 *
 * Driven through the jsdom harness under Forest
 * (.claude/rules/testing-views-under-jsdom.md): the stump with its themed
 * heading and count, the count question with the app's line under it and
 * „Laub wirbeln", the vote card's side columns and labelled „Zurück", the
 * finale's reveal verb, the result's kicker, fact line and two columns, and
 * the several tables' head. Klassisch's side is the golden snapshot in
 * test/programmheft-session-klassisch-golden.test.js, whose control also
 * renders Forest. jsdom applies no stylesheet, so the layout was measured in
 * the browser (see the PR); the stylesheet half here asserts the contracts the
 * issue names — every vote-card key at 44px, the gold-tint winner row in ink,
 * and the fireflies only on the dusk.
 *
 * Named for the design and the slice (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, declaredValue, mediaBlocks } = require('./support/css');

const HEAD = '/* ===== #1468 — Session loop: Neue Session, vote card, finale, result, several tables ===== */';
const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/forest.css'), 'utf8');
const START = RAW.indexOf(HEAD);
const NEXT = RAW.indexOf('/* ===== #', START + HEAD.length);
const SECTION = RAW.slice(START, NEXT === -1 ? undefined : NEXT).replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SECTION);
const F = ':root[data-design="forest"]:not([data-scheme="dark"]) ';
const bodyFor = (sel) => {
  const hit = RULES.find(([s]) => s === F + sel);
  assert.ok(hit, `forest.css has no #1468 rule for ${sel}`);
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

test('Forest is worn, and forestWorn() answers for it and only for it', async (t) => {
  const dom = boot(t, 'forest', roundFixture());
  assert.equal(dom.document.documentElement.dataset.design, 'forest');
  assert.equal(dom.run('forestWorn()'), true);
  dom.call('applyDesign', 'klassisch');
  assert.equal(dom.run('forestWorn()'), false);
});

// ------------------------------------------------------------------ setup

async function setup(t, design = 'forest', round = roundFixture()) {
  const dom = boot(t, design, round);
  await dom.call('showStartSession', round);
  await flush();
  return dom;
}

test('the setup has NO step bar and keeps the app\'s title (P6)', async (t) => {
  const dom = await setup(t);
  assert.equal(text(q(dom, '.page-head h1')), 'Neue Session');
  assert.equal(q(dom, '.steps, .stepbar, [role="progressbar"]'), null);
  assert.ok(q(dom, '.setup-grid').classList.contains('setup-grid--forest'));
});

test('„Der Baumstumpf" is its own section named by its kicker; the count reads „… auf dem Stumpf"', async (t) => {
  const dom = await setup(t);
  const stump = q(dom, '.forest-stump');
  assert.equal(stump.getAttribute('aria-labelledby'), 'potHeading');
  assert.equal(text(stump.querySelector('#potHeading')), 'Der Baumstumpf');
  assert.equal(text(stump.querySelector('#poolTitle')), '3 Spiele auf dem Stumpf');
  // The count is the pill UNDER the covers, and the filter row and the reset
  // follow the stump, in that order.
  const panel = stump.querySelector('.setup-panel');
  assert.equal(panel.lastElementChild.id, 'poolTitle');
  const kids = [...stump.children];
  assert.deepEqual(kids.slice(0, 4).map((el) => el.id || el.className.split(' ')[0]),
    ['potHeading', 'setup-panel', 'setup-filterbar', 'poolReset']);
});

test('one game in the stump uses the singular', async (t) => {
  const round = roundFixture();
  round.games = round.games.slice(0, 1);
  const dom = await setup(t, 'forest', round);
  assert.equal(text(q(dom, '#poolTitle')), '1 Spiel auf dem Stumpf');
});

test('the count question is Forest\'s, with the app\'s „n von m Spielen werden gezogen" right under it', async (t) => {
  const dom = await setup(t);
  const count = q(dom, '.setup-bar__count');
  assert.equal(text(count.querySelector('label')), 'Wie viele Blätter fliegen?');
  const line = count.querySelector('label').nextElementSibling;
  assert.equal(line.id, 'barSummary');
  assert.equal(text(line), '3 von 3 Spielen werden gezogen · 3 spielen mit');
  assert.equal(count.querySelectorAll('.forest-leaves__leaf').length, 3, 'one leaf per drawn game');
  assert.equal(count.querySelector('.forest-leaves').getAttribute('aria-hidden'), 'true');
});

test('the setup button reads „Laub wirbeln" with the whirl — the hub\'s „Session wirbeln" is untouched', async (t) => {
  const dom = await setup(t);
  const go = q(dom, '#go');
  assert.equal(text(go), 'Laub wirbeln');
  assert.ok(go.querySelector('.ti-tornado'));
  assert.equal(dom.run("t('round.startSession')"), 'Session wirbeln');
});

test('the seats state themselves, and the tap hint leads the app\'s filter note', async (t) => {
  const dom = await setup(t);
  assert.ok(qa(dom, '.nr-seat__state').length >= 3, 'state lines on (stateLines)');
  const hint = q(dom, '#seatsLabel').nextElementSibling;
  assert.ok(hint.classList.contains('forest-setup__hint'));
  assert.equal(text(hint), 'Platz antippen = mitspielenDie Anzahl der Personen filtert die Spiele.');
});

test('an empty stump says so in the stump\'s own words', async (t) => {
  const round = roundFixture();
  round.games = [];
  const dom = await setup(t, 'forest', round);
  assert.equal(text(q(dom, '#barSummary')), '0 Spiele auf dem Stumpf · 3 spielen mit');
});

// ------------------------------------------------------------------ vote card

async function wizard(t, gameIds = ['g1', 'g2', 'g3']) {
  const round = roundFixture();
  const dom = boot(t, 'forest', round);
  const session = {
    id: 's1', createdAt: '2026-09-24T18:00:00.000Z', gameIds, memberIds: ['m1', 'm2', 'm3'],
    guests: [], votes: {}, votedIds: ['m2'], done: false, cancelled: false, finished: false, winnerIds: [], chosenGameId: null,
  };
  await dom.call('startVoting', round, session, round.games.filter((g) => gameIds.includes(g.id)),
    [{ id: 'm1', name: 'Anna', guest: false }], {
      skipIntro: true,
      saveVotes: async () => {},
      onSaved: async () => {},
    });
  return dom;
}

test('the vote card is full-screen and composed, with „Zurück" as a word and all five faces\' words', async (t) => {
  const dom = await wizard(t);
  const card = q(dom, '.vote');
  assert.ok(card.classList.contains('vote--composed') && card.classList.contains('vote--forest'));
  assert.ok(dom.document.body.classList.contains('vote-screen'), 'no header on the rating step');
  assert.equal(dom.document.querySelector('.dock'), null, 'no dock on the rating step');
  const back = card.querySelector('#backBtn');
  assert.equal(back.querySelector('.vote__undo-word').textContent, 'Zurück');
  assert.equal(back.getAttribute('aria-label'), 'Zurück');
  assert.deepEqual(qa(dom, '.rating .mood').map((f) => f.querySelector('.mood__word').textContent),
    ['gar nicht', 'eher nicht', 'wäre okay', 'gern', 'unbedingt'], 'face 3 is the app\'s „wäre okay" (U1)');
});

test('who has rated stands left of the card, the cards still to come face down right of it', async (t) => {
  const dom = await wizard(t);
  const card = q(dom, '.vote__card');
  const raters = q(dom, '.forest-raters');
  assert.equal(card.previousElementSibling, raters, 'DOM order is the 1440 reading order');
  assert.equal(text(raters.querySelector('.forest-kicker')), '1 von 3 gewertet');
  assert.deepEqual(qa(dom, '.forest-raters__row').map((r) => r.className.replace('forest-raters__row ', '')),
    ['is-now', 'is-done', 'is-open']);
  const hidden = q(dom, '.forest-hidden');
  assert.equal(card.nextElementSibling, hidden);
  assert.equal(text(hidden.querySelector('.forest-hidden__text')), 'Noch 2 Spiele liegen verdeckt, bis du sie erreichst.');
  assert.equal(hidden.querySelectorAll('.forest-hidden__card').length, 2);
  assert.equal(hidden.querySelector('.forest-hidden__cards').getAttribute('aria-hidden'), 'true');
});

test('the last card has nothing below it, so the hidden cards stand down', async (t) => {
  const dom = await wizard(t, ['g1']);
  assert.ok(q(dom, '.vote--forest .forest-raters'), 'the Forest card did render');
  assert.equal(q(dom, '.forest-hidden'), null);
});

// ------------------------------------------------------------------ finale

test('the finale carries the reveal verb as its kicker under Forest only', async (t) => {
  for (const design of ['forest', 'klassisch']) {
    const round = roundFixture();
    const dom = boot(t, design, round);
    const session = { id: 's1', createdAt: '2026-09-24T18:00:00.000Z', gameIds: ['g1'], memberIds: ['m1'], votes: {} };
    dom.call('showFinale', round, session, round.games);
    const kicker = q(dom, '.stage__kicker');
    if (design === 'forest') {
      assert.equal(text(kicker), 'Die Karten leuchten auf.');
      assert.equal(kicker.nextElementSibling, q(dom, '.stage__title'));
      assert.equal(text(q(dom, '.stage__reveal')), 'Sieger enthüllen', 'the button keeps the app\'s word');
    } else {
      assert.equal(kicker, null, 'Klassisch has no kicker');
    }
  }
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

async function result(t, over, earlier = []) {
  const session = finished(over);
  const round = roundFixture([...earlier, session]);
  const dom = boot(t, 'forest', round);
  await dom.call('showResults', round, session);
  await flush();
  return dom;
}

test('the result opens on the decorative kicker „Auf der Lichtung · {date}" over the app\'s headline', async (t) => {
  const dom = await result(t);
  const head = q(dom, '.page-head--result');
  const kicker = head.querySelector('.forest-result__kicker');
  assert.equal(head.firstElementChild.firstElementChild, kicker, 'the kicker leads');
  assert.equal(text(kicker), 'Auf der Lichtung · Montag, 14. September 2026');
  assert.equal(head.querySelector('.muted'), null, 'the kicker replaces the subtitle rather than repeating its date');
  assert.equal(text(q(dom, '.result-title')), '„Nordlichter“ wurde gespielt. Ben hat gewonnen!');
});

test('the fact line is built from counts the app keeps: the session\'s number, the win, the play', async (t) => {
  const earlier = [
    finished({ id: 's0', createdAt: '2026-09-07T18:00:00.000Z', winnerIds: ['m2'], chosenGameId: 'g1' }),
    finished({ id: 'sx', createdAt: '2026-09-21T18:00:00.000Z', winnerIds: ['m2'], chosenGameId: 'g1' }),
  ];
  const dom = await result(t, {}, earlier);
  const facts = q(dom, '.forest-facts');
  assert.equal(facts.hidden, false);
  assert.equal(text(facts), 'Session Nr. 2 · 2. Sieg für Ben · Nordlichter zum 2. Mal', 'a later session never counts');
});

test('a shared win has no single „n-th win", so that part drops — and both winners wear the crown (F7.9)', async (t) => {
  const dom = await result(t, { winnerIds: ['m2', 'm3'] });
  assert.equal(text(q(dom, '.forest-facts')), 'Session Nr. 1 · Nordlichter zum 1. Mal');
  assert.equal(qa(dom, '.result-people__person.is-winner').length, 2);
});

test('an unsettled session has no place in the count, so the fact line is hidden', async (t) => {
  const dom = await result(t, { finished: false, winnerIds: [] });
  assert.equal(q(dom, '.forest-facts').hidden, true);
});

// #1568: two columns, departing from F4.3's three on purpose (drawn with a few
// rows, measured at eight), as Ocean's did in #1430. The foot sits under the
// headline — after the ~520px tree it fell under the fold (operator decision)
// — so „Noch eine Session" comes ahead of the scene and the ranking in tab
// order too, which is intended.
test('the result is two columns in DOM order: side (people · head · foot · scene · facts), then the Tafel', async (t) => {
  const dom = await result(t);
  const screen = q(dom, '.result-screen');
  assert.ok(screen.classList.contains('result-screen--forest'));
  assert.deepEqual([...screen.children].map((el) => el.className),
    ['forest-result__side', 'forest-result__tafel']);
  const side = q(dom, '.forest-result__side');
  assert.deepEqual([...side.children].map((el) => el.className.split(' ')[0]),
    ['forest-result__people', 'page-head', 'result-foot', 'tisch-slot', 'forest-facts']);
  assert.ok(side.querySelector('.result-people__person.is-winner'), 'the people are the side column\'s ring row');
  const list = q(dom, '.forest-result__tafel');
  assert.deepEqual([...list.children].map((el) => el.className.split(' ')[0]).slice(0, 2), ['badge-moment', 'tafel'],
    'the badge moment opens the Tafel column, then the ranking');
  assert.equal(list.querySelector('.result-foot'), null, 'the foot is not under the Tafel any more');
  assert.match(text(side.querySelector('.result-foot__again')), /Noch eine Session/, 'tables.oneMore, never „Noch eine Runde"');
  assert.equal(text(q(dom, '.tisch__actions-label')), 'Falls etwas anders lief');
});

test('a tie leaves the choice to the app: every top row offers „Spielen" and the prompt shows', async (t) => {
  const dom = await result(t, {
    finished: false, winnerIds: [], chosenGameId: null,
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 5 }, g3: { rating: 1 } }, m2: { g1: { rating: 4 }, g2: { rating: 4 }, g3: { rating: 2 } } },
  });
  assert.equal(qa(dom, '.tafel-top .trow').length, 2, 'two games share the first place');
  assert.equal(qa(dom, '.tafel-top .play-btn').length, 2);
  assert.equal(q(dom, '.tafel__hint').hidden, false);
});

// ------------------------------------------------------------------ several tables

test('several tables: Forest\'s kicker over the app\'s headline, and only where the results go under it', async (t) => {
  const parent = finished({
    id: 'p1', votes: { m1: { g1: { rating: 5 }, g2: { rating: 2 } } }, gameIds: ['g1', 'g2'],
    multiTable: true, finished: false, chosenGameId: null, winnerIds: [], childSessionIds: ['c1', 'c2'],
  });
  const child = (id, gid, ids) => finished({
    id, gameIds: [gid], memberIds: ids, votes: {}, votedIds: [], chosenGameId: gid, parentSessionId: 'p1', winnerIds: [ids[0]],
  });
  const round = roundFixture([parent, child('c1', 'g1', ['m1']), child('c2', 'g2', ['m2', 'm3'])]);
  const dom = boot(t, 'forest', round);
  dom.set('roundCan', () => false);
  await dom.call('showTableBuilder', round, parent);
  await flush();
  const head = q(dom, '.page-head--tables');
  assert.ok(head.classList.contains('page-head--forest-tables'));
  assert.equal(text(head.querySelector('.forest-kicker')), 'Aufgeteilt auf 2 Tische');
  assert.equal(text(head.querySelector('h1')), '2 Tische, eine Session');
  assert.equal(text(head.querySelector('.muted')), 'alle Ergebnisse stehen in derselben Chronik');
  assert.equal(qa(dom, '.split-tables--composed .split-table').length, 2);
});

// ------------------------------------------------------------------ stylesheet

test('every key on the vote card is 44px — „Zurück", the faces and „Zum Spiel" (T7, U7)', () => {
  const undo = bodyFor('.vote--forest .vote__undo');
  assert.equal(declaredValue(undo, 'height'), 'var(--target-key)');
  assert.equal(declaredValue(undo, 'min-width'), 'var(--target-key)');
  assert.equal(declaredValue(bodyFor('.vote--forest .rating .mood'), 'min-width'), 'var(--target-key)');
  const info = bodyFor('.vote--forest .vote__info');
  assert.equal(declaredValue(info, 'width'), 'var(--target-key)');
  assert.equal(declaredValue(info, 'height'), 'var(--target-key)');
  assert.equal(declaredValue(bodyFor('.setup-grid--forest .stepper__btn'), 'height'), 'var(--target-key)');
});

test('the chosen face takes its own rung of the ramp with the rung\'s fixed ink', () => {
  const inks = { 1: 'low', 2: 'low', 3: 'high', 4: 'high', 5: 'high' };
  for (let n = 1; n <= 5; n++) {
    const body = bodyFor(`.vote--forest .rating .mood.is-selected:nth-child(${n}) .ti`);
    assert.equal(declaredValue(body, 'background'), `var(--score-${n})`);
    assert.equal(declaredValue(body, 'color'), `var(--score-ink-${inks[n]})`);
  }
});

test('the winner row is the gold tint with ink only; the gold is its edge', () => {
  const body = bodyFor('.result-screen--forest .tafel-top .trow');
  assert.equal(declaredValue(body, 'background'), 'var(--gold-soft)');
  assert.equal(declaredValue(body, 'color'), 'var(--ink)');
  assert.match(declaredValue(body, 'border'), /var\(--gold\)/);
});

test('the hidden cards are the dusk, and only there does a firefly shine', () => {
  const strip = bodyFor('.forest-hidden');
  assert.equal(declaredValue(strip, 'background'), 'var(--dusk)');
  assert.equal(declaredValue(strip, 'color'), 'var(--on-dusk)');
  const card = bodyFor('.forest-hidden__card');
  assert.match(declaredValue(card, 'background'), /var\(--firefly\)[\s\S]*var\(--dusk\)/);
  // Anti-vacuous: the section was found and parsed.
  assert.ok(RULES.length > 100, `only ${RULES.length} rules in the #1468 section`);
});

// #1568: where the row is wide it is ONE line — the distribution beside the
// title and a still-choosing row's action inline — from 720px at every width
// above, in both arrangements. The bars stay last in the DOM; only the grid
// area moves.
const wideRules = () => mediaBlocks(SECTION)
  .filter(([mq]) => /^\(min-width:\s*720px\)$/.test(mq.trim()))
  .flatMap(([, css]) => rulesOf(css));
const wideBody = (sel) => {
  // Split the group on its top-level commas only: `:has(a, b)` holds one.
  const members = (group) => group.split(/,(?![^(]*\))/).map((x) => x.trim());
  const hit = wideRules().find(([s]) => members(s).includes(F + sel));
  assert.ok(hit, `forest.css has no ≥720px rule for ${sel}`);
  return hit[1];
};

test('from 720px a Forest row is one line, the distribution between the title and the leaf — settled or choosing', () => {
  for (const sel of ['.result-screen--forest .tafel .trow', '.result-screen--forest .tafel .trow:has(.play-btn, .trow__chip)']) {
    const areas = declaredValue(wideBody(sel), 'grid-template-areas')
      .split('"').filter((x) => x.trim()).map((x) => x.trim().split(/\s+/));
    assert.equal(areas.length, 1, `${sel}: one line`);
    assert.deepEqual(areas[0], ['rank', 'cover', 'main', 'bars', 'pill', 'sub']);
    assert.equal(declaredValue(wideBody(sel), 'grid-template-columns').split(/\s+(?![^(]*\))/).length, 6);
  }
  // Nothing caps the one-line row at the old 1279px edge any more.
  assert.ok(!mediaBlocks(SECTION).some(([mq, css]) => /max-width:\s*1279px/.test(mq)
    && rulesOf(css).some(([s]) => s.includes('.trow'))), 'a row rule still stops at 1279px');
});

test('from 720px „Gehört …" sits beside the title; the veto pill keeps a line under both', () => {
  const main = wideBody('.result-screen--forest .tafel .trow .trow__main');
  assert.equal(declaredValue(main, 'display'), 'grid');
  assert.equal(declaredValue(main, 'grid-template-columns'), 'minmax(0, max-content) minmax(0, 1fr)');
  assert.equal(declaredValue(wideBody('.result-screen--forest .tafel .trow .trow__main > :not(.trow__title):not(.trow__owners)'), 'grid-column'), '1 / -1');
});

test('the side column is pinned only where it fits the viewport: sticky behind a min-height gate, never without', () => {
  const sel = F + '.result-screen--forest .forest-result__side';
  const blocks = mediaBlocks(SECTION);
  const gated = blocks.filter(([mq]) => /min-width:\s*1280px/.test(mq) && /min-height:\s*\d+px/.test(mq));
  assert.ok(gated.some(([, css]) => rulesOf(css).some(([s, b]) => s === sel && /position:\s*sticky/.test(b))),
    'no height-gated sticky rule for the side column');
  for (const [mq, css] of blocks) {
    if (/min-height/.test(mq)) continue;
    assert.ok(!rulesOf(css).some(([s, b]) => s === sel && /position:\s*sticky/.test(b)), `ungated sticky in @media ${mq}`);
  }
  assert.ok(!RULES.some(([s, b]) => s === sel && /position:\s*sticky/.test(b) && !gated.some(([, css]) => css.includes(b))),
    'no top-level sticky on the side column');
});
