'use strict';

/*
 * Browser-side fault reports (issue #1149): POST /api/client-error, its own
 * ring buffer in lib/observability.js, and the operator panel's read side.
 *
 * NOT named after lib/routes/client-error.js: test/client-error-logging.test.js
 * already exists and covers the errorHandler's 4xx classification, which is a
 * different thing with almost the same name
 * (.claude/rules/test-file-names-collide-silently.md).
 *
 * ADMIN_PASSWORD is set so the read side is reachable; the gate's own OFF state
 * is test/admin.test.js's job.
 */

process.env.ADMIN_PASSWORD = 'operator-secret-pw';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const { createApp } = require('../lib/app');
const {
  recentClientErrors, clearClientErrors, recentLogs, clearLogs, uaEngine,
} = require('../lib/observability');
const {
  CLIENT_ERROR_KINDS, CLIENT_ERROR_MESSAGE_MAX, CLIENT_ERROR_MAX_PER_LOAD,
  clientErrorPathShape, clientErrorSource, clientErrorReport, resetClientErrorBudget,
} = require('../public/js/error-report');

// A report the endpoint accepts, so each case below can vary exactly one field.
const VALID = {
  kind: 'recap_export',
  message: 'SecurityError: Tainted canvases may not be exported.',
  source: 'js/views-chronik.js:461',
  path: '/round/:rid/chronik',
  locale: 'de',
};

async function adminCookie() {
  const res = await request(app).post('/api/admin/login').send({ password: 'operator-secret-pw' });
  assert.equal(res.status, 200);
  return res.headers['set-cookie'];
}

/* ----------------------- the client's own pure helpers --------------------- */

// The reporter sends the route SHAPE, never the pathname. Every assertion here
// is about something that must NOT survive the transform, so each case names the
// value it is destroying rather than only the shape it expects.
test('clientErrorPathShape strips every identifier out of a client path', async (t) => {
  await t.test('the vote link is a live credential and must not appear', () => {
    // .claude/rules/... : the shared vote link's token IS the whole credential,
    // and unlike every other secret in this app it rides in the path — the same
    // reason lib/observability.js reqPath() redacts the server-side spelling.
    // The fixture is deliberately UNLIKE a real token: a realistic hex literal
    // trips gitleaks' generic-api-key rule on entropy — correctly, since it is
    // indistinguishable from a live credential by inspection. The matcher is
    // `[^/]+`, so the entropy was never part of what this exercises.
    // (.claude/rules/secrets-in-paths-reach-the-logs.md)
    const shaped = clientErrorPathShape('/vote/NOT-A-REAL-TOKEN-just-a-path-segment');
    assert.equal(shaped, '/vote/:token');
    assert.ok(!shaped.includes('NOT-A-REAL'), 'no part of the token survives');
  });

  await t.test('round, game and member ids are replaced', () => {
    assert.equal(clientErrorPathShape('/round/r-abc123'), '/round/:rid');
    assert.equal(clientErrorPathShape('/round/r-abc123/regal'), '/round/:rid/regal');
    assert.equal(clientErrorPathShape('/round/r-abc123/game/g-xyz789'), '/round/:rid/game/:id');
    assert.equal(clientErrorPathShape('/round/r-abc123/member/m-42'), '/round/:rid/member/:id');
    assert.equal(clientErrorPathShape('/round/r-abc/session/s-7/vote/3'), '/round/:rid/session/:id');
  });

  await t.test('a username is replaced', () => {
    assert.equal(clientErrorPathShape('/u/ada'), '/u/:username');
  });

  await t.test('the plain screens keep their name', () => {
    assert.equal(clientErrorPathShape('/'), '/');
    assert.equal(clientErrorPathShape(''), '/');
    assert.equal(clientErrorPathShape('/freunde'), '/freunde');
    assert.equal(clientErrorPathShape('/konto'), '/konto');
    assert.equal(clientErrorPathShape('/round/new'), '/round/new');
  });

  await t.test('anything off the route table folds to /other, not to itself', () => {
    // An ALLOWLIST, so a segment nobody has thought of cannot ride through —
    // including one an extension or a stale bookmark invented.
    assert.equal(clientErrorPathShape('/round/r-1/made-up-screen'), '/other');
    assert.equal(clientErrorPathShape('/not-a-route/secret-value'), '/other');
    assert.equal(clientErrorPathShape('/u'), '/other');
  });
});

// The origin is an ARGUMENT rather than being read from `location`: it keeps the
// helper pure, and it makes the caller state which origin it trusts.
const ORIGIN = 'https://spielwirbel.app';

test('clientErrorSource keeps our own script and rejects everything else', async (t) => {
  await t.test('an app script becomes a relative path plus its line', () => {
    assert.equal(
      clientErrorSource(`${ORIGIN}/js/views-chronik.js`, 461, ORIGIN),
      'js/views-chronik.js:461',
    );
  });

  await t.test('the production build\'s content-hashed name is accepted', () => {
    // scripts/build.js emits js/core.js -> js/core.<8 hex>.js, which is the ONLY
    // spelling production ever reports. A regex written against the dev name
    // would reject every real report and nothing would notice.
    assert.equal(
      clientErrorSource(`${ORIGIN}/js/core.7e38c5aa.js`, 12, ORIGIN),
      'js/core.7e38c5aa.js:12',
    );
  });

  await t.test('a script from another origin is dropped, however it is spelt', () => {
    // The two shapes that actually turn up in the wild: a browser extension
    // injecting into the page, and a third-party script. Neither may write text
    // into a field the operator reads.
    assert.equal(clientErrorSource('chrome-extension://abcd/inject.js', 1, ORIGIN), null);
    assert.equal(clientErrorSource('https://evil.example/js/x.js', 1, ORIGIN), null);
    assert.equal(clientErrorSource('moz-extension://x/js/content.js', 1, ORIGIN), null);
  });

  await t.test('a same-origin file outside /js/ is dropped', () => {
    assert.equal(clientErrorSource(`${ORIGIN}/sw.js`, 1, ORIGIN), null);
    assert.equal(clientErrorSource(`${ORIGIN}/js/../secret.js`, 1, ORIGIN), null);
  });

  await t.test('an absent filename, line or origin is dropped', () => {
    assert.equal(clientErrorSource('', 1, ORIGIN), null);
    assert.equal(clientErrorSource(undefined, undefined, ORIGIN), null);
    assert.equal(clientErrorSource(`${ORIGIN}/js/core.js`, undefined, ORIGIN), null);
    assert.equal(clientErrorSource(`${ORIGIN}/js/core.js`, 0, ORIGIN), null);
    assert.equal(clientErrorSource(`${ORIGIN}/js/core.js`, 12, undefined), null);
  });
});

// The payload build is where the two bounds live, and they are the reason a
// throw inside a render loop cannot hammer the endpoint.
test('clientErrorReport bounds what a single page load can send', async (t) => {
  t.beforeEach(() => resetClientErrorBudget());

  await t.test('an unknown kind is dropped rather than becoming a new stream', () => {
    assert.equal(clientErrorReport('invented_kind', { pathname: '/' }), null);
  });

  await t.test('the same fault twice produces one report', () => {
    const opts = { error: new Error('boom'), pathname: '/freunde' };
    assert.ok(clientErrorReport('uncaught', opts));
    assert.equal(clientErrorReport('uncaught', opts), null, 'the repeat is dropped');
    // A DIFFERENT fault still gets through, so de-duplication is not just a
    // one-report-ever cap wearing a disguise.
    assert.ok(clientErrorReport('uncaught', { error: new Error('other'), pathname: '/freunde' }));
  });

  await t.test('the per-load cap stops a loop', () => {
    for (let i = 0; i < CLIENT_ERROR_MAX_PER_LOAD; i++) {
      assert.ok(clientErrorReport('uncaught', { error: new Error(`e${i}`) }), `report ${i + 1}`);
    }
    assert.equal(clientErrorReport('uncaught', { error: new Error('one too many') }), null);
  });

  await t.test('the message is truncated and a blank one is omitted', () => {
    const long = clientErrorReport('uncaught', { error: new Error('y'.repeat(900)) });
    assert.equal(long.message.length, CLIENT_ERROR_MESSAGE_MAX);
    const blank = clientErrorReport('sw_register', { error: new Error('   ') });
    assert.ok(!('message' in blank), 'no empty message field');
  });

  await t.test('a SyntaxError reports only its class — its message quotes the input', () => {
    // A rejection out of res.json() carries a snippet of the RESPONSE BODY in
    // its message, i.e. round/member data. The class is the whole diagnostic
    // value for a parse error anyway (.claude/rules/logging-a-caught-fault.md §1
    // is the same trap on the server, over data.json).
    let err;
    try {
      JSON.parse('{"members":["Anna Schmidt"');
    } catch (e) {
      err = e;
    }
    assert.ok(err.message.includes('Anna Schmidt') || err.message.includes('JSON'),
      'the fixture is a real parse error');
    const report = clientErrorReport('unhandled_rejection', { error: err });
    assert.equal(report.message, 'SyntaxError');
    assert.ok(!report.message.includes('Anna'), 'no part of the parsed input survives');
  });

  await t.test('the report carries the shape, never the pathname it came from', () => {
    const report = clientErrorReport('recap_export', {
      error: new Error('SecurityError'),
      pathname: '/round/r-abc123/chronik',
      locale: 'de',
    });
    assert.equal(report.path, '/round/:rid/chronik');
    assert.deepEqual(Object.keys(report).sort(), ['kind', 'locale', 'message', 'path']);
  });
});

/* ------------------------- the server's UA derivation --------------------- */

// The engine is the one field that would have made the WebKit canvas-taint bug
// obvious at a glance, so it is the one field worth getting right.
test('uaEngine names the engine and never echoes the user-agent string', async (t) => {
  const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15';
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
  const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100131 Firefox/128.0';

  await t.test('Safari is WebKit even though its UA also says Chrome-shaped things', () => {
    // THE discriminating case: Chrome's UA contains AppleWebKit too, so a naive
    // /AppleWebKit/ test calls every Chromium visitor WebKit — and the bug this
    // whole feature exists for is WebKit-only. Order of the branches is the fix.
    assert.equal(uaEngine(SAFARI), 'WebKit/605');
    assert.equal(uaEngine(CHROME), 'Chrome/148');
  });

  await t.test('Firefox is Gecko', () => {
    assert.equal(uaEngine(FIREFOX), 'Gecko/128');
  });

  await t.test('an unknown or absent UA is "other", never the raw string', () => {
    const weird = 'Some-Crawler/1.0 (+http://example.com/bot)';
    assert.equal(uaEngine(weird), 'other');
    assert.equal(uaEngine(''), 'other');
    assert.equal(uaEngine(undefined), 'other');
  });

  await t.test('a hostile UA cannot smuggle text through the engine field', () => {
    const hostile = 'AppleWebKit/605 <script>alert(1)</script> Version/1 Safari/605';
    assert.equal(uaEngine(hostile), 'WebKit/605');
  });
});

/* ------------------------------- the endpoint ------------------------------ */

test('POST /api/client-error records an allowlisted report', async (t) => {
  t.beforeEach(() => { clearClientErrors(); clearLogs(); });

  await t.test('a valid report is accepted and buffered', async () => {
    const res = await request(app)
      .post('/api/client-error')
      .set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) '
        + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')
      .send(VALID);
    assert.equal(res.status, 204);

    const entries = recentClientErrors();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'recap_export');
    assert.equal(entries[0].message, VALID.message);
    assert.equal(entries[0].source, 'js/views-chronik.js:461');
    assert.equal(entries[0].path, '/round/:rid/chronik');
    assert.equal(entries[0].locale, 'de');
    // Server-derived, never client-supplied.
    assert.equal(entries[0].ua, 'WebKit/605');
    assert.ok(entries[0].ts, 'carries a timestamp');
  });

  await t.test('the report never carries a stack, a UA string or anything else', async () => {
    await request(app).post('/api/client-error').send(VALID);
    const [entry] = recentClientErrors();
    // The WHOLE field set, asserted as a set: a future field added at the route
    // has to be added here too, rather than arriving unnoticed in a surface the
    // privacy policy enumerates.
    assert.deepEqual(
      Object.keys(entry).sort(),
      ['kind', 'locale', 'message', 'path', 'source', 'ts', 'ua'],
    );
  });

  await t.test('a report is optional in every field but the kind', async () => {
    const res = await request(app).post('/api/client-error').send({ kind: 'uncaught' });
    assert.equal(res.status, 204);
    const [entry] = recentClientErrors();
    assert.equal(entry.kind, 'uncaught');
    assert.equal(entry.message, null);
    assert.equal(entry.source, null);
  });

  await t.test('newest first, like the warn/error buffer', async () => {
    await request(app).post('/api/client-error').send({ ...VALID, message: 'first' });
    await request(app).post('/api/client-error').send({ ...VALID, message: 'second' });
    assert.deepEqual(recentClientErrors().map((e) => e.message), ['second', 'first']);
  });
});

test('POST /api/client-error drops anything outside the allowlist', async (t) => {
  t.beforeEach(() => { clearClientErrors(); clearLogs(); });

  // Each case asserts the 400 AND that nothing was recorded — a route that
  // logged first and validated second would pass the status half on its own.
  const rejected = [
    ['a kind outside the enum', { ...VALID, kind: 'something_invented' }],
    ['a kind that is not a string', { ...VALID, kind: ['uncaught'] }],
    ['a missing kind', { message: 'x' }],
    ['an unknown extra field', { ...VALID, stack: 'Error\n  at <anonymous>' }],
    ['a source outside /js/', { ...VALID, source: 'https://evil.example/x.js:1' }],
    ['a source with no line number', { ...VALID, source: 'js/core.js' }],
    ['a path carrying an id instead of a shape', { ...VALID, path: '/round/r-abc123/regal' }],
    ['a path that is not a path', { ...VALID, path: 'javascript:alert(1)' }],
    ['a locale the app does not ship', { ...VALID, locale: 'xx' }],
  ];

  for (const [label, body] of rejected) {
    await t.test(label, async () => {
      const res = await request(app).post('/api/client-error').send(body);
      assert.equal(res.status, 400);
      assert.equal(recentClientErrors().length, 0, 'nothing was recorded');
    });
  }

  await t.test('an over-long message is truncated, not rejected', async () => {
    const res = await request(app)
      .post('/api/client-error')
      .send({ ...VALID, message: 'x'.repeat(4000) });
    assert.equal(res.status, 204);
    const [entry] = recentClientErrors();
    assert.equal(entry.message.length, CLIENT_ERROR_MESSAGE_MAX);
  });
});

/* --------------------- the two buffers must stay disjoint ------------------ */

// .claude/rules/client-errors-are-not-instance-faults.md closed exactly this
// hole one endpoint over: an unauthenticated writer must not be able to fill the
// 200-entry surface that answers "what just went wrong on THIS INSTANCE".
test('a browser report never touches the instance warn/error buffer (#359)', async (t) => {
  t.beforeEach(() => { clearClientErrors(); clearLogs(); });

  await t.test('one report adds nothing to recentLogs()', async () => {
    await request(app).post('/api/client-error').send(VALID);
    assert.equal(recentClientErrors().length, 1);
    assert.equal(recentLogs().length, 0);
  });

  await t.test('a flood evicts nothing an instance fault put there', async () => {
    const { logger } = require('../lib/observability');
    logger.error({ event: 'unhandled_error', message: 'a real instance fault' });
    assert.equal(recentLogs().length, 1);

    // Well past the client buffer's own cap, so its eviction runs repeatedly.
    for (let i = 0; i < 260; i++) {
      await request(app).post('/api/client-error').send({ ...VALID, message: `flood ${i}` });
    }

    const logs = recentLogs();
    assert.equal(logs.length, 1, 'the instance buffer is untouched');
    assert.equal(logs[0].message, 'a real instance fault');
  });

  await t.test('the client buffer is itself bounded', async () => {
    for (let i = 0; i < 260; i++) {
      await request(app).post('/api/client-error').send({ ...VALID, message: `n${i}` });
    }
    const entries = recentClientErrors();
    assert.ok(entries.length <= 200, `bounded, got ${entries.length}`);
    assert.equal(entries[0].message, 'n259', 'the newest survived');
  });
});

/* ------------------------------- its own limiter --------------------------- */

test('the endpoint has its own ceiling and does not spend the auth budget', async () => {
  const saved = process.env.CLIENT_ERROR_RATE_LIMIT_MAX;
  process.env.CLIENT_ERROR_RATE_LIMIT_MAX = '3';
  try {
    const limited = createApp();
    for (let i = 0; i < 3; i++) {
      const ok = await request(limited).post('/api/client-error').send(VALID);
      assert.equal(ok.status, 204, `report ${i + 1} accepted`);
    }
    const blocked = await request(limited).post('/api/client-error').send(VALID);
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, { error: 'rate_limited' });

    // The strong half: exhausting this ceiling must not have cost the auth
    // routes anything, or an error storm would lock people out of logging in.
    const login = await request(limited).post('/api/admin/login').send({ password: 'wrong' });
    assert.notEqual(login.status, 429);
  } finally {
    if (saved === undefined) delete process.env.CLIENT_ERROR_RATE_LIMIT_MAX;
    else process.env.CLIENT_ERROR_RATE_LIMIT_MAX = saved;
  }
});

test('the endpoint is reachable without any credential', async () => {
  // It sits ahead of the app's auth gate on purpose: the faults most worth
  // hearing about are the ones on the login and landing screens.
  clearClientErrors();
  const res = await request(app).post('/api/client-error').send({ kind: 'uncaught' });
  assert.equal(res.status, 204);
  assert.equal(recentClientErrors().length, 1);
});

/* ------------------------------ the read side ------------------------------ */

test('GET /api/admin/logs/client serves the buffer to the operator only', async (t) => {
  await t.test('without an operator session it is refused', async () => {
    const res = await request(app).get('/api/admin/logs/client');
    assert.equal(res.status, 401);
  });

  await t.test('with one it returns the entries, newest first', async () => {
    clearClientErrors();
    await request(app).post('/api/client-error').send({ ...VALID, message: 'older' });
    await request(app).post('/api/client-error').send({ ...VALID, message: 'newer' });

    const res = await request(app).get('/api/admin/logs/client').set('Cookie', await adminCookie());
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.entries.map((e) => e.message), ['newer', 'older']);
  });

  await t.test('it does not answer the instance-fault card and vice versa', async () => {
    clearClientErrors();
    clearLogs();
    const { logger } = require('../lib/observability');
    logger.warn({ event: 'readiness_failed', message: 'server side' });
    await request(app).post('/api/client-error').send({ ...VALID, message: 'browser side' });

    const cookie = await adminCookie();
    const server = await request(app).get('/api/admin/logs').set('Cookie', cookie);
    const client = await request(app).get('/api/admin/logs/client').set('Cookie', cookie);
    assert.deepEqual(server.body.entries.map((e) => e.message), ['server side']);
    assert.deepEqual(client.body.entries.map((e) => e.message), ['browser side']);
  });
});

/* ------------------- the window handlers, in a real window ---------------- */

// The Node tests above drive the pure helpers; these drive the actual listeners
// error-report.js installs, in the jsdom shell, and then hand what they produced
// to the REAL endpoint. That round trip is the point: a payload the client builds
// and the server refuses would leave the fault invisible, which is the exact
// condition this feature exists to end, so neither half proves it alone.
//
// What jsdom cannot do is throw an uncaught error and have the window dispatch
// 'error' for it — so the event is dispatched. That the browser fires these two
// events at all is platform behaviour (it is what every `window.onerror`
// reporter on the web rides on), and the same reasoning
// .claude/rules/blur-events-never-fire-in-the-preview-pane.md applies to a
// dispatched blur: what needs proving is our handler, its payload and its
// bounds.
test('the installed window handlers report and the endpoint accepts what they send', async (t) => {
  const { loadApp } = require('./support/dom');

  // Boot the shell, recording every fetch the reporter makes. loadApp's URL is
  // https://spielwirbel.app/, so location.origin is our own and a source under
  // /js/ is accepted.
  function boot() {
    const dom = loadApp({ locale: 'de' });
    const sent = [];
    dom.context.fetch = (url, opts) => {
      sent.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true });
    };
    return { dom, sent };
  }

  await t.test('an uncaught error is reported with its script, line and screen', async () => {
    const { dom, sent } = boot();
    t.after(() => dom.close());

    dom.run(`window.history.replaceState({}, '', '/round/r-abc123/chronik')`);
    dom.run(`window.dispatchEvent(new ErrorEvent('error', {
      message: "Cannot read properties of null (reading 'x')",
      filename: 'https://spielwirbel.app/js/views-chronik.js',
      lineno: 461,
    }))`);

    assert.equal(sent.length, 1, 'the handler fired exactly once');
    assert.equal(sent[0].url, '/api/client-error');
    const body = { ...sent[0].body };
    assert.equal(body.kind, 'uncaught');
    assert.equal(body.source, 'js/views-chronik.js:461');
    assert.equal(body.path, '/round/:rid/chronik', 'the round id did not survive');
    assert.equal(body.locale, 'de');

    // …and the real route takes it, which is the half a client-only spec cannot
    // see. Same object, straight through.
    clearClientErrors();
    const res = await request(app).post('/api/client-error').send(body);
    assert.equal(res.status, 204);
    const admin = await request(app).get('/api/admin/logs/client').set('Cookie', await adminCookie());
    assert.equal(admin.body.entries.length, 1);
    assert.equal(admin.body.entries[0].kind, 'uncaught');
    assert.equal(admin.body.entries[0].source, 'js/views-chronik.js:461');
  });

  await t.test('an unhandled rejection is reported and accepted too', async () => {
    const { dom, sent } = boot();
    t.after(() => dom.close());

    dom.run(`(() => {
      const e = new Event('unhandledrejection');
      e.reason = new TypeError('fetch failed');
      window.dispatchEvent(e);
    })()`);

    assert.equal(sent.length, 1);
    const body = { ...sent[0].body };
    assert.equal(body.kind, 'unhandled_rejection');
    assert.equal(body.message, 'fetch failed');
    assert.ok(!('source' in body), 'a rejection carries no script location');

    clearClientErrors();
    assert.equal((await request(app).post('/api/client-error').send(body)).status, 204);
    assert.equal(recentClientErrors()[0].kind, 'unhandled_rejection');
  });

  await t.test('a failed resource load is NOT reported', async () => {
    // window 'error' also fires for a broken <img>/<script>, without a message.
    // That is the server's business, not a browser fault, and reporting it would
    // fill the card with 404s on covers.
    const { dom, sent } = boot();
    t.after(() => dom.close());
    dom.run(`window.dispatchEvent(new ErrorEvent('error', { message: '' }))`);
    assert.equal(sent.length, 0);
  });

  await t.test('a fault in a render loop produces ONE request, not hundreds', async () => {
    const { dom, sent } = boot();
    t.after(() => dom.close());
    dom.run(`for (let i = 0; i < 200; i++) window.dispatchEvent(new ErrorEvent('error', {
      message: 'the same fault again',
      filename: 'https://spielwirbel.app/js/views-regal.js',
      lineno: 12,
    }))`);
    assert.equal(sent.length, 1, 'de-duplicated to one');
  });

  await t.test('a rejecting endpoint does not make the page worse', async () => {
    // The reporter is fire-and-forget: a rejected fetch must not surface as an
    // unhandled rejection, which would fire the OTHER handler and recurse.
    const dom = loadApp({ locale: 'de' });
    t.after(() => dom.close());
    let calls = 0;
    dom.context.fetch = () => { calls += 1; return Promise.reject(new Error('offline')); };
    dom.run(`window.dispatchEvent(new ErrorEvent('error', { message: 'boom', lineno: 1 }))`);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1, 'tried once and swallowed the failure');
  });

  await t.test('a report from a vote link carries no part of the token', async () => {
    const { dom, sent } = boot();
    t.after(() => dom.close());
    const token = 'NOT-A-REAL-TOKEN-just-a-path-segment';  // see the note above
    dom.run(`window.history.replaceState({}, '', '/vote/${token}')`);
    dom.run(`window.dispatchEvent(new ErrorEvent('error', { message: 'boom', lineno: 1 }))`);

    assert.equal(sent.length, 1);
    const body = { ...sent[0].body };
    assert.equal(body.path, '/vote/:token');
    assert.ok(!JSON.stringify(body).includes(token), 'the credential is nowhere in the payload');
  });
});

/* --------------------------- the shared enum contract --------------------- */

test('the kinds the client can send are the kinds the server accepts', async (t) => {
  await t.test('every kind round-trips', async () => {
    // The client OFFERS this set and the server VALIDATES against it, so they
    // are one file (.claude/rules/shared-constants-across-the-stack.md). The
    // loop is what proves it: a single-kind happy path passes forever against a
    // server copy that has drifted, which is the palette bug that rule exists for.
    for (const kind of CLIENT_ERROR_KINDS) {
      clearClientErrors();
      const res = await request(app).post('/api/client-error').send({ kind });
      assert.equal(res.status, 204, `${kind} is accepted`);
      assert.equal(recentClientErrors()[0].kind, kind);
    }
  });

  await t.test('the enum is a non-empty list of plain snake_case names', () => {
    assert.ok(CLIENT_ERROR_KINDS.length >= 5);
    for (const kind of CLIENT_ERROR_KINDS) assert.match(kind, /^[a-z][a-z_]*$/);
  });

  await t.test('the per-page-load cap is small enough to bound a render loop', () => {
    assert.ok(CLIENT_ERROR_MAX_PER_LOAD > 0 && CLIENT_ERROR_MAX_PER_LOAD <= 10);
  });
});
