'use strict';

/* The beat between a rating tap and the next card (#1168, vote-advance.js).

   Pure enough to `require()` — it takes its window in, so it is testable from
   Node with a two-property fake and stays out of the DOM views' coverage
   problem (`.claude/rules/frontend-helper-modules-and-coverage.md`).

   What is asserted here is the CONTRACT the two card renderers lean on: that
   `locked` is true for exactly the duration of a beat, that a second schedule
   during one is refused, and that a cancel really stops the callback. The
   renderers' own behaviour is in test/vote-tap-advances.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  VOTE_ADVANCE_MS,
  VOTE_ADVANCE_REDUCED_MS,
  VOTE_TAP_GUARD_MS,
  voteAdvanceMs,
  createVoteAdvance,
} = require('../public/js/vote-advance');

/** A window whose timers are hand-driven, so no test sleeps. */
function fakeWindow(reduced) {
  const timers = new Map();
  let next = 1;
  return {
    matchMedia: reduced === undefined ? undefined : (q) => ({
      matches: reduced && q.includes('reduced-motion'),
    }),
    setTimeout(fn, ms) { timers.set(next, { fn, ms }); return next++; },
    clearTimeout(id) { timers.delete(id); },
    /** Fire every timer due at or before `ms`, soonest first. Returns how many ran. */
    fire(ms = Infinity) {
      const due = [...timers.entries()].filter(([, v]) => v.ms <= ms)
        .sort((a, b) => a[1].ms - b[1].ms);
      due.forEach(([id]) => timers.delete(id));
      due.forEach(([, v]) => v.fn());
      return due.length;
    },
    get pending() { return timers.size; },
    get delays() { return [...timers.values()].map((v) => v.ms).sort((a, b) => a - b); },
  };
}

// ------------------------------------------------------------- the two beats

test('the beat is ~a third of a second, and shorter but never zero under reduced motion', () => {
  assert.equal(voteAdvanceMs(fakeWindow(false)), VOTE_ADVANCE_MS);
  assert.equal(voteAdvanceMs(fakeWindow(true)), VOTE_ADVANCE_REDUCED_MS);
  // The reduced beat exists so the chosen face is SEEN at its fill before the
  // swap — feedback, not motion. A zero would make the card jump in the same
  // frame as the choice was painted, i.e. it would never be acknowledged.
  assert.ok(VOTE_ADVANCE_REDUCED_MS > 0, 'a zero beat shows no selected state at all');
  assert.ok(VOTE_ADVANCE_REDUCED_MS < VOTE_ADVANCE_MS);
});

test('a browser with no matchMedia at all gets the full beat rather than a throw', () => {
  // An old browser, and bare jsdom. `undefined.matches` inside a click handler
  // on the app's central action is the failure this guard exists to prevent.
  assert.equal(voteAdvanceMs(fakeWindow(undefined)), VOTE_ADVANCE_MS);
  assert.equal(voteAdvanceMs({}), VOTE_ADVANCE_MS);
});

// ------------------------------------------------------------------ the lock

test('the card is delivered on the beat and the lock outlives it', () => {
  const win = fakeWindow(false);
  const advance = createVoteAdvance(win);
  assert.equal(advance.locked, false, 'a fresh flow is not locked');

  let ran = 0;
  assert.equal(advance.schedule(null, () => { ran += 1; }), true);
  assert.equal(advance.locked, true);
  assert.deepEqual(win.delays, [VOTE_ADVANCE_MS, VOTE_TAP_GUARD_MS]);

  win.fire(VOTE_ADVANCE_MS);
  assert.equal(ran, 1, 'the next card must arrive on the beat, not on the guard');
  assert.equal(advance.locked, true, 'taps are still unsafe right after the swap');

  win.fire();
  assert.equal(advance.locked, false);
});

/* The reason the guard is a SECOND number rather than the beat itself. Under
   reduced motion the beat is ~90ms, so the second tap of an ordinary double-tap
   lands after the card has already swapped — and would rate the following game,
   which is the feature's one hard constraint. Measured: the behaviour spec's
   double-tap case went red at exactly this, on the reduced-motion path only. */
test('reduced motion shortens the beat but NOT the window taps are ignored for', () => {
  const win = fakeWindow(true);
  const advance = createVoteAdvance(win);
  advance.schedule(null, () => {});
  assert.deepEqual(win.delays, [VOTE_ADVANCE_REDUCED_MS, VOTE_TAP_GUARD_MS]);

  win.fire(VOTE_ADVANCE_REDUCED_MS);
  assert.equal(advance.locked, true, 'a double-tap would reach the next game');
  assert.ok(VOTE_TAP_GUARD_MS >= 250, 'shorter than the platforms\' own double-tap thresholds');
});

test('a second schedule during a beat is refused — the double-tap guard', () => {
  const win = fakeWindow(false);
  const advance = createVoteAdvance(win);
  const fired = [];
  advance.schedule(null, () => fired.push('first'));
  // The tap 100ms later that must never rate the following game.
  assert.equal(advance.schedule(null, () => fired.push('second')), false);
  assert.equal(win.pending, 2, 'a third timer was armed — the beat and its guard are two');
  win.fire();
  assert.deepEqual(fired, ['first'], 'the blocked tap still reached its callback');

  // And it is still refused after the card has swapped but before the guard
  // expires — the whole point of the second timer.
  const win2 = fakeWindow(true);
  const a2 = createVoteAdvance(win2);
  a2.schedule(null, () => {});
  win2.fire(VOTE_ADVANCE_REDUCED_MS);
  assert.equal(a2.schedule(null, () => fired.push('late')), false);
});

test('cancel drops a pending advance without running it', () => {
  const win = fakeWindow(false);
  const advance = createVoteAdvance(win);
  let ran = 0;
  advance.schedule(null, () => { ran += 1; });
  advance.cancel();
  assert.equal(advance.locked, false);
  assert.equal(win.pending, 0, 'a timer was left armed — it will fire on a screen that moved on');
  assert.equal(win.fire(), 0);
  assert.equal(ran, 0);
});

test('cancel on an idle flow is a no-op, and a flow stays reusable after one', () => {
  const win = fakeWindow(false);
  const advance = createVoteAdvance(win);
  advance.cancel();
  let ran = 0;
  assert.equal(advance.schedule(null, () => { ran += 1; }), true, 'a cancelled flow must still advance later');
  win.fire();
  assert.equal(ran, 1);
});

test('a flow is reusable once the guard has expired', () => {
  // go() renders a fresh card whose handlers ask `locked`. A lock that never
  // cleared would leave that card permanently inert — the failure that turns
  // one dropped tap into a dead screen.
  const win = fakeWindow(false);
  const advance = createVoteAdvance(win);
  advance.schedule(null, () => {});
  win.fire();
  let ran = 0;
  assert.equal(advance.schedule(null, () => { ran += 1; }), true);
  win.fire();
  assert.equal(ran, 1);
});

test('scheduling marks the card it is holding', () => {
  const win = fakeWindow(false);
  const advance = createVoteAdvance(win);
  const classes = [];
  const card = { classList: { add: (c) => classes.push(c) } };
  advance.schedule(card, () => {});
  assert.deepEqual(classes, ['vote--advancing'],
    'without the class the outgoing card still takes pointer events');
});
