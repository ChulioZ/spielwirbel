'use strict';

/*
 * A mail failure must not write the recipient's address into the logs.
 *
 * `sendSafe` in lib/routes/account.js swallows a mail failure so the account
 * flow still succeeds, and logs it for the operator instead. It used to log
 * `to: msg.to` — a user's e-mail address — on four reachable paths
 * (registration, forgot-password, resend-verification, account deletion). That
 * contradicts the published policy, which states that request contents are
 * deliberately not protocolled and that usage events never carry contents
 * (lib/legal.js §3): an address is neither pseudonymous nor absent.
 *
 * The failure is reachable in production: mail.send rejects on a transport
 * failure AND on the MAIL_DAILY_MAX breaker.
 *
 * All four call sites share the one `sendSafe`, so driving a single route
 * exercises the redaction for every one of them; a second route would add
 * coverage of the routes, not of the behaviour under test.
 *
 * The address can also arrive INSIDE the error: an SMTP rejection quotes the
 * recipient in its message (see smtpRejection below). So every mail-failure
 * site — sendSafe, lib/notify.js and both catches in lib/routes/contact.js —
 * logs mail.mailFault(err) instead, and each has its own spec here.
 *
 * These specs read the ACTUAL emitted log lines rather than scanning the source,
 * because a source scan passes against any spelling that still leaks the address
 * (.claude/rules/source-scanning-guards-enumerate-shapes.md).
 */

// BEFORE requiring helpers: createApp() reads these at build time, and without
// them /api/account/register answers 404 accounts_disabled and never reaches the
// code under test — which presents as "nothing was logged" rather than as a
// misconfigured spec.
process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const mail = require('../lib/mail');

/*
 * Capture the app's own log lines while `fn` runs.
 *
 * Two things here are load-bearing and both produced false failures while this
 * spec was being written:
 *
 * - LOG_LEVEL is raised, because test/helpers.js sets it to 'silent'. Without
 *   it every capture is empty and the assertions pass vacuously.
 * - Only well-formed JSON objects carrying an `event` are kept. `node --test`
 *   writes its own protocol to the same stdout, and that stream embeds each
 *   test's NAME plus binary framing bytes — so a raw substring search for '@'
 *   matches the runner's own output and reports a leak that does not exist.
 */
async function captureLogs(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(String(chunk));
    return orig.call(process.stdout, chunk, ...rest);
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
    process.env.LOG_LEVEL = level;
  }
  const out = [];
  for (const line of chunks.join('').split('\n')) {
    const start = line.indexOf('{"level"');
    if (start === -1) continue;
    try {
      const parsed = JSON.parse(line.slice(start));
      if (parsed && parsed.event) out.push(parsed);
    } catch { /* a chunk boundary split a line — nothing to assert on it */ }
  }
  return out;
}

/*
 * A rejection shaped like nodemailer's own. Its MESSAGE is the trap: nodemailer
 * appends the SMTP server's reply to it, and a Postfix-style RCPT rejection
 * quotes the recipient — so logging `e.message` writes the address into the log
 * even though no call site ever names `to`. The fields beside it are what a log
 * line may carry instead: `code`, `responseCode` and `command` are fixed
 * vocabulary that cannot hold an address. (`response`, `rejected` and
 * `recipient` can, and are planted here so a line that spreads the error fails.)
 */
function smtpRejection(to) {
  const reply = `550 5.1.1 <${to}>: Recipient address rejected: User unknown in virtual mailbox table`;
  return Object.assign(new Error(`Can't send mail - all recipients were rejected: ${reply}`), {
    code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO', response: reply, rejected: [to], recipient: to,
  });
}

// Force sends to reject, the way a transport failure or the daily-budget
// breaker does. `only(to)` picks which recipients fail; by default every one.
function breakMail(only = () => true) {
  const orig = mail.send;
  mail.send = async (msg) => {
    if (only(msg.to)) throw smtpRejection(msg.to);
    return orig(msg);
  };
  return () => { mail.send = orig; };
}

// What every mail-failure line must carry instead of the message.
function assertDiagnosable(line) {
  assert.equal(line.message, undefined, `a mail-failure line carries the error message: ${JSON.stringify(line)}`);
  // The diagnostic value has to survive, or the fix is a deletion and the
  // operator loses the ability to see that mail is failing at all — and why.
  assert.equal(line.code, 'EENVELOPE');
  assert.equal(line.responseCode, 550);
  assert.equal(line.command, 'RCPT TO');
}

const noAddressIn = (logs, when) => {
  for (const l of logs) {
    assert.ok(!JSON.stringify(l).includes('@'), `a log line emitted ${when} contains an e-mail address: ${JSON.stringify(l)}`);
  }
};

const ADDRESS = 'leaky.canary@example.com';

test('a failed account mail is logged without the recipient address', async () => {
  const restore = breakMail();
  let logs;
  try {
    logs = await captureLogs(async () => {
      const res = await request(app)
        .post('/api/account/register')
        .send({ email: ADDRESS, password: 'correct horse battery staple', username: 'mailcanary' });
      // The flow must still succeed — that is the whole reason sendSafe swallows
      // the failure, and if it ever stopped, this spec would be asserting about
      // a route that never ran.
      assert.equal(res.status, 200, `register should succeed despite the mail failure: ${JSON.stringify(res.body)}`);
    });
  } finally {
    restore();
  }

  const failed = logs.filter((l) => l.event === 'account_mail_failed');
  assert.equal(failed.length, 1, 'the mail failure should still be logged for the operator');

  const line = failed[0];
  assert.equal(line.to, undefined, `the recipient address must not be logged: ${JSON.stringify(line)}`);
  assertDiagnosable(line);

  // Nothing else emitted on this request may carry an address either — the
  // request logger included (it logs a path, and register's is not parameterised
  // by address, but asserting it here means a future route that IS would fail).
  noAddressIn(logs, 'during registration');
});

test('a failed inbox notification is logged without the recipient address', async () => {
  // lib/notify.js's catch. Its send is fire-and-forget, so the line is the ONLY
  // trace a failed notification leaves.
  const { notifyInboxItem, idle } = require('../lib/notify');
  const email = 'notify.canary@example.com';
  await request(app).post('/api/account/register')
    .send({ email, password: 'correct horse battery staple', username: 'notifycanary' });
  const verify = mail.outbox[mail.outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(verify, 'registration mailed no verification link');
  await request(app).post('/api/account/verify-email').send({ token: verify[1] });
  const user = await require('../lib/repo').getUserByEmail(email);
  assert.ok(user && user.emailVerified, 'the fixture account is not verified, so nothing would be sent');

  const restore = breakMail();
  let logs;
  try {
    logs = await captureLogs(async () => {
      notifyInboxItem(user.id, { type: 'friend_request', payload: { requesterUsername: 'someone' } });
      await idle();
    });
  } finally {
    restore();
  }

  const failed = logs.filter((l) => l.event === 'inbox_notification_failed');
  assert.equal(failed.length, 1, 'the notification failure should still be logged');
  assertDiagnosable(failed[0]);
  noAddressIn(logs, 'by a failed notification');
});

test('a failed contact delivery and a failed acknowledgement are logged without an address', async () => {
  // lib/routes/contact.js has two sends: the notice to the operator mailbox and
  // the Art. 16(4) acknowledgement back to the notifier. Each has its own catch.
  process.env.CONTACT_TO = 'ops.canary@example.com';
  const report = {
    name: 'Alice', email: 'notifier.canary@example.com', subject: 'Hallo', message: 'Bitte prüfen.',
    category: 'copyright', url: 'https://spielwirbel.app/uploads/abc123.jpg', goodFaith: true,
  };
  try {
    for (const [event, failing, status] of [
      ['contact_ack_failed', report.email, 200],
      ['contact_mail_failed', process.env.CONTACT_TO, 502],
    ]) {
      const restore = breakMail((to) => to === failing);
      let logs;
      try {
        logs = await captureLogs(async () => {
          const res = await request(app).post('/api/contact').send(report);
          assert.equal(res.status, status, `${event}: ${JSON.stringify(res.body)}`);
        });
      } finally {
        restore();
      }
      const failed = logs.filter((l) => l.event === event);
      assert.equal(failed.length, 1, `${event} should still be logged`);
      assertDiagnosable(failed[0]);
      noAddressIn(logs, `around ${event}`);
    }
  } finally {
    delete process.env.CONTACT_TO;
  }
});

test('the unconfigured-mail notice does not log the recipient address', async () => {
  // lib/mail.js's own line, on the path a self-hosted instance without SMTP takes
  // for EVERY mail. Not reachable on production (SMTP is configured there), but
  // where it is reachable it logged every recipient.
  const logs = await captureLogs(async () => {
    await mail.send({ to: ADDRESS, subject: 'Canary', text: 'body' });
  });

  const notices = logs.filter((l) => l.event === 'mail_not_configured');
  assert.equal(notices.length, 1, 'the unconfigured notice should still be logged');

  const line = notices[0];
  assert.equal(line.to, undefined, `the recipient address must not be logged: ${JSON.stringify(line)}`);
  assert.ok(!JSON.stringify(line).includes('@'), `line contains an e-mail address: ${JSON.stringify(line)}`);
  // The subject stays: it is our own copy, names no person, and is what makes
  // this line useful when nothing is arriving.
  assert.equal(line.subject, 'Canary');
});
