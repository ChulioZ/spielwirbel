'use strict';

/*
 * Guest demo mode (issue #427).
 *
 * The shared app from test/helpers.js runs accounts-OFF, so it cannot exercise
 * this at all — every spec here builds its own app with ACCOUNTS_ENABLED +
 * SESSION_SECRET + DEMO_ENABLED, the buildApp shape test/layered-auth.test.js
 * uses (.claude/rules/liveness-vs-readiness-probes.md makes the same point about
 * writing a spec against the wrong app: it produces an assertion that is simply
 * false rather than one that fails usefully).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-demo-'));
process.env.LOG_LEVEL = 'silent';
// Out of reach, so the demo endpoint's own tighter limiter is what any
// rate-limit assertion here observes — both answer the identical
// `429 { error: 'rate_limited' }`, so a low auth ceiling would let a limiter
// test pass even if the demo limiter had never been mounted.
process.env.AUTH_RATE_LIMIT_MAX = '1000000';
process.env.RATE_LIMIT_MAX = '1000000';

const { createApp } = require('../lib/app');
const repo = require('../lib/repo');
const demo = require('../lib/demo');
const seed = require('../lib/demo-seed');
const scheduler = require('../lib/scheduler');
const observability = require('../lib/observability');
const { providerCoverUrl } = require('../lib/providers');
const { TAG_ICONS } = require('../lib/tag-icons');

// Each spec restores what it changed; `env()` keeps that from being a per-test
// chore that one spec eventually forgets.
function env(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const out = fn();
  return out && typeof out.then === 'function'
    ? out.then((r) => { restore(); return r; }, (e) => { restore(); throw e; })
    : (restore(), out);
}

const DEMO_ENV = {
  ACCOUNTS_ENABLED: 'true',
  SESSION_SECRET: 'demo-test-secret',
  DEMO_ENABLED: 'true',
};

const withDemo = (extra, fn) => env({ ...DEMO_ENV, ...extra }, fn);

// Mint a demo over HTTP and hand back the app + tokens, since almost every spec
// needs exactly that.
async function startDemo(app, body) {
  const res = await request(app).post('/api/account/demo').send(body || {});
  return res;
}

const auth = (res) => ['Authorization', `Bearer ${res.body.accessToken}`];

/* ------------------------------ the seed table ------------------------------ */

test('every seeded cover passes the same guard the add-game route applies', () => {
  // Not a style check: an `image` that fails this is stored but never renders —
  // CSP blocks an off-allowlist host and the app shows a gradient with only a
  // console violation to explain it. Rendering nothing is the failure mode this
  // catches, and it is invisible from every other test.
  for (const game of seed.DEMO_GAMES) {
    if (game.image === null) continue;
    assert.strictEqual(
      providerCoverUrl(game.image),
      game.image,
      `${game.title}: cover URL is not one the app would store`
    );
  }
});

test('every seeded tag icon is on the TAG_ICONS allowlist', () => {
  // An off-list key renders NOTHING, with no error anywhere — so a typo here is
  // only ever caught by someone looking at the screen.
  for (const [key, tag] of Object.entries(seed.DEMO_TAGS)) {
    assert.ok(TAG_ICONS.includes(tag.icon), `tag ${key}: icon '${tag.icon}' is not in TAG_ICONS`);
  }
});

test('every tag a seeded game references exists', () => {
  for (const game of seed.DEMO_GAMES) {
    for (const key of game.tags || []) {
      assert.ok(seed.DEMO_TAGS[key], `${game.title} references unknown tag '${key}'`);
    }
  }
});

test('the seeded shelf can actually be drawn from at the seeded table size', () => {
  // The demo seats four (owner + three). A shelf whose games all cap below that
  // makes the visitor's FIRST action — "Session wirbeln" — answer "No matching
  // games in this round", which reads as the app being broken on the one screen
  // the demo exists to demonstrate. Arithmetic over the declared numbers, the
  // same shape .claude/rules/responsive-content-width.md pins column counts with.
  const seats = 1 + seed.DEMO_TEXT.de.members.length;
  const drawable = seed.DEMO_GAMES.filter(
    (g) => (g.minPlayers == null || seats >= g.minPlayers) && (g.maxPlayers == null || seats <= g.maxPlayers)
  );
  assert.ok(drawable.length >= 3, `only ${drawable.length} of ${seed.DEMO_GAMES.length} games are drawable at ${seats} players`);
});

test('both locales seed the same number of fellow players', () => {
  assert.strictEqual(seed.DEMO_TEXT.de.members.length, seed.DEMO_TEXT.en.members.length);
});

test('an unknown locale falls back to German rather than throwing', () => {
  assert.strictEqual(seed.textFor('fr'), seed.DEMO_TEXT.de);
  assert.strictEqual(seed.textFor(''), seed.DEMO_TEXT.de);
  assert.strictEqual(seed.textFor(undefined), seed.DEMO_TEXT.de);
  assert.strictEqual(seed.textFor('en-GB'), seed.DEMO_TEXT.en);
});

/* --------------------------------- the gate --------------------------------- */

test('the endpoint 404s when DEMO_ENABLED is unset', async () => {
  await env({ ACCOUNTS_ENABLED: 'true', SESSION_SECRET: 's', DEMO_ENABLED: undefined }, async () => {
    const res = await startDemo(createApp());
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'demo_disabled');
  });
});

test('the endpoint 404s when accounts are off, even with DEMO_ENABLED set', async () => {
  // The whole account router is inert without accounts, so this asserts the
  // demo cannot be switched on independently of the mode it depends on.
  await env({ ACCOUNTS_ENABLED: undefined, SESSION_SECRET: undefined, DEMO_ENABLED: 'true' }, async () => {
    const res = await startDemo(createApp());
    assert.strictEqual(res.status, 404);
  });
});

test('/api/config reports the demo flag so the landing CTA is only shown where it works', async () => {
  await withDemo({}, async () => {
    const on = await request(createApp()).get('/api/config');
    assert.strictEqual(on.body.demo, true);
  });
  await env({ ...DEMO_ENV, DEMO_ENABLED: undefined }, async () => {
    const off = await request(createApp()).get('/api/config');
    assert.strictEqual(off.body.demo, false);
  });
});

/* ------------------------------- minting + seed ----------------------------- */

test('a demo mints a working token pair scoped to its own fresh tenant', async () => {
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, { locale: 'de' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.accessToken && res.body.refreshToken);
    assert.strictEqual(res.body.user.demo, true);

    const rounds = await request(app).get('/api/rounds').set(...auth(res));
    assert.strictEqual(rounds.status, 200);
    assert.strictEqual(rounds.body.length, 1);
  });
});

test('two demos cannot see each other', async () => {
  // The synthetic e-mail is unique per demo precisely so a second mint succeeds;
  // if that regressed, this fails at the second startDemo rather than later.
  await withDemo({}, async () => {
    const app = createApp();
    const a = await startDemo(app, { locale: 'de' });
    const b = await startDemo(app, { locale: 'de' });
    assert.strictEqual(b.status, 200);
    assert.notStrictEqual(a.body.user.id, b.body.user.id);

    const aRounds = await request(app).get('/api/rounds').set(...auth(a));
    const bRounds = await request(app).get('/api/rounds').set(...auth(b));
    assert.notStrictEqual(aRounds.body[0].id, bRounds.body[0].id);

    // and B cannot reach A's round by id
    const cross = await request(app).get(`/api/rounds/${aRounds.body[0].id}`).set(...auth(b));
    assert.strictEqual(cross.status, 404);
  });
});

test('the seeded round is immediately usable: Chronik and Pokale have content, and a draw succeeds', async () => {
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, { locale: 'de' });
    const list = await request(app).get('/api/rounds').set(...auth(res));
    const rid = list.body[0].id;
    const round = await request(app).get(`/api/rounds/${rid}`).set(...auth(res));

    assert.strictEqual(round.body.games.length, seed.DEMO_GAMES.length);
    assert.strictEqual(round.body.members.length, 1 + seed.DEMO_TEXT.de.members.length);
    // Chronik + Pokale both render off finished sessions; an empty state on
    // arrival is exactly what the issue set out to avoid.
    const finished = round.body.sessions.filter((s) => s.finished);
    assert.strictEqual(finished.length, seed.DEMO_SESSIONS.length);
    assert.ok(finished.every((s) => s.winnerIds.length > 0), 'a finished session must have winners or Pokale stays empty');
    assert.ok(finished.every((s) => Object.keys(s.votes || {}).length > 0), 'ratings drive every stat screen');

    // The whole point: the visitor can run a session.
    const draw = await request(app)
      .post(`/api/rounds/${rid}/sessions`)
      .set(...auth(res))
      .send({ memberIds: round.body.members.map((m) => m.id), count: 3 });
    assert.strictEqual(draw.status, 201);
    assert.ok(draw.body.games.length >= 1);
  });
});

test('the seed is localized, and the visitor holds the owner seat', async () => {
  await withDemo({}, async () => {
    const app = createApp();
    for (const locale of ['de', 'en']) {
      const res = await startDemo(app, { locale });
      const list = await request(app).get('/api/rounds').set(...auth(res));
      const round = await request(app).get(`/api/rounds/${list.body[0].id}`).set(...auth(res));
      assert.strictEqual(round.body.name, seed.DEMO_TEXT[locale].roundName);
      // #421: the owner seat is PREPENDED and is the only member carrying a
      // userId, which is what makes Chronik attribution work for the visitor.
      assert.strictEqual(round.body.members[0].name, seed.DEMO_TEXT[locale].ownerSeat);
      assert.strictEqual(round.body.members[0].userId, res.body.user.id);
      assert.ok(round.body.tags.some((tg) => tg.name === seed.tagNameFor('party', locale)));
    }
  });
});

test('a demo account has no password identity, so it can never be logged into', async () => {
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, {});
    const login = await request(app)
      .post('/api/account/login')
      .send({ login: res.body.user.username, password: 'anything' });
    assert.strictEqual(login.status, 401);
  });
});

test('/me reports the demo flag so the banner survives a reload', async () => {
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, {});
    const me = await request(app).get('/api/account/me').set(...auth(res));
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.demo, true);
    assert.ok(me.body.demoExpiresAt);
  });
});

/* ---------------------------------- bounds ---------------------------------- */

test('the live-demo ceiling refuses politely instead of minting unboundedly', async () => {
  // Sized RELATIVE to what is already live: every spec in this file shares one
  // DATA_DIR, so a hardcoded ceiling passes alone and fails in file order. Same
  // trap as the mail budget's per-process counter
  // (.claude/rules/bounding-bulk-registration-mail.md).
  const live = await repo.countLiveDemoUsers(new Date().toISOString());
  await withDemo({ MAX_LIVE_DEMOS: String(live + 2) }, async () => {
    const app = createApp();
    assert.strictEqual((await startDemo(app, {})).status, 200);
    assert.strictEqual((await startDemo(app, {})).status, 200);
    const third = await startDemo(app, {});
    // 503, deliberately NOT 429: this is a capacity answer, and the client shows
    // a different message for it than for the rate limiter.
    assert.strictEqual(third.status, 503);
    assert.strictEqual(third.body.error, 'demo_unavailable');
  });
});

test('the demo endpoint has its own per-IP limiter', async () => {
  // AUTH_RATE_LIMIT_MAX is out of reach (top of file), so a 429 here can only
  // come from the demo limiter — otherwise this would pass with it unmounted.
  await withDemo({ DEMO_RATE_LIMIT_MAX: '2', MAX_LIVE_DEMOS: '100' }, async () => {
    const app = createApp();
    await startDemo(app, {});
    await startDemo(app, {});
    const third = await startDemo(app, {});
    assert.strictEqual(third.status, 429);
    assert.strictEqual(third.body.error, 'rate_limited');
  });
});

test('a demo account cannot send friend requests or round invitations', async () => {
  // "We didn't build a UI for it" is not a control — these endpoints are
  // reachable by hand with the demo's own token, and a throwaway account is an
  // unattributable spam channel into a real user's inbox.
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, {});
    const friend = await request(app)
      .post('/api/account/friends')
      .set(...auth(res))
      .send({ username: 'somebody' });
    assert.strictEqual(friend.status, 403);
    assert.strictEqual(friend.body.error, 'demo_forbidden');

    const list = await request(app).get('/api/rounds').set(...auth(res));
    const invite = await request(app)
      .post('/api/account/invitations')
      .set(...auth(res))
      .send({ username: 'somebody', roundId: list.body[0].id });
    assert.strictEqual(invite.status, 403);
    assert.strictEqual(invite.body.error, 'demo_forbidden');
  });
});

/* ------------------------------ event exclusion ----------------------------- */

test('demo tenants are excluded from the product counters, real ones are not', async () => {
  // Asserted against the real logger rather than by reading trackEvent's source,
  // and both directions are checked — a skip that dropped EVERY event would pass
  // the exclusion half on its own.
  const lines = [];
  const restore = observability.logger.info.bind(observability.logger);
  observability.logger.info = (obj) => { lines.push(obj); return restore(obj); };
  try {
    observability.trackEvent('round_created', { tenantId: `${demo.DEMO_TENANT_PREFIX}abc123` });
    observability.trackEvent('round_created', { tenantId: 'a1b2c3d4e5f60718' });
  } finally {
    observability.logger.info = restore;
  }
  const tracked = lines.filter((l) => l && l.event === 'round_created');
  assert.strictEqual(tracked.length, 1, 'exactly the non-demo event should be logged');
  assert.strictEqual(tracked[0].tenantId, 'a1b2c3d4e5f60718');
});

test('the demo tenant prefix is the same string in both modules', () => {
  // observability.js duplicates the literal to avoid a require cycle, so nothing
  // but this pins them together — and a drift silently un-excludes demo traffic.
  assert.strictEqual(demo.DEMO_TENANT_PREFIX, observability.DEMO_TENANT_PREFIX);
});

test('a minted demo tenant actually carries the prefix', () => {
  // The exclusion above is worthless if the ids it keys on don't have it.
  assert.ok(demo.isDemoTenant(`${demo.DEMO_TENANT_PREFIX}deadbeef`));
  assert.ok(!demo.isDemoTenant('a1b2c3d4e5f60718'));
});

/* ----------------------------------- purge ---------------------------------- */

test('an expired demo is purged with its rounds, and its live token then 401s', async () => {
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, {});
    const uid = res.body.user.id;

    // Still live: the purge must leave it alone. Asserting this FIRST is what
    // stops the test passing against a purge that simply deletes everything.
    assert.deepStrictEqual(await scheduler.runJob('purgeExpiredDemos'), { purged: 0, rounds: 0 });
    assert.strictEqual((await request(app).get('/api/rounds').set(...auth(res))).status, 200);

    // Expire it by moving its own deadline into the past, rather than by waiting.
    await repo.updateUser(uid, { demoExpiresAt: new Date(Date.now() - 1000).toISOString() });

    const result = await scheduler.runJob('purgeExpiredDemos');
    assert.strictEqual(result.purged, 1);
    assert.strictEqual(result.rounds, 1);
    assert.strictEqual(await repo.getUserById(uid), null);

    // The access token is a stateless JWT and is still signature-valid — the
    // 401 comes from lib/tenant.js resolving a deleted row to ERASED, which is
    // what makes purging mid-session safe with no client-side work
    // (.claude/rules/erased-account-token-fallback.md).
    const after = await request(app).get('/api/rounds').set(...auth(res));
    assert.strictEqual(after.status, 401);
    assert.strictEqual(after.body.error, 'auth_required');
  });
});

test('a demo row with no expiry reads as expired, never as live', async () => {
  // The malformed case has to fall one way on purpose: counted as live it would
  // occupy a cap slot forever, and never purged it would leak rows indefinitely.
  // The two predicates are exact complements, so this checks both at once.
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, {});
    // A DELTA, not an absolute — other specs in this file leave live demos
    // behind, so `live === 0` would be asserting their absence, not this row's.
    const before = await repo.countLiveDemoUsers(new Date().toISOString());
    await repo.updateUser(res.body.user.id, { demoExpiresAt: null });

    const now = new Date().toISOString();
    assert.strictEqual(await repo.countLiveDemoUsers(now), before - 1);
    assert.ok((await repo.listExpiredDemoUsers(now)).includes(res.body.user.id));
  });
});

test('the purge leaves real accounts alone', async () => {
  // The sweep keys on the demo flag, not on the tenant prefix or on age — a
  // regression to "anything old" would take real users' data with it.
  await withDemo({}, async () => {
    const app = createApp();
    const reg = await request(app)
      .post('/api/account/register')
      .send({ email: 'real@example.com', username: 'realuser', password: 'correct-horse' });
    assert.strictEqual(reg.status, 200);
    const real = await repo.getUserByEmail('real@example.com');
    assert.ok(real);

    await repo.updateUser(real.id, { demoExpiresAt: new Date(Date.now() - 99999).toISOString() });
    await scheduler.runJob('purgeExpiredDemos');
    assert.ok(await repo.getUserById(real.id), 'a non-demo account must survive the purge');
  });
});

test('the purge job is inert when the demo is disabled', async () => {
  await env({ ...DEMO_ENV, DEMO_ENABLED: undefined }, async () => {
    assert.strictEqual(await scheduler.runJob('purgeExpiredDemos'), null);
  });
});

test('an unknown job name throws rather than silently doing nothing', async () => {
  await assert.rejects(() => scheduler.runJob('nope'), /Unknown scheduled job/);
});

/* ---------------------------------- config ---------------------------------- */

test('the TTL and cap are read per call, so a live re-tune needs no restart', () => {
  env({ DEMO_TTL_HOURS: '2', MAX_LIVE_DEMOS: '7' }, () => {
    assert.strictEqual(demo.ttlMs(), 2 * 60 * 60 * 1000);
    assert.strictEqual(demo.maxLiveDemos(), 7);
  });
  env({ DEMO_TTL_HOURS: undefined, MAX_LIVE_DEMOS: undefined }, () => {
    assert.strictEqual(demo.ttlMs(), demo.DEFAULT_TTL_HOURS * 60 * 60 * 1000);
    assert.strictEqual(demo.maxLiveDemos(), demo.DEFAULT_MAX_LIVE);
  });
});
