'use strict';

/* The session result laid out by PHASE (#1846): one composition for all six
   designs (public/js/result-compose.js), one phase class on `.result-screen`,
   and — after a played session — one list of parties instead of four blocks
   naming the same people.

   The DOM half runs the real showResults through the jsdom harness
   (.claude/rules/testing-views-under-jsdom.md); the columns themselves are CSS,
   which jsdom cannot apply, so the second half reads the stylesheets
   (comments stripped, .claude/rules/css-text-assertions-strip-comments.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, flush } = require('./support/dom');
const { rulesOf, atBlocks, mediaBlocks } = require('./support/css');
const { resultPhaseOf, RESULT_PHASES, RESULT_ASIDE_END } = require('../public/js/result-phase');

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (rel) => strip(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const STYLES = read('public/styles.css');
const DESIGN_SHEETS = fs.readdirSync(path.join(__dirname, '..', 'public/css/designs'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => [f, read(`public/css/designs/${f}`)]);

/* ------------------------------------------------------------- the phase */

test('the phase follows the evening: deciding → table → picking → played, and solo wins', () => {
  assert.equal(resultPhaseOf({ chosenId: null }), 'deciding');
  assert.equal(resultPhaseOf({ chosenId: 'g1', cancelled: true }), 'deciding', 'a cancelled session has no evening column');
  assert.equal(resultPhaseOf({ chosenId: 'g1', finished: false }), 'table');
  assert.equal(resultPhaseOf({ chosenId: 'g1', finished: true, pickerOpen: true }), 'picking');
  assert.equal(resultPhaseOf({ chosenId: 'g1', finished: true, pickerOpen: false }), 'played');
  assert.equal(resultPhaseOf({ chosenId: 'g1', finished: true, solo: true }), 'solo');
  assert.deepEqual(RESULT_PHASES, ['deciding', 'table', 'picking', 'played', 'solo']);
  assert.deepEqual(RESULT_ASIDE_END, ['tisch', 'bruecke', 'programmheft']);
});

/* ------------------------------------------------------------- the screen */

const MEMBERS = [{ id: 'm1', name: 'Anna', userId: 'u-me' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
const GAMES = [
  { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
  { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
  { id: 'g3', title: 'Dixit', minPlayers: 1, maxPlayers: 8 },
];
function fixture(over = {}, roundOver = {}) {
  const session = {
    id: 's1', createdAt: '2026-11-14T18:00:00.000Z', gameIds: ['g1', 'g2', 'g3'], memberIds: ['m1', 'm2', 'm3'],
    votes: {
      m1: { g1: { rating: 5 }, g2: { rating: 3 }, g3: { rating: 1 } },
      m2: { g1: { rating: 4 }, g2: { rating: 4 }, g3: { rating: 2 } },
      m3: { g1: { rating: 5 }, g2: { rating: 2 }, g3: { rating: 3 } },
    },
    votedIds: ['m1', 'm2', 'm3'], done: true, cancelled: false, finished: false,
    winnerIds: [], chosenGameId: null, events: [],
    ...over,
  };
  const round = {
    id: 'r1', name: 'Freitagsrunde', background: null, tags: [],
    members: MEMBERS.map((m) => ({ ...m })), games: GAMES.map((g) => ({ ...g })), sessions: [session],
    ...roundOver,
  };
  return { round, session };
}

async function show(t, over, { design = null, roundOver } = {}) {
  const { round, session } = fixture(over, roundOver);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'u-me');
  dom.set('toast', () => {});
  dom.set('canShareResult', () => true);
  if (design) dom.call('applyDesign', design);
  const sent = [];
  dom.set('api', async (method, url, body) => {
    sent.push({ method, url, body: body && JSON.parse(JSON.stringify(body)) });
    if (/\/finish$/.test(url)) return { winnerIds: body.winnerIds || [], ending: body.ending || null, finishedAt: '2026-11-14T21:00:00.000Z' };
    return round;
  });
  await dom.call('showResults', round, session);
  return { dom, sent, screen: dom.app.querySelector('.result-screen') };
}
const phases = (screen) => [...screen.classList].filter((c) => /^result-screen--(deciding|table|picking|played|solo)$/.test(c));
const button = (dom, rx) => [...dom.app.querySelectorAll('button')].find((b) => rx.test(b.textContent));

test('while deciding: one phase class, the foot in the head row, and no evening column to stand beside the ranking', async (t) => {
  const { dom, screen } = await show(t);
  assert.deepEqual(phases(screen), ['result-screen--deciding']);
  assert.ok(screen.querySelector('.page-head--result > .result-foot'), '„Teilen · Mehr" join the head row');
  assert.equal(screen.querySelector('.result-aside .result-foot'), null);
  assert.ok(screen.querySelector('.result-main > .tafel'));
  // Only the top row's „Spielen" is the filled primary.
  const plays = [...dom.app.querySelectorAll('.play-btn')];
  assert.equal(plays.length, 3);
  assert.deepEqual(plays.map((b) => b.classList.contains('btn--primary')), [true, false, false]);
});

test('the phase class follows every change: choose → table, played → picking, „Fertig" → played', async (t) => {
  const { dom, screen } = await show(t);
  dom.app.querySelector('.play-btn').click();
  await flush();
  assert.deepEqual(phases(screen), ['result-screen--table']);
  assert.ok(screen.querySelector('.result-aside > .result-foot'), 'the foot moved into the evening column');
  assert.equal(screen.querySelector('.page-head--result > .result-foot'), null);
  button(dom, /Als gespielt markieren/).click();
  await flush();
  assert.deepEqual(phases(screen), ['result-screen--picking']);
  button(dom, /^Fertig$/).click();
  assert.deepEqual(phases(screen), ['result-screen--played']);
});

// Defect 9 — test first: it reproduced before the fix (the band re-rendered,
// the rows did not, so every row kept its „Spielen" until a reload).
test('after „Als gespielt markieren" no row keeps its „Spielen" or the „auf dem Tisch" chip', async (t) => {
  const { dom } = await show(t, { chosenGameId: 'g1' });
  assert.ok(dom.app.querySelector('.trow__chip'), 'the chosen row carries the chip');
  assert.ok(dom.app.querySelectorAll('.play-btn').length > 0, 'the others offer „Spielen"');
  button(dom, /Als gespielt markieren/).click();
  await flush();
  assert.equal(dom.app.querySelectorAll('.play-btn').length, 0);
  assert.equal(dom.app.querySelector('.trow__chip'), null);
});

test('while the winner picker is open the foot offers no „Noch eine Session" — „Fertig" is the action', async (t) => {
  const { dom } = await show(t, { chosenGameId: 'g1' });
  button(dom, /Als gespielt markieren/).click();
  await flush();
  assert.equal(dom.app.querySelector('.result-foot__again'), null);
  assert.ok(dom.app.querySelector('.result-foot__more'), '„Mehr" stays');
  button(dom, /^Fertig$/).click();
  assert.ok(dom.app.querySelector('.result-foot__again'), 'it comes back with the record');
});

test('„Wer fängt an?" is folded until the first press on the results screen', async (t) => {
  const { dom } = await show(t, { chosenGameId: 'g1' });
  const sp = dom.app.querySelector('.result-aside .start-player');
  assert.equal(sp.hidden, false, 'offered while the game is on the table');
  assert.ok(sp.classList.contains('is-folded'));
  dom.run('window.matchMedia = () => ({ matches: true })');
  sp.querySelector('.start-player__go').click();
  assert.ok(!sp.classList.contains('is-folded'), 'the ring opens with the draw');
  assert.ok(sp.querySelector('.start-player__answer').textContent.length > 0);
});

test('solo direct play is its own phase, with no ranking', async (t) => {
  const { screen } = await show(t, { gameIds: ['g1'], votes: {}, votedIds: [], chosenGameId: 'g1' });
  assert.deepEqual(phases(screen), ['result-screen--solo']);
  assert.equal(screen.querySelector('.tafel').hidden, true);
});

for (const design of [null, 'tisch', 'ocean', 'bruecke', 'programmheft', 'forest']) {
  test(`${design || 'klassisch'}: head, then the evening column, then the ranking — the phone order`, async (t) => {
    const { screen } = await show(t, { chosenGameId: 'g1', finished: true, winnerIds: ['m2'] }, { design });
    const cols = screen.querySelector(':scope > .result-cols');
    assert.ok(cols, 'one column wrapper');
    assert.equal(screen.lastElementChild, cols);
    const [aside, main] = cols.children;
    assert.ok(aside.classList.contains('result-aside') && main.classList.contains('result-main'));
    assert.ok(aside.querySelector('.tisch-slot') && aside.querySelector('.result-foot') && aside.querySelector('.result-party-slot'));
    assert.ok(main.querySelector(':scope > .tafel'));
    assert.equal(main.querySelector('.tisch, .result-foot'), null, 'nothing of the evening under the ranking');
    assert.equal(screen.classList.contains('result-screen--aside-end'), RESULT_ASIDE_END.includes(design));
  });
}

/* --------------------------------------------- C: one list per party */

test('after a played session each party is listed ONCE: crown, points, record mark, a „Wie war\'s?" seat per person', async (t) => {
  const { dom, screen } = await show(t, {
    chosenGameId: 'g1', finished: true, winnerIds: ['m2'],
    scores: { m1: 30, m2: 52, m3: 41 },
  });
  const rows = [...screen.querySelectorAll('.result-party')];
  assert.deepEqual(rows.map((r) => r.querySelector('.result-party__name').textContent.trim().split(' ')[0]),
    ['Ben', 'Clara', 'Anna'], 'ordered by points, best first');
  assert.ok(rows[0].classList.contains('is-winner') && rows[0].querySelector('.result-party__crown'));
  assert.deepEqual(rows.map((r) => r.querySelector('.result-points__value').textContent), ['52', '41', '30']);
  assert.deepEqual(rows.map((r) => r.querySelectorAll('.verdict__seat').length), [1, 1, 1]);
  // Nobody is named a second time.
  assert.equal(screen.querySelector('.result-people').hidden, true, '„Wer dabei war" stands down');
  assert.equal(screen.querySelector('.tisch__seats'), null, 'no winner seats on the band');
  assert.equal(screen.querySelector('.result-points'), null, 'no separate points block');
  assert.equal(screen.querySelectorAll('.verdict').length, 1);
  // The verdict still behaves as in #1838: a tap opens the faces, a face saves.
  rows[2].querySelector('.verdict__seat').click();
  const faces = [...screen.querySelectorAll('.verdict__ask .mood')];
  assert.equal(faces.length, 5);
  faces[3].click();
  await flush();
  assert.equal(screen.querySelector('.verdict__ask').hidden, true);
  assert.equal(dom.window.document.activeElement.dataset.verdictSeat, 'm1', 'focus returns to the seat answered');
});

test('without points the list is in seat order with the viewer\'s own party first; a team is one row, a guest rates too', async (t) => {
  const { screen } = await show(t, {
    chosenGameId: 'g1', finished: true, winnerIds: ['m2', 'm3'],
    guests: [{ id: 'x1', name: 'Dana' }],
    teams: [{ id: 't1', personIds: ['m2', 'm3'] }],
  });
  const rows = [...screen.querySelectorAll('.result-party:not(.result-party--automa)')];
  assert.equal(rows.length, 3, 'Anna, the team, the guest');
  assert.match(rows[0].textContent, /Anna/, 'the viewer\'s own party first');
  const team = rows.find((r) => r.classList.contains('is-winner'));
  assert.ok(team && !team.classList.contains('result-party--solo'));
  assert.deepEqual([...team.querySelectorAll('.verdict__name')].map((n) => n.textContent), ['Ben', 'Clara']);
  const guest = rows.find((r) => /Dana/.test(r.textContent));
  assert.equal(guest.querySelectorAll('.verdict__seat').length, 1, 'a guest has a „Wie war\'s?" seat');
});

test('the automa closes the list with its points and no seat', async (t) => {
  const { screen } = await show(t, {
    chosenGameId: 'g1', finished: true, scores: { m1: 40, m2: 55, m3: 20 }, automa: { name: 'Bot', points: 70 },
  });
  const rows = [...screen.querySelectorAll('.result-party')];
  const last = rows[rows.length - 1];
  assert.ok(last.classList.contains('result-party--automa'));
  assert.equal(last.querySelector('.result-points__value').textContent, '70');
  assert.equal(last.querySelector('.verdict__seat'), null);
});

test('a cancelled or unplayed session keeps „Wer dabei war" and has no party list', async (t) => {
  for (const over of [{ cancelled: true }, { chosenGameId: 'g1' }]) {
    const { screen } = await show(t, over);
    assert.equal(screen.querySelector('.result-people').hidden, false);
    assert.equal(screen.querySelector('.result-party-slot').hidden, true);
    assert.equal(screen.querySelector('.result-party'), null);
  }
});

/* --------------------------------------------- the stylesheets */

const containerRules = (css, query) => atBlocks(css, 'container')
  .filter(([q]) => q.replace(/\s+/g, ' ') === query)
  .flatMap(([, body]) => rulesOf(body));

test('two columns open at a 900px PANE, only once a game is chosen, never by viewport', () => {
  const two = containerRules(STYLES, 'result-screen (min-width: 900px)')
    .find(([s]) => /^\.result-screen:is\(\.result-screen--table, \.result-screen--picking, \.result-screen--played\) > \.result-cols$/.test(s.trim()));
  assert.ok(two, 'no container rule opening the two columns');
  assert.match(two[1], /display:\s*grid/);
  assert.match(two[1], /grid-template-columns:\s*340px minmax\(0, 1fr\)/);
  assert.doesNotMatch(two[0], /deciding|solo/, 'deciding and solo stay one column');
  // No viewport media query lays out the result columns any more — in
  // styles.css or any design sheet (.claude/rules/styles-css-guards-are-blind-to-design-sheets.md).
  for (const [name, css] of [['styles.css', STYLES], ...DESIGN_SHEETS]) {
    for (const [, body] of mediaBlocks(css)) {
      for (const [sel, decl] of rulesOf(body)) {
        for (const one of sel.split(/,(?![^(]*\))/)) {
          // The SUBJECT — the last compound — is the screen or its column wrapper.
          const subject = one.trim().split(/\s*>\s*|\s+(?![^(]*\))/).pop();
          if (/^\.result-(screen|cols)(?![\w])/.test(subject) && /display:\s*grid|grid-template-columns/.test(decl)) {
            assert.fail(`${name}: "${one.trim()}" lays out the result columns by viewport`);
          }
        }
      }
    }
  }
});

test('the evening column pins in table and picking only, behind a height gate', () => {
  const gated = atBlocks(STYLES, 'media').filter(([q]) => /min-height:\s*\d+px/.test(q));
  const sticky = gated.flatMap(([, body]) => containerRules(body, 'result-screen (min-width: 900px)'))
    .find(([, b]) => /position:\s*sticky/.test(b));
  assert.ok(sticky, 'no height-gated sticky rule for the evening column');
  assert.match(sticky[0], /result-screen--table/);
  assert.match(sticky[0], /result-screen--picking/);
  assert.doesNotMatch(sticky[0], /played/, 'with eight people the played column is taller than a 13"');
  assert.ok(!rulesOf(STYLES).some(([s, b]) => /\.result-aside\s*$/.test(s) && /position:\s*sticky/.test(b)
    && !gated.some(([, body]) => body.includes(b))), 'no ungated sticky');
});

test('Klassisch\'s one-line row is chosen by the Tafel\'s width; only the landing keeps the viewport rule', () => {
  const wide = containerRules(STYLES, 'tafel (min-width: 720px)').find(([s]) => s.trim() === '.result-main .tafel .trow');
  assert.ok(wide);
  assert.match(wide[1], /grid-template-areas:\s*"rank cover main bars score action"/);
  const phone = containerRules(STYLES, 'tafel (max-width: 519px)').find(([s]) => s.trim() === '.result-main .tafel .trow');
  assert.ok(phone, 'no compact phone row');
  assert.match(phone[1], /grid-template-columns:\s*20px 36px minmax\(0, 1fr\) auto auto/);
  assert.match(phone[1], /"bars bars\s+bars action action"/, 'the action shares tracks 4–5 under the score');
  const viewport = mediaBlocks(STYLES).filter(([q]) => /min-width:\s*1280px/.test(q))
    .flatMap(([, b]) => rulesOf(b)).filter(([, b]) => /rank cover main bars score action/.test(b));
  assert.ok(viewport.length && viewport.every(([s]) => /\.landing-moments/.test(s)),
    'a viewport rule still lays out the result\'s rows');
  assert.match(STYLES, /\.result-main\s*\{\s*container:\s*tafel \/ inline-size;/);
});

test('„Als gespielt markieren" and „Fertig" keep their fill: the corrections-list styling applies to the settled record only', () => {
  for (const [name, css] of DESIGN_SHEETS) {
    for (const [sel, body] of rulesOf(css)) {
      for (const one of sel.split(/,(?![^(]*\))/)) {
        if (!/\.tisch__actions(?![\w-])/.test(one)) continue;
        if (!/background:\s*none|border:\s*(0|none)/.test(body)) continue;
        assert.match(one, /\.tisch\[data-state="done"\]/, `${name}: "${one.trim()}" strips the action's fill outside the record`);
      }
    }
  }
});

test('≥ 8px between the picker\'s two chip rows, and no design sheet takes it back', () => {
  const gap = rulesOf(STYLES).find(([s]) => s.trim() === '.winner-chips + .winner-chips');
  assert.ok(gap);
  assert.ok(parseInt(/margin-top:\s*(\d+)px/.exec(gap[1])[1], 10) >= 8);
  for (const [name, css] of DESIGN_SHEETS) {
    assert.ok(!rulesOf(css).some(([s, b]) => /\.winner-chips\s*\+\s*\.winner-chips/.test(s) && /margin-top:\s*0/.test(b)), name);
  }
});

test('„Wer fängt an?" folds only on the results screen, so the „Jetzt spielen" sheet keeps its ring', () => {
  const fold = rulesOf(STYLES).filter(([s]) => /\.is-folded/.test(s));
  assert.ok(fold.length);
  fold.forEach(([s]) => assert.match(s, /^\s*\.result-screen /, `"${s.trim()}" reaches the sheet too`));
});
