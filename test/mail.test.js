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

/* --------------------- global daily send budget (#448) ---------------------- */

// The counter is per-process and deliberately has no reset hook (an idle
// process holds no timer; the reset is lazy on the first send of a new UTC
// day). So every test here sizes its ceiling RELATIVE to what this file has
// already sent, rather than assuming a clean slate.
const budgetFor = (headroom) => {
  process.env.MAIL_DAILY_MAX = String(mail.budgetState().sent + headroom);
};

test('the daily budget refuses further sends once it is spent (#448)', async () => {
  nodemailer.createTransport = () => { throw new Error('must not build a transport'); };
  budgetFor(2);
  try {
    // Everything up to the ceiling is delivered normally …
    assert.deepEqual(await mail.send({ to: 'a@example.com', subject: 'S', text: 'T' }), { delivered: false });
    assert.deepEqual(await mail.send({ to: 'b@example.com', subject: 'S', text: 'T' }), { delivered: false });
    // … and the next one is refused rather than silently dropped, so a caller
    // can tell the difference (contact.js 502s; sendSafe log-and-continues).
    const before = mail.outbox.length;
    await assert.rejects(
      () => mail.send({ to: 'c@example.com', subject: 'S', text: 'T' }),
      /mail_daily_budget_exhausted/,
    );
    assert.equal(mail.outbox.length, before, 'a refused send must not reach the outbox');
  } finally {
    delete process.env.MAIL_DAILY_MAX;
  }
});

// The breaker exists to protect the SMTP quota, so the refusal has to happen
// BEFORE the transport is built — otherwise it would still open a connection
// (and, against a real host, still count against the account's limit).
test('a refused send never reaches the transport (#448)', async () => {
  configure();
  process.env.MAIL_FROM = 'no-reply@example.test';
  let built = 0;
  nodemailer.createTransport = () => { built += 1; return { sendMail: async () => ({}) }; };
  budgetFor(1);
  try {
    await mail.send({ to: 'a@example.com', subject: 'S', text: 'T' });
    assert.equal(built, 1);
    await assert.rejects(() => mail.send({ to: 'b@example.com', subject: 'S', text: 'T' }));
    assert.equal(built, 1, 'the refused send must not build a transport');
  } finally {
    delete process.env.MAIL_DAILY_MAX;
  }
});

// Read per call, never bound at module load — otherwise a deployment could not
// re-tune the ceiling and this very test could not drive it
// (.claude/rules/security-middleware.md).
test('the budget ceiling is read from env per send (#448)', async () => {
  nodemailer.createTransport = () => { throw new Error('must not build a transport'); };
  budgetFor(0);
  try {
    await assert.rejects(() => mail.send({ to: 'a@example.com', subject: 'S', text: 'T' }));
    // Raising the ceiling takes effect immediately, with no rebuild of anything.
    budgetFor(1);
    assert.deepEqual(await mail.send({ to: 'a@example.com', subject: 'S', text: 'T' }), { delivered: false });
  } finally {
    delete process.env.MAIL_DAILY_MAX;
  }
});

// The reserve's END-TO-END behaviour lives in test/notify.test.js; what is pinned
// here is the mail-layer contract it rests on: an omitted or unrecognised `kind`
// must behave exactly as before #618, or a typo at a call site silently stops
// that mail going out.
test('an absent or unknown mail kind spends the whole ceiling, as before (#618)', async () => {
  nodemailer.createTransport = () => { throw new Error('must not build a transport'); };
  budgetFor(2);
  try {
    // With one send left in the day, the reserve would refuse a notification —
    // but neither of these is one.
    assert.deepEqual(await mail.send({ to: 'a@example.com', subject: 'S', text: 'T' }), { delivered: false });
    budgetFor(1);
    assert.deepEqual(
      await mail.send({ to: 'b@example.com', subject: 'S', text: 'T', kind: 'typo-not-a-class' }),
      { delivered: false },
      'an unrecognised class must not be quietly downgraded to notification',
    );
  } finally {
    delete process.env.MAIL_DAILY_MAX;
  }
});

test('budgetState() reports the day, the count and the limit, and no secret (#448)', async () => {
  nodemailer.createTransport = () => { throw new Error('must not build a transport'); };
  delete process.env.MAIL_DAILY_MAX;
  const before = mail.budgetState();
  assert.deepEqual(Object.keys(before).sort(), ['day', 'limit', 'sent']);
  assert.equal(before.day, new Date().toISOString().slice(0, 10), 'the day is a UTC date');
  assert.equal(before.limit, 200, 'the committed default');
  await mail.send({ to: 'a@example.com', subject: 'S', text: 'T' });
  assert.equal(mail.budgetState().sent, before.sent + 1);
});
