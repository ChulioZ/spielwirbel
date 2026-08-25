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
// Likewise out of reach (#502): every spec here mints from the SAME supertest
// source address, so the default per-IP live cap of 3 would refuse every mint
// from the twelfth test onward — and because the refusal is a polite 503, the
// symptom is `res.body.user` being undefined in a dozen unrelated specs rather
// than anything naming the cap. The two specs that exercise the cap set their
// own ceiling.
process.env.MAX_LIVE_DEMOS_PER_IP = '1000000';

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

test('every seeded locale seeds the same number of fellow players', () => {
  // The seat count is what the draw pool's player ranges are sized against
  // (see the drawable-games spec above), so it must not vary by language.
  const counts = seed.DEMO_LOCALES.map((loc) => seed.DEMO_TEXT[loc].members.length);
  assert.ok(counts.length >= 2, 'expected at least two seeded locales');
  assert.deepEqual([...new Set(counts)], [counts[0]], `fellow-player counts differ by locale: ${counts.join(', ')}`);
});

test('a locale with no seed text falls back to English rather than throwing', () => {
  // English, not German (#504): a UI locale may ship before its demo text, and
  // handing a Dutch or Portuguese visitor a German round is the half-translated
  // impression the per-locale seed exists to avoid.
  //
  // The stand-in is the UNSHIPPED 'zx', as in test/i18n-locales.test.js. It used
  // to be 'it' — a language with an open translation issue, so shipping Italian
  // (#536) made textFor('it') return the Italian seed and this assertion assert
  // the opposite of its own name. Never stand in for "unshipped" with a code
  // some issue is about to ship (.claude/rules/locale-set-is-data.md).
  assert.strictEqual(seed.textFor('zx'), seed.DEMO_TEXT.en);
  assert.strictEqual(seed.textFor(''), seed.DEMO_TEXT.en);
  assert.strictEqual(seed.textFor(undefined), seed.DEMO_TEXT.en);
  assert.strictEqual(seed.tagNameFor('party', 'zx'), seed.DEMO_TAGS.party.en);
  // A locale that DOES have text still gets its own, region tag and all.
  assert.strictEqual(seed.textFor('en-GB'), seed.DEMO_TEXT.en);
  assert.strictEqual(seed.textFor('de'), seed.DEMO_TEXT.de);
  assert.strictEqual(seed.tagNameFor('party', 'de'), seed.DEMO_TAGS.party.de);
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
    // Derived from the seed's own locale set, so a language that gains demo
    // text is covered without anyone remembering this loop exists.
    for (const locale of seed.DEMO_LOCALES) {
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

test('one source cannot hold more than MAX_LIVE_DEMOS_PER_IP live demos', async () => {
  // The defect (#502): the per-IP RATE limiter bounds how fast one visitor may
  // mint, but nothing bounded how many they could hold — and leaving a demo
  // (logout, the register CTA, a closed tab) frees no slot, so start -> leave ->
  // start again strands them one at a time until the pool is empty.
  //
  // MAX_LIVE_DEMOS is left out of reach so a refusal here can only be the
  // per-IP cap: both answer the identical 503 demo_unavailable, so a low global
  // ceiling would let this pass with the per-IP check never wired up at all.
  //
  // TRUST_PROXY makes req.ip follow X-Forwarded-For, which lets this spec own a
  // source address nothing else in the file uses. That matters more than it
  // looks: every other spec mints from the one supertest loopback address, so a
  // cap sized against *that* bucket would pass alone and fail in file order —
  // the trap .claude/rules/guest-demo-accounts.md warns about, here in its
  // per-IP form.
  await withDemo({ MAX_LIVE_DEMOS_PER_IP: '2', MAX_LIVE_DEMOS: '1000000', TRUST_PROXY: '1' }, async () => {
    const app = createApp();
    const from = (ip) => request(app).post('/api/account/demo').set('X-Forwarded-For', ip).send({});

    assert.strictEqual((await from('198.51.100.10')).status, 200);
    assert.strictEqual((await from('198.51.100.10')).status, 200);

    const third = await from('198.51.100.10');
    assert.strictEqual(third.status, 503);
    assert.strictEqual(third.body.error, 'demo_unavailable');

    // A different source is unaffected — this is what proves the cap is keyed on
    // the address at all, rather than being a second global ceiling.
    assert.strictEqual((await from('198.51.100.11')).status, 200);
  });
});

test('the stored IP value is a keyed hash, never the address itself', async () => {
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, {});
    const user = await repo.getUserById(res.body.user.id);

    assert.match(user.demoIpHash, /^[0-9a-f]{64}$/); // HMAC-SHA-256, hex
    // supertest drives ::ffff:127.0.0.1 — whatever it is, it must not be stored.
    assert.ok(!String(user.demoIpHash).includes('127.0.0.1'));
    // Keyed with SESSION_SECRET: a bare digest of the address would be trivially
    // reversible by hashing the IPv4 space.
    const bare = require('crypto').createHash('sha256').update('127.0.0.1').digest('hex');
    assert.notStrictEqual(user.demoIpHash, bare);
  });
});

test('an unattributable mint stores null and never shares a bucket', async () => {
  // hashIp returns null with no address, and createDemoAccount must then SKIP
  // the per-IP check rather than pass null down: both backends compare the
  // stored field exactly, so counting on null would fold every such row into
  // one bucket and refuse the next visitor overall.
  await withDemo({}, async () => {
    assert.strictEqual(demo.hashIp(''), null);
    assert.strictEqual(demo.hashIp(undefined), null);

    const now = new Date().toISOString();
    assert.strictEqual(await repo.countLiveDemoUsersByIp(now, null), 0);
    assert.strictEqual(await repo.countLiveDemoUsersByIp(now, ''), 0);
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

test('the demo tenant prefix has exactly one definition in the repo', () => {
  // It used to be a literal in lib/demo.js plus a hand-copied one in
  // lib/observability.js (which cannot require lib/demo.js — that pulls in the
  // repo, i.e. a cycle), pinned together by an equality assertion. #404 added a
  // third and fourth consumer (both repo backends), so the shared leaf module
  // lib/demo-tenant.js replaced the copy: it cannot drift at all. This asserts
  // the copy has not come back.
  const sources = ['../lib/demo.js', '../lib/observability.js', '../lib/repo/json.js', '../lib/repo/postgres.js']
    .map((rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8'));
  for (const src of sources) {
    // Quote-agnostic: a re-introduced copy is just as wrong in double quotes.
    assert.equal(/=\s*['"`]demo-['"`]/.test(src), false,
      'the prefix literal was re-introduced outside lib/demo-tenant.js');
  }
  assert.strictEqual(demo.DEMO_TENANT_PREFIX, require('../lib/demo-tenant').DEMO_TENANT_PREFIX);
});

test('a minted demo tenant actually carries the prefix', () => {
  // The exclusion above is worthless if the ids it keys on don't have it.
  assert.ok(demo.isDemoTenant(`${demo.DEMO_TENANT_PREFIX}deadbeef`));
  assert.ok(!demo.isDemoTenant('a1b2c3d4e5f60718'));
});

/* --------------------------- ending a demo (#502) --------------------------- */

test('ending a demo erases it and frees its slot immediately', async () => {
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, {});
    const uid = res.body.user.id;
    const tenant = (await repo.getUserById(uid)).tenantId;

    // A DELTA: this file shares one DATA_DIR, so other specs' demos are live too.
    const before = await repo.countLiveDemoUsers(new Date().toISOString());

    const ended = await request(app).delete('/api/account/demo').set(...auth(res));
    assert.strictEqual(ended.status, 200);
    assert.strictEqual(ended.body.rounds, 1);

    // The whole point of the issue: the slot is back NOW, not in 24 h.
    assert.strictEqual(await repo.countLiveDemoUsers(new Date().toISOString()), before - 1);
    assert.strictEqual(await repo.getUserById(uid), null);
    assert.deepStrictEqual(await repo.listRounds(tenant), []);

    // Same erased-token path the purge relies on, so ending never has to race
    // the client (.claude/rules/erased-account-token-fallback.md).
    const after = await request(app).get('/api/rounds').set(...auth(res));
    assert.strictEqual(after.status, 401);
    assert.strictEqual(after.body.error, 'auth_required');
  });
});

test('ending frees the ending source\'s per-IP slot too', async () => {
  // The cap counts LIVE demos, so the two predicates have to agree: a visitor who
  // ends one demo must be able to start another, or "Demo beenden" would punish
  // exactly the people doing the right thing.
  await withDemo({ MAX_LIVE_DEMOS_PER_IP: '1', MAX_LIVE_DEMOS: '1000000', TRUST_PROXY: '1' }, async () => {
    const app = createApp();
    // Its own address, for the reason the spec above explains.
    const from = () => request(app).post('/api/account/demo').set('X-Forwarded-For', '198.51.100.20').send({});

    const first = await from();
    assert.strictEqual(first.status, 200);
    assert.strictEqual((await from()).status, 503);

    assert.strictEqual((await request(app).delete('/api/account/demo').set(...auth(first))).status, 200);
    assert.strictEqual((await from()).status, 200);
  });
});

test('DELETE /demo refuses a real account and an anonymous caller', async () => {
  // This route ERASES an account, so reaching it with a real one must be
  // impossible even holding a perfectly valid token.
  await withDemo({}, async () => {
    const app = createApp();
    assert.strictEqual((await request(app).delete('/api/account/demo')).status, 401);

    await request(app)
      .post('/api/account/register')
      .send({ email: 'notademo@example.com', username: 'notademo', password: 'correct-horse' });
    const real = await repo.getUserByEmail('notademo@example.com');
    await repo.updateUser(real.id, { emailVerified: true });
    const login = await request(app)
      .post('/api/account/login')
      .send({ email: 'notademo@example.com', password: 'correct-horse' });
    assert.strictEqual(login.status, 200);

    const refused = await request(app)
      .delete('/api/account/demo')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(refused.body.error, 'not_demo');
    // …and the account is untouched.
    assert.ok(await repo.getUserById(real.id));
  });
});

test('the ended demo\'s refresh token stops working, so a stale marker cannot resume it', async () => {
  // The client keeps a resume marker holding the demo's refresh token. Ending the
  // demo must make that marker dead server-side as well, so a browser that still
  // holds one fails forward into a fresh demo rather than into a half-alive one.
  await withDemo({}, async () => {
    const app = createApp();
    const res = await startDemo(app, {});
    const refreshToken = res.body.refreshToken;

    // It works while the demo is live — the resume path in one call.
    const ok = await request(app).post('/api/account/refresh').send({ refreshToken });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.body.accessToken);

    // Rotation: the presented token is spent and replaced. This is what the
    // marker has to follow (see test/demo-marker.test.js) — the OLD one is dead
    // from here on, which is why a marker left un-rewritten mints a second demo.
    const stale = await request(app).post('/api/account/refresh').send({ refreshToken });
    assert.strictEqual(stale.status, 401);
    assert.strictEqual(stale.body.error, 'invalid_refresh_token');

    await request(app).delete('/api/account/demo').set(...auth(res));
    const dead = await request(app)
      .post('/api/account/refresh')
      .send({ refreshToken: ok.body.refreshToken });
    assert.strictEqual(dead.status, 401);
  });
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

test('#521: a demo account carries the terms revision, for absent-key parity', async () => {
  // A demo is purged within the day and will never see a terms change, so the
  // VALUE is irrelevant here — the point is that the two account-creation sites
  // (register and this one) write the same key set. A field written by only one
  // of them makes the two repo backends disagree on absent-key parity
  // (.claude/rules/postgres-backend.md), which is invisible on the JSON backend
  // that most of the suite runs against.
  await withDemo({}, async () => {
    const res = await startDemo(createApp(), { locale: 'de' });
    assert.strictEqual(res.status, 200);
    const { TERMS_REVISION } = require('../lib/legal');
    assert.strictEqual(res.body.user.acceptedTermsRevision, TERMS_REVISION);
    assert.strictEqual(res.body.user.termsRevision, TERMS_REVISION);
    // Stored, not merely projected — a demo must never be "behind".
    const stored = await repo.getUserById(res.body.user.id);
    assert.strictEqual(stored.acceptedTermsRevision, TERMS_REVISION);
  });
});
