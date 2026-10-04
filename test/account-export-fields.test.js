'use strict';

/*
 * The Art. 15/20 export answers EVERY field stored on the account (criterion
 * L-013, legal audit 2026-10-04) — the field-level twin of GLOBAL_DISPOSITION in
 * test/erasure-completeness.test.js, which works a level up, on tables.
 *
 * That spec could not see this: the account row was declared "exported", and it
 * was — through the operator list's projection, which carried ten of roughly
 * two dozen stored keys. Table-level completeness held while the answer to an
 * access request left out the BGG handle, the passkeys, both notification
 * switches, the pending e-mail change and the rest.
 *
 * THE FIXTURE IS BUILT THROUGH THE REAL ROUTES — register, verify, a passkey
 * ceremony, a pending e-mail change — so the key set under test is what those
 * routes actually write, not a hand-copied list of what someone remembered
 * they write (.claude/rules/shared-constants-across-the-stack.md: the copy
 * nobody remembers is the one that rots). A new key on the account record
 * fails here until it is either exported (lib/account-export.js) or named in
 * NOT_EXPORTED with a reason.
 *
 * Named for what it covers; `ls test/account*` showed no collision
 * (.claude/rules/test-file-names-collide-silently.md).
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.ADMIN_PASSWORD = 'operator-secret-pw';
process.env.WEBAUTHN_RP_ID = 'localhost';

const path = require('path');

// The WebAuthn library is stubbed exactly as test/passkeys.test.js does it, and
// for the same reason: there is no authenticator here. It must be in the require
// cache before ./helpers builds the app, which destructures it at load time.
const swPath = require.resolve('@simplewebauthn/server');
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
require.cache[swPath] = {
  id: swPath, filename: swPath, path: path.dirname(swPath), loaded: true, children: [], paths: [],
  exports: {
    generateRegistrationOptions: async (o) => ({
      challenge: b64url(o.challenge),
      rp: { name: o.rpName, id: o.rpID },
      user: { id: b64url(o.userID), name: o.userName, displayName: o.userDisplayName },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    }),
    verifyRegistrationResponse: async (o) => ({
      verified: true,
      registrationInfo: {
        credential: { id: o.response.id, publicKey: new Uint8Array([9, 8, 7, 6]), counter: 0, transports: ['internal'] },
      },
    }),
    generateAuthenticationOptions: async () => { throw new Error('not used here'); },
    verifyAuthenticationResponse: async () => { throw new Error('not used here'); },
  },
};

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const demo = require('../lib/demo');
const { outbox } = require('../lib/mail');
const {
  accountExport, NOT_EXPORTED, IDENTITY_NOT_EXPORTED, PENDING_EMAIL_NOT_EXPORTED,
} = require('../lib/account-export');

const PASSWORD = 'correct horse battery';
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// A registered, verified account with a passkey and a pending e-mail change —
// every optional branch of the stored shape a real account can be in.
async function fullAccount() {
  const email = 'export-fields@example.com';
  await request(app).post('/api/account/register').send({ email, username: 'exportfields', password: PASSWORD });
  const v = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(v, 'registration mailed no verification link');
  await request(app).post('/api/account/verify-email').send({ token: v[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  const token = login.body.accessToken;

  const opts = await request(app).post('/api/account/passkeys/options').set(auth(token)).send({});
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  const pk = await request(app).post('/api/account/passkeys').set(auth(token))
    .send({ response: { id: 'cred-export' }, challenge: opts.body.challenge, name: 'Laptop' });
  assert.equal(pk.status, 201, JSON.stringify(pk.body));

  const chg = await request(app).post('/api/account/change-email').set(auth(token))
    .send({ email: 'export-fields-new@example.com', currentPassword: PASSWORD });
  assert.equal(chg.status, 200, JSON.stringify(chg.body));

  return repo.getUserByEmail(email);
}

async function exportOf(uid) {
  const login = await request(app).post('/api/admin/login').send({ password: 'operator-secret-pw' });
  assert.equal(login.status, 200);
  const res = await request(app).post(`/api/admin/users/${uid}/export`)
    .set('Cookie', login.headers['set-cookie']).send({ reason: 'Art. 15 field coverage' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.export.account;
}

test('every key stored on an account is exported or withheld by name', async () => {
  const stored = await fullAccount();
  const account = await exportOf(stored.id);

  // Anti-vacuous: the fixture really reached every optional branch. Without
  // these a broken fixture (no passkey, no pending change) would satisfy every
  // loop below by having nothing to iterate.
  assert.ok(Object.keys(stored).length >= 25, `a real account carries ~25 keys, saw ${Object.keys(stored).length}`);
  assert.ok(stored.identities.some((i) => i.type === 'passkey'), 'the fixture has no passkey');
  assert.ok(stored.pendingEmail && stored.pendingEmail.email, 'the fixture has no pending e-mail change');

  const missing = Object.keys(stored).filter((k) => !(k in account) && !(k in NOT_EXPORTED));
  assert.deepEqual(missing, [],
    'a stored account key the Art. 15/20 export neither answers nor withholds by name — add it to '
    + 'accountExport (lib/account-export.js), or to NOT_EXPORTED with the reason it must not go out');

  // A withheld key really is withheld, and a key cannot sit on both lists.
  for (const k of Object.keys(NOT_EXPORTED)) {
    assert.equal(k in account, false, `${k} is declared withheld but reached the export`);
  }
});

test('nested records are covered key by key: each identity type and the pending change', async () => {
  const stored = await repo.getUserByEmail('export-fields@example.com');
  const account = await exportOf(stored.id);

  for (const type of ['password', 'passkey']) {
    const raw = stored.identities.find((i) => i.type === type);
    const out = account.identities.find((i) => i.type === type);
    assert.ok(raw && out, `the fixture or the export lacks a ${type} identity`);
    const withheld = IDENTITY_NOT_EXPORTED[type];
    const missing = Object.keys(raw).filter((k) => !(k in out) && !(k in withheld));
    assert.deepEqual(missing, [], `${type} identity: a stored key neither exported nor withheld by name`);
    for (const k of Object.keys(withheld)) assert.equal(k in out, false, `${type}.${k} reached the export`);
  }

  const missing = Object.keys(stored.pendingEmail)
    .filter((k) => !(k in account.pendingEmail) && !(k in PENDING_EMAIL_NOT_EXPORTED));
  assert.deepEqual(missing, [], 'pendingEmail: a stored key neither exported nor withheld by name');
  assert.equal(account.pendingEmail.email, 'export-fields-new@example.com', 'the address the change waits on');
});

test('the values are the stored ones, and no credential material survives serialisation', async () => {
  const stored = await repo.getUserByEmail('export-fields@example.com');
  const account = await exportOf(stored.id);

  // The fields the audit found missing, one by one — by value, so an export
  // that answered `null` for everything would fail rather than pass.
  for (const k of ['bggUsername', 'notifyRoundInvitations', 'notifyFriendRequests', 'notifiedAt',
    'statsVisible', 'bgStats', 'design', 'designChooserSeen', 'acceptedTermsRevision', 'lastSeenNewsRevision']) {
    assert.deepEqual(account[k], stored[k] === undefined ? null : stored[k], k);
  }
  const passkey = account.identities.find((i) => i.type === 'passkey');
  assert.equal(passkey.name, 'Laptop');
  assert.deepEqual(passkey.transports, ['internal']);
  assert.ok(passkey.createdAt);

  // Whole-payload sweep for every secret the record holds: what matters is that
  // the bytes are not in the file, wherever a future key might have put them.
  const dump = JSON.stringify(account);
  const secrets = [
    stored.identities.find((i) => i.type === 'password').hash,
    stored.pendingEmail.tokenHash,
    ...stored.refreshTokens.map((r) => r.tokenHash),
  ];
  assert.ok(secrets.every((s) => typeof s === 'string' && s.length >= 20), 'a secret probe is not a real hash');
  assert.ok(secrets.length >= 3, 'the fixture holds a password hash, a token hash and a session');
  for (const s of secrets) assert.equal(dump.includes(s), false, 'credential material reached the export');
});

test('a demo account carries its three demo fields, and nothing else is left unanswered', async () => {
  const user = await demo.createDemoAccount('de', 'hash-of-an-ip');
  assert.equal(typeof user, 'object', 'the demo mint was refused');
  const stored = await repo.getUserById(user.id);
  const out = accountExport(stored);
  const missing = Object.keys(stored).filter((k) => !(k in out) && !(k in NOT_EXPORTED));
  assert.deepEqual(missing, [], 'a demo account key neither exported nor withheld by name');
  assert.equal(out.demoIpHash, 'hash-of-an-ip');

  // And an ordinary account does not carry three nulls about a feature it never used.
  const ordinary = accountExport(await repo.getUserByEmail('export-fields@example.com'));
  assert.equal('demo' in ordinary, false);
});

test('every withheld key is one a real account actually stores — the list cannot rot', async () => {
  const stored = await repo.getUserByEmail('export-fields@example.com');
  for (const k of Object.keys(NOT_EXPORTED)) assert.ok(k in stored, `NOT_EXPORTED names ${k}, which nothing stores`);
  for (const [type, keys] of Object.entries(IDENTITY_NOT_EXPORTED)) {
    const raw = stored.identities.find((i) => i.type === type);
    for (const k of Object.keys(keys)) assert.ok(raw && k in raw, `IDENTITY_NOT_EXPORTED names ${type}.${k}, which nothing stores`);
  }
  for (const k of Object.keys(PENDING_EMAIL_NOT_EXPORTED)) {
    assert.ok(k in stored.pendingEmail, `PENDING_EMAIL_NOT_EXPORTED names ${k}, which nothing stores`);
  }
  for (const why of [...Object.values(NOT_EXPORTED), ...Object.values(PENDING_EMAIL_NOT_EXPORTED),
    ...Object.values(IDENTITY_NOT_EXPORTED).flatMap(Object.values)]) {
    assert.ok(why.length > 20, 'a withheld key needs a written reason');
  }
});
