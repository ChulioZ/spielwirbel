'use strict';

/*
 * „Wertungskategorien" (#1787), end to end over HTTP: the operator's list of
 * category sets rounds have typed for a BGG game, the three actions, and what a
 * confirmation does to every round — the base first and locked, matching round
 * categories mapped with their history, extras after, the 409 on a locked
 * edit, the points route's id translation, and the exact restore on revoke.
 * The pure half is test/game-categories.test.js, the repo half the contract.
 *
 * Accounts ON so two real tenants exist; rounds are seeded through each
 * tenant's scoped repo and READ back over HTTP as their owner.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.ADMIN_PASSWORD = 'operator-secret-pw';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, adminSessionCookie } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { gameCategoryRecords } = require('../public/js/point-records');
const { sessionPartyGroups } = require('../public/js/session-people');
const { sortSessionsByDate } = require('../public/js/session-order');

const PASSWORD = 'correct horse battery';
const deps = { sessionPartyGroups, sortSessionsByDate };

async function makeAccount(name) {
  const email = `${name}@example.com`;
  await request(app).post('/api/account/register').send({ email, username: name, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}

const WING = '266192';
const src = (id) => ({ provider: 'bgg', externalId: id, url: `https://boardgamegeek.com/boardgame/${id}` });

// One round in `tenant` with a game linked to `bggId`, carrying `cats` as its
// own stored categories and one finished session whose parts use them.
async function seedRound(tenant, { bggId = WING, cats, parts, title = 'Flügelschlag', source } = {}) {
  const scoped = repo.forTenant(tenant);
  const round = await scoped.createRound({ name: `Runde ${title}`, members: ['Anna', 'Ben'], importFromRoundId: null });
  const m1 = round.members[0].id;
  const game = await scoped.createGame(round.id, { title, minPlayers: 1, maxPlayers: 5, image: null, source: source === undefined ? src(bggId) : source });
  await scoped.updateGame(round.id, game.id, { scoreCategories: cats });
  const total = Object.values(parts || {}).reduce((a, b) => a + b, 0);
  const session = await scoped.createSession(round.id, {
    createdAt: '2026-11-01T19:00:00.000Z', gameIds: [game.id], votes: {}, chosenGameId: game.id, chosenAt: 't',
    finished: true, finishedAt: 't', winnerIds: [], cancelled: false, cancelledAt: null, done: true,
    scores: { [m1]: total }, ...(parts ? { scoreParts: { [m1]: parts } } : {}),
  });
  return { round, game, session, m1 };
}

const admin = async (method, path, body) => {
  const cookie = await adminSessionCookie();
  const req = request(app)[method](`/api/admin${path}`).set('Cookie', cookie);
  return body ? req.send(body) : req;
};

const roundAs = async (who, rid) => {
  const res = await request(app).get(`/api/rounds/${rid}`).set('Authorization', `Bearer ${who.token}`);
  assert.equal(res.status, 200);
  return res.body;
};
const patchGame = (who, rid, gid, body) => request(app).patch(`/api/rounds/${rid}/games/${gid}`)
  .set('Authorization', `Bearer ${who.token}`).send(body);

test('the set list, a confirmation across rounds, the locks, points, revoke and dismissal', async (t) => {
  const ada = await makeAccount('ada-cats');
  const bo = await makeAccount('bo-cats');
  // Ada's two rounds type the same set with different case and spacing; Bo's
  // has the first two, plus an expansion category of its own.
  const a1 = await seedRound(ada.user.tenantId, {
    cats: [{ id: 'cat-ada1-v', name: 'Vögel' }, { id: 'cat-ada1-e', name: 'Eier' }, { id: 'cat-ada1-b', name: 'Boni' }],
    parts: { 'cat-ada1-v': 40, 'cat-ada1-e': 12, 'cat-ada1-b': 7 },
  });
  const a2 = await seedRound(ada.user.tenantId, {
    cats: [{ id: 'cat-ada2-v', name: ' vögel' }, { id: 'cat-ada2-e', name: 'EIER' }, { id: 'cat-ada2-b', name: 'boni ' }],
  });
  const b1 = await seedRound(bo.user.tenantId, {
    cats: [{ id: 'cat-bo-v', name: 'Vögel' }, { id: 'cat-bo-e', name: 'Eier' }, { id: 'cat-bo-o', name: 'Ozeanien' }],
    parts: { 'cat-bo-v': 30, 'cat-bo-e': 5, 'cat-bo-o': 9 },
  });
  // Never listed: a demo tenant, an unlinked game.
  await seedRound('demo-cats', { cats: [{ id: 'cat-demo', name: 'Demo' }] });
  await seedRound(bo.user.tenantId, { source: null, cats: [{ id: 'cat-free', name: 'Frei' }] });

  const a1Before = await roundAs(ada, a1.round.id);

  await t.test('every route is behind the operator gate', async () => {
    assert.equal((await request(app).get('/api/admin/game-categories')).status, 401);
    assert.equal((await request(app).get('/api/admin/game-categories.csv')).status, 401);
    assert.equal((await request(app).post(`/api/admin/game-categories/${WING}`).send({ action: 'dismiss' })).status, 401);
  });

  await t.test('the list groups normalised sets, counts rounds, excludes demo and unlinked, and names nobody', async () => {
    const res = await admin('get', '/game-categories');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.games, [{
      bggId: WING, title: 'Flügelschlag', rounds: 3, state: 'open', categories: null, confirmedAt: null,
      sets: [
        { names: ['Vögel', 'Eier', 'Boni'], rounds: 2 },
        { names: ['Vögel', 'Eier', 'Ozeanien'], rounds: 1 },
      ],
    }]);
    const text = JSON.stringify(res.body);
    const ids = [ada.user.id, bo.user.id, ada.user.tenantId, bo.user.tenantId, a1.round.id, a1.game.id, a1.session.id,
      a2.round.id, b1.round.id, a1.m1, 'cat-ada1-v', 'cat-bo-o'];
    for (const id of ids) assert.equal(text.includes(id), false, `the payload names ${id}`);
  });

  let base;
  await t.test('confirming (with a corrected spelling) puts the base first, locked, in every round', async () => {
    const res = await admin('post', `/game-categories/${WING}`, {
      action: 'confirm', set: ['Vögel', 'Eier', 'Boni'], names: ['Vögel', 'Eier', 'Bonuskarten'],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.game.state, 'confirmed');
    assert.deepEqual(res.body.game.categories, ['Vögel', 'Eier', 'Bonuskarten']);

    const r1 = await roundAs(ada, a1.round.id);
    const g1 = r1.games.find((g) => g.id === a1.game.id);
    base = g1.scoreCategories.slice(0, 3);
    assert.deepEqual(base.map((c) => [c.name, c.locked]), [['Vögel', true], ['Eier', true], ['Bonuskarten', true]]);
    assert.equal(g1.scoreCategories.length, 3, 'every category of this round matched');
    assert.ok(base.every((c) => /^g[0-9a-f]{12}$/.test(c.id)), 'global ids');
    // The history shows under the confirmed names: the same values, global ids.
    const s1 = r1.sessions.find((s) => s.id === a1.session.id);
    assert.deepEqual(s1.scoreParts[a1.m1], { [base[0].id]: 40, [base[1].id]: 12, [base[2].id]: 7 });
    // …and so per-category records run over the global id.
    const records = gameCategoryRecords(r1, g1, deps).map((e) => [e.category.id, e.record.points]);
    assert.deepEqual(records, [[base[0].id, 40], [base[1].id, 12], [base[2].id, 7]]);

    // Bo's round: the base (gaining „Bonuskarten", empty), then its own extra.
    const rb = await roundAs(bo, b1.round.id);
    const gb = rb.games.find((g) => g.id === b1.game.id);
    assert.deepEqual(gb.scoreCategories.map((c) => c.id), [base[0].id, base[1].id, base[2].id, 'cat-bo-o']);
    assert.equal(gb.scoreCategoriesLocked, 3);
    assert.deepEqual(rb.sessions[0].scoreParts[b1.m1], { [base[0].id]: 30, [base[1].id]: 5, 'cat-bo-o': 9 });
  });

  await t.test('the confirmation writes nothing into any tenant', async () => {
    const stored = await repo.getGame(ada.user.tenantId, a1.round.id, a1.game.id);
    assert.deepEqual(stored.scoreCategories.map((c) => c.id), ['cat-ada1-v', 'cat-ada1-e', 'cat-ada1-b']);
    const session = await repo.getSession(ada.user.tenantId, a1.round.id, a1.session.id);
    assert.deepEqual(Object.keys(session.scoreParts[a1.m1]).sort(), ['cat-ada1-b', 'cat-ada1-e', 'cat-ada1-v']);
  });

  await t.test('a round cannot rename, remove or reorder a base category: 409, nothing stored', async () => {
    const rb = await roundAs(bo, b1.round.id);
    const list = rb.games.find((g) => g.id === b1.game.id).scoreCategories.map((c) => ({ id: c.id, name: c.name }));
    const renamed = list.map((c, i) => (i === 0 ? { ...c, name: 'Vogel' } : c));
    const removed = list.filter((_, i) => i !== 1);
    const reordered = [list[1], list[0], ...list.slice(2)];
    const above = [list[3], ...list.slice(0, 3)];
    for (const body of [renamed, removed, reordered, above]) {
      const res = await patchGame(bo, b1.round.id, b1.game.id, { scoreCategories: body });
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(res.body.error, 'scoring_categories_locked');
    }
    const dup = await patchGame(bo, b1.round.id, b1.game.id, { scoreCategories: [...list.slice(0, 3), { name: 'eier' }] });
    assert.equal(dup.status, 400, 'an extra may not take a base name');
    const stored = await repo.getGame(bo.user.tenantId, b1.round.id, b1.game.id);
    assert.deepEqual(stored.scoreCategories.map((c) => c.id), ['cat-bo-v', 'cat-bo-e', 'cat-bo-o']);
  });

  await t.test('extras still edit freely, and the stored list never takes a global id', async () => {
    const res = await patchGame(bo, b1.round.id, b1.game.id, {
      scoreCategories: [...base.map((c) => ({ id: c.id, name: c.name })), { id: 'cat-bo-o', name: 'Ozeanien-Vögel' }, { name: 'Nektar' }],
    });
    assert.equal(res.status, 200);
    const stored = await repo.getGame(bo.user.tenantId, b1.round.id, b1.game.id);
    const ids = stored.scoreCategories.map((c) => c.id);
    assert.equal(ids.some((id) => id.startsWith('g') && id.length === 13), false, 'no global id stored');
    assert.deepEqual(stored.scoreCategories.slice(0, 3).map((c) => c.name), ['Vögel', 'Eier', 'Ozeanien-Vögel']);
    const rb = await roundAs(bo, b1.round.id);
    assert.deepEqual(rb.games.find((g) => g.id === b1.game.id).scoreCategories.map((c) => c.name),
      ['Vögel', 'Eier', 'Bonuskarten', 'Ozeanien-Vögel', 'Nektar']);
  });

  await t.test('points arrive in the sheet ids and are stored in the round ids', async () => {
    const res = await request(app).put(`/api/rounds/${b1.round.id}/sessions/${b1.session.id}/scores`)
      .set('Authorization', `Bearer ${bo.token}`)
      .send({ scores: { [b1.m1]: 50 }, parts: { [b1.m1]: { [base[0].id]: 31, [base[2].id]: 10, 'cat-bo-o': 9 } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.scoreParts[b1.m1], { [base[0].id]: 31, [base[2].id]: 10, 'cat-bo-o': 9 }, 'answered in sheet ids');
    const stored = await repo.getSession(bo.user.tenantId, b1.round.id, b1.session.id);
    assert.deepEqual(stored.scoreParts[b1.m1], { 'cat-bo-v': 31, [base[2].id]: 10, 'cat-bo-o': 9 },
      'a matched base goes back to the local id; one the round never had keeps the global id');
    // A client still holding the pre-confirmation sheet sends local ids — accepted.
    const old = await request(app).put(`/api/rounds/${b1.round.id}/sessions/${b1.session.id}/scores`)
      .set('Authorization', `Bearer ${bo.token}`)
      .send({ scores: { [b1.m1]: 39 }, parts: { [b1.m1]: { 'cat-bo-v': 30, 'cat-bo-o': 9 } } });
    assert.equal(old.status, 200);
    const bad = await request(app).put(`/api/rounds/${b1.round.id}/sessions/${b1.session.id}/scores`)
      .set('Authorization', `Bearer ${bo.token}`)
      .send({ scores: { [b1.m1]: 1 }, parts: { [b1.m1]: { 'g000000000000': 1 } } });
    assert.equal(bad.status, 400, 'an unknown id is still refused');
  });

  await t.test('revoking restores every round sheet exactly', async () => {
    const res = await admin('post', `/game-categories/${WING}`, { action: 'revoke' });
    assert.equal(res.status, 200);
    assert.equal(res.body.game.state, 'open');
    assert.deepEqual(await roundAs(ada, a1.round.id), a1Before);
    const g2 = (await roundAs(ada, a2.round.id)).games.find((g) => g.id === a2.game.id);
    assert.deepEqual(g2.scoreCategories.map((c) => c.id), ['cat-ada2-v', 'cat-ada2-e', 'cat-ada2-b']);
    assert.equal('scoreCategoriesLocked' in g2, false);
    assert.equal((await admin('post', `/game-categories/${WING}`, { action: 'revoke' })).status, 409);
  });

  await t.test('„Zurückstellen" lasts until a new set (or round) appears', async () => {
    assert.equal((await admin('post', `/game-categories/${WING}`, { action: 'dismiss' })).body.game.state, 'dismissed');
    assert.deepEqual((await admin('get', '/game-categories?state=open')).body.games, []);
    // Ada changes a round's set: no new round, but a new set — open again.
    await patchGame(ada, a2.round.id, a2.game.id, { scoreCategories: [{ id: 'cat-ada2-v', name: 'Vögel' }] });
    const [entry] = (await admin('get', '/game-categories?state=open')).body.games;
    assert.equal(entry.state, 'open');
    assert.equal(entry.sets.length, 3);
  });

  await t.test('the CSV has one row per game × set, defused, and the copy text has no BOM', async () => {
    await seedRound(ada.user.tenantId, { bggId: '333444', title: 'Formel', cats: [{ id: 'cat-f', name: '=HYPERLINK("x")' }] });
    const confirm = await admin('post', '/game-categories/333444', { action: 'confirm', set: ['=HYPERLINK("x")'], names: ['=HYPERLINK("x")'] });
    assert.equal(confirm.status, 200);
    const csv = await admin('get', '/game-categories.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-disposition'], /spielwirbel-wertungskategorien-/);
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.equal(lines.length, 1 + 3 + 1, 'header, Flügelschlag × 3 sets, Formel × 1');
    assert.ok(lines.some((l) => l.startsWith('"333444","Formel","1","\'=HYPERLINK(""x"")","bestätigt","ja","20')), lines.join('\n'));
    const copy = await admin('get', '/game-categories.csv?state=confirmed&copy=1');
    assert.equal(copy.text.startsWith('\uFEFF'), false);
    assert.equal(copy.text.trim().split('\r\n').length, 2);
  });

  await t.test('unknown games, sets and bad bodies are refused', async () => {
    assert.equal((await admin('post', '/game-categories/999999', { action: 'dismiss' })).status, 404);
    assert.equal((await admin('post', '/game-categories/abc', { action: 'dismiss' })).status, 400);
    assert.equal((await admin('post', `/game-categories/${WING}`, { action: 'confirm', set: ['Nie'], names: ['Nie'] })).body.error, 'set_not_found');
    assert.equal((await admin('post', `/game-categories/${WING}`, {
      action: 'confirm', set: ['Vögel', 'Eier', 'Boni'], names: ['Vögel', 'Eier'],
    })).body.error, 'names_mismatch');
    assert.equal((await admin('post', `/game-categories/${WING}`, { action: 'confirm' })).status, 400);
  });
});
