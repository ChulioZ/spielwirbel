'use strict';

/* The pure half of lent boxes (#1775): public/js/game-loan.js, which the draw
 * (lib/draw.js), the setup screen's preview and the Kümmerliste all read. The
 * preview-vs-draw agreement is asserted directly on `drawPool` here, because a
 * clause that only the server applied would let the setup screen promise a box
 * the draw leaves out. */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOAN_LONG_DAYS, isLoanDay, isLentOut, fitsLoanFilter, loanBorrowerName, loanToday, longLoans,
} = require('../public/js/game-loan');
const { drawPool } = require('../lib/draw');

const lentGame = (id, since = '2026-11-01', extra = {}) =>
  ({ id, title: id, minPlayers: 1, maxPlayers: 8, loan: { to: 'Kim', since }, ...extra });
const home = (id) => ({ id, title: id, minPlayers: 1, maxPlayers: 8 });

test('a lent box is out of the pool by DEFAULT — the clause needs no flag to exclude', () => {
  // Touches no flag first: a test that passed `false` itself could not see a
  // default flipped to "include" (.claude/rules/break-the-code-on-purpose.md).
  assert.equal(fitsLoanFilter(lentGame('a')), false);
  assert.equal(fitsLoanFilter(home('b')), true);
  assert.equal(fitsLoanFilter(lentGame('a'), true), true);
  assert.equal(fitsLoanFilter(lentGame('a'), 'true'), false, 'only a literal true opts in');
});

test('drawPool and the shared clause agree, with and without includeLent', () => {
  const round = { games: [lentGame('lent'), home('home')], members: [] };
  const ids = (opts) => drawPool(round, { playerCount: 2, ...opts }).map((g) => g.id);
  assert.deepEqual(ids({}), round.games.filter((g) => fitsLoanFilter(g)).map((g) => g.id));
  assert.deepEqual(ids({}), ['home']);
  assert.deepEqual(ids({ includeLent: true }), ['lent', 'home']);
});

test('isLentOut reads only a loan with a name as out', () => {
  assert.equal(isLentOut(lentGame('a')), true);
  assert.equal(isLentOut(home('a')), false);
  assert.equal(isLentOut({ loan: null }), false);
  assert.equal(isLentOut({ loan: { to: '  ' } }), false);
  assert.equal(isLentOut(null), false);
});

test('isLoanDay accepts a real calendar day only', () => {
  assert.equal(isLoanDay('2026-11-03'), true);
  assert.equal(isLoanDay('2028-02-29'), true);
  for (const bad of ['2026-02-31', '2026-13-01', '3.11.2026', '', null, 20261103]) {
    assert.equal(isLoanDay(bad), false, String(bad));
  }
});

test('loanBorrowerName follows a renamed seat and falls back to the stored name for a deleted one', () => {
  const round = { members: [{ id: 'm1', name: 'Kimberly' }] };
  assert.equal(loanBorrowerName(round, { to: 'Kim', memberId: 'm1' }), 'Kimberly');
  assert.equal(loanBorrowerName(round, { to: 'Kim', memberId: 'gone' }), 'Kim');
  assert.equal(loanBorrowerName(round, { to: 'Nachbarin' }), 'Nachbarin');
  assert.equal(loanBorrowerName(round, null), '');
});

test('loanToday writes the device\'s own calendar day', () => {
  assert.equal(loanToday(new Date(2026, 10, 3, 23, 30).getTime()), '2026-11-03');
  assert.equal(loanToday(new Date(2026, 0, 9, 0, 5).getTime()), '2026-01-09');
});

test('longLoans lists boxes out for eight weeks or more, longest first, and nothing else', () => {
  const now = new Date(2026, 10, 9, 12).getTime(); // 9 November 2026, local
  const games = [
    lentGame('justUnder', '2026-09-15'), // 55 days
    lentGame('exactly', '2026-09-14'), // 56 days — the boundary is on the list
    lentGame('long', '2026-03-01'),
    lentGame('broken', 'yesterday'),
    home('home'),
  ];
  assert.equal(LOAN_LONG_DAYS, 56);
  assert.deepEqual(longLoans(games, now).map((g) => g.id), ['long', 'exactly']);
  // Across the late-March DST switch the count is still in calendar days.
  const spring = new Date(2026, 4, 24, 12).getTime(); // 24 May 2026
  assert.deepEqual(longLoans([lentGame('dst', '2026-03-29')], spring).map((g) => g.id), ['dst']);
  assert.deepEqual(longLoans([lentGame('dst', '2026-03-30')], spring).map((g) => g.id), []);
});
