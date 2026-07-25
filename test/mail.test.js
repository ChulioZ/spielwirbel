'use strict';

/*
 * lib/mail.js — both delivery paths, no network ever: the SMTP path runs
 * against a stubbed nodemailer transport (the same boundary-stub pattern the
 * lookup provider tests use for fetch), the unconfigured path against the
 * in-memory outbox.
 *
 * Stubbing works because lib/mail.js calls nodemailer.createTransport() at SEND
 * time, not at require time, and both files resolve to the same module
 * instance — so replacing the property here is seen there.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

const mail = require('../lib/mail');

const realCreateTransport = nodemailer.createTransport;
afterEach(() => {
  nodemailer.createTransport = realCreateTransport;
  for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_FROM_NAME']) {
    delete process.env[k];
  }
});

const configure = () => {
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.SMTP_USER = 'no-reply@example.test';
  process.env.SMTP_PASS = 'app-password';
};

// Captures both what the transport was built with and what was handed to it.
function stubTransport() {
  const seen = {};
  nodemailer.createTransport = (opts) => {
    seen.opts = opts;
    return { sendMail: async (msg) => { seen.msg = msg; return { messageId: '<x@example.test>' }; } };
  };
  return seen;
}

test('without SMTP config nothing is sent; the message lands in the outbox', async () => {
  nodemailer.createTransport = () => { throw new Error('must not build a transport'); };
  const before = mail.outbox.length;
  const res = await mail.send({ to: 'a@example.com', subject: 'S', text: 'T' });
  assert.deepEqual(res, { delivered: false });
  assert.equal(mail.outbox.length, before + 1);
  assert.deepEqual(mail.outbox[mail.outbox.length - 1], { to: 'a@example.com', subject: 'S', text: 'T' });
});

test('configured, it submits the message over SMTP', async () => {
  configure();
  process.env.MAIL_FROM = 'no-reply@example.test';
  process.env.MAIL_FROM_NAME = 'Spielwirbel';
  const seen = stubTransport();
  const res = await mail.send({ to: 'b@example.com', subject: 'Betreff', text: 'Inhalt' });
  assert.deepEqual(res, { delivered: true });
  assert.equal(seen.opts.host, 'smtp.example.test');
  assert.deepEqual(seen.opts.auth, { user: 'no-reply@example.test', pass: 'app-password' });
  assert.deepEqual(seen.msg.from, { address: 'no-reply@example.test', name: 'Spielwirbel' });
  assert.equal(seen.msg.to, 'b@example.com');
  assert.equal(seen.msg.subject, 'Betreff');
  assert.equal(seen.msg.text, 'Inhalt');
});

// A text/plain body cannot carry a tracking pixel. #439/#440 exist because a
// provider injected one into HTML; never grow an html part without re-reading
// that history.
test('the message is text-only — no html part is ever sent', async () => {
  configure();
  const seen = stubTransport();
  await mail.send({ to: 'b@example.com', subject: 'S', text: 'T' });
  assert.equal('html' in seen.msg, false);
});

// 465 is implicit TLS, 587 upgrades via STARTTLS. Getting `secure` wrong against
// 465 hangs until the connection timeout rather than failing clearly.
test('secure follows the port: 465 implicit TLS, 587 STARTTLS', async () => {
  configure();
  let seen = stubTransport();
  await mail.send({ to: 'b@example.com', subject: 'S', text: 'T' });
  assert.equal(seen.opts.port, 465, 'defaults to 465');
  assert.equal(seen.opts.secure, true);

  process.env.SMTP_PORT = '587';
  seen = stubTransport();
  await mail.send({ to: 'b@example.com', subject: 'S', text: 'T' });
  assert.equal(seen.opts.port, 587);
  assert.equal(seen.opts.secure, false);
});

// The send is awaited before the HTTP response, so an unbounded connection
// would hold a registration open until the client gives up.
test('every connection phase is bounded by a timeout', async () => {
  configure();
  const seen = stubTransport();
  await mail.send({ to: 'b@example.com', subject: 'S', text: 'T' });
  for (const k of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
    assert.ok(seen.opts[k] > 0, `${k} must be set`);
  }
});

// If this regresses, replies to a contact message go to the no-reply sender
// instead of the visitor (#224).
test('replyTo is passed through, and omitted entirely when unset', async () => {
  configure();
  let seen = stubTransport();
  await mail.send({ to: 'op@example.com', subject: 'S', text: 'T', replyTo: 'visitor@example.com' });
  assert.equal(seen.msg.replyTo, 'visitor@example.com');

  seen = stubTransport();
  await mail.send({ to: 'op@example.com', subject: 'S', text: 'T' });
  assert.equal('replyTo' in seen.msg, false);
});

test('a failed submission rejects (callers decide whether that is fatal)', async () => {
  configure();
  nodemailer.createTransport = () => ({
    sendMail: async () => { throw new Error('535 Authentication failed'); },
  });
  await assert.rejects(() => mail.send({ to: 'c@example.com', subject: 'S', text: 'T' }), /535/);
});

// Credentials without MAIL_FROM is not a working configuration. The contact
// form (#224) keys its fail-loud 502 off exactly this.
test('isConfigured() requires host, user, pass and MAIL_FROM together', async () => {
  assert.equal(mail.isConfigured(), false);
  process.env.SMTP_HOST = 'smtp.example.test';
  assert.equal(mail.isConfigured(), false);
  process.env.SMTP_USER = 'u';
  assert.equal(mail.isConfigured(), false);
  process.env.SMTP_PASS = 'p';
  assert.equal(mail.isConfigured(), false);
  process.env.MAIL_FROM = 'no-reply@example.test';
  assert.equal(mail.isConfigured(), true);
});
