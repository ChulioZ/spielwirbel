'use strict';

/*
 * lib/mail.js — both delivery paths, no network ever: the Mailjet path runs
 * against a stubbed global fetch (the same boundary-stub pattern as the lookup
 * provider tests), the unconfigured path against the in-memory outbox.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const mail = require('../lib/mail');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.MJ_APIKEY_PUBLIC;
  delete process.env.MJ_APIKEY_PRIVATE;
  delete process.env.MAIL_FROM;
});

const configure = () => {
  process.env.MJ_APIKEY_PUBLIC = 'pub-key';
  process.env.MJ_APIKEY_PRIVATE = 'priv-key';
};

test('without a Mailjet key pair nothing is sent; the message lands in the outbox', async () => {
  global.fetch = async () => { throw new Error('must not fetch'); };
  const before = mail.outbox.length;
  const res = await mail.send({ to: 'a@example.com', subject: 'S', text: 'T' });
  assert.deepEqual(res, { delivered: false });
  assert.equal(mail.outbox.length, before + 1);
  assert.deepEqual(mail.outbox[mail.outbox.length - 1], { to: 'a@example.com', subject: 'S', text: 'T' });
});

test('with a key pair it POSTs the Mailjet v3.1 payload with Basic auth', async () => {
  configure();
  process.env.MAIL_FROM = 'sender@example.com';
  let captured;
  global.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200 };
  };
  const res = await mail.send({ to: 'b@example.com', subject: 'Betreff', text: 'Inhalt' });
  assert.deepEqual(res, { delivered: true });
  assert.equal(captured.url, 'https://api.mailjet.com/v3.1/send');

  // Basic auth is the key PAIR, base64 of "public:private" — a single-key
  // header would authenticate as nothing and 401 in production only.
  const expected = `Basic ${Buffer.from('pub-key:priv-key').toString('base64')}`;
  assert.equal(captured.opts.headers.authorization, expected);

  const msg = JSON.parse(captured.opts.body).Messages[0];
  assert.equal(msg.From.Email, 'sender@example.com');
  assert.deepEqual(msg.To, [{ Email: 'b@example.com' }]);
  assert.equal(msg.Subject, 'Betreff');
  assert.equal(msg.TextPart, 'Inhalt');
});

// The reason this provider was chosen over staying on Brevo (#439/#440): these
// mails carry one-time credentials, so no open pixel and no link rewriting.
// Sent per message rather than relying on the account default, so a dashboard
// change cannot silently reintroduce tracking.
test('every message explicitly disables open and click tracking', async () => {
  configure();
  let msg;
  global.fetch = async (_u, opts) => { msg = JSON.parse(opts.body).Messages[0]; return { ok: true, status: 200 }; };
  await mail.send({ to: 'b@example.com', subject: 'S', text: 'T' });
  assert.equal(msg.TrackOpens, 'disabled');
  assert.equal(msg.TrackClicks, 'disabled');
});

// Mailjet has a first-class ReplyTo, unlike Scaleway's additional_headers. If
// this regresses, replies to a contact message go to the no-reply sender
// instead of the visitor.
test('replyTo becomes a first-class ReplyTo property', async () => {
  configure();
  let msg;
  global.fetch = async (_u, opts) => { msg = JSON.parse(opts.body).Messages[0]; return { ok: true, status: 200 }; };
  await mail.send({ to: 'op@example.com', subject: 'S', text: 'T', replyTo: 'visitor@example.com' });
  assert.deepEqual(msg.ReplyTo, { Email: 'visitor@example.com' });
});

test('without replyTo no ReplyTo property is sent at all', async () => {
  configure();
  let msg;
  global.fetch = async (_u, opts) => { msg = JSON.parse(opts.body).Messages[0]; return { ok: true, status: 200 }; };
  await mail.send({ to: 'op@example.com', subject: 'S', text: 'T' });
  assert.equal('ReplyTo' in msg, false);
});

test('a non-ok Mailjet response rejects (callers decide whether that is fatal)', async () => {
  configure();
  global.fetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(() => mail.send({ to: 'c@example.com', subject: 'S', text: 'T' }), /HTTP 401/);
});

// Mailjet authenticates with a key pair, so a public key on its own is not a
// working configuration. The contact form (#224) keys its fail-loud 502 off
// exactly this.
test('isConfigured() requires both keys and MAIL_FROM together', async () => {
  assert.equal(mail.isConfigured(), false);
  process.env.MJ_APIKEY_PUBLIC = 'pub-key';
  assert.equal(mail.isConfigured(), false);
  process.env.MJ_APIKEY_PRIVATE = 'priv-key';
  assert.equal(mail.isConfigured(), false);
  process.env.MAIL_FROM = 'sender@example.com';
  assert.equal(mail.isConfigured(), true);
});
