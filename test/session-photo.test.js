'use strict';

/*
 * One photo per played session (#1774): upload, replace, delete, who may see it,
 * and that every path which drops a session drops its stored object too.
 *
 * Accounts are ON, because the two things this file is most about only exist
 * there: /uploads authorization by tenant and grant (lib/upload-access.js), and
 * the per-tenant photo cap (lib/quota.js is inert with accounts off).
 *
 * The object check reads the disk backend's own folder, which is what the
 * test's temp DATA_DIR uses — the S3 backend is covered by the same storage
 * contract in test/storage.test.js.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

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
const { resetUploadAccessCache } = require('../lib/upload-access');
const { renderPhoto } = require('../lib/session-photo');
const { PHOTO_MAX_DIM, PHOTO_MAX_BYTES } = require('../public/js/photo-policy');

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

// A camera photo, as a phone writes it: GPS in the EXIF, and a portrait shot
// stored as LANDSCAPE pixels plus Orientation 6 ("rotate 90° clockwise to view").
async function phonePhoto({ width = 400, height = 300, orientation = 1 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: '#2f6b4d' } })
    // The orientation goes through withMetadata: sharp writes the tag from
    // there and ignores an Orientation key inside withExif.
    .withMetadata({ orientation })
    .withExifMerge({
      IFD0: { Make: 'TestCam' },
      GPS: {
        GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 0/1',
        GPSLongitudeRef: 'E', GPSLongitude: '13/1 24/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
}

const objectPath = (image) => path.join(UPLOAD_DIR, path.basename(image));
const stored = (image) => fs.existsSync(objectPath(image));

// A round with one game and one PLAYED session of it (direct pick, then finished).
async function playedSession(token, name = 'Freitagsrunde') {
  const round = (await request(app).post('/api/rounds').set(auth(token))
    .send({ name, members: ['Anna'] })).body;
  const game = (await request(app).post(`/api/rounds/${round.id}/games`).set(auth(token))
    .field('title', 'Catan').field('minPlayers', '1').field('maxPlayers', '6')).body;
  const session = (await request(app).post(`/api/rounds/${round.id}/sessions`).set(auth(token))
    .send({ gameId: game.id })).body.session;
  const fin = await request(app).post(`/api/rounds/${round.id}/sessions/${session.id}/finish`)
    .set(auth(token)).send({ finished: true, winnerIds: [] });
  assert.equal(fin.status, 200);
  assert.equal(fin.body.finished, true);
  return { round, game, session };
}

const photoUrl = (rid, sid) => `/api/rounds/${rid}/sessions/${sid}/photo`;
const putPhoto = async (token, rid, sid, buf) => request(app).put(photoUrl(rid, sid))
  .set(auth(token)).attach('photo', buf || await phonePhoto(), 'IMG_0001.jpg');

test.beforeEach(() => resetUploadAccessCache());

test('the fixture really carries GPS and an orientation tag', async () => {
  // Anti-vacuous: stripping metadata an image never had proves nothing.
  const meta = await sharp(await phonePhoto({ orientation: 6 })).metadata();
  assert.ok(meta.exif && meta.exif.includes(Buffer.from('TestCam')));
  assert.equal(meta.orientation, 6);
});

test('the encoder strips EXIF/GPS, applies the orientation, and caps the long edge', async () => {
  const out = await renderPhoto(await phonePhoto({ width: 3000, height: 2000, orientation: 6 }));
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined, 'no EXIF block survives');
  assert.equal(out.includes(Buffer.from('TestCam')), false, 'not even the maker string');
  // Orientation 6 on 3000×2000 pixels is a PORTRAIT photo: rotated upright and
  // then capped, it is 2000/3000 of the cap wide and the cap tall. Without the
  // .rotate() it would be stored lying on its side, 1280×853.
  assert.equal(meta.height, PHOTO_MAX_DIM);
  assert.equal(meta.width, Math.round((PHOTO_MAX_DIM * 2000) / 3000));
});

test('the encoder never upscales and refuses bytes that are not an image', async () => {
  const meta = await sharp(await renderPhoto(await phonePhoto({ width: 300, height: 200 }))).metadata();
  assert.deepEqual([meta.width, meta.height], [300, 200]);
  assert.equal(await renderPhoto(Buffer.from('not an image at all, only text')), null);
});

test('upload, replace and delete — each replaced or removed object is freed', async () => {
  const owner = await makeAccount('photo-life@example.com');
  const { round, session } = await playedSession(owner.token);

  const first = await putPhoto(owner.token, round.id, session.id);
  assert.equal(first.status, 200);
  assert.match(first.body.photo, /^\/uploads\/[0-9a-f]+\.webp$/);
  assert.ok(stored(first.body.photo), 'the object is written');
  // What is on disk is our encoder's output, not the upload: no GPS in the bytes.
  assert.equal(fs.readFileSync(objectPath(first.body.photo)).includes(Buffer.from('TestCam')), false);
  const snap = await repo.forTenant(owner.user.tenantId).getSession(round.id, session.id);
  assert.equal(snap.photo, first.body.photo, 'the session points at it');

  const second = await putPhoto(owner.token, round.id, session.id);
  assert.equal(second.status, 200);
  assert.notEqual(second.body.photo, first.body.photo);
  assert.ok(stored(second.body.photo));
  assert.equal(stored(first.body.photo), false, 'replacing frees the old object');

  const del = await request(app).delete(photoUrl(round.id, session.id)).set(auth(owner.token));
  assert.equal(del.status, 200);
  assert.equal('photo' in del.body, false, 'the key is absent, never null');
  assert.equal(stored(second.body.photo), false, 'removing frees the object');

  // Idempotent: removing a photo the session no longer has is a plain 200.
  assert.equal((await request(app).delete(photoUrl(round.id, session.id)).set(auth(owner.token))).status, 200);
});

test('only a played session takes a photo, and a refused upload writes nothing', async () => {
  const owner = await makeAccount('photo-open@example.com');
  const { round, game } = await playedSession(owner.token);
  const open = (await request(app).post(`/api/rounds/${round.id}/sessions`).set(auth(owner.token))
    .send({ gameId: game.id })).body.session;
  const before = fs.readdirSync(UPLOAD_DIR).length;

  const res = await putPhoto(owner.token, round.id, open.id);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'not_played');
  assert.equal(fs.readdirSync(UPLOAD_DIR).length, before, 'no object was left behind');

  assert.equal((await putPhoto(owner.token, round.id, 'nope')).status, 404);
  const second = await playedSession(owner.token, 'Zwei');
  const junk = await putPhoto(owner.token, second.round.id, second.session.id,
    Buffer.from('GIF89a but then nothing a decoder could ever read as pixels'));
  assert.equal(junk.status, 400);
  assert.equal(junk.body.error, 'invalid_image');
});

test('an upload over the byte cap is refused with its own code', async () => {
  const owner = await makeAccount('photo-big@example.com');
  const { round, session } = await playedSession(owner.token);
  const big = Buffer.alloc(PHOTO_MAX_BYTES + 1, 0xff);
  const res = await putPhoto(owner.token, round.id, session.id, big);
  assert.equal(res.status, 413);
  assert.equal(res.body.error, 'photo_too_large');
});

test('the photo is served to its round only — never another tenant, a revoked grantee or an anonymous caller', async () => {
  const owner = await makeAccount('photo-see-owner@example.com');
  const grantee = await makeAccount('photo-see-grantee@example.com');
  const stranger = await makeAccount('photo-see-stranger@example.com');
  const { round, session } = await playedSession(owner.token, 'Geteilte Runde');
  // A second round of the SAME tenant, so the grant is shown to reach exactly
  // the granted round's photos and not everything the owner has.
  const other = await playedSession(owner.token, 'Privatrunde');
  const shared = (await putPhoto(owner.token, round.id, session.id)).body.photo;
  const privat = (await putPhoto(owner.token, other.round.id, other.session.id)).body.photo;

  await repo.createGrant({ roundId: round.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id });
  const get = (image, token) => (token ? request(app).get(image).set(auth(token)) : request(app).get(image));

  assert.equal((await get(shared, owner.token)).status, 200);
  assert.equal((await get(shared, grantee.token)).status, 200);
  assert.equal((await get(privat, grantee.token)).status, 404, 'the grant reaches one round, not the tenant');
  assert.equal((await get(shared, stranger.token)).status, 404, 'another tenant');
  // The shared vote link is used without any account, so this is its access.
  assert.equal((await get(shared)).status, 401, 'an anonymous caller');

  // A grantee may set the photo too: running the evening is an ordinary write.
  assert.equal((await putPhoto(grantee.token, round.id, session.id)).status, 200);
  const current = (await repo.forTenant(owner.user.tenantId).getSession(round.id, session.id)).photo;

  await request(app).delete(`/api/rounds/${round.id}/shares/${grantee.user.id}`).set(auth(owner.token));
  assert.equal((await get(current, grantee.token)).status, 404, 'a revoked grantee loses it at once');
  assert.equal((await get(current, owner.token)).status, 200);
});

test('the public ballot of the round carries no photo', async () => {
  const owner = await makeAccount('photo-ballot@example.com');
  const { round, game, session } = await playedSession(owner.token);
  const photo = (await putPhoto(owner.token, round.id, session.id)).body.photo;
  const open = (await request(app).post(`/api/rounds/${round.id}/sessions`).set(auth(owner.token))
    .send({ count: 5 })).body.session;
  assert.ok(open, `a voting session over ${game.title}`);
  const link = await request(app).post(`/api/rounds/${round.id}/sessions/${open.id}/vote-link`)
    .set(auth(owner.token)).send({});
  assert.equal(link.status, 201);
  const ballot = await request(app).get(`/api/vote/${link.body.token}`);
  assert.equal(ballot.status, 200);
  assert.equal(JSON.stringify(ballot.body).includes(photo), false);
  assert.equal(JSON.stringify(ballot.body).includes('/uploads/'), false);
});

test('deleting the session, the round or the played game frees the photo', async () => {
  const owner = await makeAccount('photo-gone@example.com');

  const a = await playedSession(owner.token, 'Session weg');
  const pa = (await putPhoto(owner.token, a.round.id, a.session.id)).body.photo;
  assert.equal((await request(app).delete(`/api/rounds/${a.round.id}/sessions/${a.session.id}`)
    .set(auth(owner.token))).status, 200);
  assert.equal(stored(pa), false, 'deleting the session');

  const b = await playedSession(owner.token, 'Runde weg');
  const pb = (await putPhoto(owner.token, b.round.id, b.session.id)).body.photo;
  assert.equal((await request(app).delete(`/api/rounds/${b.round.id}`).set(auth(owner.token))).status, 200);
  assert.equal(stored(pb), false, 'deleting the round');

  // A game delete takes every session that held only it, and with it the photo
  // (lib/repo scrubGames). The game must be off the shelf before it may go.
  const c = await playedSession(owner.token, 'Spiel weg');
  const pc = (await putPhoto(owner.token, c.round.id, c.session.id)).body.photo;
  await request(app).post(`/api/rounds/${c.round.id}/games/${c.game.id}/retire`).set(auth(owner.token)).send({});
  assert.equal((await request(app).delete(`/api/rounds/${c.round.id}/games/${c.game.id}`)
    .set(auth(owner.token))).status, 200);
  assert.equal(stored(pc), false, 'deleting the played game');
});

test('the per-tenant cap refuses a FIRST photo at the ceiling, never a replacement', async (t) => {
  process.env.MAX_PHOTOS_PER_TENANT = '1';
  t.after(() => { delete process.env.MAX_PHOTOS_PER_TENANT; });
  const owner = await makeAccount('photo-cap@example.com');
  const a = await playedSession(owner.token, 'Eins');
  const b = await playedSession(owner.token, 'Zwei');

  assert.equal((await putPhoto(owner.token, a.round.id, a.session.id)).status, 200);
  const refused = await putPhoto(owner.token, b.round.id, b.session.id);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'quota_photos');
  // At the ceiling, swapping the one photo for a better one still works.
  assert.equal((await putPhoto(owner.token, a.round.id, a.session.id)).status, 200);
  // And removing it frees the slot.
  await request(app).delete(photoUrl(a.round.id, a.session.id)).set(auth(owner.token));
  assert.equal((await putPhoto(owner.token, b.round.id, b.session.id)).status, 200);
});
