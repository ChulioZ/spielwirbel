'use strict';

/* The one resolver every screen uses to turn a session's ids into people
   (#458). Every id in `votes` and `winnerIds` is looked up through it, so a bug
   here shows up as a *missing* name rather than an error — which is exactly the
   class of defect that ships. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// personLabel() reads t() from the shared frontend scope; stub it before the
// module is required so the test can assert the exact key and params, rather
// than a translation it would then have to keep in sync.
global.t = (key, params) => `${key}:${JSON.stringify(params || {})}`;

const { MAX_SESSION_GUESTS, GUEST_NAME_MAX, sessionPeople, personLabel } = require('../public/js/session-people');

const round = {
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bob' },
    { id: 'm3', name: 'Cleo' },
  ],
};

test('members who joined come first, then the session guests', () => {
  const people = sessionPeople(round, {
    memberIds: ['m1', 'm3'],
    guests: [{ id: 'g1', name: 'Dana' }],
  });
  assert.deepEqual(people, [
    { id: 'm1', name: 'Alice', guest: false },
    { id: 'm3', name: 'Cleo', guest: false },
    { id: 'g1', name: 'Dana', guest: true },
  ]);
});

// The two absent-key conventions in one session blob are NOT the same, and
// collapsing either one is a silent behaviour change.
test('absent memberIds means everyone; absent guests means none', () => {
  const everyone = sessionPeople(round, {});
  assert.deepEqual(everyone.map((p) => p.id), ['m1', 'm2', 'm3']);
  assert.ok(everyone.every((p) => p.guest === false));
});

test('an empty guests array reads exactly like an absent one', () => {
  const withKey = sessionPeople(round, { memberIds: ['m1'], guests: [] });
  const without = sessionPeople(round, { memberIds: ['m1'] });
  assert.deepEqual(withKey, without);
});

// A member removed from the round after the session was played leaves their id
// in memberIds/votes with no row behind it. Dropping them is the pre-existing
// behaviour of every call site; keep it.
test('a member id with no row behind it is dropped', () => {
  const people = sessionPeople(round, { memberIds: ['m1', 'gone'] });
  assert.deepEqual(people.map((p) => p.id), ['m1']);
});

test('personLabel marks a guest and leaves a member name bare', () => {
  assert.equal(personLabel({ id: 'm1', name: 'Alice', guest: false }), 'Alice');
  assert.equal(personLabel({ id: 'g1', name: 'Dana', guest: true }), 'people.guest:{"name":"Dana"}');
});

// Every winner-name site maps over winnerIds and resolves each against the
// session's people; an id that no longer matches anyone yields undefined, and
// the '' keeps `.filter(Boolean)` dropping it instead of rendering "undefined".
test('personLabel answers an empty string for a missing person', () => {
  assert.equal(personLabel(undefined), '');
  assert.equal(personLabel(null), '');
});

// Both are shared with routes/sessions.js (which requires this file) and with
// the setup screen's own input, so they have to stay usable as plain numbers.
test('the guest cap and name limit are positive integers', () => {
  assert.ok(Number.isInteger(MAX_SESSION_GUESTS) && MAX_SESSION_GUESTS > 0);
  assert.ok(Number.isInteger(GUEST_NAME_MAX) && GUEST_NAME_MAX > 0);
});
