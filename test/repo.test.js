'use strict';

/*
 * Unit tests for the data-access layer (lib/repo.js, issue #127). These drive the
 * repo API directly (no HTTP) and pin the contract a future PostgreSQL backend
 * must also satisfy — especially that reads return isolated SNAPSHOTS, not live
 * references into the store.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// helpers.js points DATA_DIR at a fresh temp dir before the store loads.
require('./helpers');
const repo = require('../lib/repo');

async function freshRound(over = {}) {
  return repo.createRound({ name: 'R', members: ['Alice', 'Bob'], importFromRoundId: null, ...over });
}

test('createRound mints ids and getRound round-trips it', async () => {
  const created = await repo.createRound({ name: 'Spielrunde', members: ['Ann', 'Bo'] });
  assert.match(created.id, /^[0-9a-f]{16}$/);
  assert.equal(created.members.length, 2);
  assert.ok(created.members.every((m) => /^[0-9a-f]{16}$/.test(m.id)));
  assert.deepEqual(created.games, []);
  assert.equal(created.background, null);

  const fetched = await repo.getRound(created.id);
  assert.deepEqual(fetched, created);
});

test('getRound returns a snapshot: mutating it does not change the store', async () => {
  const round = await freshRound();
  const snap = await repo.getRound(round.id);
  snap.name = 'HACKED';
  snap.members.push({ id: 'x', name: 'Injected' });

  const again = await repo.getRound(round.id);
  assert.equal(again.name, 'R');
  assert.equal(again.members.length, 2);
});

test('getRound returns null for a missing round; deleteRound reports found/again', async () => {
  assert.equal(await repo.getRound('nope'), null);
  const round = await freshRound();
  assert.equal(await repo.deleteRound(round.id), true);
  assert.equal(await repo.deleteRound(round.id), false);
  assert.equal(await repo.getRound(round.id), null);
});

test('createRound import copies only active games (title/type/image) + logs them', async () => {
  const src = await freshRound();
  const active = await repo.createGame(src.id, {
    title: 'Catan', platform: 'analog', type: 'analog', duration: 'medium',
    minPlayers: 3, maxPlayers: 4, image: '/uploads/a.jpg', source: null,
  });
  const retired = await repo.createGame(src.id, {
    title: 'Old', platform: 'analog', type: 'analog', duration: 'short',
    minPlayers: 2, maxPlayers: 2, image: null, source: null,
  });
  await repo.retireGame(src.id, retired.id, true);

  const copy = await repo.createRound({ name: 'Copy', members: ['Z'], importFromRoundId: src.id });
  assert.equal(copy.games.length, 1);
  const g = copy.games[0];
  assert.equal(g.title, 'Catan');
  assert.equal(g.type, 'analog');
  assert.equal(g.image, '/uploads/a.jpg');
  assert.equal(g.retired, false);
  assert.notEqual(g.id, active.id); // a fresh id, not the source game's
  // duration/players are intentionally NOT carried over by import.
  assert.equal(g.duration, undefined);
  assert.equal(copy.activities.filter((a) => a.type === 'game_added').length, 1);
});

test('updateGame applies only the given patch; unknown round/game -> null', async () => {
  const round = await freshRound();
  const game = await repo.createGame(round.id, {
    title: 'A', platform: 'ps', type: 'digital', duration: 'long',
    minPlayers: 1, maxPlayers: 4, image: null, source: null,
  });
  const updated = await repo.updateGame(round.id, game.id, { title: 'B', duration: 'short' });
  assert.equal(updated.title, 'B');
  assert.equal(updated.duration, 'short');
  assert.equal(updated.platform, 'ps'); // untouched
  assert.equal(await repo.updateGame(round.id, 'missing', { title: 'X' }), null);
  assert.equal(await repo.updateGame('missing', game.id, { title: 'X' }), null);
});

test('deleteGame refuses active games, scrubs retired ones from sessions', async () => {
  const round = await freshRound();
  const game = await repo.createGame(round.id, {
    title: 'A', platform: 'analog', type: 'analog', duration: 'medium',
    minPlayers: 1, maxPlayers: 4, image: '/uploads/x.png', source: null,
  });
  const keep = await repo.createGame(round.id, {
    title: 'B', platform: 'analog', type: 'analog', duration: 'medium',
    minPlayers: 1, maxPlayers: 4, image: null, source: null,
  });
  const session = await repo.createSession(round.id, {
    createdAt: 't', gameIds: [game.id, keep.id], votes: { m1: { [game.id]: { rating: 5 } } },
    chosenGameId: game.id, chosenAt: 't', finished: true, finishedAt: 't', winnerIds: ['m1'],
    cancelled: false, cancelledAt: null, done: true,
  });

  assert.equal(await repo.deleteGame(round.id, game.id), 'not_retired');
  await repo.retireGame(round.id, game.id, true);
  const result = await repo.deleteGame(round.id, game.id);
  assert.deepEqual(result, { image: '/uploads/x.png' });

  const after = await repo.getRound(round.id);
  assert.equal(after.games.length, 1);
  const s = after.sessions.find((x) => x.id === session.id);
  assert.deepEqual(s.gameIds, [keep.id]); // scrubbed
  assert.equal(s.chosenGameId, null); // reset because the chosen game was deleted
  assert.equal(s.votes.m1[game.id], undefined);
  assert.ok(after.activities.some((a) => a.type === 'game_deleted'));
  assert.equal(await repo.deleteGame(round.id, 'gone'), null);
});

test('isImageReferenced sees images across rounds', async () => {
  const round = await freshRound();
  await repo.createGame(round.id, {
    title: 'A', platform: 'analog', type: 'analog', duration: 'medium',
    minPlayers: 1, maxPlayers: 4, image: '/uploads/shared.jpg', source: null,
  });
  assert.equal(await repo.isImageReferenced('/uploads/shared.jpg'), true);
  assert.equal(await repo.isImageReferenced('/uploads/none.jpg'), false);
});

test('session mutators persist through getRound', async () => {
  const round = await freshRound();
  const g = await repo.createGame(round.id, {
    title: 'A', platform: 'analog', type: 'analog', duration: 'medium',
    minPlayers: 1, maxPlayers: 4, image: null, source: null,
  });
  const session = await repo.createSession(round.id, {
    createdAt: 't', gameIds: [g.id], votes: {}, chosenGameId: null, chosenAt: null,
    finished: false, finishedAt: null, winnerIds: [], cancelled: false, cancelledAt: null, done: false,
  });
  assert.match(session.id, /^[0-9a-f]{16}$/);

  await repo.setSessionChoice(round.id, session.id, g.id);
  await repo.finishSession(round.id, session.id, { finished: true, winnerIds: ['m1'] });
  const after = (await repo.getRound(round.id)).sessions[0];
  assert.equal(after.chosenGameId, g.id);
  assert.equal(after.finished, true);
  assert.deepEqual(after.winnerIds, ['m1']);

  assert.equal(await repo.deleteSession(round.id, session.id), true);
  assert.equal(await repo.deleteSession(round.id, session.id), false);
});

test('setBackground returns the previous design and stores the new one', async () => {
  const round = await freshRound();
  const first = await repo.setBackground(round.id, { type: 'theme', page: 'p', accent: 'a' });
  assert.equal(first.previous, null);
  const second = await repo.setBackground(round.id, { type: 'none' });
  assert.deepEqual(second.previous, { type: 'theme', page: 'p', accent: 'a' });
  assert.deepEqual((await repo.getRound(round.id)).background, { type: 'none' });
  assert.equal(await repo.setBackground('missing', { type: 'none' }), null);
});

test('saveRecommendationRuns stores runs and retires the legacy object', async () => {
  const round = await freshRound();
  const runs = [{ id: 'r1', items: [{ title: 'X' }] }];
  const saved = await repo.saveRecommendationRuns(round.id, runs);
  assert.deepEqual(saved, runs);
  const fetched = await repo.getRound(round.id);
  assert.deepEqual(fetched.recommendationRuns, runs);
  assert.equal('recommendations' in fetched, false);
  assert.equal(await repo.saveRecommendationRuns('missing', runs), null);
});

test('deleteActivity removes a feed entry by id', async () => {
  const round = await freshRound();
  await repo.createGame(round.id, {
    title: 'A', platform: 'analog', type: 'analog', duration: 'medium',
    minPlayers: 1, maxPlayers: 4, image: null, source: null,
  });
  const withActivity = await repo.getRound(round.id);
  const aid = withActivity.activities[0].id;
  assert.equal(await repo.deleteActivity(round.id, aid), true);
  assert.equal(await repo.deleteActivity(round.id, aid), false);
  assert.equal((await repo.getRound(round.id)).activities.length, 0);
});

test('updateMember applies a validated patch or reports missing', async () => {
  const round = await freshRound();
  const mid = round.members[0].id;
  const m = await repo.updateMember(round.id, mid, { name: 'Renamed', color: '#1d9e75' });
  assert.equal(m.name, 'Renamed');
  assert.equal(m.color, '#1d9e75');
  assert.equal(await repo.updateMember(round.id, 'nobody', { name: 'X' }), null);
  assert.equal(await repo.updateMember('nowhere', mid, { name: 'X' }), null);
});
