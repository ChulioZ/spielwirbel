'use strict';

/* A retired game is never NAMED on the Pokale tab (#643).
 *
 * Retiring a game is the user saying it has left the collection, so crowning it
 * "Meistgespielt" afterwards — or naming it as someone's Lieblingsspiel —
 * contradicts the act they just performed. Completing one is different: the game
 * was played through, it is part of the record, and it stays.
 *
 * That distinction is the whole point of these specs, so every assertion below
 * is written to fail in BOTH directions: the fixture's retired game leads on
 * every metric (so a missing filter names it), and the runner-up behind it is a
 * COMPLETED game (so widening the filter to both archives — the reflex, since
 * `!retired && !completed` is the shape used everywhere else in this file's
 * neighbours — names the wrong game or drops the card entirely). A one-archive
 * fixture would have been satisfied by either mistake.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): the claim is about what the
 * screen ends up naming, and three separate code paths feed those cards.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

/* One vote session carries every rating; the rest exist only to move the
   Meistgespielt tally, so the play counts and the ratings can be reasoned about
   independently. Counts: Azul (retired) 3, Cascadia (completed) 2, Catan 1. */
const VOTES = {
  m1: { g1: { rating: 3 }, g2: { rating: 5 }, g3: { rating: 4 } },
  m2: { g1: { rating: 3 }, g2: { rating: 1 }, g3: { rating: 2 } },
  m3: { g1: { rating: 3 }, g2: { rating: 3 }, g3: { rating: 3 } },
};

const played = (id, gid, votes = {}) => ({
  id,
  createdAt: `2026-07-0${id.slice(1)}T20:00:00.000Z`,
  gameIds: ['g1', 'g2', 'g3'],
  memberIds: ['m1', 'm2', 'm3'],
  votes,
  votedIds: Object.keys(votes),
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: ['m1'],
  chosenGameId: gid,
  events: [],
});

const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
    { id: 'm3', name: 'Cem' },
  ],
  games: [
    { id: 'g1', title: 'Catan', tagIds: [] },
    { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
    { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
  ],
  sessions: [
    played('s1', 'g2', VOTES),
    played('s2', 'g2'),
    played('s3', 'g2'),
    played('s4', 'g3'),
    played('s5', 'g3'),
    played('s6', 'g1'),
  ],
};

function bootApp(t) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return ROUND;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

/* Every element on a rendered screen that names a GAME.
   `.pokale-card__value` alone is not that test: pokaleStatCard uses the same
   class for the streak, whose value is a MEMBER name, so a naive selector
   reports "Anna" as a named game and quietly weakens every assertion built on
   it. Both game-naming builders route their link through makeGameLink, so the
   href is what actually distinguishes them (`gamePath`, router.js:80). */
const namedGames = (root) =>
  [...root.querySelectorAll('.pokale-game__title, .pokale-card__value')]
    .filter((el) => !el.classList.contains('pokale-card__value') || /\/game\//.test(el.getAttribute('href') || ''))
    .map((el) => el.textContent);

/** One stat card, found by the label it renders. */
const cardByLabel = (root, label) =>
  [...root.querySelectorAll('.pokale-card')].find(
    (c) => (c.querySelector('.pokale-card__label') || {}).textContent === label
  );

// ---- the Pokale tab -------------------------------------------------------

test('no card on the Pokale tab names a retired game', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  assert.ok(namedGames(dom.app).length >= 3, 'the tab must actually have rendered its cards');
  assert.ok(
    !namedGames(dom.app).includes('Azul'),
    'Azul is retired, yet the tab still names it somewhere'
  );
});

test('Meistgespielt skips a retired game and crowns the most-played one that is left', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  const card = cardByLabel(dom.app, dom.run("t('pokale.mostPlayed')"));
  // Azul was chosen on 3 nights and Cascadia on 2, so naming Cascadia proves the
  // retired game's nights stopped counting — and that a COMPLETED game's did not
  // (filtering both archives would leave Catan, on one night).
  assert.deepEqual(namedGames(card), ['Cascadia']);
  assert.equal(card.querySelector('.pokale-card__sub').textContent, dom.run("tn(2, 'home.chip.sessionsOne', 'home.chip.sessions')"));
});

test('Größte Uneinigkeit skips a retired game but keeps a completed one', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  // Spreads: Azul 4 (retired), Cascadia 2 (completed), Catan 0 (never divisive).
  const card = cardByLabel(dom.app, dom.run("t('recap.divisive')"));
  assert.ok(card, 'the disagreement card is missing — both archives were filtered out');
  assert.deepEqual(namedGames(card), ['Cascadia']);
});

test('a member whose top-rated game is retired keeps their next-best favourite', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  // Anna rated Azul 5, Cascadia 4, Catan 3.
  const anna = [...dom.app.querySelectorAll('.recap-fav')].find(
    (c) => c.querySelector('.recap-fav__name').textContent === 'Anna'
  );
  assert.ok(anna, "Anna's favourite card is missing entirely");
  assert.equal(anna.querySelector('.pokale-card__value').textContent, 'Cascadia');
  assert.equal(
    anna.querySelector('.pokale-card__sub').textContent,
    dom.run("t('recap.favSub', { avg: '4.0' })"),
    'the average shown must be the one for the game named, not the retired favourite'
  );
});

test('Meistgespielt is omitted, not blank, when every game ever played is retired', async (t) => {
  // A newly reachable state: before #643 an empty tally meant "no finished
  // session ever chose a game", and the only way there was a round with no
  // sessions. Now a round with plenty of history can empty it. The card must
  // drop out (the existing empty-tally behaviour) rather than render a heading
  // over nothing, or crash on a `find` that returns undefined.
  const dom = loadApp();
  t.after(() => dom.close());
  const round = {
    ...ROUND,
    games: ROUND.games.map((g) => ({ ...g, retired: true, completed: false })),
  };
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showRound', RID, 'pokale');
  assert.equal(cardByLabel(dom.app, dom.run("t('pokale.mostPlayed')")), undefined);
  assert.deepEqual(namedGames(dom.app), [], 'no card may name a game when every game is retired');
  // The tab still renders — an omitted card must not take the screen with it.
  assert.ok(dom.app.querySelector('.recap__totals'), 'the Rückblick totals still render');
});

// ---- what must NOT have changed -------------------------------------------

test('Bestbewertet keeps its active-only filter — no completed game appears there', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  const card = cardByLabel(dom.app, dom.run("t('pokale.bestRated')"));
  // All three games average 3.0; only Catan is on the active shelf. Cascadia
  // appearing here would mean the retired-only rule had leaked into a card that
  // is deliberately about what the group can still reach for.
  assert.deepEqual(namedGames(card), ['Catan']);
});

test('the archive totals chip still counts both archives', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  const chips = [...dom.app.querySelectorAll('.recap__totals .stat-chip')].map((c) => c.textContent);
  assert.ok(
    chips.includes(dom.run("t('recap.archived', { n: 2 })")),
    'the „n aussortiert" chip counts the archive, not games on display — it stays'
  );
});

// ---- the member detail page -----------------------------------------------

test("the member page's Lieblingsspiel follows the same rule as the Pokale card", async (t) => {
  const dom = bootApp(t);
  await dom.call('showMember', RID, 'm1');
  const card = cardByLabel(dom.app, dom.run("t('member.favorite')"));
  assert.deepEqual(
    namedGames(card),
    ['Cascadia'],
    'a game must not vanish from the Pokale favourites while still sitting here'
  );
});

test('a member page still averages every rating given, retired games included', async (t) => {
  const dom = bootApp(t);
  await dom.call('showMember', RID, 'm1');
  const card = cardByLabel(dom.app, dom.run("t('member.avgGiven')"));
  // Anna gave 3 (Catan), 5 (Azul, retired) and 4 (Cascadia) -> 4.0. This stat is
  // about how she rates, not about what is on the shelf, so the favourite filter
  // two lines above it in memberStats must not reach `allRatings`.
  assert.equal(card.querySelector('.pokale-card__value').textContent, 'Ø 4.0');
});
