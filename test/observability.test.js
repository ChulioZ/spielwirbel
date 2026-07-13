'use strict';

/*
 * Observability baseline (issue #132): /healthz, structured request logging,
 * the central error handler, and the optional error-tracking webhook. The
 * error-handler and captureError paths are exercised on throwaway apps so we can
 * mount a deliberately-throwing route; /healthz and the request logger run
 * against the shared app from helpers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const { EventEmitter } = require('node:events');

const { app } = require('./helpers');
const {
  logger,
  requestLogger,
  captureError,
  errorHandler,
} = require('../lib/observability');

// Capture everything written to stdout while `fn` runs, restoring afterwards.
async function captureStdout(fn) {
  const lines = [];
  const orig = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return orig.call(process.stdout, chunk, ...rest);
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return lines.join('').split('\n').filter(Boolean);
}

// Parse only the JSON log lines, ignoring any unrelated stdout noise the test
// runner may interleave.
function parseLogLines(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.startsWith('{')) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      // not one of ours
    }
  }
  return out;
}

function withEnv(key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return (async () => {
    try {
      return await fn();
    } finally {
      if (had) process.env[key] = prev;
      else delete process.env[key];
    }
  })();
}

test('logger writes a structured JSON line with ts + level', async () => {
  const lines = await withEnv('LOG_LEVEL', 'info', () =>
    captureStdout(() => logger.info({ event: 'hello', n: 1 }))
  );
  assert.equal(lines.length, 1);
  const obj = JSON.parse(lines[0]);
  assert.equal(obj.level, 'info');
  assert.equal(obj.event, 'hello');
  assert.equal(obj.n, 1);
  assert.match(obj.ts, /^\d{4}-\d\d-\d\dT/);
});

test('LOG_LEVEL gates output: silent suppresses, error hides info', async () => {
  const silent = await withEnv('LOG_LEVEL', 'silent', () =>
    captureStdout(() => {
      logger.info({ event: 'x' });
      logger.error({ event: 'y' });
    })
  );
  assert.equal(silent.length, 0);

  const errOnly = await withEnv('LOG_LEVEL', 'error', () =>
    captureStdout(() => {
      logger.info({ event: 'info-line' });
      logger.error({ event: 'error-line' });
    })
  );
  assert.equal(errOnly.length, 1);
  assert.equal(JSON.parse(errOnly[0]).event, 'error-line');
});

test('GET /healthz returns 200 with ok status and a numeric uptime', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.uptime, 'number');
  assert.match(res.body.timestamp, /^\d{4}-\d\d-\d\dT/);
});

// Drive requestLogger with a fake req/res so the `finish` event fires
// deterministically (a real supertest request logs in a later tick, after the
// test's env override is already restored — a race, not a real bug).
function fakeReqRes(path, method = 'GET', status = 200) {
  const req = { path, method, ip: '127.0.0.1', query: { secret: 'x' }, body: { name: 'Alice' } };
  const res = new EventEmitter();
  res.statusCode = status;
  return { req, res };
}

test('request logger logs a request on finish with no personal data', async () => {
  const { req, res } = fakeReqRes('/api/rounds');
  let nexted = false;
  const lines = await withEnv('LOG_LEVEL', 'info', () =>
    captureStdout(() => {
      requestLogger(req, res, () => {
        nexted = true;
      });
      res.emit('finish');
    })
  );
  assert.equal(nexted, true);
  const reqLines = parseLogLines(lines).filter((o) => o.event === 'request');
  assert.equal(reqLines.length, 1);
  assert.equal(reqLines[0].path, '/api/rounds');
  assert.equal(reqLines[0].method, 'GET');
  assert.equal(reqLines[0].status, 200);
  assert.equal(typeof reqLines[0].durationMs, 'number');
  assert.equal(reqLines[0].ip, '127.0.0.1');
  // No body / query (which carry personal data) leak into the log line.
  assert.equal(reqLines[0].body, undefined);
  assert.equal(reqLines[0].query, undefined);
});

test('request logger skips /healthz (no log even on finish)', async () => {
  const { req, res } = fakeReqRes('/healthz');
  const lines = await withEnv('LOG_LEVEL', 'info', () =>
    captureStdout(() => {
      requestLogger(req, res, () => {});
      res.emit('finish');
    })
  );
  const reqLines = parseLogLines(lines).filter((o) => o.event === 'request');
  assert.equal(reqLines.length, 0);
});

// A throwaway app that reproduces createApp's error wiring around a route that
// throws — sync or async — so we can assert the central handler's behaviour.
function throwingApp() {
  const a = express();
  a.get('/boom', () => {
    throw new Error('kaboom: secret internal detail');
  });
  a.get('/boom-async', async () => {
    throw new Error('async kaboom');
  });
  a.use(errorHandler);
  return a;
}

test('error handler turns a sync throw into a generic 500 with no stack leak', async () => {
  await withEnv('LOG_LEVEL', 'silent', async () => {
    const res = await request(throwingApp()).get('/boom');
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'internal_error' });
    // The client must never see the message or a stack trace.
    assert.equal(res.text.includes('kaboom'), false);
    assert.equal(res.text.includes('at '), false);
  });
});

test('error handler also catches async (promise-rejection) throws', async () => {
  await withEnv('LOG_LEVEL', 'silent', async () => {
    const res = await request(throwingApp()).get('/boom-async');
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'internal_error' });
  });
});

test('captureError forwards to ERROR_WEBHOOK_URL when set, with no personal data', async () => {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200 };
  };
  try {
    await withEnv('LOG_LEVEL', 'silent', () =>
      withEnv('ERROR_WEBHOOK_URL', 'https://hooks.example/alert', () =>
        captureError(new Error('the failure'), { method: 'POST', path: '/api/rounds' })
      )
    );
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://hooks.example/alert');
  const body = JSON.parse(calls[0].opts.body);
  assert.match(body.text, /the failure/);
  assert.match(body.text, /\/api\/rounds/);
});

test('captureError makes no network call when ERROR_WEBHOOK_URL is unset', async () => {
  const realFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    return { ok: true };
  };
  try {
    await withEnv('LOG_LEVEL', 'silent', () =>
      withEnv('ERROR_WEBHOOK_URL', undefined, () =>
        captureError(new Error('no webhook'), { method: 'GET', path: '/x' })
      )
    );
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(called, false);
});

test('captureError never throws even if the webhook fetch rejects', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('network down');
  };
  try {
    await withEnv('LOG_LEVEL', 'silent', () =>
      withEnv('ERROR_WEBHOOK_URL', 'https://hooks.example/alert', async () => {
        await captureError(new Error('boom'), { method: 'GET', path: '/x' });
      })
    );
  } finally {
    global.fetch = realFetch;
  }
  // Reaching here without throwing is the assertion.
  assert.ok(true);
});
