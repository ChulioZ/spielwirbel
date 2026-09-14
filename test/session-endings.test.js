'use strict';

/* How a played session ended when nobody won (#1038) — the finish route's own
   half. Its own file rather than the bottom of `sessions.test.js`, which the
   700-line source budget already holds at the limit, and because the ending is
   an independently editable concern (`test/token-budget.test.js`, and the seam
   test in .claude/rules/token-friendly-source-files.md).

   Named for what it covers, not for a module basename — there is no
   `session-endings.js` anywhere, so nothing can be overwritten by it
   (.claude/rules/test-file-names-collide-silently.md). */

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

/* How a played session ENDED when nobody won (#1038).

   The invariant the route owns is the exclusivity: a session has winners, or an
   ending, or neither — never both. It is enforced in three places, and each has
   to be asserted separately because they fail differently. The 400 catches a
   client sending both at once; the CLEARING catches the ordinary flow, where
   every winner-chip tap re-POSTs the whole result and must therefore drop an
   ending nobody removed by hand; and the absent key keeps an ordinary session's
   blob byte-identical across both backends. */

async function finishWith(round, sessionId, body) {
  return request(app)
    .post(`/api/rounds/${round.id}/sessions/${sessionId}/finish`)
    .send(body);
}

async function playedSession(round) {
  const game = await addGame(round.id);
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body.session;
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/choice`).send({ gameId: game.id });
  return session;
}

test('finish stores an ending, and only one the app offers (#1038)', async () => {
  const round = await createRound(request);
  const session = await playedSession(round);

  const ok = await finishWith(round, session.id, { finished: true, winnerIds: [], ending: 'lost' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ending, 'lost');
  assert.deepEqual(ok.body.winnerIds, []);

  const bad = await finishWith(round, session.id, { finished: true, winnerIds: [], ending: 'abandoned' });
  assert.equal(bad.status, 400, 'an unknown ending is refused, not stored');
});

test('an ending and winners are mutually exclusive (#1038)', async () => {
  const round = await createRound(request);
  const session = await playedSession(round);
  const memberId = round.members[0].id;

  const both = await finishWith(round, session.id, { finished: true, winnerIds: [memberId], ending: 'lost' });
  assert.equal(both.status, 400, 'both at once is refused');

  // The ordinary flow: recording a winner afterwards must CLEAR the ending,
  // which is what lets the winner chips replace it with no extra field.
  await finishWith(round, session.id, { finished: true, winnerIds: [], ending: 'lost' });
  const won = await finishWith(round, session.id, { finished: true, winnerIds: [memberId] });
  assert.equal(won.status, 200);
  assert.deepEqual(won.body.winnerIds, [memberId]);
  assert.equal(won.body.ending, undefined, 'the stored ending is gone, not merely unselected');
});

test('finishing with neither, and un-finishing, clear the ending (#1038)', async () => {
  const round = await createRound(request);
  const session = await playedSession(round);

  await finishWith(round, session.id, { finished: true, winnerIds: [], ending: 'ongoing' });
  const plain = await finishWith(round, session.id, { finished: true, winnerIds: [] });
  assert.equal(plain.body.ending, undefined, 'back to unrecorded');

  await finishWith(round, session.id, { finished: true, winnerIds: [], ending: 'noWinner' });
  const reset = await finishWith(round, session.id, { finished: false, winnerIds: [] });
  assert.equal(reset.body.finished, false);
  assert.equal(reset.body.ending, undefined);
});

test('a session with no ending grows no `ending` key at all (#1038)', async () => {
  // The absent-key convention `guests`, `teams` and `childSessionIds` use, so an
  // ordinary session's blob stays byte-identical in both backends.
  const round = await createRound(request);
  const session = await playedSession(round);
  const res = await finishWith(round, session.id, { finished: true, winnerIds: [] });
  assert.ok(!('ending' in res.body), 'no key, not `ending: null`');
});

test('an ending cannot be set on a cancelled session (#1038)', async () => {
  // No chosen game: the cancel route refuses a session that has one.
  const round = await createRound(request);
  await addGame(round.id);
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).send({})).body.session;
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/cancel`).send({ cancelled: true });
  const res = await finishWith(round, session.id, { finished: true, winnerIds: [], ending: 'lost' });
  assert.equal(res.status, 400);
});
