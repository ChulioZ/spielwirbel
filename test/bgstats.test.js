'use strict';

/*
 * Pushing a finished session to BG Stats as a play (#485).
 *
 * The builder is pure and takes the domain objects the results screen already
 * has (session, game, sessionPeople(), sessionParties(), winnerIds), so every
 * mapping decision that has a trap in it — the name-derived guest id, the
 * winner flags, the team grouping, the play date's format — is unit-tested here
 * rather than living in a DOM handler.
 *
 * The worst-case URL length is asserted against the REAL caps out of
 * session-people.js, not against hand-copied numbers
 * (.claude/rules/shared-constants-across-the-stack.md): the whole play travels
 * as one query parameter, so the budget is the feature's real constraint and it
 * has to move when the caps do.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BGSTATS_SOURCE,
  BGSTATS_CREATE_PLAY,
  BGSTATS_URL_MAX,
  bgStatsGuestId,
  bgStatsPlay,
  bgStatsPlayUrl,
} = require('../public/js/bgstats');
const { MAX_SESSION_GUESTS, GUEST_NAME_MAX } = require('../public/js/session-people');

// --- fixtures ---------------------------------------------------------------

const anna = { id: 'm1', name: 'Anna', guest: false };
const ben = { id: 'm2', name: 'Ben', guest: false };
const dana = { id: 'g-sess-1', name: 'Dana', guest: true };

const solo = (p) => ({ id: p.id, name: p.name, people: [p], team: false });
const teamOf = (id, ...ps) => ({ id, name: ps.map((p) => p.name).join(', '), people: ps, team: true });

const session = {
  id: 'sess1',
  finished: true,
  cancelled: false,
  chosenGameId: 'gm1',
  createdAt: '2026-08-06T17:00:00.000Z',
  finishedAt: '2026-08-06T19:16:58.000Z',
};

const game = { id: 'gm1', title: 'Roll for the Galaxy' };

const model = (over = {}) => ({
  session,
  game,
  people: [anna, ben, dana],
  parties: [solo(anna), solo(ben), solo(dana)],
  winnerIds: ['m1'],
  ...over,
});

// --- the payload ------------------------------------------------------------

test('the play carries the four required fields, in BG Stats\' shapes', () => {
  const play = bgStatsPlay(model());
  assert.equal(play.sourceName, BGSTATS_SOURCE);
  assert.equal(play.sourcePlayId, 'sess1');
  // "yyyy-MM-dd HH:mm:ss", UTC, from the END of the session.
  assert.equal(play.playDate, '2026-08-06 19:16:58');
  assert.equal(play.game.name, 'Roll for the Galaxy');
  assert.equal(play.game.sourceGameId, 'gm1');
});

test('an unfinished, cancelled or game-less session is not a play', () => {
  assert.equal(bgStatsPlay(model({ session: { ...session, finished: false } })), null);
  assert.equal(bgStatsPlay(model({ session: { ...session, cancelled: true } })), null);
  assert.equal(bgStatsPlay(model({ game: null })), null);
  assert.equal(bgStatsPlayUrl(model({ game: null })), null);
});

test('a session with no usable timestamp is not a play either', () => {
  const undated = { ...session, createdAt: null, finishedAt: null };
  assert.equal(bgStatsPlay(model({ session: undated })), null);
});

test('playDate falls back to createdAt when the session carries no finishedAt', () => {
  const play = bgStatsPlay(model({ session: { ...session, finishedAt: null } }));
  assert.equal(play.playDate, '2026-08-06 17:00:00');
});

test('ratings do not travel: noPoints, and no score or rank on any player', () => {
  const play = bgStatsPlay(model());
  assert.equal(play.game.noPoints, true);
  for (const p of play.players) {
    assert.equal('score' in p, false);
    assert.equal('rank' in p, false);
  }
});

test('durationMin and comments are omitted — we measure neither', () => {
  const play = bgStatsPlay(model());
  assert.equal('durationMin' in play, false);
  assert.equal('comments' in play, false);
});

test('the bggId rides along only for a BGG-linked game, as a number', () => {
  const linked = { ...game, source: { provider: 'bgg', externalId: '132531', url: null } };
  assert.equal(bgStatsPlay(model({ game: linked })).game.bggId, 132531);

  // A digital game is not silently dropped — name + sourceGameId carry the match.
  const steam = { ...game, source: { provider: 'steam', externalId: '440', url: null } };
  const play = bgStatsPlay(model({ game: steam }));
  assert.equal('bggId' in play.game, false);
  assert.equal(play.game.name, 'Roll for the Galaxy');

  // A BGG link whose id is not numeric must not become NaN in the JSON.
  const odd = { ...game, source: { provider: 'bgg', externalId: 'abc', url: null } };
  assert.equal('bggId' in bgStatsPlay(model({ game: odd })).game, false);
});

// --- players ----------------------------------------------------------------

test('every participant travels, with the winners flagged', () => {
  const play = bgStatsPlay(model({ winnerIds: ['m1', 'g-sess-1'] }));
  assert.deepEqual(play.players.map((p) => p.name), ['Anna', 'Ben', 'Dana']);
  assert.deepEqual(play.players.map((p) => p.winner), [true, false, true]);
});

test('a member is re-matched on their member id, a guest on their NAME', () => {
  const play = bgStatsPlay(model());
  const [a, , d] = play.players;
  assert.equal(a.sourcePlayerId, 'm1');
  // Not the session-minted id: those are re-minted per session, so passing one
  // through would make the user re-match every guest at every push.
  assert.notEqual(d.sourcePlayerId, 'g-sess-1');
  assert.equal(d.sourcePlayerId, bgStatsGuestId('Dana'));
});

test('the guest id is stable across sessions and insensitive to case and padding', () => {
  assert.equal(bgStatsGuestId('Dana'), bgStatsGuestId(' dana '));
  assert.notEqual(bgStatsGuestId('Dana'), bgStatsGuestId('Dane'));
  // It must not be able to collide with a member id, which is bare hex.
  assert.match(bgStatsGuestId('Dana'), /^guest-[0-9a-f]{8}$/);
});

test('teams group by an equal team string, and only teamed players carry one', () => {
  const play = bgStatsPlay(model({
    parties: [teamOf('t1', anna, dana), solo(ben)],
  }));
  const byName = Object.fromEntries(play.players.map((p) => [p.name, p]));
  assert.equal(byName.Anna.team, byName.Dana.team);
  assert.equal('team' in byName.Ben, false);
});

test('a second team gets a different label', () => {
  const cara = { id: 'm3', name: 'Cara', guest: false };
  const eli = { id: 'm4', name: 'Eli', guest: false };
  const play = bgStatsPlay(model({
    people: [anna, ben, cara, eli],
    parties: [teamOf('t1', anna, ben), teamOf('t2', cara, eli)],
    winnerIds: [],
  }));
  const byName = Object.fromEntries(play.players.map((p) => [p.name, p]));
  assert.equal(byName.Anna.team, byName.Ben.team);
  assert.equal(byName.Cara.team, byName.Eli.team);
  assert.notEqual(byName.Anna.team, byName.Cara.team);
});

// --- the URL ----------------------------------------------------------------

test('the URL is the documented createPlay link with the play as one parameter', () => {
  const url = bgStatsPlayUrl(model());
  assert.ok(url.startsWith(BGSTATS_CREATE_PLAY + '?data='));
  const data = new URL(url).searchParams.get('data');
  assert.deepEqual(JSON.parse(data), bgStatsPlay(model()));
});

test('the worst case this app can produce stays inside the URL budget', () => {
  // The largest session the app permits: a full table of members plus the guest
  // cap, every guest name at the cap, a long title, and everyone paired off so
  // each player also carries a team string. `winner` is always emitted, so
  // nobody winning is the marginally wider of the two.
  const long = 'W'.repeat(GUEST_NAME_MAX);
  const members = Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, name: long, guest: false }));
  const guests = Array.from({ length: MAX_SESSION_GUESTS }, (_, i) => ({
    id: 'g' + i, name: long.slice(0, GUEST_NAME_MAX - 2) + i, guest: true,
  }));
  const people = [...members, ...guests];
  const url = bgStatsPlayUrl({
    session,
    game: { ...game, title: 'X'.repeat(120), source: { provider: 'bgg', externalId: '132531' } },
    people,
    // Everyone paired off, so every player also carries a team string.
    parties: people.reduce((acc, p, i) => {
      if (i % 2) acc.push(teamOf('t' + i, people[i - 1], p));
      return acc;
    }, []),
    winnerIds: [],
  });
  assert.ok(url.length <= BGSTATS_URL_MAX, `worst-case URL is ${url.length} chars`);
});
