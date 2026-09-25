'use strict';

/*
 * „Dein Rückblick" — the per-period aggregation over an account's play list
 * (issue #1147, public/js/account-recap.js).
 *
 * The timezone is pinned FIRST, before anything reads a Date, because the whole
 * point of bucketing on the client is that the reader's calendar decides the
 * month. Los Angeles is where a UTC bucket goes wrong in the evening: 22:00 on
 * July 31 there is 05:00 on August 1 in UTC. The control below asserts exactly
 * that, so this file stops discriminating loudly — not silently — if the zone
 * ever fails to apply.
 */

process.env.TZ = 'America/Los_Angeles';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { periodKeyOf, periodsOf } = require('../public/js/period-recap');
const { accountPeriodsOf, accountRecap } = require('../public/js/account-recap');

// The REAL period-recap functions, injected — a stand-in here would test a
// second definition of „März" rather than the one the Chronik uses.
const deps = { periodKeyOf, periodsOf };

const play = (at, key, rating = null, title = key) => ({ at, key: `title:${key.toLowerCase()}`, title, image: null, rating });
const month = (key) => ({ kind: 'month', key, at: `${key}-01T00:00:00` });
const year = (key) => ({ kind: 'year', key, at: `${key}-01-01T00:00:00` });
const titles = (games) => games.map((g) => g.title);

test('bucketing is the READER\'s calendar: 22:00 on July 31 in LA stays in July', () => {
  const at = '2026-08-01T05:00:00.000Z'; // 22:00 PDT, July 31
  // The control: in UTC this instant is August, so a server-side bucket would
  // have moved the evening. Without it the test would pass in a UTC runner for
  // the wrong reason.
  assert.equal(new Date(at).getUTCMonth(), 7, 'control: UTC reads August');
  assert.equal(new Date(at).getMonth(), 6, 'TZ did not apply — the file no longer tests anything');

  const plays = [play(at, 'Azul')];
  const periods = accountPeriodsOf(plays, deps);
  assert.deepEqual(periods.map((p) => `${p.kind}:${p.key}`), ['month:2026-07', 'year:2026']);
  assert.equal(accountRecap(plays, month('2026-07'), deps).sessions, 1);
  assert.equal(accountRecap(plays, month('2026-08'), deps).sessions, 0);
});

test('periods are the account\'s own months newest first, then its years — no empty one', () => {
  const plays = [
    play('2025-12-10T20:00:00.000Z', 'Azul'),
    play('2026-02-10T20:00:00.000Z', 'Azul'),
    play('2026-03-10T20:00:00.000Z', 'Brass'),
  ];
  assert.deepEqual(accountPeriodsOf(plays, deps).map((p) => `${p.kind}:${p.key}`),
    ['month:2026-03', 'month:2026-02', 'month:2025-12', 'year:2026', 'year:2025']);
  assert.deepEqual(accountPeriodsOf([], deps), [], 'no play, no period — and so no section');
  assert.deepEqual(accountPeriodsOf(undefined, deps), []);
});

test('sessions count plays; games played counts distinct games by KEY', () => {
  const plays = [
    play('2026-03-05T20:00:00.000Z', 'Azul'),
    // The same game from another round under another local title: one game.
    { ...play('2026-03-06T20:00:00.000Z', 'Azul'), title: 'Azul (Box)' },
    play('2026-03-07T20:00:00.000Z', 'Brass'),
  ];
  const rec = accountRecap(plays, month('2026-03'), deps);
  assert.equal(rec.sessions, 3);
  assert.equal(rec.gamesPlayed, 2);
  assert.deepEqual(titles(rec.topPlayed.games), ['Azul'], 'the oldest play names the merged game');
  assert.equal(rec.topPlayed.count, 2);
});

test('Meistgespielt: ties share the row, alphabetically', () => {
  const plays = [
    play('2026-03-01T20:00:00.000Z', 'Zooloretto'),
    play('2026-03-02T20:00:00.000Z', 'Azul'),
    play('2026-03-03T20:00:00.000Z', 'Zooloretto'),
    play('2026-03-04T20:00:00.000Z', 'Azul'),
    play('2026-03-05T20:00:00.000Z', 'Brass'),
  ];
  const rec = accountRecap(plays, month('2026-03'), deps);
  assert.deepEqual(titles(rec.topPlayed.games), ['Azul', 'Zooloretto']);
  assert.equal(rec.topPlayed.count, 2);
});

test('Am besten bewertet: own mean, then plays in the period, then shared alphabetically', () => {
  const at = (d) => `2026-03-${String(d).padStart(2, '0')}T20:00:00.000Z`;
  // Brass: mean 5 over two plays. Azul: mean 5 over one. Catan: 4.
  let rec = accountRecap([
    play(at(1), 'Azul', 5), play(at(2), 'Brass', 5), play(at(3), 'Brass', 5), play(at(4), 'Catan', 4),
  ], month('2026-03'), deps);
  assert.deepEqual(titles(rec.topRated.games), ['Brass'], 'equal means: more plays wins');
  assert.equal(rec.topRated.rating, 5);

  // Equal means AND equal plays share the row.
  rec = accountRecap([play(at(1), 'Zooloretto', 4), play(at(2), 'Azul', 4)], month('2026-03'), deps);
  assert.deepEqual(titles(rec.topRated.games), ['Azul', 'Zooloretto']);

  // A MEAN, not the best single rating: 5 and 1 is 3, below a steady 4.
  rec = accountRecap([play(at(1), 'Azul', 5), play(at(2), 'Azul', 1), play(at(3), 'Brass', 4)], month('2026-03'), deps);
  assert.deepEqual(titles(rec.topRated.games), ['Brass']);

  // An unrated play does not count as a rating, and no rating at all is no tile.
  rec = accountRecap([play(at(1), 'Azul'), play(at(2), 'Brass')], month('2026-03'), deps);
  assert.equal(rec.topRated, null);
});

test('the rating bar is the PERIOD\'s: a February rating cannot crown a March game', () => {
  const rec = accountRecap([
    play('2026-02-10T20:00:00.000Z', 'Azul', 5),
    play('2026-03-10T20:00:00.000Z', 'Azul'),
  ], month('2026-03'), deps);
  assert.equal(rec.topRated, null);
});

test('Neu ausprobiert: only in the period of the account\'s FIRST-EVER play, across rounds', () => {
  const plays = [
    // Azul first in February — in one round …
    play('2026-02-10T20:00:00.000Z', 'Azul'),
    // … and again in March in ANOTHER round (same key), which is not „new".
    play('2026-03-02T20:00:00.000Z', 'Azul'),
    play('2026-03-05T20:00:00.000Z', 'Brass'),
    play('2026-03-06T20:00:00.000Z', 'Brass'),
  ];
  assert.deepEqual(titles(accountRecap(plays, month('2026-02'), deps).newGames), ['Azul']);
  assert.deepEqual(titles(accountRecap(plays, month('2026-03'), deps).newGames), ['Brass'],
    'Brass once, although it was played twice in its first month');
  assert.deepEqual(titles(accountRecap(plays, year('2026'), deps).newGames), ['Azul', 'Brass']);
});

test('the first play is found by TIME, not by the list\'s order', () => {
  const plays = [
    play('2026-03-02T20:00:00.000Z', 'Azul'),
    play('2026-02-10T20:00:00.000Z', 'Azul'), // earlier, but later in the list
  ];
  assert.deepEqual(accountRecap(plays, month('2026-03'), deps).newGames, []);
  assert.deepEqual(titles(accountRecap(plays, month('2026-02'), deps).newGames), ['Azul']);
});

test('a year sums its months', () => {
  const plays = [
    play('2026-02-10T20:00:00.000Z', 'Azul'),
    play('2026-03-02T20:00:00.000Z', 'Azul'),
    play('2025-11-02T20:00:00.000Z', 'Brass'),
  ];
  const rec = accountRecap(plays, year('2026'), deps);
  assert.equal(rec.sessions, 2);
  assert.equal(rec.gamesPlayed, 1);
  assert.deepEqual(titles(rec.topPlayed.games), ['Azul']);
});

test('the model carries no competition figure at all', () => {
  const rec = accountRecap([play('2026-03-02T20:00:00.000Z', 'Azul', 5)], month('2026-03'), deps);
  assert.deepEqual(Object.keys(rec).sort(), ['gamesPlayed', 'newGames', 'sessions', 'topPlayed', 'topRated']);
});
