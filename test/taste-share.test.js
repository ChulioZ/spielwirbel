'use strict';

// #1776 — whose taste the table follows. The fixture is hand-computed (see the
// comment above `EXPECTED`) and carries every case the issue names: a split
// session, a guest, a team, a retired favourite, a completed favourite, a
// cancelled draw, an open session, a retired member and a deleted game.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  TASTE_SHARE_FROM_SESSIONS, TASTE_SHARE_MIN_FAVOURITES, tasteShare, tasteShareRows,
} = require('../public/js/taste-share');
const { sessionPeople } = require('../public/js/session-people');
const { isNameableGame } = require('../public/js/recap');
const { ratingRung, RATING_MAX } = require('../public/js/rating-faces');

const deps = { peopleOf: sessionPeople, isNameableGame, ratingRung, ratingMax: RATING_MAX };
const v = (rating) => ({ rating });
const ALL = ['ana', 'ben', 'cem'];

function fixture() {
  return {
    members: [
      { id: 'ana', name: 'Ana' },
      { id: 'ben', name: 'Ben' },
      { id: 'cem', name: 'Cem' },
      { id: 'dora', name: 'Dora', retired: true },
    ],
    games: [
      { id: 'azul', title: 'Azul' },
      { id: 'brass', title: 'Brass' },
      { id: 'cat', title: 'Catan' },
      { id: 'dune', title: 'Dune' },
      { id: 'old', title: 'Old', retired: true },
      { id: 'done', title: 'Done', completed: true },
    ],
    sessions: [
      { id: 's1', finished: true, memberIds: [...ALL, 'dora'], chosenGameId: 'azul',
        guests: [{ id: 'g1', name: 'Gast' }],
        votes: {
          ana: { azul: v(5), brass: v(5), dune: v(3) },
          ben: { cat: v(5), dune: v(5) },
          cem: { azul: v(4) },
          dora: { azul: v(5), brass: v(5) },
          g1: { cem: v(5), dune: v(5) },
          ana2: { azul: v(5) },
        } },
      // A team night: ana and ben on one team. Teams change nothing here.
      { id: 's2', finished: true, memberIds: ALL, chosenGameId: 'dune',
        teams: [{ id: 't1', personIds: ['ana', 'ben'] }],
        votes: {
          ana: { azul: v(4), old: v(5), done: v(5), gone: v(5) },
          ben: { brass: v(2) },
        } },
      // A split: the parent holds no chosen game, its tables count one by one.
      { id: 's3', memberIds: ALL, chosenGameId: null, childSessionIds: ['s3a', 's3b'], votes: {} },
      { id: 's3a', finished: true, memberIds: ['ana', 'cem'], chosenGameId: 'brass', votes: {} },
      { id: 's3b', finished: true, memberIds: ['ben'], chosenGameId: 'cat',
        guests: [{ id: 'g2', name: 'Gast 2' }], votes: { g2: { dune: v(5) } } },
      // A cancelled draw is no evening.
      { id: 's4', cancelled: true, memberIds: ALL, chosenGameId: 'azul', votes: {} },
      // ana is not at this table.
      { id: 's5', finished: true, memberIds: ['ben', 'cem'], chosenGameId: 'azul', votes: {} },
      // Open with a chosen game: an evening as the shelf counts it (#1721).
      { id: 's6', memberIds: ['ana'], chosenGameId: 'done', votes: {} },
      // A retired game played: nobody's favourite any more.
      { id: 's7', finished: true, memberIds: ALL, chosenGameId: 'old', votes: {} },
    ],
  };
}

/* By hand:
   ana  azul [5,4]=4,5 → top face ✓ · brass [5] ✓ · dune [3] ✗ · done [5] ✓
        (old is retired, gone was deleted) → 3 favourites.
        Evenings: s1 azul, s3a brass, s6 done = 3 (s4 cancelled, s5 absent).
   ben  cat [5] ✓ · dune [5] ✓ · brass [2] ✗ → 2. Evenings: s2 dune, s3b cat = 2.
   cem  azul [4] ✗ → none (the guest's 5 for „cem" is not his). 0 evenings.
   dora retired → no entry. The guests g1/g2 are never listed. */
const EXPECTED = [
  { memberId: 'ana', favouriteIds: ['azul', 'brass', 'done'], evenings: 3, favouritesPlayed: 3 },
  { memberId: 'ben', favouriteIds: ['cat', 'dune'], evenings: 2, favouritesPlayed: 2 },
  { memberId: 'cem', favouriteIds: [], evenings: 0, favouritesPlayed: 0 },
];

test('every active member gets the hand-computed favourites and evenings', () => {
  const got = tasteShare(fixture(), deps).map((e) => ({ ...e, favouriteIds: [...e.favouriteIds].sort() }));
  assert.deepEqual(got, EXPECTED);
});

test('a retired favourite stops counting, and its evenings with it', () => {
  const round = fixture();
  round.games.find((g) => g.id === 'azul').retired = true;
  const ana = tasteShare(round, deps).find((e) => e.memberId === 'ana');
  assert.deepEqual([...ana.favouriteIds].sort(), ['brass', 'done']);
  assert.equal(ana.evenings, 2);
});

test('the same favourite played twice is two evenings but one favourite', () => {
  const round = fixture();
  round.sessions.push({ id: 's8', finished: true, memberIds: ALL, chosenGameId: 'brass', votes: {} });
  const ana = tasteShare(round, deps).find((e) => e.memberId === 'ana');
  assert.equal(ana.evenings, 4);
  assert.equal(ana.favouritesPlayed, 3);
});

test('rows: only members with enough favourites, most evenings first', () => {
  assert.equal(TASTE_SHARE_MIN_FAVOURITES, 2);
  assert.equal(TASTE_SHARE_FROM_SESSIONS, 6);
  const rows = tasteShareRows(tasteShare(fixture(), deps));
  assert.deepEqual(rows.map((r) => r.memberId), ['ana', 'ben']);
});

test('rows: a member with ONE favourite is left out', () => {
  const entries = [
    { memberId: 'a', favouriteIds: ['x'], evenings: 9, favouritesPlayed: 1 },
    { memberId: 'b', favouriteIds: ['x', 'y'], evenings: 0, favouritesPlayed: 0 },
  ];
  assert.deepEqual(tasteShareRows(entries).map((r) => r.memberId), ['b']);
});

test('rows: equal counts keep round order (no tiebreak, no ranks)', () => {
  const two = ['x', 'y'];
  const entries = [
    { memberId: 'a', favouriteIds: two, evenings: 1, favouritesPlayed: 1 },
    { memberId: 'b', favouriteIds: two, evenings: 4, favouritesPlayed: 2 },
    { memberId: 'c', favouriteIds: two, evenings: 1, favouritesPlayed: 1 },
    { memberId: 'd', favouriteIds: two, evenings: 4, favouritesPlayed: 2 },
  ];
  assert.deepEqual(tasteShareRows(entries).map((r) => r.memberId), ['b', 'd', 'a', 'c']);
});

test('under Node a forgotten deps argument throws rather than computing something else', () => {
  assert.throws(() => tasteShare(fixture()), ReferenceError);
});
