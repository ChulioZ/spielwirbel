'use strict';

/*
 * A client that disconnects mid-upload is not an instance fault (#1657).
 *
 * multer answers a dropped connection with a plain `Error: Request aborted` and
 * no `status`, so before the fix it reached errorHandler as a 500: an
 * `unhandled_error` line with a stack, a post to ERROR_WEBHOOK_URL, and an entry
 * in the admin panel's warn/error ring buffer — for a phone that lost signal.
 *
 * supertest cannot abort part-way through a body, so these specs start the app
 * on an ephemeral port and write a partial multipart request over a raw socket,
 * then destroy it. The control at the end proves the other direction: a multer
 * error that is NOT a disconnect is still reported as a fault, so the abort
 * branch cannot have swallowed everything.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const request = require('supertest');

const { app } = require('./helpers');
const { outbox } = require('../lib/mail');
const { recentLogs, clearLogs } = require('../lib/observability');
const { captureStdout, parseLogLines, withEnv } = require('./support/log-capture');

const PASSWORD = 'correct horse battery';
let server;
let port;
let token;
let roundId;

before(async () => {
  const email = 'abort@example.test';
  const reg = await request(app).post('/api/account/register')
    .send({ email, username: 'abort_user', password: PASSWORD });
  assert.equal(reg.status, 200);
  const m = outbox[outbox.length - 1].text.match(/\/[vr]\?t=([a-z0-9]+\.([0-9a-f]+)\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'mail contains a short one-time link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  token = login.body.accessToken;

  const round = await request(app).post('/api/rounds')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Abort round', members: ['Alice'] });
  assert.equal(round.status, 201, JSON.stringify(round.body));
  roundId = round.body.id;

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

// Send the headers and the first bytes of a file part, announcing far more body
// than will ever arrive, then drop the connection.
function abortedUpload(path, field) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        `POST ${path} HTTP/1.1\r\n` +
        'Host: 127.0.0.1\r\n' +
        `Authorization: Bearer ${token}\r\n` +
        'Content-Type: multipart/form-data; boundary=XB\r\n' +
        'Content-Length: 500000\r\n\r\n' +
        '--XB\r\n' +
        `Content-Disposition: form-data; name="${field}"; filename="a.jpg"\r\n` +
        'Content-Type: image/jpeg\r\n\r\n' +
        '\xff\xd8\xff partial bytes',
      );
      // Give the server time to reach multer before the drop.
      setTimeout(() => { sock.destroy(); resolve(); }, 150);
    });
    sock.on('error', reject);
  });
}

// Run an aborted upload with the logger at info and the webhook configured,
// and wait until the server has finished reacting to the disconnect.
async function observeAbort(path, field) {
  const realFetch = global.fetch;
  const webhookCalls = [];
  global.fetch = async (url) => { webhookCalls.push(url); return { ok: true, status: 200 }; };
  clearLogs();
  let lines;
  try {
    lines = await withEnv('LOG_LEVEL', 'info', () =>
      withEnv('ERROR_WEBHOOK_URL', 'https://hooks.example/alert', () =>
        captureStdout(async () => {
          // Watch for the quiet line too, so the poll below can stop as soon
          // as either outcome has been written.
          let sawAbortLine = false;
          const inner = process.stdout.write;
          process.stdout.write = (chunk, ...rest) => {
            if (String(chunk).includes('"client_aborted"')) sawAbortLine = true;
            return inner.call(process.stdout, chunk, ...rest);
          };
          try {
            await abortedUpload(path, field);
            // Poll rather than sleep a fixed time: the reaction is asynchronous.
            // Pre-fix it lands as unhandled_error, post-fix as client_aborted.
            const deadline = Date.now() + 2000;
            while (Date.now() < deadline && !sawAbortLine && recentLogs().length === 0) {
              await new Promise((r) => setTimeout(r, 25));
            }
          } finally {
            process.stdout.write = inner;
          }
          // A short settle so a late error line could not slip in after the check.
          await new Promise((r) => setTimeout(r, 100));
        })));
  } finally {
    global.fetch = realFetch;
  }
  return { logs: parseLogLines(lines), webhookCalls, buffered: recentLogs() };
}

function assertQuietAbort({ logs, webhookCalls, buffered }, routePath) {
  assert.deepEqual(logs.filter((o) => o.event === 'unhandled_error'), [], 'no unhandled_error line');
  assert.deepEqual(webhookCalls, [], 'no webhook post');
  assert.deepEqual(buffered, [], 'nothing in the warn/error ring buffer');
  const aborted = logs.filter((o) => o.event === 'client_aborted');
  assert.equal(aborted.length, 1, 'exactly one client_aborted line');
  assert.equal(aborted[0].level, 'info');
  assert.equal(aborted[0].method, 'POST');
  assert.equal(aborted[0].path, routePath);
  assert.equal(aborted[0].stack, undefined, 'no stack');
}

test('an avatar upload the client abandons is not reported as an instance fault', async () => {
  const seen = await observeAbort('/api/account/me/avatar', 'avatar');
  assertQuietAbort(seen, '/api/account/me/avatar');
});

test('a cover upload the client abandons is not reported as an instance fault', async () => {
  const path = `/api/rounds/${roundId}/games`;
  const seen = await observeAbort(path, 'image');
  assertQuietAbort(seen, path);
});

// Control: a multer error with the client still connected — a file under an
// unexpected field name — is still the fault it was, so the abort branch is
// keyed on the request state and not on "any multer error".
test('a non-abort multer error on the cover route is still reported as a fault', async () => {
  clearLogs();
  const res = await withEnv('ERROR_WEBHOOK_URL', undefined, () =>
    request(app).post(`/api/rounds/${roundId}/games`)
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Azul')
      .attach('wrong_field', Buffer.from('\xff\xd8\xff not really'), 'a.jpg'));
  assert.equal(res.status, 500);
  const faults = recentLogs().filter((e) => e.event === 'unhandled_error');
  assert.equal(faults.length, 1, 'the unexpected-field error still reaches errorHandler');
  assert.equal(faults[0].path, `/api/rounds/${roundId}/games`);
  assert.match(faults[0].message, /Unexpected file field/);
});
