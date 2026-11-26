'use strict';

/*
 * „Spielwirbel-Rekorde" (#1788) over HTTP: the operator's review list and
 * record list, the two decisions, the CSV, and what a round read carries
 * (`game.swRecord`). The computation itself is test/game-records.test.js.
 *
 * Accounts ON so two real tenants exist; rounds are seeded through each
 * tenant's scoped repo and READ back over HTTP as their owner.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.ADMIN_PASSWORD = 'operator-secret-pw';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, adminSessionCookie } = require('./helpers');
const repo = require('../lib/repo');
const gameRecords = require('../lib/game-records');
const { runJob } = require('../lib/scheduler');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';

async function makeAccount(name) {
  const email = `${name}@example.com`;
  await request(app).post('/api/account/register').send({ email, username: name, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

const BGG = '777001';
let day = 0;
const when = () => `2026-10-${String((day += 1)).padStart(2, '0')}T19:00:00.000Z`;

// One round in `tenant` with a game linked to BGG, and one scored session per
// entry of `plays` (each a [points of member 1, points of member 2]).
async function seedRound(tenant, plays) {
  const scoped = repo.forTenant(tenant);
  const round = await scoped.createRound({ name: 'Runde', members: ['Anna', 'Ben'], importFromRoundId: null });
  const game = await scoped.createGame(round.id, { title: 'Ein Titel, den eine Runde tippte', minPlayers: 2, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: BGG } });
  const [m1, m2] = round.members.map((m) => m.id);
  const sessions = [];
  for (const [p1, p2] of plays) {
    sessions.push(await scoped.createSession(round.id, {
      createdAt: when(), gameIds: [game.id], votes: {}, chosenGameId: game.id, finished: true, cancelled: false,
      memberIds: [m1, m2], winnerIds: [], scores: { [m1]: p1, [m2]: p2 },
    }));
  }
  return { round, game, members: round.members, sessions };
}

const admin = async (method, path, body) => {
  const cookie = await adminSessionCookie();
  const req = request(app)[method](`/api/admin${path}`).set('Cookie', cookie);
  return body ? req.send(body) : req;
};

const gameAs = async (who, rid, gid) => {
  const res = await request(app).get(`/api/rounds/${rid}`).set('Authorization', `Bearer ${who.token}`);
  assert.equal(res.status, 200);
  return res.body.games.find((g) => g.id === gid);
};

test('review → „Gültig" counts it, „Nicht werten" moves the record; nothing names a round or person', async () => {
  const ada = await makeAccount('ada-records');
  const bo = await makeAccount('bo-records');
  // Ada's round: 40/38, then 41/39. Bo's round: an obvious fake, 500 beside a 42.
  const a = await seedRound(ada.user.tenantId, [[40, 38], [41, 39]]);
  const b = await seedRound(bo.user.tenantId, [[500, 42]]);
  assert.ok(await runJob('recomputeGameRecords'), 'the scheduler job runs the recompute');

  let res = await admin('get', '/game-records');
  assert.equal(res.status, 200);
  assert.equal(res.body.records.length, 1);
  assert.deepEqual([res.body.records[0].bggId, res.body.records[0].value], [BGG, 42],
    'the 500 is held back, so Bo\'s 42 is the record');
  assert.equal(res.body.reviews.length, 1);
  const review = res.body.reviews[0];
  assert.deepEqual([review.points, review.heldBack, review.record], [500, true, 42]);
  assert.ok(review.reasons.includes('session') && review.reasons.includes('jump'));
  assert.deepEqual(review.peers, [42]);
  assert.equal(review.players, 2);
  assert.equal(review.title, null, 'a title a round typed is never shown — only the corpus name');

  // The payload sweep: no id the fixture minted, and no typed title.
  const minted = [ada.user.id, bo.user.id, ada.user.tenantId, bo.user.tenantId, a.round.id, b.round.id, a.game.id, b.game.id,
    ...a.members.map((m) => m.id), ...b.members.map((m) => m.id), ...a.sessions.map((s) => s.id), ...b.sessions.map((s) => s.id)];
  const body = JSON.stringify(res.body);
  minted.forEach((id) => assert.ok(!body.includes(id), `the admin payload names ${id}`));
  assert.ok(!body.includes('tippte'));

  // A round read carries the value, and the held-back score as pending in ITS round only.
  const bGame = await gameAs(bo, b.round.id, b.game.id);
  assert.equal(bGame.swRecord.value, 42);
  assert.deepEqual(bGame.swRecord.pending, [`${b.sessions[0].id}/${b.members[0].id}`]);
  const aGame = await gameAs(ada, a.round.id, a.game.id);
  assert.deepEqual(aGame.swRecord.pending, []);
  assert.ok(!JSON.stringify(aGame.swRecord).includes(b.round.id) && !JSON.stringify(aGame.swRecord).includes(b.sessions[0].id));

  // „Gültig": the 500 counts at once.
  res = await admin('post', `/game-records/${review.ref}`, { action: 'valid' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.records[0].value, res.body.reviews.length], [500, 0]);
  await runJob('recomputeGameRecords');
  assert.equal((await admin('get', '/game-records')).body.reviews.length, 0, 'a valid score is never flagged again');

  // „Nicht werten" from the RECORD list: the 500 goes, the next best moves up.
  const ref = res.body.records[0].refs[0];
  assert.match(ref, /^[0-9a-f]{20}$/);
  res = await admin('post', `/game-records/${ref}`, { action: 'exclude' });
  assert.equal(res.body.records[0].value, 42);
  // The round's own record and points are untouched.
  const stored = await repo.forTenant(bo.user.tenantId).getRound(b.round.id);
  assert.equal(stored.sessions[0].scores[b.members[0].id], 500);

  // CSV: both lists, attachment and copy, through lib/csv.js.
  const csv = await admin('get', '/game-records.csv?list=records');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-disposition'], /spielwirbel-rekorde-records-/);
  assert.match(csv.text, /"BGG 777001","777001","42","höchste","5"/);
  const copy = await admin('get', '/game-records.csv?list=reviews&copy=1');
  assert.match(copy.headers['content-type'], /text\/plain/);
  assert.match(copy.text, /^"Spiel","BGG-ID","Punkte"/);
});

test('bad refs and actions are refused, and the screen is behind the admin gate', async () => {
  assert.equal((await admin('post', '/game-records/not-a-ref', { action: 'valid' })).status, 400);
  assert.equal((await admin('post', `/game-records/${'a'.repeat(20)}`, { action: 'valid' })).status, 404);
  assert.equal((await admin('post', `/game-records/${'a'.repeat(20)}`, { action: 'delete' })).status, 400);
  assert.equal((await request(app).get('/api/admin/game-records')).status, 401);
});

test('a recompute never undoes a decision made while it ran', async () => {
  const key = 'rX/sX/mX';
  await repo.putScoreReview(key, { state: 'excluded', ref: gameRecords.scoreRef(key) });
  assert.equal(await repo.putScoreReview(key, { state: 'flagged' }, { onlyUndecided: true }), null);
  assert.equal(await repo.deleteScoreReviews([key], { onlyUndecided: true }), 0);
  assert.equal((await repo.listScoreReviews()).find((r) => r.key === key).state, 'excluded');
  assert.equal(await repo.deleteScoreReviews([key]), 1);
});
