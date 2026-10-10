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
  localTimeKey, isFuturePlayedOn, isDateOnlySession, requestedDateOnly,
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
  // A day that does not exist is refused rather than rolled into March (Date.parse
  // alone accepts 2026-02-30 and answers 2 March) — with or without an offset.
  assert.equal(normalizePlayedOn('2026-02-30T20:00:00Z', now), null, 'no 30 February');
  assert.equal(normalizePlayedOn('2026-04-31T20:00:00+02:00', now), null, 'no 31 April');
  assert.ok(normalizePlayedOn('2024-02-29T20:00:00Z', now), 'a real leap day is fine');
  for (const bad of ['2026-03-01', '2026-03-01T20:00:00', '1', 'March 3', '', null, 42, {}]) {
    assert.equal(normalizePlayedOn(bad, now), null, `refuses ${JSON.stringify(bad)}`);
  }
});

// ---- The optional time (#1629) ----

test('a picked day WITH a time is stored at that local time, not at 20:00', () => {
  const now = new Date(2026, 9, 9, 12);
  const iso = playedOnInstant('2026-03-01', now, '18:45');
  const d = new Date(iso);
  assert.equal(localDayKey(d), '2026-03-01');
  assert.equal(localTimeKey(d), '18:45');
  // An early-morning time is still THAT day, in a zone where it is the next day in UTC.
  assert.equal(localDayKey(new Date(playedOnInstant('2026-03-01', now, '23:30'))), '2026-03-01');
  assert.equal(localTimeKey(new Date(playedOnInstant('2026-03-01', now, '00:05'))), '00:05');
});

test('an empty time is the 20:00 stand-in — the #1616 behaviour, unchanged', () => {
  const now = new Date(2026, 9, 9, 12);
  assert.equal(playedOnInstant('2026-03-01', now, ''), playedOnInstant('2026-03-01', now));
  assert.equal(new Date(playedOnInstant('2026-03-01', now, '')).getHours(), 20);
});

test('a time that is not a time is refused, like an impossible day', () => {
  const now = new Date(2026, 9, 9, 12);
  for (const bad of ['24:00', '7:30', '12:60', 'noon', '12:30:00']) {
    assert.equal(playedOnInstant('2026-03-01', now, bad), null, `refuses ${bad}`);
  }
});

test('a time that does not exist on a DST change day is refused, not moved', () => {
  // Spring forward in this zone: 2026-03-08 02:00 -> 03:00. `new Date` would
  // quietly store 02:30 as 03:30, i.e. a time nobody entered.
  const now = new Date(2026, 9, 9, 12);
  assert.equal(playedOnInstant('2026-03-08', now, '02:30'), null);
  assert.equal(localTimeKey(new Date(playedOnInstant('2026-03-08', now, '03:30'))), '03:30');
  assert.equal(localTimeKey(new Date(playedOnInstant('2026-03-08', now, '01:59'))), '01:59');
});

test('only a TYPED time can lie in the future — and it is reported, not capped', () => {
  const now = new Date(2026, 9, 9, 15, 30);
  assert.equal(isFuturePlayedOn('2026-10-09', '16:00', now), true, 'later today');
  assert.equal(isFuturePlayedOn('2026-10-09', '15:00', now), false, 'earlier today');
  assert.equal(isFuturePlayedOn('2026-10-08', '23:59', now), false, 'any time yesterday');
  assert.equal(isFuturePlayedOn('2026-10-09', '', now), false, 'the stand-in is capped instead');
  // The stand-in IS capped: today at 20:00 while it is 15:30 becomes now.
  assert.equal(playedOnInstant('2026-10-09', now), now.toISOString());
});

test('a stored dateOnly wins in BOTH directions; without one the log decides', () => {
  const logged = [{ type: 'logged', at: 'x' }];
  const redated = [{ type: 'started', at: 'x' }, { type: 'redated', at: 'y' }];
  // The marker beats the log either way — a timed re-date of a logged session is
  // still in its log as `logged`, and must show its time.
  assert.equal(isDateOnlySession({ dateOnly: false, events: logged }), false);
  assert.equal(isDateOnlySession({ dateOnly: true, events: [] }), true);
  // No marker: a hand-dated session from before #1629 is date-only…
  assert.equal(isDateOnlySession({ events: logged }), true);
  assert.equal(isDateOnlySession({ events: redated }), true);
  // …and an app-stamped one is not.
  assert.equal(isDateOnlySession({ events: [{ type: 'started' }, { type: 'finished' }] }), false);
  assert.equal(isDateOnlySession({}), false);
  assert.equal(isDateOnlySession(null), false);
  // A summary row carries the boolean or nothing.
  assert.equal(isDateOnlySession({ at: 'x', dateOnly: true }), true);
  assert.equal(isDateOnlySession({ at: 'x' }), false);
  // A malformed log is no log, rather than a crash in the home summary.
  assert.equal(isDateOnlySession({ events: { type: 'logged' } }), false);
  // A non-boolean marker is no marker.
  assert.equal(isDateOnlySession({ dateOnly: 'false', events: logged }), true);
});

test('a request says „a time was entered" only with an explicit false', () => {
  assert.equal(requestedDateOnly(false), false);
  for (const v of [true, undefined, null, 'false', 0]) {
    assert.equal(requestedDateOnly(v), true, `${JSON.stringify(v)} reads as date-only`);
  }
});
