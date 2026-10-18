'use strict';

/* Turning imported plays into stored sessions (#1665).

   The route (`POST …/sessions/import`, lib/routes/session-import.js) validates
   the request and hands this module the round plus three lists the client
   built in its preview: the people mapping, the games mapping and the plays.
   Everything here is pure — no repo, no request — so the whole translation is
   testable without a server, and the route stays a thin shell around one repo
   write.

   Ids for NEW members and games are minted here rather than in the repo: a
   session blob names its people and its game by id, and those blobs are built
   before the one transaction that writes all three. Both backends mint the same
   8-byte hex shape (lib/store.js `id`, lib/repo/postgres.js `newId`), so an id
   minted here is indistinguishable from one minted there.

   The session shape is the logged session's (#1616) — finished, dated, no
   votes — plus the outcome the /finish and /scores routes would otherwise have
   written in two more requests, and `importRef`, the source record it came
   from. That key is ABSENT on every other session, so existing blobs stay
   byte-identical (the guests/teams convention, .claude/rules/postgres-backend.md). */

const crypto = require('crypto');
const { sessionEvent } = require('./session-events');
const { normalizePlayedOn } = require('../public/js/played-on');
const { isValidPoints } = require('../public/js/point-records');
const { MIN_TEAM_SIZE, GUEST_NAME_MAX, MAX_SESSION_GUESTS } = require('../public/js/session-people');
const { isActiveGame } = require('./draw');

const mint = () => crypto.randomBytes(8).toString('hex');

// The 400 every caller-supplied inconsistency becomes. A class so the route can
// tell it apart from a genuine fault without matching on a message.
class ImportError extends Error {}

// Resolve the people mapping: each source player key becomes either an existing
// member (validated against the round), a member created by this import, or a
// guest name (minted per session, since a guest id is per session by design —
// lib/routes/sessions.js `resolveGuests`). A key that is absent was ignored.
function resolvePeople(round, people) {
  const memberIds = new Set(round.members.map((m) => m.id));
  const byKey = new Map();
  const newMembers = [];
  const newByName = new Map();
  const created = {}; // source player key -> minted member id
  for (const p of people) {
    if (byKey.has(p.key)) throw new ImportError('Duplicate person key');
    if (p.memberId) {
      if (!memberIds.has(p.memberId)) throw new ImportError('Unknown member');
      byKey.set(p.key, { memberId: p.memberId });
    } else if (p.newMember) {
      // Two source players mapped to the SAME new name are one new seat — a
      // BG Stats file and the round both have a „Julia", and the user said
      // „new member" twice. Matched case-insensitively, like the name match the
      // preview pre-selects with.
      const name = p.newMember.trim();
      const fold = name.toLowerCase();
      let id = newByName.get(fold);
      if (!id) {
        id = mint();
        newByName.set(fold, id);
        newMembers.push({ id, name });
      }
      byKey.set(p.key, { memberId: id });
      created[p.key] = id;
    } else {
      byKey.set(p.key, { guest: p.guest.trim().slice(0, GUEST_NAME_MAX) });
    }
  }
  return { byKey, newMembers, created };
}

// Resolve the games mapping: an existing game of this round, or a game created
// by this import — retired by default, so the shelf does not fill up with
// everything a group ever played (#1665), or onto the shelf when the user said
// so. A game created from a BGG id carries its `source`, which is what lets the
// provider backfill fill in its cover and player range afterwards and what the
// next import reuses it by.
function resolveGames(round, games, nowIso) {
  const byKey = new Map();
  const newGames = [];
  const bySource = new Map();
  const created = {}; // game key -> minted game id
  for (const g of games) {
    if (byKey.has(g.key)) throw new ImportError('Duplicate game key');
    if (g.gameId) {
      if (!round.games.some((x) => x.id === g.gameId)) throw new ImportError('Unknown game');
      byKey.set(g.key, g.gameId);
      continue;
    }
    const { title, bggId, shelf } = g.create;
    const sourceKey = bggId ? `bgg:${bggId}` : null;
    // The same BGG id named under two keys (a BG Stats file can hold a game
    // twice) is still one game.
    if (sourceKey && bySource.has(sourceKey)) {
      byKey.set(g.key, bySource.get(sourceKey));
      created[g.key] = bySource.get(sourceKey);
      continue;
    }
    // Reuse a game the round already holds under that BGG id, whatever its
    // state — the client resolves this too, but the round may have moved since
    // its preview was built.
    const existing = sourceKey && round.games.find((x) => x.source
      && x.source.provider === 'bgg' && x.source.externalId === String(bggId));
    if (existing) {
      byKey.set(g.key, existing.id);
      continue;
    }
    const id = mint();
    newGames.push({
      id,
      title: title.trim(),
      minPlayers: null,
      maxPlayers: null,
      image: null,
      retired: !shelf,
      retiredAt: shelf ? null : nowIso,
      completed: false,
      completedAt: null,
      wish: false,
      wishAt: null,
      ...(bggId ? {
        source: { provider: 'bgg', externalId: String(bggId), url: `https://boardgamegeek.com/boardgame/${bggId}` },
      } : {}),
    });
    if (sourceKey) bySource.set(sourceKey, id);
    byKey.set(g.key, id);
    created[g.key] = id;
  }
  return { byKey, newGames, created };
}

// One play → one session blob, or null when nobody it names is left at the
// table (every player ignored) or no member is: a session needs at least one
// seat of the round, the same floor POST /sessions enforces.
function buildSession(play, { people, games, source, actor }) {
  const gameId = games.get(play.gameKey);
  if (!gameId) throw new ImportError('Unknown game key');
  const memberIds = [];
  const guests = [];
  const personOf = new Map(); // player index -> person id
  play.players.forEach((pl, i) => {
    const who = people.get(pl.key);
    if (!who) return;
    if (who.memberId) {
      if (memberIds.includes(who.memberId)) return;
      memberIds.push(who.memberId);
      personOf.set(i, who.memberId);
    } else if (guests.length < MAX_SESSION_GUESTS && who.guest) {
      const guest = { id: mint(), name: who.guest };
      guests.push(guest);
      personOf.set(i, guest.id);
    }
  });
  if (!memberIds.length) return null;

  // Teams: players sharing a team name form one party — once two of them are
  // still at the table, the MIN_TEAM_SIZE floor resolveTeams applies.
  const teamPeople = new Map();
  play.players.forEach((pl, i) => {
    const pid = personOf.get(i);
    if (!pid || !pl.team) return;
    if (!teamPeople.has(pl.team)) teamPeople.set(pl.team, []);
    teamPeople.get(pl.team).push(i);
  });
  const teams = [];
  const teamOfIndex = new Map();
  for (const indices of teamPeople.values()) {
    if (indices.length < MIN_TEAM_SIZE) continue;
    const team = { id: mint(), personIds: indices.map((i) => personOf.get(i)) };
    teams.push(team);
    indices.forEach((i) => teamOfIndex.set(i, team));
  }

  const winnerIds = [];
  play.players.forEach((pl, i) => {
    const pid = personOf.get(i);
    if (pid && pl.win && !winnerIds.includes(pid)) winnerIds.push(pid);
  });

  // Points per PARTY, the seat /scores stores (sessionPartyGroups): a team's
  // first valid score, otherwise each person's own. A non-integer score (BG
  // Stats keeps scores as strings, „12.5" included) never gets here — the
  // client drops it rather than rounding, since an invented total is worse
  // than none — and the route accepts integers only.
  const scores = {};
  play.players.forEach((pl, i) => {
    const pid = personOf.get(i);
    if (!pid || !isValidPoints(pl.score)) return;
    const seat = teamOfIndex.has(i) ? teamOfIndex.get(i).id : pid;
    if (!(seat in scores)) scores[seat] = pl.score;
  });

  const at = play.playedOn;
  return {
    events: [sessionEvent('imported', actor, { source })],
    createdAt: at,
    dateOnly: play.dateOnly !== false,
    tagIds: null,
    excludeTagIds: null,
    requestedCount: 1,
    memberIds,
    ...(guests.length ? { guests } : {}),
    ...(teams.length ? { teams } : {}),
    gameIds: [gameId],
    votes: {},
    chosenGameId: gameId,
    chosenAt: at,
    finished: true,
    finishedAt: at,
    winnerIds,
    // A session has winners, or an ending, or neither (#1038) — so a lost co-op
    // play records its ending only when nobody is marked as having won.
    ...(play.ending && !winnerIds.length ? { ending: play.ending } : {}),
    ...(Object.keys(scores).length ? { scores } : {}),
    cancelled: false,
    cancelledAt: null,
    done: true,
    importRef: { source, id: play.id },
  };
}

// The whole request → what the repo writes. Throws ImportError on anything the
// client got wrong; returns the new members, the new games, the session blobs,
// how many plays were dropped for having no member left at the table, and the
// request's own keys for whatever this batch creates.
function buildImport(round, body, { actor, now = new Date() } = {}) {
  const nowIso = now.toISOString();
  const people = resolvePeople(round, body.people);
  const games = resolveGames(round, body.games, nowIso);
  const sessions = [];
  let empty = 0;
  for (const play of body.plays) {
    const playedOn = normalizePlayedOn(play.playedOn, now.getTime());
    if (!playedOn) throw new ImportError('Invalid playedOn');
    const blob = buildSession({ ...play, playedOn }, {
      people: people.byKey, games: games.byKey, source: body.source, actor,
    });
    if (blob) sessions.push(blob);
    else empty += 1;
  }
  return {
    members: people.newMembers,
    games: games.newGames,
    sessions,
    empty,
    // What the client names the new seats and games by in its next batch.
    createdPeople: people.created,
    createdGames: games.created,
  };
}

// The import refreshes nothing about an EXISTING game, so only newly created
// games that sit on the shelf are worth a provider backfill trigger — a retired
// one is never drawn, and its cover fills on first view like any other.
function backfillCandidates(games) {
  return games.filter((g) => g.source && isActiveGame(g));
}

module.exports = { buildImport, backfillCandidates, ImportError };
