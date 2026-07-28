'use strict';

/*
 * Instance metrics for the operator panel (#274, reshaped by #404).
 *
 * Three properties matter here and none is visible by eye in the panel:
 *
 *  1. It reports the CURRENT process env, because the quota ceilings are read
 *     per call. A module-load read would make the card describe the config the
 *     process booted with, which is exactly the stale answer an operator would
 *     then act on. Driven here by mutating process.env between calls.
 *  2. Demo tenants are excluded from every number except the demo row, so a
 *     visitor clicking "try it" cannot inflate the counts that answer "is anyone
 *     actually using this".
 *  3. It never leaks a secret. The generic sweep at the bottom is the real
 *     guard: it plants recognisable values in every secret-bearing env var and
 *     asserts none appears anywhere in the serialized response — so a field
 *     added later that echoes a secret fails this file without anyone having to
 *     remember to extend it. It also guards against a metric ever carrying a
 *     name, an address or an id instead of a count.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers'); // isolates DATA_DIR before the store is required
const { instanceStatus } = require('../lib/status');
const repo = require('../lib/repo');

// Save/restore so one case can't bleed into the next.
const VARS = [
  'ACCOUNTS_ENABLED', 'SESSION_SECRET', 'AUTH_PASSWORD', 'ADMIN_PASSWORD',
  'SMTP_PASS', 'BGG_API_TOKEN', 'IMPRESSUM_ADDRESS', 'IMPRESSUM_EMAIL',
  'MAX_ROUNDS_PER_TENANT', 'MAX_GAMES_PER_ROUND', 'MAX_TAGS_PER_ROUND',
  'MAX_LIVE_DEMOS', 'DEMO_ENABLED',
];

async function withEnv(overrides, fn) {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const uniq = () => Math.random().toString(16).slice(2);
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

test('quota ceilings are reported with whether they actually bite', async (t) => {
  await t.test('inert with accounts off, whatever the numbers say', async () => {
    const s = await withEnv(
      { ACCOUNTS_ENABLED: undefined, SESSION_SECRET: undefined, MAX_ROUNDS_PER_TENANT: '3' },
      instanceStatus,
    );
    assert.equal(s.quotas.enforced, false);
    assert.equal(s.quotas.roundsPerTenant, 3);
  });

  await t.test('enforced once accounts are on', async () => {
    const s = await withEnv({ ACCOUNTS_ENABLED: 'true', SESSION_SECRET: 's' }, instanceStatus);
    assert.equal(s.quotas.enforced, true);
  });

  await t.test('the ceilings are read per call, never bound at module load', async () => {
    const tight = await withEnv({ MAX_GAMES_PER_ROUND: '7', MAX_TAGS_PER_ROUND: '2' }, instanceStatus);
    assert.equal(tight.quotas.gamesPerRound, 7);
    assert.equal(tight.quotas.tagsPerRound, 2);
    const loose = await withEnv({ MAX_GAMES_PER_ROUND: '900' }, instanceStatus);
    assert.equal(loose.quotas.gamesPerRound, 900);
  });
});

// The half of the card the operator reads to answer "is anyone about to be
// refused?": each ceiling is paired with the highest value anyone currently
// holds against it (#404, the amendment to the issue's plan).
test('every quota ceiling is paired with the highest value anyone holds', async () => {
  const before = await instanceStatus();
  const tenant = `peak-${uniq()}`;
  const round = await repo.createRound(tenant, { name: 'Voll', members: ['Ann'] });
  for (const title of ['A', 'B', 'C']) {
    await repo.createGame(tenant, round.id, {
      title, minPlayers: 1, maxPlayers: 4, image: null, source: null,
    });
  }
  await repo.addTag(tenant, round.id, 'Kurz', null);
  await repo.addTag(tenant, round.id, 'Lang', null);

  const s = await instanceStatus();
  // Keyed exactly like quotas, so the panel can zip the two without a mapping.
  assert.deepEqual(Object.keys(s.metrics.peaks).sort(), ['gamesPerRound', 'roundsPerTenant', 'tagsPerRound']);
  assert.ok(s.metrics.peaks.gamesPerRound >= 3);
  assert.ok(s.metrics.peaks.tagsPerRound >= 2);
  assert.ok(s.metrics.peaks.roundsPerTenant >= 1);
  assert.ok(s.metrics.peaks.gamesPerRound >= before.metrics.peaks.gamesPerRound);
});

test('the usage numbers count what the instance holds', async () => {
  const before = await instanceStatus();
  const tenant = `use-${uniq()}`;
  const round = await repo.createRound(tenant, { name: 'Zählen', members: ['Ann', 'Bo'] });
  await repo.createGame(tenant, round.id, {
    title: 'Eins', minPlayers: 1, maxPlayers: 4, image: null, source: null,
  });
  await repo.createSession(tenant, round.id, {
    gameIds: [], votes: {}, createdAt: iso(1), finished: true,
  });
  await repo.createUser({
    email: `${uniq()}@example.test`, username: uniq(), tenantId: `acc-${uniq()}`,
    createdAt: iso(1), emailVerified: true, identities: [], verification: null,
    reset: null, refreshTokens: [],
  });

  const s = await instanceStatus();
  assert.equal(s.metrics.rounds.total, before.metrics.rounds.total + 1);
  assert.equal(s.metrics.rounds.tenants, before.metrics.rounds.tenants + 1);
  assert.equal(s.metrics.content.games, before.metrics.content.games + 1);
  assert.equal(s.metrics.content.sessions, before.metrics.content.sessions + 1);
  assert.equal(s.metrics.content.sessionsFinished, before.metrics.content.sessionsFinished + 1);
  assert.equal(s.metrics.content.sessions30d, before.metrics.content.sessions30d + 1);
  assert.equal(s.metrics.accounts.total, before.metrics.accounts.total + 1);
  assert.equal(s.metrics.accounts.verified, before.metrics.accounts.verified + 1);
  assert.equal(s.metrics.accounts.new7d, before.metrics.accounts.new7d + 1);
  assert.equal(s.metrics.accounts.new30d, before.metrics.accounts.new30d + 1);
});

test('demo tenants are excluded from every number except the demo row', async () => {
  const before = await instanceStatus();
  const tenant = `demo-${uniq()}`;
  const round = await repo.createRound(tenant, { name: 'Demo-Runde', members: ['Gast'] });
  await repo.createGame(tenant, round.id, {
    title: 'Demo-Spiel', minPlayers: 1, maxPlayers: 4, image: null, source: null,
  });
  await repo.createSession(tenant, round.id, {
    gameIds: [], votes: {}, createdAt: iso(0), finished: true,
  });
  await repo.createUser({
    email: `demo-${uniq()}@demo.invalid`, username: `demo-${uniq()}`, tenantId: tenant,
    createdAt: iso(0), emailVerified: false, demo: true,
    demoExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    identities: [], verification: null, reset: null, refreshTokens: [],
  });

  const s = await instanceStatus();
  assert.deepEqual(s.metrics.rounds, before.metrics.rounds);
  assert.deepEqual(s.metrics.content, before.metrics.content);
  assert.deepEqual(s.metrics.accounts, before.metrics.accounts);
  assert.deepEqual(s.metrics.peaks, before.metrics.peaks);

  // …and the one row that DOES report them saw it.
  assert.equal(s.metrics.demo.live, before.metrics.demo.live + 1);
});

test('the demo row reports the live count against the cap it is enforced by', async () => {
  const s = await withEnv({ MAX_LIVE_DEMOS: '42' }, instanceStatus);
  assert.equal(s.metrics.demo.max, 42);
  assert.equal(typeof s.metrics.demo.live, 'number');
});

// The go-live checklist rows the card carried until #404. They answered the same
// way on every deploy once registration opened, and the panel is no place to
// keep re-reading Railway's env-var list — but the removal only holds if nothing
// quietly puts them back.
test('the retired configuration blocks are gone', async () => {
  const s = await instanceStatus();
  assert.deepEqual(Object.keys(s).sort(), ['metrics', 'quotas']);
  for (const key of ['app', 'accounts', 'admin', 'mail', 'legal', 'storage', 'hosts', 'assets', 'lookup', 'migrations']) {
    assert.equal(key in s, false, `${key} came back onto the status payload`);
  }
});

// The guard that survives future edits: plant a unique, greppable value in every
// secret-bearing var and assert none of them reaches the response in any form.
// A field added later that echoes (or truncates, or hashes-and-shows) a secret
// fails here without anyone remembering to extend this file.
test('no secret value ever appears in the response', async () => {
  const secrets = {
    AUTH_PASSWORD: 'SECRETVALUE-auth',
    SESSION_SECRET: 'SECRETVALUE-session',
    ADMIN_PASSWORD: 'SECRETVALUE-admin',
    SMTP_PASS: 'SECRETVALUE-smtppass',
    BGG_API_TOKEN: 'SECRETVALUE-bgg',
    // Not secrets forever (they end up in the public Impressum), but they must
    // not leak early through a panel screenshot.
    IMPRESSUM_ADDRESS: 'SECRETVALUE-address',
    IMPRESSUM_EMAIL: 'SECRETVALUE-imail',
  };
  const s = await withEnv(secrets, instanceStatus);
  const serialized = JSON.stringify(s);

  for (const [name, value] of Object.entries(secrets)) {
    assert.equal(serialized.includes(value), false, `${name} leaked into the status response`);
    // Also catch a "safe-looking" truncation, e.g. showing the first 8 chars.
    assert.equal(serialized.includes(value.slice(0, 8)), false, `${name} leaked a prefix`);
  }
  // Nothing in the payload should be a long opaque blob either (a hash digest
  // shown to the operator would be a secret-derived value with no purpose here).
  assert.equal(/[A-Fa-f0-9]{32,}/.test(serialized), false, 'a hash-like value reached the response');
});

// Aggregates only. The rounds, accounts and games this suite seeded carry real
// names and addresses, and none of them may reach a card that reports counts —
// the same "a screenshot of it must be harmless" rule the secret sweep enforces,
// applied to personal data.
test('every metric is a number — no name, address or id reaches the card', async () => {
  const tenant = `pii-${uniq()}`;
  const round = await repo.createRound(tenant, { name: 'GEHEIMER-RUNDENNAME', members: ['GEHEIMER-NAME'] });
  await repo.createGame(tenant, round.id, {
    title: 'GEHEIMER-TITEL', minPlayers: 1, maxPlayers: 4, image: null, source: null,
  });
  await repo.createUser({
    email: 'GEHEIME-ADRESSE@example.test', username: 'GEHEIMER-NUTZER', tenantId: tenant,
    createdAt: iso(0), emailVerified: true, identities: [], verification: null,
    reset: null, refreshTokens: [],
  });

  const s = await instanceStatus();
  const serialized = JSON.stringify(s.metrics);
  for (const secret of ['GEHEIMER-RUNDENNAME', 'GEHEIMER-NAME', 'GEHEIMER-TITEL', 'GEHEIME-ADRESSE', 'GEHEIMER-NUTZER', tenant]) {
    assert.equal(serialized.includes(secret), false, `${secret} reached the metrics payload`);
  }
  for (const block of Object.values(s.metrics)) {
    for (const [field, value] of Object.entries(block)) {
      assert.equal(typeof value, 'number', `metrics.${field} is not a number`);
    }
  }
});
