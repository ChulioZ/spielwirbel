'use strict';

/*
 * The session activity log (#209).
 *
 * Per-device voting made a session's history ambiguous: the owner may hot-seat
 * two people, a third votes from their own device, a fourth is hot-seated on
 * THAT person's device, and any participant can end the voting for everyone.
 * The log is what makes that readable afterwards — so the assertions that matter
 * are about ATTRIBUTION (whose column, submitted by whom) rather than about the
 * list being non-empty.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const { SESSION_EVENTS, SESSION_LOG_MAX, sessionLogLines } = require('../public/js/session-log');
const { sessionEvent, pushSessionEvents } = require('../lib/session-events');

// ------------------------------------------------------------ the pure builder

// A stand-in for t(): renders "key(a=1,b=2)" so an assertion can name the key
// AND the values without depending on either language's wording.
const t = (key, params) => {
  const p = Object.entries(params || {}).map(([k, v]) => `${k}=${v}`).join(',');
  return p ? `${key}(${p})` : key;
};
const lines = (events, over = {}) =>
  sessionLogLines({ events }, {
    name: (id) => ({ m1: 'Anna', m2: 'Ben', g1: 'Dana (Gast)' })[id] || null,
    title: (gid) => ({ gm1: 'Catan' })[gid] || null,
    t,
    ...over,
  }).map((l) => l.text);

test('a vote on your own seat reads as your own', () => {
  assert.deepEqual(
    lines([{ at: 't', type: 'voted', actor: 'm1', personId: 'm1' }]),
    ['log.votedSelf(name=Anna)']
  );
});

// The distinction the whole log exists for.
test('a vote submitted for someone else names both people', () => {
  assert.deepEqual(
    lines([{ at: 't', type: 'voted', actor: 'm1', personId: 'm2' }]),
    ['log.votedFor(actor=Anna,name=Ben)']
  );
});

// A password-only instance carries no account on any request, so there is
// nobody to attribute to — and "Anna voted" is the honest reading there.
test('with no actor a vote reads as the person having voted', () => {
  assert.deepEqual(
    lines([{ at: 't', type: 'voted', personId: 'm2' }]),
    ['log.votedSelf(name=Ben)']
  );
});

test('a guest is named with their guest marker', () => {
  assert.deepEqual(
    lines([{ at: 't', type: 'voted', actor: 'm1', personId: 'g1' }]),
    ['log.votedFor(actor=Anna,name=Dana (Gast))']
  );
});

// A member deleted since must not make the line vanish — a silently shorter
// history is worse than one with a placeholder in it.
test('a deleted person or game degrades to a placeholder, never to a missing line', () => {
  assert.deepEqual(
    lines([
      // The realistic case: the seat that was voted for has since been removed
      // from the round, while the account that submitted it is still seated.
      { at: 't', type: 'voted', actor: 'm1', personId: 'gone' },
      { at: 't', type: 'game_chosen', actor: 'm1', gameId: 'deleted' },
      // Degenerate but still a line: nothing about it resolves any more, and a
      // vanished row would silently shorten the history.
      { at: 't', type: 'voted', actor: 'gone', personId: 'alsogone' },
    ]),
    // Newest first, so this reads bottom-up against the input above.
    [
      'log.votedFor(actor=log.someone,name=log.someone)',
      'log.chose(actor=Anna,game=log.aGame)',
      'log.votedFor(actor=Anna,name=log.someone)',
    ]
  );
});

test('every declared event type renders a line', () => {
  const events = Object.keys(SESSION_EVENTS).map((type) => ({ at: 't', type, actor: 'm1', personId: 'm1', gameId: 'gm1' }));
  const out = lines(events);
  assert.equal(out.length, Object.keys(SESSION_EVENTS).length);
  assert.equal(out.some((x) => x === '' || x.includes('undefined')), false, out.join(' | '));
});

// The silent half of client/server drift: a type the renderer has no phrase for
// would simply not appear, with no error anywhere.
// Newest first: the log is consulted to answer "what just happened", and on a
// running session the newest line is the one the reader is waiting for. Stored
// order stays append-order — the cap depends on it — so this is a display
// concern and belongs in the builder.
test('lines come back newest first', () => {
  assert.deepEqual(
    lines([
      { at: '2026-08-02T18:00:00.000Z', type: 'started', actor: 'm1' },
      { at: '2026-08-02T18:05:00.000Z', type: 'voted', actor: 'm1', personId: 'm1' },
      { at: '2026-08-02T18:09:00.000Z', type: 'voting_closed', actor: 'm2' },
    ]),
    ['log.closed(actor=Ben)', 'log.votedSelf(name=Anna)', 'log.started(actor=Anna)']
  );
});

test('an unknown event type is dropped rather than rendered blank', () => {
  assert.deepEqual(lines([{ at: 't', type: 'teleported', actor: 'm1' }]), []);
});

// ------------------------------------------------------------ the writer

test('pushSessionEvents drops unknown types and bounds the list', () => {
  const s = {};
  pushSessionEvents(s, sessionEvent('started', 'm1'));
  pushSessionEvents(s, { type: 'nonsense', at: 'x' });
  assert.equal(s.events.length, 1);

  for (let i = 0; i < SESSION_LOG_MAX + 25; i++) pushSessionEvents(s, sessionEvent('voted', 'm1', { personId: 'm1' }));
  assert.equal(s.events.length, SESSION_LOG_MAX);
  // The cap drops the OLDEST, so the newest entry must have survived.
  assert.equal(s.events[s.events.length - 1].type, 'voted');
});

// Undefined must be left out, not stored: a null actor renders identically to
// one we failed to resolve, so the two would become indistinguishable.
test('an absent actor is omitted rather than stored as null', () => {
  const e = sessionEvent('started', undefined);
  assert.equal('actor' in e, false);
  assert.equal('actor' in sessionEvent('started', 'm1'), true);
});

// ------------------------------------------------------------ over HTTP

async function addGame(rid, title) {
  const req = request(app).post(`/api/rounds/${rid}/games`);
  for (const [k, v] of Object.entries({ title, minPlayers: '1', maxPlayers: '8' })) req.field(k, String(v));
  return (await req).body;
}
const eventsOf = async (rid, sid) => {
  const r = (await request(app).get(`/api/rounds/${rid}`)).body;
  return r.sessions.find((s) => s.id === sid).events;
};

test('a drawn session records who started it', async () => {
  const round = await createRound(request);
  await addGame(round.id, 'A');
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  assert.deepEqual(res.body.session.events.map((e) => e.type), ['started']);
});

test('a directly picked session records it too', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const res = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ gameId: game.id });
  assert.deepEqual(res.body.session.events.map((e) => e.type), ['started']);
});

// The hot-seat wizard seeds a key per participant, so logging by key would
// credit a vote to someone who never gave one.
test('the bulk hot-seat write logs one vote per person who actually rated', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const [alice, bob] = round.members;
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const sid = started.body.session.id;
  await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/results`).send({
    votes: { [alice.id]: { [game.id]: { rating: 4, retire: false } }, [bob.id]: {} },
  });

  const voted = (await eventsOf(round.id, sid)).filter((e) => e.type === 'voted');
  assert.deepEqual(voted.map((e) => e.personId), [alice.id]);
});

test('a per-device session logs each column separately, and who closed it', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const [alice, bob] = round.members;
  const started = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, deviceVoting: true });
  const sid = started.body.session.id;

  for (const m of [alice, bob]) {
    await request(app)
      .post(`/api/rounds/${round.id}/sessions/${sid}/votes/${m.id}`)
      .send({ votes: { [game.id]: { rating: 4, retire: false } } });
  }
  await request(app).post(`/api/rounds/${round.id}/sessions/${sid}/close`).send({});

  const evs = await eventsOf(round.id, sid);
  assert.deepEqual(evs.map((e) => e.type), ['started', 'voted', 'voted', 'voting_closed']);
  assert.deepEqual(evs.filter((e) => e.type === 'voted').map((e) => e.personId), [alice.id, bob.id]);
});

// "Everything a session can do" — the whole lifecycle, in order.
test('choosing, finishing, cancelling and removing a game are all recorded', async () => {
  const round = await createRound(request);
  const a = await addGame(round.id, 'A');
  const b = await addGame(round.id, 'B');
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 5 });
  const sid = started.body.session.id;
  const base = `/api/rounds/${round.id}/sessions/${sid}`;

  await request(app).post(`${base}/choice`).send({ gameId: a.id });
  await request(app).post(`${base}/choice`).send({ gameId: null });
  await request(app).post(`${base}/choice`).send({ gameId: a.id });
  await request(app).post(`${base}/finish`).send({ finished: true, winnerIds: [round.members[0].id] });
  await request(app).post(`${base}/finish`).send({ finished: false });
  await request(app).delete(`${base}/games/${b.id}`);

  const evs = await eventsOf(round.id, sid);
  assert.deepEqual(evs.map((e) => e.type), [
    'started', 'game_chosen', 'game_unchosen', 'game_chosen', 'finished', 'unfinished', 'game_removed',
  ]);
  assert.equal(evs.find((e) => e.type === 'game_removed').gameId, b.id);
});

test('cancelling and un-cancelling are recorded', async () => {
  const round = await createRound(request);
  await addGame(round.id, 'A');
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const base = `/api/rounds/${round.id}/sessions/${started.body.session.id}`;
  await request(app).post(`${base}/cancel`).send({});
  await request(app).post(`${base}/cancel`).send({ cancelled: false });

  const evs = await eventsOf(round.id, started.body.session.id);
  assert.deepEqual(evs.map((e) => e.type), ['started', 'cancelled', 'uncancelled']);
});

// The log records the ACCOUNT, and this suite runs accounts-off — so there is
// deliberately nobody to attribute to. Pinning it here is what proves the
// `actorSeat` uid guard is in play rather than the first unlinked seat being
// credited with everything (.claude/rules/actor-seat-needs-a-uid-guard.md).
test('with accounts off no action is attributed to a seat', async () => {
  const round = await createRound(request);
  await addGame(round.id, 'A');
  const started = await request(app).post(`/api/rounds/${round.id}/sessions`).send({ count: 1 });
  const evs = await eventsOf(round.id, started.body.session.id);
  assert.equal(evs.every((e) => !('actor' in e)), true, JSON.stringify(evs));
});

// The redaction hides ratings; it must not hide the log, which carries none.
test('the log survives the open-session vote redaction', async () => {
  const round = await createRound(request);
  const game = await addGame(round.id, 'A');
  const started = await request(app)
    .post(`/api/rounds/${round.id}/sessions`)
    .send({ count: 1, deviceVoting: true });
  const sid = started.body.session.id;
  await request(app)
    .post(`/api/rounds/${round.id}/sessions/${sid}/votes/${round.members[0].id}`)
    .send({ votes: { [game.id]: { rating: 5, retire: false } } });

  const r = (await request(app).get(`/api/rounds/${round.id}`)).body;
  const s = r.sessions.find((x) => x.id === sid);
  assert.deepEqual(s.votes, {}, 'ratings stay hidden while voting is open');
  assert.deepEqual(s.events.map((e) => e.type), ['started', 'voted']);
  assert.equal(JSON.stringify(s.events).includes('rating'), false, 'the log must carry no ratings');
});
