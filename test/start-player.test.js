'use strict';

/* „Wer fängt an?" (#1769) — the pure half: who may be drawn, the draw itself
 * (RNG injected, so every case is seeded) and the whirl's step sequence. The
 * DOM half — the button on the result screen and in the direct-play sheet — is
 * test/start-player-view.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

global.t = (key) => key; // partyName reads t() at call time
const { sessionParties } = require('../public/js/session-people');
const {
  START_PLAYER_MIN_UNITS,
  canDrawStartPlayer,
  pickStartPlayer,
  startPlayerWhirl,
  whirlDelays,
  draftSession,
} = require('../public/js/start-player');

const round = {
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cem' }, { id: 'm4', name: 'Dana' }],
};

// A seeded RNG: always the same sequence for the same seed.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('a solo table offers no draw; two parties do', () => {
  assert.equal(START_PLAYER_MIN_UNITS, 2);
  assert.equal(canDrawStartPlayer([]), false);
  assert.equal(canDrawStartPlayer([{ id: 'm1' }]), false);
  assert.equal(canDrawStartPlayer([{ id: 'm1' }, { id: 'm2' }]), true);
  assert.equal(pickStartPlayer([{ id: 'm1' }], () => 0.5), null, 'nobody to choose between');
});

test('the draw maps the injected RNG onto one unit, covering every unit', () => {
  const units = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(pickStartPlayer(units, () => 0).id, 'a');
  assert.equal(pickStartPlayer(units, () => 0.34).id, 'b');
  assert.equal(pickStartPlayer(units, () => 0.999999).id, 'c');
  // An RNG that returns exactly 1 (out of contract) must not fall off the end.
  assert.equal(pickStartPlayer(units, () => 1).id, 'c');
  const rng = seeded(1769);
  const seen = new Map();
  for (let i = 0; i < 600; i++) {
    const id = pickStartPlayer(units, rng).id;
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  assert.deepEqual([...seen.keys()].sort(), ['a', 'b', 'c']);
  for (const n of seen.values()) assert.ok(n > 150, `roughly uniform, got ${n}/600`);
  // Same seed, same answers.
  const a = seeded(7); const b = seeded(7);
  for (let i = 0; i < 20; i++) assert.equal(pickStartPlayer(units, a), pickStartPlayer(units, b));
});

test('with teams the draw is over parties: a team is one unit, never one of its people', () => {
  const session = { memberIds: ['m1', 'm2', 'm3', 'm4'], teams: [{ id: 't1', personIds: ['m1', 'm2'] }] };
  const parties = sessionParties(round, session);
  assert.deepEqual(parties.map((p) => p.id), ['t1', 'm3', 'm4']);
  const drawn = new Set();
  const rng = seeded(3);
  for (let i = 0; i < 200; i++) drawn.add(pickStartPlayer(parties, rng).id);
  assert.deepEqual([...drawn].sort(), ['m3', 'm4', 't1']);
  assert.ok(!drawn.has('m1') && !drawn.has('m2'));
});

test('an automa is never a seat: it is not in the parties the draw is handed', () => {
  const session = { memberIds: ['m1', 'm2'], automa: { name: 'Automa (schwer)', points: 40 } };
  const ids = sessionParties(round, session).map((p) => p.id);
  assert.deepEqual(ids, ['m1', 'm2']);
});

test('the whirl laps the table and lands on the drawn index', () => {
  for (const [count, landing] of [[2, 0], [2, 1], [3, 2], [5, 3]]) {
    const seq = startPlayerWhirl(count, landing);
    assert.equal(seq[seq.length - 1], landing, `${count}/${landing}: lands on the answer`);
    assert.ok(seq.length >= 2 * count, 'at least two laps, so it reads as a spin');
    seq.forEach((idx, i) => {
      assert.ok(idx >= 0 && idx < count);
      if (i) assert.equal(idx, (seq[i - 1] + 1) % count, 'steps go round in order');
    });
  }
  assert.deepEqual(startPlayerWhirl(1, 0), [0]);
});

test('the whirl slows down and stays short', () => {
  const d = whirlDelays(12);
  assert.equal(d.length, 12);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1], 'never speeds up');
  assert.ok(d[d.length - 1] > d[0], 'it decelerates');
  const total = d.reduce((a, b) => a + b, 0);
  assert.ok(total <= 2500, `a short whirl, got ${total}ms`);
});

test('draftSession turns the live pickers into the shape sessionParties reads', () => {
  const s = draftSession(['m1', 'm2'], ['Eli', 'Fia'], [{ memberIds: ['m1'], guestIndices: [1], sharedSeat: true }]);
  const parties = sessionParties(round, s);
  assert.equal(parties.length, 3, 'one team + Ben + Eli');
  assert.equal(parties[0].team, true);
  assert.deepEqual(parties[0].people.map((p) => p.name), ['Anna', 'Fia']);
  assert.equal(parties.find((p) => !p.team && p.people[0].guest).people[0].name, 'Eli');
  // No guests, no teams: the draft carries neither key, like a stored session.
  const bare = draftSession(['m1'], [], []);
  assert.equal('guests' in bare, false);
  assert.equal('teams' in bare, false);
  assert.equal(sessionParties(round, bare).length, 1);
});
