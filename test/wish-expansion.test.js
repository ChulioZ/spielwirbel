'use strict';

/* Acquiring a wished EXPANSION onto its base game (#664).
 *
 * Its own file rather than a section of test/game-expansions.test.js: that one
 * is about what the expansions WRITE route may trust, this one about the road a
 * wish takes onto a game — a different route, different fixtures, and folding
 * them together would push either file past the 700-line budget
 * (.claude/rules/token-friendly-source-files.md).
 *
 * Three layers: the pure decision (required into Node), the route, and the two
 * screens (jsdom, per .claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, createRound } = require('./helpers');
const repo = require('../lib/repo');
const { loadApp } = require('./support/dom');
const {
  expansionBaseCandidates,
  expansionAcquirePlan,
  acquirableBases,
} = require('../public/js/wish-expansion');

/* ----------------------------- the decision -------------------------------- */

const bggGame = (id, externalId, over = {}) => ({
  id, title: `Game ${externalId}`, wish: false,
  source: { provider: 'bgg', externalId, url: null },
  ...over,
});

const wishedExpansion = (id, externalId, parents) => bggGame(id, externalId, {
  wish: true,
  expansionOf: parents,
});

test('a parent already in the round is matched by its provider LINK, never by title', () => {
  const exp = wishedExpansion('e1', '325', [{ providerId: '13', title: 'CATAN' }]);
  const round = {
    games: [
      // Same title as the declared parent, different provider record: a title
      // match would attach the expansion to this box with no error anywhere.
      bggGame('g1', '999', { title: 'CATAN' }),
      bggGame('g2', '13', { title: 'Die Siedler von Catan' }),
    ],
  };
  const { candidates } = expansionBaseCandidates(round, exp);
  assert.deepEqual(candidates.map((g) => g.id), ['g2']);
  assert.deepEqual(expansionAcquirePlan(round, exp), { action: 'attach', base: round.games[1] });
});

test('a game linked to a DIFFERENT provider can never be the base game', () => {
  const exp = wishedExpansion('e1', '325', [{ providerId: '13', title: 'CATAN' }]);
  // Same external id under Steam. Ids are only unique within a provider, so
  // ignoring the provider would file a board-game expansion under a video game.
  const round = { games: [{ id: 'g1', title: 'Half-Life', source: { provider: 'steam', externalId: '13' } }] };
  assert.deepEqual(expansionBaseCandidates(round, exp).candidates, []);
});

test('the plan routes each shape of "which game does this belong to?"', () => {
  const twoParents = [{ providerId: '13', title: 'CATAN' }, { providerId: '822', title: 'Tigris' }];

  // Both declared parents are here -> the user picks.
  const both = { games: [bggGame('g1', '13'), bggGame('g2', '822')] };
  const expBoth = wishedExpansion('e1', '4001', twoParents);
  assert.deepEqual(expansionAcquirePlan(both, expBoth),
    { action: 'pickBase', choices: both.games });

  // None is here and exactly one is declared -> create it, then attach.
  const empty = { games: [] };
  const expOne = wishedExpansion('e1', '325', [{ providerId: '13', title: 'CATAN' }]);
  assert.deepEqual(expansionAcquirePlan(empty, expOne),
    { action: 'createBase', parent: { providerId: '13', title: 'CATAN' } });

  // None is here and several are declared -> ask which one to create.
  assert.deepEqual(expansionAcquirePlan(empty, wishedExpansion('e1', '4001', twoParents)),
    { action: 'pickParent', choices: twoParents });
});

test('an expansion BGG named no parent for falls back to the round\'s own shelf', () => {
  // The state that would otherwise be a dead end: importable, visible, and
  // impossible to file. It must ask rather than refuse.
  const orphan = wishedExpansion('e1', '4002', []);
  const round = {
    games: [
      orphan,
      bggGame('g1', '13'),
      bggGame('g2', '822', { wish: true }),                       // a wished GAME is offerable…
      wishedExpansion('e2', '9999', [{ providerId: '13', title: 'X' }]), // …another expansion is not
    ],
  };
  const plan = expansionAcquirePlan(round, orphan);
  assert.equal(plan.action, 'pickBase');
  assert.deepEqual(plan.choices.map((g) => g.id), ['g1', 'g2']);
  assert.deepEqual(acquirableBases(round, orphan).map((g) => g.id), ['g1', 'g2']);
});

test('a row with no expansionOf is not an expansion at all', () => {
  const plainWish = bggGame('g1', '13', { wish: true });
  const round = { games: [plainWish, bggGame('g2', '822')] };
  assert.deepEqual(expansionBaseCandidates(round, plainWish), { parents: [], candidates: [] });
  // It still routes to pickBase — the view never calls this for such a row, and
  // the ROUTE is what refuses it (`not_wish`), so the guard cannot be bypassed
  // by a client that does.
  assert.equal(expansionAcquirePlan(round, plainWish).action, 'pickBase');
});

/* ------------------------------- the route --------------------------------- */

const tenantRepo = () => repo.forTenant('default');

// Seed a base game plus a wished expansion pointing at it. Wish rows carrying an
// `expansionOf` are only ever created by the wishlist import, so this goes
// through the same bulk method rather than inventing a shape by hand.
async function seed(over = {}) {
  const round = await createRound(request);
  const r = tenantRepo();
  const base = await r.createGame(round.id, {
    title: 'Catan', minPlayers: 3, maxPlayers: 4, image: null,
    source: { provider: 'bgg', externalId: '13', url: null },
  });
  const { created } = await r.createGames(round.id, [{
    title: 'Seefahrer', minPlayers: 5, maxPlayers: 6, image: null,
    source: { provider: 'bgg', externalId: '325', url: null },
    expansionOf: [{ providerId: '13', title: 'CATAN' }],
    ...over,
  }], undefined, null, true);
  return { rid: round.id, base, wish: created[0] };
}

const acquire = (rid, gid, body) =>
  request(app).post(`/api/rounds/${rid}/games/${gid}/acquire-expansion`).send(body);

test('POST …/acquire-expansion moves the wish onto its base game', async () => {
  const { rid, base, wish } = await seed();
  const res = await acquire(rid, wish.id, { baseGameId: base.id });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, base.id);
  assert.deepEqual(res.body.expansions.map((e) => e.title), ['Seefahrer']);
  assert.equal(res.body.expansions[0].maxPlayers, 6);

  const round = (await request(app).get(`/api/rounds/${rid}`)).body;
  assert.deepEqual(round.games.map((g) => g.title), ['Catan'], 'the wish row is gone');

  // The expansion's range is the point: Catan is a 3–4 box, and the round can
  // now draw it at six. Asserted through the API rather than the predicate so
  // this covers the whole write path.
  assert.equal(round.games[0].expansions[0].minPlayers, 5);
});

test('the acquire is SILENT on the two non-Chronik channels', async () => {
  const { rid, base, wish } = await seed();
  await acquire(rid, wish.id, { baseGameId: base.id });
  const feed = (await request(app).get(`/api/rounds/${rid}/activities`)).body;
  // One count-carrying expansion entry, and no second `game_added`: an expansion
  // is not a game arriving on the shelf (.claude/rules/expansions-widen-by-union.md).
  const exp = feed.filter((a) => a.type === 'game_expansion_added');
  assert.equal(exp.length, 1);
  assert.equal(exp[0].count, 1);
  assert.equal(exp[0].title, 'Catan');
  assert.equal(feed.filter((a) => a.type === 'game_added').length, 1, 'only the base game\'s own');
});

test('the route refuses everything that is not a wished expansion', async () => {
  const { rid, base, wish } = await seed();

  assert.equal((await acquire(rid, wish.id, {})).status, 400);          // no baseGameId
  assert.equal((await acquire(rid, 'nope', { baseGameId: base.id })).status, 404);
  assert.equal((await acquire('nope', wish.id, { baseGameId: base.id })).status, 404);

  const unknownBase = await acquire(rid, wish.id, { baseGameId: 'nope' });
  assert.equal(unknownBase.status, 404);
  assert.equal(unknownBase.body.error, 'Base game not found');

  // A game on the shelf is not acquirable onto another game — that would take a
  // votable game off the shelf with no way back.
  const notWish = await acquire(rid, base.id, { baseGameId: wish.id });
  assert.equal(notWish.status, 400);

  // Nothing moved.
  const round = (await request(app).get(`/api/rounds/${rid}`)).body;
  assert.deepEqual(round.games.map((g) => g.title).sort(), ['Catan', 'Seefahrer']);
});

test('a plain wished GAME cannot be folded into another game\'s expansions', async () => {
  const round = await createRound(request);
  const r = tenantRepo();
  const base = await r.createGame(round.id, { title: 'Catan', minPlayers: 3, maxPlayers: 4, image: null });
  // No expansionOf: the wishlist import writes the key only for an expansion, so
  // its absence is what distinguishes the two — and getting this wrong would let
  // a hand-rolled request delete a wished game and record it as an expansion.
  const { created } = await r.createGames(round.id, [
    { title: 'Ark Nova', minPlayers: 1, maxPlayers: 4, image: null },
  ], undefined, null, true);

  const res = await acquire(round.id, created[0].id, { baseGameId: base.id });
  assert.equal(res.status, 400);
  const after = (await request(app).get(`/api/rounds/${round.id}`)).body;
  assert.equal(after.games.length, 2, 'the wished game is untouched');
});

/* ------------------------------- the screens ------------------------------- */

const roundFixture = (games) => ({
  id: 1, name: 'Donnerstagsrunde', shared: false,
  games, members: [], sessions: [], activity: [], tags: [], providers: [],
});

/** Render the Wunschliste over a fixture and return the harness. */
async function wishlist(t, games) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => roundFixture(games));
  await dom.call('showWishlist', 1);
  return dom;
}

test('the Wunschliste says which game a wished expansion belongs to', async (t) => {
  const dom = await wishlist(t, [
    wishedExpansion('e1', '325', [{ providerId: '13', title: 'CATAN' }]),
    wishedExpansion('e2', '4002', []),
    bggGame('g1', '822', { wish: true, title: 'Ark Nova' }),
  ]);
  const rows = [...dom.app.querySelectorAll('.archive-row')];
  assert.equal(rows.length, 3);
  const text = (row) => (row.textContent || '').replace(/\s+/g, ' ');

  assert.match(text(rows[0]), /Erweiterung zu CATAN/);
  // The unattached state has to be VISIBLE: it is the one where "Ins Regal" will
  // stop and ask the user to file it by hand.
  assert.match(text(rows[1]), /Erweiterung – BoardGameGeek nennt kein Grundspiel/);
  // A wished GAME must not gain the line, or every row claims to be an expansion.
  assert.doesNotMatch(text(rows[2]), /Erweiterung/);
});

test('"Ins Regal" on an expansion attaches it instead of clearing the wish flag', async (t) => {
  const exp = wishedExpansion('e1', '325', [{ providerId: '13', title: 'CATAN' }]);
  const base = bggGame('g1', '13', { title: 'Catan' });
  const dom = await wishlist(t, [exp, base]);

  const calls = [];
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body: body && { ...body } });
    return roundFixture([base]);
  });
  dom.set('confirm', () => true);
  dom.context.window.confirm = () => true;

  const rows = [...dom.app.querySelectorAll('.archive-row')];
  rows[0].querySelector('[data-act="restore"]').click();
  await new Promise((r) => setTimeout(r, 0));

  const acquires = calls.filter((c) => c.path.includes('acquire-expansion'));
  assert.equal(acquires.length, 1, `expected one acquire call, got ${JSON.stringify(calls)}`);
  assert.equal(acquires[0].path, '/api/rounds/1/games/e1/acquire-expansion');
  assert.deepEqual({ ...acquires[0].body }, { baseGameId: 'g1' });
  // The flat wish endpoint must NOT be used for an expansion: it would put a box
  // on the shelf that can never be voted on or drawn.
  assert.equal(calls.some((c) => /\/games\/e1\/wish$/.test(c.path)), false);
});

test('a base game the round lacks is created from the provider, then attached', async (t) => {
  // The branch with the most moving parts: a detail hop, a multipart create and
  // the acquire, all behind ONE confirm — being sent away to add Catan by hand
  // before the wish list will accept Seefahrer is the flow nobody finishes.
  const exp = wishedExpansion('e1', '325', [{ providerId: '13', title: 'CATAN' }]);
  const dom = await wishlist(t, [exp]);

  const calls = [];
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes('/lookup/game')) {
      return { title: 'CATAN', minPlayers: 3, maxPlayers: 4, imageUrl: 'https://cf.geekdo-images.com/x.png', url: 'https://boardgamegeek.com/boardgame/13' };
    }
    if (/\/games$/.test(path)) return { id: 'new1', title: 'CATAN' };
    return roundFixture([]);
  });
  dom.context.window.confirm = () => true;

  dom.app.querySelector('[data-act="restore"]').click();
  await new Promise((r) => setTimeout(r, 0));

  const detail = calls.find((c) => c.path.includes('/lookup/game'));
  assert.ok(detail, `no detail hop: ${JSON.stringify(calls.map((c) => c.path))}`);
  assert.match(detail.path, /provider=bgg&id=13/);

  // The create carries what the detail hop resolved, never what the link said.
  const create = calls.find((c) => /\/games$/.test(c.path));
  assert.ok(create, 'the base game was never created');
  assert.equal(create.body.get('title'), 'CATAN');
  assert.equal(create.body.get('minPlayers'), '3');
  assert.equal(create.body.get('sourceExternalId'), '13');
  assert.equal(create.body.get('sourceProvider'), 'bgg');

  // …and the acquire names the game that was just created, not the BGG id.
  const acquire = calls.find((c) => c.path.includes('acquire-expansion'));
  assert.ok(acquire, 'the expansion was never attached to the new game');
  assert.deepEqual({ ...acquire.body }, { baseGameId: 'new1' });
});

test('a base game with no player range from BGG still lands, at the widest range', async (t) => {
  // POST /games requires a range while a game whose range is unknown is meant to
  // be drawable at ANY count. Without a fallback the create 400s and the whole
  // acquisition dies on a game BGG simply has no numbers for.
  const exp = wishedExpansion('e1', '325', [{ providerId: '13', title: 'CATAN' }]);
  const dom = await wishlist(t, [exp]);
  const calls = [];
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes('/lookup/game')) return { title: 'CATAN', minPlayers: null, maxPlayers: null };
    if (/\/games$/.test(path)) return { id: 'new1', title: 'CATAN' };
    return roundFixture([]);
  });
  dom.context.window.confirm = () => true;

  dom.app.querySelector('[data-act="restore"]').click();
  await new Promise((r) => setTimeout(r, 0));

  const create = calls.find((c) => /\/games$/.test(c.path));
  assert.equal(create.body.get('minPlayers'), '1');
  assert.equal(create.body.get('maxPlayers'), '99');
  assert.ok(calls.some((c) => c.path.includes('acquire-expansion')), 'the acquire still ran');
});

test('"Ins Regal" on a plain wished game still clears the flag', async (t) => {
  // The other half of the branch: without this, "never call /wish" would be
  // satisfied by a view that broke the ordinary acquisition too.
  const plain = bggGame('g1', '822', { wish: true, title: 'Ark Nova' });
  const dom = await wishlist(t, [plain]);

  const calls = [];
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body: body && { ...body } });
    return roundFixture([]);
  });
  dom.app.querySelector('[data-act="restore"]').click();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(calls[0].path, '/api/rounds/1/games/g1/wish');
  assert.deepEqual({ ...calls[0].body }, { wish: false });
});
