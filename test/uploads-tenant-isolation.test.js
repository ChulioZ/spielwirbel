'use strict';

/*
 * /uploads is served only to the tenant that owns the object (issue #955).
 *
 * Before this, the uploads gate asked one question — "is this a valid account?"
 * — so ANY account, including a free guest-demo one, could fetch ANY object by
 * key. Keys are 16 hex chars, so the attack was never enumeration; it was a
 * KNOWN key. The public ballot (/api/vote/:token) hands cover paths to whoever
 * holds a link, a revoked grantee keeps the paths they already saw, and a pasted
 * URL outlives the round it came from.
 *
 * So the cases below are all "someone who legitimately learned a key". The
 * refusal is asserted as 404 rather than 403 throughout: a 403 would confirm the
 * object exists, which is most of what a probe wants.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DEMO_ENABLED = 'true';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const sharp = require('sharp');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { UPLOAD_DIR } = require('../lib/store');
const { outbox } = require('../lib/mail');
const { ACCESS_COOKIE } = require('../lib/accounts');
const { resetUploadAccessCache } = require('../lib/upload-access');

const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function makeAccount(email) {
  await request(app).post('/api/account/register')
    .send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

const jpeg = () =>
  sharp({ create: { width: 240, height: 160, channels: 3, background: '#c2410c' } }).jpeg().toBuffer();

// A round with one game carrying an UPLOADED cover (not a hotlink — those are
// provider URLs and never touch /uploads at all). Returns the stored key path.
async function roundWithCover(token, name = 'Freitagsrunde') {
  const round = (await request(app).post('/api/rounds').set(auth(token))
    .send({ name, members: ['Owner'] })).body;
  const add = await request(app).post(`/api/rounds/${round.id}/games`).set(auth(token))
    .field('title', 'Catan').field('minPlayers', '2').field('maxPlayers', '4')
    .attach('image', await jpeg(), 'cover.jpg');
  assert.equal(add.status, 201);
  assert.ok(add.body.image.startsWith('/uploads/'), 'the cover is hosted by us');
  return { round, image: add.body.image };
}

const get = (image, token) => (token
  ? request(app).get(image).set(auth(token))
  : request(app).get(image));

test.beforeEach(() => resetUploadAccessCache());

test('a cover is served to its own tenant, and to no other account', async () => {
  const owner = await makeAccount('up-owner@example.com');
  const stranger = await makeAccount('up-stranger@example.com');
  const { image } = await roundWithCover(owner.token);

  // The owner's own cover still renders — including on the very first request
  // after the upload, which is the regression a negative cache would cause.
  assert.equal((await get(image, owner.token)).status, 200);

  // A perfectly valid account that simply is not this tenant. This is the whole
  // issue: before #955 this was a 200.
  assert.equal((await get(image, stranger.token)).status, 404);

  // And an unauthenticated caller is still refused by the gate in front, with
  // the gate's own 401 — that layer is unchanged.
  assert.equal((await get(image)).status, 401);
});

test('a refused key is indistinguishable from a key that does not exist', async () => {
  const owner = await makeAccount('up-shape-owner@example.com');
  const stranger = await makeAccount('up-shape-stranger@example.com');
  const { image } = await roundWithCover(owner.token);

  const refused = await get(image, stranger.token);
  const missing = await get('/uploads/0123456789abcdef.webp', stranger.token);
  assert.equal(refused.status, 404);
  assert.equal(missing.status, 404);
  // Same status AND same body: a 403, or a distinct body, would confirm which
  // of the two keys is real.
  assert.equal(refused.text, missing.text);
});

test('a guest-demo account cannot read a real tenant cover', async () => {
  const owner = await makeAccount('up-demo-owner@example.com');
  const { image } = await roundWithCover(owner.token);

  // The cheapest identity in the app: no registration, no e-mail, one request.
  const demo = await request(app).post('/api/account/demo').send({});
  assert.equal(demo.status, 200);
  assert.equal(demo.body.user.demo, true);

  assert.equal((await get(image, demo.body.accessToken)).status, 404);
  assert.equal((await get(image, owner.token)).status, 200);
});

test('a grantee reads the shared round\'s covers, and stops the moment the share is revoked', async () => {
  const owner = await makeAccount('up-grant-owner@example.com');
  const grantee = await makeAccount('up-grant-grantee@example.com');
  const outsider = await makeAccount('up-grant-outsider@example.com');

  const shared = await roundWithCover(owner.token, 'Geteilte Runde');
  // A SECOND round in the same tenant, to prove the grant reaches exactly the
  // granted round's covers and not everything the owner has.
  const private_ = await roundWithCover(owner.token, 'Privatrunde');

  await repo.createGrant({
    roundId: shared.round.id,
    ownerTenantId: owner.user.tenantId,
    userId: grantee.user.id,
  });

  assert.equal((await get(shared.image, grantee.token)).status, 200);
  assert.equal((await get(private_.image, grantee.token)).status, 404);
  // Someone with no grant at all gets nothing either way.
  assert.equal((await get(shared.image, outsider.token)).status, 404);

  // Revoking the share must take effect at once — this is why grants are never
  // cached, unlike the owner and tenant lookups.
  const revoke = await request(app)
    .delete(`/api/rounds/${shared.round.id}/shares/${grantee.user.id}`)
    .set(auth(owner.token));
  assert.equal(revoke.status, 204);
  assert.equal((await get(shared.image, grantee.token)).status, 404);
  assert.equal((await get(shared.image, owner.token)).status, 200);
});

test('a profile picture stays readable by any signed-in account, but not anonymously', async () => {
  const me = await makeAccount('up-face-me@example.com');
  const other = await makeAccount('up-face-other@example.com');

  const up = await request(app).post('/api/account/me/avatar').set(auth(me.token))
    .attach('avatar', await jpeg(), 'me.jpg');
  assert.equal(up.status, 200);
  const face = (await request(app).get('/api/account/me').set(auth(me.token))).body.avatar;
  assert.ok(face.startsWith('/uploads/'));

  // Deliberate, not an oversight: faces are cross-tenant by design (#558/#841)
  // and the privacy policy §16 says so. Narrowing this to the owning tenant
  // would blank every avatar in a shared round and the friends list.
  assert.equal((await get(face, other.token)).status, 200);
  assert.equal((await get(face, me.token)).status, 200);
  assert.equal((await get(face)).status, 401);
});

test('an object nothing references is served to nobody, including its uploader', async () => {
  const owner = await makeAccount('up-orphan@example.com');

  // An orphan is a real state: a cover saved by a request that then failed
  // validation, or one whose game row was taken down. Written straight to the
  // upload dir so the bytes exist and only the reference is missing.
  const key = 'aaaaaaaaaaaaaaaa.webp';
  fs.writeFileSync(path.join(UPLOAD_DIR, key), await jpeg());
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, key)), 'the bytes are really there');

  assert.equal((await get('/uploads/' + key, owner.token)).status, 404);
});

test('the sa access cookie carries identity, not merely admission', async () => {
  // The cookie is the real browser path — an <img> GET cannot send a Bearer
  // header — so the ownership check must read the caller off it too. A version
  // that only understood the header would fall back to "no tenant" and refuse
  // the owner their own covers in an actual browser while every Bearer-driven
  // test above stayed green.
  const owner = await makeAccount('up-cookie-owner@example.com');
  const stranger = await makeAccount('up-cookie-stranger@example.com');
  const { image } = await roundWithCover(owner.token);

  const withCookie = (token) => request(app).get(image)
    .set('Cookie', `${ACCESS_COOKIE}=${token}`);

  assert.equal((await withCookie(owner.token)).status, 200);
  assert.equal((await withCookie(stranger.token)).status, 404);
});

test('a malformed key is refused rather than thrown on', async () => {
  const owner = await makeAccount('up-malformed@example.com');
  // '%ZZ' is not a valid escape, so decodeURIComponent throws. Nothing can own
  // such a key; the point is that it 404s like any other miss instead of
  // reaching the error handler as a 500.
  const res = await request(app).get('/uploads/%ZZ.webp').set(auth(owner.token));
  assert.equal(res.status, 404);
});

test('the owner lookup is cached, and the cached answer expires', async (t) => {
  // The cache is why this middleware is affordable on a Regal screen (~30 image
  // GETs in parallel), and its TTL is the honest limit of the whole design: for
  // up to a minute the AUTHORIZATION layer still believes a taken-down cover has
  // an owner. That is safe only because a real takedown also deletes the bytes,
  // so storage.serve refuses it anyway — this test pins the part that is not
  // safe on its own, so a future TTL change has to look at it.
  //
  // Date only: setTimeout stays real, and the tick below stays well inside the
  // 15-minute access-token TTL so the caller's credential does not expire too.
  const owner = await makeAccount('up-cache@example.com');
  const { image } = await roundWithCover(owner.token);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.after(() => t.mock.timers.reset());

  assert.equal((await get(image, owner.token)).status, 200);

  // Drop the game's reference WITHOUT deleting the object, which is what
  // separates the cache's answer from the storage backend's.
  assert.equal(await repo.takedownImage(image), 1);
  assert.equal((await get(image, owner.token)).status, 200, 'still cached');

  t.mock.timers.tick(61_000);
  assert.equal((await get(image, owner.token)).status, 404, 'the cached owner expired');
});
