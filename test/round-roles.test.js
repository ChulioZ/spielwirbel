'use strict';

/*
 * Per-round roles (#137) — the enforcement layer, over HTTP and at the unit.
 *
 * The point of the feature is that "who may do what" is decided in ONE place
 * (lib/round-access.js) rather than by a guard each handler must remember, so
 * these specs are aimed at that chokepoint rather than at individual routes:
 *
 *  - §1 the pure ladder (public/js/round-roles.js), including the owner branch
 *        whose natural implementation hides every action from the owner;
 *  - §2 the route table is COMPLETE — every mutating route the app registers
 *        under /api/rounds/:rid states a requirement, so a new one reddens here
 *        rather than 403ing in production;
 *  - §3 the role × route matrix over real HTTP;
 *  - §4 UNLISTED = REFUSED, the property the whole design rests on;
 *  - §5 the legacy 'member' value, and accounts-off mode;
 *  - §6 the client hides what the route refuses (#857).
 *
 * There is still no route that creates a grant from inside a round (invitation
 * accept does, from /api/account/invitations), so grants are seeded through the
 * repo exactly as test/round-grants-access.test.js does.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const roles = require('../public/js/round-roles');
const { capabilityFor, ROUTE_ROLES } = require('../lib/round-access');

// Accounts must be ON for per-user tenants and grants to exist; the register →
// verify → login walk mirrors test/round-grants-access.test.js.
const PASSWORD = 'correct horse battery';
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// A plain counter rather than a handle derived from the caller's label: this file
// seeds a fresh round per action, and a descriptive username runs past the 30-char
// policy ceiling (public/js/username-policy.js) — which registration answers with
// `invalid_username`, leaving `user` null and every later assertion failing on
// `tenantId` instead of naming the real cause.
let accountSeq = 0;
async function makeAccount() {
  accountSeq += 1;
  const email = `roles-${accountSeq}@example.com`;
  const username = `roles-${accountSeq}`;
  await request(app).post('/api/account/register').send({ email, username, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200, 'the seeded account must register, verify and log in');
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

/* ------------------------------ §1 the ladder ------------------------------ */

test('the ladder ranks owner > coowner > editor, and an unknown role loses power', () => {
  assert.equal(roles.can('owner', 'round.delete'), true);
  assert.equal(roles.can('coowner', 'round.delete'), false);
  assert.equal(roles.can('editor', 'round.delete'), false);

  assert.equal(roles.can('owner', 'session.delete'), true);
  assert.equal(roles.can('coowner', 'session.delete'), true);
  assert.equal(roles.can('editor', 'session.delete'), false);

  // #857 split the two acts one route used to share. Throwing away a vote that
  // is still running destroys no history — there is no result, no winner and no
  // Chronik entry yet — so it is an ordinary write; deleting a PLAYED evening is
  // still co-owner. The pair is asserted together because the whole point is
  // that they moved apart.
  assert.equal(roles.can('editor', 'session.discard'), true);
  assert.equal(roles.can('editor', 'session.delete'), false);

  // An unnamed capability is an ordinary round write, which every role clears.
  assert.equal(roles.can('editor', 'round.write'), true);
  assert.equal(roles.can('editor', 'something.nobody.has.declared'), true);

  // A value from the database this build has never heard of must lose power,
  // never gain it — the allowlist shape, not a denylist.
  assert.equal(roles.normalizeRole('sysadmin'), 'editor');
  assert.equal(roles.normalizeRole(undefined), 'editor');
  assert.equal(roles.can('sysadmin', 'session.delete'), false);
  // …and an unknown role reads as `editor`, so it clears the editor-level floor.
  assert.equal(roles.can('sysadmin', 'session.discard'), true);
});

test('roundCan treats a round with NO role key as owned, not as the lowest role', () => {
  // The trap: a round payload carries `shared`/`role` only for a grantee, so
  // reading `round.role` directly would hand the OWNER an undefined role,
  // normalizeRole would resolve it to `editor`, and every guarded action would
  // vanish from the UI of the person who owns the round.
  assert.equal(roles.roundCan({ id: 'r1' }, 'round.delete'), true);
  assert.equal(roles.roundCan({ id: 'r1' }, 'session.delete'), true);

  assert.equal(roles.roundCan({ id: 'r1', shared: true, role: 'editor' }, 'session.delete'), false);
  assert.equal(roles.roundCan({ id: 'r1', shared: true, role: 'coowner' }, 'session.delete'), true);
  assert.equal(roles.roundCan({ id: 'r1', shared: true, role: 'coowner' }, 'round.delete'), false);
});

/* -------------------------- §2 the table is complete ------------------------ */

// Walk the routers the app actually mounts under /api/rounds/:rid and collect
// every mutating route, expressed the way the chokepoint sees it (paths relative
// to that mount). This is what makes §4's default-deny safe to rely on: without
// it, a route added tomorrow would simply 403 for grantees with nothing to say
// why. `require` here is a BACKEND router, so it costs no frontend coverage
// (.claude/rules/frontend-helper-modules-and-coverage.md).
const MOUNTS = [
  ['', '../lib/routes/rounds'],
  ['/games', '../lib/routes/games'],
  ['/members', '../lib/routes/members'],
  ['/sessions', '../lib/routes/sessions'],
  ['/activities', '../lib/routes/activities'],
  ['/background', '../lib/routes/background'],
  ['/tags', '../lib/routes/tags'],
  ['/lookup', '../lib/routes/lookup'],
  ['/recommendations', '../lib/routes/recommendations'],
];

// MOUNTS is a hand-copied mirror of lib/app.js, and a router missing from it is
// INVISIBLE to both guards below — they would report "every mutating route
// states a required role" while never having looked at it. That was not
// hypothetical: /recommendations was mounted in the app and absent here from
// #682 until #782 gave that router its first mutating route. It cost nothing
// only because there was nothing to miss.
test('MOUNTS covers every round sub-router the app actually mounts', () => {
  const appSrc = require('node:fs').readFileSync(require.resolve('../lib/app.js'), 'utf8');
  const mounted = [...appSrc.matchAll(/app\.use\('\/api\/rounds\/:rid(\/[a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(mounted.length >= 8, `the mount scan found only ${mounted.length} routers — the regex has drifted`);
  const listed = new Set(MOUNTS.map(([prefix]) => prefix));
  assert.deepEqual(mounted.filter((p) => !listed.has(p)), [],
    'these routers are mounted under /api/rounds/:rid but are not walked by the guards below');
});

function registeredMutatingRoutes() {
  const out = [];
  for (const [prefix, mod] of MOUNTS) {
    for (const layer of require(mod).stack || []) {
      if (!layer.route) continue;
      // A sub-router's own '/' becomes the mount itself ('/games'), matching how
      // the table spells it; the rounds router's '/:rid' becomes the bare '/'.
      let path = (prefix + layer.route.path).replace(/\/$/, '') || '/';
      // The rounds router is mounted at /api/rounds, one segment ABOVE the
      // chokepoint, so strip the :rid its own paths carry. Its '/' routes (list
      // and create) sit outside /api/rounds/:rid and are deliberately not gated.
      if (prefix === '') {
        if (!layer.route.path.startsWith('/:rid')) continue;
        path = layer.route.path.slice('/:rid'.length) || '/';
      }
      for (const [method, on] of Object.entries(layer.route.methods || {})) {
        if (!on) continue;
        const m = method.toUpperCase();
        if (['GET', 'HEAD', 'OPTIONS'].includes(m)) continue;
        out.push([m, path]);
      }
    }
  }
  return out;
}

test('every mutating round route states a required role', () => {
  const missing = registeredMutatingRoutes()
    .filter(([method, path]) => !capabilityFor(method, path.replace(/:[^/]+/g, 'x')))
    .map(([method, path]) => `${method} ${path}`);
  assert.deepEqual(missing, [],
    'these routes are refused for every grantee until lib/round-access.js states what they cost');
});

test('the table names no route the app does not register', () => {
  // The other direction: an entry left behind after a route was renamed or
  // removed reads as coverage while guarding nothing at all.
  const registered = new Set(registeredMutatingRoutes().map(([m, p]) => `${m} ${p}`));
  const stale = ROUTE_ROLES
    .map(([method, path]) => `${method} ${path}`)
    .filter((key) => !registered.has(key));
  assert.deepEqual(stale, []);
});

/* ---------------------------- §3 the role matrix ---------------------------- */

// A shared round with a game, a played session and a Chronik to act on, plus the
// grantee's own seat. Returns helpers bound to the grantee's token.
async function seedRound(role) {
  const owner = await makeAccount();
  const grantee = await makeAccount();
  const round = (await request(app).post('/api/rounds').set(auth(owner.token))
    .send({ name: 'Geteilt', members: ['Anna', 'Bob'] })).body;
  const seat = round.members.find((m) => m.name === 'Anna');
  const ownerRepo = repo.forTenant(owner.user.tenantId);
  await ownerRepo.updateMember(round.id, seat.id, { userId: grantee.user.id });
  await repo.createGrant({
    roundId: round.id, ownerTenantId: owner.user.tenantId, userId: grantee.user.id, memberId: seat.id, role,
  });

  // Assert each seed step: a silently failed fixture surfaces much later as
  // "expected 1 games, got 0" or an undefined activity id, which reads as a bug
  // in the feature rather than in the setup.
  const gameRes = await request(app).post(`/api/rounds/${round.id}/games`)
    .set(auth(owner.token)).send({ title: 'Catan', minPlayers: 2, maxPlayers: 4 });
  assert.equal(gameRes.status, 201, `seed: add game -> ${JSON.stringify(gameRes.body)}`);
  const game = gameRes.body;

  // Naming a gameId takes the DIRECT-PICK path, which skips the vote and lands
  // `done: true` — a played evening. That is the session the co-owner-only
  // deletion is about.
  const sessionRes = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .set(auth(owner.token)).send({ gameId: game.id, memberIds: [seat.id] });
  assert.equal(sessionRes.status, 201, `seed: start session -> ${JSON.stringify(sessionRes.body)}`);
  // BOTH start modes answer with an ENVELOPE, `{ session, games, members, … }`.
  // This used to read `sessionRes.body`, so every delete below was aimed at
  // `/sessions/undefined` — which the role gate refuses before routing, so the
  // played-session 403 was asserted against a session that did not exist (#857).
  const session = sessionRes.body.session;
  assert.ok(session && session.id, 'seed: the played session must have an id');
  assert.equal(session.done, true, 'seed: a direct pick skips the vote and lands done');

  // …and one with NO gameId, which draws and leaves voting open (`done: false`)
  // — the live-vote ticket #857 is about. Both members join so the drawn pool
  // can contain Catan (2–4 players); a single joiner would empty the pool and
  // the draw would 400.
  const openRes = await request(app).post(`/api/rounds/${round.id}/sessions`)
    .set(auth(owner.token)).send({ memberIds: round.members.map((m) => m.id) });
  assert.equal(openRes.status, 201, `seed: draw a session -> ${JSON.stringify(openRes.body)}`);
  const openSession = openRes.body.session;
  assert.equal(openSession.done, false, 'seed: the drawn session must still be open');

  const acts = (await request(app).get(`/api/rounds/${round.id}/activities`).set(auth(owner.token))).body;
  assert.ok(acts.length, 'seed: the round has a Chronik entry to delete');
  const activity = acts[0];

  return { owner, grantee, round, seat, game, session, openSession, activity };
}

// Each guarded action, as the request a grantee would make. The expected answers
// per role are in the table below — one place, so a role's whole remit is
// readable at a glance rather than spread over a spec each.
const ACTIONS = {
  'rename the round': (s, tok) => request(app).patch(`/api/rounds/${s.round.id}`).set(tok).send({ name: 'Neu' }),
  'delete the round': (s, tok) => request(app).delete(`/api/rounds/${s.round.id}`).set(tok),
  'delete a played session': (s, tok) => request(app).delete(`/api/rounds/${s.round.id}/sessions/${s.session.id}`).set(tok),
  // Same route, same method — only the session's state differs, which is why
  // the split cannot live in lib/round-access.js's path table (#857).
  'discard an open vote': (s, tok) => request(app).delete(`/api/rounds/${s.round.id}/sessions/${s.openSession.id}`).set(tok),
  'delete a Chronik entry': (s, tok) => request(app).delete(`/api/rounds/${s.round.id}/activities/${s.activity.id}`).set(tok),
  'move games out': (s, tok) => request(app).post(`/api/rounds/${s.round.id}/games/move-to`).set(tok).send({ targetRoundId: 'anywhere' }),
  // Copying destroys nothing, and is owner-only anyway: the hole #411 closed is
  // the TARGET round, which a copy reaches just as freely as a move (#916).
  'copy games out': (s, tok) => request(app).post(`/api/rounds/${s.round.id}/games/copy-to`).set(tok).send({ targetRoundId: 'anywhere' }),
  'relink a seat': (s, tok) => request(app).patch(`/api/rounds/${s.round.id}/members/${s.seat.id}`).set(tok).send({ userId: null }),
  // Ordinary writes — the editor's actual remit, and the half that proves the
  // refusals above are a role decision rather than a blanket lockout.
  'add a game': (s, tok) => request(app).post(`/api/rounds/${s.round.id}/games`).set(tok).send({ title: 'Azul', minPlayers: 2, maxPlayers: 4 }),
  'rename a member': (s, tok) => request(app).patch(`/api/rounds/${s.round.id}/members/${s.seat.id}`).set(tok).send({ name: 'Annika' }),
  'add a tag': (s, tok) => request(app).post(`/api/rounds/${s.round.id}/tags`).set(tok).send({ name: 'Kenner' }),
  'start a session': (s, tok) => request(app).post(`/api/rounds/${s.round.id}/sessions`).set(tok).send({ gameId: s.game.id, memberIds: [s.seat.id] }),
  'retire a game': (s, tok) => request(app).post(`/api/rounds/${s.round.id}/games/${s.game.id}/retire`).set(tok).send({ retired: true }),
};

// true = allowed (the route answers on its own merits), false = 403 not_owner.
const MATRIX = {
  editor: {
    'rename the round': false,
    'delete the round': false,
    'delete a played session': false,
    'discard an open vote': true,
    'delete a Chronik entry': false,
    'move games out': false,
    'copy games out': false,
    'relink a seat': false,
    'add a game': true,
    'rename a member': true,
    'add a tag': true,
    'start a session': true,
    'retire a game': true,
  },
  coowner: {
    'rename the round': true,
    'delete the round': false,
    'delete a played session': true,
    'discard an open vote': true,
    'delete a Chronik entry': true,
    // Owner-only for EVERY grantee role: #411's hole, and the seat-link desync.
    // Neither is about trust, so promoting someone does not open them.
    'move games out': false,
    'copy games out': false,
    'relink a seat': false,
    'add a game': true,
    'rename a member': true,
    'add a tag': true,
    'start a session': true,
    'retire a game': true,
  },
};

for (const [role, expected] of Object.entries(MATRIX)) {
  test(`a ${role} may do exactly what the ladder says`, async () => {
    for (const [name, allowed] of Object.entries(expected)) {
      // A fresh round per action: several of these are destructive, so sharing
      // one would make the outcome depend on the order the object is iterated in.
      const s = await seedRound(role);
      const res = await ACTIONS[name](s, auth(s.grantee.token));
      if (allowed) {
        assert.notEqual(res.status, 403, `${role} should be allowed to ${name}, got ${res.status}`);
      } else {
        assert.equal(res.status, 403, `${role} must not be able to ${name}`);
        assert.equal(res.body.error, 'not_owner');
      }
    }
  });
}

test('an editor discards a running vote for real, and is still refused a played evening', async () => {
  // The matrix above only asks "was it a 403?". This asks whether the allowed
  // half actually did the thing — a route that answers 200 and deletes nothing
  // satisfies `notEqual(403)` perfectly — and whether the refused half really
  // left the played session in place rather than deleting it and then erroring.
  const s = await seedRound('editor');

  const discard = await request(app)
    .delete(`/api/rounds/${s.round.id}/sessions/${s.openSession.id}`).set(auth(s.grantee.token));
  assert.equal(discard.status, 200, `an editor may discard an open vote: ${JSON.stringify(discard.body)}`);

  const played = await request(app)
    .delete(`/api/rounds/${s.round.id}/sessions/${s.session.id}`).set(auth(s.grantee.token));
  assert.equal(played.status, 403);
  assert.equal(played.body.error, 'not_owner');

  // Read back as the OWNER: the grantee's view is re-scoped, so asking through
  // their token would prove less.
  const after = await request(app).get(`/api/rounds/${s.round.id}`).set(auth(s.owner.token));
  const ids = after.body.sessions.map((x) => x.id);
  assert.equal(ids.includes(s.openSession.id), false, 'the discarded vote is gone');
  assert.equal(ids.includes(s.session.id), true, 'the played evening survived the refusal');
});

test('a cancelled vote is history, not a running one — an editor may not delete it', async () => {
  // The trap the boundary hides. `cancelSession` never touches `done`, so a vote
  // cancelled before a game was chosen keeps `done: false` — and `!done` alone,
  // which the Start ticket's filter makes look like the natural predicate, would
  // hand every grantee the deletion of an evening the Chronik draws as
  // „Abgebrochen". The live-vote ticket filters on BOTH flags; so does the route.
  const s = await seedRound('editor');
  const cancel = await request(app)
    .post(`/api/rounds/${s.round.id}/sessions/${s.openSession.id}/cancel`)
    .set(auth(s.grantee.token)).send({});
  assert.equal(cancel.status, 200, `cancelling is an ordinary write: ${JSON.stringify(cancel.body)}`);
  assert.equal(cancel.body.done, false, 'the fixture is only meaningful while `done` stays false');
  assert.equal(cancel.body.cancelled, true);

  const del = await request(app)
    .delete(`/api/rounds/${s.round.id}/sessions/${s.openSession.id}`).set(auth(s.grantee.token));
  assert.equal(del.status, 403);
  assert.equal(del.body.error, 'not_owner');

  // …and a co-owner still may, so this is a role boundary rather than the route
  // having simply stopped deleting cancelled sessions for anyone.
  const co = await seedRound('coowner');
  await request(app).post(`/api/rounds/${co.round.id}/sessions/${co.openSession.id}/cancel`)
    .set(auth(co.grantee.token)).send({});
  assert.equal((await request(app).delete(`/api/rounds/${co.round.id}/sessions/${co.openSession.id}`)
    .set(auth(co.grantee.token))).status, 200);
});

test('the ROLE gate never refuses the round owner', async () => {
  // Asserted on the error CODE rather than on the status, and the distinction is
  // the point: `not_owner` is this feature's refusal, while a handler may still
  // say no for a reason of its own. The owner really is refused "relink a seat"
  // here — with `not_self`, the #421 guard that stops an owner nulling a
  // GRANTEE's seat link and stranding them with access but no chair
  // (.claude/rules/member-seat-self-claim.md). A status-only assertion would
  // either fail on that or, if loosened, stop noticing a role gate that had
  // started refusing owners outright.
  for (const name of Object.keys(ACTIONS)) {
    const s = await seedRound('editor');
    const res = await ACTIONS[name](s, auth(s.owner.token));
    assert.notEqual(res.body.error, 'not_owner', `the role gate refused the owner: ${name}`);
  }
});

/* --------------------------- §4 unlisted = refused -------------------------- */

test('a mutating round route the table does not name is refused for a grantee', () => {
  // The property the whole design rests on: the default for something nobody has
  // classified is CLOSED. Asserted at the table rather than over HTTP, because a
  // route that does not exist yet cannot be requested — which is exactly the
  // case this guards.
  assert.equal(capabilityFor('POST', '/games/x/teleport'), null);
  assert.equal(capabilityFor('DELETE', '/something-new'), null);
  assert.equal(capabilityFor('POST', '/'), null); // create is not under this mount

  // …and a listed one still resolves, so the null above is a real miss rather
  // than a matcher that never matches anything.
  assert.equal(capabilityFor('DELETE', '/'), 'round.delete');
  assert.equal(capabilityFor('POST', '/games/move-to'), 'games.moveOut');
  assert.equal(capabilityFor('POST', '/games/copy-to'), 'games.copyOut');
  assert.equal(capabilityFor('POST', '/games/x/retire'), 'round.write');
  // The FLOOR for deleting a session is the editor-level discard (#857); the
  // handler narrows to 'session.delete' for a played one, which no table keyed
  // on the path could express.
  assert.equal(capabilityFor('DELETE', '/sessions/x'), 'session.discard');
});

test('a grantee is refused an unlisted mutating path over HTTP, and the owner is not', async () => {
  // The table half above is a statement about a data structure; this is the
  // behaviour it is supposed to produce. A path no router serves stands in for
  // "a route added tomorrow": the grantee must be refused BEFORE routing (403),
  // while the owner falls through to the ordinary 404. Without that asymmetry the
  // default-deny is only asserted where it is also implemented.
  const s = await seedRound('coowner');
  const asGrantee = await request(app).post(`/api/rounds/${s.round.id}/not-a-real-route`)
    .set(auth(s.grantee.token)).send({});
  assert.equal(asGrantee.status, 403);
  assert.equal(asGrantee.body.error, 'not_owner');

  const asOwner = await request(app).post(`/api/rounds/${s.round.id}/not-a-real-route`)
    .set(auth(s.owner.token)).send({});
  assert.equal(asOwner.status, 404);

  // A GET on an unlisted path is NOT refused — reads are bounded by the grant
  // resolver, and gating them would turn a typo into a 403 for the owner too.
  assert.notEqual((await request(app).get(`/api/rounds/${s.round.id}/not-a-real-route`)
    .set(auth(s.grantee.token))).status, 403);
});

test('the gate is a pure no-op without a grant (legacy and accounts-off callers)', () => {
  // Accounts-off mode never resolves a grant, so every caller must pass straight
  // through with role `owner`. Driven at the middleware rather than over HTTP
  // because the shared test app in ./helpers is accounts-off already — the rest
  // of the suite is the end-to-end evidence that mode is unchanged; this pins the
  // reason, so a future edit that starts consulting the table before checking for
  // a grant reddens here instead of breaking every self-hosted instance.
  const { requireRoundRole } = require('../lib/round-access');
  for (const method of ['DELETE', 'POST', 'GET']) {
    let nexted = false;
    const req = { method, path: '/anything/unlisted' };
    const res = { status: () => assert.fail(`the gate refused a grant-less ${method}`) };
    requireRoundRole(req, res, () => { nexted = true; });
    assert.equal(nexted, true);
    assert.equal(req.roundRole, 'owner');
  }
});

test('#411 stays closed: no grantee role can name a second round in the body', async () => {
  for (const role of ['editor', 'coowner']) {
    const s = await seedRound(role);
    // A round of the OWNER's that the grantee holds no grant on — the target the
    // re-scoped repo would happily resolve if the guard were missing.
    const other = (await request(app).post('/api/rounds').set(auth(s.owner.token))
      .send({ name: 'Privat', members: ['Owner'] })).body;
    for (const verb of ['move-to', 'copy-to']) {
      const res = await request(app).post(`/api/rounds/${s.round.id}/games/${verb}`)
        .set(auth(s.grantee.token)).send({ targetRoundId: other.id });
      assert.equal(res.status, 403, verb);
    }
    // And nothing moved.
    const still = await request(app).get(`/api/rounds/${s.round.id}`).set(auth(s.owner.token));
    assert.equal(still.body.games.length, 1);
    const target = await request(app).get(`/api/rounds/${other.id}`).set(auth(s.owner.token));
    assert.equal(target.body.games.length, 0);
  }
});

/* ------------------- §5 legacy values and accounts-off mode ------------------ */

test("a grant still carrying the pre-#137 'member' role behaves exactly as an editor", async () => {
  const s = await seedRound('member');
  // It may do the ordinary writes it always could…
  const add = await request(app).post(`/api/rounds/${s.round.id}/games`)
    .set(auth(s.grantee.token)).send({ title: 'Azul', minPlayers: 2, maxPlayers: 4 });
  assert.notEqual(add.status, 403);
  // …and is refused the four it always was, plus the four #137 moved up.
  const del = await request(app).delete(`/api/rounds/${s.round.id}`).set(auth(s.grantee.token));
  assert.equal(del.status, 403);
  const sess = await request(app).delete(`/api/rounds/${s.round.id}/sessions/${s.session.id}`)
    .set(auth(s.grantee.token));
  assert.equal(sess.status, 403);
});

test('the role travels on the round payload, for the client to hide by', async () => {
  const s = await seedRound('coowner');
  const asGrantee = await request(app).get(`/api/rounds/${s.round.id}`).set(auth(s.grantee.token));
  assert.equal(asGrantee.body.shared, true);
  assert.equal(asGrantee.body.role, 'coowner');

  // The owner gets NEITHER key — their absence is what roundCan reads as
  // ownership, so a `role: 'owner'` here would be a different contract.
  const asOwner = await request(app).get(`/api/rounds/${s.round.id}`).set(auth(s.owner.token));
  assert.equal('shared' in asOwner.body, false);
  assert.equal('role' in asOwner.body, false);

  // The home list carries it too, or a shared round's card could offer an action
  // the round screen then hides.
  const home = await request(app).get('/api/rounds').set(auth(s.grantee.token));
  assert.equal(home.body.find((r) => r.id === s.round.id).role, 'coowner');
});

test('changing a role is owner-only, and cannot mint an owner', async () => {
  const s = await seedRound('editor');
  const url = `/api/rounds/${s.round.id}/shares/${s.grantee.user.id}`;

  // A grantee cannot promote themselves — the reason 'round.shares.manage' is
  // owner-only rather than co-owner, which would be self-promotion in one hop.
  assert.equal((await request(app).patch(url).set(auth(s.grantee.token)).send({ role: 'coowner' })).status, 403);

  const ok = await request(app).patch(url).set(auth(s.owner.token)).send({ role: 'coowner' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.role, 'coowner');
  assert.equal((await repo.listGrantsForUser(s.grantee.user.id))[0].role, 'coowner');

  // 'owner' is not assignable: ownership is not a grant, so a grant claiming it
  // would outrank every guard while the real owner still owns the round.
  assert.equal((await request(app).patch(url).set(auth(s.owner.token)).send({ role: 'owner' })).status, 400);
  assert.equal((await request(app).patch(url).set(auth(s.owner.token)).send({ role: 'sysadmin' })).status, 400);
  assert.equal((await repo.listGrantsForUser(s.grantee.user.id))[0].role, 'coowner');

  // A user who holds no grant on this round is a 404, not a silent no-op.
  const stranger = await makeAccount('promote-stranger@example.com');
  assert.equal((await request(app).patch(`/api/rounds/${s.round.id}/shares/${stranger.user.id}`)
    .set(auth(s.owner.token)).send({ role: 'coowner' })).status, 404);
});

test('the share list is owner-only', async () => {
  const s = await seedRound('coowner');
  const asOwner = await request(app).get(`/api/rounds/${s.round.id}/shares`).set(auth(s.owner.token));
  assert.equal(asOwner.status, 200);
  assert.deepEqual(asOwner.body, [{ userId: s.grantee.user.id, memberId: s.seat.id, role: 'coowner' }]);

  // Even a co-owner may not enumerate the owner's other grantees.
  assert.equal((await request(app).get(`/api/rounds/${s.round.id}/shares`)
    .set(auth(s.grantee.token))).status, 403);
});

/* ------------------ §6 the client hides what the route refuses --------------- */

/* The other half of #857. The route was only ever the second line of defence:
   the Start screen offered „Abstimmung verwerfen" to EVERY grantee while the
   route cost co-owner, so an editor's confirm dialog accepted and the request
   then 403'd into a toast. This is exactly the drift
   .claude/rules/shared-constants-across-the-stack.md describes for this file —
   a client copy that offers a button the server refuses.

   Note what these two cases can and cannot prove today. `session.discard` is the
   editor floor and normalizeRole clamps every unknown value UP to `editor`, so
   no real role fails the guard: the hidden branch is unreachable through data
   alone. Stubbing `roundCan` is therefore the only way to show the guard is
   WIRED rather than merely present in the source — which is the whole point,
   since a re-tightening tomorrow must degrade to a hidden control, not a 403. */

const { loadApp } = require('./support/dom');

const liveVoteRound = () => ({
  id: 1,
  name: 'Donnerstagsrunde',
  shared: true,
  role: 'editor',
  games: [{ id: 7, title: 'Catan', retired: false, completed: false }],
  members: [],
  sessions: [{ id: 9, createdAt: '2026-08-29T18:00:00Z', gameIds: [7], done: false, cancelled: false, finished: false }],
  activity: [],
  tags: [],
});

/** The Start tab's control labels, for a caller `roundCan` answers `allowed` for. */
function startTabLabels(t, { stubDeny } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (stubDeny) dom.set('roundCan', () => false);
  const round = liveVoteRound();
  dom.call('renderStartTab', round, round.games);
  return [...dom.app.querySelectorAll('button, a')]
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

test('the Start screen offers the discard to an editor, whom the route now allows', (t) => {
  const found = startTabLabels(t);
  assert.ok(found.includes('Abstimmung verwerfen'),
    `an editor is not offered the discard they are entitled to: ${found}`);
  // Anti-vacuous: the ticket itself must still render, or "the label is present"
  // would be asserted against a screen that draws no live vote at all.
  assert.ok(found.some((l) => l.includes('Jetzt abstimmen')), `the live-vote ticket is gone: ${found}`);
});

test('the discard is HIDDEN from a caller the capability refuses, rather than 403ing them', (t) => {
  const found = startTabLabels(t, { stubDeny: true });
  assert.ok(!found.includes('Abstimmung verwerfen'),
    `the discard is rendered unguarded — a refused caller gets a button that 403s: ${found}`);
  // The ticket is NOT gated, only its discard: hiding the vote itself would take
  // the round's co-players out of the session they are supposed to be voting in.
  assert.ok(found.some((l) => l.includes('Jetzt abstimmen')), `the live-vote ticket was gated too: ${found}`);
});
