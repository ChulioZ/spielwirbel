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
const repo = require('../lib/repo');
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

test('PUT expansions refuses a wished EXPANSION row — entries there die with the wish (#698)', async () => {
  // A row carrying `expansionOf` is itself an expansion; anything recorded on it
  // is silently lost when the wish is acquired (expansionEntryOf carries only
  // title/link/range, and acquireWishExpansion deletes the wish row in the same
  // transaction). Wish rows with `expansionOf` only ever come from the wishlist
  // import, so seed through the same bulk method (like test/wish-expansion.test.js).
  const round = await createRound(request);
  const r = repo.forTenant('default');
  const { created } = await r.createGames(round.id, [{
    title: 'Seefahrer', minPlayers: 5, maxPlayers: 6, image: null,
    source: { provider: 'bgg', externalId: '325', url: null },
    expansionOf: [{ providerId: '13', title: 'CATAN' }],
  }], undefined, null, true);

  const res = await request(app).put(PUT_EXP(round.id, created[0].id))
    .send({ expansions: [{ title: 'Verloren' }] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'is_expansion');

  // An ordinary wished GAME keeps the write: its row survives acquisition
  // (`/wish { wish: false }` just flips the flag), so its entries persist —
  // and owning an expansion before the base game is a real state.
  const plain = await r.createGames(round.id, [
    { title: 'Ark Nova', minPlayers: 1, maxPlayers: 4, image: null },
  ], undefined, null, true);
  const ok = await request(app).put(PUT_EXP(round.id, plain.created[0].id))
    .send({ expansions: [{ title: 'Aquarius' }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.expansions.map((e) => e.title), ['Aquarius']);
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

/* #1039 replaced the `.gd-expansions` page section with a chip on the card that
   opens the editor, and moved the owned rows into it. So the "does the round own
   anything" question is answered by the chip, and the entries are asserted inside
   the overlay.

   Since #1143 the editor is a centred list DIALOG at every width, so there is no
   `usesEditorSheet` stub here any more — which is also why every spec in this
   file is a check on that: `window.matchMedia` does not exist at all in this
   harness, so an editor still consulting the 860px split throws
   (`matchMedia is not a function`) rather than falling back to a sheet, and the
   whole file goes red. The explicit DESKTOP stub in the presentation spec at the
   bottom is the narrower guard — it is the one that distinguishes "took the
   split" from "took the anchored branch". */
const expansionsChip = (dom) => dom.app.querySelector('.gd-chips .tag--expansions');

async function openExpansions(dom, gameId) {
  await dom.call('showGameDetail', 'r1', gameId);
  const chip = expansionsChip(dom);
  assert.ok(chip, 'the expansions chip is not on the card');
  chip.click();
  const card = dom.document.querySelector('.editor--expansions');
  assert.ok(card, 'the expansions editor did not open');
  return card;
}

test('the chip counts the owned expansions, and they lead the list as TICKED rows', async (t) => {
  const { dom } = boot(t, EXP);
  const card = await openExpansions(dom, 'g1');

  assert.match(expansionsChip(dom).textContent, /2 Erweiterungen/, 'the chip states the count');

  const titles = [...card.querySelectorAll('.exp-row .ds-row__title')].map((el) => el.textContent);
  assert.deepEqual(titles, ['5–6 Spieler', 'Ohne Angabe']);
  /* Each row states what it UNLOCKS for THIS game — the base box here is 3–4,
     so the 5–6 expansion adds exactly those two counts, and one with no range
     says so rather than showing an interval it does not have. The three states
     and the arithmetic behind them belong to test/expansions-editor.test.js
     (#1144); this asserts only that the chip's list really carries the line. */
  const metas = [...card.querySelectorAll('.exp-row .ds-row__main .muted')].map((el) => el.textContent);
  assert.deepEqual(metas, ['Ermöglicht 5–6 Personen', 'Ohne Spielerzahl — erweitert nichts']);
  // Owned IS ticked (#1143): one list, one row shape, two states. The old editor
  // rendered these in a separate box with a „Entfernen" button apiece.
  const boxes = [...card.querySelectorAll('.exp-row input')];
  assert.deepEqual(boxes.map((b) => b.checked), [true, true]);
  assert.equal(card.querySelectorAll('.exp-row.ds-row--picked').length, 2, 'and reads as picked');
  assert.equal(card.querySelector('.exp-row__remove'), null,
    'removal is unticking now — a per-row remove button would be a second commit model');
});

test('owning none leaves a dashed chip as the way in, and the list is empty', async (t) => {
  const { dom } = boot(t, null);
  const card = await openExpansions(dom, 'g1');
  assert.ok(expansionsChip(dom).classList.contains('tag--empty'), 'the chip reads as unset');
  assert.match(expansionsChip(dom).textContent, /Erweiterung/);
  assert.equal(card.querySelectorAll('.exp-row').length, 0, 'nothing to tick');
  assert.ok(card.querySelector('.exp-own__name'), 'but still the way to add one');
  // Nothing to read and no provider to ask, so the one action on offer is not
  // hidden behind a disclosure over an empty box.
  assert.equal(card.querySelector('.exp-own').open, true);
});

test('a wished EXPANSION\'s own detail page offers no expansions affordance at all (#698)', async (t) => {
  const { dom, round } = boot(t, null);
  round.games.push({
    id: 'g3', title: 'Seefahrer', minPlayers: 5, maxPlayers: 6, tagIds: [], image: null,
    wish: true, expansionOf: [{ providerId: '13', title: 'CATAN' }],
  });
  await dom.call('showGameDetail', 'r1', 'g3');
  // The chip must be gone, not merely empty: an expansion holds no expansions of
  // its own. Anti-vacuous — the chip row itself has to be on screen, or this
  // would pass for a page that failed to render.
  assert.ok(dom.app.querySelector('.gd-chips'), 'the chip row rendered');
  assert.equal(expansionsChip(dom), null);
});

test('an ordinary WISHED game keeps the chip — its row survives acquisition', async (t) => {
  // The anti-vacuous control for the spec above: the condition is the presence
  // of `expansionOf`, never `wish` itself.
  const { dom, round } = boot(t, null);
  round.games.push({
    id: 'g4', title: 'Ark Nova', minPlayers: 1, maxPlayers: 4, tagIds: [], image: null,
    wish: true,
  });
  await dom.call('showGameDetail', 'r1', 'g4');
  assert.ok(expansionsChip(dom), 'the chip renders');
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

  // #915 removed the „Gespielt wird:" banner this note used to hang under, #1056
  // the chosen row's own panel — it now rides the table band (#1057), which IS
  // the box it is about.
  const note = dom.app.querySelector('.tisch .tisch__note--warn');
  assert.ok(note, 'the table band carries the warning');
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
  // The anti-vacuous half: a screen that failed to render also carries no note,
  // so pin the note's host — the table band — as present first.
  const band = dom.app.querySelector('.tisch');
  assert.ok(band && !band.hidden, 'the table band rendered');
  assert.equal(dom.app.querySelector('.tisch__note--warn'), null, 'and says nothing about a box');
});

/* The candidate rows repeat the base title BGG puts in front of every expansion
   name, which on a 312px phone row is a third of the line spent on the word in
   the page's own <h1>. Trimmed for display only (#1142) — what is stored is the
   provider's title, resolved server-side from the id the PUT sends, so the
   second half of this spec is what keeps the trim cosmetic. */
test('a candidate repeating the base title renders trimmed, and still stores the provider id', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture(null);
  round.games[0].title = 'Carcassonne';
  round.games[0].source = { provider: 'bgg', externalId: '822' };
  round.providers = ['bgg'];
  const puts = [];
  dom.set('api', async (method, url, body) => {
    if (/\/activities$/.test(url)) return [];
    if (/\/lookup\/expansions/.test(url)) {
      return { expansions: [
        { providerId: '1', title: 'Carcassonne: Erweiterung 1 – Wirtshäuser und Kathedralen' },
        { providerId: '2', title: 'Carcassonne - Die Jäger und Sammler' },
        // No separator, so it is a different GAME rather than a suffix — „Das
        // Würfelspiel" alone would name the wrong box on the shelf.
        { providerId: '3', title: 'Carcassonne Das Würfelspiel' },
        // Nothing to trim at all.
        { providerId: '4', title: 'Die Burg' },
      ] };
    }
    if (method === 'PUT') { puts.push(body); return { ...round.games[0], expansions: [] }; }
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    return {};
  });
  dom.set('isLoggedIn', () => false);

  await dom.call('showGameDetail', 'r1', 'g1');
  dom.app.querySelector('.gd-chips .tag--expansions').click();
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

  const card = dom.document.querySelector('.editor--expansions');
  const rows = [...card.querySelectorAll('.exp-row .ds-row__title')].map((el) => el.textContent);
  assert.deepEqual(rows, [
    'Erweiterung 1 – Wirtshäuser und Kathedralen',
    'Die Jäger und Sammler',
    'Carcassonne Das Würfelspiel',
    'Die Burg',
  ]);

  // Ticking the trimmed row still sends the id, so the server resolves the
  // provider's own full title — the trim never reaches the stored data.
  card.querySelectorAll('.exp-row input')[0].click();
  card.querySelector('.btn--primary').click();
  await new Promise((r) => setTimeout(r, 0));
  // Compared field by field: the bodies are built in the jsdom realm, so a
  // strict deepEqual against a literal fails on the prototype rather than the
  // data.
  assert.equal(puts.length, 1, 'one PUT');
  assert.deepEqual([...puts[0].expansions].map((e) => ({ ...e })), [{ providerId: '1' }]);
});
