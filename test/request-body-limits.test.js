'use strict';

/*
 * How large a JSON request body each surface accepts.
 *
 * The app parses JSON once, globally, at the default 100 KB — which is the right
 * bound for the whole open surface (the parser runs ahead of the auth gate, so
 * an unauthenticated request is buffered before anything checks who is asking).
 *
 * One route contradicted it. importSchema (lib/routes/lookup.js) permits 2000
 * externalIds plus a `covers` map of URLs and an `editions` map, and the client
 * sends the whole selection in ONE request — so the server's own schema promised
 * far more than the transport would carry. Measured against a realistic BGG
 * payload (~140-char cover URL + a short edition per game), the 100 KB cap
 * refused the request at ~431 games, well inside the schema's own 2000.
 *
 * Latent rather than live, because the covers map is filled only by the edition
 * picker one game at a time on explicit user choice — an ids-only import of all
 * 2000 games is ~18 KB. But the schema and the transport must not disagree, and
 * the failure mode is silent: the parser rejects before routing, so the route
 * never runs and the user sees only a generic error.
 *
 * So the import route — and ONLY it — gets a larger parser, mounted ahead of the
 * global one. These specs pin both halves: the raised ceiling where the schema
 * needs it, and the unchanged 100 KB everywhere else.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');

// A body over the global 100 KB cap but inside the import route's own ceiling.
// Shaped like a real import so the size is representative rather than arbitrary.
function importBody(games) {
  const externalIds = [];
  const covers = {};
  const editions = {};
  for (let i = 0; i < games; i++) {
    const id = String(100000 + i);
    externalIds.push(id);
    covers[id] = `https://cf.geekdo-images.com/${'x'.repeat(107)}.jpg`;
    editions[id] = { name: 'Deutsche Erstauflage', year: 2019, languages: ['Deutsch'] };
  }
  return { externalIds, covers, editions };
}

const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
const IMPORT_PATH = '/api/rounds/some-round-id/lookup/import?provider=bgg';

test('the fixture really is over the global cap (or these specs prove nothing)', () => {
  // Anti-vacuous: if this body fitted in 100 KB, every assertion below would
  // pass against the unfixed app.
  assert.ok(bytes(importBody(600)) > 100 * 1024, 'fixture must exceed 100 KB');
  assert.ok(bytes(importBody(600)) < 1024 * 1024, 'fixture must fit the import ceiling');
});

test('the import route accepts a body larger than the global 100 KB cap', async () => {
  const res = await request(app).post(IMPORT_PATH).send(importBody(600));
  assert.notEqual(res.status, 413, 'the import parser must not refuse a schema-legal body');
  // Stronger than "not 413", and the reason this asserts an exact status: 404
  // is the ROUTE talking. Reaching it means the body was parsed AND passed
  // importSchema — a 400 would mean it arrived malformed, and a 413 that it
  // never arrived. This is what proves the large body is genuinely usable
  // rather than merely un-rejected.
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Round not found');
});

test('a body over the import ceiling is still refused', async () => {
  // The raised limit is a ceiling, not its removal — the route stays bounded.
  const huge = { externalIds: ['1'], blob: 'x'.repeat(2 * 1024 * 1024) };
  const res = await request(app).post(IMPORT_PATH).send(huge);
  assert.equal(res.status, 413);
});

test('every OTHER api route still refuses a body over 100 KB', async () => {
  // The global bound is what keeps the unauthenticated surface cheap, so the
  // per-route raise must not have leaked into it.
  for (const path of ['/api/rounds', '/api/account/login', '/api/rounds/x/games']) {
    const res = await request(app).post(path).send(importBody(600));
    assert.equal(res.status, 413, `${path} should still cap at 100 KB`);
  }
});

test('the raised limit is scoped to the import path, not the lookup router', async () => {
  // A sibling route under the same mount must not inherit the ceiling — the
  // guard is the exact path, so a prefix match would quietly widen it.
  const res = await request(app)
    .post('/api/rounds/some-round-id/lookup/collection?provider=bgg')
    .send(importBody(600));
  assert.equal(res.status, 413);
});

test('a small body on the import path is unaffected', async () => {
  const res = await request(app).post(IMPORT_PATH).send({ externalIds: ['13'] });
  assert.notEqual(res.status, 413);
});
