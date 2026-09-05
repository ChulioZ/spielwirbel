'use strict';

/* The member screen's „Stärkstes Spiel" tile (#920).
 *
 * The member page already showed the Siegwertung (#895) as one round-wide
 * number: how much someone has won, but not at WHAT. This tile decomposes it by
 * `chosenGameId`, so „+2,4" becomes „+2,4, mostly at Terraforming Mars".
 *
 * The arithmetic is pinned in test/win-score.test.js against the helper
 * directly. What is asserted here is everything the helper deliberately does
 * NOT decide, and that is where the interesting cases are:
 *
 *   - which games may be NAMED (the `isNameableGame` bar the helper leaves to
 *     its caller — a retired game still counts toward the Siegwertung beside
 *     this tile but may not be named by it),
 *   - the tie convention, which is the caller's,
 *   - the empty state, whose trap is that 0 is a real answer here and must not
 *     be mistaken for "nothing",
 *   - and that the named game actually LINKS.
 *
 * Run through the view rather than matched against its source
 * (`.claude/rules/testing-views-under-jsdom.md`) — a regex over
 * `views-member.js` cannot see a link wired to the wrong element.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

// One finished, contested night: `winner` takes a two-party evening at `gid`,
// which is +0,5 to them and −0,5 to the other seat.
let seq = 0;
const night = (gid, winner, extra = {}) => ({
  id: `s${++seq}`,
  createdAt: '2026-07-01T20:00:00.000Z',
  gameIds: [gid].filter(Boolean),
  memberIds: ['m1', 'm2'],
  votes: {},
  votedIds: [],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: [winner],
  chosenGameId: gid,
  events: [],
  ...extra,
});

const roundWith = (games, sessions) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
  ],
  games,
  sessions,
});

const CATAN = { id: 'g1', title: 'Catan', tagIds: [] };
const AZUL = { id: 'g2', title: 'Azul', tagIds: [] };

function bootApp(t, round) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

async function bestTile(t, round, mid = 'm1') {
  const dom = bootApp(t, round);
  await dom.call('showMember', RID, mid);
  const tile = dom.app.querySelector('.member-stats__best');
  assert.ok(tile, 'the „Stärkstes Spiel" tile must render');
  return {
    tile,
    titles: [...tile.querySelectorAll('.pokale-game__title')].map((a) => a.textContent),
    sub: tile.querySelector('.pokale-card__sub').textContent,
    empty: tile.querySelector('.muted'),
  };
}

// ---- the happy path --------------------------------------------------------

test('the tile names the game with the highest summed Siegwertung, and links it', async (t) => {
  const round = roundWith(
    [CATAN, AZUL],
    [night('g1', 'm1'), night('g1', 'm1'), night('g2', 'm2')]
  );
  const { tile, titles, sub } = await bestTile(t, round);

  // Catan: two wins at two parties = +1,0. Azul: one loss = −0,5.
  assert.deepEqual(titles, ['Catan']);
  assert.match(sub, /\+1[.,]0/, 'the sub-line is the signed score, like the Siegwertung tile');

  const link = tile.querySelector('.pokale-game__title');
  assert.ok(link.classList.contains('game-link'), 'the title must be a real game link');
  assert.match(link.getAttribute('href') || '', /g1/, 'and it must point at that game');
});

test('every tied game shares the tile', async (t) => {
  const round = roundWith([CATAN, AZUL], [night('g1', 'm1'), night('g2', 'm1')]);
  const { titles } = await bestTile(t, round);
  assert.deepEqual(titles.sort(), ['Azul', 'Catan']);
});

test('a negative best is shown signed, not hidden and not clamped', async (t) => {
  /* This is the member's own stats page, not a leaderboard — the same call the
     Siegwertung tile beside it already makes. A member who has only lost has a
     strongest game; it is simply their least bad one. */
  const round = roundWith([CATAN], [night('g1', 'm2')]);
  const { titles, sub, empty } = await bestTile(t, round);
  assert.deepEqual(titles, ['Catan']);
  assert.equal(empty, null, 'a negative score is an answer, not an empty state');
  assert.match(sub, /0[.,]5/);
  assert.match(sub, /^[^+]/, 'and it is not rendered as a positive');
});

// ---- what may be NAMED -----------------------------------------------------

test('a retired game is never named, even when it is where the member won most', async (t) => {
  /* The bar is `isNameableGame` (recap.js), shared with the Lieblingsspiel tile
     so a game cannot vanish from the Pokale favourites while still sitting
     here. Deliberately the OPPOSITE call from `avgGiven` (#643), which counts
     every rating including retired games: the split is between measuring and
     naming. */
  const round = roundWith(
    [{ ...CATAN, retired: true }, AZUL],
    [night('g1', 'm1'), night('g1', 'm1'), night('g2', 'm1')]
  );
  const { titles, sub } = await bestTile(t, round);
  assert.deepEqual(titles, ['Azul'], 'the retired game outscores Azul and is still skipped');
  assert.match(sub, /\+0[.,]5/, 'and the score shown is Azul’s, not the retired game’s');
});

test('a member whose only wins are at retired games sees the empty state', async (t) => {
  const round = roundWith([{ ...CATAN, retired: true }], [night('g1', 'm1')]);
  const { titles, sub, empty } = await bestTile(t, round);
  assert.deepEqual(titles, []);
  assert.ok(empty, 'the empty state must appear');
  assert.equal(sub, '', 'and it carries no score line');
});

test('a game that has left the round entirely is never named', async (t) => {
  const round = roundWith([AZUL], [night('gone', 'm1'), night('g2', 'm1')]);
  const { titles } = await bestTile(t, round);
  assert.deepEqual(titles, ['Azul']);
});

// ---- the empty states that used to crash this screen -----------------------

test('a round where no evening ever recorded a game renders the empty state', async (t) => {
  /* `chosenGameId: null` is the split parent's shape and the shape of any
     evening abandoned before a pick. The whole round being like that is the
     degenerate case, and this screen has crashed on exactly that class of input
     before — see the `st.joined === 0` comment in showMember. */
  const round = roundWith([CATAN], [night(null, 'm1', { chosenGameId: null })]);
  const { titles, empty } = await bestTile(t, round);
  assert.deepEqual(titles, []);
  assert.ok(empty);
});

test('a member with no finished sessions at all renders the tile, not an exception', async (t) => {
  const round = roundWith([CATAN], []);
  const { titles, empty } = await bestTile(t, round);
  assert.deepEqual(titles, []);
  assert.ok(empty);
});

test('a solo-only game is named at exactly zero rather than dropped', async (t) => {
  /* p = w = 1 gives 0 — the win-score file's own construction, with no `if
     (solo)` anywhere. Zero is a real score, so the tile shows it; what it must
     never do is let a solo night OUTRANK a contested win, which
     test/win-score.test.js pins directly. */
  const round = roundWith(
    [CATAN],
    [night('g1', 'm1', { memberIds: ['m1'], winnerIds: ['m1'] })]
  );
  const { titles, sub, empty } = await bestTile(t, round);
  assert.deepEqual(titles, ['Catan']);
  assert.equal(empty, null, '0 must not be mistaken for "nothing"');
  assert.match(sub, /0[.,]0/);
});
