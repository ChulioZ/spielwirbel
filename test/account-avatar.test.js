'use strict';

/*
 * Account profile pictures end to end (#841): the two mutating routes, the
 * batch resolver, and the object lifecycle.
 *
 * The object lifecycle is the half worth the file. A picture is bytes on a paid
 * storage backend, so "the row no longer points at it" is only half of correct —
 * replacing, removing and erasing must all FREE the object, or the app quietly
 * accumulates unreachable billable files with nothing anywhere reporting it
 * (.claude/rules/deletion-paths-must-free-cover-objects.md). Every assertion
 * below therefore checks the disk as well as the response.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DEMO_ENABLED = 'true';
// Raised well above this file's ~10 uploads. The limiter is real and defaults to
// 10 per window, which this file would otherwise exhaust — turning later
// assertions into 429s that look like whatever they were testing. Its own
// ceiling is exercised in the dedicated spec at the foot of the file, against a
// separately-built app, so raising it here hides nothing.
process.env.AVATAR_RATE_LIMIT_MAX = '500';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const sharp = require('sharp');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const store = require('../lib/store');
const { outbox } = require('../lib/mail');
// Imported from the very file the route requires: a hand-copied cap here would
// pass against a route that had drifted off it
// (.claude/rules/shared-constants-across-the-stack.md).
const { AVATAR_MAX_BYTES, AVATAR_SIZE } = require('../public/js/avatar-policy');

const PASSWORD = 'correct horse battery';
let seq = 0;

async function freshAccount(email) {
  seq += 1;
  const reg = await request(app).post('/api/account/register')
    .send({ email, username: `pic_user_${seq}`, password: PASSWORD });
  assert.equal(reg.status, 200);
  // Same short one-time link shape test/account.test.js reads.
  const m = outbox[outbox.length - 1].text.match(/\/[vr]\?t=([a-z0-9]+\.([0-9a-f]+)\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'mail contains a short one-time link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { uid: login.body.user.id, token: login.body.accessToken };
}

const jpeg = (w = 600, h = 400) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c2410c' } }).jpeg().toBuffer();

const post = (token, buf, name = 'me.jpg') => request(app)
  .post('/api/account/me/avatar')
  .set('Authorization', `Bearer ${token}`)
  .attach('avatar', buf, name);

const del = (token) => request(app)
  .delete('/api/account/me/avatar')
  .set('Authorization', `Bearer ${token}`);

const getMe = (token) => request(app)
  .get('/api/account/me').set('Authorization', `Bearer ${token}`);

// The bytes behind a stored '/uploads/<key>' path, on the disk backend the
// suite runs. `null` when the object is gone.
const onDisk = (p) => {
  const file = path.join(store.UPLOAD_DIR, path.basename(p));
  return fs.existsSync(file) ? fs.statSync(file).size : null;
};

test('upload stores a re-encoded square and /me answers its path', async () => {
  const acc = await freshAccount('pic-upload@example.com');
  assert.equal((await getMe(acc.token)).body.avatar, null, 'a new account has no picture');

  const res = await post(acc.token, await jpeg());
  assert.equal(res.status, 200);
  assert.match(res.body.avatar, /^\/uploads\/[A-Za-z0-9_-]+\.webp$/,
    'the stored extension is OURS, derived from the re-encode — never the upload filename');

  // The response is the full projection, so the client can seat `accountUser`
  // from it (.claude/rules/session-start-responses-seat-the-client.md).
  assert.deepEqual(Object.keys(res.body).sort(), Object.keys((await getMe(acc.token)).body).sort());
  assert.equal((await getMe(acc.token)).body.avatar, res.body.avatar);

  const meta = await sharp(path.join(store.UPLOAD_DIR, path.basename(res.body.avatar))).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, AVATAR_SIZE);
  assert.equal(meta.height, AVATAR_SIZE);
});

test('a .jpg filename claiming to be an image does not decide anything', async () => {
  const acc = await freshAccount('pic-sniff@example.com');
  const before = fs.readdirSync(store.UPLOAD_DIR).length;

  const res = await post(acc.token, Buffer.from('GIF89a-ish but really not an image at all'), 'photo.jpg');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_image');
  assert.equal((await getMe(acc.token)).body.avatar, null);
  // The sharpest half: NOTHING was written. A route that saved first and
  // validated after would leave an orphan here with a green status assertion.
  assert.equal(fs.readdirSync(store.UPLOAD_DIR).length, before, 'no object was written for a refused upload');
});

test('replacing a picture frees the one it replaced', async () => {
  const acc = await freshAccount('pic-replace@example.com');
  const first = (await post(acc.token, await jpeg(600, 400))).body.avatar;
  assert.ok(onDisk(first), 'the first object exists');

  const second = (await post(acc.token, await jpeg(300, 900))).body.avatar;
  assert.notEqual(second, first);
  assert.ok(onDisk(second), 'the replacement exists');
  assert.equal(onDisk(first), null, 'the replaced object is gone, not merely unreferenced');
});

test('removing a picture clears the field and frees the object', async () => {
  const acc = await freshAccount('pic-remove@example.com');
  const stored = (await post(acc.token, await jpeg())).body.avatar;

  const res = await del(acc.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.avatar, null);
  assert.equal((await getMe(acc.token)).body.avatar, null);
  assert.equal(onDisk(stored), null);

  // Idempotent: removing again is a no-op, not a 404. The account screen offers
  // the button off a cached record, so a double tap must not read as an error.
  assert.equal((await del(acc.token)).status, 200);
});

test('an oversized upload is refused before anything is decoded', async () => {
  const acc = await freshAccount('pic-large@example.com');
  const before = fs.readdirSync(store.UPLOAD_DIR).length;

  // Incompressible noise, so it really exceeds the cap on the wire.
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), require('node:crypto').randomBytes(AVATAR_MAX_BYTES + 1024)]);
  const res = await post(acc.token, huge);
  assert.equal(res.status, 413);
  assert.equal(res.body.error, 'avatar_too_large');
  assert.equal(fs.readdirSync(store.UPLOAD_DIR).length, before);
});

test('a demo account is refused, and is refused BEFORE the upload is read', async () => {
  const demo = await request(app).post('/api/account/demo').send({});
  assert.equal(demo.status, 200);
  assert.equal(demo.body.user.demo, true);

  const res = await post(demo.body.accessToken, await jpeg());
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'demo_account');
  assert.equal((await getMe(demo.body.accessToken)).body.avatar, null);
});

test('an anonymous caller reaches none of it', async () => {
  // 401 rather than 429: the limiter is generous here (see the env above), so
  // these really are the auth gate's answers.
  assert.equal((await request(app).post('/api/account/me/avatar').attach('avatar', await jpeg(), 'a.jpg')).status, 401);
  assert.equal((await request(app).delete('/api/account/me/avatar')).status, 401);
  assert.equal((await request(app).get('/api/account/avatars?ids=whatever')).status, 401);
});

test('the batch resolver answers every id it was asked about', async () => {
  const withPic = await freshAccount('pic-batch-a@example.com');
  const without = await freshAccount('pic-batch-b@example.com');
  const stored = (await post(withPic.token, await jpeg())).body.avatar;

  const res = await request(app)
    .get(`/api/account/avatars?ids=${withPic.uid},${without.uid},no-such-account`)
    .set('Authorization', `Bearer ${without.token}`);
  assert.equal(res.status, 200);

  // An account with no picture and an id that does not exist BOTH answer null
  // rather than being omitted — the client caches what it asked for, and an
  // absent key would make it re-request that id on every single render.
  assert.equal(res.body.avatars[withPic.uid], stored);
  assert.equal(res.body.avatars[without.uid], null);
  assert.equal(res.body.avatars['no-such-account'], undefined,
    'an unknown id is simply absent; the client fills it in as null');

  assert.deepEqual((await request(app).get('/api/account/avatars?ids=')
    .set('Authorization', `Bearer ${without.token}`)).body, { avatars: {} });

  const many = Array.from({ length: 201 }, (_, i) => `id${i}`).join(',');
  assert.equal((await request(app).get(`/api/account/avatars?ids=${many}`)
    .set('Authorization', `Bearer ${without.token}`)).status, 400);
});

test('erasing the account frees its picture', async () => {
  const acc = await freshAccount('pic-erase@example.com');
  const stored = (await post(acc.token, await jpeg())).body.avatar;
  assert.ok(onDisk(stored));

  // Straight at the repo: the path must be collected while the row is still in
  // hand. Collected after the delete it is unreachable, and the object would be
  // billable forever with nothing reporting it.
  const result = await repo.eraseAccount(acc.uid);
  assert.ok(result.images.includes(stored), 'the avatar is among the freed paths');
});

test('the upload route has its OWN, much lower ceiling than the rest of the account surface', async () => {
  // A separate app, because the ceilings are read when createApp() builds the
  // limiters. Two is enough to show the bucket is this route's own: the general
  // AUTH_RATE_LIMIT_MAX is 100, so a 429 on the third upload cannot be coming
  // from that one.
  //
  // Why this route earns a limiter at all: it is the only endpoint whose cost is
  // DECODING attacker-supplied bytes. The byte cap and the pixel ceiling bound
  // one request; this bounds how many of them a caller may spend.
  const prev = process.env.AVATAR_RATE_LIMIT_MAX;
  process.env.AVATAR_RATE_LIMIT_MAX = '2';
  const { createApp } = require('../lib/app');
  const limited = createApp();
  process.env.AVATAR_RATE_LIMIT_MAX = prev;

  const acc = await freshAccount('pic-limit@example.com');
  const fire = () => request(limited).post('/api/account/me/avatar')
    .set('Authorization', `Bearer ${acc.token}`)
    .attach('avatar', Buffer.from('nope'), 'a.jpg');

  assert.equal((await fire()).status, 400); // spent, and refused on its merits
  assert.equal((await fire()).status, 400);
  const third = await fire();
  assert.equal(third.status, 429);
  assert.equal(third.body.error, 'rate_limited');
});
