'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Game', minPlayers: '1', maxPlayers: '8', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return (await req).body;
}

test('starting a session picks from matching games and returns them', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'A' });
  await addGame(round.id, { title: 'B' });

  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 });
  assert.equal(res.status, 201);
  assert.equal(res.body.games.length, 2);
  assert.equal(res.body.session.gameIds.length, 2);
});

// A completed game is out of the active collection, so it must be as
// undrawable and unpickable as a retired one (#250).
test('completed games are excluded from the draw pool and direct pick (#250)', async () => {
  const round = await createRound(request);
  const keep = await addGame(round.id, { title: 'A' });
  const done = await addGame(round.id, { title: 'B' });
  await request(app).post(`/api/rounds/${round.id}/games/${done.id}/complete`).send({});

  const drawn = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 });
  assert.equal(drawn.status, 201);
  assert.deepEqual(drawn.body.session.gameIds, [keep.id]);

  const picked = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: done.id });
  assert.equal(picked.status, 400);
  assert.match(picked.body.error, /completed/i);
});

test('tag filter narrows the pool (#242)', async () => {
  const round = await createRound(request);
  const tag = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'Party' })).body;
  await addGame(round.id, { title: 'A' });
  await addGame(round.id, { title: 'B', tagIds: tag.id });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ tagIds: [tag.id], count: 5 });
  assert.equal(res.body.games.length, 1);
  assert.equal(res.body.games[0].title, 'B');
});

test('a draw-flow session remembers its filters on the round (#252)', async () => {
  const round = await createRound(request);
  const inc = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'Party' })).body;
  const exc = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'Long' })).body;
  await addGame(round.id, { title: 'A', tagIds: inc.id });

  // Fresh round: no preset yet, so the key is absent (both backends).
  assert.equal((await request(app).get(`/api/rounds/${round.id}`)).body.lastSessionFilters, undefined);

  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    // 'ghost' is not a tag of this round -> dropped, like every unknown id.
    .send({ tagIds: [inc.id, 'ghost'], excludeTagIds: [exc.id], count: 4 });
  assert.equal(res.status, 201);

  const after = (await request(app).get(`/api/rounds/${round.id}`)).body;
  assert.deepEqual(after.lastSessionFilters, {
    tagIds: [inc.id],
    excludeTagIds: [exc.id],
    count: 4,
  });
});

test('an unfiltered draw stores empty filter arrays, direct-pick leaves the preset alone (#252)', async () => {
  const round = await createRound(request);
  const tag = (await request(app).post(`/api/rounds/${round.id}/tags`).send({ name: 'Party' })).body;
  const game = await addGame(round.id, { title: 'A', tagIds: tag.id });

  await request(app).post(`/api/rounds/${round.id}/sessions`).send({ tagIds: [tag.id], count: 2 });
  // A direct pick skips the filter/draw flow entirely, so it must neither read
  // nor overwrite what the last real draw remembered.
  const direct = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id });
  assert.equal(direct.status, 201);
  assert.deepEqual((await request(app).get(`/api/rounds/${round.id}`)).body.lastSessionFilters, {
    tagIds: [tag.id], excludeTagIds: [], count: 2,
  });

  // A later unfiltered draw overwrites it with empty arrays (not null), which is
  // what the client presets "nothing selected" from.
  await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  assert.deepEqual((await request(app).get(`/api/rounds/${round.id}`)).body.lastSessionFilters, {
    tagIds: [], excludeTagIds: [], count: 1,
  });
});

test('player count filters games by their min/max range', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'Solo', minPlayers: '1', maxPlayers: '1' });
  await addGame(round.id, { title: 'Party', minPlayers: '4', maxPlayers: '8' });
  // Both members join -> playerCount 2 -> neither game's range covers 2, so
  // the pool is empty and the endpoint reports "no matching games".
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ memberIds: round.members.map((m) => m.id), count: 5 });
  assert.equal(res.status, 400);
});

test('player count includes games whose range covers the joining members', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'Pair', minPlayers: '2', maxPlayers: '2' });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ memberIds: round.members.map((m) => m.id), count: 5 });
  assert.equal(res.status, 201);
  assert.equal(res.body.games.length, 1);
});

test('a session with no matching games returns 400', async () => {
  const round = await createRound(request);
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({});
  assert.equal(res.status, 400);
});

test('choice must reference a game from the session', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body.session;

  const bad = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/choice`)
    .send({ gameId: 'nope' });
  assert.equal(bad.status, 400);

  const ok = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/choice`)
    .send({ gameId: game.id });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.chosenGameId, game.id);
});

test('cancel is blocked once a game is chosen', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body.session;
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/choice`)
    .send({ gameId: game.id });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/cancel`)
    .send({});
  assert.equal(res.status, 400);
});

test('finish records only winners who are round members', async () => {
  const round = await createRound(request);
  await addGame(round.id);
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body.session;
  const memberId = round.members[0].id;
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/finish`)
    .send({ winnerIds: [memberId, 'stranger'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.finished, true);
  assert.deepEqual(res.body.winnerIds, [memberId]);
});

test('deleting a game from a session drops it and its votes', async () => {
  const round = await createRound(request);
  const keep = await addGame(round.id, { title: 'Keep' });
  const drop = await addGame(round.id, { title: 'Drop' });
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 })).body.session;
  const [m0, m1] = round.members.map((m) => m.id);
  const votes = {
    [m0]: { [keep.id]: { rating: 4, retire: false }, [drop.id]: { rating: 2, retire: true } },
    [m1]: { [drop.id]: { rating: 5, retire: false } },
  };
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/results`).send({ votes });

  const res = await request(app).delete(`/api/rounds/${round.id}/sessions/${session.id}/games/${drop.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.gameIds, [keep.id]);
  assert.equal(res.body.votes[m0][drop.id], undefined);
  assert.equal(res.body.votes[m1][drop.id], undefined);
  assert.deepEqual(res.body.votes[m0][keep.id], { rating: 4, retire: false });
});

test('deleting the chosen game resets the choice and result', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body.session;
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/choice`).send({ gameId: game.id });
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/finish`)
    .send({ winnerIds: [round.members[0].id] });

  const res = await request(app).delete(`/api/rounds/${round.id}/sessions/${session.id}/games/${game.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.gameIds, []);
  assert.equal(res.body.chosenGameId, null);
  assert.equal(res.body.finished, false);
  assert.deepEqual(res.body.winnerIds, []);
});

test('deleting a game not in the session returns 404', async () => {
  const round = await createRound(request);
  await addGame(round.id);
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body.session;
  const res = await request(app).delete(`/api/rounds/${round.id}/sessions/${session.id}/games/nope`);
  assert.equal(res.status, 404);
});

test('results persist votes and mark the session done', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body.session;
  const votes = { [round.members[0].id]: { [game.id]: { rating: 5, retire: false } } };
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/results`)
    .send({ votes });
  assert.equal(res.body.done, true);
  assert.deepEqual(res.body.votes, votes);
});

// --- Direct-pick mode ("Jetzt spielen": one game, no vote) ---

test('direct pick starts a done session with the game already chosen', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, { title: 'Chosen' });
  const other = await addGame(round.id, { title: 'Other' });

  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id });
  assert.equal(res.status, 201);
  const s = res.body.session;
  assert.deepEqual(s.gameIds, [game.id]);
  assert.equal(s.chosenGameId, game.id);
  assert.ok(s.chosenAt);
  assert.equal(s.done, true);
  assert.deepEqual(s.votes, {});
  assert.equal(s.requestedCount, 1);
  // Only the picked game is returned, not the rest of the round.
  assert.equal(res.body.games.length, 1);
  assert.equal(res.body.games[0].id, game.id);
  assert.ok(!s.gameIds.includes(other.id));
});

test('direct pick ignores draw filters and never draws extra games', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, { title: 'Solo', minPlayers: '1', maxPlayers: '1' });
  await addGame(round.id, { title: 'Filler' });
  // A player-range that a draw would reject, plus count noise: all ignored.
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, count: 5, memberIds: round.members.map((m) => m.id) });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.session.gameIds, [game.id]);
  assert.equal(res.body.session.memberIds.length, round.members.length);
});

test('direct pick only counts the joining members', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, memberIds: [round.members[0].id] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.session.memberIds, [round.members[0].id]);
});

test('direct pick rejects an unknown game', async () => {
  const round = await createRound(request);
  await addGame(round.id);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: 'nope' });
  assert.equal(res.status, 400);
});

test('direct pick rejects a retired game', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  await request(app).post(`/api/rounds/${round.id}/games/${game.id}/retire`).send({ retired: true });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id });
  assert.equal(res.status, 400);
});

test('direct pick with only unknown member ids falls back to everyone', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, memberIds: ['ghost'] });
  assert.equal(res.status, 201);
  assert.equal(res.body.session.memberIds.length, round.members.length);
});

/* ---------------------------- Guests (#458) -------------------------------- */

// The client sends names only. A guest id becomes a key in the vote map and in
// winnerIds, so letting a client dictate one would let it collide with a member
// id or with another session's guest.
test('guest ids are minted server-side; a client-supplied id is ignored', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'A' });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, guests: ['Dana', { id: 'chosen-by-client', name: 'Eli' }] });

  assert.equal(res.status, 201);
  const guests = res.body.session.guests;
  assert.equal(guests.length, 2);
  assert.deepEqual(guests.map((g) => g.name).slice(0, 1), ['Dana']);
  guests.forEach((g) => {
    assert.match(g.id, /^[0-9a-f]{16}$/);
    assert.notEqual(g.id, 'chosen-by-client');
    // Nor may a mint collide with one of the round's own member ids.
    assert.ok(!round.members.some((m) => m.id === g.id));
  });
  // The 201 repeats them so the wizard doesn't have to dig them out of the blob.
  assert.deepEqual(res.body.guests, guests);
});

test('guest names are trimmed and truncated, empties dropped and the list capped', async () => {
  const { MAX_SESSION_GUESTS, GUEST_NAME_MAX } = require('../public/js/session-people');
  const round = await createRound(request);
  // maxPlayers has to clear 2 members + the full guest cap, or the pool filter
  // (which guests count toward) empties and the draw 400s before the cap shows.
  await addGame(round.id, { title: 'A', maxPlayers: String(MAX_SESSION_GUESTS + 5) });
  const long = 'L'.repeat(GUEST_NAME_MAX + 40);
  const names = ['  Dana  ', '', '   ', long,
    ...Array.from({ length: MAX_SESSION_GUESTS + 5 }, (_, i) => `G${i}`)];
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, guests: names });

  assert.equal(res.status, 201);
  const guests = res.body.session.guests;
  assert.equal(guests.length, MAX_SESSION_GUESTS);
  assert.equal(guests[0].name, 'Dana');
  // Truncated, not rejected — and to the same constant the setup screen puts on
  // its input's maxlength, so the two can't drift.
  assert.equal(guests[1].name.length, GUEST_NAME_MAX);
});

// Absent, not []: the session blob is stored verbatim in both backends, so a
// defaulted key would split their stored shape (see the repo contract suite).
test('a session started without guests grows no guests key', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'A' });
  const drawn = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  assert.equal('guests' in drawn.body.session, false);

  // Same for an empty list — and for the direct-pick flow, which since #532
  // takes guests too and so has to observe the identical discipline.
  const empty = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1, guests: [] });
  assert.equal('guests' in empty.body.session, false);
  const game = drawn.body.games[0];
  const direct = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, guests: [] });
  assert.equal(direct.status, 201);
  assert.equal('guests' in direct.body.session, false);
});

// #532. The direct-play sheet has no voting phase, so the payoff is not the vote
// but WINNER ATTRIBUTION: the results screen's winner chips come from
// sessionPeople() (members ∪ guests), so before this a guest who won a
// directly-started game could not be recorded at all — the only workarounds were
// to make them a permanent member or to use the draw flow instead.
test('the direct-pick flow stores guests, and one can be recorded as the winner', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, { title: 'A' });
  const started = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, guests: ['  Dana  ', ''] });

  assert.equal(started.status, 201);
  // Trimmed, blanks dropped and the id minted server-side, exactly like the draw
  // path — both modes go through the one resolveGuests().
  assert.equal(started.body.session.guests.length, 1);
  const guest = started.body.session.guests[0];
  assert.equal(guest.name, 'Dana');
  assert.match(guest.id, /^[0-9a-f]{16}$/);
  // Both start modes report the minted guests at the top level, not just inside
  // the session blob — the ids exist nowhere client-side until this response, so
  // a shape that differed by mode would strand one of them.
  assert.deepEqual(started.body.guests, started.body.session.guests);

  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${started.body.session.id}/finish`)
    .send({ finished: true, winnerIds: [guest.id] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.winnerIds, [guest.id]);
});

// Guests count toward the draw pool's player range, and it would be an easy
// slip to let that arithmetic leak into direct-pick — where there is no pool to
// filter and the user has already named the game they are playing. A guest must
// never be able to make a chosen game unplayable.
test('a guest does not filter the direct-pick game by its player range', async () => {
  const round = await createRound(request); // Alice + Bob
  const game = await addGame(round.id, { title: 'Two', minPlayers: '2', maxPlayers: '2' });

  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id, guests: ['Dana', 'Eli'] }); // 4 at a 2-player game

  assert.equal(res.status, 201);
  assert.equal(res.body.session.guests.length, 2);
});

// Guests sit at the table, so they count toward the player range — the whole
// reason a guest is better than leaving the visitor out of the vote. The
// client-side preview in showStartSession() applies the identical arithmetic.
test('guests count toward the player range of the draw pool', async () => {
  const round = await createRound(request); // Alice + Bob
  await addGame(round.id, { title: 'Four', minPlayers: '4', maxPlayers: '4' });

  const without = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  assert.equal(without.status, 400); // 2 players, the game needs 4

  const withOne = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, guests: ['Dana'] });
  assert.equal(withOne.status, 400); // 3 — still short

  const withTwo = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, guests: ['Dana', 'Eli'] });
  assert.equal(withTwo.status, 201);
  assert.equal(withTwo.body.games.length, 1);
});

test('a guest can be recorded as a winner; another session\'s guest cannot', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'A' });
  const mine = (await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, guests: ['Dana'] })).body;
  const other = (await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, guests: ['Stranger'] })).body;

  const guest = mine.session.guests[0];
  const outsider = other.session.guests[0];
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${mine.session.id}/finish`)
    .send({ finished: true, winnerIds: [guest.id, round.members[0].id, outsider.id, 'ghost'] });

  assert.equal(res.status, 200);
  // The allowlist is this round's members ∪ THIS session's guests — nothing else.
  assert.deepEqual(res.body.winnerIds, [guest.id, round.members[0].id]);
});

// The vote card renders no retire control for a guest, so a guest `retire` flag
// can only come from a hand-crafted request. Dropping it here is what lets
// gameStats() skip guest-exclusion logic entirely.
test('a guest vote cannot carry a retire flag, even hand-crafted', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'A' });
  const started = (await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, guests: ['Dana'] })).body;
  const gid = started.games[0].id;
  const guest = started.session.guests[0];
  const member = round.members[0];

  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${started.session.id}/results`)
    .send({
      votes: {
        [member.id]: { [gid]: { rating: 4, retire: true } },
        [guest.id]: { [gid]: { rating: 2, retire: true } },
      },
    });

  assert.equal(res.status, 200);
  // The guest's rating is kept — they played the game — only the flag goes.
  assert.equal(res.body.votes[guest.id][gid].rating, 2);
  assert.equal('retire' in res.body.votes[guest.id][gid], false);
  // A member's flag is untouched.
  assert.equal(res.body.votes[member.id][gid].retire, true);
});

test('saving results still 404s for an unknown session', async () => {
  const round = await createRound(request);
  await addGame(round.id, { title: 'A' });
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/nope/results`)
    .send({ votes: {} });
  assert.equal(res.status, 404);
});
