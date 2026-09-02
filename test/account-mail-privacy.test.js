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

// Force every send to reject, the way a transport failure or the daily-budget
// breaker does.
function breakMail() {
  const orig = mail.send;
  mail.send = async () => { throw new Error('smtp exploded'); };
  return () => { mail.send = orig; };
}

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
  // The diagnostic value has to survive the redaction, or the fix is a deletion
  // and the operator loses the ability to see that mail is failing at all.
  assert.equal(line.message, 'smtp exploded');

  // Nothing else emitted on this request may carry an address either — the
  // request logger included (it logs a path, and register's is not parameterised
  // by address, but asserting it here means a future route that IS would fail).
  for (const l of logs) {
    assert.ok(
      !JSON.stringify(l).includes('@'),
      `a log line emitted during registration contains an e-mail address: ${JSON.stringify(l)}`,
    );
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
