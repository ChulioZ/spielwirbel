'use strict';

/* Die Tafel (#1056): the session result screen's ranked rows, carrying the
 * celebration themselves.
 *
 * It replaces the winner spotlight (#897/#940) — a 900px gold hero around 272px
 * of winner covers, sitting above rows that stated the same ranking again. The
 * hero conflated two different facts: what the VOTE said (a top place, possibly
 * shared) and what was PLAYED (one game, someone won). A tie showed several
 * covers over one pair of winners with nothing linking them, and a group free to
 * play a third game made the hero contradict the record.
 *
 * `.spotlight` itself survives — the split-tables screen opens with one per
 * table (test/split-results-spotlight.test.js) — so what is asserted here is
 * that this screen no longer builds one, and that the row took over its job.
 *
 * Two layers, because neither can see the other's failure:
 *
 *  - the CSS contract, parsed out of styles.css — jsdom applies no external
 *    stylesheet, so a layout claim is only assertable as text
 *    (`.claude/rules/testing-views-under-jsdom.md`);
 *  - the CALL SITE under jsdom.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { bodyOf, bodyOfIn, mediaBlocks, rulesOf, outranks, RULES } = require('./support/css');
const { MEMBER_COLORS } = require('../public/js/member-colors');
const { WORLDS } = require('../public/js/round-designs');

// -------------------------------------------------------- the CSS contract

/* `.trow` is declared three times — the phone re-track comes FIRST in the sheet,
   then the base rule, then the one-line override — so `bodyOf('.trow')` answers
   about the phone block and every assertion below would be about the wrong rule.
   Pick by the declaration under test, the way test/phone-width-overflow.test.js
   does for the same reason. */
const rowRule = (prop) => RULES
  .filter(([sel]) => sel === '.trow')
  .map(([, body]) => body)
  .find((body) => new RegExp(`(?:^|[\\s;{])${prop}:`).test(body));

test('the row IS its own score bar — a fill whose width is the score', () => {
  const row = rowRule('position');
  assert.ok(row, '.trow rule is gone');
  assert.match(row, /position:\s*relative/, 'the fill is absolutely placed inside the row');
  assert.match(row, /overflow:\s*hidden/, 'so a 100% fill cannot bleed past the rounded corner');
  assert.match(row, /isolation:\s*isolate/, 'z-index: -1 must not sink the fill under the page');

  const fill = bodyOf('.trow::before');
  assert.ok(fill, 'the score fill is gone');
  assert.match(fill, /width:\s*var\(--pct/, 'the fill takes its width from the score, not from a literal');
  assert.match(fill, /z-index:\s*-1/, 'text reads over the fill, never under it');
  // The mix happens in CSS from a raw accent handed over inline — the `.stamp`
  // mechanism (#1040). An inline `background` would beat every rule a design or
  // a world could write.
  assert.match(fill, /color-mix\(in oklab, var\(--fill-tint\) var\(--fill-a\)/,
    'the tint must be mixed here, from the accent the view hands over');
});

test('the gold group tints harder than an ordinary row, and both alphas are declared', () => {
  const base = rowRule('--fill-a');
  const top = bodyOf('.tafel-top .trow');
  const pct = (body) => Number(/--fill-a:\s*(\d+)%/.exec(body)[1]);
  assert.ok(/--fill-a:/.test(base), 'the ordinary row declares no fill alpha');
  assert.ok(/--fill-a:/.test(top), 'the gold group declares no fill alpha of its own');
  assert.ok(pct(top) > pct(base),
    `the winner's fill (${pct(top)}%) must read stronger than an ordinary row's (${pct(base)}%)`);
  assert.match(top, /--fill-tint:\s*var\(--gold\)/, 'inside the group the fill is gold, not the score colour');
});

/* BOTH responsive overrides must OUT-RANK the base `.trow` rule, not merely
   exist. The phone block sits ~2600 lines above the base rule, so a bare
   `.trow` there ties at (0,1,0) and loses on source order — measured in WebKit
   at 390px, which reported the four-track desktop layout while
   `position: absolute` from the same block did take effect (nothing else
   declares position on the rank). A spec that reads the DECLARED rule cannot
   see that, which is why the rank comparison below is the load-bearing half. */
test('the row is ONE LINE from the rail breakpoint, and two tracks on a phone', () => {
  const pick = (query) => mediaBlocks()
    .filter(([q]) => query.test(q))
    .flatMap(([, css]) => rulesOf(css))
    .find(([sel, body]) => /\.trow$/.test(sel.trim()) && /grid-template-columns:/.test(body));

  const wide = pick(/min-width:\s*1280px/);
  assert.ok(wide, 'the row never becomes a one-line layout');
  const areas = /grid-template-areas:\s*([^;]+);/.exec(wide[1])[1];
  const first = areas.split('"').filter((s) => s.trim())[0].trim().split(/\s+/);
  assert.deepEqual(first, ['rank', 'cover', 'main', 'bars', 'score', 'action'],
    'at the rail breakpoint every column sits on one line');
  assert.ok(outranks(wide[0], '.trow'),
    `"${wide[0]}" only ties the base .trow rule, so the one-line layout rides on source order`);

  const phone = pick(/max-width:\s*520px/);
  assert.ok(phone, 'the <=520px block no longer re-tracks the row');
  assert.equal(
    /grid-template-columns:\s*([^;]+);/.exec(phone[1])[1].trim().split(/\s+(?![^(]*\))/).length, 2,
    'the row keeps more than two tracks at phone widths, which cannot fit (#621)');
  assert.ok(outranks(phone[0], '.trow'),
    `"${phone[0]}" ties the base .trow rule and loses on source order — WebKit rendered four tracks at 390px`);
});

test('nothing on this screen is a disabled control any more', () => {
  /* The complaint this answers: every row of every finished session rendered a
     `disabled` „Spielen" at 0.45 opacity (245px over five rows) plus a
     permanent trash link (168px) — spent instrument on a record. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views-session.js'), 'utf8');
  const results = src.slice(src.indexOf('async function showResults'));
  assert.doesNotMatch(results.slice(0, results.indexOf('\n}\n')), /\.disabled\s*=/,
    'showResults disables a control instead of not rendering it');
  for (const dead of ['.trow__remove', '.spotlight--shared .spotlight__winner']) {
    assert.equal(bodyOf(dead), null, `${dead} is styling something no caller emits`);
  }
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

test('the race and the gold tint are both inside the reduced-motion guard', () => {
  const guarded = mediaBlocks()
    .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .flatMap(([, css]) => rulesOf(css));
  const sels = guarded.map(([sel]) => sel);
  assert.ok(sels.some((sel) => sel === '.trow.is-race::before'), 'the fill race must be motion-gated');
  assert.ok(sels.some((sel) => sel === '.tafel-top.is-reveal'), 'and so must the gold tint');
  assert.ok(sels.some((sel) => /\.confetti__bit/.test(sel)), 'and so must the confetti');

  const race = guarded.find(([sel]) => sel === '.trow.is-race::before')[1];
  assert.match(race, /animation:\s*trow-fill var\(--dur/,
    'the race must take its duration from the per-row property, or every row lands together');
  // The REST state carries no animation, so a cold load, the Chronik and a
  // shared link show the finished picture.
  assert.doesNotMatch(bodyOf('.trow::before'), /animation/, 'the resting fill must not animate');
});

// --------------------------------------------------------- the call site

const RID = 'r1';

const session = (id, ratings, over = {}) => ({
  id,
  createdAt: '2026-07-01T20:00:00.000Z',
  gameIds: Object.keys(ratings),
  memberIds: ['m1'],
  votes: { m1: Object.fromEntries(Object.entries(ratings).map(([g, r]) => [g, { rating: r }])) },
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

const show = async (t, s, reveal = false) => {
  const r = round({ sessions: [s] });
  const dom = bootApp(t, r);
  await dom.call('showResults', r, s, r.games, reveal);
  return dom;
};

const rows = (dom) => [...dom.app.querySelectorAll('.trow')];

test('the winner sits in the gold group, and no spotlight is built here at all', async (t) => {
  const dom = await show(t, session('s1', { g1: 5, g2: 4, g3: 3, g4: 3 }));

  assert.equal(dom.app.querySelector('.spotlight'), null,
    'this screen must not build a spotlight — the split-tables screen keeps that component');
  const top = dom.app.querySelector('.tafel-top');
  assert.ok(top, 'the winner must be in a group of its own');
  assert.equal(top.querySelectorAll('.trow').length, 1, 'one game took first place');
  assert.ok(top.querySelector('.ti-crown'), 'the winner is crowned');
  assert.match(top.querySelector('.tafel-top__kicker').textContent, /Sieger der Abstimmung/);
  assert.equal(rows(dom).length, 4, 'and every game is still ranked');
});

test('a tie for first puts every tied row in ONE group, under one kicker', async (t) => {
  const dom = await show(t, session('s2', { g1: 4, g2: 4, g3: 4, g4: 2 }));

  const top = dom.app.querySelector('.tafel-top');
  assert.equal(top.querySelectorAll('.tafel-top__kicker').length, 1,
    'a tie must not multiply the celebration — it adds a row');
  assert.match(top.querySelector('.tafel-top__kicker').textContent, /Geteilter Sieg/);
  assert.deepEqual([...top.querySelectorAll('.trow__title')].map((e) => e.textContent.trim()),
    ['Catan', 'Azul', 'Splendor'], 'nothing is capped, and each tied game keeps its own row');
  assert.ok([...top.querySelectorAll('.trow__title')].every((e) => e.classList.contains('game-link')),
    'each tied game must stay reachable by its own link');
});

test('the rank rail prints the tie-aware places, and no medal', async (t) => {
  const dom = await show(t, session('s3', { g1: 4, g2: 4, g3: 3, g4: 1 }));
  assert.deepEqual(rows(dom).map((r) => r.querySelector('.trow__rank').textContent.trim()),
    ['1', '1', '3', '4'], 'the places must be tie-aware („1, 1, 3, 4")');
  assert.equal(dom.app.querySelector('.rank-medal'), null,
    'a column of three gold medals reads as a rendering fault; a numeral states a shared place');
});

test('only the top place reaches the gold group', async (t) => {
  const dom = await show(t, session('s4', { g1: 5, g2: 4, g3: 4, g4: 1 }));
  const top = dom.app.querySelector('.tafel-top');
  assert.deepEqual([...top.querySelectorAll('.trow__title')].map((e) => e.textContent.trim()), ['Catan']);
});

test('a cancelled, a single-game and an unvoted session get no group', async (t) => {
  const cancelled = await show(t, session('s5', { g1: 5, g2: 3 }, { cancelled: true, chosenGameId: null }));
  assert.equal(cancelled.app.querySelector('.tafel-top'), null, 'nothing was played');

  const solo = await show(t, session('s6', { g1: 5 }));
  assert.equal(solo.app.querySelector('.tafel-top'), null, 'there is nothing to have won');
});

test('every voted row carries its score as a percentage of the scale', async (t) => {
  const dom = await show(t, session('s7', { g1: 5, g2: 4, g3: 3, g4: 1 }));
  const pcts = rows(dom).map((r) => r.style.getPropertyValue('--pct'));
  assert.ok(pcts.every((p) => /^\d+(\.\d+)?%$/.test(p)), `every row needs a --pct, got ${pcts.join(' ')}`);
  // Strictly descending, because the rows are sorted by the same number.
  const nums = pcts.map((p) => parseFloat(p));
  assert.deepEqual(nums, [...nums].sort((a, b) => b - a), 'the fills must fall with the ranking');
  assert.ok(nums[0] > nums[nums.length - 1], 'a 5 and a 1 must not fill the same width');
  assert.ok(rows(dom).every((r) => r.style.getPropertyValue('--sc')),
    'each voted row hands its accent over as --sc, for the CSS mix');
});

test('a row nobody voted on is bare — no fill, no accent, no label', async (t) => {
  const s = session('s8', { g1: 5, g2: 4 });
  s.gameIds = ['g1', 'g2', 'g3'];            // g3 added after the vote
  const dom = await show(t, s);
  const bare = rows(dom).find((r) => r.querySelector('.trow__title').textContent.trim() === 'Splendor');
  assert.ok(bare, 'the unvoted game is still listed');
  assert.equal(parseFloat(bare.style.getPropertyValue('--pct') || '0'), 0, 'nothing to fill');
  assert.equal(bare.style.getPropertyValue('--sc'), '', 'and no accent to fill it with');
  assert.equal(bare.querySelector('.score-label'), null, 'there is no score there to name');
});

test('a finished session renders no play button and no bare remove link — only the „…" menu', async (t) => {
  const dom = await show(t, session('s9', { g1: 5, g2: 3 }));
  assert.equal(dom.app.querySelector('.play-btn'), null, 'the choice is settled; a disabled button is spent instrument');
  assert.equal(dom.app.querySelector('.trow__remove'), null, 'the trash link moved into the menu');
  assert.equal(dom.app.querySelectorAll('.trow__menu').length, 2, 'every row keeps a „…" menu');

  const menu = dom.app.querySelector('.trow__menu');
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  menu.click();
  const opts = [...dom.document.querySelectorAll('.popover .popover__opt')].map((b) => b.textContent.trim());
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(opts, ['Zum Spiel', 'Aus Session entfernen']);
});

test('a live session with a chosen game states it on that row and offers „Spielen" on the others', async (t) => {
  const dom = await show(t, session('s10', { g1: 5, g2: 3, g3: 2 },
    { finished: false, winnerIds: [], chosenGameId: 'g2' }));

  const byTitle = Object.fromEntries(rows(dom).map((r) => [r.querySelector('.trow__title').textContent.trim(), r]));
  assert.ok(byTitle.Azul.classList.contains('is-chosen'));
  assert.match(byTitle.Azul.querySelector('.trow__chip').textContent, /auf dem Tisch/);
  assert.equal(byTitle.Azul.querySelector('.play-btn'), null, 'the chosen row offers no second „Spielen"');
  assert.ok(byTitle.Catan.querySelector('.play-btn'), 'the others keep the button');
  assert.equal(byTitle.Catan.querySelector('.trow__chip'), null);
  // Un-choosing was the second tap on the old button; it is a menu entry now.
  byTitle.Azul.querySelector('.trow__menu').click();
  assert.ok([...dom.document.querySelectorAll('.popover .popover__opt')]
    .some((b) => /Auswahl aufheben/.test(b.textContent)), 'the chosen row can still change its mind');
});

test('the prompt shows only while nothing is chosen', async (t) => {
  const open = await show(t, session('s11', { g1: 5, g2: 3 },
    { finished: false, winnerIds: [], chosenGameId: null }));
  assert.equal(open.app.querySelector('.tafel__hint').hidden, false);

  const chosen = await show(t, session('s12', { g1: 5, g2: 3 },
    { finished: false, winnerIds: [], chosenGameId: 'g1' }));
  assert.equal(chosen.app.querySelector('.tafel__hint').hidden, true);

  const done = await show(t, session('s13', { g1: 5, g2: 3 }));
  assert.equal(done.app.querySelector('.tafel__hint').hidden, true);
});

test('the race and the confetti fire on the reveal path only', async (t) => {
  const quiet = await show(t, session('s14', { g1: 5, g2: 3 }));
  assert.equal(quiet.app.querySelector('.confetti'), null);
  assert.ok(!quiet.app.querySelector('.tafel-top').classList.contains('is-reveal'));
  assert.ok(quiet.app.querySelectorAll('.trow.is-race').length === 0, 'a cold load shows the rest state');
  assert.ok(rows(quiet).every((r) => !r.style.getPropertyValue('--dur')), 'and needs no durations');

  const loud = await show(t, session('s15', { g1: 5, g2: 3 }), true);
  assert.ok(loud.app.querySelector('.tafel-top').classList.contains('is-reveal'));
  assert.equal(loud.app.querySelectorAll('.confetti__bit').length, 16,
    'the confetti must hang off the gold group, which is what anchors it');
  const durs = rows(loud).map((r) => parseFloat(r.style.getPropertyValue('--dur')));
  assert.ok(durs.every((d) => d > 0), 'every racing row needs its own duration');
  assert.ok(durs[0] > durs[durs.length - 1],
    `the winner's fill must finish LAST (${durs.join(' vs ')})`);
});

// --------------------------------------------- the world's scene (#940)

/* A world replaces the confetti with its own victory scene. The scene itself is
   CSS — slot 7 under "Worlds" in styles.css, pinned by test/round-worlds.test.js
   — and what is asserted HERE is the JS side of the contract: the generator is
   world-agnostic, its per-bit randomness travels as custom properties a world
   rule can read, and the screen applies the round's design itself. */

test('the confetti colours its bits through a custom property, so a world rule can recolour them', async (t) => {
  const dom = await show(t, session('s16', { g1: 5, g2: 3 }), true);
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
  const s = session('s17', { g1: 5, g2: 3 });
  const r = round({ sessions: [s], background: { type: 'theme', id: forest.id, page: forest.page, accent: forest.accent } });
  const dom = bootApp(t, r);
  const opened = [];
  dom.set('showGameDetail', (rid, gid) => { opened.push([rid, gid]); });
  await dom.call('showResults', r, s, r.games, true);

  assert.equal(dom.document.documentElement.dataset.world, 'forest', 'the results screen must dress the round');
  const top = dom.app.querySelector('.tafel-top');
  assert.ok(top.classList.contains('is-reveal'));
  assert.equal(top.querySelectorAll('.confetti__bit').length, 16, 'the same bits — a world re-shapes them in CSS');
  top.querySelector('.trow__title').click();
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [[RID, 'g1']], 'the winner link must open the game');
});

test('the victory scene hosts BOTH cards, with tighter gutters on the full-width one', () => {
  const host = bodyOfIn('[data-world] .tafel-top');
  assert.ok(host, 'the gold group is not a host for the world victory scene');
  const own = bodyOf('[data-world] .tafel-top');
  assert.ok(own, 'the group needs a reservation of its own — it holds full-width rows, not two small covers');
  const col = /--victory-col:\s*min\(\s*(\d+)%\s*,\s*(\d+)px\s*\)/.exec(own);
  const shared = /--victory-col:\s*min\(\s*(\d+)%\s*,\s*(\d+)px\s*\)/.exec(host);
  assert.ok(col, 'the tighter gutter is not declared as a capped percentage');
  assert.ok(Number(col[1]) < Number(shared[1]),
    `${col[1]}% per side is not tighter than the spotlight's ${shared[1]}%`);
  // At 560px of content the rows must keep >= 400px, or the mini chart goes
  // before the scene has earned its place.
  assert.ok(560 * (1 - 2 * Number(col[1]) / 100) >= 400,
    `at 560px the gutters leave ${(560 * (1 - 2 * Number(col[1]) / 100)).toFixed(0)}px for the rows`);
});
