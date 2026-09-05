'use strict';

/* The Start tab's card grid (#923) — RENDERED, not matched as source text.

   Everything here drives the real `renderStartTab` in the jsdom harness, which
   is the only way to see the things that actually go wrong in this screen: a
   card that renders empty, a row wired to the wrong link, the #869 stand-in
   reappearing beside content, a preset chip that opens the setup screen with
   nothing applied. Loaded through `vm`, never `require`, so no view file enters
   the coverage report (.claude/rules/testing-views-under-jsdom.md).

   The CSS half at the bottom is parsed out of styles.css: jsdom applies no
   external stylesheet, so `getComputedStyle` there answers about inline styles
   only (.claude/rules/css-text-assertions-strip-comments.md). */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { bodyOf, mediaBlocks, gridSpec, columnsIn } = require('./support/css');

// ---------------------------------------------------------------- fixtures

const game = (id, extra = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, image: 'c.jpg', ...extra,
});
// Far enough back that the derivations' own windows (three months for „lange
// nicht gespielt", 60 days for „lange nicht dran") are comfortably cleared, and
// expressed relative to NOW so the fixture does not rot.
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const play = (id, gid, when, extra = {}) => ({
  id, createdAt: when, done: true, finished: true,
  gameIds: [gid], chosenGameId: gid, winnerIds: [1],
  votes: { 1: { [gid]: { rating: 5 } }, 2: { [gid]: { rating: 5 } } },
  ...extra,
});

/* An established round: eight games, a handful of evenings spread over the last
   year, one game played long ago and several never played. */
const busyRound = (over = {}) => ({
  id: 3,
  name: 'Freitagsrunde',
  members: [{ id: 1, name: 'Anna' }, { id: 2, name: 'Ben' }],
  // Game 15 has no cover: one real loose end, so the Kümmerliste has something
  // to say and the ordering assertion below is not silently testing two cards.
  games: Array.from({ length: 8 }, (_, i) => game(10 + i, i === 5 ? { image: null } : {})),
  sessions: [
    play(900, 10, daysAgo(400)),
    play(901, 11, daysAgo(200)),
    play(902, 11, daysAgo(40)),
    play(903, 12, daysAgo(10)),
  ],
  tags: [],
  ...over,
});

const youngRound = () => ({
  id: 4,
  name: 'Neue Runde',
  members: [{ id: 1, name: 'Anna' }],
  games: [game(10, { image: null }), game(11, { image: null })],
  sessions: [],
  tags: [],
});

// The teaser fetches on every render; a spec that does not care still has to
// answer it, or the harness's loud default fetch rejects into the console.
const noRecos = () => async () => ({ recommendations: [] });

// ---------------------------------------------------------------- the grid

test('a young round meets the screen it always met — no empty cards, no empty headings', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());

  const r = youngRound();
  dom.call('renderStartTab', r, r.games);
  assert.equal(dom.app.querySelectorAll('.hub-card').length, 0, 'a round with nothing to say rendered a card anyway');
  assert.equal(dom.app.querySelectorAll('.hub-card__title').length, 0, 'a heading was rendered over nothing');
  // The grid element itself is present — the teaser needs somewhere connected
  // to land — and `.hub-cards:empty` is what keeps it from costing anything.
  assert.ok(dom.app.querySelector('.hub-cards'), 'the grid must exist for the lazy teaser to reach');
  assert.equal(dom.app.querySelector('.hub-cards').children.length, 0);
  // And #869's stand-in is still doing its job, which the grid must not steal.
  assert.ok(dom.app.querySelector('.empty--rail-gap'), 'the young round lost its rail stand-in');
});

test('an established round gets suggestion, pulse and care cards, in the phone order', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());

  const r = busyRound();
  dom.call('renderStartTab', r, r.games);
  const titles = [...dom.app.querySelectorAll('.hub-card__title')].map((el) => el.textContent.trim());
  assert.equal(titles.length, 3, 'expected exactly the three derivable cards for this fixture');
  assert.deepEqual(
    titles,
    [dom.run("t('hub.suggest.title')"), dom.run("t('hub.pulse.title')"), dom.run("t('hub.care.title')")],
    'DOM order is the phone order, and it is action-first',
  );
  // With content in the pane, the stand-in for the rail gap must be gone.
  assert.equal(dom.app.querySelector('.empty--rail-gap'), null, 'the stand-in rendered beside real content');
});

test('a suggestion row links to that game, and says why it is there', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());

  const r = busyRound();
  dom.call('renderStartTab', r, r.games);
  const rows = [...dom.app.querySelectorAll('.hub-card')][0].querySelectorAll('.hub-row');
  assert.ok(rows.length >= 2, 'the suggestion card is a list, not a single line');
  rows.forEach((row) => {
    assert.match(row.getAttribute('href') || '', /^\/round\/3\/game\/\d+$/, 'a suggestion row does not link to its game');
    assert.ok(row.querySelector('.hub-row__sub').textContent.trim(), 'a suggestion row states no reason');
  });
});

test('the banner and the suggestion card never name the same game', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());

  /* AN INTEGRATION CHECK, NOT THE EXCLUSION'S GUARD — and saying so is the
     point. Deleting the `nagged` set leaves this green, measured, because the
     rows' own `>= neutral` quality floor already rejects anything the banner can
     propose (a nagged game's raw score is at or below 1.0, and shrinkage never
     lifts a score above its prior). The exclusion is pinned where it CAN fail,
     in test/hub-insights.test.js, which explains the coupling in full.

     What this still earns: the two cards are built from one render and one score
     index, and it proves they do not contradict each other on a realistic
     fixture — which no unit test of either half can show.

     THE FIXTURE IS THE WHOLE TEST HERE, and the obvious one does not work.

     Game 17 must be a game the suggestion card WOULD otherwise pick — otherwise
     removing the exclusion changes nothing and this test passes against the
     bug. Measured: a game voted flat 0 by everybody scores -2.4 once shrunk and
     sorts BELOW an unrated game (-1), so it is never suggested with or without
     the guard, and that version of this test stayed green with the exclusion
     deleted on purpose.

     What discriminates is the gap between the two scales the two features read.
     The banner gates on the RAW score (`rawScore <= 1.0`, deliberately — see
     retireRecommendations); the suggestion card ranks on the SHRUNK one, which
     pulls a thin record back toward the prior. Six votes of {1,1,3,3,3,3} sit
     at rawScore 0.33 — nagged — and shrink to 1.4, which beats every unrated
     game on the shelf. So game 17 is simultaneously the banner's top proposal
     and the suggestion card's top pick, which is exactly the collision.

     It is DRAWN but never chosen (`gameIds` without `chosenGameId`), so it also
     qualifies as never played — the state that carries votes without a play. */
  const r = busyRound();
  const badNights = [[1, 1], [3, 3], [3, 3]].map(([a, b], i) =>
    play(950 + i, 10, daysAgo(300 + i), {
      gameIds: [10, 17],
      votes: { 1: { 10: { rating: 5 }, 17: { rating: a } }, 2: { 10: { rating: 5 }, 17: { rating: b } } },
    }));
  r.sessions = [...r.sessions, ...badNights];
  dom.call('renderStartTab', r, r.games);

  const banner = dom.app.querySelector('.rec-banner');
  assert.ok(banner, 'the fixture no longer trips the retirement banner — the exclusion is untested without it');
  const nagged = [...banner.querySelectorAll('.recommend-item__title')].map((el) => el.textContent);
  assert.ok(nagged.includes('Spiel 17'), 'the banner is not nagging about the game this asserts is excluded');

  const suggested = [...dom.app.querySelectorAll('.hub-card .hub-row__title')].map((el) => el.textContent);
  assert.ok(suggested.length, 'nothing was suggested at all, so the exclusion proves nothing');
  assert.ok(!suggested.includes('Spiel 17'), 'the hub recommended the game it is simultaneously proposing to archive');
});

// -------------------------------------------------------------- preset chips

test('no quick-start chip is offered for a shelf that cannot express one', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());

  const r = busyRound(); // no BGG metadata on any game
  dom.call('renderStartTab', r, r.games);
  assert.equal(dom.app.querySelector('.hub-presets'), null, 'a chip was offered that could narrow nothing');
});

test('a quick-start chip opens the setup screen with its filter already applied', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());

  const r = busyRound();
  // Half the shelf short, half long: the only shelf shape on which „unter
  // 60 Min" both narrows something and leaves something.
  r.games.forEach((g, i) => { g.minPlaytime = i < 4 ? 30 : 120; });

  const seen = [];
  dom.set('showStartSession', (round, prefill) => seen.push(prefill));
  dom.call('renderStartTab', r, r.games);

  const chips = dom.app.querySelectorAll('.hub-preset');
  assert.equal(chips.length, 1, 'exactly the playtime chip this shelf can express');
  chips[0].click();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].metadata.maxPlaytime, 60, 'the chip opened the setup screen with nothing applied');
});

test('the chips follow the CTA into the rail instead of being left behind', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());

  /* From 1280px up the hero and the big CTA are `rail-owned` and the rail
     carries them. A chip row that stayed in the pane would then modify a button
     that is no longer beside it, and it renders as a stray label floating above
     the tickets — which is exactly what the first browser pass showed.

     So the pane's copy must be `rail-owned` too, and the rail must build its
     own. Asserting only the class would pass against a build where the rail
     shows nothing at all, so both halves are here. */
  const r = busyRound();
  r.games.forEach((g, i) => { g.minPlaytime = i < 4 ? 30 : 120; });

  dom.call('renderStartTab', r, r.games);
  const pane = dom.app.querySelector('.hub-presets');
  assert.ok(pane, 'the pane renders no chips at all');
  assert.ok(pane.classList.contains('rail-owned'),
    'the pane keeps its chips at rail widths, stranding them from the CTA they modify');

  const rail = dom.call('buildRoundRail', r, 'start');
  const railChips = rail.querySelectorAll('.hub-preset');
  assert.equal(railChips.length, pane.querySelectorAll('.hub-preset').length,
    'the rail offers a different set of chips than the pane — they come from one function');
  assert.ok(railChips.length, 'the rail carries no chips, so hiding the pane copy loses them entirely');
});

test('showStartSession lets a prefill win over the round\'s remembered preset', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  const r = busyRound();
  r.games.forEach((g, i) => { g.minPlaytime = i < 4 ? 30 : 120; });
  // The remembered preset says 180; the chip says 60 and must win for this
  // entry — otherwise the chip silently opens last week's draw.
  r.lastSessionFilters = { count: 5, metadata: { maxPlaytime: 180 } };
  dom.set('api', noRecos());
  dom.call('showStartSession', r, { metadata: { maxPlaytime: 60 } });

  const chips = [...dom.app.querySelectorAll('.fchip__label')].map((el) => el.textContent);
  assert.ok(chips.some((c) => /60/.test(c)), `the applied filter is not 60: ${chips.join(' | ')}`);
  assert.ok(!chips.some((c) => /180/.test(c)), 'the remembered 180 survived the prefill');
  // The pool is the assertion that cannot be satisfied by a chip alone: only
  // the four short games may be in it.
  assert.equal(dom.app.querySelectorAll('#poolGrid .pool-tile').length, 4, 'the prefill did not actually narrow the draw');
  // The unrelated half of the remembered preset is untouched: a shallow merge
  // replaces `metadata`, not the whole blob.
  assert.equal(dom.document.querySelector('#count').value, '5', 'the prefill discarded the remembered draw count');
});

// ------------------------------------------------------------------- teaser

test('the recommendations teaser arrives after the paint, and only when it has something', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  const r = busyRound();
  let resolve;
  dom.set('api', () => new Promise((r2) => { resolve = r2; }));
  dom.call('renderStartTab', r, r.games);
  const before = dom.app.querySelectorAll('.hub-card').length;

  resolve({ recommendations: [{ externalId: '1', title: 'Ark Nova', reasons: [{ term: 'quality', rating: 8.5 }] }] });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(dom.app.querySelectorAll('.hub-card').length, before + 1, 'the teaser never landed');
  assert.ok([...dom.app.querySelectorAll('.hub-row__title')].some((el) => el.textContent === 'Ark Nova'));
});

test('the teaser degrades to nothing on an empty list and on an error', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  const r = busyRound();
  dom.set('api', noRecos());
  dom.call('renderStartTab', r, r.games);
  await new Promise((done) => setTimeout(done, 0));
  const quiet = dom.app.querySelectorAll('.hub-card').length;

  dom.app.innerHTML = '';
  dom.set('api', async () => { throw new Error('no corpus here'); });
  dom.call('renderStartTab', r, r.games);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(dom.app.querySelectorAll('.hub-card').length, quiet, 'a failed teaser fetch left something on screen');
});

test('a teaser landing on a young round removes the stand-in it was rendered beside', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  /* The one ordering this design cannot avoid: the stand-in is decided
     synchronously, the teaser arrives later. It must clean up after itself, or
     a round whose only card is the teaser shows „noch nichts hier" above it. */
  const r = youngRound();
  let resolve;
  dom.set('api', () => new Promise((r2) => { resolve = r2; }));
  dom.call('renderStartTab', r, r.games);
  assert.ok(dom.app.querySelector('.empty--rail-gap'), 'the stand-in is missing, so this proves nothing');

  resolve({ recommendations: [{ externalId: '1', title: 'Ark Nova', reasons: [] }] });
  await new Promise((done) => setTimeout(done, 0));
  assert.ok(dom.app.querySelector('.hub-card'), 'the teaser did not land');
  assert.equal(dom.app.querySelector('.empty--rail-gap'), null, 'the stand-in survived beside real content');
});

// ---------------------------------------------------------------------- CSS

test('.hub-cards is an auto-fill grid with no breakpoint of its own', () => {
  const body = bodyOf('.hub-cards');
  assert.ok(body, '.hub-cards has no rule');
  assert.match(body, /repeat\(auto-fill,\s*minmax\(280px,\s*1fr\)\)/,
    'auto-fit would collapse the empty tracks and let ONE small module span the whole pane');
  const spec = gridSpec(body);
  assert.equal(columnsIn(360, spec), 1, 'a phone must get one column');
  assert.ok(columnsIn(880, spec) >= 2, 'the wide pane must get at least two');
});

test('no media query moves the card grid — width alone decides', () => {
  mediaBlocks().forEach(([query, css]) => {
    assert.doesNotMatch(css, /\.hub-cards[\s,{]/,
      `.hub-cards is redefined inside "@media ${query}" — the auto-fill grid needs no breakpoint`);
  });
});

test('an empty grid costs nothing, which is what lets it be appended unconditionally', () => {
  /* Without this rule the grid's own 20px top margin lands on every young
     round — the exact empty-container failure #923's acceptance criteria rule
     out — because the grid is appended before the teaser can fill it. */
  assert.match(bodyOf('.hub-cards:empty') || '', /display:\s*none/);
});
