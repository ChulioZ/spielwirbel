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

const {
  MAX_SESSION_GUESTS,
  GUEST_NAME_MAX,
  MIN_TEAM_SIZE,
  sessionPeople,
  personLabel,
  partyName,
  sessionTeams,
  sessionParties,
} = require('../public/js/session-people');

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

/* ------------------------------- Teams (#575) ------------------------------ */

const teamed = {
  memberIds: ['m1', 'm2', 'm3'],
  guests: [{ id: 'g1', name: 'Dana' }, { id: 'g2', name: 'Eli' }],
  teams: [
    { id: 't1', personIds: ['m1', 'g1'] },
    { id: 't2', personIds: ['m2', 'g2'] },
  ],
};

test('a team resolves to its people, in the order it was stored', () => {
  const teams = sessionTeams(round, teamed);
  assert.deepEqual(teams.map((tm) => tm.id), ['t1', 't2']);
  assert.deepEqual(teams[0].personIds, ['m1', 'g1']);
  assert.deepEqual(teams[0].people.map((p) => p.name), ['Alice', 'Dana']);
});

// The derived name is the whole naming story — teams are never named by hand —
// so it has to mark a guest exactly like every other surface does.
test('a team name joins its people and keeps the guest marker', () => {
  const [first] = sessionTeams(round, teamed);
  assert.equal(first.name, 'Alice list.and:{} people.guest:{"name":"Dana"}');
  assert.equal(partyName([{ id: 'm1', name: 'Alice', guest: false }]), 'Alice');
  assert.equal(partyName([]), '');
});

test('absent teams reads exactly like an empty array', () => {
  const without = sessionParties(round, { memberIds: ['m1', 'm2'] });
  const empty = sessionParties(round, { memberIds: ['m1', 'm2'], teams: [] });
  assert.deepEqual(without, empty);
  assert.deepEqual(without.map((p) => p.id), ['m1', 'm2']);
  assert.ok(without.every((p) => p.team === false));
});

// A member removed from the round after the session was played shrinks their
// team. Once it is down to one person it is no longer a team: rendering it as
// one would offer that person twice on the winner picker — once inside the
// "team" and once as themselves.
test('a team shrinks with its people and is dropped below the minimum', () => {
  const shrunk = sessionTeams(round, {
    memberIds: ['m1', 'm2'],
    teams: [{ id: 't1', personIds: ['m1', 'gone'] }],
  });
  assert.deepEqual(shrunk, []);
  assert.equal(MIN_TEAM_SIZE, 2);
});

// The stored blob is the one thing a hand-crafted request can shape freely, so
// the resolver — not just the route — has to keep the parties a partition.
test('a person claimed by two teams stays in the first one only', () => {
  const teams = sessionTeams(round, {
    memberIds: ['m1', 'm2', 'm3'],
    teams: [
      { id: 't1', personIds: ['m1', 'm2'] },
      { id: 't2', personIds: ['m2', 'm3'] },
    ],
  });
  // The second team keeps only m3, which is below the minimum, so it is gone.
  assert.deepEqual(teams.map((tm) => tm.personIds), [['m1', 'm2']]);
});

// The winner picker iterates parties, so a person in a team must appear exactly
// once — inside their team and never again on their own.
test('parties are one entry per team plus one per un-teamed person', () => {
  const parties = sessionParties(round, teamed);
  assert.deepEqual(parties.map((p) => p.id), ['t1', 't2', 'm3']);
  assert.deepEqual(parties.map((p) => p.team), [true, true, false]);
  assert.deepEqual(parties.map((p) => p.people.length), [2, 2, 1]);
  // Every participant is in exactly one party.
  const seen = parties.flatMap((p) => p.people.map((x) => x.id));
  assert.deepEqual(seen.sort(), ['g1', 'g2', 'm1', 'm2', 'm3']);
});

// A team dropped for being too small must hand its people back as solo parties
// rather than swallowing them.
test('the people of a dropped team play on their own', () => {
  const parties = sessionParties(round, {
    memberIds: ['m1', 'm2'],
    teams: [{ id: 't1', personIds: ['m1'] }],
  });
  assert.deepEqual(parties.map((p) => p.id), ['m1', 'm2']);
  assert.ok(parties.every((p) => p.team === false));
});

// The ORDER of the two rules above decides this, and only a dropped team
// followed by a valid one that wants the same person can see it: claiming before
// the size check lets a team that is about to be discarded take its people out
// of the next one, so BOTH teams vanish and m1/m2 silently stop being a party.
test('a team dropped for being too small does not claim its people', () => {
  const teams = sessionTeams(round, {
    memberIds: ['m1', 'm2'],
    teams: [
      { id: 't1', personIds: ['m1', 'gone'] }, // resolves to one person -> dropped
      { id: 't2', personIds: ['m1', 'm2'] }, // must still get m1
    ],
  });
  assert.deepEqual(teams.map((tm) => tm.id), ['t2']);
  assert.deepEqual(teams[0].personIds, ['m1', 'm2']);
});
