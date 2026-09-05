'use strict';

/*
 * Vote by link (#652): a per-device session shared as one URL, so people WITHOUT
 * an account can vote from their own phone.
 *
 * The token in that URL is a capability, so the properties worth testing hardest
 * are the ones whose failure is silent or invisible from the app:
 *
 *  - the ballot must never carry a vote VALUE (the whole point of #209's redaction
 *    is that an open session's ratings stay secret, and this response is a second,
 *    unauthenticated way to read the same session);
 *  - every unusable token must answer the SAME 404, or the difference between the
 *    answers is an oracle telling a guesser they guessed a real one;
 *  - a token must reach exactly its own session — never another of the round's,
 *    never another tenant's.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) {
    req.field(k, String(v));
  }
  return (await req).body;
}

// A round with two games, drawn as a per-device session and shared as a link.
async function setup(over = {}) {
  const round = await createRound(request, over.round);
  const a = await addGame(round.id, 'A');
  const b = await addGame(round.id, 'B');
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 5, ...(over.session || {}) });
  const session = res.body.session;
  const mint = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link`)
    .send({});
  return { round, a, b, session, guests: res.body.guests, mint, token: mint.body.token };
}

const getRound = (rid) => request(app).get(`/api/rounds/${rid}`).then((r) => r.body);
const sessionOf = (round, sid) => round.sessions.find((s) => s.id === sid);

/* ------------------------------- Minting ---------------------------------- */

test('minting returns a token, and minting again returns the SAME one', async () => {
  const { round, session, mint, token } = await setup();
  assert.equal(mint.status, 201);
  // 24 random bytes, base64url. Asserted as a shape: a token that fell back to the
  // store's 16-hex `id()` would still be truthy and would still work, while
  // carrying half the entropy the capability rests on.
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);

  // The link already in the group chat must keep working, so a second tap on
  // „Link teilen" hands out the same URL rather than silently replacing it.
  const again = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link`)
    .send({});
  assert.equal(again.status, 201);
  assert.equal(again.body.token, token);
});

// #655 removed the opt-in, so this is the claim that replaced "a hot-seat
// session cannot be shared": every drawn session can be, with no setup at all.
test('any drawn session can be shared as a link, with no opt-in', async () => {
  const round = await createRound(request);
  await addGame(round.id, 'A');
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const mint = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${res.body.session.id}/vote-link`)
    .send({});
  assert.equal(mint.status, 201);
  assert.match(mint.body.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal((await request(app).get(`/api/vote/${mint.body.token}`)).status, 200);
});

// Direct-pick is the one session kind with no ballot: it is born `done`.
test('a direct-pick session cannot be shared as a link', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ gameId: game.id });
  const mint = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${res.body.session.id}/vote-link`)
    .send({});
  assert.equal(mint.status, 400);
  assert.equal(mint.body.error, 'voting_closed');
});

test('a closed or cancelled session cannot be shared as a link', async () => {
  const closed = await setup();
  await request(app).post(`/api/rounds/${closed.round.id}/sessions/${closed.session.id}/close`).send({});
  const afterClose = await request(app)
    .post(`/api/rounds/${closed.round.id}/sessions/${closed.session.id}/vote-link`)
    .send({});
  assert.equal(afterClose.status, 400);
  assert.equal(afterClose.body.error, 'voting_closed');

  const cancelled = await setup();
  await request(app).post(`/api/rounds/${cancelled.round.id}/sessions/${cancelled.session.id}/cancel`).send({});
  const afterCancel = await request(app)
    .post(`/api/rounds/${cancelled.round.id}/sessions/${cancelled.session.id}/vote-link`)
    .send({});
  assert.equal(afterCancel.status, 400);
});

/* -------------------------------- The ballot ------------------------------- */

test('the ballot carries the games, the participants and their voted flags', async () => {
  const { round, a, b, token } = await setup();
  const [alice, bob] = round.members;

  const res = await request(app).get(`/api/vote/${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.roundName, round.name);
  assert.deepEqual(res.body.games.map((g) => g.id).sort(), [a.id, b.id].sort());
  assert.deepEqual(res.body.people.map((p) => p.name), [alice.name, bob.name]);
  assert.deepEqual(res.body.people.map((p) => p.hasVoted), [false, false]);
  assert.deepEqual(res.body.people.map((p) => p.guest), [false, false]);

  // After one column lands, only that person flips.
  await request(app)
    .post(`/api/vote/${token}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 4 } } });
  const after = await request(app).get(`/api/vote/${token}`);
  assert.deepEqual(after.body.people.map((p) => p.hasVoted), [true, false]);
});

// The reason lib/session-votes.js exists at all, re-asserted on the one surface
// that reads a session WITHOUT an account. A leak here would hand the ratings to
// anyone the link was forwarded to, before anyone had voted.
test('the ballot never carries a vote value, not even the caller\'s own', async () => {
  const { round, a, token } = await setup();
  const [alice] = round.members;
  await request(app)
    .post(`/api/vote/${token}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });

  const res = await request(app).get(`/api/vote/${token}`);
  // Whole-payload assertion rather than a per-key one: the guarantee is that no
  // session field can leak by being forgotten, and only serialising the lot can
  // see a field nobody thought to check.
  const body = JSON.stringify(res.body);
  assert.equal(body.includes('"rating"'), false, `ballot leaked a rating: ${body}`);
  assert.equal(body.includes('"votes"'), false);
  assert.equal(body.includes('"retire"'), false);
  // And nothing about the round beyond its name and this session's games/people.
  assert.equal(body.includes('"sessions"'), false);
  assert.equal(body.includes('"activities"'), false);
  assert.equal(body.includes('"tenantId"'), false);
});

test('a guest is offered on the ballot and marked as one', async () => {
  const { round, token } = await setup({ session: { guests: ['Dana'] } });
  const res = await request(app).get(`/api/vote/${token}`);
  const dana = res.body.people.find((p) => p.name === 'Dana');
  assert.ok(dana, 'the guest must be claimable — they are at the table');
  assert.equal(dana.guest, true);
  assert.equal(res.body.people.filter((p) => !p.guest).length, round.members.length);
});

/* --------------------------- Writing through it ---------------------------- */

test('a link vote lands exactly like an in-app one', async () => {
  const { round, a, b, session, token } = await setup();
  const [alice] = round.members;

  const res = await request(app)
    .post(`/api/vote/${token}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5, retire: true }, [b.id]: { rating: 2 } } });
  assert.equal(res.status, 200);
  // Never the session back — it holds everyone else's column.
  assert.deepEqual(res.body, { ok: true });

  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const stored = sessionOf(await getRound(round.id), session.id);
  // A vote is `{ rating }` and nothing else since #909, so the hand-crafted
  // `retire` is not stripped by a rule somewhere downstream — it simply has no
  // way through the sanitizer, which builds the entry rather than filtering it.
  assert.deepEqual(stored.votes[alice.id], { [a.id]: { rating: 5 }, [b.id]: { rating: 2 } });
});

// The shared sanitizer's rules must hold on this route too — a link voter's column
// obeying different rules than an in-app one is exactly the drift that made
// sanitizePersonVotes a shared function rather than a second copy.
test('a link vote is sanitized: unknown games dropped, stray keys refused', async () => {
  const { round, a, session, token } = await setup({ session: { guests: ['Dana'] } });
  const [alice] = round.members;
  const ballot = await request(app).get(`/api/vote/${token}`);
  const dana = ballot.body.people.find((p) => p.name === 'Dana');

  // A game that was never drawn would otherwise move an average no screen explains.
  const other = await addGame(round.id, 'Not drawn');
  await request(app)
    .post(`/api/vote/${token}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 4 }, [other.id]: { rating: 1 } } });

  // A guest writes exactly what a member writes since #909 — and a key nobody
  // writes any more cannot be smuggled back in through a hand-crafted request.
  await request(app)
    .post(`/api/vote/${token}/votes/${dana.id}`)
    .send({ votes: { [a.id]: { rating: 3, retire: true } } });

  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const stored = sessionOf(await getRound(round.id), session.id);
  assert.deepEqual(Object.keys(stored.votes[alice.id]), [a.id]);
  assert.equal('retire' in stored.votes[dana.id][a.id], false);
  assert.equal(stored.votes[dana.id][a.id].rating, 3);
});

test('a link vote is logged as the person\'s own, naming no account', async () => {
  const { round, a, session, token } = await setup();
  const [alice] = round.members;
  await request(app)
    .post(`/api/vote/${token}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 4 } } });

  const stored = sessionOf(await getRound(round.id), session.id);
  const voted = stored.events.filter((e) => e.type === 'voted');
  assert.equal(voted.length, 1);
  assert.equal(voted[0].personId, alice.id);
  // No actor at all. The server cannot know who held the device, and an actor-less
  // `voted` renders as „Alice hat abgestimmt" — the honest reading, and the reason
  // this needed no new event type.
  assert.equal('actor' in voted[0], false);
});

test('someone who did not join this session cannot be voted for', async () => {
  const { round, a, token } = await setup({ session: { memberIds: [] } });
  // A member of the round who is deliberately not in this session's seat list.
  const outsider = await request(app)
    .post(`/api/rounds/${round.id}/members`)
    .send({ name: 'Latecomer' });
  const res = await request(app)
    .post(`/api/vote/${token}/votes/${outsider.body.id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'invalid_link');
});

/* ------------------------- The uniform-404 contract ------------------------ */

// The single most important property in this file: every way a token can fail
// answers byte-for-byte the same thing. Anything else tells a guesser whether the
// token they tried exists — which is the only feedback brute force needs.
test('every unusable token answers the identical 404, revealing nothing', async () => {
  const answers = [];
  const record = async (label, res) => {
    answers.push({ label, status: res.status, body: JSON.stringify(res.body) });
  };

  // 1. A token that never existed.
  await record('never existed', await request(app).get('/api/vote/nope-not-a-real-token'));

  // 2. A real token whose session has been CLOSED.
  const closed = await setup();
  await request(app).post(`/api/rounds/${closed.round.id}/sessions/${closed.session.id}/close`).send({});
  await record('closed', await request(app).get(`/api/vote/${closed.token}`));

  // 3. A real token whose session has been CANCELLED.
  const cancelled = await setup();
  await request(app).post(`/api/rounds/${cancelled.round.id}/sessions/${cancelled.session.id}/cancel`).send({});
  await record('cancelled', await request(app).get(`/api/vote/${cancelled.token}`));

  // 4. A real token whose SESSION was deleted.
  const goneSession = await setup();
  await request(app).delete(`/api/rounds/${goneSession.round.id}/sessions/${goneSession.session.id}`).send({});
  await record('session deleted', await request(app).get(`/api/vote/${goneSession.token}`));

  // 5. A real token whose ROUND was deleted.
  const goneRound = await setup();
  await request(app).delete(`/api/rounds/${goneRound.round.id}`).send({});
  await record('round deleted', await request(app).get(`/api/vote/${goneRound.token}`));

  const distinct = [...new Set(answers.map((a) => `${a.status} ${a.body}`))];
  assert.equal(
    distinct.length, 1,
    `these must be indistinguishable, got ${distinct.length}: ${JSON.stringify(answers, null, 2)}`
  );
  assert.equal(answers[0].status, 404);
  assert.deepEqual(JSON.parse(answers[0].body), { error: 'invalid_link' });
});

/* The load-bearing one, and the reason the test above is not enough on its own.
   Every case there is ALSO satisfied by the row cleanup in lib/routes/sessions.js:
   the row is gone, so `findSessionVoteLink` returns null and the 404 never reaches
   the state gate. Measured — deleting the gate outright leaves all of them green.

   So this reinstates a stale row on purpose. That is what a missed cleanup site,
   or a cleanup that failed after the close committed, actually leaves behind, and
   the whole design rests on such a row being inert rather than on every cascade
   site being remembered. It is the only test in this file that reads the gate. */
test('a STALE link row is inert — the gate re-reads the session, so cleanup is only hygiene', async () => {
  const repo = require('../lib/repo');
  const revive = (rid, sid) =>
    repo.createSessionVoteLink({ tenantId: 'default', roundId: rid, sessionId: sid });

  const cases = [];

  // A closed session.
  const closed = await setup();
  await request(app).post(`/api/rounds/${closed.round.id}/sessions/${closed.session.id}/close`).send({});
  cases.push({ label: 'closed', ...closed, link: await revive(closed.round.id, closed.session.id) });

  // A cancelled session.
  const cancelled = await setup();
  await request(app).post(`/api/rounds/${cancelled.round.id}/sessions/${cancelled.session.id}/cancel`).send({});
  cases.push({ label: 'cancelled', ...cancelled, link: await revive(cancelled.round.id, cancelled.session.id) });

  // A row pointing at a session that no longer exists — the gate's other arm,
  // and the one a missed cascade on round-delete would leave behind.
  const goneRound = await createRound(request);
  const goneGame = await addGame(goneRound.id, 'A');
  const gone = await request(app).post(`/api/rounds/${goneRound.id}/sessions`).send({ count: 1 });
  await request(app).delete(`/api/rounds/${goneRound.id}/sessions/${gone.body.session.id}`).send({});
  cases.push({
    label: 'session gone',
    round: goneRound,
    a: goneGame,
    session: gone.body.session,
    link: await revive(goneRound.id, gone.body.session.id),
  });

  for (const c of cases) {
    // The stale row really is there — without this the test could pass because the
    // revive silently did nothing, which is the vacuous form of this very check.
    assert.ok(await repo.findSessionVoteLink(c.link.id), `${c.label}: the stale row must exist`);

    const read = await request(app).get(`/api/vote/${c.link.id}`);
    assert.equal(read.status, 404, `${c.label}: a stale row must not open a ballot`);
    assert.deepEqual(read.body, { error: 'invalid_link' }, `${c.label}: and must not say why`);

    const write = await request(app)
      .post(`/api/vote/${c.link.id}/votes/${c.round.members[0].id}`)
      .send({ votes: { [c.a.id]: { rating: 5 } } });
    assert.equal(write.status, 404, `${c.label}: a stale row must not accept a vote`);
    assert.deepEqual(write.body, { error: 'invalid_link' });
  }
});

// Closing a session must stop the link WRITING too, not merely reading — checked
// separately because the two handlers could drift apart.
test('a closed session refuses a link write', async () => {
  const { round, a, session, token } = await setup();
  const [alice] = round.members;
  await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/close`).send({});
  const res = await request(app)
    .post(`/api/vote/${token}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'invalid_link' });
});

/* --------------------------- Scope of a token ------------------------------ */

// A token authorizes ONE session. The obvious implementation bug — resolving the
// person against the round rather than against the linked session, or trusting a
// session id from the request — would let one link reach the round's other
// sessions, which is a whole evening's votes rather than one.
test('a token reaches exactly its own session, not the round\'s others', async () => {
  const { round, a, session, token } = await setup();
  const [alice] = round.members;

  // A second per-device session in the SAME round, with its own link.
  const second = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, deviceVoting: true });
  const secondId = second.body.session.id;
  const secondToken = (await request(app)
    .post(`/api/rounds/${round.id}/sessions/${secondId}/vote-link`)
    .send({})).body.token;
  assert.notEqual(secondToken, token);

  // Writing through the FIRST token lands in the first session only.
  await request(app)
    .post(`/api/vote/${token}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });

  const fresh = await getRound(round.id);
  assert.ok(sessionOf(fresh, session.id).votedIds.includes(alice.id));
  assert.deepEqual(sessionOf(fresh, secondId).votedIds, []);
});

// The tenant a public request acts as comes from the resolved row and nothing
// else. This is the shape .claude/rules/admin-cross-tenant-escape.md §4 asks for
// in miniature: prove the boundary from the outside, not by reading the code.
test('a token cannot be pointed at another round by a crafted path', async () => {
  const { round, token } = await setup();
  const other = await createRound(request, { name: 'Someone else\'s' });
  await addGame(other.id, 'Secret');
  const otherSession = await request(app)
    .post(`/api/rounds/${other.id}/sessions`)
    .send({ count: 1, deviceVoting: true });

  // There is no round or session id in the public path at all — the only thing a
  // caller supplies is the token and a person id — so the ballot can only ever
  // describe the linked round.
  const res = await request(app).get(`/api/vote/${token}`);
  assert.equal(res.body.roundName, round.name);
  assert.equal(JSON.stringify(res.body).includes('Secret'), false);
  assert.equal(JSON.stringify(res.body).includes(otherSession.body.session.id), false);
});

/* ------------------------------ Expiry (TTL) ------------------------------- */

/* The gap the five event-driven deletions cannot close: a session that is drawn,
   shared and then simply ABANDONED — never closed, never cancelled, its round and
   account still there — reaches none of them. `openBallot` refuses only `done`
   and `cancelled`, so without an age limit that link keeps working forever, and
   `docs/legal/retention.md`'s "deleted when voting ends" would be untrue for it.

   These specs drive the TTL to something tiny rather than waiting 30 days; the
   ceiling is read per call, exactly like every other one in this app. */
test('an abandoned session\'s link stops working once it is older than the TTL', async (t) => {
  const prev = process.env.VOTE_LINK_TTL_DAYS;
  t.after(() => { process.env.VOTE_LINK_TTL_DAYS = prev; });

  const { round, a, session, token } = await setup();
  const [alice] = round.members;

  // The session is deliberately left OPEN — this is the abandoned case, so none
  // of the five deletion paths has fired and the row is still there.
  assert.equal((await request(app).get(`/api/vote/${token}`)).status, 200);

  // A TTL small enough that the link just minted is already past it. Expressed in
  // days because that is the unit the operator tunes.
  process.env.VOTE_LINK_TTL_DAYS = String(1 / (24 * 60 * 60 * 1000)); // ~1ms
  await new Promise((r) => setTimeout(r, 5));

  const read = await request(app).get(`/api/vote/${token}`);
  assert.equal(read.status, 404, 'an expired link must not open a ballot');
  assert.deepEqual(read.body, { error: 'invalid_link' }, 'and must be indistinguishable from any other dead link');

  const write = await request(app)
    .post(`/api/vote/${token}/votes/${alice.id}`)
    .send({ votes: { [a.id]: { rating: 5 } } });
  assert.equal(write.status, 404, 'nor accept a vote');
  assert.deepEqual(write.body, { error: 'invalid_link' });

  // The GATE is what refused it, not the sweep: the row is still in the store.
  // That ordering is the whole point — the link dies at the cutoff, not whenever
  // the 15-minute tick next happens to run.
  const repo = require('../lib/repo');
  assert.ok(await repo.findSessionVoteLink(token), 'the row is still present; the gate refused it');

  // Restore the real ceiling and it works again — proving the refusal was the age
  // and not some other state the test wandered into.
  process.env.VOTE_LINK_TTL_DAYS = '30';
  assert.equal((await request(app).get(`/api/vote/${token}`)).status, 200);
  // …and that the session is genuinely still open, i.e. this really was the
  // abandoned case rather than a closed session refusing for the usual reason.
  const stored = sessionOf(await getRound(round.id), session.id);
  assert.equal(stored.done, false);
  assert.equal(stored.cancelled, false);
});

test('the scheduled sweep deletes expired link rows, and leaves live ones', async (t) => {
  const prev = process.env.VOTE_LINK_TTL_DAYS;
  t.after(() => { process.env.VOTE_LINK_TTL_DAYS = prev; });
  const repo = require('../lib/repo');
  const { runJob } = require('../lib/scheduler');

  const stale = await setup();
  process.env.VOTE_LINK_TTL_DAYS = String(1 / (24 * 60 * 60 * 1000)); // ~1ms
  await new Promise((r) => setTimeout(r, 5));
  // Minted AFTER the tiny TTL is in force, so it is still inside its own window
  // only once the ceiling goes back up — which is what the second half asserts.
  const removedCount = await runJob('purgeExpiredVoteLinks');
  assert.ok(removedCount >= 1, `the sweep reported ${removedCount}`);
  assert.equal(await repo.findSessionVoteLink(stale.token), null);

  // With a realistic ceiling a freshly minted link survives the sweep — the half
  // that stops "delete everything" from passing this test.
  process.env.VOTE_LINK_TTL_DAYS = '30';
  const live = await setup();
  await runJob('purgeExpiredVoteLinks');
  assert.ok(await repo.findSessionVoteLink(live.token), 'a live link must survive the sweep');
  assert.equal((await request(app).get(`/api/vote/${live.token}`)).status, 200);
});

test('the TTL ceiling refuses a value that would disable the feature', () => {
  const prev = process.env.VOTE_LINK_TTL_DAYS;
  const { ttlDays, DEFAULT_TTL_DAYS } = require('../lib/vote-link');
  try {
    // 0 or a negative would expire every link the instant it is minted — i.e.
    // silently turn the feature off through a config typo. Fall back instead.
    for (const bad of ['0', '-5', 'abc', '']) {
      process.env.VOTE_LINK_TTL_DAYS = bad;
      assert.equal(ttlDays(), DEFAULT_TTL_DAYS, `${JSON.stringify(bad)} should fall back`);
    }
    process.env.VOTE_LINK_TTL_DAYS = '7';
    assert.equal(ttlDays(), 7, 'a real value is honoured');
  } finally {
    process.env.VOTE_LINK_TTL_DAYS = prev;
  }
});

/* --------------------------- The token in the logs ------------------------- */

// The token is the app's only credential that travels in the PATH — which is the
// one request field `requestLogger` records by design. So the ordinary
// "log the path" writes a WORKING ballot credential into every log line, where it
// outlives the session and is readable by anyone with log access. Found in review,
// not by any check: nothing errors, the feature works perfectly, and the leak is
// invisible unless you go and read the logs.
test('a vote-link request never writes its token into the logs', async () => {
  const { reqPath } = require('../lib/observability');
  // Deliberately NOT a realistic 32-char base64url token. The redaction matches
  // `[^/]+`, so the literal's entropy is irrelevant to what is under test — while
  // a realistic one trips gitleaks' generic-api-key rule (it did, at 4.5 entropy),
  // and a suite that teaches people to wave the secret scanner through is a worse
  // outcome than a slightly less lifelike fixture.
  const token = 'NOT-A-REAL-TOKEN-just-a-path-segment';

  // Both shapes the public router serves.
  assert.equal(reqPath({ originalUrl: `/api/vote/${token}` }), '/api/vote/:token');
  assert.equal(reqPath({ originalUrl: `/api/vote/${token}/votes/m1` }), '/api/vote/:token/votes/m1');
  // With a query string, which is stripped independently.
  assert.equal(reqPath({ originalUrl: `/api/vote/${token}?x=1` }), '/api/vote/:token');

  // Stated as its own assertion rather than implied by the equalities above: the
  // thing that must never appear is the token, and saying so is what makes a
  // future change to the placeholder unable to pass while leaking.
  for (const url of [`/api/vote/${token}`, `/api/vote/${token}/votes/m1`, `/api/vote/${token}?x=1`]) {
    assert.equal(reqPath({ originalUrl: url }).includes(token), false, `leaked via ${url}`);
  }

  // Every OTHER path is untouched — the redaction must not quietly eat the paths
  // the logger exists to record, which is how a fix like this becomes a worse bug.
  assert.equal(reqPath({ originalUrl: '/api/rounds/abc/sessions/def' }), '/api/rounds/abc/sessions/def');
  assert.equal(reqPath({ originalUrl: '/api/rounds' }), '/api/rounds');
  assert.equal(reqPath({ originalUrl: '/healthz' }), '/healthz');
  // Not a prefix match on "/api/vote" as a substring of something else.
  assert.equal(reqPath({ originalUrl: '/api/voters/x' }), '/api/voters/x');
});

/* ------------------------------ Hygiene ------------------------------------ */

// Row cleanup is deliberately NOT what makes a link stop working (the gate
// re-reads the session every time). It is retention: a row naming a round and a
// tenant must not outlive them.
test('the link row is dropped when the session ends', async () => {
  const repo = require('../lib/repo');

  const closed = await setup();
  assert.ok(await repo.findSessionVoteLink(closed.token));
  await request(app).post(`/api/rounds/${closed.round.id}/sessions/${closed.session.id}/close`).send({});
  assert.equal(await repo.findSessionVoteLink(closed.token), null);

  const cancelled = await setup();
  await request(app).post(`/api/rounds/${cancelled.round.id}/sessions/${cancelled.session.id}/cancel`).send({});
  assert.equal(await repo.findSessionVoteLink(cancelled.token), null);

  const deleted = await setup();
  await request(app).delete(`/api/rounds/${deleted.round.id}/sessions/${deleted.session.id}`).send({});
  assert.equal(await repo.findSessionVoteLink(deleted.token), null);

  const droppedRound = await setup();
  await request(app).delete(`/api/rounds/${droppedRound.round.id}`).send({});
  assert.equal(await repo.findSessionVoteLink(droppedRound.token), null);
});
