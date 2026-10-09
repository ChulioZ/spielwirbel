'use strict';

/*
 * The day a session was played (#1616, public/js/played-on.js).
 *
 * Runs in a zone WEST of UTC on purpose: the whole reason a picked day is
 * stored as 20:00 local is that midnight UTC lands on the previous local day
 * here, so a spec run in UTC could not tell the two apart
 * (.claude/rules/server-computed-calendar-periods.md §4).
 */

process.env.TZ = 'America/Los_Angeles';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PLAYED_ON_MIN, localDayKey, isPastDay, playedOnInstant, normalizePlayedOn,
} = require('../public/js/played-on');
const { periodKeyOf } = require('../public/js/period-recap');

test('the zone really is west of UTC — otherwise every spec below is vacuous', () => {
  assert.equal(new Date('2026-03-01T00:00:00Z').getDate(), 28);
});

test('a picked day is stored at 20:00 on THAT local day', () => {
  const now = new Date(2026, 9, 9, 12);
  const iso = playedOnInstant('2026-03-01', now);
  const back = new Date(iso);
  assert.equal(localDayKey(back), '2026-03-01');
  assert.equal(back.getHours(), 20);
});

test('the 1st of a month counts in THAT month of the recap, in a non-UTC zone', () => {
  const now = new Date(2026, 9, 9, 12);
  assert.equal(periodKeyOf(playedOnInstant('2026-03-01', now)).month, '2026-03');
  // The control: the naive midnight-UTC form lands in February here.
  assert.equal(periodKeyOf('2026-03-01T00:00:00Z').month, '2026-02');
});

test('today is capped at now, so it is never a future instant', () => {
  const now = new Date(2026, 9, 9, 15, 30);
  assert.equal(playedOnInstant('2026-10-09', now), now.toISOString());
  // …and an evening already past 20:00 keeps the 20:00 stamp.
  const late = new Date(2026, 9, 9, 22);
  assert.equal(new Date(playedOnInstant('2026-10-09', late)).getHours(), 20);
});

test('a day that does not exist is refused rather than rolled over', () => {
  assert.equal(playedOnInstant('2026-02-31'), null);
  assert.equal(playedOnInstant('2026-13-01'), null);
  assert.equal(playedOnInstant('yesterday'), null);
  assert.equal(playedOnInstant(''), null);
  assert.equal(playedOnInstant(undefined), null);
});

test('isPastDay compares local calendar days', () => {
  const now = new Date(2026, 9, 9, 1);
  assert.equal(isPastDay('2026-10-08', now), true);
  assert.equal(isPastDay('2026-10-09', now), false);
  assert.equal(isPastDay('2026-10-10', now), false);
  assert.equal(isPastDay(null, now), false);
});

test('the server accepts a zoned ISO instant and normalises it', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  assert.equal(normalizePlayedOn('2026-03-01T20:00:00-08:00', now), '2026-03-02T04:00:00.000Z');
  assert.equal(normalizePlayedOn('2026-03-02T04:00:00.000Z', now), '2026-03-02T04:00:00.000Z');
});

test('the server refuses the future, the pre-2000 past and anything not a zoned instant', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  assert.equal(normalizePlayedOn('2026-10-10T12:00:00Z', now), null, 'a day ahead');
  assert.equal(normalizePlayedOn('2026-10-09T12:05:00Z', now), '2026-10-09T12:05:00.000Z', 'clock skew is tolerated');
  assert.equal(normalizePlayedOn('2026-10-09T12:30:00Z', now), null, 'past the skew');
  assert.equal(normalizePlayedOn('1999-12-31T20:00:00Z', now), null, 'before PLAYED_ON_MIN');
  assert.ok(normalizePlayedOn(`${PLAYED_ON_MIN}T20:00:00Z`, now), 'PLAYED_ON_MIN itself is fine');
  for (const bad of ['2026-03-01', '2026-03-01T20:00:00', '1', 'March 3', '', null, 42, {}]) {
    assert.equal(normalizePlayedOn(bad, now), null, `refuses ${JSON.stringify(bad)}`);
  }
});
