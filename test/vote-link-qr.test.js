'use strict';

/* The shared vote link as a QR code (#1170) — the picture people scan off the
 * host's screen instead of waiting for a message.
 *
 * Its own file rather than a section of vote-link.test.js: that spec is about
 * the token as a CAPABILITY (what it opens, what it must never reveal, when it
 * dies), and this one is about a picture agreeing with a URL. They are edited
 * for different reasons, and together they are over the file budget.
 *
 * The property no other instrument can see is that the code must lead where the
 * LINK leads. A QR route could hand back a flawless picture of the wrong URL —
 * valid to every scanner, a 404 to every phone — and nothing in the app, the
 * suite or a browser check would notice, because both halves are individually
 * correct. So these tests decode nothing (that would only re-run the encoder's
 * own arithmetic); they pin the two things that can actually drift: that the
 * route refuses exactly what minting refuses, and that the URL the code carries
 * is built from the SAME path helper the client shares.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const QRCode = require('qrcode');
const { app, createRound } = require('./helpers');
const { votePath } = require('../public/js/vote-path');

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) {
    req.field(k, String(v));
  }
  return (await req).body;
}

// A round with two games, drawn as a per-device session and shared as a link.
async function setup() {
  const round = await createRound(request);
  await addGame(round.id, 'A');
  await addGame(round.id, 'B');
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 });
  const session = res.body.session;
  const mint = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link`)
    .send({});
  return { round, session, token: mint.body.token };
}

test('the QR code is drawn for this session\'s own live link', async () => {
  const { round, session, token } = await setup();
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link/qr`)
    .send({});
  assert.equal(res.status, 200);
  assert.match(res.body.svg, /^<svg /);

  // Minting is idempotent, so the code must draw the link already in the group
  // chat rather than a fresh one — the same guarantee the share button gives.
  const again = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link`)
    .send({});
  assert.equal(again.body.token, token);
});

test('the code is a live capability, so nothing may cache it', async () => {
  const { round, session } = await setup();
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link/qr`)
    .send({});
  assert.match(res.headers['cache-control'], /no-store/);
});

test('a closed or cancelled session has no code either', async () => {
  const closed = await setup();
  await request(app).post(`/api/rounds/${closed.round.id}/sessions/${closed.session.id}/close`).send({});
  const afterClose = await request(app)
    .post(`/api/rounds/${closed.round.id}/sessions/${closed.session.id}/vote-link/qr`)
    .send({});
  assert.equal(afterClose.status, 400);
  assert.equal(afterClose.body.error, 'voting_closed');

  const cancelled = await setup();
  await request(app).post(`/api/rounds/${cancelled.round.id}/sessions/${cancelled.session.id}/cancel`).send({});
  const afterCancel = await request(app)
    .post(`/api/rounds/${cancelled.round.id}/sessions/${cancelled.session.id}/vote-link/qr`)
    .send({});
  assert.equal(afterCancel.status, 400);

  // And an unknown session is the mint route's 404, not a picture of nothing.
  const missing = await request(app)
    .post(`/api/rounds/${closed.round.id}/sessions/nope/vote-link/qr`)
    .send({});
  assert.equal(missing.status, 404);
});

/* The one that would otherwise go unnoticed: which URL the modules encode.
 *
 * Asserted by re-encoding the URL this test builds itself, from the shared
 * `votePath` and the Host the request carried, and comparing the two pictures
 * byte for byte. A server that hard-coded its own path shape, dropped the
 * origin, or encoded the bare token produces different modules and fails here —
 * whereas a test that merely checked „is it an SVG" passes against all three.
 */
test('the code encodes the vote URL on the requesting origin, not something else', async () => {
  const { round, session, token } = await setup();
  const res = await request(app)
    .post(`/api/rounds/${round.id}/sessions/${session.id}/vote-link/qr`)
    .set('Host', 'spielabend.example')
    .send({});
  const expected = await QRCode.toString(`http://spielabend.example${votePath(token)}`, {
    type: 'svg', errorCorrectionLevel: 'M', margin: 2,
  });
  assert.equal(res.body.svg, expected);

  // The control: the same encoder over the bare token draws something else, so
  // the equality above is a real discrimination rather than a tautology.
  const bare = await QRCode.toString(token, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  assert.notEqual(res.body.svg, bare);
});
