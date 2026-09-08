'use strict';

/* The owner validation + per-seat preset shared by the two write paths (#971).
 *
 * Unit tests rather than HTTP ones, because the interesting half — which seat a
 * preset lands on — needs an account linked to a member, which the ordinary
 * suite's app has no accounts for. Both routes' HTTP behaviour is covered in
 * test/games.test.js and test/lookup.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveOwnerIds, rememberOwnerPreset } = require('../lib/game-owners');

const round = {
  members: [
    { id: 'm1', name: 'Anna', userId: 'u-anna' },
    { id: 'm2', name: 'Ben' },
  ],
};

test('resolveOwnerIds accepts seats of THIS round and dedupes them', () => {
  assert.deepEqual(resolveOwnerIds(['m1', 'm2', 'm1'], round), ['m1', 'm2']);
  assert.deepEqual(resolveOwnerIds('m2', round), ['m2'], 'one multipart value arrives bare');
});

test('resolveOwnerIds returns null for an id that is not a seat', () => {
  assert.equal(resolveOwnerIds(['m1', 'stranger'], round), null);
  assert.equal(resolveOwnerIds(['m3'], round), null);
});

test('resolveOwnerIds reads absent, null and empty as "no owners"', () => {
  assert.deepEqual(resolveOwnerIds(undefined, round), []);
  assert.deepEqual(resolveOwnerIds(null, round), []);
  assert.deepEqual(resolveOwnerIds([], round), []);
  assert.deepEqual(resolveOwnerIds([], { }), [], 'a round with no members list is not a crash');
});

// A fake repo: the preset write is one call, and what matters is WHICH seat it
// lands on and whether it happens at all.
function fakeRepo() {
  const calls = [];
  return { calls, updateMember: async (...args) => { calls.push(args); return {}; } };
}

test('the preset is written on the CALLER\'s own seat', async () => {
  const repo = fakeRepo();
  await rememberOwnerPreset(repo, round, 'r1', 'u-anna', ['m1', 'm2']);
  assert.deepEqual(repo.calls, [['r1', 'm1', { ownerPreset: ['m1', 'm2'] }]]);
});

// "I took myself off the list" has to survive to the next add, so the empty
// selection is a value and not a reason to skip the write.
test('an EMPTY selection is remembered, not skipped', async () => {
  const repo = fakeRepo();
  await rememberOwnerPreset(repo, round, 'r1', 'u-anna', []);
  assert.deepEqual(repo.calls[0][2], { ownerPreset: [] });
});

test('a caller with no seat, and an anonymous caller, write nothing', async () => {
  const noSeat = fakeRepo();
  await rememberOwnerPreset(noSeat, round, 'r1', 'u-someone-else', ['m1']);
  assert.deepEqual(noSeat.calls, [], 'a grantee has no seat to remember on');

  const anon = fakeRepo();
  await rememberOwnerPreset(anon, round, 'r1', null, ['m1']);
  assert.deepEqual(anon.calls, [], 'accounts off -> no per-user memory');
});

// The games already exist by the time this runs, so a failed preference write
// must not turn a successful add into a 500.
test('a repo failure is swallowed — the add has already succeeded', async () => {
  const repo = { updateMember: async () => { throw new Error('db is on fire'); } };
  await rememberOwnerPreset(repo, round, 'r1', 'u-anna', ['m1']);
});
