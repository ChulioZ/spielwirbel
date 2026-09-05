'use strict';

/*
 * Per-tenant quotas & abuse controls (issue #139).
 *
 * Quotas are enforced ONLY in the public multi-tenant mode (accounts on), so this
 * suite enables accounts and drives real tenants (register → verify → login → token),
 * mirroring test/tenant.test.js. Tiny ceilings are set via env (read per request)
 * so the caps trip in a couple of requests.
 */

// Flags + tiny ceilings BEFORE the app is built.
process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.MAX_ROUNDS_PER_TENANT = '2';
process.env.MAX_GAMES_PER_ROUND = '2';
process.env.MAX_TAGS_PER_ROUND = '2';
// 3, not 2: in accounts mode createRound seats the creator itself (#421), so a
// round asked for one member already holds two — a ceiling of 2 would refuse the
// very first add and the spec could not tell a working cap from an off-by-one.
process.env.MAX_MEMBERS_PER_ROUND = '3';
process.env.MAX_EXPANSIONS_PER_GAME = '2';
process.env.MAX_DISMISSED_RECOMMENDATIONS_PER_ROUND = '2';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const { createApp } = require('../lib/app');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');

const PASSWORD = 'correct horse battery';

// Registration requires a unique app-wide handle (#320). Derived from the address
// so every helper call stays a one-liner and two accounts can never collide.
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');

// Register + verify + login one account; returns its Bearer token and user.
async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  const user = await repo.getUserByEmail(email);
  return { token: login.body.accessToken, user };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test('rounds-per-tenant cap', async (t) => {
  const a = await makeAccount('rounds-a@example.com');

  await t.test('creates up to the limit, then 403 quota_rounds', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post('/api/rounds').set(auth(a.token))
        .send({ name: `R${i}`, members: ['Alice'] });
      assert.equal(res.status, 201);
    }
    const over = await request(app).post('/api/rounds').set(auth(a.token))
      .send({ name: 'R3', members: ['Alice'] });
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_rounds');
    assert.equal(over.body.limit, 2);
  });

  await t.test('deleting a round frees a slot (state cap, not a rate cap)', async () => {
    const list = await request(app).get('/api/rounds').set(auth(a.token));
    await request(app).delete(`/api/rounds/${list.body[0].id}`).set(auth(a.token));
    const res = await request(app).post('/api/rounds').set(auth(a.token))
      .send({ name: 'R-again', members: ['Alice'] });
    assert.equal(res.status, 201);
  });

  await t.test('the cap is per tenant — another account is unaffected', async () => {
    const b = await makeAccount('rounds-b@example.com');
    const res = await request(app).post('/api/rounds').set(auth(b.token))
      .send({ name: 'B1', members: ['Bob'] });
    assert.equal(res.status, 201);
  });
});

test('games-per-round cap', async (t) => {
  const a = await makeAccount('games-a@example.com');
  const round = await request(app).post('/api/rounds').set(auth(a.token))
    .send({ name: 'GameRound', members: ['Alice'] });
  const rid = round.body.id;

  await t.test('adds up to the limit, then 403 quota_games', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post(`/api/rounds/${rid}/games`).set(auth(a.token))
        .field('title', `G${i}`).field('platform', 'analog')
        .field('minPlayers', '1').field('maxPlayers', '4');
      assert.equal(res.status, 201);
    }
    const over = await request(app).post(`/api/rounds/${rid}/games`).set(auth(a.token))
      .field('title', 'G3').field('platform', 'analog')
      .field('minPlayers', '1').field('maxPlayers', '4');
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_games');
    assert.equal(over.body.limit, 2);
  });
});

// Moving a whole shelf is the one write that can blow past BOTH caps at once,
// and it has to refuse atomically — a half-moved round has no undo.
test('moving all games respects the target round\'s caps (#253)', async (t) => {
  const a = await makeAccount('move-a@example.com');
  const mk = async (name) => (await request(app).post('/api/rounds').set(auth(a.token))
    .send({ name, members: ['Alice'] })).body.id;
  const src = await mk('Source');
  const dst = await mk('Target');

  const addGame = (rid, title) => request(app).post(`/api/rounds/${rid}/games`).set(auth(a.token))
    .field('title', title).field('minPlayers', '1').field('maxPlayers', '4');

  await t.test('refuses over the games cap without moving anything', async () => {
    // MAX_GAMES_PER_ROUND is 2: two in the source, one already in the target.
    await addGame(src, 'S1');
    await addGame(src, 'S2');
    await addGame(dst, 'D1');

    const res = await request(app).post(`/api/rounds/${src}/games/move-to`).set(auth(a.token))
      .send({ targetRoundId: dst });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'quota_games');
    assert.equal(res.body.limit, 2);

    // Atomic: the source still holds both, the target still holds only its own.
    const s = await request(app).get(`/api/rounds/${src}`).set(auth(a.token));
    const d = await request(app).get(`/api/rounds/${dst}`).set(auth(a.token));
    assert.equal(s.body.games.length, 2);
    assert.equal(d.body.games.length, 1);
  });

  // Its own account: MAX_ROUNDS_PER_TENANT is 2, and the pair above already
  // uses both of a's slots.
  await t.test('refuses over the tags cap without creating a tag', async () => {
    const b = await makeAccount('move-b@example.com');
    const mkB = async (name) => (await request(app).post('/api/rounds').set(auth(b.token))
      .send({ name, members: ['Alice'] })).body.id;
    const from = await mkB('From');
    const into = await mkB('Into');

    // MAX_TAGS_PER_ROUND is 2; the source's two tags would both have to be
    // created in the target on top of the two it already has.
    for (const name of ['A', 'B']) {
      await request(app).post(`/api/rounds/${into}/tags`).set(auth(b.token)).send({ name });
    }
    const tags = [];
    for (const name of ['X', 'Y']) {
      tags.push((await request(app).post(`/api/rounds/${from}/tags`).set(auth(b.token)).send({ name })).body.id);
    }
    const game = (await request(app).post(`/api/rounds/${from}/games`).set(auth(b.token))
      .field('title', 'Tagged').field('minPlayers', '1').field('maxPlayers', '4')
      .field('tagIds', tags[0]).field('tagIds', tags[1])).body;
    assert.deepEqual(game.tagIds, tags);

    const res = await request(app).post(`/api/rounds/${from}/games/move-to`).set(auth(b.token))
      .send({ targetRoundId: into });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'quota_tags');
    assert.equal(res.body.limit, 2);

    const d = await request(app).get(`/api/rounds/${into}`).set(auth(b.token));
    assert.equal(d.body.tags.length, 2); // nothing created
    assert.equal(d.body.games.length, 0); // nothing moved
  });
});

test('copying games respects the target round\'s caps (#916)', async (t) => {
  // Its own account: MAX_ROUNDS_PER_TENANT is 2, and each pair below uses both.
  await t.test('refuses over the games cap without copying anything', async () => {
    const a = await makeAccount('copy-a@example.com');
    const mk = async (name) => (await request(app).post('/api/rounds').set(auth(a.token))
      .send({ name, members: ['Alice'] })).body.id;
    const src = await mk('Source');
    const dst = await mk('Target');
    const addGame = (rid, title) => request(app).post(`/api/rounds/${rid}/games`).set(auth(a.token))
      .field('title', title).field('minPlayers', '1').field('maxPlayers', '4');

    // MAX_GAMES_PER_ROUND is 2: two in the source, one already in the target.
    // The target's own games count, exactly as they do for a move.
    await addGame(src, 'S1');
    await addGame(src, 'S2');
    await addGame(dst, 'D1');

    const res = await request(app).post(`/api/rounds/${src}/games/copy-to`).set(auth(a.token))
      .send({ targetRoundId: dst });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'quota_games');
    assert.equal(res.body.limit, 2);

    // Atomic — and here the source assertion is weaker evidence than for a move
    // (a copy never empties it anyway), so the target is the one that matters.
    const d = await request(app).get(`/api/rounds/${dst}`).set(auth(a.token));
    assert.equal(d.body.games.length, 1);
    const s = await request(app).get(`/api/rounds/${src}`).set(auth(a.token));
    assert.equal(s.body.games.length, 2);
  });

  await t.test('refuses over the tags cap without creating a tag', async () => {
    const b = await makeAccount('copy-b@example.com');
    const mkB = async (name) => (await request(app).post('/api/rounds').set(auth(b.token))
      .send({ name, members: ['Alice'] })).body.id;
    const from = await mkB('From');
    const into = await mkB('Into');

    // MAX_TAGS_PER_ROUND is 2; the source's two tags would both have to be
    // created in the target on top of the two it already has.
    for (const name of ['A', 'B']) {
      await request(app).post(`/api/rounds/${into}/tags`).set(auth(b.token)).send({ name });
    }
    const tags = [];
    for (const name of ['X', 'Y']) {
      tags.push((await request(app).post(`/api/rounds/${from}/tags`).set(auth(b.token)).send({ name })).body.id);
    }
    await request(app).post(`/api/rounds/${from}/games`).set(auth(b.token))
      .field('title', 'Tagged').field('minPlayers', '1').field('maxPlayers', '4')
      .field('tagIds', tags[0]).field('tagIds', tags[1]);

    const res = await request(app).post(`/api/rounds/${from}/games/copy-to`).set(auth(b.token))
      .send({ targetRoundId: into });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'quota_tags');
    assert.equal(res.body.limit, 2);

    const d = await request(app).get(`/api/rounds/${into}`).set(auth(b.token));
    assert.equal(d.body.tags.length, 2); // nothing created
    assert.equal(d.body.games.length, 0); // nothing copied
  });
});

test('tags-per-round cap (#238)', async (t) => {
  const a = await makeAccount('tags-a@example.com');
  const round = await request(app).post('/api/rounds').set(auth(a.token))
    .send({ name: 'TagRound', members: ['Alice'] });
  const rid = round.body.id;

  await t.test('creates up to the limit, then 403 quota_tags', async () => {
    for (const name of ['One', 'Two']) {
      const res = await request(app).post(`/api/rounds/${rid}/tags`).set(auth(a.token)).send({ name });
      assert.equal(res.status, 201);
    }
    const over = await request(app).post(`/api/rounds/${rid}/tags`).set(auth(a.token)).send({ name: 'Three' });
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_tags');
    assert.equal(over.body.limit, 2);
  });

  await t.test('a duplicate name still resolves at the cap (reuses, creates nothing)', async () => {
    const res = await request(app).post(`/api/rounds/${rid}/tags`).set(auth(a.token)).send({ name: 'two' });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Two');
  });

  await t.test('deleting a tag frees the slot (state cap, not a rate cap)', async () => {
    const fetched = await request(app).get(`/api/rounds/${rid}`).set(auth(a.token));
    await request(app).delete(`/api/rounds/${rid}/tags/${fetched.body.tags[0].id}`).set(auth(a.token));
    const res = await request(app).post(`/api/rounds/${rid}/tags`).set(auth(a.token)).send({ name: 'Again' });
    assert.equal(res.status, 201);
  });
});

test('dismissed-recommendations-per-round cap (#782)', async (t) => {
  const a = await makeAccount('dismiss-a@example.com');
  const round = await request(app).post('/api/rounds').set(auth(a.token))
    .send({ name: 'DismissRound', members: ['Alice'] });
  const rid = round.body.id;
  const dismiss = (externalId) => request(app)
    .post(`/api/rounds/${rid}/recommendations/dismissed`).set(auth(a.token))
    .send({ externalId, title: `Game ${externalId}` });

  await t.test('dismisses up to the limit, then 403 quota_dismissed', async () => {
    for (const id of ['1', '2']) assert.equal((await dismiss(id)).status, 201);
    const over = await dismiss('3');
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_dismissed');
    assert.equal(over.body.limit, 2);
  });

  await t.test('a REPEAT of an already-dismissed title still resolves at the cap', async () => {
    // The idempotent path must not be refused by the ceiling: the list does not
    // grow, and a user re-tapping a card they already dismissed would otherwise
    // get an unexplainable quota error.
    const res = await dismiss('1');
    assert.equal(res.status, 201);
    assert.equal(res.body.externalId, '1');
  });

  await t.test('restoring one frees the slot (state cap, not a rate cap)', async () => {
    assert.equal((await request(app).delete(`/api/rounds/${rid}/recommendations/dismissed/1`).set(auth(a.token))).status, 200);
    assert.equal((await dismiss('3')).status, 201);
  });
});

test('members-per-round cap (#563)', async (t) => {
  const a = await makeAccount('members-a@example.com');
  const round = await request(app).post('/api/rounds').set(auth(a.token))
    .send({ name: 'SeatRound', members: ['Alice'] });
  const rid = round.body.id;
  // The owner seat counts toward the cap: it is a row and an avatar like any
  // other. Two seats already, ceiling 3, so exactly one add fits.
  assert.equal(round.body.members.length, 2);

  await t.test('adds up to the limit, then 403 quota_members', async () => {
    const ok = await request(app).post(`/api/rounds/${rid}/members`).set(auth(a.token)).send({ name: 'Bob' });
    assert.equal(ok.status, 201);

    const over = await request(app).post(`/api/rounds/${rid}/members`).set(auth(a.token)).send({ name: 'Carol' });
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_members');
    assert.equal(over.body.limit, 3);

    // Nothing was appended by the refusal.
    const d = await request(app).get(`/api/rounds/${rid}`).set(auth(a.token));
    assert.deepEqual(d.body.members.map((m) => m.name).slice(1), ['Alice', 'Bob']);
  });

  await t.test('a blank name is still a 400 on a full round, not a quota 403', async () => {
    // Validation runs before the cap, so the caller hears about the actual defect
    // in their request rather than a limit they did not hit yet.
    const res = await request(app).post(`/api/rounds/${rid}/members`).set(auth(a.token)).send({ name: '  ' });
    assert.equal(res.status, 400);
  });
});

test('quotas are inert when accounts are off (single-tenant deploy is unchanged)', async (t) => {
  // Build a fresh app with accounts disabled; the gate falls back to the (unset,
  // so no-op) shared password, and quota.enforced() is false. The tiny
  // MAX_ROUNDS_PER_TENANT=2 above must NOT bite here.
  const prev = process.env.ACCOUNTS_ENABLED;
  delete process.env.ACCOUNTS_ENABLED;
  t.after(() => { process.env.ACCOUNTS_ENABLED = prev; });
  const openApp = createApp();

  for (let i = 0; i < 4; i++) {
    const res = await request(openApp).post('/api/rounds')
      .send({ name: `Open${i}`, members: ['Alice'] });
    assert.equal(res.status, 201, `round ${i} should be created with quotas inert`);
  }

  // The tags cap (MAX_TAGS_PER_ROUND=2 above) must be inert too (#238).
  const rounds = await request(openApp).get('/api/rounds');
  const rid = rounds.body[0].id;
  for (let i = 0; i < 4; i++) {
    const res = await request(openApp).post(`/api/rounds/${rid}/tags`).send({ name: `T${i}` });
    assert.equal(res.status, 201, `tag ${i} should be created with quotas inert`);
  }

  // And the members cap (MAX_MEMBERS_PER_ROUND=3 above), #563. Legacy mode writes
  // no owner seat, so this round holds one member — four adds take it to five,
  // well past the ceiling.
  for (let i = 0; i < 4; i++) {
    const res = await request(openApp).post(`/api/rounds/${rid}/members`).send({ name: `M${i}` });
    assert.equal(res.status, 201, `member ${i} should be added with quotas inert`);
  }
});

test('expansions-per-game cap (#653)', async (t) => {
  const a = await makeAccount('exp-a@example.com');
  const round = await request(app).post('/api/rounds').set(auth(a.token))
    .send({ name: 'ExpRound', members: ['Alice'] });
  const rid = round.body.id;
  const game = (await request(app).post(`/api/rounds/${rid}/games`).set(auth(a.token))
    .field('title', 'Catan').field('minPlayers', '3').field('maxPlayers', '4')).body;
  const put = (expansions) => request(app).put(`/api/rounds/${rid}/games/${game.id}/expansions`)
    .set(auth(a.token)).send({ expansions });

  await t.test('accepts up to the limit, then 403 quota_expansions', async () => {
    const ok = await put([{ title: 'E1' }, { title: 'E2' }]);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.expansions.length, 2);

    const over = await put([{ title: 'E1' }, { title: 'E2' }, { title: 'E3' }]);
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_expansions');
    assert.equal(over.body.limit, 2);

    // Refused WHOLE, never truncated: a silently clipped list is how a group
    // would lose an expansion with no error anywhere.
    const stored = await request(app).get(`/api/rounds/${rid}`).set(auth(a.token));
    assert.equal(stored.body.games[0].expansions.length, 2);
    assert.deepEqual(stored.body.games[0].expansions.map((e) => e.title), ['E1', 'E2']);
  });

  // The SECOND way an expansion reaches a game (#664) — acquiring a wished one —
  // must hit the same ceiling, or the cap is bypassable by taking the long road.
  await t.test('acquiring a wished expansion is refused at the same cap', async () => {
    const tenant = repo.forTenant((await repo.getUserByEmail('exp-a@example.com')).tenantId);
    const { created } = await tenant.createGames(rid, [{
      title: 'Seefahrer', minPlayers: 5, maxPlayers: 6, image: null,
      source: { provider: 'bgg', externalId: '325', url: null },
      expansionOf: [{ providerId: '13', title: 'CATAN' }],
    }], undefined, null, true);
    const wish = created[0];

    const over = await request(app).post(`/api/rounds/${rid}/games/${wish.id}/acquire-expansion`)
      .set(auth(a.token)).send({ baseGameId: game.id });
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'quota_expansions');
    assert.equal(over.body.limit, 2);

    // The wish is the only record that the group wanted it, so a refusal must
    // leave it standing — a half-applied acquire has no undo.
    const stored = await request(app).get(`/api/rounds/${rid}`).set(auth(a.token));
    assert.ok(stored.body.games.some((g) => g.id === wish.id), 'the refused wish was deleted anyway');
    assert.equal(stored.body.games.find((g) => g.id === game.id).expansions.length, 2);
  });
});
