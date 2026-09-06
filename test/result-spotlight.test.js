'use strict';

/* The session results screen opens with a WINNER SPOTLIGHT (#897).
 *
 * It used to open with the podium stage — and the ranked rows twenty pixels
 * below it already state that ranking, with distribution bars, vote counts and
 * the big score. The tell was what places 2 and 3 had become: a 34px cover, a
 * title and a Ø pill pushed out by `margin-left: auto`, i.e. a list row sitting
 * above a list that does the same job properly. Two visual languages for one
 * fact reads as clutter however well each is drawn, so the stage keeps only its
 * unique job — celebration — and the ranked list keeps the ranking, gold medal
 * included.
 *
 * Two layers, because neither can see the other's failure:
 *
 *  - the CSS contract, parsed out of styles.css — jsdom applies no external
 *    stylesheet, so a layout claim is only assertable as text
 *    (`.claude/rules/testing-views-under-jsdom.md`);
 *  - the CALL SITE under jsdom. This layer moved here out of
 *    test/podium-ranks.test.js, which is now Pokale's alone.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { bodyOf, mediaBlocks, rulesOf, RULES } = require('./support/css');
const { MEMBER_COLORS } = require('../public/js/member-colors');
const { WORLDS } = require('../public/js/round-designs');

const px = (body, prop) => Number(body.match(new RegExp(prop + ':\\s*(\\d+)px'))[1]);

// -------------------------------------------------------- the CSS contract

test('the spotlight anchors the confetti and is not a stage', () => {
  const spot = bodyOf('.spotlight');
  assert.ok(spot, '.spotlight rule is gone');
  assert.match(spot, /position:\s*relative/, 'the confetti overlay is anchored here');
  assert.match(spot, /var\(--gold-edge\)/, 'the winner keeps the gold treatment');
});

test('several winners SCALE DOWN and wrap — no cap, no cropping', () => {
  /* A one-voter session that rates three games alike is ordinary, so this path
     is not exotic. Nothing here encodes rank in height, so a tall spotlight is
     only ever „several games tied". */
  assert.match(bodyOf('.spotlight__winners'), /flex-wrap:\s*wrap/);
  const solo = px(bodyOf('.spotlight__img'), 'width');
  const shared = px(bodyOf('.spotlight--shared .spotlight__img'), 'width');
  assert.ok(shared < solo, `a shared win must shrink its covers (${shared} vs ${solo})`);
});

test('a winner is an ABSOLUTE box, so covers stay uniform and titles do not size it', () => {
  /* A `%` inside a shrink-to-fit column resolves against whichever child is
     widest — the title — which makes covers ragged
     (percent-sizes-under-a-shrink-to-fit-flex-item.md). */
  const winner = bodyOf('.spotlight__winner');
  assert.match(winner, /width:\s*\d+px/, 'a shrink-to-fit winner sizes itself from its title');
  assert.match(winner, /max-width:\s*100%/, 'the only squeeze a narrow screen needs');
  assert.doesNotMatch(winner, /(^|[;\s])width:\s*\d+%/m, 'a % width measures the title, not the box');
  assert.match(bodyOf('.spotlight__img'), /max-width:\s*100%/);
});

test('the stage apparatus is gone from this screen — not merely unused', () => {
  /* Left behind, these keep sizing a `.podium__tier` / `.result-podium__*` no
     caller emits, and the next reader has to work out which layout is live. */
  for (const dead of ['.podium--result', '.result-podium__img', '.result-podium__title', '.result-podium__pill']) {
    assert.equal(bodyOf(dead), null, `${dead} belongs to the retired results stage`);
  }
  assert.deepEqual(
    RULES.map(([sel]) => sel).filter((sel) => /result-podium|podium__tier|podium--result/.test(sel)),
    []
  );
});

test('the reveal is ONE hero rise, inside a reduced-motion guard', () => {
  const rise = bodyOf('.spotlight.is-reveal');
  assert.ok(rise, 'the finale must still rise');
  assert.match(rise, /animation:\s*spotlight-rise/);
  const guarded = mediaBlocks()
    .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .flatMap(([, css]) => rulesOf(css).map(([sel]) => sel));
  assert.ok(guarded.some((sel) => /\.spotlight\.is-reveal/.test(sel)),
    'the rise must stay inside a prefers-reduced-motion guard');
  assert.ok(guarded.some((sel) => /\.confetti__bit/.test(sel)),
    'and so must the confetti');
});

// --------------------------------------------------------- the call site

const RID = 'r1';

const session = (id, ratings, over = {}) => ({
  id,
  createdAt: '2026-07-01T20:00:00.000Z',
  gameIds: Object.keys(ratings),
  memberIds: ['m1'],
  votes: { m1: Object.fromEntries(Object.entries(ratings).map(([g, r]) => [g, { rating: r, retire: false }])) },
  votedIds: ['m1'],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: ['m1'],
  chosenGameId: Object.keys(ratings)[0],
  events: [],
  ...over,
});

const round = (over = {}) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }],
  games: [
    { id: 'g1', title: 'Catan', tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
    { id: 'g3', title: 'Splendor', tagIds: [] },
    { id: 'g4', title: 'Cascadia', tagIds: [] },
  ],
  sessions: [],
  ...over,
});

function bootApp(t, r) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return r;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const show = async (t, s) => {
  const r = round({ sessions: [s] });
  const dom = bootApp(t, r);
  await dom.call('showResults', r, s, r.games, false);
  return dom;
};

test('one winner gets the spotlight, and the ranking is stated ONCE', async (t) => {
  const dom = await show(t, session('s1', { g1: 5, g2: 4, g3: 3, g4: 3 }));

  const spot = dom.app.querySelector('.spotlight');
  assert.ok(spot, 'the results screen must open on the winner');
  assert.equal(spot.querySelectorAll('.spotlight__winner').length, 1);
  assert.equal(spot.querySelector('.spotlight__winner').dataset.gid, 'g1');
  assert.ok(spot.querySelector('.ti-crown'), 'the winner is crowned');
  assert.match(spot.querySelector('.spotlight__kicker').textContent, /Sieger/);
  assert.ok(!spot.classList.contains('spotlight--shared'), 'one winner is not a shared win');

  // The second ranking above the list is the whole defect this removes.
  assert.equal(dom.app.querySelector('.podium'), null, 'no stage above the ranked rows');
  assert.equal(dom.app.querySelectorAll('.result-row').length, 4, 'the ranked list is untouched');
});

test('the ranked list keeps its GOLD medal — it must read on its own', async (t) => {
  /* The list is what remains once the spotlight scrolls off, and a medal
     sequence starting at silver reads as a bug. */
  const dom = await show(t, session('s1', { g1: 5, g2: 4, g3: 3, g4: 3 }));
  assert.equal(dom.app.querySelectorAll('.rank-medal--gold').length, 1);
  assert.equal(dom.app.querySelectorAll('.rank-medal--silver').length, 1);
  assert.equal(dom.app.querySelectorAll('.rank-medal--bronze').length, 2, 'the tie shares bronze');
});

test('several games tied for first stand side by side under „Geteilter Sieg"', async (t) => {
  const dom = await show(t, session('s2', { g1: 4, g2: 4, g3: 4, g4: 2 }));

  const spot = dom.app.querySelector('.spotlight');
  assert.ok(spot.classList.contains('spotlight--shared'));
  assert.match(spot.querySelector('.spotlight__kicker').textContent, /Geteilter Sieg/);

  const winners = [...spot.querySelectorAll('.spotlight__winner')];
  assert.deepEqual(winners.map((e) => e.dataset.gid), ['g1', 'g2', 'g3'], 'nothing is capped');
  assert.ok(winners.every((e) => e.classList.contains('game-link')),
    'a shared win is several links — one per game, or a tied game is unreachable');
  assert.equal(spot.querySelectorAll('.spotlight__pill').length, 3, 'each winner states its own Ø');
});

test('only the top place reaches the spotlight', async (t) => {
  const dom = await show(t, session('s3', { g1: 5, g2: 4, g3: 4, g4: 1 }));
  assert.deepEqual(
    [...dom.app.querySelectorAll('.spotlight__winner')].map((e) => e.dataset.gid),
    ['g1'],
    'second place belongs to the list, which already medals it'
  );
});

test('a cancelled session gets no spotlight — nothing was played', async (t) => {
  const dom = await show(t, session('s4', { g1: 5, g2: 3 }, { cancelled: true, chosenGameId: null }));
  assert.equal(dom.app.querySelector('.spotlight'), null);
});

test('a single-game session gets no spotlight — there is nothing to have won', async (t) => {
  const dom = await show(t, session('s5', { g1: 5 }));
  assert.equal(dom.app.querySelector('.spotlight'), null);
});

test('the reveal drops confetti inside the spotlight, and only when revealing', async (t) => {
  const s = session('s6', { g1: 5, g2: 3 });
  const r = round({ sessions: [s] });

  const quiet = bootApp(t, r);
  await quiet.call('showResults', r, s, r.games, false);
  assert.equal(quiet.app.querySelector('.confetti'), null);
  assert.ok(!quiet.app.querySelector('.spotlight').classList.contains('is-reveal'));

  const loud = bootApp(t, r);
  await loud.call('showResults', r, s, r.games, true);
  const spot = loud.app.querySelector('.spotlight');
  assert.ok(spot.classList.contains('is-reveal'));
  assert.equal(spot.querySelectorAll('.confetti__bit').length, 16,
    'the confetti must hang off the spotlight, which is what anchors it');
});

// --------------------------------------------- the world's scene (#940)

/* A world replaces the confetti with its own victory scene. The scene itself is
   CSS — slot 7 under "Worlds" in styles.css, pinned by test/round-worlds.test.js
   — and what is asserted HERE is the JS side of the contract: the generator is
   world-agnostic, its per-bit randomness travels as custom properties a world
   rule can read, and the screen applies the round's design itself. */

test('the confetti colours its bits through a custom property, so a world rule can recolour them', async (t) => {
  const s = session('s7', { g1: 5, g2: 3 });
  const r = round({ sessions: [s] });
  const dom = bootApp(t, r);
  await dom.call('showResults', r, s, r.games, true);
  const bits = [...dom.app.querySelectorAll('.confetti__bit')];
  assert.equal(bits.length, 16);
  for (const bit of bits) {
    assert.ok(MEMBER_COLORS.includes(bit.style.getPropertyValue('--bit-color')),
      'each bit carries its palette colour as --bit-color');
    assert.equal(bit.style.background, '', 'an inline background would beat the world rule');
    // The drift is set for EVERY bit — a palette simply ignores it — rather than
    // branching on the world, which is the #903 principle: one hook, CSS decides.
    assert.match(bit.style.getPropertyValue('--bit-drift'), /^-?\d+px$/);
  }
});

test('the results screen carries no world name — the scene keys off the one hook, in CSS', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views-session.js'), 'utf8');
  for (const w of WORLDS) assert.doesNotMatch(src, new RegExp(w.id, 'i'), `views-session.js names the ${w.id} world`);
  assert.doesNotMatch(src, /data-world|\bWORLDS\b|\bsetWorld\b/, 'the only world branch is CSS');
  assert.equal([...src.matchAll(/confetti__bit/g)].length, 1, 'one particle generator, re-shaped by CSS — never a second one');
});

test('under a world the winner stays a working link, and the screen applies the round\'s design itself', async (t) => {
  /* Both halves matter for the scene. The link: every ornament is a
     pointer-events: none pseudo-element (round-worlds pins that), so the anchor
     under it must still navigate. The design: showResults used to leave it to
     the hub, so a shared or cold-loaded results URL rendered on the Standard
     design — and the scene's end state, which a later visit is meant to show,
     was simply absent there. */
  const forest = WORLDS.find((w) => w.id === 'forest');
  const s = session('s8', { g1: 5, g2: 3 });
  const r = round({ sessions: [s], background: { type: 'theme', id: forest.id, page: forest.page, accent: forest.accent } });
  const dom = bootApp(t, r);
  const opened = [];
  dom.set('showGameDetail', (rid, gid) => { opened.push([rid, gid]); });
  await dom.call('showResults', r, s, r.games, true);

  assert.equal(dom.document.documentElement.dataset.world, 'forest', 'the results screen must dress the round');
  const spot = dom.app.querySelector('.spotlight');
  assert.ok(spot.classList.contains('is-reveal'));
  assert.equal(spot.querySelectorAll('.confetti__bit').length, 16, 'the same bits — a world re-shapes them in CSS');
  spot.querySelector('.spotlight__winner').click();
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [[RID, 'g1']], 'the winner link must open the game');
});
