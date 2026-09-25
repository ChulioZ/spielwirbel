'use strict';

/* The per-round design route is RETIRED (#1202). Rounds stopped owning a design
 * at the flip — they carry a colour marker (PATCH …/marker) — so nothing may
 * write a palette or a world any more. What a round stored back then is still
 * READ (public/js/round-marker.js maps it onto a marker), which is why the
 * field itself survives; only the writer is gone. It replaces the spec that
 * pinned the route's behaviour. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');

test('POST …/background is gone: 404, and the round is untouched', async () => {
  const round = await createRound(request);
  const res = await request(app)
    .post(`/api/rounds/${round.id}/background`)
    .send({ type: 'theme', id: 'forest', page: '#ecf1e4', accent: '#356427' });
  assert.equal(res.status, 404);

  const got = await request(app).get(`/api/rounds/${round.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.background, null, 'nothing wrote a design onto the round');
});
