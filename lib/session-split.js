'use strict';

/* Splitting one voted session across several tables (#796) — the part that is
   not I/O.

   The route keeps the reads, the writes and the HTTP shape; everything that can
   be decided from a round plus a stored session lives here, so the objective,
   the validation and the child-session construction are unit-testable without a
   round trip. It is also what keeps `lib/routes/sessions.js` from growing a
   fourth concern (.claude/rules/token-friendly-source-files.md).

   The scoring itself is NOT here: it is public/js/table-split.js, because the
   builder screen has to score a hand-made table exactly the way the
   recommendation was scored (.claude/rules/shared-constants-across-the-stack.md). */

const crypto = require('crypto');
const { fitsPlayerCount } = require('../public/js/draw-pool');
const { effectiveRating } = require('../public/js/vote-scale');
const { MIN_TABLE_PARTIES, proposeTableSplits } = require('../public/js/table-split');
const { tileValue } = require('../public/js/vote-score');
const { sessionPeople, sessionPartyGroups, MAX_SESSION_GUESTS } = require('../public/js/session-people');
const { isActiveGame } = require('./draw');

// The games this session drew that a table could still actually be sat at. A
// game archived or wished since the draw is dropped, for the same reason the
// direct-pick guard refuses one: the split ends in real sessions, each holding a
// chosen game (.claude/rules/active-games-filter-sites.md).
function splittableGames(round, session) {
  const ids = new Set(session.gameIds || []);
  return round.games.filter((g) => ids.has(g.id) && isActiveGame(g));
}

// The proposals for one session — one per feasible table count, smallest first.
// Seeded from the session id, so this is a pure function of (round, session) and
// two callers racing to be the first to persist compute the same answer.
function computeTableProposals(round, session) {
  return proposeTableSplits({
    parties: sessionPartyGroups(round, session),
    games: splittableGames(round, session),
    votes: session.votes || {},
    seed: session.id,
    effectiveRating,
    tileValue,
    fitsPlayerCount,
  });
}

/* Is this hand-edited arrangement one we may actually create sessions from?

   The builder already prevents every refusal below, which is exactly why they
   are all checked again: direct-pick mode consults NO player range (#532), so
   nothing downstream would catch an over-full table — the child session would
   simply be created with more people than the box seats, and the group would
   find out at the table.

   Returns a marker string, or null when the tables are good. */
function validateSplitTables(round, session, tables) {
  if (!Array.isArray(tables) || tables.length < 2) return 'bad_tables';

  const drawn = new Map(splittableGames(round, session).map((g) => [g.id, g]));
  const seenGames = new Set();
  const seenPeople = new Set();
  for (const tb of tables) {
    if (!tb || typeof tb !== 'object') return 'bad_tables';
    const game = drawn.get(String(tb.gameId));
    if (!game) return 'unknown_game';
    // Two tables playing one box at once needs two copies of it.
    if (seenGames.has(game.id)) return 'duplicate_game';
    seenGames.add(game.id);
    if (!Array.isArray(tb.personIds) || !tb.personIds.length) return 'bad_tables';
    for (const pid of tb.personIds) {
      if (seenPeople.has(pid)) return 'person_twice';
      seenPeople.add(pid);
    }
  }

  // Everyone who voted has to be seated. A participant left out would lose the
  // evening they rated for, with nothing on any screen to say so.
  const participants = sessionPeople(round, session).map((p) => p.id);
  if (seenPeople.size !== participants.length) return 'people_mismatch';
  if (participants.some((pid) => !seenPeople.has(pid))) return 'people_mismatch';

  // A team holds ONE hand, so it is the atom being seated: split across two
  // tables it would be two half-teams playing different games. The builder moves
  // parties rather than people, so this can only be reached by a hand-rolled
  // request — and it is also what makes the party count below well-defined.
  const parties = sessionPartyGroups(round, session);
  const tableOf = new Map();
  tables.forEach((tb, i) => tb.personIds.forEach((pid) => tableOf.set(pid, i)));
  const partyCounts = tables.map(() => 0);
  for (const party of parties) {
    const at = tableOf.get(party.personIds[0]);
    if (party.personIds.some((pid) => tableOf.get(pid) !== at)) return 'team_split';
    partyCounts[at]++;
  }

  for (let i = 0; i < tables.length; i++) {
    if (partyCounts[i] < MIN_TABLE_PARTIES) return 'table_too_small';
    if (!fitsPlayerCount(drawn.get(String(tables[i].gameId)), partyCounts[i])) return 'table_out_of_range';
  }
  return null;
}

/* Build one child session blob per table.

   A child is an ordinary DIRECT-PICK session (#532): a chosen game, the people
   who sat at it, no voting phase. Its guests get FRESHLY MINTED ids rather than
   the parent's, because a guest id is a key in that session's own vote map and
   `winnerIds` — sharing one across sessions would make two evenings' records
   collide on the same person. Teams are rebuilt against those new ids for the
   same reason.

   The child carries NO votes. Copying the parent's would double-count every
   rating in `gameStats`, which reads every session holding the game — the
   average would move because the evening was split. */
function buildChildSessions(round, session, tables, startedEvent) {
  const people = new Map(sessionPeople(round, session).map((p) => [p.id, p]));
  const guestName = new Map((session.guests || []).map((g) => [g.id, g.name]));
  const parties = sessionPartyGroups(round, session).filter((p) => p.team);
  const now = new Date().toISOString();

  return tables.map((tb) => {
    const memberIds = [];
    const guests = [];
    const guestIdMap = new Map();
    tb.personIds.forEach((pid) => {
      const person = people.get(pid);
      if (!person) return;
      if (!person.guest) {
        memberIds.push(pid);
        return;
      }
      if (guests.length >= MAX_SESSION_GUESTS) return;
      const id = crypto.randomBytes(8).toString('hex');
      guestIdMap.set(pid, id);
      guests.push({ id, name: guestName.get(pid) || person.name });
    });
    const seated = new Set(tb.personIds);
    const teams = parties
      .filter((p) => p.personIds.every((pid) => seated.has(pid)))
      .map((p) => ({
        id: crypto.randomBytes(8).toString('hex'),
        personIds: p.personIds.map((pid) => guestIdMap.get(pid) || pid),
      }));

    return {
      events: [startedEvent],
      createdAt: now,
      tagIds: null,
      excludeTagIds: null,
      requestedCount: 1,
      memberIds,
      // Same absent-key discipline as every other session blob: a table with no
      // guests and no teams grows no key, so the JSON and Postgres rows stay
      // byte-identical (.claude/rules/postgres-backend.md).
      ...(guests.length ? { guests } : {}),
      ...(teams.length ? { teams } : {}),
      parentSessionId: session.id,
      gameIds: [String(tb.gameId)],
      votes: {},
      chosenGameId: String(tb.gameId),
      chosenAt: now,
      finished: false,
      finishedAt: null,
      winnerIds: [],
      cancelled: false,
      cancelledAt: null,
      done: true,
    };
  });
}

module.exports = { splittableGames, computeTableProposals, validateSplitTables, buildChildSessions };
