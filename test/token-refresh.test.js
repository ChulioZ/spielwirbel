'use strict';

/*
 * The silent token refresh may end a session only when the server REJECTS the
 * refresh token — never because the refresh request itself could not complete.
 *
 * `POST /api/account/refresh` answers 401 `invalid_refresh_token` for an
 * unknown, spent or expired token and 403 `account_disabled` for a suspended
 * account; those two are definitive. Everything else — the per-IP auth
 * limiter's 429, a 5xx, a network failure — says nothing about the token, and
 * the session must survive it: the tokens stay, and the caller surfaces an
 * ordinary failed request instead of the login screen.
 *
 * Driven through the real frontend in jsdom (test/support/dom.js), with only
 * `fetch` stubbed, so every assertion is about what the browser would do:
 * the tokens left in localStorage, whether onSessionLost() ran, and what the
 * caller threw. The three callers are all covered — core.js api(),
 * accountApi() and the boot probe — because each used to clear the tokens on
 * its own.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const OLD = { access: 'old-access', refresh: 'r1.u1.old-refresh' };
const NEW = { access: 'new-access', refresh: 'r1.u1.new-refresh' };

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/* Boot the app as a logged-in accounts-mode client holding OLD tokens. `route`
   answers every fetch; `calls` records each one. onSessionLost is replaced by a
   counter so a lost session is observable without rendering the login screen. */
function boot(t, route) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.context.__tokens = OLD;
  dom.run('setTokens(__tokens.access, __tokens.refresh)');
  dom.set('accountsActive', () => true);
  const state = { lost: 0, calls: [] };
  dom.set('onSessionLost', () => { state.lost += 1; });
  dom.set('fetch', async (url, opts = {}) => {
    state.calls.push({ url, auth: (opts.headers || {}).Authorization });
    return route(url, opts, dom);
  });
  const tokens = () => ({
    access: dom.window.localStorage.getItem('sa_access'),
    refresh: dom.window.localStorage.getItem('sa_refresh'),
  });
  const refreshes = () => state.calls.filter((c) => c.url === '/api/account/refresh').length;
  return { dom, state, tokens, refreshes };
}

/* A data route that answers 401 auth_required to the OLD access token and 200
   to the NEW one, and a refresh endpoint answering `refreshStatus`. */
const dataRoute = (refreshStatus) => async (url, opts) => {
  if (url === '/api/account/refresh') {
    if (refreshStatus === 'network') throw new TypeError('Failed to fetch');
    if (refreshStatus === 200) return reply(200, { accessToken: NEW.access, refreshToken: NEW.refresh });
    return reply(refreshStatus, { error: refreshStatus === 401 ? 'invalid_refresh_token' : 'whatever' });
  }
  if ((opts.headers || {}).Authorization === `Bearer ${NEW.access}`) return reply(200, { rounds: [] });
  return reply(401, { error: 'auth_required' });
};

/* ------------------------------ core.js api() ------------------------------ */

for (const status of [429, 500, 503, 'network']) {
  test(`api(): a refresh that fails with ${status} keeps the session`, async (t) => {
    const { dom, state, tokens } = boot(t, dataRoute(status));
    await assert.rejects(() => dom.call('api', 'GET', '/api/rounds'), 'the request itself still fails');
    assert.equal(state.lost, 0, 'onSessionLost() ran for a refresh that never got an answer about the token');
    assert.deepEqual(tokens(), OLD, 'the tokens were cleared by a transient failure');
  });
}

for (const status of [401, 403]) {
  test(`api(): a refresh the server REJECTS with ${status} ends the session`, async (t) => {
    const { dom, state, tokens } = boot(t, dataRoute(status));
    await assert.rejects(() => dom.call('api', 'GET', '/api/rounds'));
    assert.equal(state.lost, 1, 'a definitively rejected refresh token must end the session');
    assert.deepEqual(tokens(), { access: null, refresh: null });
  });
}

test('api(): a refresh that succeeds retries the request with the new token', async (t) => {
  // Anti-vacuous partner of the cases above: a stub that never let anything
  // succeed would pass "keeps the session" for the wrong reason.
  const { dom, state, tokens } = boot(t, dataRoute(200));
  assert.deepEqual({ ...(await dom.call('api', 'GET', '/api/rounds')) }, { rounds: [] });
  assert.equal(state.lost, 0);
  assert.deepEqual(tokens(), NEW);
});

test('api(): two requests that 401 together share ONE refresh, and both go through', async (t) => {
  /* Refresh tokens rotate: the first refresh spends OLD.refresh, so a second,
     concurrent refresh presenting the same token is answered 401 — a definitive
     rejection, of a token this very tab just rotated. Without sharing the
     in-flight refresh, that 401 cleared the fresh pair and ended the session. */
  let spent = false;
  const { dom, state, tokens, refreshes } = boot(t, async (url, opts) => {
    if (url === '/api/account/refresh') {
      const presented = JSON.parse(opts.body).refreshToken;
      await new Promise((r) => setImmediate(r)); // let the second request arrive mid-flight
      if (presented !== OLD.refresh || spent) return reply(401, { error: 'invalid_refresh_token' });
      spent = true;
      return reply(200, { accessToken: NEW.access, refreshToken: NEW.refresh });
    }
    return dataRoute(200)(url, opts);
  });
  const both = await Promise.all([dom.call('api', 'GET', '/api/rounds'), dom.call('api', 'GET', '/api/rounds')]);
  assert.equal(both.length, 2);
  assert.equal(refreshes(), 1, 'each 401 ran its own refresh');
  assert.equal(state.lost, 0, 'the second refresh spent an already-rotated token and ended the session');
  assert.deepEqual(tokens(), NEW);
});

test('api(): a refresh rejected because ANOTHER TAB already rotated the token keeps the session', async (t) => {
  /* Tabs share localStorage. If another tab rotates while this tab's refresh
     is in flight, this tab's (now spent) token is answered 401 — but the pair
     in storage is valid, so clearing it would sign out every tab. */
  const { dom, state, tokens } = boot(t, async (url, opts) => {
    if (url === '/api/account/refresh') {
      dom.window.localStorage.setItem('sa_access', NEW.access); // the other tab's rotation lands
      dom.window.localStorage.setItem('sa_refresh', NEW.refresh);
      return reply(401, { error: 'invalid_refresh_token' });
    }
    return dataRoute(200)(url, opts);
  });
  assert.deepEqual({ ...(await dom.call('api', 'GET', '/api/rounds')) }, { rounds: [] });
  assert.equal(state.lost, 0);
  assert.deepEqual(tokens(), NEW, "the other tab's fresh pair was cleared");
});

/* ------------------------------- accountApi() ------------------------------ */

const accountRoute = (refreshStatus) => async (url, opts) => {
  if (url === '/api/account/refresh') return dataRoute(refreshStatus)(url, opts);
  if ((opts.headers || {}).Authorization === `Bearer ${NEW.access}`) return reply(200, { id: 'u1' });
  return reply(401, { error: 'invalid_token' });
};

test('accountApi(): a rate-limited refresh keeps the session and throws an ordinary error', async (t) => {
  const { dom, state, tokens } = boot(t, accountRoute(429));
  const err = await dom.call('accountApi', 'GET', '/me').then(() => null, (e) => e);
  assert.ok(err, 'the request should still fail');
  // 'auth' is what callers read as "the session is gone, the login screen is up"
  // (bgg-import.js returns silently on it) — a transient failure must not say so.
  assert.notEqual(err.message, 'auth');
  assert.equal(state.lost, 0);
  assert.deepEqual(tokens(), OLD);
});

test('accountApi(): a rejected refresh ends the session and throws auth', async (t) => {
  const { dom, state, tokens } = boot(t, accountRoute(401));
  const err = await dom.call('accountApi', 'GET', '/me').then(() => null, (e) => e);
  assert.equal(err && err.message, 'auth');
  assert.equal(state.lost, 1);
  assert.deepEqual(tokens(), { access: null, refresh: null });
});

/* ------------------------------- the boot probe ----------------------------- */

const bootRoute = (refreshStatus) => async (url, opts) => {
  if (url === '/api/account/refresh') return dataRoute(refreshStatus)(url, opts);
  if (url === '/api/account/me') {
    return (opts.headers || {}).Authorization === `Bearer ${NEW.access}`
      ? reply(200, { id: 'u1', username: 'ada' })
      : reply(401, { error: 'auth_required' });
  }
  throw new Error(`unexpected fetch ${url}`);
};

test('boot: a rate-limited refresh keeps the tokens and asks for a retry', async (t) => {
  // A cold load with an expired access token: /me 401s, the refresh is refused
  // by the limiter. The visitor is still signed in — a reload in a moment works.
  const { dom, tokens } = boot(t, bootRoute(429));
  assert.equal(await dom.call('initAccounts'), 'rate_limited');
  assert.deepEqual(tokens(), OLD, 'boot signed the visitor out over a rate limit');
});

test('boot: a rejected refresh clears the tokens and lands logged out', async (t) => {
  const { dom, tokens } = boot(t, bootRoute(401));
  assert.equal(await dom.call('initAccounts'), undefined);
  assert.deepEqual(tokens(), { access: null, refresh: null });
});

test('boot: a refresh that succeeds signs straight back in', async (t) => {
  const { dom, tokens } = boot(t, bootRoute(200));
  assert.equal(await dom.call('initAccounts'), undefined);
  assert.equal(dom.run('currentUsername()'), 'ada');
  assert.deepEqual(tokens(), NEW);
});
