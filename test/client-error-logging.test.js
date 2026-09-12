'use strict';

/*
 * What the observability layer records when a request does NOT succeed.
 *
 * Two independent defects found diagnosing production error logs on 2026-09-12,
 * both of which made a perfectly-working app look broken in the logs:
 *
 *   1. Every error reached captureError before anything looked at its status, so
 *      a CLIENT error — an oversized or malformed request body, which any bot on
 *      the open internet can produce at will — was recorded as `unhandled_error`
 *      at level=error, with a stack, and would have fired ERROR_WEBHOOK_URL. That
 *      makes the operator's alert channel (and the admin panel's warn/error ring
 *      buffer) floodable by a scanner, and it is the level real error tracking
 *      would key on.
 *
 *   2. pino-http 11 evaluates `customProps` TWICE — once when the middleware runs
 *      and again on finish — so a value that CHANGES between those two moments is
 *      emitted twice. `status` is exactly such a value, so every non-200 request
 *      line carried a phantom `"status":200` ahead of the real one. JSON.parse
 *      resolves a duplicate key to the last occurrence, which is why nothing
 *      noticed: the line parses correctly while being wrong on the wire.
 *
 * The second one is why these specs read the RAW serialized line. Asserting on
 * the parsed object cannot see the bug at all — the assertion this file exists
 * for would pass, vacuously, against the broken code.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const { EventEmitter } = require('node:events');

const {
  captureStdout,
  parseLogLines,
  rawLogLines,
  withEnv,
} = require('./support/log-capture');
const {
  requestLogger,
  errorHandler,
  recentLogs,
  clearLogs,
} = require('../lib/observability');

/* ------------------------- the non-200 request line ------------------------ */

// A req/res pair whose status changes AFTER the middleware runs — which is what
// every real response does, and the only sequence that reproduces the duplicate.
// (test/observability.test.js's fakeReqRes sets the final status up front, so
// both customProps calls agree there and pino-http's dedupe guard hides this.)
function reqResFinishing(status, path = '/api/rounds', method = 'POST') {
  const req = { path, method, ip: '127.0.0.1', originalUrl: path, url: path, headers: {} };
  const res = new EventEmitter();
  res.statusCode = 200; // as node initializes it, before the route answers
  return {
    req,
    res,
    finish: () => {
      res.statusCode = status;
      res.emit('finish');
    },
  };
}

async function lineFor(status) {
  const { req, res, finish } = reqResFinishing(status);
  const lines = await withEnv('LOG_LEVEL', 'info', () =>
    captureStdout(() => {
      requestLogger(req, res, () => {});
      finish();
    })
  );
  const raw = rawLogLines(lines).filter((l) => l.includes('"event":"request"'));
  assert.equal(raw.length, 1, 'exactly one request line');
  return raw[0];
}

const count = (line, key) => (line.match(new RegExp(`"${key}":`, 'g')) || []).length;

test('a non-200 request line carries exactly one status, and it is the real one', async () => {
  const line = await lineFor(413);
  assert.equal(count(line, 'status'), 1, `duplicated status in: ${line}`);
  assert.match(line, /"status":413/);
  // The phantom is specifically the pre-route default, so name it: this is the
  // assertion that fails loudly if the double-evaluation ever comes back.
  assert.equal(line.includes('"status":200'), false, `phantom status:200 in: ${line}`);
});

test('no other request-line field is duplicated either', async () => {
  // status is the only value that CHANGES, but the guard re-binds the whole
  // object, so every field doubled with it. Pin them all.
  const line = await lineFor(404);
  for (const key of ['event', 'method', 'path', 'ip', 'status', 'durationMs']) {
    assert.equal(count(line, key), 1, `"${key}" appears ${count(line, key)}× in: ${line}`);
  }
});

test('a 200 request line is unchanged — the fix does not disturb the happy path', async () => {
  const line = await lineFor(200);
  for (const key of ['event', 'method', 'path', 'ip', 'status', 'durationMs']) {
    assert.equal(count(line, key), 1, `"${key}" appears ${count(line, key)}× in: ${line}`);
  }
  assert.match(line, /"status":200/);
});

test('the request line keeps its exact allowlisted field set on a non-200', async () => {
  const line = await lineFor(500);
  const parsed = JSON.parse(line);
  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['durationMs', 'event', 'ip', 'level', 'method', 'path', 'status', 'ts']
  );
});

/* ------------------- client errors vs application errors ------------------- */

// Forwards errors shaped the way body-parser's do: an Error carrying a 4xx
// status and a machine-readable `type`, versus a genuine unexpected throw.
function errorApp() {
  const a = express();
  a.get('/too-large', (req, res, next) => {
    const err = new Error('request entity too large');
    err.status = 413;
    err.type = 'entity.too.large';
    next(err);
  });
  a.get('/malformed', (req, res, next) => {
    const err = new SyntaxError("Expected property name or '}' in JSON at position 1");
    err.status = 400;
    err.type = 'entity.parse.failed';
    next(err);
  });
  a.get('/boom', () => {
    throw new Error('kaboom: secret internal detail');
  });
  a.use(errorHandler);
  return a;
}

async function logsFor(path) {
  let res;
  const lines = await withEnv('LOG_LEVEL', 'info', () =>
    captureStdout(async () => {
      res = await request(errorApp()).get(path);
    })
  );
  return { res, parsed: parseLogLines(lines), raw: rawLogLines(lines) };
}

test('a client 413 is NOT recorded as unhandled_error', async () => {
  const { res, parsed } = await logsFor('/too-large');
  assert.equal(res.status, 413);
  assert.equal(
    parsed.some((o) => o.event === 'unhandled_error'), false,
    'a client error must not enter the application-error channel'
  );
  const client = parsed.filter((o) => o.event === 'client_error');
  assert.equal(client.length, 1);
  assert.equal(client[0].status, 413);
  assert.equal(client[0].method, 'GET');
  assert.equal(client[0].path, '/too-large');
  assert.equal(client[0].type, 'entity.too.large');
});

test('a client 400 (malformed JSON) is classified the same way', async () => {
  const { res, parsed } = await logsFor('/malformed');
  assert.equal(res.status, 400);
  assert.equal(parsed.some((o) => o.event === 'unhandled_error'), false);
  assert.equal(parsed.filter((o) => o.event === 'client_error')[0].type, 'entity.parse.failed');
});

test('the client_error line carries no stack and no body content', async () => {
  const { raw, parsed } = await logsFor('/malformed');
  const client = parsed.filter((o) => o.event === 'client_error');
  assert.equal(client.length, 1);
  assert.equal(client[0].stack, undefined, 'a client error is not a fault to debug');
  // `type` is logged rather than `message` on purpose: a body-parser SyntaxError
  // quotes the offending token, and this logger's allowlist promises no request
  // body ever reaches the logs.
  assert.equal(client[0].message, undefined);
  const line = raw.find((l) => l.includes('client_error'));
  assert.equal(line.includes('Expected property name'), false, `body text leaked: ${line}`);
});

test('a client error is logged BELOW warn, so it cannot flood the operator buffer', async () => {
  // The admin panel's ring buffer (#359) captures warn+error only. A 4xx that
  // any scanner can produce on demand must stay out of it, or the surface that
  // answers "what just went wrong" fills with traffic that is not wrong at all.
  clearLogs();
  const { parsed } = await logsFor('/too-large');
  assert.equal(parsed.filter((o) => o.event === 'client_error')[0].level, 'info');
  assert.deepEqual(recentLogs(), []);
});

test('a 5xx still IS an unhandled_error, at error level, with its stack', async () => {
  clearLogs();
  const { res, parsed } = await logsFor('/boom');
  assert.equal(res.status, 500);
  const errs = parsed.filter((o) => o.event === 'unhandled_error');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].level, 'error');
  assert.match(errs[0].stack, /kaboom/);
  // And it still reaches the operator's buffer.
  assert.equal(recentLogs().some((l) => l.event === 'unhandled_error'), true);
  // The client still learns nothing.
  assert.deepEqual(res.body, { error: 'internal_error' });
  assert.equal(res.text.includes('kaboom'), false);
});

/* ----------------------------- the alert channel --------------------------- */

async function webhookCallsFor(path) {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  try {
    await withEnv('ERROR_WEBHOOK_URL', 'https://hook.example/test', () =>
      withEnv('LOG_LEVEL', 'silent', () => captureStdout(() => request(errorApp()).get(path)))
    );
  } finally {
    global.fetch = realFetch;
  }
  return calls;
}

test('a client 4xx never reaches ERROR_WEBHOOK_URL', async () => {
  assert.deepEqual(await webhookCallsFor('/too-large'), []);
});

test('a 5xx still reaches ERROR_WEBHOOK_URL — the channel is not simply off', async () => {
  const calls = await webhookCallsFor('/boom');
  assert.equal(calls.length, 1);
  assert.match(String(calls[0].init.body), /kaboom/);
});
