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
const mail = require('../lib/mail');

// Save/restore so one case can't bleed into the next.
const VARS = [
  'ACCOUNTS_ENABLED', 'SESSION_SECRET', 'AUTH_PASSWORD', 'ADMIN_PASSWORD',
  'SMTP_PASS', 'BGG_API_TOKEN', 'IMPRESSUM_ADDRESS', 'IMPRESSUM_EMAIL',
  'MAX_ROUNDS_PER_TENANT', 'MAX_GAMES_PER_ROUND', 'MAX_TAGS_PER_ROUND',
  'MAX_LIVE_DEMOS', 'DEMO_ENABLED', 'MAIL_DAILY_MAX', 'ADMIN_EXCLUDE_TENANTS',
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
  assert.equal(s.metrics.content.games, before.metrics.content.games + 1);
  assert.equal(s.metrics.content.sessions, before.metrics.content.sessions + 1);
  assert.equal(s.metrics.content.sessionsFinished, before.metrics.content.sessionsFinished + 1);
  assert.equal(s.metrics.accounts.total, before.metrics.accounts.total + 1);
  assert.equal(s.metrics.accounts.verified, before.metrics.accounts.verified + 1);
});

/* The three figures #1124 took OFF the operator card but deliberately left in
   the payload: lib/public-stats.js's COUNTERS read exactly these for the public
   landing block (#564), where an absent field silently fails its threshold and
   the counters simply stop rendering — no error anywhere. Deleting them looks
   like tidying up a card nobody reads. */
test('the three figures the PUBLIC counters read are still sent', async () => {
  const s = await instanceStatus();
  for (const key of ['activeGames', 'members', 'sessionsFinished']) {
    assert.equal(typeof s.metrics.content[key], 'number',
      `content.${key} is gone — lib/public-stats.js reads it for the landing counters`);
  }
  assert.equal(typeof s.metrics.rounds.total, 'number');
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
  assert.deepEqual(s.metrics.adoption, before.metrics.adoption);
  assert.deepEqual(s.metrics.peaks, before.metrics.peaks);

  // …and the one row that DOES report them saw it.
  assert.equal(s.metrics.demo.live, before.metrics.demo.live + 1);
});

test('the demo row reports the live count against the cap it is enforced by', async () => {
  const s = await withEnv({ MAX_LIVE_DEMOS: '42' }, instanceStatus);
  assert.equal(s.metrics.demo.max, 42);
  assert.equal(typeof s.metrics.demo.live, 'number');
});

// The mail row surfaces the #448 daily send budget as sent/limit — the one
// process-local number on the card (each replica carries its own counter, and
// the panel reports whichever process answered). budgetState()'s `day` string
// stays out on purpose: the PII sweep below pins every metrics field to a
// number, and the value is always "today UTC" by construction anyway.
test('the mail budget is reported as sent against the daily ceiling', async (t) => {
  await t.test('the ceiling is read per call, never bound at module load', async () => {
    const s = await withEnv({ MAIL_DAILY_MAX: '42' }, instanceStatus);
    assert.equal(s.metrics.mail.limit, 42);
    assert.equal(typeof s.metrics.mail.sent, 'number');
  });

  await t.test('a booked send moves the counter', async () => {
    // Relative to the current count, never absolute: the counter is per-process
    // with no reset hook, so sibling files' sends must not matter here
    // (.claude/rules/bounding-bulk-registration-mail.md).
    const before = (await instanceStatus()).metrics.mail.sent;
    await mail.send({ to: 'budget@example.test', subject: 'Budget', text: 'Zähler' });
    const after = (await instanceStatus()).metrics.mail.sent;
    assert.equal(after, before + 1);
  });
});

// The go-live checklist rows the card carried until #404. They answered the same
// way on every deploy once registration opened, and the panel is no place to
// keep re-reading Railway's env-var list — but the removal only holds if nothing
// quietly puts them back.
test('the retired configuration blocks are gone', async () => {
  const s = await instanceStatus();
  // `runtime` (#977) is not one of them coming back: those rows re-read the
  // ENV a deploy was configured with, which Railway already lists. This reports
  // what the answering PROCESS is actually running, which nothing else can say.
  assert.deepEqual(Object.keys(s).sort(), ['metrics', 'quotas', 'runtime']);
  for (const key of ['app', 'accounts', 'admin', 'mail', 'legal', 'storage', 'hosts', 'assets', 'lookup', 'migrations']) {
    assert.equal(key in s, false, `${key} came back onto the status payload`);
  }
});

// The Dockerfile pins an exact Node patch, but a pin only describes what the
// NEXT build will use. This row is the only way to see which runtime is live —
// the gap that let a floating `node:22-slim` sit on an unpatched Node with
// nothing in the app able to report it (#977).
test('the payload reports the running Node version', async () => {
  const s = await instanceStatus();
  assert.equal(s.runtime.node, process.version);
  assert.match(s.runtime.node, /^v\d+\.\d+\.\d+/);
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
  /* RECURSES TO THE LEAVES since #941, which added a design histogram (and two
     history objects, since removed by #1124). The old two-level form reported a
     nested block as "not a number" the moment nesting appeared — and the tempting fix is an
     allowlist of known-nested fields, which is exactly wrong: it has to be
     maintained by the same person who just added the nesting, i.e. by the
     person who would also be adding the leak. Recursion has no such gap.

     KEYS are swept too, not just values. The design histogram is keyed by a
     stored design id, and an id is the one thing on this card that comes from
     data rather than from code — a histogram keyed by something user-authored
     would put that text in the payload with every value still a tidy number. */
  const leaves = (node, path) => {
    for (const [k, v] of Object.entries(node)) {
      assert.equal(typeof k, 'string');
      if (v && typeof v === 'object' && !Array.isArray(v)) { leaves(v, `${path}.${k}`); continue; }
      assert.equal(typeof v, 'number', `${path}.${k} is not a number`);
    }
  };
  leaves(s.metrics, 'metrics');
});

test('a name planted in a metrics KEY is caught, not just in a value', async () => {
  /* The recursion above walks keys as well as values; this proves the sweep
     actually looks at them. Without it the recursion could quietly stop
     checking keys and every assertion would still pass — the design histogram
     is keyed by a stored id, so a key is a real route for user text onto this
     card. Driven against a hand-built payload rather than the live one, because
     the point is the SWEEP, not today's data. */
  const planted = {
    accounts: { total: 1 },
    adoption: { gamesLinked: 0 },
    designs: { 'GEHEIMER-DESIGNNAME': 2 },
  };
  const serialized = JSON.stringify(planted);
  assert.equal(serialized.includes('GEHEIMER-DESIGNNAME'), true,
    'the fixture must contain the planted name, or this proves nothing');

  let caught = null;
  try {
    for (const secret of ['GEHEIMER-DESIGNNAME']) {
      assert.equal(serialized.includes(secret), false, `${secret} reached the metrics payload`);
    }
  } catch (err) { caught = err; }
  assert.ok(caught, 'the string sweep did not catch a name planted in a KEY');
});


/* --------------------- the session funnel (#1174) ------------------------- */

// One rating by one person. The funnel's „rated" stage wants TWO, because one
// is the host trying the flow out alone — the case the card exists to tell
// apart from a real evening.
const votesBy = (n) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`p${i}`, { g1: { rating: 4 } }]),
);

test('each funnel stage counts the sessions in that state, independently', async () => {
  const before = await instanceStatus();
  const tenant = `fun-${uniq()}`;
  const round = await repo.createRound(tenant, { name: 'Trichter', members: ['Ann', 'Bo'] });
  const add = (session) => repo.createSession(tenant, round.id, {
    gameIds: [], votes: {}, createdAt: iso(1), ...session,
  });

  await add({});                                              // started only
  await add({ votes: votesBy(2) });                           // + rated
  await add({ votes: votesBy(1) });                           // NOT rated: one person
  // A seat that was asked and never answered is not a rater either.
  await add({ votes: { p0: { g1: { rating: 3 } }, p1: {} } });
  await add({ done: true });                                  // + closed
  await add({ chosenGameId: 'g1' });                          // + chosen
  await add({ finished: true, winnerIds: ['m1'] });           // + played + result
  await add({ finished: true, winnerIds: [], ending: 'lost' }); // + played + result
  await add({ finished: true, winnerIds: [] });               // played, NOT result
  await add({ cancelled: true });                             // + cancelled

  const f = (await instanceStatus()).metrics.adoption.funnel;
  const b = before.metrics.adoption.funnel;
  assert.equal(f.started - b.started, 10);
  assert.equal(f.rated - b.rated, 1, 'one rater, or an empty seat entry, is not „bewertet"');
  assert.equal(f.closed - b.closed, 1);
  assert.equal(f.chosen - b.chosen, 1);
  assert.equal(f.played - b.played, 3);
  assert.equal(f.result - b.result, 2, 'finished with neither winners nor an ending is unrecorded');
  assert.equal(f.cancelled - b.cancelled, 1);
});

test('an unknown `ending` is unrecorded, and a cancelled session never has a result', async () => {
  /* Both come from the shared sessionEnding() rather than from a bare
     `winnerIds.length` — the exact site public/js/session-outcome.js's header
     says fails silently. An allowlist means a value nobody has heard of reads as
     „nicht erfasst" instead of quietly counting as a recorded result. */
  const before = await instanceStatus();
  const tenant = `end-${uniq()}`;
  const round = await repo.createRound(tenant, { name: 'Enden', members: ['Ann'] });
  const add = (session) => repo.createSession(tenant, round.id, {
    gameIds: [], votes: {}, createdAt: iso(1), ...session,
  });
  await add({ finished: true, winnerIds: [], ending: 'brandNew' });
  await add({ finished: true, winnerIds: ['m1'], cancelled: true });

  const f = (await instanceStatus()).metrics.adoption.funnel;
  assert.equal(f.result - before.metrics.adoption.funnel.result, 0);
});

test('a split parent is outside the funnel — its tables are counted instead', async () => {
  /* A parent split across tables holds a real vote, was never played and is not
     an abandoned evening either (public/js/session-outcome.js). Counting it
     would book a loss against „gespielt" for a round that played two games. */
  const before = await instanceStatus();
  const tenant = `split-${uniq()}`;
  const round = await repo.createRound(tenant, { name: 'Zwei Tische', members: ['Ann', 'Bo'] });
  const add = (session) => repo.createSession(tenant, round.id, {
    gameIds: [], votes: {}, createdAt: iso(1), ...session,
  });
  const a = await add({ finished: true, winnerIds: ['m1'] });
  const b2 = await add({ finished: true, winnerIds: ['m2'] });
  await add({ multiTable: true, childSessionIds: [a.id, b2.id], votes: votesBy(3) });

  const f = (await instanceStatus()).metrics.adoption.funnel;
  const b = before.metrics.adoption.funnel;
  assert.equal(f.started - b.started, 2, 'the parent was counted as a started session');
  assert.equal(f.played - b.played, 2);
  assert.equal(f.rated - b.rated, 0, 'the parent’s own votes reached the funnel');
  // …while the SESSION denominator still counts all three: the parent is a
  // session the instance holds, it is only outside this one tile.
  assert.equal(
    (await instanceStatus()).metrics.adoption.sessionsTotal - before.metrics.adoption.sessionsTotal,
    3,
  );
});

test('rounds are banded by how many sessions they FINISHED, and the bands are exhaustive', async () => {
  const before = await instanceStatus();
  const tenant = `band-${uniq()}`;
  const mk = async (name, finishedCount, extraOpen) => {
    const r = await repo.createRound(tenant, { name, members: ['Ann'] });
    for (let i = 0; i < finishedCount; i += 1) {
      await repo.createSession(tenant, r.id, {
        gameIds: [], votes: {}, createdAt: iso(1), finished: true,
      });
    }
    if (extraOpen) {
      await repo.createSession(tenant, r.id, { gameIds: [], votes: {}, createdAt: iso(1) });
    }
  };
  await mk('Nie gespielt', 0, false);   // no sessions at all
  await mk('Nur gestartet', 0, true);   // sessions, none finished
  await mk('Einmal', 1, false);
  await mk('Gewohnheit', 2, false);

  const s = await instanceStatus();
  const r = s.metrics.adoption.roundsByFinished;
  const b = before.metrics.adoption.roundsByFinished;
  /* Both zero-cases land in „none", and they reach it differently: one has no
     sessions row at all, the other has sessions that never finished. The
     Postgres backend derives `none` by subtraction precisely because a
     group-by over sessions cannot see the first kind. */
  assert.equal(r.none - b.none, 2);
  assert.equal(r.one - b.one, 1);
  assert.equal(r.many - b.many, 1);
  assert.equal(r.none + r.one + r.many, s.metrics.adoption.roundsTotal,
    'the three bands must account for every round on the card');
});

test('„ohne Runde" and the BG-Stats opt-in count accounts, by tenant', async () => {
  const before = await instanceStatus();
  const settled = `has-${uniq()}`;
  const roundless = `none-${uniq()}`;
  const mkUser = (tenantId, over = {}) => repo.createUser({
    email: `${uniq()}@example.test`, username: uniq(), tenantId,
    createdAt: iso(1), emailVerified: true, identities: [], verification: null,
    reset: null, refreshTokens: [], bgStats: false, ...over,
  });
  await repo.createRound(settled, { name: 'Hat eine', members: ['Ann'] });
  await mkUser(settled, { bgStats: true });
  await mkUser(roundless);

  const a = (await instanceStatus()).metrics.adoption;
  const b = before.metrics.adoption;
  assert.equal(a.accountsWithoutRound - b.accountsWithoutRound, 1,
    'the account whose tenant owns a round must not read as roundless');
  assert.equal(a.accountsWithBgStats - b.accountsWithBgStats, 1);
  assert.equal(a.accountsTotal - b.accountsTotal, 2);
});

/* ------------------- ADMIN_EXCLUDE_TENANTS (#1174) ------------------------ */

test('an excluded tenant leaves the adoption card but not the counters', async () => {
  const tenant = `excl-${uniq()}`;
  const round = await repo.createRound(tenant, { name: 'Ausgenommen', members: ['Ann', 'Bo'] });
  await repo.createGame(tenant, round.id, {
    title: 'Eins', minPlayers: 1, maxPlayers: 4, image: '/uploads/x.webp', source: null,
  });
  await repo.createSession(tenant, round.id, {
    gameIds: [], votes: votesBy(2), createdAt: iso(1), finished: true, winnerIds: ['m1'],
  });
  await repo.createUser({
    email: `${uniq()}@example.test`, username: uniq(), tenantId: tenant,
    createdAt: iso(1), emailVerified: true, identities: [], verification: null,
    reset: null, refreshTokens: [], bgStats: true, avatar: '/uploads/a.webp',
  });

  const plain = await instanceStatus();
  const hidden = await withEnv({ ADMIN_EXCLUDE_TENANTS: tenant }, instanceStatus);

  // Gone from the card: numerator AND denominator, which is the whole point —
  // a filtered numerator over an unfiltered total reports over 100 %.
  const a = hidden.metrics.adoption;
  const p = plain.metrics.adoption;
  assert.equal(p.roundsTotal - a.roundsTotal, 1);
  assert.equal(p.gamesTotal - a.gamesTotal, 1);
  assert.equal(p.sessionsTotal - a.sessionsTotal, 1);
  assert.equal(p.accountsTotal - a.accountsTotal, 1);
  assert.equal(p.gamesWithOwnCover - a.gamesWithOwnCover, 1);
  assert.equal(p.accountsWithBgStats - a.accountsWithBgStats, 1);
  assert.equal(p.accountsWithAvatar - a.accountsWithAvatar, 1);
  assert.equal(p.funnel.started - a.funnel.started, 1);
  assert.equal(p.funnel.played - a.funnel.played, 1);
  assert.equal(p.roundsByFinished.one - a.roundsByFinished.one, 1);

  /* …and untouched everywhere else. An operator who has hidden themselves from
     their own quota peaks would be blind to the limit they are about to hit,
     and lib/public-stats.js reads `content` for the PUBLIC landing counters —
     an exclusion reaching there would silently shrink them. */
  assert.deepEqual(hidden.metrics.rounds, plain.metrics.rounds);
  assert.deepEqual(hidden.metrics.content, plain.metrics.content);
  assert.deepEqual(hidden.metrics.accounts, plain.metrics.accounts);
  assert.deepEqual(hidden.metrics.peaks, plain.metrics.peaks);
});

test('the variable is read per call, never bound at module load', async () => {
  /* The repo modules are required once per process and long before anything
     sets this, so a cached copy would make the setting silently inert — and on
     a real instance it would pin whatever the value was at boot. Same property
     the quota ceilings above are tested for, and the same reason. */
  const tenant = `live-${uniq()}`;
  await repo.createRound(tenant, { name: 'Sofort', members: ['Ann'] });
  const on = await withEnv({ ADMIN_EXCLUDE_TENANTS: tenant }, instanceStatus);
  const off = await withEnv({ ADMIN_EXCLUDE_TENANTS: undefined }, instanceStatus);
  assert.equal(off.metrics.adoption.roundsTotal - on.metrics.adoption.roundsTotal, 1);
});

test('a blank or spaced-out list excludes nothing', async () => {
  // Splitting on commas without trimming and dropping empties would turn
  // „" into one excluded tenant named "" — harmless here, but „a, b" into
  // one named " b", which silently fails to exclude the tenant the operator
  // typed.
  const tenant = `trim-${uniq()}`;
  await repo.createRound(tenant, { name: 'Leerzeichen', members: ['Ann'] });
  const plain = await withEnv({ ADMIN_EXCLUDE_TENANTS: '' }, instanceStatus);
  const spaced = await withEnv({ ADMIN_EXCLUDE_TENANTS: `other, ${tenant} ,` }, instanceStatus);
  assert.equal(plain.metrics.adoption.roundsTotal - spaced.metrics.adoption.roundsTotal, 1,
    'the tenant written with surrounding spaces was not excluded');
});
