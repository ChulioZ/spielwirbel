'use strict';

/*
 * A round with every id-bearing feature in use, built THROUGH THE REAL ROUTES
 * (#1756) — so the key set the import specs check is what the routes actually
 * write, not a hand-copied list of what someone remembered they write
 * (.claude/rules/shared-constants-across-the-stack.md: the copy nobody
 * remembers is the one that rots).
 *
 * `call(method, path)` returns a supertest request with whatever auth the spec
 * needs. Returns the round as GET /api/rounds/:rid answers it — the snapshot
 * the export writes into round.json.
 *
 * Sessions, by outcome: a logged evening, a direct pick with a guest + team +
 * points + category parts + duration + verdict, a drawn evening with votes and
 * an ending, a split whose two tables are still being played, an unfinished
 * draw, a cancelled draw, and a played evening someone was removed from.
 */

const { MEMBER_COLORS } = require('../../public/js/member-colors');
const { ENDINGS } = require('../../public/js/session-outcome');

async function buildRichRound(call, { name = 'Rich', members = ['Ann', 'Ben', 'Cid', 'Dee'] } = {}) {
  const ok = (res, label) => {
    if (res.status >= 400) throw new Error(`${label}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const round = ok(await call('post', '/api/rounds').send({ name, members, ownerSeat: false }), 'round');
  const rid = round.id;
  const [a, b, c, d] = round.members.map((m) => m.id);
  const api = (m, p) => call(m, `/api/rounds/${rid}${p}`);

  const tag = ok(await api('post', '/tags').send({ name: 'Family', icon: 'users' }), 'tag');
  const tag2 = ok(await api('post', '/tags').send({ name: 'Heavy' }), 'tag2');
  const g1 = ok(await api('post', '/games').send({
    title: 'Azul', minPlayers: 2, maxPlayers: 4, tagIds: [tag.id], ownerIds: [a],
    sourceProvider: 'bgg', sourceExternalId: '230802', sourceUrl: 'https://boardgamegeek.com/boardgame/230802',
    imageUrl: 'https://cf.geekdo-images.com/azul.jpg', pitch: 'Tiles!',
  }), 'g1');
  const g2 = ok(await api('post', '/games').send({ title: 'Brass', minPlayers: 2, maxPlayers: 4, tagIds: [tag2.id] }), 'g2');
  ok(await api('post', '/games').send({ title: 'Wished', minPlayers: 1, maxPlayers: 4, wish: true }), 'wish');
  ok(await api('post', '/games').send({ title: 'GuestBox', minPlayers: 2, maxPlayers: 6, guestGame: true }), 'guest game');
  const g5 = ok(await api('post', '/games').send({ title: 'Old', minPlayers: 2, maxPlayers: 4 }), 'g5');
  ok(await api('post', `/games/${g5.id}/retire`).send({}), 'retire');
  ok(await api('patch', `/games/${g2.id}`).send({
    playtimeOverride: { min: 60, max: 120 }, lowScoreWins: true,
    scoreCategories: [{ name: 'Coal' }, { name: 'Cards' }],
    purchasePrice: { amount: 5999, currency: 'EUR' },
  }), 'patch g2');
  ok(await api('put', `/games/${g1.id}/expansions`).send({ expansions: [{ title: 'Summer', minPlayers: 2, maxPlayers: 5 }] }), 'expansions');
  ok(await api('put', `/games/${g2.id}/loan`).send({ memberId: b, since: '2026-11-01' }), 'loan');
  ok(await api('patch', `/members/${d}`).send({ color: MEMBER_COLORS[2] }), 'colour');
  ok(await api('post', `/members/${c}/retire`).send({ retired: true }), 'retire member');
  ok(await api('post', '/filters').send({ name: 'Quick', tagIds: [tag.id], memberIds: [a, b] }), 'filter');
  ok(await api('patch', '/draw-boost').send({ on: true }), 'boost');
  ok(await api('post', '/challenge').send({ kind: 'wholeShelf', deadline: new Date(Date.now() + 20 * 864e5).toISOString() }), 'challenge');

  const s1 = ok(await api('post', '/sessions').send({
    memberIds: [a, b, d], gameId: g2.id, guests: [{ name: 'Gus', gameIds: [] }], teams: [{ memberIds: [a], guestIndices: [0] }],
  }), 's1').session;
  ok(await api('post', `/sessions/${s1.id}/finish`).send({ winnerIds: [a] }), 'finish s1');
  const cats = ok(await api('get', ''), 'read').games.find((g) => g.id === g2.id).scoreCategories;
  ok(await api('put', `/sessions/${s1.id}/scores`).send({
    scores: { [s1.teams[0].id]: 10, [b]: 7, [d]: 3 }, parts: { [b]: { [cats[0].id]: 4, [cats[1].id]: 3 } },
  }), 'scores');
  ok(await api('put', `/sessions/${s1.id}/duration`).send({ durationMinutes: 95 }), 'duration');
  ok(await api('put', `/sessions/${s1.id}/verdicts/${b}`).send({ gameId: g2.id, rating: 4 }), 'verdict');

  const s2 = ok(await api('post', '/sessions').send({ memberIds: [a, b], count: 2 }), 's2').session;
  const ballot = (r) => Object.fromEntries(s2.gameIds.map((g) => [g, { rating: r }]));
  ok(await api('post', `/sessions/${s2.id}/results`).send({ votes: { [a]: ballot(5), [b]: ballot(3) } }), 'results');
  ok(await api('post', `/sessions/${s2.id}/choice`).send({ gameId: s2.gameIds[0] }), 'choice');
  ok(await api('post', `/sessions/${s2.id}/finish`).send({ winnerIds: [], ending: ENDINGS[0] }), 'finish s2');

  ok(await api('post', '/sessions').send({
    memberIds: [a, d], gameId: g1.id, playedOn: '2026-10-10T18:00:00.000Z', dateOnly: true, durationMinutes: 30,
  }), 'logged');

  const s3 = ok(await api('post', '/sessions').send({
    memberIds: [a, b, d], count: 2, includeLent: true, multiTable: true, minTableSeats: 2, guests: ['Hal'],
  }), 's3').session;
  ok(await api('post', `/sessions/${s3.id}/results`).send({ votes: { [a]: { [s3.gameIds[0]]: { rating: 4 } } } }), 'votes s3');
  ok(await api('post', `/sessions/${s3.id}/split`).send({
    tables: [{ gameId: s3.gameIds[0], personIds: [a, b] }, { gameId: s3.gameIds[1], personIds: [d, s3.guests[0].id] }],
  }), 'split');

  ok(await api('post', '/sessions').send({ memberIds: [a, b], count: 1 }), 'unfinished');
  const s5 = ok(await api('post', '/sessions').send({ memberIds: [a, b], count: 1 }), 's5').session;
  ok(await api('post', `/sessions/${s5.id}/cancel`).send({}), 'cancel');
  const s6 = ok(await api('post', '/sessions').send({ memberIds: [a, b, d], gameId: g1.id }), 's6').session;
  ok(await api('delete', `/sessions/${s6.id}/people/${d}`), 'remove person');
  ok(await api('post', `/sessions/${s6.id}/finish`).send({ winnerIds: [b] }), 'finish s6');

  return ok(await api('get', ''), 'final read');
}

module.exports = { buildRichRound };
