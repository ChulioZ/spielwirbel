'use strict';

/*
 * Self-service account deletion (issue #419): the Art. 17 erasure reached by the
 * account's own owner, from the /konto screen, instead of through the operator
 * panel (#273).
 *
 * Accounts are enabled here because the whole surface is accounts-mode only, and
 * the erasure cascade only has meaning with a real tenant behind it — the same
 * setup test/admin.test.js uses. Mail lands in the in-memory outbox, so there is
 * no network.
 *
 * The suite mirrors test/admin.test.js's erasure spec deliberately: its
 * still-valid-token assertion is the tripwire for
 * .claude/rules/erased-account-token-fallback.md, and self-service makes that
 * path routine from a second direction.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const storage = require('../lib/storage');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';

const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');

async function makeAccount(email) {
  await request(app)
    .post('/api/account/register')
    .send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

const del = (token, body) =>
  request(app).delete('/api/account').set('Authorization', `Bearer ${token}`).send(body);

/* ------------------------------- feature gate ------------------------------- */

test('the deletion surface 404s while accounts are not enabled', async () => {
  const flag = process.env.ACCOUNTS_ENABLED;
  delete process.env.ACCOUNTS_ENABLED;
  try {
    const res = await request(app).delete('/api/account').send({ password: PASSWORD });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'accounts_disabled');

    const preview = await request(app).get('/api/account/deletion-preview');
    assert.equal(preview.status, 404);
    assert.equal(preview.body.error, 'accounts_disabled');
  } finally {
    process.env.ACCOUNTS_ENABLED = flag;
  }
});

test('deletion needs an account — an anonymous caller gets nowhere', async () => {
  const res = await request(app).delete('/api/account').send({ password: PASSWORD });
  assert.equal(res.status, 401);
  const preview = await request(app).get('/api/account/deletion-preview');
  assert.equal(preview.status, 401);
});

/* ----------------------------- the confirmation ----------------------------- */

test('the preview names what deletion will actually destroy', async () => {
  const me = await makeAccount('preview@example.com');
  const auth = (r) => r.set('Authorization', `Bearer ${me.token}`);

  const round = await auth(request(app).post('/api/rounds'))
    .send({ name: 'Donnerstagsrunde', members: ['Ann', 'Bo'] });
  const rid = round.body.id;
  const game = await auth(request(app).post(`/api/rounds/${rid}/games`))
    .send({ title: 'A game', minPlayers: 1, maxPlayers: 4 });
  const tenantRepo = repo.forTenant(me.user.tenantId);
  await tenantRepo.updateGame(rid, game.body.id, { image: '/uploads/preview1.jpg' });

  // A second game carrying a HOTLINKED provider cover (#172). There are no bytes
  // of ours behind it, so counting it would promise a deletion that never
  // happens — storage.remove() ignores it by design.
  const linked = await auth(request(app).post(`/api/rounds/${rid}/games`))
    .send({ title: 'A linked game', minPlayers: 1, maxPlayers: 4 });
  await tenantRepo.updateGame(rid, linked.body.id, {
    image: 'https://cf.geekdo-images.com/x/pic123.jpg',
  });

  const res = await auth(request(app).get('/api/account/deletion-preview'));
  assert.equal(res.status, 200);
  assert.equal(res.body.rounds, 1);
  assert.equal(res.body.games, 2);
  assert.equal(res.body.images, 1, 'only covers WE host may be promised as deleted');
  assert.equal(res.body.sharedWith, 0);
});

test('the preview counts the accounts that lose access, once each', async () => {
  const owner = await makeAccount('shares@example.com');
  const guest = await makeAccount('guest-of-shares@example.com');
  const ownerAuth = (r) => r.set('Authorization', `Bearer ${owner.token}`);

  const first = await ownerAuth(request(app).post('/api/rounds'))
    .send({ name: 'Shared one', members: ['Ann'] });
  const second = await ownerAuth(request(app).post('/api/rounds'))
    .send({ name: 'Shared two', members: ['Bo'] });

  // Seeded directly: the same person invited to TWO of the owner's rounds loses
  // access once, not twice — the count is of people, not of grants.
  for (const r of [first.body.id, second.body.id]) {
    await repo.createGrant({
      roundId: r,
      ownerTenantId: owner.user.tenantId,
      userId: guest.user.id,
      memberId: null,
      role: 'editor',
    });
  }

  const res = await ownerAuth(request(app).get('/api/account/deletion-preview'));
  assert.equal(res.status, 200);
  assert.equal(res.body.rounds, 2);
  assert.equal(res.body.sharedWith, 1);

  // And the grantee's own preview counts nobody: those grants sit on somebody
  // else's rounds, so deleting this account revokes no third party's access.
  const theirs = await request(app)
    .get('/api/account/deletion-preview')
    .set('Authorization', `Bearer ${guest.token}`);
  assert.equal(theirs.body.sharedWith, 0);
});

/* --------------------------- the re-authentication -------------------------- */

test('deletion refuses without both the password and the typed username', async (t) => {
  const me = await makeAccount('guards@example.com');
  await request(app)
    .post('/api/rounds')
    .set('Authorization', `Bearer ${me.token}`)
    .send({ name: 'Still here', members: ['Ann'] });

  const intact = async (why) => {
    assert.notEqual(await repo.getUserById(me.user.id), null, why);
    const rounds = await repo.forTenant(me.user.tenantId).listRounds();
    assert.equal(rounds.length, 1, why);
  };

  await t.test('a wrong password erases nothing', async () => {
    const res = await del(me.token, { password: 'not it', confirmUsername: 'guards' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_credentials');
    await intact('a wrong password must erase nothing');
  });

  await t.test('a missing password erases nothing', async () => {
    const res = await del(me.token, { confirmUsername: 'guards' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_credentials');
    await intact('a missing password must erase nothing');
  });

  await t.test('a mistyped username erases nothing', async () => {
    const res = await del(me.token, { password: PASSWORD, confirmUsername: 'guard' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'confirm_mismatch');
    await intact('a mistyped confirmation must erase nothing');
  });

  await t.test('an EMPTY username confirmation erases nothing', async () => {
    // Without the min-length guard an empty string would "match" an account
    // carrying no username — turning the confirmation off exactly when the
    // stored data is already odd.
    for (const confirmUsername of ['', '   ', undefined]) {
      const res = await del(me.token, { password: PASSWORD, confirmUsername });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'confirm_mismatch');
    }
    await intact('an empty confirmation must erase nothing');
  });

  await t.test('the username confirmation is case-insensitive, like the handle itself', async () => {
    // Asserted on a THROWAWAY account: this one succeeds.
    const other = await makeAccount('casing@example.com');
    const res = await del(other.token, { password: PASSWORD, confirmUsername: '  CASING  ' });
    assert.equal(res.status, 200);
  });
});

test('a demo account is refused rather than told its password is wrong', async () => {
  const flag = process.env.DEMO_ENABLED;
  process.env.DEMO_ENABLED = 'true';
  try {
    const started = await request(app).post('/api/account/demo').send({ locale: 'de' });
    assert.equal(started.status, 200);
    const token = started.body.accessToken;

    // A demo holds no password identity, so invalid_credentials would be a claim
    // about a password that never existed (.claude/rules/guest-demo-accounts.md).
    const res = await del(token, { password: PASSWORD, confirmUsername: started.body.user.username });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'demo_account');
    assert.notEqual(await repo.getUserById(started.body.user.id), null);

    // Its own erasure path still works.
    const ended = await request(app)
      .delete('/api/account/demo')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(ended.status, 200);
  } finally {
    if (flag === undefined) delete process.env.DEMO_ENABLED;
    else process.env.DEMO_ENABLED = flag;
  }
});

/* -------------------------------- the erasure ------------------------------- */

test('a self-service deletion erases the account, its rounds and its covers', async (t) => {
  const me = await makeAccount('delete-me@example.com');
  const bystander = await makeAccount('untouched@example.com');
  const auth = (r) => r.set('Authorization', `Bearer ${me.token}`);

  const round = await auth(request(app).post('/api/rounds'))
    .send({ name: 'Their whole life', members: ['Ann'] });
  const rid = round.body.id;
  const game = await auth(request(app).post(`/api/rounds/${rid}/games`))
    .send({ title: 'A game', minPlayers: 1, maxPlayers: 4 });
  await repo.forTenant(me.user.tenantId).updateGame(rid, game.body.id, { image: '/uploads/del1.jpg' });

  await request(app)
    .post('/api/rounds')
    .set('Authorization', `Bearer ${bystander.token}`)
    .send({ name: 'Untouched', members: ['Bo'] });

  const outboxBefore = outbox.length;
  let res;

  await t.test('the request succeeds and reports honest counts', async () => {
    res = await del(me.token, { password: PASSWORD, confirmUsername: 'delete-me' });
    assert.equal(res.status, 200);
    assert.equal(res.body.rounds, 1);
    assert.equal(res.body.imagesRemoved, 1);
    assert.equal(res.body.imagesFailed, 0);
  });

  await t.test('the account, its data and its cover objects are gone', async () => {
    assert.equal(await repo.getUserById(me.user.id), null);
    assert.deepEqual(await repo.forTenant(me.user.tenantId).listRounds(), []);
    assert.equal(await repo.findImageOwner('/uploads/del1.jpg'), null);

    const login = await request(app)
      .post('/api/account/login')
      .send({ email: 'delete-me@example.com', password: PASSWORD });
    assert.equal(login.status, 401);
  });

  await t.test('the still-valid access token is refused, not handed the default tenant', async () => {
    // SECURITY REGRESSION GUARD, the same one test/admin.test.js pins for the
    // operator route: the access token is a stateless JWT with a 15-minute TTL,
    // so this one is still signature-valid. lib/tenant.js must answer ERASED
    // rather than falling back to the legacy 'default' tenant's data
    // (.claude/rules/erased-account-token-fallback.md).
    const api = await request(app).get('/api/rounds').set('Authorization', `Bearer ${me.token}`);
    assert.equal(api.status, 401, "an erased account's token must NOT fall back to the default tenant");
    assert.equal(api.body.error, 'auth_required');
    assert.equal(Array.isArray(api.body.rounds), false, 'it must not return any rounds at all');
  });

  await t.test('the bystander account and its data are untouched', async () => {
    const rounds = await repo.forTenant(bystander.user.tenantId).listRounds();
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].name, 'Untouched');
  });

  await t.test('a farewell mail goes out', async () => {
    assert.ok(outbox.length > outboxBefore, 'a confirmation mail was sent');
    const last = outbox[outbox.length - 1];
    assert.equal(last.to, 'delete-me@example.com');
    assert.match(last.subject, /gelöscht/);
  });

  await t.test('the log evidences the deletion WITHOUT re-storing the erased data', async () => {
    const entries = await repo.listModeration(50, 0, {});
    const entry = entries.find((e) => e.action === 'account_deleted' && e.target === me.user.id);
    assert.ok(entry, 'a self-service deletion is logged');
    assert.equal(entry.tenantId, me.user.tenantId);
    assert.equal(entry.rounds, 1);
    assert.equal(entry.imagesRemoved, 1);
    // Distinguishable from an operator-assisted erasure without reading prose.
    assert.equal(entry.reason, 'self-service');

    // The record proves the request was honoured; it is not a copy of what was
    // erased. Anything here survives the erasure it evidences.
    assert.equal('email' in entry, false, 'the deletion log must not keep the address');
    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes('delete-me@example.com'), false);
    assert.equal(serialized.includes('Their whole life'), false, 'no round names');
    assert.equal(serialized.includes('A game'), false, 'no game titles');
    assert.equal(serialized.includes('Ann'), false, 'no member names');
  });
});

test('a storage failure neither fails the request nor undoes the erasure', async () => {
  const me = await makeAccount('storage-fails@example.com');
  const auth = (r) => r.set('Authorization', `Bearer ${me.token}`);

  const round = await auth(request(app).post('/api/rounds')).send({ name: 'R', members: ['Ann'] });
  const game = await auth(request(app).post(`/api/rounds/${round.body.id}/games`))
    .send({ title: 'G', minPlayers: 1, maxPlayers: 4 });
  await repo.forTenant(me.user.tenantId)
    .updateGame(round.body.id, game.body.id, { image: '/uploads/boom.jpg' });

  const realRemove = storage.remove;
  storage.remove = async () => { throw new Error('bucket on fire'); };
  try {
    const res = await del(me.token, { password: PASSWORD, confirmUsername: 'storage-fails' });
    // The rows are already gone; reporting a 500 would claim the erasure did not
    // happen when it did.
    assert.equal(res.status, 200);
    assert.equal(res.body.imagesRemoved, 0);
    assert.equal(res.body.imagesFailed, 1, 'the failure is reported honestly, not hidden');
    assert.equal(await repo.getUserById(me.user.id), null);
    assert.deepEqual(await repo.forTenant(me.user.tenantId).listRounds(), []);
  } finally {
    storage.remove = realRemove;
  }
});

test('a failed farewell mail does not 500 a completed deletion', async () => {
  const me = await makeAccount('mail-fails@example.com');
  const mail = require('../lib/mail');
  const realSend = mail.send;
  mail.send = async () => { throw new Error('smtp down'); };
  try {
    const res = await del(me.token, { password: PASSWORD, confirmUsername: 'mail-fails' });
    assert.equal(res.status, 200);
    assert.equal(await repo.getUserById(me.user.id), null);
  } finally {
    mail.send = realSend;
  }
});
