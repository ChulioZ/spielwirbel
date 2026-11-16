'use strict';

/*
 * „Spieleinstellungen" (#1786), end to end over HTTP: the operator's queue of
 * BGG games rounds have scored, the three actions, and what a confirmation does
 * to every round — the effective `lowScoreWins` overlaid on read, the 409 on a
 * round's own change, and the restore on revoke. The repo half (the per-round
 * rows and the settings table) is in test/support/repo-contract.js, the fold
 * and the cache in test/game-scoring.test.js.
 *
 * Accounts ON so two real tenants exist; rounds are seeded through each
 * tenant's scoped repo, then READ back over HTTP as their owner, which is the
 * path every screen takes.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.ADMIN_PASSWORD = 'operator-secret-pw';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, adminSessionCookie } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';

async function makeAccount(name) {
  const email = `${name}@example.com`;
  await request(app).post('/api/account/register').send({ email, username: name, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

const GOLF = '111222';
const src = (id) => ({ provider: 'bgg', externalId: id, url: `https://boardgamegeek.com/boardgame/${id}` });
const played = (gid) => ({
  createdAt: '2026-11-01T19:00:00.000Z', gameIds: [gid], votes: {}, chosenGameId: gid, chosenAt: 't',
  finished: true, finishedAt: 't', winnerIds: [], cancelled: false, cancelledAt: null, done: true,
  scores: { m1: 30, m2: 45 },
});

// One round in `tenant` holding a scored game linked to `bggId`.
async function seedRound(tenant, { bggId = GOLF, low = false, title = 'Golf' } = {}) {
  const scoped = repo.forTenant(tenant);
  const round = await scoped.createRound({ name: `Runde ${title}`, members: ['Anna', 'Ben'], importFromRoundId: null });
  const game = await scoped.createGame(round.id, { title, minPlayers: 2, maxPlayers: 4, image: null, source: src(bggId) });
  if (low) await scoped.updateGame(round.id, game.id, { lowScoreWins: true });
  await scoped.createSession(round.id, played(game.id));
  return { round, game };
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

test('the queue, a confirmation across rounds, the 409, revoke and dismissal', async (t) => {
  const ada = await makeAccount('ada-scoring');
  const bo = await makeAccount('bo-scoring');
  const a1 = await seedRound(ada.user.tenantId, { low: true });
  const a2 = await seedRound(ada.user.tenantId, { title: 'Golf (2. Ed.)' });
  const b1 = await seedRound(bo.user.tenantId);
  // Never counted: a demo tenant, and an unlinked game.
  await seedRound('demo-scoring', { low: true });
  const unlinked = await repo.forTenant(bo.user.tenantId).createRound({ name: 'Frei', members: ['C'], importFromRoundId: null });
  const ug = await repo.forTenant(bo.user.tenantId).createGame(unlinked.id, { title: 'Hausregel', minPlayers: 1, maxPlayers: 4, image: null, source: null });
  await repo.forTenant(bo.user.tenantId).createSession(unlinked.id, played(ug.id));

  await t.test('every route is behind the operator gate', async () => {
    assert.equal((await request(app).get('/api/admin/game-scoring')).status, 401);
    assert.equal((await request(app).get('/api/admin/game-scoring.csv')).status, 401);
    assert.equal((await request(app).post(`/api/admin/game-scoring/${GOLF}`).send({ action: 'dismiss' })).status, 401);
  });

  await t.test('the queue counts rounds with points, demo and unlinked excluded, and carries no identifier', async () => {
    const res = await admin('get', '/game-scoring');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.games, [{
      bggId: GOLF, title: 'Golf', rounds: 3, lowWins: 1, highWins: 2,
      state: 'open', lowScoreWins: null, confirmedAt: null,
    }]);
    // No round, tenant, member, game, session or account id anywhere.
    const text = JSON.stringify(res.body);
    const ids = [ada.user.id, bo.user.id, ada.user.tenantId, bo.user.tenantId, a1.round.id, a1.game.id,
      a2.round.id, b1.round.id, ...a1.round.members.map((m) => m.id)];
    for (const id of ids) assert.equal(text.includes(id), false, `the payload names ${id}`);
  });

  await t.test('confirming flips every round, including the one that set the opposite', async () => {
    assert.equal((await gameAs(ada, a1.round.id, a1.game.id)).lowScoreWins, true, 'before: its own switch');
    const res = await admin('post', `/game-scoring/${GOLF}`, { action: 'confirm', lowScoreWins: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.game.state, 'confirmed');
    assert.equal(res.body.game.lowScoreWins, false);
    for (const [who, { round, game }] of [[ada, a1], [ada, a2], [bo, b1]]) {
      const g = await gameAs(who, round.id, game.id);
      assert.equal('lowScoreWins' in g, false, 'highest wins, as absence');
      assert.equal(g.scoringLocked, true);
    }
    // The unlinked game is untouched.
    const free = await gameAs(bo, unlinked.id, ug.id);
    assert.equal('scoringLocked' in free, false);
  });

  await t.test('a new game linked to the confirmed id is locked at once', async () => {
    const g = await repo.forTenant(bo.user.tenantId).createGame(b1.round.id,
      { title: 'Golf neu', minPlayers: 2, maxPlayers: 4, image: null, source: src(GOLF) });
    assert.equal((await gameAs(bo, b1.round.id, g.id)).scoringLocked, true);
  });

  await t.test('a round can no longer change it: 409, and nothing stored', async () => {
    const res = await request(app).patch(`/api/rounds/${a2.round.id}/games/${a2.game.id}`)
      .set('Authorization', `Bearer ${ada.token}`).send({ lowScoreWins: true });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'scoring_locked');
    const stored = await repo.getGame(ada.user.tenantId, a2.round.id, a2.game.id);
    assert.equal('lowScoreWins' in stored, false);
    // Other fields of an unlocked request still save — only the switch is refused.
    const ok = await request(app).patch(`/api/rounds/${a2.round.id}/games/${a2.game.id}`)
      .set('Authorization', `Bearer ${ada.token}`).send({ title: 'Golf (2. Auflage)' });
    assert.equal(ok.status, 200);
  });

  await t.test('the round own value is never written, and revoking restores it', async () => {
    const stored = await repo.getGame(ada.user.tenantId, a1.round.id, a1.game.id);
    assert.equal(stored.lowScoreWins, true, 'the overlay wrote nothing into the tenant');
    const res = await admin('post', `/game-scoring/${GOLF}`, { action: 'revoke' });
    assert.equal(res.status, 200);
    assert.equal(res.body.game.state, 'open');
    const g = await gameAs(ada, a1.round.id, a1.game.id);
    assert.equal(g.lowScoreWins, true);
    assert.equal('scoringLocked' in g, false);
    assert.equal((await admin('post', `/game-scoring/${GOLF}`, { action: 'revoke' })).status, 409, 'nothing left to revoke');
  });

  await t.test('„Zurückstellen" hides the game until one more round contributes', async () => {
    assert.equal((await admin('post', `/game-scoring/${GOLF}`, { action: 'dismiss' })).body.game.state, 'dismissed');
    assert.deepEqual((await admin('get', '/game-scoring?state=open')).body.games, []);
    assert.equal((await admin('get', '/game-scoring?state=dismissed')).body.games.length, 1);
    // A dismissal locks nothing.
    assert.equal('scoringLocked' in (await gameAs(bo, b1.round.id, b1.game.id)), false);
    await seedRound(bo.user.tenantId, { title: 'Golf' });
    const [entry] = (await admin('get', '/game-scoring?state=open')).body.games;
    assert.equal(entry.rounds, 4);
    assert.equal(entry.state, 'open');
  });

  await t.test('the CSV and the copy text carry the filtered list, with formula leads defused', async () => {
    await seedRound(ada.user.tenantId, { bggId: '333444', title: '=HYPERLINK("x")' });
    await admin('post', '/game-scoring/333444', { action: 'confirm', lowScoreWins: true });
    const csv = await admin('get', '/game-scoring.csv?state=confirmed');
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.headers['content-disposition'], /spielwirbel-spieleinstellungen-/);
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.equal(lines.length, 2, 'header + the one confirmed game');
    assert.match(lines[1], /^"333444","'=HYPERLINK\(""x""\)","1","0","1","bestätigt","niedrigste","20/);
    const copy = await admin('get', '/game-scoring.csv?state=confirmed&copy=1');
    assert.match(copy.headers['content-type'], /text\/plain/);
    assert.equal(copy.text.startsWith('\uFEFF'), false, 'no BOM in clipboard text');
    assert.equal(copy.text.trim().split('\r\n').length, 2);
  });

  await t.test('unknown ids and bad bodies are refused', async () => {
    assert.equal((await admin('post', '/game-scoring/999999', { action: 'confirm', lowScoreWins: true })).status, 404);
    assert.equal((await admin('post', '/game-scoring/abc', { action: 'dismiss' })).status, 400);
    assert.equal((await admin('post', `/game-scoring/${GOLF}`, { action: 'confirm' })).status, 400);
  });
});
