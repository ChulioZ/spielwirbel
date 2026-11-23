'use strict';

/*
 * Importing a round from its data export (#1756), in legacy (accounts-off)
 * mode. The cross-account half — an export from one account imported into
 * another, the quotas and the admin figure — is test/round-import-accounts.test.js.
 *
 * The fixture is built through the real routes (test/support/rich-round.js), so
 * the two guards that "cannot fall behind" are about what the routes WRITE:
 *   - every stored key is either carried by lib/round-import.js or named in its
 *     DROPPED with a reason;
 *   - no source id survives, and every id the imported round references
 *     resolves inside it.
 *
 * Named for what it covers; `ls test/round-import*` showed no collision
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const { buildRichRound } = require('./support/rich-round');
const {
  buildRoundImport, ROUND_FIELDS, MEMBER_FIELDS, GAME_FIELDS, SESSION_FIELDS, DROPPED,
} = require('../lib/round-import');
const { withRoundExportMarker, ROUND_EXPORT_FORMAT_VERSION } = require('../public/js/round-import-file');
const { sessionOutcome } = require('../public/js/session-outcome');
const { playCounts } = require('../public/js/vote-score');

const call = (method, path) => request(app)[method](path);
const importFile = (file) => request(app).post('/api/rounds/import').send(file);

let source;
const sourceRound = async () => {
  if (!source) source = await buildRichRound(call);
  return structuredClone(source);
};

// Every id DEFINED anywhere in a round (any object's `id`, except importRef's).
function definedIds(node, into = new Set()) {
  if (Array.isArray(node)) node.forEach((v) => definedIds(v, into));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'importRef') continue;
      if (k === 'id' && typeof v === 'string') into.add(v);
      else definedIds(v, into);
    }
  }
  return into;
}

// Every string VALUE and object KEY in the tree.
function allTokens(node, into = []) {
  if (typeof node === 'string') into.push(node);
  else if (Array.isArray(node)) node.forEach((v) => allTokens(v, into));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { into.push(k); allTokens(v, into); }
  }
  return into;
}

// Ids are 16 hex (12 for scoring categories) — anything shaped like one is a reference.
const ID_SHAPE = /^[0-9a-f]{12}(?:[0-9a-f]{4})?$/;

test('every key the routes store is either carried or dropped with a reason', async () => {
  const round = await sourceRound();
  const classified = (entity, fields) => new Set([...fields, ...Object.keys(DROPPED[entity])]);
  const unclassified = (entity, fields, rows) => {
    const known = classified(entity, fields);
    return [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !known.has(k));
  };
  // `name` is the one round key the translator reads on its own.
  assert.deepEqual(unclassified('round', [...ROUND_FIELDS, 'name'], [round]), []);
  assert.deepEqual(unclassified('member', MEMBER_FIELDS, round.members), []);
  assert.deepEqual(unclassified('game', GAME_FIELDS, round.games), []);
  assert.deepEqual(unclassified('session', SESSION_FIELDS, round.sessions), []);
  // Anti-vacuous: the fixture really exercises the shapes the lists are about.
  assert.ok(round.sessions.length >= 9 && round.games.length >= 5, 'the fixture is the rich one');
});

test('an import re-mints every id, and every reference resolves inside the new round', async () => {
  const src = await sourceRound();
  const res = await importFile(withRoundExportMarker(src, new Date()));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const imported = res.body.round;

  const old = definedIds(src);
  old.add(src.id);
  const leaked = allTokens(imported).filter((tk) => old.has(tk));
  assert.deepEqual(leaked, [], 'no source id survives, as a value or as a key');

  const fresh = definedIds(imported);
  const dangling = allTokens(imported).filter((tk) => ID_SHAPE.test(tk) && !fresh.has(tk) && tk !== imported.id);
  assert.deepEqual(dangling, [], 'every id-shaped reference names something in the new round');
  // Anti-vacuous: references were actually there to check.
  assert.ok(allTokens(imported).filter((tk) => ID_SHAPE.test(tk)).length > 50);
});

test('the imported round carries the same history — the shelf counts match the source', async () => {
  const src = await sourceRound();
  const { round } = (await importFile(src)).body;
  // Open sessions go, and so does the split whose tables are all still open.
  const open = new Set(src.sessions.filter((s) => sessionOutcome(s) === 'open').map((s) => s.id));
  const kept = src.sessions.filter((s) => !open.has(s.id)
    && !((s.childSessionIds || []).length && s.childSessionIds.every((c) => open.has(c))));
  assert.equal(round.sessions.length, kept.length);

  // Through the shared function the Regal and the recommender read, keyed by
  // title so the two rounds' different ids compare.
  const byTitle = (r) => {
    const counts = playCounts(r);
    return Object.fromEntries(r.games.map((g) => [g.title, counts.get(g.id) || 0]));
  };
  const keptRound = { ...src, sessions: kept };
  assert.deepEqual(byTitle(round), byTitle(keptRound));
  assert.ok(Object.values(byTitle(round)).some((n) => n > 0), 'something was played');

  // Session by session, the content is the source's with ids translated.
  const map = new Map();
  src.members.forEach((m, i) => map.set(m.id, round.members[i].id));
  src.games.forEach((g, i) => map.set(g.id, round.games[i].id));
  const played = (r) => r.sessions.filter((s) => s.finished).map((s) => ({
    chosen: r.games.find((g) => g.id === s.chosenGameId).title,
    winners: (s.winnerIds || []).map((w) => (r.members.find((m) => m.id === w) || {}).name).sort(),
    scores: Object.values(s.scores || {}).sort(),
    ending: s.ending || null,
    createdAt: s.createdAt,
  }));
  assert.deepEqual(played(round), played(keptRound));
});

test('importing one file twice gives two independent rounds', async () => {
  const src = await sourceRound();
  const a = (await importFile(src)).body.round;
  const b = (await importFile(src)).body.round;
  assert.notEqual(a.id, b.id);
  const ia = definedIds(a);
  assert.deepEqual([...definedIds(b)].filter((x) => ia.has(x)), []);
  const list = (await call('get', '/api/rounds')).body;
  assert.ok(list.some((r) => r.id === a.id) && list.some((r) => r.id === b.id));
});

test('unfinished sessions are skipped and counted — including a split nobody finished', async () => {
  const src = await sourceRound();
  const res = await importFile(src);
  const open = src.sessions.filter((s) => sessionOutcome(s) === 'open').length;
  // The split parent is not open itself; it goes because both its tables are.
  const parent = src.sessions.find((s) => (s.childSessionIds || []).length);
  assert.ok(parent && sessionOutcome(parent) === 'split');
  assert.equal(res.body.report.skippedSessions, open + 1);
  assert.equal(res.body.report.sessions, src.sessions.length - open - 1);
  assert.ok(res.body.round.sessions.every((s) => sessionOutcome(s) !== 'open'));
  assert.ok(res.body.round.sessions.every((s) => !s.childSessionIds && !s.parentSessionId));
});

test('a split whose tables were played arrives whole, with its links remapped', () => {
  const ids = ['p', 'c1', 'c2'];
  let n = 0;
  const file = {
    id: 'r', name: 'R', members: [{ id: 'm', name: 'M' }], games: [{ id: 'g', title: 'G' }],
    sessions: [
      { id: 'p', childSessionIds: ['c1', 'c2'], finished: false, memberIds: ['m'] },
      { id: 'c1', parentSessionId: 'p', finished: true, chosenGameId: 'g' },
      { id: 'c2', parentSessionId: 'p', finished: false },
    ],
  };
  const built = buildRoundImport(file, () => `new${n++}`);
  assert.equal(built.sessions.length, 2, 'the parent and its played table; the open table is skipped');
  const [p, c1] = built.sessions;
  assert.ok(!ids.includes(p.id));
  assert.deepEqual(p.childSessionIds, [c1.id]);
  assert.equal(c1.parentSessionId, p.id);
  assert.equal(built.report.skippedSessions, 1);
});

test('nothing that grants access or links an account survives', async () => {
  const src = await sourceRound();
  src.members[0].userId = 'someone-elses-account';
  src.games[1].image = '/uploads/0123456789abcdef';
  src.games[2].image = 'https://evil.example/x.jpg';
  src.games[0].source.url = 'javascript:alert(1)';
  src.sessions.find((s) => s.finished).photo = '/uploads/fedcba9876543210';
  src.background = { type: 'collage', image: '/uploads/aaaaaaaaaaaaaaaa' };
  src.shared = true;
  src.role = 'editor';
  src.members[1].color = 'red;background:url(x)';
  src.tags[0].icon = 'x" onclick="y';
  src.games[0].pitch = 'one\ntwo';
  src.games[0].somethingNew = 'unknown key';
  src.sessions[0].alsoNew = 1;

  const res = await importFile(src);
  assert.equal(res.status, 201);
  const { round, report } = res.body;
  const text = JSON.stringify(round);
  assert.doesNotMatch(text, /\/uploads\//, 'no upload path anywhere');
  assert.doesNotMatch(text, /someone-elses-account|javascript:|evil\.example|onclick|url\(x\)/);
  assert.ok(round.members.every((m) => !('userId' in m)), 'every seat arrives unlinked');
  assert.equal(round.shared, undefined);
  assert.equal(round.role, undefined);
  assert.equal(round.background, null);
  assert.equal(round.games[0].source.url, null);
  assert.equal(round.games[0].image, src.games[0].image, 'a provider hotlink is kept');
  assert.equal(round.games[1].image, null);
  assert.equal(round.games[0].pitch, undefined, 'an invalid pitch is dropped, not stored');
  assert.equal(round.games[0].somethingNew, undefined);
  assert.equal(round.sessions.some((s) => 'alsoNew' in s), false);
  assert.equal(report.droppedImages, 3, 'two covers and one photo');
});

test('a #1702-era file without the marker still imports; a newer or foreign one is refused', async () => {
  const src = await sourceRound();
  assert.equal((await importFile(src)).status, 201, 'no marker reads as version 1');
  assert.equal((await importFile(withRoundExportMarker(src, new Date()))).status, 201);

  const newer = { ...withRoundExportMarker(src, new Date()), formatVersion: ROUND_EXPORT_FORMAT_VERSION + 1 };
  const r1 = await importFile(newer);
  assert.equal(r1.status, 400);
  assert.equal(r1.body.error, 'newer_format');

  for (const bad of [{ ...src, format: 'something-else' }, { name: 'x' }, [], { ...src, games: 'nope' }]) {
    const r = await importFile(bad);
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60));
    assert.equal(r.body.error, 'not_a_round');
  }
  // The round's shape, but a member with no name.
  const r2 = await importFile({ ...src, members: [{ id: 'x' }] });
  assert.equal(r2.status, 400);
  assert.equal(r2.body.error, 'invalid');
});

test('a body far above the global 100 KB parses; one above the import limit is a 413', async () => {
  const src = await sourceRound();
  const big = { ...src, games: [...src.games] };
  for (let i = 0; i < 500; i += 1) big.games.push({ id: `g${i}`, title: `Game ${i} ${'x'.repeat(450)}` });
  assert.ok(JSON.stringify(big).length > 200 * 1024);
  assert.equal((await importFile(big)).status, 201);

  const huge = { ...src, name: 'x'.repeat(9 * 1024 * 1024) };
  assert.equal((await importFile(huge)).status, 413);
});

test('the round snapshot never carries the import provenance', async () => {
  const { round } = (await importFile(await sourceRound())).body;
  assert.equal(round.importedFrom, undefined);
  const read = (await call('get', `/api/rounds/${round.id}`)).body;
  assert.equal(read.importedFrom, undefined);
});

test('the Chronik records the import, and only that — no per-game entries', async () => {
  const { round, report } = (await importFile(await sourceRound())).body;
  const res = await call('get', `/api/rounds/${round.id}/activities`);
  const list = res.body.activities || res.body;
  assert.equal(list.length, 1);
  assert.equal(list[0].type, 'round_imported');
  assert.equal(list[0].games, round.games.length);
  assert.equal(list[0].sessions, report.sessions);
});

test('the marker is the source\'s, else its retired design\'s, else hashed from the NEW id', () => {
  const { markerIndexFromId, LEGACY_MARKER_INDEX } = require('../public/js/round-marker');
  const base = { id: 'src', name: 'R', members: [], games: [], sessions: [] };
  let n = 0;
  const mint = () => `fresh${n++}`;
  assert.equal(buildRoundImport({ ...base, marker: 5 }, mint).round.marker, 5);
  const [design, index] = Object.entries(LEGACY_MARKER_INDEX)[1];
  assert.equal(buildRoundImport({ ...base, background: { type: 'theme', id: design } }, mint).round.marker, index);
  const built = buildRoundImport(base, mint);
  assert.equal(built.round.marker, markerIndexFromId(built.round.id), 'the minted id, never the file\'s');
});
