'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { periodBoundaries, localMidnight, ZONE } = require('../lib/calendar-periods');

/*
 * Every expectation here is a LITERAL UTC instant worked out from Berlin's own
 * offsets (CET = UTC+1, CEST = UTC+2; 2026 switches on 03-29 and 10-25), never
 * re-derived from the module. A spec that computed the answer the same way the
 * implementation does would agree with any implementation, including the
 * rolling-window one this replaced (#964).
 */
test('periodBoundaries resolves calendar periods on the Europe/Berlin clock', async (t) => {
  assert.equal(ZONE, 'Europe/Berlin');

  await t.test('a mid-period summer instant: Monday, the 1st, and January 1st', () => {
    // Berlin: Monday 2026-09-07, 12:00 CEST.
    const b = periodBoundaries('2026-09-07T10:00:00.000Z');
    assert.equal(b.week, '2026-09-06T22:00:00.000Z', 'Monday 00:00 CEST');
    assert.equal(b.month, '2026-08-31T22:00:00.000Z', 'the 1st, 00:00 CEST');
    // The year boundary sits in WINTER even though `now` is in summer — the one
    // an offset taken at `now` and reused would get wrong by an hour.
    assert.equal(b.year, '2025-12-31T23:00:00.000Z', 'January 1st, 00:00 CET');
    assert.equal(b.monthKey, '2026-09');
    assert.equal(b.yearKey, '2026');
  });

  await t.test('a Sunday belongs to the week that began the previous Monday', () => {
    // Berlin: Sunday 2026-09-13, 23:30 CEST.
    const b = periodBoundaries('2026-09-13T21:30:00.000Z');
    assert.equal(b.week, '2026-09-06T22:00:00.000Z', 'ISO weeks start on Monday, not Sunday');
  });

  await t.test('the LOCAL calendar decides, not the UTC one', () => {
    /* 22:30 UTC on Sunday the 13th is already 00:30 on MONDAY the 14th in
       Berlin, so this instant opens a new week. Reading the weekday off the UTC
       date would put it in the old one — and the same instant is what separates
       a month boundary from the last half-hour of the previous month. */
    const b = periodBoundaries('2026-09-13T22:30:00.000Z');
    assert.equal(b.week, '2026-09-13T22:00:00.000Z', 'Monday the 14th, 00:00 CEST');
    assert.equal(b.monthKey, '2026-09');
  });

  await t.test('the New Year arrives in Berlin before it arrives in UTC', () => {
    // 23:30 UTC on 2025-12-31 is 00:30 on 2026-01-01 in Berlin.
    const b = periodBoundaries('2025-12-31T23:30:00.000Z');
    assert.equal(b.yearKey, '2026', 'the reader is already in the new year');
    assert.equal(b.year, '2025-12-31T23:00:00.000Z');
    assert.equal(b.month, '2025-12-31T23:00:00.000Z', 'January 1st is also the month boundary');
    assert.equal(b.week, '2025-12-28T23:00:00.000Z', 'the week began on Monday 2025-12-29');
  });

  /* The two 2026 transitions. These are the cases a "midnight minus N × 24h"
     boundary gets wrong, in OPPOSITE directions — the spring one asks for a
     CET boundary from a CEST instant, the autumn one the reverse. */
  await t.test('spring forward: boundaries before the switch stay on CET', () => {
    // Berlin: Sunday 2026-03-29, 14:00 CEST — the clocks went forward at 02:00.
    const b = periodBoundaries('2026-03-29T12:00:00.000Z');
    assert.equal(b.week, '2026-03-22T23:00:00.000Z', 'Monday the 23rd, 00:00 CET');
    assert.equal(b.month, '2026-02-28T23:00:00.000Z', 'March 1st, 00:00 CET');
    assert.equal(b.year, '2025-12-31T23:00:00.000Z');
    assert.equal(b.monthKey, '2026-03');
  });

  await t.test('fall back: boundaries before the switch stay on CEST', () => {
    // Berlin: Sunday 2026-10-25, 13:00 CET — the clocks went back at 03:00.
    const b = periodBoundaries('2026-10-25T12:00:00.000Z');
    assert.equal(b.week, '2026-10-18T22:00:00.000Z', 'Monday the 19th, 00:00 CEST');
    assert.equal(b.month, '2026-09-30T22:00:00.000Z', 'October 1st, 00:00 CEST');
    assert.equal(b.monthKey, '2026-10');
  });

  await t.test('the 23- and 25-hour days are themselves whole days', () => {
    /* Asked from INSIDE each transition day, the week that started on it (both
       are Sundays, so the week started six days earlier) and the day's own
       month must still resolve — the arithmetic never divides by 86400000. */
    const spring = periodBoundaries('2026-03-29T00:30:00.000Z'); // 01:30 CET, pre-switch
    assert.equal(spring.monthKey, '2026-03');
    assert.equal(spring.week, '2026-03-22T23:00:00.000Z');
    const autumn = periodBoundaries('2026-10-25T00:30:00.000Z'); // 02:30 CEST, pre-switch
    assert.equal(autumn.monthKey, '2026-10');
    assert.equal(autumn.week, '2026-10-18T22:00:00.000Z');
  });

  await t.test('a week reaching back over a month boundary', () => {
    // Berlin: Wednesday 2026-04-01 — the week began on Monday 2026-03-30.
    const b = periodBoundaries('2026-04-01T09:00:00.000Z');
    assert.equal(b.week, '2026-03-29T22:00:00.000Z', 'Monday the 30th, 00:00 CEST');
    assert.equal(b.month, '2026-03-31T22:00:00.000Z', 'April 1st, 00:00 CEST');
  });

  await t.test('an unparseable `now` falls back to the current instant', () => {
    const b = periodBoundaries('not a date');
    // Can't pin a literal, so pin the invariants: three real boundaries, all in
    // the past, correctly ordered.
    assert.ok(b.week > b.month || b.week === b.month);
    assert.ok(b.month >= b.year);
    assert.ok(Date.parse(b.year) <= Date.now());
    assert.match(b.monthKey, /^\d{4}-\d{2}$/);
  });
});

/*
 * `localMidnight`'s DST correction, pinned where it is REACHABLE.
 *
 * It is dead weight at Berlin's offset — measured: with the second offset pass
 * deleted, every case above stayed green — so testing it through
 * periodBoundaries is impossible, and shipping it untested would leave the
 * module correct only by an argument about one zone. Pacific/Auckland is
 * UTC+12/+13, so the naive 00:00 UTC guess lands at 12:00–13:00 local and a
 * 02:00 transition genuinely falls between it and the midnight being sought.
 */
test('localMidnight resolves a date whose midnight sits across a transition', () => {
  /* New Zealand DST 2026 begins 02:00 NZST on Sunday 2026-09-27, so that date's
     local midnight is still NZST (UTC+12) = 2026-09-26T12:00Z — while 00:00 UTC
     on the 27th is already 13:00 NZDT (UTC+13). A single-pass offset reads +13
     and answers 11:00Z, an hour early. */
  assert.equal(new Date(localMidnight('Pacific/Auckland', 2026, 9, 27)).toISOString(),
    '2026-09-26T12:00:00.000Z', 'midnight is NZST; the guess lands in NZDT');

  // The mirror: DST ends 03:00 NZDT on 2026-04-05, so that midnight is NZDT
  // (+13) while 00:00 UTC on the 5th is 12:00 NZST (+12) — the opposite sign.
  assert.equal(new Date(localMidnight('Pacific/Auckland', 2026, 4, 5)).toISOString(),
    '2026-04-04T11:00:00.000Z', 'midnight is NZDT; the guess lands in NZST');

  // A date nowhere near a transition, so the two passes agree — the control.
  assert.equal(new Date(localMidnight('Pacific/Auckland', 2026, 6, 15)).toISOString(),
    '2026-06-14T12:00:00.000Z');
});
