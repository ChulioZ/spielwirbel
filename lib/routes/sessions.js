'use strict';

/* Routes for game sessions: start (random pick), save results, choose game,
   finish/winners, cancel, delete.
   Mounted under /api/rounds/:rid/sessions (mergeParams for rid). */

const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const { trackEvent } = require('../observability');
// The vote-link store is GLOBAL (un-scoped, absent from TENANT_METHODS), so it is
// reached on the module-level repo rather than through req.repo — see #652.
const repo = require('../repo');
const { emitFeedEvent } = require('../feed');
// The capability ladder both sides share (#137). DELETE /:sid narrows on the
// session's state below, and reads the same table the gate does rather than
// testing req.grant for truthiness (.claude/rules/round-roles-are-a-chokepoint.md).
const { can } = require('../../public/js/round-roles');
// The draw's pool filter and shuffle (#486). Both of this route's "is this game
// active" guards go through `isActiveGame`, so a new archive state closes them
// together (.claude/rules/active-games-filter-sites.md).
const { drawPool, isActiveGame, shuffle } = require('../draw');
// The cap lives with the frontend helper that also enforces it on the setup
// screen — one source of truth across the boundary (#458, see
// .claude/rules/shared-constants-across-the-stack.md).
const { MAX_SESSION_GUESTS, GUEST_NAME_MAX, MIN_TEAM_SIZE } = require('../../public/js/session-people');
// The metadata filters (#725) are validated against exactly the ladders and the
// per-shelf option lists the setup screen offers — same file, same reason as the
// guest caps above.
const {
  metadataFilterOptions,
  normalizeMetadataFilters,
  countMetadataFilters,
} = require('../../public/js/draw-pool');
// The session activity log (#209). Every mutator below takes its entries as a
// trailing argument and appends them inside its own read-modify-write, so the
// log cannot drift from the state it describes.
const { sessionEvent } = require('../session-events');
// Multi-table sessions (#796). The decisions that need only a round and a stored
// session live in lib/session-split.js; the scoring itself is shared with the
// builder screen (public/js/table-split.js).
const {
  computeTableProposals,
  validateSplitTables,
  buildChildSessions,
} = require('../session-split');
const { sessionChildIds } = require('../../public/js/session-outcome');
const { actorSeat } = require('../actor-seat');
// The per-person write's sanitizer and participant set, shared with the public
// vote-link route (#652) so a link voter's column obeys exactly the same rules as
// an in-app one — see lib/session-votes.js.
const { sanitizePersonVotes, sessionParticipantIds } = require('../session-votes');
// Lazy provider-metadata backfill (#717). Session start fires TWO of its five
// triggers: the fire-and-forget one after the draw (so both voting surfaces read
// stored values) and — when the request carries metadata filters — the one
// BLOCKING trigger, before the draw (#736). See lib/provider-info.js's header.
const { backfillProviderInfo } = require('../provider-info');

const router = express.Router({ mergeParams: true });

// Fill missing provider info for the games this session will show, without the
// start request ever blocking on or failing with the provider — fire-and-forget
// with every failure swallowed. The columns land in the store, so the voting
// screens (which re-read the round / the ballot) pick them up; the session
// creation response itself may predate them, which is the accepted trade.
const backfillSessionGames = (repo, rid, games) =>
  backfillProviderInfo(repo, rid, games).catch(() => {});

// How long a FILTERED draw will wait for the provider before drawing on what is
// stored (#736). The provider's own per-request budget is 8 s (fetchXml), so a
// ceiling below it is what makes this a bound rather than a restatement: one
// slow /thing call must not hold the one request the user is actually waiting
// on. Exceeding it costs accuracy, never the draw.
//
// Read per call from env, like the rate-limit ceilings in lib/app.js — which is
// what lets a spec drive the timeout path in milliseconds instead of parking the
// suite for four seconds (.claude/rules/security-middleware.md).
const drawBackfillTimeoutMs = () => Number(process.env.DRAW_BACKFILL_TIMEOUT_MS) || 4000;

// The blocking half of the backfill, for a draw that carries metadata filters.
// Unlike `backfillSessionGames` above — which fires after the draw and so can
// only ever help the NEXT one — this runs before the pool is built, which is the
// whole point: the filters are applied to values that must already be there.
//
// Bounded twice over, because this one is on the critical path: one upstream
// request (like the shelf-wide trigger), and a timeout above it. Every failure
// mode — upstream error, throttling, a hanging socket — resolves to "draw with
// what is stored", i.e. exactly the behaviour before this existed.
function backfillForFilteredDraw(repo, rid, games) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, drawBackfillTimeoutMs());
    // Never hold the process open on this timer — an un-unref'd one keeps
    // `node --test` alive after the last assertion (.claude/rules/guest-demo-accounts.md).
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([
    backfillProviderInfo(repo, rid, games, { maxBatches: 1 }).catch(() => {}),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

// Drop a session's vote link, best-effort (#652).
//
// Swallowing the failure is the point, not laziness. Each call runs AFTER the
// close / cancel / delete has already been persisted, and the link's validity
// does not depend on this row existing: lib/routes/vote-link.js re-reads the
// session on every request and refuses a closed one regardless. So letting this
// reject would turn a successful, already-committed action into a 500 for the
// user in exchange for nothing — the ballot is shut either way, and the cost of
// the failure is one stale row that can never open anything.
const dropVoteLink = (rid, sid) => repo.deleteSessionVoteLink(rid, sid).catch(() => {});

// Resolve the client's guest NAMES into stored `{ id, name }` records (#458).
// A too-long name is truncated rather than rejected, matching the lenient style
// of the start-session schema (and the setup screen's own input maxlength, which
// reads the same constant).
// The ids are minted here on purpose: a guest id becomes a key in the vote map
// and in `winnerIds`, so letting a client dictate one would let it collide with
// a member id or with another session's guest. Names are trimmed, blanks
// dropped, and the list capped — lenient throughout, like its schema siblings.
function resolveGuests(names) {
  return names
    .map((n) => n.trim().slice(0, GUEST_NAME_MAX))
    .filter(Boolean)
    .slice(0, MAX_SESSION_GUESTS)
    .map((name) => ({ id: crypto.randomBytes(8).toString('hex'), name }));
}

// Resolve the client's team declarations into stored `{ id, personIds }` records
// (#575).
//
// The wire format names a member by id but a guest by POSITION in the same
// request's `guests` array, and it has to: guest ids are minted here, moments
// ago, so the client cannot possibly know one. Positions are resolved against
// the already-minted `guests`, which is why this runs after resolveGuests().
//
// Lenient like every sibling — this never 400s. In order: drop people who did
// not join this session, drop a person an earlier team already claimed (nobody
// plays in two parties), then drop any team left below MIN_TEAM_SIZE, a group of
// one being a solo player rather than a team. No separate cap is needed: every
// team must hold two distinct joined people, and the participants are already
// bounded by MAX_SESSION_GUESTS and the per-round members quota.
function resolveTeams(raw, memberIds, guests) {
  const joined = new Set(memberIds);
  const guestById = guests.map((g) => g.id);
  const claimed = new Set();
  const teams = [];
  raw.forEach((team) => {
    const personIds = [];
    const take = (pid) => {
      if (!pid || claimed.has(pid) || personIds.includes(pid)) return;
      personIds.push(pid);
    };
    team.memberIds.forEach((mid) => { if (joined.has(mid)) take(mid); });
    team.guestIndices.forEach((i) => { take(Number.isInteger(i) ? guestById[i] : undefined); });
    // Claim only once the team survives, or a team dropped for being too small
    // would take its people out of a later, valid one.
    if (personIds.length < MIN_TEAM_SIZE) return;
    personIds.forEach((pid) => claimed.add(pid));
    teams.push({ id: crypto.randomBytes(8).toString('hex'), personIds });
  });
  return teams;
}

// One declared team on the wire. Both lists are coerced the same lenient way as
// their siblings above; `resolveTeams` does the real filtering, which needs the
// round and the minted guests.
const teamSchema = z.object({
  memberIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  guestIndices: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((x) => parseInt(x, 10)).filter(Number.isInteger) : []),
    z.array(z.number())
  ),
});

// Start-session body. Every field is lenient (unknown -> default), exactly like
// the old hand-rolled normalization: memberIds are coerced to a string array
// (round-membership filtering still happens in the handler, which needs the
// round), count to NaN (the handler floors it to 1). `gameId` (direct-pick) is
// passed through untouched. So this schema never 400s — the real 400s (no
// members, no matching games) are round-dependent and stay in the handler.
const startSessionSchema = z.object({
  memberIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  count: z.preprocess((v) => parseInt(v, 10), z.number().catch(NaN)),
  tagIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  excludeTagIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  // How the INCLUDED tags combine (#726). Lenient like everything else here:
  // `.catch` swallows an absent, misspelled or non-string value into 'all', the
  // pre-#726 behaviour, so no request can be rejected over it.
  tagMode: z.enum(['all', 'any']).catch('all'),
  // The metadata filters (#725). Everything here is passed through as-is and
  // handed to `normalizeMetadataFilters` in the handler, which needs the round to
  // know which values the shelf can offer — so the schema's only job is to keep
  // a non-object from reaching it. Lenient like every field above: an unknown
  // shape becomes {} rather than a 400.
  metadata: z.preprocess(
    (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    z.record(z.string(), z.unknown())
  ),
  // Guests (#458) arrive as NAMES; resolveGuests() mints their ids below.
  guests: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
  // Teams (#575). Non-object entries are dropped here so the schema itself can
  // never reject the request; resolveTeams() applies the real rules.
  teams: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []),
    z.array(teamSchema)
  ),
  gameId: z.unknown().optional(),
  // Multi-table mode (#796). Lenient like every field above — only a literal
  // `true` turns it on, so an absent, misspelled or truthy-ish value can only
  // ever produce the pool the draw has always produced.
  multiTable: z.preprocess((v) => v === true, z.boolean()),
});

// Save-results body: votes must be a map object (votes[memberId][gameId] = …);
// anything else (missing, array, primitive) falls back to {} like the old
// `typeof === 'object'` guard. The nested shape isn't validated here — the data
// layer is lenient about it.
const saveResultsSchema = z.object({
  votes: z.record(z.string(), z.unknown()).catch({}),
});

// Finish body: winnerIds coerced to a string array (filtered in the handler
// against the round's members plus this session's guests). `finished` is a
// tri-state default (true unless explicitly false), read from req.body where
// that reads clearest.
const finishSchema = z.object({
  winnerIds: z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
});

// Start a new session. Two modes:
//  - random draw (default): pick games by tag/player-count filters;
//  - direct pick (`gameId` given): play one chosen game, skipping the vote.
router.post('/', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const body = validateBody(startSessionSchema, req, res);
  if (!body) return;

  // Members joining this session. Missing/empty means everyone (back-compat).
  // The joining count filters games by their player range below.
  const memberById = new Set(round.members.map((m) => m.id));
  let memberIds = body.memberIds.filter((mid) => memberById.has(mid));
  if (memberIds.length === 0) memberIds = round.members.map((m) => m.id);
  if (memberIds.length === 0)
    return res.status(400).json({ error: 'At least one member must join' });
  const members = round.members.filter((m) => memberIds.includes(m.id));

  // Guests (#458) arrive as names and are minted here for BOTH modes (#532).
  const guests = resolveGuests(body.guests);
  // Teams (#575), likewise for both modes: the draw filters its pool by the
  // number of parties, and direct-pick needs them so the results screen's winner
  // picker can record "Anna & Dana won" in one tap.
  const teams = resolveTeams(body.teams, memberIds, guests);

  // Direct-pick mode: the user explicitly chose one game, so there is no draw
  // and no voting. Ignore count and the player-range pool — but not guests: they
  // sat at the table and the results screen's winner picker draws its chips from
  // members ∪ guests, so without them a guest who won cannot be recorded (#532).
  if (body.gameId != null) {
    const game = round.games.find((g) => g.id === String(body.gameId));
    if (!game) return res.status(400).json({ error: 'Game does not belong to this round' });
    // Same predicate as the draw pool below (#486) — a game outside the active
    // collection must not stay playable by id just because the UI no longer
    // offers it. The message still names which state it is in, which is why the
    // branch survives. A wish (#560) is the sharpest case: the group does not
    // own the game at all, so playing it is not merely hidden but impossible.
    if (!isActiveGame(game)) {
      let why = 'Game is completed';
      if (game.retired) why = 'Game is retired';
      else if (game.wish) why = 'Game is on the wishlist';
      return res.status(400).json({ error: why });
    }
    const now = new Date().toISOString();
    const session = await req.repo.createSession(req.params.rid, {
      // Who drew it (#209). Written straight into the blob rather than through
      // the mutator's events argument: this session does not exist yet, so
      // there is nothing to append to.
      events: [sessionEvent('started', actorSeat(round, req.userId))],
      createdAt: now,
      tagIds: null, // no tag filter in direct-pick mode (#238)
      excludeTagIds: null, // nor an exclude filter (#241)
      requestedCount: 1,
      memberIds,
      // Same absent-key discipline as the draw path below: a guestless session
      // grows no `guests` key (.claude/rules/postgres-backend.md), and a
      // teamless one no `teams` key (#575).
      ...(guests.length ? { guests } : {}),
      ...(teams.length ? { teams } : {}),
      gameIds: [game.id],
      votes: {}, // no voting phase in direct-pick mode
      chosenGameId: game.id, // the game is chosen up front
      chosenAt: now,
      finished: false,
      finishedAt: null,
      winnerIds: [],
      cancelled: false,
      cancelledAt: null,
      done: true,
    });
    trackEvent('session_created', { tenantId: req.tenantId });
    backfillSessionGames(req.repo, req.params.rid, [game]);
    // Same convenience shape as the draw path below — the minted guest and team
    // ids only exist server-side until this response, so both modes report them.
    return res.status(201).json({ session, games: [game], members, guests, teams });
  }

  let count = body.count;
  if (!Number.isFinite(count) || count < 1) count = 1;

  // Tag filter (#238, tri-state #241): included tags combine per `tagMode`
  // below (#726 — every one, or at least one); excluded tags reject a game
  // carrying any of them, in either mode.
  // Unknown ids are dropped (lenient, like memberIds); empty means no filter.
  const roundTagIds = new Set((round.tags || []).map((tg) => tg.id));
  let tagIds = [...new Set(body.tagIds)].filter((x) => roundTagIds.has(x));
  if (tagIds.length === 0) tagIds = null;
  // A tag can't be both included and excluded — include wins (drop it from
  // exclude), mirroring the single-state-per-tag guarantee of the client cycle.
  let excludeTagIds = [...new Set(body.excludeTagIds)]
    .filter((x) => roundTagIds.has(x) && !(tagIds && tagIds.includes(x)));
  if (excludeTagIds.length === 0) excludeTagIds = null;
  // The combination mode (#726) is normalised the way the id lists above are:
  // with nothing left to combine it cannot mean anything, so it collapses to
  // 'all' and never reaches the blob. Kept for a SINGLE included tag, where the
  // two modes draw the same pool but the user's choice still has to survive into
  // the preset — dropping it there would silently reset the control the next
  // time the sheet opens.
  const tagMode = tagIds && body.tagMode === 'any' ? 'any' : 'all';

  // A draw the caller WANTS filtered waits for the metadata (#736) — otherwise
  // "max. Komplexität 1" happily draws Agricola, because an absent weight passes
  // every filter by design (.claude/rules/provider-metadata-is-a-filter-not-a-tag.md §2).
  //
  // The test is on the RAW body and it has to be, because normalization below is
  // itself blind on an unfilled shelf: `metadataFilterOptions` reports a field
  // unavailable when no game carries it, so a weight filter over a shelf with no
  // stored weights would be dropped to "unfiltered" BEFORE anything noticed it
  // was asked for. Fill first, then normalize against what the shelf now offers.
  // `countMetadataFilters` reads a raw blob fine — a garbage value costs one
  // bounded, timed-out backfill and is then dropped by normalization anyway.
  let shelf = round;
  if (countMetadataFilters(body.metadata) > 0) {
    await backfillForFilteredDraw(req.repo, req.params.rid, round.games.filter(isActiveGame));
    shelf = (await req.repo.getRound(req.params.rid)) || round;
  }

  // The metadata filters (#725), normalized against what this shelf can actually
  // offer — so an unknown category is dropped exactly like an unknown tag id
  // above, and a bound outside the offered ladder collapses to "unfiltered"
  // rather than 400ing. The options come from the ACTIVE games, because those
  // are the only ones a draw can pick and the setup screen derives its controls
  // from the same set.
  const metadata = normalizeMetadataFilters(
    body.metadata,
    metadataFilterOptions(shelf.games.filter(isActiveGame))
  );
  const hasMetadata = countMetadataFilters(metadata) > 0;

  // Guests sit at the table too, so they count toward the player range the pool
  // is filtered by — the client-side preview in showStartSession() applies the
  // identical arithmetic and the two must agree
  // (.claude/rules/active-games-filter-sites.md). Direct-pick consults no player
  // range, which is why only this mode uses the count.
  //
  // A TEAM counts as ONE player (#575): its members hold one hand between them,
  // so six people in three pairs are looking for a three-player game. Hence
  // headcount minus everyone who is in a team, plus one per team.
  const teamedCount = teams.reduce((n, tm) => n + tm.personIds.length, 0);
  const playerCount = memberIds.length + guests.length - teamedCount + teams.length;

  // Multi-table mode (#796) relaxes ONLY the range clause: it asks whether the box
  // can seat some table this group could form, rather than the whole party at
  // once. `showStartSession()` applies the identical predicate to the identical
  // count for its preview, so the two cannot disagree
  // (.claude/rules/active-games-filter-sites.md).
  const multiTable = body.multiTable === true;
  const pool = drawPool(shelf, { tagIds, excludeTagIds, tagMode, metadata, playerCount, multiTable });
  if (pool.length === 0)
    return res.status(400).json({ error: 'No matching games in this round' });

  const picked = shuffle(pool.slice()).slice(0, Math.min(count, pool.length));

  // Remember what this draw was started with (#252), so the next "New session"
  // sheet for this round opens preset with it. Stored resolved (unknown tag ids
  // are already dropped above) and normalized to arrays, so the client presets
  // without having to re-derive null-vs-empty.
  const filters = {
    tagIds: tagIds || [],
    excludeTagIds: excludeTagIds || [],
    count,
    // Only when it is 'any' — the preset is replaced wholesale on every draw, so
    // an absent key is what makes the next sheet open on the default (#726).
    ...(tagMode === 'any' ? { tagMode } : {}),
    // Same discipline for the metadata filters (#725): an unfiltered draw — every
    // draw before #725 and the great majority after it — grows no `metadata` key,
    // so its preset stays byte-identical across both backends.
    ...(hasMetadata ? { metadata } : {}),
    // And for multi-table (#796). Remembered like every other control on the
    // screen: a group large enough to need several tables is large enough next
    // time too, and the checkbox is visibly ticked when the sheet reopens.
    ...(multiTable ? { multiTable } : {}),
  };

  const session = await req.repo.createSession(req.params.rid, {
    events: [sessionEvent('started', actorSeat(round, req.userId))], // #209
    createdAt: new Date().toISOString(),
    tagIds, // null = no tag filter (#238)
    excludeTagIds, // null = no exclude filter (#241)
    // Same absent-key discipline as `guests`/`teams` below: an AND draw — every
    // draw before #726 and the great majority after it — grows no `tagMode` key,
    // so its blob stays byte-identical across both backends.
    ...(tagMode === 'any' ? { tagMode } : {}),
    requestedCount: count,
    memberIds, // members who joined this session
    // Guests (#458) only when there are some: a guestless session must grow no
    // `guests` key, so the JSON and Postgres blobs stay byte-identical
    // (.claude/rules/postgres-backend.md). Absent and [] mean the same on read.
    ...(guests.length ? { guests } : {}),
    // Teams (#575) follow the same rule: absent means none.
    ...(teams.length ? { teams } : {}),
    // Multi-table (#796), same rule again: an ordinary session grows no key, so
    // its blob stays byte-identical across both backends.
    ...(multiTable ? { multiTable } : {}),
    gameIds: picked.map((g) => g.id),
    votes: {}, // votes[personId][gameId] = { rating: 1..5|null, retire: bool }
    chosenGameId: null, // which game ends up being played
    chosenAt: null, // when a game was chosen
    finished: false, // whether the game was played/finished
    finishedAt: null, // when it was finished
    winnerIds: [], // winners (member or guest ids, multiple allowed)
    cancelled: false, // final state: no game appealed, nothing was played
    cancelledAt: null, // when it was cancelled
    done: false,
  }, filters);

  // Both start modes (direct-pick above, draw here) are one created session.
  trackEvent('session_created', { tenantId: req.tenantId });
  backfillSessionGames(req.repo, req.params.rid, picked);

  // Convenience for the frontend: send the picked games right away, plus the
  // resolved guests and teams (whose ids only exist server-side until now).
  res.status(201).json({ session, games: picked, members, guests, teams });
});

// Strip `retire` from every guest's vote entries (#458). A guest's rating is an
// opinion about the game and counts, but deciding a game should leave the shelf
// is the permanent group governing its own collection — so the vote card renders
// no retire control for a guest at all. This drops what a hand-crafted request
// could otherwise inject, which is why gameStats() needs no guest exclusion:
// there is simply never a guest `retire` flag to exclude.
function dropGuestRetireFlags(votes, session) {
  const guestIds = new Set((session.guests || []).map((g) => g.id));
  if (!guestIds.size) return votes;
  Object.keys(votes).forEach((pid) => {
    if (!guestIds.has(pid)) return;
    const byGame = votes[pid];
    if (!byGame || typeof byGame !== 'object') return;
    Object.keys(byGame).forEach((gid) => {
      const v = byGame[gid];
      if (v && typeof v === 'object') delete v.retire;
    });
  });
  return votes;
}

// One person's votes, written on its own while the session is still running
// (#209). This is the per-device counterpart of `/results`: same data, one
// column at a time, so people can vote from wherever they are.
//
// Authority is deliberately the SAME as `/results` — anyone who can reach the
// round may write any joined person's column. That is not an oversight: it is
// exactly what this route's sibling has always allowed, so nothing here widens
// what a caller can do, and it is what lets the starting device hot-seat the
// people sitting next to it. Which column belongs to whom is a question the
// CLIENT answers from `member.userId` (attribution, not access — see
// .claude/rules/member-seat-self-claim.md). Per-action permissions inside a round
// are lib/round-access.js's job (#137), not this route's — voting costs
// 'round.write', the floor every grantee clears.
router.post('/:sid/votes/:pid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.cancelled) return res.status(400).json({ error: 'Session is cancelled' });
  // Once voting is closed the ratings are published: the results screen, the
  // Pokale and every game's average already read them. A late write would move
  // numbers people have seen, with nothing on screen to explain it.
  if (session.done) return res.status(400).json({ error: 'voting_closed' });

  if (!sessionParticipantIds(session).has(req.params.pid))
    return res.status(404).json({ error: 'Person did not join this session' });

  const body = validateBody(saveResultsSchema, req, res);
  if (!body) return;
  const updated = await req.repo.saveSessionPersonVotes(
    req.params.rid,
    req.params.sid,
    req.params.pid,
    sanitizePersonVotes(body.votes, session, req.params.pid),
    // The entry that makes a hybrid session legible: whose column this was, and
    // which account submitted it. Equal ids render as "Anna voted", different
    // ones as "Anna voted for Ben" (public/js/session-log.js).
    sessionEvent('voted', actorSeat(round, req.userId), { personId: req.params.pid })
  );
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  // Never echo the session back: it carries every other person's votes, and this
  // is the one route a mid-session voter's device calls. Answering with the blob
  // would hand back exactly what redactRoundVotes() strips from the round read.
  res.json({ ok: true });
});

// Close a per-device session's voting (#209) and reveal what was collected.
// Available at any time, on purpose: someone who never shows up must not be able
// to hold the evening hostage, and anyone with round access can close it, so a
// flat battery on the starting device does not strand the session either.
router.post('/:sid/close', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.cancelled) return res.status(400).json({ error: 'Session is cancelled' });
  // Idempotent: two people tapping "close" at the same moment is the expected
  // case, not an error — and the second tap must not read as a failure.
  if (session.done) return res.json(session);

  const updated = await req.repo.closeSessionVoting(
    req.params.rid,
    req.params.sid,
    sessionEvent('voting_closed', actorSeat(round, req.userId))
  );
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  // The vote link is spent (#652): nothing more will be collected, so the row is
  // garbage from here on. Deliberately AFTER the close, and deliberately not the
  // thing that makes the link stop working — the public route re-reads the session
  // and refuses a closed one on its own, so a failure here costs a stale row, not
  // an open ballot. That split is what keeps this from being a cascade whose every
  // missed call site is a hole.
  await dropVoteLink(req.params.rid, req.params.sid);
  res.json(updated);
});

// Mint (or re-hand-out) this session's public vote link (#652).
//
// The link lets people WITHOUT an account vote from their own device: the holder
// opens /vote/:token, claims their name from the participant list and submits one
// column. Real groups largely will not register every player, so the account
// requirement was the thing keeping per-device voting (#209/#612) out of reach for
// most evenings.
//
// Gated exactly like the per-person write above — same session states, same
// authority (anyone who can reach the round). That is deliberate: this route hands
// out a capability to write a column, so it must not be reachable in any state
// where writing a column directly is refused. It is NOT owner-only for the same
// reason the sessions router has no owner guard at all — there is no host, and the
// starting device holds no special standing (.claude/rules/per-device-session-voting.md §3).
//
// Idempotent by construction (the repo returns the existing row), so a second tap
// on „Link teilen" hands out the URL already in the group chat rather than
// silently invalidating it and stranding everyone who had opened it.
router.post('/:sid/vote-link', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.cancelled) return res.status(400).json({ error: 'Session is cancelled' });
  if (session.done) return res.status(400).json({ error: 'voting_closed' });

  // The GLOBAL repo, not req.repo: a vote link is un-scoped by nature (the public
  // route has no tenant until the token resolves), so it is absent from
  // TENANT_METHODS. `req.tenantId` is the round's OWNER tenant — resolveRoundGrant
  // has already re-scoped it when the caller reached this round through a grant —
  // so a grantee's link points at the owner's tenant, which is where the session is.
  const link = await repo.createSessionVoteLink({
    tenantId: req.tenantId,
    roundId: req.params.rid,
    sessionId: req.params.sid,
  });
  // The token only — never a full URL. The server does not reliably know the
  // origin the group is actually using (custom domains, the *.up.railway.app
  // host), and the client does: it is the page the sharer is looking at.
  res.status(201).json({ token: link.id });
});

// LEGACY (#655): the whole-map write the hot-seat wizard used to do at the end.
//
// Nothing in the current client calls this — every vote now goes through
// `/votes/:pid` as it is given. It stays because the service worker serves the
// app shell cache-first, so a browser still holding the previous bundle runs the
// old wizard and POSTs here; removing the route would strand that client with no
// way to save an evening it has already collected. Delete it a release or two on,
// once no stale bundle can plausibly still be in use.
router.post('/:sid/results', async (req, res) => {
  // Light probe: this route only needs "does the round exist" — not every game
  // and vote map of the round.
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  // The session itself is read for its guest ids (#458), which decide whose
  // retire flags get dropped below.
  const stored = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!stored) return res.status(404).json({ error: 'Session not found' });

  const body = validateBody(saveResultsSchema, req, res);
  if (!body) return;
  const votes = dropGuestRetireFlags(body.votes, stored);
  // One entry per person who actually rated (#209). The hot-seat wizard submits
  // everyone at once from the one device it ran on, so every entry shares the
  // same actor — which is exactly what the log should say about such a session.
  // Empty columns are skipped: the wizard seeds a key per participant, so
  // logging by key would credit a vote to someone who never gave one.
  const actor = actorSeat(round, req.userId);
  const voteEvents = Object.keys(votes)
    .filter((pid) => votes[pid] && Object.keys(votes[pid]).length > 0)
    .map((pid) => sessionEvent('voted', actor, { personId: pid }));
  const session = await req.repo.saveSessionResults(req.params.rid, req.params.sid, votes, voteEvents);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

/* The multi-table builder's proposals (#796) — computed lazily on first open and
   PERSISTED, so the recommendation never moves under the group.

   Why the server and not the client: the search uses randomised restarts, and
   several people are looking at their own devices (#209, #652) while the app
   shell is served cache-first, so during a rollout some of them would be running
   an older algorithm than the others. Two people would see different splits at
   the same moment, and a reload would produce a third. The votes are frozen once
   the session is done, so there is no legitimate reason for the answer to move at
   all.

   A POST rather than a GET because it writes. The write is first-writer-wins in
   the repo, and the search is seeded from the session id — so two simultaneous
   first opens compute byte-identical proposals and the loser of the race has
   produced the same answer anyway.

   Gated exactly like the other reads of a closed session: anyone who can reach
   the round. There is no host in this router (.claude/rules/per-device-session-voting.md
   section 3), and the builder is what the whole group is standing around. */
router.post('/:sid/tables', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = (round.sessions || []).find((s) => s.id === req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.multiTable) return res.status(400).json({ error: 'not_multi_table' });
  if (session.cancelled) return res.status(400).json({ error: 'Session is cancelled' });
  // Before the vote closes there is nothing to split on: the columns are still
  // arriving, and a proposal built from half of them would be persisted forever.
  if (!session.done) return res.status(400).json({ error: 'voting_open' });

  if (Array.isArray(session.tableProposals)) return res.json({ proposals: session.tableProposals });

  const updated = await req.repo.setSessionTableProposals(
    req.params.rid,
    req.params.sid,
    computeTableProposals(round, session)
  );
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  res.json({ proposals: updated.tableProposals || [] });
});

/* Confirm a split: one child session per table (#796).

   A child is an ordinary direct-pick session (#532) — which consults NO player
   range, so `validateSplitTables` has to check the ranges itself; nothing
   downstream would catch an over-full table.

   The children are created first and the parent claims them afterwards, because
   there is no id to link before they exist. The claim is first-writer-wins, so a
   double tap cannot double the evening — and the writer that loses deletes the
   sessions it just made rather than leaving them orphaned. */
router.post('/:sid/split', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = (round.sessions || []).find((s) => s.id === req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.multiTable) return res.status(400).json({ error: 'not_multi_table' });
  if (session.cancelled) return res.status(400).json({ error: 'Session is cancelled' });
  if (!session.done) return res.status(400).json({ error: 'voting_open' });
  if (session.chosenGameId || session.finished)
    return res.status(400).json({ error: 'A game is already chosen for this session' });
  if (sessionChildIds(session).length)
    return res.status(400).json({ error: 'already_split' });

  const tables = Array.isArray(req.body && req.body.tables) ? req.body.tables : null;
  const bad = validateSplitTables(round, session, tables);
  if (bad) return res.status(400).json({ error: bad });

  const actor = actorSeat(round, req.userId);
  const started = sessionEvent('started', actor);
  const children = [];
  for (const blob of buildChildSessions(round, session, tables, started)) {
    // Sequential on purpose: `createSession` is one transaction per row in the
    // Postgres backend, and firing them concurrently on one pooled connection is
    // the shape .claude/rules/postgres-backend.md warns about.
    const child = await req.repo.createSession(req.params.rid, blob);
    if (!child) return res.status(404).json({ error: 'Round not found' });
    children.push(child);
    trackEvent('session_created', { tenantId: req.tenantId });
  }

  const claim = await req.repo.splitSession(
    req.params.rid,
    req.params.sid,
    children.map((c) => c.id),
    sessionEvent('split', actor, { count: children.length })
  );
  if (!claim || !claim.claimed) {
    // Somebody else confirmed the same split while this request was creating its
    // children. Theirs are the ones recorded, so ours are strays — clean them up
    // rather than leaving parentless tables on the hub.
    for (const child of children) await req.repo.deleteSession(req.params.rid, child.id);
    if (!claim) return res.status(404).json({ error: 'Session not found' });
    return res.status(409).json({ error: 'already_split' });
  }
  res.status(201).json({ session: claim.session, children });
});

// Remember the session's chosen game (or clear it with null).
router.post('/:sid/choice', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.cancelled)
    return res.status(400).json({ error: 'Session is cancelled' });
  // The parent of a split was never played at one table (#796) — choosing a game
  // for it would put it back in the played counts its children already fill.
  if (sessionChildIds(session).length)
    return res.status(400).json({ error: 'already_split' });
  const gameId = req.body.gameId === null ? null : String(req.body.gameId || '');
  if (gameId !== null && !session.gameIds.includes(gameId))
    return res.status(400).json({ error: 'Game does not belong to this session' });

  const updated = await req.repo.setSessionChoice(
    req.params.rid,
    req.params.sid,
    gameId,
    gameId
      ? sessionEvent('game_chosen', actorSeat(round, req.userId), { gameId })
      : sessionEvent('game_unchosen', actorSeat(round, req.userId))
  );
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  res.json(updated);
});

// Mark the game as played/finished and record winners (finished:false resets it).
router.post('/:sid/finish', async (req, res) => {
  // Meta carries the members; the session read below supplies its guests, and
  // together they are the whole winner allowlist.
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const body = validateBody(finishSchema, req, res);
  if (!body) return;
  const finished = req.body.finished !== false; // default: true
  let winnerIds = [];
  if (finished) {
    if (session.cancelled)
      return res.status(400).json({ error: 'Session is cancelled' });
    // A guest can genuinely win the game, so the allowlist is the round's
    // members ∪ THIS session's guests (#458) — never another session's, which is
    // why it is rebuilt per request from the stored blob rather than cached.
    const allowed = new Set(round.members.map((m) => m.id));
    (session.guests || []).forEach((g) => allowed.add(g.id));
    winnerIds = body.winnerIds.filter((wid) => allowed.has(wid));
  }
  const updated = await req.repo.finishSession(
    req.params.rid,
    req.params.sid,
    { finished, winnerIds },
    sessionEvent(finished ? 'finished' : 'unfinished', actorSeat(round, req.userId))
  );
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  // This route also UN-finishes (finished:false) — only the real finish counts.
  if (finished) {
    trackEvent('session_finished', { tenantId: req.tenantId });
    // Freundeskreis feed (#325): "‹user› hat ‹Spiel› gespielt". The played game is
    // the session's chosen one; carry its title + cover snapshot only (never
    // members, winners or scores — those are the round's own data). Best-effort.
    //
    // On the TRANSITION only (#856). The results screen has no save button — every
    // winner-chip tap re-POSTs this route with `finished: true`, so an emit per
    // request announced one evening as three plays. `session` is the pre-mutation
    // read above, so an un-finish followed by a re-finish is still a real second
    // play and correctly emits again.
    if (!session.finished && session.chosenGameId) {
      const game = await req.repo.getGame(req.params.rid, session.chosenGameId);
      if (game) await emitFeedEvent(req.userId, { type: 'session_played', title: game.title, coverUrl: game.image });
    }
  }
  res.json(updated);
});

// Cancel the session: no game appealed, nothing gets played (cancelled:false
// undoes it). A final state, mutually exclusive with choosing/finishing a game.
router.post('/:sid/cancel', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const cancelled = req.body.cancelled !== false; // default: true
  if (cancelled && (session.chosenGameId || session.finished))
    return res.status(400).json({ error: 'A game is already chosen for this session' });
  // A split parent is already resolved (#796), and its children are real
  // sessions people are sitting down to. Letting it be cancelled would produce
  // the one blob `sessionOutcome` cannot describe honestly: an evening marked
  // „Abgebrochen" listing the three tables it spawned.
  if (cancelled && sessionChildIds(session).length)
    return res.status(400).json({ error: 'already_split' });

  const updated = await req.repo.cancelSession(
    req.params.rid,
    req.params.sid,
    cancelled,
    sessionEvent(cancelled ? 'cancelled' : 'uncancelled', actorSeat(round, req.userId))
  );
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  // Same hygiene as /close (#652) — but only in the cancelling direction. This
  // route also UN-cancels, and re-minting a link there is the sharer's call: the
  // old token is already out in a chat, so silently reviving it would resurrect a
  // capability people believed they had cancelled.
  if (cancelled) await dropVoteLink(req.params.rid, req.params.sid);
  res.json(updated);
});

// Remove a single game from a session: drop it from the game list and delete
// every member's vote for it. If it was the chosen/played game, that choice
// (and any recorded result) is reset too.
router.delete('/:sid/games/:gid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.gameIds.includes(req.params.gid))
    return res.status(404).json({ error: 'Game does not belong to this session' });

  const updated = await req.repo.removeSessionGame(
    req.params.rid,
    req.params.sid,
    req.params.gid,
    sessionEvent('game_removed', actorSeat(round, req.userId), { gameId: req.params.gid })
  );
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  res.json(updated);
});

router.delete('/:sid', async (req, res) => {
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  // The role gate (lib/round-access.js) admits any grantee here, because the same
  // path carries two different acts and only the session tells them apart (#857).
  // Discarding a vote that is STILL RUNNING destroys nothing the group made — no
  // result, no winners, no Chronik entry — so it is part of running the evening.
  // Anything else is real shared history and stays co-owner-only, refused with the
  // same code the gate uses so the client's error handling is unchanged.
  //
  // `!done` alone is NOT the boundary, though the Start ticket's own filter makes
  // it look like it: cancelSession never touches `done`, so a vote cancelled
  // before a game was chosen stays `done: false` while being a resolved evening
  // the Chronik draws as „Abgebrochen". The predicate is therefore both flags,
  // exactly the pair the live-vote ticket renders. Deliberately narrower than
  // sessionOutcome() === 'open', which also covers `done && !finished` — the
  // in-progress results screen, whose own discard is co-owner-only.
  const session = await req.repo.getSession(req.params.rid, req.params.sid);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const stillVoting = !session.done && !session.cancelled;
  if (!stillVoting && !can(req.roundRole, 'session.delete')) {
    return res.status(403).json({ error: 'not_owner' });
  }
  const deleted = await req.repo.deleteSession(req.params.rid, req.params.sid);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  // #652: the session is gone, so its link can never resolve to anything again.
  await dropVoteLink(req.params.rid, req.params.sid);
  res.json({ ok: true });
});

module.exports = router;
