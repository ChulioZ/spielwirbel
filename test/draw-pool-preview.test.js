'use strict';

/* The setup screen's live pool preview really applies the SERVER's predicates.

   Split out of test/draw-pool.test.js by #1005, which pushed that file past the
   700-line budget (.claude/rules/token-friendly-source-files.md). It is a real
   seam rather than a line-count cut: everything there is a pure function called
   directly, everything here boots the jsdom harness and renders a view, and
   neither half is ever edited for the other's reason.

   This is the failure #634 exists to prevent and that no server-side test can
   see by construction — the preview promising a pool the draw would not
   produce. Only the ACTIVE and RANGE clauses are shared, so only those are
   asserted as parity; the tag filter is deliberately still expressed twice and
   test/draw.test.js owns that half. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool } = require('../lib/draw');
const { loadApp } = require('./support/dom');

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
    // Exactly three, which is what separates the two range predicates at a table
    // of four: `fitsPlayerCount` asks whether the box seats the whole party (no),
    // `fitsSomeTable` whether it seats SOME table of three or more (yes).
    { id: 'g6', title: 'Trio', minPlayers: 3, maxPlayers: 3 },
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
const drawable = (playerCount, over = {}) =>
  drawPool(round, { playerCount, ...over }).map((g) => g.title).sort();

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
  // `[aria-pressed]` is what picks the MEMBER seats out of the ring: since #1016
  // it also carries the guests and the „+" seat, and neither of those toggles
  // anybody in or out.
  const seats = [...dom.app.querySelectorAll('.nr-seat[aria-pressed]')];
  assert.equal(seats.length, 4, 'fixture sanity: one seat per member');
  seats[0].click();
  seats[1].click();

  assert.deepEqual(previewed(), drawable(2));
  // The set must have moved in both directions, or this asserts nothing that the
  // four-player case did not already cover.
  assert.deepEqual(previewed(), ['Azul', 'Duo']);
});

/* ---- Multi-table (#796) ---- */

test('… and after „Mehrere Tische", against the RELAXED predicate', async () => {
  await dom.call('showStartSession', round);
  // The chip that replaced the checkbox in #1015. Addressed by `data-addon`
  // rather than by its label, which is localised, or by its position in the row,
  // which the shelf chip changes.
  const box = dom.app.querySelector('.setup-addons__chip[data-addon="multi"]');
  assert.ok(box, 'the setup screen offers the multi-table chip');
  box.click();

  assert.deepEqual(previewed(), drawable(4, { multiTable: true }));
  // The set must actually have GROWN, or this asserts nothing the four-player
  // case above did not already cover — which is exactly what the first version of
  // this spec did, and it stayed green against a preview that ignored the flag.
  // Trio (3-3) is the game that separates them; Duo (2-2) seats no table of three
  // and stays out of both.
  assert.deepEqual(previewed(), ['Azul', 'Catan', 'Trio']);

  box.click();
  assert.deepEqual(previewed(), drawable(4), 'switching it back off restores the ordinary pool');
  assert.deepEqual(previewed(), ['Azul', 'Catan']);
});

test('and the flag itself rides the draw request', async () => {
  /* The preview and the pool can agree perfectly while the POST omits the flag,
     in which case the server draws the ordinary pool and answers "no matching
     games" over a screen showing four. Only the request body can see that. */
  /* Two draws from ONE screen, which the app itself never does — the lobby has
     replaced this view by the second one. Since #1017 a draw holds the screen for
     the length of the whirl and refuses a second press while it is in flight, so
     this spec has to say which motion setting it runs under: with the whirl off
     both draws complete in the turn they were clicked, and the request body —
     the only thing under test here — is unaffected either way. */
  dom.window.matchMedia = (q) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q) });
  await dom.call('showStartSession', round);
  const bodies = [];
  dom.set('api', async (method, path, body) => {
    bodies.push({ ...body });
    return { session: { id: 's1', gameIds: [] }, games: [], members: [], guests: [], teams: [] };
  });
  dom.set('showSessionLobby', () => {});

  dom.app.querySelector('#go').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bodies[0].multiTable, false);

  dom.app.querySelector('.setup-addons__chip[data-addon="multi"]').click();
  dom.app.querySelector('#go').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bodies[1].multiTable, true);
});

test('the multi-table chip carries its state in aria-pressed, not only in colour', async () => {
  /* It was a checkbox until #1015, which gave the state away for free. A chip
     announces as a bare name unless the state is on the element, and this is the
     control that decides which pool the whole screen is previewing
     (.claude/rules/accessibility-contrast-and-modals.md §3).

     It is a TOGGLE, not a disclosure — it has no body to open — so `aria-pressed`
     is the right half of that pair and `aria-expanded` would be wrong. */
  await dom.call('showStartSession', round);
  const chip = dom.app.querySelector('.setup-addons__chip[data-addon="multi"]');
  assert.equal(chip.tagName, 'BUTTON', 'a chip that is not a real button is not operable by keyboard');
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
  assert.equal(chip.hasAttribute('aria-expanded'), false, 'a bodyless toggle must not claim to expand something');
  chip.click();
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  chip.click();
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
});
