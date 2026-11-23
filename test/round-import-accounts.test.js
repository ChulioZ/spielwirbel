'use strict';

/*
 * The round import (#1756) in accounts mode: an export made by one account,
 * imported by ANOTHER — the "between two accounts on one host" case, which is
 * the same code path as a move between instances. Quotas are enforced here
 * (accounts mode), with ceilings small enough that the rich fixture crosses each.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.MAX_ROUNDS_PER_TENANT = '3';
process.env.MAX_GAMES_PER_ROUND = '5';
process.env.MAX_MEMBERS_PER_ROUND = '6';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { buildRichRound } = require('./support/rich-round');
const { withRoundExportMarker } = require('../public/js/round-import-file');

const PASSWORD = 'correct horse battery';

async function makeAccount(name) {
  const email = `${name}@example.test`;
  await request(app).post('/api/account/register').send({ email, username: name, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  const user = await repo.getUserByEmail(email);
  const auth = { Authorization: `Bearer ${login.body.accessToken}` };
  return { user, call: (method, path) => request(app)[method](path).set(auth) };
}

let exported;
let ada;
let bea;
const setup = async () => {
  if (exported) return;
  ada = await makeAccount('ada');
  bea = await makeAccount('bea');
  const round = await buildRichRound(ada.call);
  // Ada links herself to a seat (PATCH { userId }, #421), so the export
  // carries an account link to strip.
  const link = await ada.call('patch', `/api/rounds/${round.id}/members/${round.members[0].id}`).send({ userId: ada.user.id });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  const linked = (await ada.call('get', `/api/rounds/${round.id}`)).body;
  assert.equal(linked.members[0].userId, ada.user.id, 'the export really carries a link');
  exported = withRoundExportMarker(linked, new Date());
};

test('another account imports the export as its own round, every seat unlinked', async () => {
  await setup();
  const res = await bea.call('post', '/api/rounds/import').send(exported);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { round } = res.body;
  assert.equal(round.shared, undefined, 'Bea owns it — no grant flags');
  assert.ok(round.members.every((m) => !('userId' in m)), 'no seat links to an account');
  assert.equal(round.members.some((m) => m.userId === ada.user.id), false);

  // It is in Bea's tenant, not Ada's.
  const beas = (await bea.call('get', '/api/rounds')).body.map((r) => r.id);
  const adas = (await ada.call('get', '/api/rounds')).body.map((r) => r.id);
  assert.ok(beas.includes(round.id));
  assert.ok(!adas.includes(round.id));
  assert.equal((await ada.call('get', `/api/rounds/${round.id}`)).status, 404);
});

test('an unauthenticated import is refused before its body is read', async () => {
  await setup();
  const res = await request(app).post('/api/rounds/import').send(exported);
  assert.equal(res.status, 401);
});

test('a quota the import would cross refuses the WHOLE import', async () => {
  await setup();
  const before = (await bea.call('get', '/api/rounds')).body.length;
  // The rich round holds 5 games and 4 seats: add one of each over the caps.
  const games = { ...exported, games: [...exported.games, { id: 'extra-game', title: 'Six' }] };
  const r1 = await bea.call('post', '/api/rounds/import').send(games);
  assert.equal(r1.status, 403);
  assert.equal(r1.body.error, 'quota_games');
  const seats = { ...exported, members: [...exported.members, ...['E', 'F', 'G'].map((n) => ({ id: `x${n}`, name: n }))] };
  const r2 = await bea.call('post', '/api/rounds/import').send(seats);
  assert.equal(r2.status, 403);
  assert.equal(r2.body.error, 'quota_members');
  assert.equal((await bea.call('get', '/api/rounds')).body.length, before, 'nothing was written');
});

test('the round cap counts an import like any other round', async () => {
  await setup();
  let res;
  for (let i = 0; i < 4; i += 1) res = await bea.call('post', '/api/rounds/import').send(exported);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'quota_rounds');
  assert.equal((await bea.call('get', '/api/rounds')).body.length, 3);
});
