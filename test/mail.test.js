'use strict';

/*
 * lib/mail.js — both delivery paths, no network ever: the Scaleway path runs
 * against a stubbed global fetch (the same boundary-stub pattern as the lookup
 * provider tests), the unconfigured path against the in-memory outbox.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const mail = require('../lib/mail');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.SCW_SECRET_KEY;
  delete process.env.SCW_PROJECT_ID;
  delete process.env.SCW_REGION;
  delete process.env.MAIL_FROM;
});

test('without SCW_SECRET_KEY nothing is sent; the message lands in the outbox', async () => {
  global.fetch = async () => { throw new Error('must not fetch'); };
  const before = mail.outbox.length;
  const res = await mail.send({ to: 'a@example.com', subject: 'S', text: 'T' });
  assert.deepEqual(res, { delivered: false });
  assert.equal(mail.outbox.length, before + 1);
  assert.deepEqual(mail.outbox[mail.outbox.length - 1], { to: 'a@example.com', subject: 'S', text: 'T' });
});

test('with SCW_SECRET_KEY it POSTs the Scaleway payload with the auth-token header', async () => {
  process.env.SCW_SECRET_KEY = 'test-key';
  process.env.SCW_PROJECT_ID = 'proj-123';
  process.env.MAIL_FROM = 'sender@example.com';
  let captured;
  global.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200 };
  };
  const res = await mail.send({ to: 'b@example.com', subject: 'Betreff', text: 'Inhalt' });
  assert.deepEqual(res, { delivered: true });
  assert.equal(captured.url, 'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails');
  assert.equal(captured.opts.headers['X-Auth-Token'], 'test-key');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.from.email, 'sender@example.com');
  assert.deepEqual(body.to, [{ email: 'b@example.com' }]);
  assert.equal(body.project_id, 'proj-123');
  assert.equal(body.subject, 'Betreff');
  assert.equal(body.text, 'Inhalt');
});

// The region is read per call (not bound at module load), so a redeploy in
// another region needs only the env var — same reasoning as lib/app.js's
// rate-limit ceilings.
test('SCW_REGION overrides the fr-par default in the endpoint', async () => {
  process.env.SCW_SECRET_KEY = 'test-key';
  process.env.SCW_PROJECT_ID = 'proj-123';
  process.env.SCW_REGION = 'nl-ams';
  let url;
  global.fetch = async (u) => { url = u; return { ok: true, status: 200 }; };
  await mail.send({ to: 'b@example.com', subject: 'S', text: 'T' });
  assert.match(url, /regions\/nl-ams\/emails$/);
});

// Scaleway has no dedicated reply-to field, so the contact form's Reply-To
// (#224) rides in additional_headers. If this shape ever regresses, replies to
// a contact message would go to the no-reply sender instead of the visitor.
test('replyTo becomes a Reply-To entry in additional_headers', async () => {
  process.env.SCW_SECRET_KEY = 'test-key';
  process.env.SCW_PROJECT_ID = 'proj-123';
  let body;
  global.fetch = async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200 }; };
  await mail.send({ to: 'op@example.com', subject: 'S', text: 'T', replyTo: 'visitor@example.com' });
  assert.deepEqual(body.additional_headers, [{ key: 'Reply-To', value: 'visitor@example.com' }]);
});

test('without replyTo no additional_headers are sent at all', async () => {
  process.env.SCW_SECRET_KEY = 'test-key';
  process.env.SCW_PROJECT_ID = 'proj-123';
  let body;
  global.fetch = async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200 }; };
  await mail.send({ to: 'op@example.com', subject: 'S', text: 'T' });
  assert.equal('additional_headers' in body, false);
});

test('a non-ok Scaleway response rejects (callers decide whether that is fatal)', async () => {
  process.env.SCW_SECRET_KEY = 'test-key';
  process.env.SCW_PROJECT_ID = 'proj-123';
  global.fetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(() => mail.send({ to: 'c@example.com', subject: 'S', text: 'T' }), /HTTP 401/);
});

// A key without a project id is not a working configuration — Scaleway rejects
// the send — so isConfigured() must not report it as one. The contact form
// (#224) keys its fail-loud 502 off exactly this.
test('isConfigured() requires key, project id and MAIL_FROM together', async () => {
  assert.equal(mail.isConfigured(), false);
  process.env.SCW_SECRET_KEY = 'test-key';
  assert.equal(mail.isConfigured(), false);
  process.env.SCW_PROJECT_ID = 'proj-123';
  assert.equal(mail.isConfigured(), false);
  process.env.MAIL_FROM = 'sender@example.com';
  assert.equal(mail.isConfigured(), true);
});
