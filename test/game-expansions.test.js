'use strict';

/* The expansions a round owns for a game (#653): the write route, and the one
   thing the whole feature exists for — an owned expansion making its game
   drawable at a table the base box cannot seat.

   Its own file rather than a section of test/games.test.js: expansions are a
   self-contained concern with their own route and their own fixtures, and
   folding them in pushed that file past the 700-line budget
   (.claude/rules/token-friendly-source-files.md). The PREDICATE itself is
   test/draw-pool.test.js's job; this covers what the route may trust. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { fitsPlayerCount } = require('../public/js/draw-pool');

// Add a game via the multipart endpoint, like test/games.test.js does.
async function addGame(rid, fields = {}) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  const all = { title: 'Chess', minPlayers: '2', maxPlayers: '4', ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, String(v));
  return req;
}

const PUT_EXP = (rid, gid) => `/api/rounds/${rid}/games/${gid}/expansions`;

// One /thing?id=a,b body — what expansionDetails() resolves a batch of ticks
// against. Ids are unique per spec because lib/provider-cache is shared.
const expXml = (...items) => `<items>${items.map(([id, title, min, max]) => `<item type="boardgameexpansion" id="${id}">`
  + `<name type="primary" value="${title}"/>`
  + `<minplayers value="${min}"/><maxplayers value="${max}"/></item>`).join('')}</items>`;

const realFetch = global.fetch;
const withBgg = async (xml, fn) => {
  const token = process.env.BGG_API_TOKEN;
  const calls = [];
  process.env.BGG_API_TOKEN = 'test-token';
  global.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => xml }; };
  try {
    return await fn(calls);
  } finally {
    global.fetch = realFetch;
    if (token === undefined) delete process.env.BGG_API_TOKEN;
    else process.env.BGG_API_TOKEN = token;
  }
};

test('PUT expansions stores a hand-typed entry and widens the player range by UNION', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id, { title: 'Catan', minPlayers: '3', maxPlayers: '4' })).body;

  const res = await request(app).put(PUT_EXP(round.id, game.id)).send({
    expansions: [{ title: '5–6 Spieler', minPlayers: 5, maxPlayers: 6 }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.expansions.length, 1);
  assert.equal(res.body.expansions[0].title, '5–6 Spieler');
  assert.equal(res.body.expansions[0].source, null);
  assert.match(res.body.expansions[0].id, /^[0-9a-f]{16}$/);

  // The point of the whole feature: the six-person session can now draw it.

  const stored = (await request(app).get(`/api/rounds/${round.id}`)).body.games[0];
  assert.equal(fitsPlayerCount(stored, 6), true);
  assert.equal(fitsPlayerCount(stored, 2), false, 'and the base minimum still binds');

  const feed = await request(app).get(`/api/rounds/${round.id}/activities`);
  const acts = feed.body.filter((a) => a.type === 'game_expansion_added');
  assert.equal(acts.length, 1);
  assert.equal(acts[0].count, 1);
});

test('PUT expansions refuses a half-declared range and a missing title', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const only = (body) => request(app).put(PUT_EXP(round.id, game.id)).send(body);

  // A lone bound states no interval — accepting it would open one end silently.
  assert.equal((await only({ expansions: [{ title: 'X', minPlayers: 5 }] })).status, 400);
  assert.equal((await only({ expansions: [{ title: 'X', maxPlayers: 6 }] })).status, 400);
  assert.equal((await only({ expansions: [{ title: 'X', minPlayers: 6, maxPlayers: 5 }] })).status, 400);
  assert.equal((await only({ expansions: [{ minPlayers: 5, maxPlayers: 6 }] })).status, 400, 'no title');
  assert.equal((await only({ expansions: [{ title: 'y'.repeat(121) }] })).status, 400, 'over the shared max');
  // Both bounds absent is the legitimate "I don't know" — it just widens nothing.
  const vague = await only({ expansions: [{ title: 'Unbekannt' }] });
  assert.equal(vague.status, 200);
  assert.equal(vague.body.expansions[0].minPlayers, null);
});

test('PUT expansions resolves ticked provider ids server-side, in ONE request', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id, {
    title: 'Catan', sourceProvider: 'bgg', sourceExternalId: 'g900',
    sourceUrl: 'https://boardgamegeek.com/boardgame/g900',
  })).body;

  await withBgg(expXml(['901', 'Seafarers', '3', '6'], ['902', 'Cities', '3', '4']), async (calls) => {
    const res = await request(app).put(PUT_EXP(round.id, game.id)).send({
      expansions: [
        // The title and the range in the body are LIES — the server must ignore
        // both and take the provider's, exactly like the collection import.
        { providerId: '901', title: 'Getippt', minPlayers: 1, maxPlayers: 99 },
        { providerId: '902' },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1, 'both ids resolved in one batched /thing call');
    assert.equal(new URL(calls[0]).searchParams.get('id'), '901,902');
    assert.deepEqual(res.body.expansions.map((e) => e.title), ['Seafarers', 'Cities']);
    assert.equal(res.body.expansions[0].maxPlayers, 6, 'the provider’s range, not the body’s');
    assert.equal(res.body.expansions[0].source.provider, 'bgg');
    assert.equal(res.body.expansions[0].source.externalId, '901');
  });
});

test('a stored expansion is kept verbatim by id, and dropped by omission', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const first = (await request(app).put(PUT_EXP(round.id, game.id)).send({
    expansions: [{ title: 'Behalten', minPlayers: 2, maxPlayers: 5 }, { title: 'Weg' }],
  })).body;
  const keep = first.expansions[0];

  const res = await request(app).put(PUT_EXP(round.id, game.id)).send({
    // A rewritten title must NOT take: a stored entry is immutable, which is
    // what keeps a provider's own name from being edited under its licence.
    expansions: [{ id: keep.id, title: 'Umbenannt', minPlayers: 1, maxPlayers: 9 }],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.expansions.map((e) => e.title), ['Behalten']);
  assert.equal(res.body.expansions[0].maxPlayers, 5, 'its range is untouched too');
  assert.equal(res.body.expansions[0].id, keep.id);

  // Re-saving the same set adds nothing, so it writes no second Chronik row.
  const feed = await request(app).get(`/api/rounds/${round.id}/activities`);
  assert.equal(feed.body.filter((a) => a.type === 'game_expansion_added').length, 1);
});

test('a repeated id is kept once — a stored list must never hold one id twice', async () => {
  // The UI cannot produce this; a hand-rolled request can. Two entries with one
  // id would make removing either ambiguous and break the uniqueness the
  // operator's expansion redaction relies on (it locates an entry by id alone
  // across the whole shelf — see .claude/rules/expansions-widen-by-union.md).
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  const first = (await request(app).put(PUT_EXP(round.id, game.id))
    .send({ expansions: [{ title: 'Seefahrer' }] })).body;
  const kept = first.expansions[0];

  const res = await request(app).put(PUT_EXP(round.id, game.id))
    .send({ expansions: [{ id: kept.id }, { id: kept.id }, { id: kept.id }] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.expansions.map((e) => e.id), [kept.id]);

  // And it really is the stored state, not just the response.
  const stored = (await request(app).get(`/api/rounds/${round.id}`)).body.games[0];
  assert.equal(stored.expansions.length, 1);
});

test('PUT expansions 404s for an unknown round or game and clears with an empty list', async () => {
  const round = await createRound(request);
  const game = (await addGame(round.id)).body;
  assert.equal((await request(app).put(PUT_EXP('nope', game.id)).send({ expansions: [] })).status, 404);
  assert.equal((await request(app).put(PUT_EXP(round.id, 'nope')).send({ expansions: [] })).status, 404);

  await request(app).put(PUT_EXP(round.id, game.id)).send({ expansions: [{ title: 'A' }] });
  const cleared = await request(app).put(PUT_EXP(round.id, game.id)).send({ expansions: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.expansions, []);
});

/* ------------------------- the rendered surfaces ---------------------------
   Run the real views under jsdom rather than matching their source
   (.claude/rules/testing-views-under-jsdom.md): what the acceptance criteria
   ask about — a badge that is absent at zero, a chip that states the widening,
   a warning that names the right expansion — are properties of the DOM the
   view builds, and a regex cannot see any of them. */

const { loadApp } = require('./support/dom');

const EXP = [
  { id: 'x1', title: '5–6 Spieler', source: null, minPlayers: 5, maxPlayers: 6, addedAt: '2026-08-01T10:00:00.000Z' },
  { id: 'x2', title: 'Ohne Angabe', source: null, minPlayers: null, maxPlayers: null, addedAt: '2026-08-01T10:00:00.000Z' },
];

function roundFixture(expansions) {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [
      { id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Cleo' }, { id: 'm4', name: 'Dana' }, { id: 'm5', name: 'Eli' },
    ],
    games: [
      // Catan: a 3–4 box the round owns a 5–6 expansion for.
      { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [], image: null, ...(expansions ? { expansions } : {}) },
      { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [], image: null },
    ],
    sessions: [],
  };
}

function boot(t, expansions) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture(expansions);
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    return {};
  });
  dom.set('isLoggedIn', () => false);
  return { dom, round };
}

test('the detail page lists the owned expansions, with and without a range', async (t) => {
  const { dom } = boot(t, EXP);
  await dom.call('showGameDetail', 'r1', 'g1');

  const titles = [...dom.app.querySelectorAll('.gd-expansions .ds-row__title')].map((el) => el.textContent);
  assert.deepEqual(titles, ['5–6 Spieler', 'Ohne Angabe']);
  // An expansion whose player count nobody knows says so, rather than showing
  // a range it does not have.
  const metas = [...dom.app.querySelectorAll('.gd-expansions .ds-row__main .muted')].map((el) => el.textContent);
  assert.deepEqual(metas, ['5–6 Personen', 'ohne Spielerzahl']);
  assert.equal(dom.app.querySelectorAll('.gd-expansions .exp-row__remove').length, 2);
  assert.ok(dom.app.querySelector('.gd-expansions button.link-out'), 'and a way to add one');
});

test('an empty section still offers the way in', async (t) => {
  const { dom } = boot(t, null);
  await dom.call('showGameDetail', 'r1', 'g1');
  assert.equal(dom.app.querySelectorAll('.gd-expansions .ds-row').length, 0);
  assert.match(dom.app.querySelector('.gd-expansions .muted').textContent, /Noch keine Erweiterung/);
});

test('the players chip states the widening — and says nothing without one', async (t) => {
  const { dom } = boot(t, EXP);
  await dom.call('showGameDetail', 'r1', 'g1');
  const chip = dom.app.querySelector('.tag--players');
  assert.match(chip.textContent, /3–4 Personen/, 'the base box still leads');
  assert.match(chip.textContent, /mit Erweiterung bis 6/);

  // An expansion with no numbers widens nothing, so a game owning only that one
  // must read exactly as it did before.
  const plain = boot(t, [EXP[1]]);
  await plain.dom.call('showGameDetail', 'r1', 'g1');
  assert.equal(plain.dom.app.querySelector('.tag--players').textContent.trim(), '3–4 Personen');
});

test('the Regal card badges the count, and shows nothing at zero', async (t) => {
  const { dom, round } = boot(t, EXP);
  await dom.call('showRound', 'r1', 'regal');

  const cards = [...dom.app.querySelectorAll('.game-card')];
  assert.equal(cards.length, 2, 'fixture sanity: both games are on the shelf');
  const byTitle = (title) => cards.find((c) => c.querySelector('.game-card__title').textContent === title);
  assert.equal(byTitle('Catan').querySelector('.exp-pill').textContent, '+2');
  assert.equal(byTitle('Azul').querySelector('.exp-pill'), null, 'no badge on a plain base box');
  assert.equal(round.games[1].expansions, undefined, 'and the fixture really has none');
});

test('the results screen names the expansion the table actually needs', async (t) => {
  const { dom, round } = boot(t, EXP);
  // Five people at the table: the 3–4 base box does not seat them, only the
  // 5–6 expansion does — which is exactly what has to be said out loud.
  const session = {
    id: 's1', createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1'], memberIds: round.members.map((m) => m.id),
    votes: {}, votedIds: [], done: true, finished: false, cancelled: false,
    winnerIds: [], chosenGameId: 'g1', events: [],
  };
  round.sessions = [session];
  await dom.call('showResults', round, session);

  const note = dom.app.querySelector('.chosen-banner__note');
  assert.ok(note, 'the banner carries the warning');
  assert.match(note.textContent, /Braucht Erweiterung: 5–6 Spieler/);
  // And it must NOT name the expansion that admits nothing.
  assert.doesNotMatch(note.textContent, /Ohne Angabe/);
});

test('… and says nothing when the base box already seats the table', async (t) => {
  const { dom, round } = boot(t, EXP);
  const session = {
    id: 's2', createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1'], memberIds: ['m1', 'm2', 'm3'], // three people: 3–4 fits
    votes: {}, votedIds: [], done: true, finished: false, cancelled: false,
    winnerIds: [], chosenGameId: 'g1', events: [],
  };
  round.sessions = [session];
  await dom.call('showResults', round, session);
  assert.ok(dom.app.querySelector('.chosen-banner.is-set'), 'the banner is there');
  assert.equal(dom.app.querySelector('.chosen-banner__note'), null);
});
