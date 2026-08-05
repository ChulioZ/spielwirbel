'use strict';

/* The shared draw-pool predicates (#634) and — the point of the whole exercise —
   that the session-setup screen's live preview really applies them.

   `test/draw.test.js` covers the server's side of this. What it cannot see is the
   failure #634 exists to prevent: the preview promising a pool the draw would not
   produce. That is invisible to every server-side test by construction, which is
   why the parity check at the bottom renders the real view and compares its tiles
   against `drawPool()` over the same round.

   Only the ACTIVE and RANGE clauses are shared, so only those are asserted as
   parity. The tag filter is deliberately still expressed twice — the server takes
   resolved include/exclude id lists, the client a tri-state chip map — and
   `test/draw.test.js` owns that half. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { isActiveGame, fitsPlayerCount, requiredExpansions } = require('../public/js/draw-pool');
const { drawPool } = require('../lib/draw');
const { loadApp } = require('./support/dom');

test('isActiveGame is false for either archive and true for a plain game', () => {
  assert.equal(isActiveGame({}), true);
  assert.equal(isActiveGame({ retired: true }), false);
  assert.equal(isActiveGame({ completed: true }), false);
  // Exclusivity is enforced in the repo, but the predicate must not depend on it.
  assert.equal(isActiveGame({ retired: true, completed: true }), false);
});

test('fitsPlayerCount admits exactly the declared range, bounds included', () => {
  const duo = { minPlayers: 2, maxPlayers: 2 };
  assert.equal(fitsPlayerCount(duo, 1), false);
  assert.equal(fitsPlayerCount(duo, 2), true, 'both bounds are inclusive');
  assert.equal(fitsPlayerCount(duo, 3), false);
});

test('an absent bound means "any table size" — not zero and not infinity', () => {
  // The typeof guards are what make this true; defaulting a missing min to 0
  // would read the same here but not for a game with no range at all, below.
  assert.equal(fitsPlayerCount({ minPlayers: 4 }, 99), true, 'no maximum');
  assert.equal(fitsPlayerCount({ maxPlayers: 4 }, 1), true, 'no minimum');
  for (const n of [1, 4, 99]) {
    assert.equal(fitsPlayerCount({}, n), true, `a game with no range fits ${n}`);
  }
});

/* ---- owned expansions widen the range (#653) --------------------------------
   The union of the base box and every owned expansion, never their hull. The
   two traps are asserted directly below because both produce a plausible pool
   rather than an error — see .claude/rules/expansions-widen-by-union.md. */

test('an owned expansion makes its game drawable at the counts it admits', () => {
  const catan = {
    minPlayers: 3,
    maxPlayers: 4,
    expansions: [{ title: '5–6 Spieler', minPlayers: 5, maxPlayers: 6 }],
  };
  assert.equal(fitsPlayerCount(catan, 4), true, 'the base box still fits');
  assert.equal(fitsPlayerCount(catan, 5), true, 'the expansion admits five');
  assert.equal(fitsPlayerCount(catan, 6), true);
  assert.equal(fitsPlayerCount(catan, 7), false, 'nothing owned admits seven');
  assert.equal(fitsPlayerCount(catan, 2), false, 'and the base minimum still binds');
});

test('the widening is a UNION, not a hull — a solo expansion does not admit two', () => {
  // The case that separates the two implementations: hulling 3–4 with 1–1 gives
  // 1–4, which admits a table of 2 that no box in the cupboard supports.
  const game = {
    minPlayers: 3,
    maxPlayers: 4,
    expansions: [{ title: 'Solo', minPlayers: 1, maxPlayers: 1 }],
  };
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => fitsPlayerCount(game, n)),
    [true, false, true, true, false]
  );
});

test('an absent range means the OPPOSITE thing on an expansion', () => {
  // On the base game it means "any table size" (asserted above). On an
  // expansion it must widen nothing, or one expansion BGG has no numbers for
  // makes its game drawable at every count.
  const vague = { minPlayers: 3, maxPlayers: 4, expansions: [{ title: 'Unbekannt' }] };
  assert.equal(fitsPlayerCount(vague, 6), false, 'no numbers, no widening');
  assert.equal(fitsPlayerCount(vague, 1), false);
  assert.equal(fitsPlayerCount(vague, 3), true, 'the base box is untouched');

  // A HALF-declared range is the same case: it widens only over a range it
  // states in full, so a stray bound can never open one end to infinity.
  const halfMax = { minPlayers: 3, maxPlayers: 4, expansions: [{ maxPlayers: 6 }] };
  assert.equal(fitsPlayerCount(halfMax, 6), false, 'a bare maximum states no minimum');
  assert.equal(fitsPlayerCount(halfMax, 1), false, 'and must not open the bottom end');
  const halfMin = { minPlayers: 3, maxPlayers: 4, expansions: [{ minPlayers: 5 }] };
  assert.equal(fitsPlayerCount(halfMin, 5), false, 'a bare minimum states no maximum');
  assert.equal(fitsPlayerCount(halfMin, 99), false);
});

test('a base game with no range keeps fitting everything, expansions or not', () => {
  const g = { expansions: [{ title: 'Solo', minPlayers: 1, maxPlayers: 1 }] };
  for (const n of [1, 4, 99]) assert.equal(fitsPlayerCount(g, n), true);
});

test('requiredExpansions names only what the BASE box cannot seat', () => {
  const game = {
    minPlayers: 3,
    maxPlayers: 4,
    expansions: [
      { id: 'e1', title: '5–6 Spieler', minPlayers: 5, maxPlayers: 6 },
      { id: 'e2', title: 'Seefahrer', minPlayers: 3, maxPlayers: 6 },
      { id: 'e3', title: 'Ohne Angabe' },
    ],
  };
  assert.deepEqual(requiredExpansions(game, 4), [], 'the base box fits — nothing is required');
  assert.deepEqual(
    requiredExpansions(game, 5).map((e) => e.id),
    ['e1', 'e2'],
    'both owned expansions that admit five are named'
  );
  assert.deepEqual(requiredExpansions(game, 9), [], 'a count nothing admits names nothing');
  assert.deepEqual(requiredExpansions({ minPlayers: 3, maxPlayers: 4 }, 5), []);
});

/* ---- the cross-boundary parity check ---------------------------------------
   Four members join by default and there are no guests or teams, so the view's
   party count is round.members.length — the same number handed to drawPool here.

   The fixture discriminates in BOTH directions as that count changes: at four
   players 'Catan' is in and 'Duo' is out, at two it is the other way round. A
   preview that had drifted to a wrong bound, a wrong comparison or a missing
   archive clause changes one of those four answers. */

const round = {
  id: 'r1',
  name: 'Freitagsrunde',
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
    { id: 'm3', name: 'Cleo' },
    { id: 'm4', name: 'Dana' },
  ],
  games: [
    { id: 'g1', title: 'Azul' },
    { id: 'g2', title: 'Uno', retired: true },
    { id: 'g3', title: 'Risiko', completed: true },
    { id: 'g4', title: 'Duo', minPlayers: 2, maxPlayers: 2 },
    { id: 'g5', title: 'Catan', minPlayers: 3, maxPlayers: 4 },
  ],
};

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
// The screen renders the per-device-voting row only in accounts mode, and it is
// not what this spec is about.
dom.set('isLoggedIn', () => false);

// The titles the preview panel is offering right now.
const previewed = () =>
  [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();

// What the server would actually draw from, for the same table size.
const drawable = (playerCount) =>
  drawPool(round, { playerCount }).map((g) => g.title).sort();

test('the setup preview offers exactly what the draw would pick from', async () => {
  await dom.call('showStartSession', round);

  assert.deepEqual(previewed(), drawable(4));
  // Anti-vacuous: an empty preview would satisfy a comparison against an empty
  // pool, and both archives must be doing work in that equality.
  assert.deepEqual(previewed(), ['Azul', 'Catan']);
});

test('… and still does after the table size changes', async () => {
  await dom.call('showStartSession', round);

  // Two seats out -> a two-person table. Clicking a seat re-runs updateHint().
  const seats = [...dom.app.querySelectorAll('.nr-seat')];
  assert.equal(seats.length, 4, 'fixture sanity: one seat per member');
  seats[0].click();
  seats[1].click();

  assert.deepEqual(previewed(), drawable(2));
  // The set must have moved in both directions, or this asserts nothing that the
  // four-player case did not already cover.
  assert.deepEqual(previewed(), ['Azul', 'Duo']);
});
