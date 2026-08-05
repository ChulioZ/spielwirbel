'use strict';

/*
 * Data-access layer — JSON file backend (issue #127).
 *
 * The default backend (used unless DATABASE_URL is set — see ./index.js): the
 * in-memory tree from lib/store.js persisted to data/data.json. Keeps local dev
 * zero-dependency. The PostgreSQL backend (./postgres.js) implements this same
 * async contract, so routes never change when the backend does.
 *
 * The API is async (returns Promises) even though this backend is synchronous, so
 * the two backends are interchangeable; Express 5 forwards any rejection to the
 * central error handler (see lib/app.js).
 *
 * Reads (getRound/listRounds) return deep-cloned SNAPSHOTS: callers must persist
 * changes through the write methods below, not by mutating a returned object.
 * This mirrors a real database (a fetched row is a copy) and keeps this backend
 * honest about the same contract, so both backends behave alike.
 *
 * Not-found is signalled by a `null` return (never a throw), matching how the
 * routes branch to a 404 today.
 *
 * Tenancy (issue #136): every round-scoped method takes the caller's tenant id
 * first and only ever sees that tenant's rounds — a wrong-tenant lookup is
 * indistinguishable from not-found. Rounds store it as `tenantId`; rows written
 * before tenancy have no key and count as tenant 'default' (the single
 * pre-tenancy group). The field is internal: snapshots strip it, so the API
 * payloads don't change shape.
 */

const crypto = require('crypto');
const { data, saveData, id } = require('../store');
// The demo classifier lives in its own dependency-free leaf module: lib/demo.js
// requires the repo, so requiring it back from here would be a cycle.
const { isDemoTenant } = require('../demo-tenant');
// The session activity log (#209): appended inside withSession, so the entry
// is written by the same read-modify-write that persists what it records.
const { pushSessionEvents } = require('../session-events');

const clone = (v) => (v == null ? v : structuredClone(v));

// One newest-first page of an append-ordered global log (moderationLog, feedback
// — #288). Reversing before slicing is what keeps this in lockstep with the
// Postgres backend's `orderBy('seq','desc').offset().limit()`: slicing the
// oldest-first array first would page from the wrong end.
const page = (rows, limit, offset) => rows.slice().reverse().slice(offset, offset + limit);

// The legacy single-group tenant every pre-tenancy row belongs to; legacy
// (accounts-off) mode runs entirely as this tenant.
const DEFAULT_TENANT = 'default';
// The tenant a stored round belongs to (pre-tenancy rows have no tenantId).
const tenantOf = (round) => round.tenantId || DEFAULT_TENANT;

// Assembled-round snapshot WITHOUT the activity feed (issue #197): the feed is
// the only unbounded collection and only the Chronik view reads it, so it is
// served by listActivities() instead of riding along on every round fetch.
// tenantId is scoping metadata, not payload — stripped like the feed.
const snapshot = (round) => {
  if (!round) return null;
  const copy = clone(round);
  delete copy.activities;
  delete copy.tenantId;
  return copy;
};

// Live (mutable) round lookup — internal to the write methods only, and the
// single place the tenant filter is applied. Callers get snapshots; only the
// write path here touches the persisted tree.
const live = (tenant, rid) => data.rounds.find((r) => r.id === rid && tenantOf(r) === tenant);

// Append an activity entry to a live round (the feed). Same shape as
// store.pushActivity, kept here so activity creation is part of the data layer.
function addActivity(round, type, payload, actorMemberId) {
  if (!Array.isArray(round.activities)) round.activities = [];
  const entry = { id: id(), type, at: new Date().toISOString(), ...payload };
  // Who did it (#207) — the acting account's member seat, when one is known.
  // Absent otherwise (owner not linked to a seat, or legacy mode), so a
  // single-actor round's feed is byte-for-byte unchanged.
  if (actorMemberId) entry.actorMemberId = actorMemberId;
  round.activities.push(entry);
}

/* ---------------------------------- Rounds --------------------------------- */

async function listRounds(tenant) {
  return data.rounds.filter((r) => tenantOf(r) === tenant).map(snapshot);
}

// The home-screen summary: identity, live counts, the design and a "last
// played" highlight per round — WITHOUT the games/sessions/activities payload.
// This shape used to be computed in lib/routes/rounds.js from full listRounds()
// data; it moved into the data layer so the Postgres backend can answer it in
// one small statement instead of assembling the tenant's whole dataset. Both
// backends must produce the identical shape (contract-tested):
//   { id, name, members: [{ id, name, color? }], memberCount, gameCount,
//     sessionCount, playedCount, background, lastPlayed:
//     { gameTitle, winnerNames, at } | null }
// gameCount counts ACTIVE games only (both archives excluded, #250) — it also
// drives the import dropdown's "n games", and createRound's import skips
// retired AND completed, so counting either would promise more games than the
// copy delivers. `color` stays absent until a member ever had one written
// (absent-key parity, mirrored by the Postgres `data ? 'color'` check).
// One round's home summary — counts + the "last played" highlight. Factored out
// so listRoundSummaries and the single-round getRoundSummary (#207 home-merge)
// build the exact same shape.
function roundSummary(r) {
  // Newest finished session whose chosen game still exists (same rule as the
  // round screen's "Zuletzt gespielt" line). Ordered by createdAt — when the
  // session was played — like the Chronik; re-finishing an older session
  // must not jump it to the top.
  const lastPlayed = r.sessions
    .filter((s) => s.finished && s.chosenGameId && r.games.some((g) => g.id === s.chosenGameId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const lastGame = lastPlayed && r.games.find((g) => g.id === lastPlayed.chosenGameId);
  return {
    id: r.id,
    name: r.name,
    members: r.members.map((m) => {
      const out = { id: m.id, name: m.name };
      if ('color' in m) out.color = m.color;
      return out;
    }),
    memberCount: r.members.length,
    gameCount: r.games.filter((g) => !g.retired && !g.completed).length,
    sessionCount: r.sessions.length,
    playedCount: r.sessions.filter((s) => s.finished).length,
    background: r.background ? structuredClone(r.background) : null,
    lastPlayed: lastPlayed
      ? {
          gameTitle: lastGame.title,
          winnerNames: (lastPlayed.winnerIds || [])
            .map((wid) => (r.members.find((m) => m.id === wid) || {}).name)
            .filter(Boolean),
          at: lastPlayed.createdAt,
        }
      : null,
  };
}

async function listRoundSummaries(tenant) {
  return data.rounds.filter((r) => tenantOf(r) === tenant).map(roundSummary);
}

// One round's summary, or null if it is missing / another tenant's.
async function getRoundSummary(tenant, rid) {
  const r = live(tenant, rid);
  return r ? roundSummary(r) : null;
}

async function getRound(tenant, rid) {
  return snapshot(live(tenant, rid));
}

// The light validation read: everything getRound carries except the
// games/sessions collections. Mutation routes fetch the round only to 404 and
// to validate against tags/providers/members — the full snapshot (every game
// plus every session's vote map) made each write as expensive as the biggest
// read on the Postgres backend, so the routes ask for this instead. Key
// semantics match getRound: background always present, tags/providers/
// lastSessionFilters only when they have ever been written.
async function getRoundMeta(tenant, rid) {
  const r = live(tenant, rid);
  if (!r) return null;
  const out = {
    id: r.id,
    name: r.name,
    members: clone(r.members),
    background: clone(r.background) ?? null,
  };
  if (r.tags != null) out.tags = clone(r.tags);
  if (r.providers != null) out.providers = clone(r.providers);
  if (r.lastSessionFilters != null) out.lastSessionFilters = clone(r.lastSessionFilters);
  return out;
}

// One session / one game by id, without assembling the whole round — the
// write routes validate against a single entity. Wrong round or tenant reads
// as not-found, like everywhere else.
async function getSession(tenant, rid, sid) {
  const r = live(tenant, rid);
  const s = r && r.sessions.find((x) => x.id === sid);
  return s ? clone(s) : null;
}

async function getGame(tenant, rid, gid) {
  const r = live(tenant, rid);
  const g = r && r.games.find((x) => x.id === gid);
  return g ? clone(g) : null;
}

// Create a round from already-validated input: `members` is a list of names,
// `importFromRoundId` optionally copies the active games (title/image only) from
// an existing round — of the same tenant only. `owner` ({ name, userId }, #421)
// is the creator's own seat: PREPENDED ahead of the typed names, and the only
// member carrying a `userId`. When absent, a member's shape is byte-identical to
// before — { id, name }, no `userId` key (absent-key parity with Postgres).
async function createRound(tenant, { name, members, owner, importFromRoundId }) {
  const round = {
    id: id(),
    tenantId: tenant,
    name,
    members: [
      ...(owner ? [{ id: id(), name: owner.name, userId: owner.userId }] : []),
      ...members.map((nm) => ({ id: id(), name: nm })),
    ],
    games: [],
    sessions: [],
    activities: [],
    background: null,
  };

  const src = importFromRoundId ? live(tenant, importFromRoundId) : null;
  if (src) {
    src.games
      .filter((g) => !g.retired && !g.completed)
      .forEach((g) => {
        // Shares the same image file (files are never deleted); only
        // title/image are carried over.
        const ng = {
          id: id(),
          title: g.title,
          image: g.image,
          retired: false,
          retiredAt: null,
          completed: false,
          completedAt: null,
        };
        round.games.push(ng);
        addActivity(round, 'game_added', { gameId: ng.id, title: ng.title });
      });
  }

  data.rounds.push(round);
  saveData();
  return snapshot(round);
}

// Rename a round (#562). Returns the updated round snapshot (the same shape
// getRound answers with), or null if the round is missing or belongs to another
// tenant — indistinguishable, like every other round-scoped method.
//
// An unchanged name writes NO activity: the entry exists so an owner can see who
// renamed their shared round, and "renamed it to what it was already called" is
// noise in exactly the feed that has to stay readable. The frontend already
// declines to send one; this makes it true for a hand-rolled request too.
//
// The entry carries only the NEW name, matching `game_added`'s single-field
// shape. Storing the previous name as well would read nicely in the Chronik, but
// it would put a second copy of user-authored text somewhere `redactText` does
// not reach — an operator who redacts a round's name would leave the old one
// visible in the feed.
async function renameRound(tenant, rid, name, actorMemberId) {
  const round = live(tenant, rid);
  if (!round) return null;
  if (round.name === name) return snapshot(round);
  round.name = name;
  addActivity(round, 'round_renamed', { name }, actorMemberId);
  saveData();
  return snapshot(round);
}

// Delete a round and report the cover paths it freed, so the ROUTE can delete
// the stored objects — the same shape eraseAccount uses, and for the same
// reason: once the row is gone the key is unrecoverable, so the images have to
// be collected BEFORE the delete or the objects are orphaned forever (#280).
// Returns null when the round is unknown, else { images } (deduped — an
// imported round shares a cover path rather than the file, so the route still
// checks isImageReferenced before removing each one).
async function deleteRound(tenant, rid) {
  const idx = data.rounds.findIndex((r) => r.id === rid && tenantOf(r) === tenant);
  if (idx === -1) return null;
  const round = data.rounds[idx];

  const images = new Set();
  for (const game of round.games) if (game.image) images.add(game.image);
  // Legacy collage backgrounds are hosted uploads too (see lib/routes/background.js).
  if (round.background && round.background.type === 'collage' && round.background.image) {
    images.add(round.background.image);
  }

  data.rounds.splice(idx, 1);
  // The round's vote links (#652) go with it. Not an access control — the public
  // route re-reads the session and 404s either way once the round is gone — but
  // the rows would otherwise outlive every round they name, forever.
  for (let i = data.sessionVoteLinks.length - 1; i >= 0; i -= 1) {
    if (data.sessionVoteLinks[i].roundId === rid) data.sessionVoteLinks.splice(i, 1);
  }
  saveData();
  return { images: [...images] };
}

/* ---------------------------------- Users ----------------------------------- */
/*
 * Accounts (issue #135) live OUTSIDE rounds — top-level data.users, global (not
 * tenant-scoped): users are the identity layer tenants hang off, looked up by
 * email at login before any tenant is known. Each user carries the `tenantId`
 * it acts as (#136; minted at registration). Every key is always present (null
 * when unset) so both backends round-trip identically (see
 * .claude/rules/postgres-backend.md on absent-key parity). updateUser replaces
 * whole top-level keys (arrays/objects included), matching jsonb `||` semantics.
 */

// The app-wide public handle (#320) is matched case-insensitively — `Anna` and
// `anna` are the same account — while the casing the user typed is preserved for
// display. Guarded on `u.username` so a row predating the field can't collide
// with the literal string "undefined".
const sameUsername = (u, name) =>
  !!u.username && String(u.username).toLowerCase() === name.toLowerCase();

// Insert a user from route-built fields (email pre-normalized, hashes computed).
// Mints the id. Returns the user, or 'username_taken'/'email_taken'.
async function createUser(fields) {
  // The username is checked FIRST, deliberately: a submission colliding on both
  // must answer 'username_taken' whether or not the e-mail exists. Answering
  // 'email_taken' here would turn the OPEN username error into a probe for the
  // deliberately HIDDEN e-mail one — see lib/routes/account.js.
  if (fields.username && data.users.some((u) => sameUsername(u, fields.username))) return 'username_taken';
  if (data.users.some((u) => u.email === fields.email)) return 'email_taken';
  const user = { id: id(), ...fields };
  data.users.push(user);
  saveData();
  return clone(user);
}

async function getUserById(uid) {
  return clone(data.users.find((u) => u.id === uid) || null);
}

async function getUserByEmail(email) {
  return clone(data.users.find((u) => u.email === email) || null);
}

// Resolve the public handle (#320) — how an abuse report names an account, and
// how invitations (#207) will find one. Global like every other user method.
async function getUserByUsername(username) {
  const name = String(username || '').trim();
  if (!name) return null;
  return clone(data.users.find((u) => sameUsername(u, name)) || null);
}

// Replace whole top-level keys with the patch's values. Returns user or null.
async function updateUser(uid, patch) {
  const user = data.users.find((u) => u.id === uid);
  if (!user) return null;
  Object.assign(user, patch);
  saveData();
  return clone(user);
}

async function deleteUser(uid) {
  const idx = data.users.findIndex((u) => u.id === uid);
  if (idx === -1) return false;
  data.users.splice(idx, 1);
  saveData();
  return true;
}

// Every user, for the operator's account list (issue #268). Global like the
// other user methods. The ROUTE is responsible for stripping secrets before
// this reaches a response — the repo returns the stored shape, as it does
// everywhere else.
async function listUsers() {
  return data.users.map((u) => clone(u));
}

/*
 * Demo accounts (#427). Global like every other user method — a demo account is
 * an identity, and the purge job that reads these holds no tenant.
 *
 * Both compare `demoExpiresAt` as TEXT: ISO-8601 sorts lexicographically, so a
 * string compare is a correct time compare and one malformed historical value
 * can't error the whole sweep (the same reasoning listModeration applies to its
 * `at` field). Pass `now` as an ISO string.
 *
 * A demo row with NO expiry counts as EXPIRED, never as live — it is malformed,
 * and for a disposable account the safe direction to fail in is "clean it up".
 * The two predicates are exact complements so a row can never be both, which is
 * what keeps the cap honest: anything the count does not see, the purge will.
 */
const liveDemo = (u, now) => u.demo === true && String(u.demoExpiresAt || '') > now;

async function countLiveDemoUsers(now) {
  return data.users.filter((u) => liveDemo(u, now)).length;
}

/*
 * The per-IP live-demo cap (#502). Same liveness predicate as the count above —
 * so erasing or purging a demo frees the IP's slot too, and the cap can never
 * count a row the purge has already claimed.
 *
 * `ipHash` must be a non-empty string: an empty one is answered 0 rather than
 * matched, because a row whose mint could not be attributed stores `null` and
 * every such row would otherwise collapse into one shared bucket. The caller
 * skips the check entirely in that case; this is the second half of the same
 * fence.
 */
async function countLiveDemoUsersByIp(now, ipHash) {
  if (!ipHash) return 0;
  return data.users.filter((u) => liveDemo(u, now) && u.demoIpHash === ipHash).length;
}

async function listExpiredDemoUsers(now) {
  return data.users
    .filter((u) => u.demo === true && String(u.demoExpiresAt || '') <= now)
    .map((u) => u.id);
}

/* -------------------------------- Moderation -------------------------------- */
/*
 * Operator tooling (issue #268) — deliberately GLOBAL (cross-tenant), because an
 * abuse notice names an image, not a tenant. These are the only repo methods that
 * intentionally see past the tenant boundary, so they are NOT in TENANT_METHODS
 * and a route reaches them via the module-level repo, never req.repo.
 */

// Resolve a stored '/uploads/<key>' cover path to its owning game/round/tenant.
// Returns null when no game references it (an orphaned object, or already taken
// down). Matches the exact stored string, the same comparison isImageReferenced
// uses — a key is only ever stored in that one canonical form.
async function findImageOwner(image) {
  for (const round of data.rounds) {
    const game = round.games.find((g) => g.image === image);
    if (game) {
      return {
        image,
        tenantId: tenantOf(round),
        roundId: round.id,
        roundName: round.name,
        gameId: game.id,
        gameTitle: game.title,
      };
    }
  }
  return null;
}

// Clear the cover from every game referencing this path, across all tenants.
// Returns the number of games changed (0 when nothing referenced it), so the
// caller can report an already-clean object honestly instead of claiming a
// takedown that did nothing. The stored object itself is removed by the route
// via lib/storage, mirroring how deleteGame hands the path back for cleanup.
async function takedownImage(image) {
  let cleared = 0;
  for (const round of data.rounds) {
    for (const game of round.games) {
      if (game.image === image) {
        game.image = null;
        cleared += 1;
      }
    }
  }
  if (cleared) saveData();
  return cleared;
}

/* --------------------- Broader lookup & redaction (#275) -------------------- */
/*
 * #268 could only answer "who owns this image?". An abuse notice or support mail
 * usually names a ROUND LINK or an e-mail address instead, and the offending
 * content is just as often a title or a name as a picture — so these add the two
 * missing halves: resolve a round to its tenant, summarise what a tenant holds,
 * list a round's user-authored text, and redact one field of it.
 *
 * Global (cross-tenant) like the rest of this section, and absent from
 * TENANT_METHODS for the same reason.
 */

// Resolve a round id to its tenant, so a reported round link becomes actionable.
// The round NAME is returned too: it is itself user-authored text, and a notice
// about a round is usually a notice about what it is called.
async function findRoundOwner(roundId) {
  const round = data.rounds.find((r) => r.id === roundId);
  if (!round) return null;
  return { roundId: round.id, roundName: round.name, tenantId: tenantOf(round) };
}

// What one tenant holds: per-round counts plus totals, and every cover path it
// references. COUNTS only — the round/game/member/tag text lives behind
// roundContent() so a summary of a tenant at the games quota (1000/round) stays
// small enough to render.
//
// `images` is returned raw and deduped (an imported round shares a cover path
// rather than the file). The ROUTE decides which of them are ours to size — the
// repo has no business knowing that a hotlinked provider URL isn't in our
// bucket. Same division of labour as eraseAccount.
async function tenantSummary(tenantId) {
  if (!tenantId) return null;
  const images = new Set();
  const rounds = data.rounds
    .filter((r) => tenantOf(r) === tenantId)
    .map((r) => {
      for (const g of r.games) if (g.image) images.add(g.image);
      return {
        id: r.id,
        name: r.name,
        members: r.members.length,
        games: r.games.length,
        // Both archives excluded, matching what "the active collection" means
        // everywhere else (.claude/rules/active-games-filter-sites.md).
        activeGames: r.games.filter((g) => !g.retired && !g.completed).length,
        sessions: r.sessions.length,
        tags: (r.tags || []).length,
      };
    });

  const sum = (key) => rounds.reduce((n, r) => n + r[key], 0);
  return {
    tenantId,
    rounds,
    totals: {
      rounds: rounds.length,
      members: sum('members'),
      games: sum('games'),
      activeGames: sum('activeGames'),
      sessions: sum('sessions'),
      tags: sum('tags'),
    },
    images: [...images],
  };
}

// Every user-authored string in one round, so the operator can see the reported
// text and act on it. Deliberately NOT part of tenantSummary: this is the
// drill-down, and it is unbounded in a way the summary must not be.
async function roundContent(roundId) {
  const round = data.rounds.find((r) => r.id === roundId);
  if (!round) return null;
  return {
    roundId: round.id,
    roundName: round.name,
    tenantId: tenantOf(round),
    members: round.members.map((m) => ({ id: m.id, name: m.name })),
    games: round.games.map((g) => ({ id: g.id, title: g.title })),
    tags: (round.tags || []).map((tg) => ({ id: tg.id, name: tg.name })),
  };
}

// Overwrite one user-authored text field with `replacement`, returning what was
// there (for the log entry) or null when the target does not exist.
//
// A tag is redacted by NAME only — its id survives, so `game.tagIds` keeps
// pointing at it and no game silently loses a tag as a side effect of a
// moderation action. Same reasoning for every other kind: this blanks text, it
// never deletes a row (deletion is erasure, #273, and must stay a separate act).
async function redactText({ kind, roundId, id: targetId }, replacement) {
  if (kind === 'feedback') {
    const entry = data.feedback.find((f) => f.id === targetId);
    if (!entry) return null;
    const previous = entry.message;
    entry.message = replacement;
    saveData();
    return {
      kind, tenantId: (entry.context || {}).tenantId || null, roundId: null, id: targetId, previous,
    };
  }

  const round = data.rounds.find((r) => r.id === roundId);
  if (!round) return null;

  let holder = null;
  let field = null;
  if (kind === 'round') { holder = round; field = 'name'; }
  else if (kind === 'game') { holder = round.games.find((g) => g.id === targetId); field = 'title'; }
  else if (kind === 'member') { holder = round.members.find((m) => m.id === targetId); field = 'name'; }
  else if (kind === 'tag') { holder = (round.tags || []).find((tg) => tg.id === targetId); field = 'name'; }
  if (!holder) return null;

  const previous = holder[field];
  holder[field] = replacement;
  saveData();
  return {
    kind, tenantId: tenantOf(round), roundId: round.id, id: kind === 'round' ? round.id : targetId, previous,
  };
}

/* --------------------------- Erasure & export (#273) ------------------------ */
/*
 * Art. 17 (erasure) and Art. 15/20 (access/portability), operator-side. Global
 * like the rest of this section: the operator names an ACCOUNT, and the account
 * is what carries the tenant id — so these take a uid/tenant rather than riding
 * on req.repo.
 */

// Everything held for one tenant, for an access request. Unlike a snapshot this
// DOES include the activity feed: "everything you hold about me" has to mean
// everything, and the feed is held data (snapshots strip it only because it is
// unbounded and no view needs it — issue #197). tenantId is still stripped: it
// is our scoping metadata, not the subject's data.
async function exportTenant(tenant) {
  if (!tenant) return { tenantId: null, rounds: [] };
  const rounds = data.rounds
    .filter((r) => tenantOf(r) === tenant)
    .map((r) => {
      const copy = clone(r);
      delete copy.tenantId;
      return copy;
    });
  return { tenantId: tenant, rounds };
}

// The account's rows in the five GLOBAL stores (grants, invitations, inbox,
// friendships, feed events), for the same Art. 15/20 export. This is the READ
// mirror of eraseAccount's global-store cleanup below: what erasure deletes as the
// account's personal data, export must hand back. The two enumerations MUST stay
// identical — the contract suite pins the symmetry, so the next store added to one
// fails loudly if it's missed in the other. `tenant` is the account's tenant, used
// only for the owner-side rows (grants/invitations that sit on the account's own
// rounds), exactly as erasure uses it.
async function exportAccountData(uid, tenant = null) {
  const t = tenant || null;
  return {
    grants: data.roundGrants
      .filter((g) => g.userId === uid || (t && g.ownerTenantId === t))
      .map((g) => clone(g)),
    invitations: data.invitations
      .filter((v) => v.inviteeUserId === uid || v.inviterUserId === uid || (t && v.ownerTenantId === t))
      .map((v) => clone(v)),
    inbox: data.inbox
      .filter((it) => it.userId === uid)
      .map((it) => clone(it)),
    friendships: data.friendships
      .filter((f) => f.requesterUserId === uid || f.addresseeUserId === uid)
      .map((f) => clone(f)),
    feedEvents: data.feedEvents
      .filter((e) => e.uid === uid)
      .map((e) => clone(e)),
  };
}

// Erase an account AND its tenant's round data, returning the freed
// '/uploads/<key>' paths so the ROUTE can delete the stored objects — the same
// clear-the-reference-then-delete-the-bytes ordering takedownImage uses, so a
// failure to delete bytes can never leave a row pointing at a missing object.
//
// Returns null when the account is unknown, the marker 'tenant_shared' when
// another account still lives on the same tenant (see below), else
// { tenantId, rounds, images }.
async function eraseAccount(uid) {
  // Held as an INDEX, not just the object: the removal below must never be
  // splice(findIndex(...), 1) — a -1 there silently deletes the LAST user
  // instead, i.e. erases the wrong person. Unreachable given the guard, but not
  // a shape to leave lying around in erasure code.
  const idx = data.users.findIndex((u) => u.id === uid);
  if (idx === -1) return null;
  const user = data.users[idx];
  const tenant = user.tenantId || null;

  // Erasure cascades the whole TENANT, so it must not run while a second
  // account still lives there — that round data is partly theirs, and erasing
  // it would be an unrequested deletion of a third party's data. Unreachable
  // today (registration mints a personal tenant per user) but tenant sharing is
  // planned (#207), and this is the failure mode you cannot undo afterwards.
  if (tenant && data.users.some((u) => u.id !== uid && (u.tenantId || null) === tenant)) {
    return 'tenant_shared';
  }

  // A cover path can be referenced by several games at once: createRound's
  // importFromRoundId copies the path rather than the file. Deduped so the route
  // deletes each object once. Import is same-tenant only, so no path collected
  // here can still be referenced by a surviving tenant.
  const images = new Set();
  let rounds = 0;
  if (tenant) {
    for (let i = data.rounds.length - 1; i >= 0; i -= 1) {
      const round = data.rounds[i];
      if (tenantOf(round) !== tenant) continue;
      for (const game of round.games) if (game.image) images.add(game.image);
      data.rounds.splice(i, 1);
      rounds += 1;
    }
  }

  // #207: erase the account's sharing rows too (global stores) — the grants it
  // held (as grantee) or that sat on its now-deleted rounds (as owner), the
  // invitations it sent or received, and its inbox items. Otherwise these outlive
  // the erasure carrying the account id + usernames/round names (Art. 17).
  for (let i = data.roundGrants.length - 1; i >= 0; i -= 1) {
    const g = data.roundGrants[i];
    if (g.userId === uid || (tenant && g.ownerTenantId === tenant)) data.roundGrants.splice(i, 1);
  }
  for (let i = data.invitations.length - 1; i >= 0; i -= 1) {
    const v = data.invitations[i];
    if (v.inviteeUserId === uid || v.inviterUserId === uid || (tenant && v.ownerTenantId === tenant)) {
      data.invitations.splice(i, 1);
    }
  }
  for (let i = data.inbox.length - 1; i >= 0; i -= 1) {
    if (data.inbox[i].userId === uid) data.inbox.splice(i, 1);
  }
  // #325: the account's friendships (as requester or addressee) and its feed
  // events — global stores that would otherwise outlive the erasure carrying the
  // account id and usernames/game titles.
  for (let i = data.friendships.length - 1; i >= 0; i -= 1) {
    const f = data.friendships[i];
    if (f.requesterUserId === uid || f.addresseeUserId === uid) data.friendships.splice(i, 1);
  }
  for (let i = data.feedEvents.length - 1; i >= 0; i -= 1) {
    if (data.feedEvents[i].uid === uid) data.feedEvents.splice(i, 1);
  }
  // #652: the tenant's vote links. Deliberately absent from exportAccountData
  // above, unlike every store in this block — a link row holds no personal data
  // (a random token plus the account's own three ids, which the round export
  // already returns), and it is a LIVE capability: writing one into a data export
  // the account downloads and may forward would hand the reader a working ballot.
  if (tenant) {
    for (let i = data.sessionVoteLinks.length - 1; i >= 0; i -= 1) {
      if (data.sessionVoteLinks[i].tenantId === tenant) data.sessionVoteLinks.splice(i, 1);
    }
  }

  data.users.splice(idx, 1);
  saveData();
  return { tenantId: tenant, rounds, images: [...images] };
}

// Append one operator action to the audit record. `entry` is route-built
// ({ action, target, reason, at, ... }); the id is minted here.
async function logModeration(entry) {
  const row = { id: id(), ...entry };
  data.moderationLog.push(row);
  saveData();
  return clone(row);
}

// Narrow the action record to what a question is actually about (#275): one
// tenant, one kind of action, a date range. `from`/`to` compare against the
// entry's ISO-8601 `at`, which sorts lexicographically in that format — the
// ROUTE widens a bare date to a full-day bound, so both backends see exact
// instants and can't disagree about what "until the 20th" includes.
//
// An absent/empty filter key means "don't filter on it", so listModeration(l, o)
// with no third argument stays exactly the pre-#275 call.
const matchesLog = (e, f) => (
  (!f.tenantId || (e.tenantId || null) === f.tenantId)
  && (!f.action || e.action === f.action)
  && (!f.from || String(e.at || '') >= f.from)
  && (!f.to || String(e.at || '') <= f.to)
);

const filteredLog = (filters) => {
  const f = filters || {};
  const any = f.tenantId || f.action || f.from || f.to;
  return any ? data.moderationLog.filter((e) => matchesLog(e, f)) : data.moderationLog;
};

// Most recent actions first. `offset` skips that many of the newest entries, so
// (limit, offset) walks backwards through history a page at a time (#288).
async function listModeration(limit = 100, offset = 0, filters) {
  return page(filteredLog(filters), limit, offset).map((e) => clone(e));
}

// Counts the SAME filtered set the list returns — the panel renders these as
// "20 von 20", so a total that ignored the filter would claim entries the
// "Mehr laden" button can never reach.
async function countModeration(filters) {
  return filteredLog(filters).length;
}

// The distinct action names present, so the panel's filter offers exactly the
// values that can match instead of a hardcoded list that drifts as actions are
// added (a redact_* kind was added by this very issue).
async function moderationActions() {
  return [...new Set(data.moderationLog.map((e) => e.action))].sort();
}

// One log entry by id (#272) — the Art. 17 statement of reasons is generated
// from the entry, so the route needs to load exactly one.
async function getModeration(eid) {
  const entry = data.moderationLog.find((e) => e.id === eid);
  return entry ? clone(entry) : null;
}

// Record on the entry that its Art. 17 statement of reasons was delivered
// (#272). Only the timestamp — the recipient address already lives on the
// entry's `email` where relevant, and the log must stay purgeable (#311).
async function markModerationStatement(eid, at) {
  const entry = data.moderationLog.find((e) => e.id === eid);
  if (!entry) return null;
  entry.statementSentAt = at;
  saveData();
  return clone(entry);
}

/* --------------------------------- Feedback --------------------------------- */
/*
 * In-app user feedback (issue #260). GLOBAL and un-scoped, exactly like `users`
 * and `moderationLog`: feedback is addressed TO the operator, who by definition
 * needs to read it across every tenant, so scoping it to one would defeat its
 * purpose. Not in TENANT_METHODS — reachable only on the module-level repo.
 */

// Append one submission. `entry` is route-built ({ message, context, createdAt });
// the id is minted here, mirroring logModeration.
async function createFeedback(entry) {
  const row = { id: id(), ...entry };
  data.feedback.push(row);
  saveData();
  return clone(row);
}

// Most recent submissions first, paged like listModeration.
async function listFeedback(limit = 100, offset = 0) {
  return page(data.feedback, limit, offset).map((f) => clone(f));
}

async function countFeedback() {
  return data.feedback.length;
}

// Delete one submission by id (issue #389). Global/un-scoped like the reads;
// the retention decision (a decided report is kept) lives in the route, not
// here — feedback carries no such duty, so this just removes the row. Returns
// the deleted row, or null when the id is unknown (mirrors the admin methods).
async function deleteFeedback(fid) {
  const i = data.feedback.findIndex((f) => f.id === fid);
  if (i === -1) return null;
  const [row] = data.feedback.splice(i, 1);
  saveData();
  return clone(row);
}

/* ------------------------------ Contact notices ----------------------------- */
/*
 * Stored contact-form submissions / DSA abuse notices (issue #272). GLOBAL and
 * un-scoped like `users`, `moderationLog` and `feedback`: a notice is addressed
 * TO the operator and usually comes from someone who is not a user at all. The
 * write is reached from lib/routes/contact.js; the read/decide side only from the
 * admin-gated lib/routes/admin.js. Not in TENANT_METHODS.
 */

// Append one submission. `entry` is route-built; the id is minted here,
// mirroring createFeedback.
async function createContactNotice(entry) {
  const row = { id: id(), ...entry };
  data.contactNotices.push(row);
  saveData();
  return clone(row);
}

// Most recent submissions first, paged like listFeedback.
async function listContactNotices(limit = 100, offset = 0) {
  return page(data.contactNotices, limit, offset).map((n) => clone(n));
}

async function countContactNotices() {
  return data.contactNotices.length;
}

// Apply the route-built decision fields (status/decidedAt/decisionNote/
// decisionSentAt) to one notice. Returns the notice, or null when it is gone.
async function setContactNoticeStatus(nid, fields) {
  const notice = data.contactNotices.find((n) => n.id === nid);
  if (!notice) return null;
  Object.assign(notice, fields);
  saveData();
  return clone(notice);
}

async function getContactNotice(nid) {
  const notice = data.contactNotices.find((n) => n.id === nid);
  return notice ? clone(notice) : null;
}

// Delete one notice by id (issue #389). Whether a DECIDED notice may be deleted
// (it is 3-year Art. 17 retention evidence) is enforced by the route, which
// reads the notice's decidedAt first — this method just removes the row and
// reports found (the deleted row) vs. not-found (null).
async function deleteContactNotice(nid) {
  const i = data.contactNotices.findIndex((n) => n.id === nid);
  if (i === -1) return null;
  const [row] = data.contactNotices.splice(i, 1);
  saveData();
  return clone(row);
}

/* ---------------------------------- Inbox ---------------------------------- */
/*
 * Per-user in-app inbox (issue #207). The generic notification surface that
 * account-scoped features deliver actionable items through — round invitations
 * (#207) and friend requests (#325) are the first consumers, added in later
 * slices; this foundation ships the store with no producer yet. GLOBAL and
 * un-scoped like `users`: an item is keyed by the RECIPIENT's account id, not a
 * tenant, so it is absent from TENANT_METHODS. Unlike the operator stores
 * (feedback/moderation) it IS reached from user-facing routes (lib/routes/account.js),
 * so every method scopes to the caller's own userId — a user may only ever read,
 * mark or dismiss their OWN items; another user's id is treated as not-found.
 */

// Keep at most this many items per user; the oldest are pruned on write so a
// misbehaving producer can't grow one user's inbox without bound. Read per call
// from env (like lib/quota.js) so it is tunable without a redeploy.
const inboxCap = () => Number(process.env.MAX_INBOX_ITEMS) || 100;

// Append one item for `userId`. `item` is { type, payload }; id/read/createdAt
// are minted here. Returns the stored item (a clone).
async function addInboxItem(userId, item) {
  const row = {
    id: id(),
    userId,
    type: item.type,
    payload: item.payload || {},
    read: false,
    createdAt: new Date().toISOString(),
  };
  data.inbox.push(row);
  // Prune this user's oldest items beyond the cap (insertion order == age).
  const mine = data.inbox.filter((it) => it.userId === userId);
  const over = mine.length - inboxCap();
  for (let i = 0; i < over; i++) {
    const idx = data.inbox.indexOf(mine[i]);
    if (idx !== -1) data.inbox.splice(idx, 1);
  }
  saveData();
  return clone(row);
}

// The caller's items, newest first.
async function listInbox(userId) {
  return data.inbox.filter((it) => it.userId === userId).reverse().map((it) => clone(it));
}

// Mark one of the caller's items read. Returns the item, or null when it is
// missing or belongs to someone else (indistinguishable on purpose).
async function markInboxRead(userId, itemId) {
  const item = data.inbox.find((it) => it.id === itemId && it.userId === userId);
  if (!item) return null;
  item.read = true;
  saveData();
  return clone(item);
}

// Remove one of the caller's items. Returns the removed item, or null.
async function dismissInboxItem(userId, itemId) {
  const idx = data.inbox.findIndex((it) => it.id === itemId && it.userId === userId);
  if (idx === -1) return null;
  const [removed] = data.inbox.splice(idx, 1);
  saveData();
  return clone(removed);
}

/* ------------------------------- Round grants ------------------------------ */
/*
 * Per-round access grants (issue #207) — the data model for round sharing. A
 * grant records that account `userId` may act on round `roundId`, which is owned
 * by tenant `ownerTenantId`, holding the member seat `memberId`, with `role`.
 *
 * GLOBAL and un-scoped, like `users` and unlike everything round-scoped: a grant
 * is inherently CROSS-tenant (it points a grantee at a round in someone else's
 * tenant), so it cannot live under the tenant facade — it is absent from
 * TENANT_METHODS. The resolver that turns a grant into access (a later slice of
 * #207) reads `listGrantsForUser`; this slice ships only the store, so nothing
 * creates a grant yet (invitation accept, #207, will).
 *
 * Uniqueness: one grant per (roundId, userId). A duplicate is reported as the
 * marker 'grant_exists' rather than a second row.
 */

// The user↔round pair a grant is keyed on (mirrors the Postgres unique index).
const sameGrant = (g, roundId, userId) => g.roundId === roundId && g.userId === userId;

async function createGrant({ roundId, ownerTenantId, userId, memberId = null, role = 'member' }) {
  if (data.roundGrants.some((g) => sameGrant(g, roundId, userId))) return 'grant_exists';
  const grant = { id: id(), roundId, ownerTenantId, userId, memberId, role, createdAt: new Date().toISOString() };
  data.roundGrants.push(grant);
  saveData();
  return clone(grant);
}

// Every grant a user holds — the resolver's read. Insertion order (stable).
async function listGrantsForUser(userId) {
  return data.roundGrants.filter((g) => g.userId === userId).map((g) => clone(g));
}

// Every grant on a round — for "who has access" and revocation on delete.
async function listGrantsForRound(roundId) {
  return data.roundGrants.filter((g) => g.roundId === roundId).map((g) => clone(g));
}

// Revoke one grant. Returns the removed grant, or null if there was none.
async function deleteGrant(roundId, userId) {
  const idx = data.roundGrants.findIndex((g) => sameGrant(g, roundId, userId));
  if (idx === -1) return null;
  const [removed] = data.roundGrants.splice(idx, 1);
  saveData();
  return clone(removed);
}

/* ---------------------------- Session vote links --------------------------- */
/*
 * Vote links (issue #652) — the capability behind the public /vote/:token screen.
 *
 * One row per shared per-device session. The token IS the primary key: it is the
 * only thing its holder has, and resolving it is what produces the tenant, the
 * round and the session to act on.
 *
 * GLOBAL and un-scoped like `round_grants`, for a sharper version of the same
 * reason: the caller is not authenticated at all, so there is no tenant to scope
 * the lookup BY — a tenant-scoped find could never be reached. Absent from
 * TENANT_METHODS, so an ordinary request handler holding only `req.repo` cannot
 * reach it.
 *
 * At most one live link per session: minting twice returns the row that already
 * exists, so a second tap on „Link teilen" hands out the same URL instead of
 * silently invalidating the one already sitting in the group chat.
 *
 * Note what this row deliberately does NOT decide: whether the link still works.
 * That is answered by reading the session it points at (open, per-device, not
 * cancelled), which is the one authoritative gate — see lib/routes/vote-link.js.
 * Deleting rows here is retention hygiene, not access control.
 */

// 192 bits, base64url so it survives a path segment untouched. Minted here
// rather than in the route: a token that is short or predictable is the whole
// vulnerability, so it must not be a per-caller decision.
const voteToken = () => crypto.randomBytes(24).toString('base64url');

async function createSessionVoteLink({ tenantId, roundId, sessionId }) {
  const existing = data.sessionVoteLinks.find((l) => l.roundId === roundId && l.sessionId === sessionId);
  if (existing) return clone(existing);
  const link = { id: voteToken(), tenantId, roundId, sessionId, createdAt: new Date().toISOString() };
  data.sessionVoteLinks.push(link);
  saveData();
  return clone(link);
}

// Resolve a token. The ONLY read, and it is by primary key — there is deliberately
// no "list the links of a round", because nothing needs one and a listing is how a
// capability leaks into a screen that shows more than its holder should see.
async function findSessionVoteLink(token) {
  const link = data.sessionVoteLinks.find((l) => l.id === token);
  return link ? clone(link) : null;
}

// The TTL sweep (#652): drop every link minted before `beforeIso`. Returns how
// many went, so the scheduler can log a count rather than a silence.
//
// Needed because the five event-driven deletions all key off something HAPPENING
// — a session abandoned without ever being closed reaches none of them, and its
// link would otherwise stay valid forever. See lib/vote-link.js.
async function deleteExpiredSessionVoteLinks(beforeIso) {
  let removed = 0;
  for (let i = data.sessionVoteLinks.length - 1; i >= 0; i -= 1) {
    const link = data.sessionVoteLinks[i];
    // A row with no createdAt is malformed and counts as expired, matching the
    // gate's own fail-closed reading in isVoteLinkExpired().
    if (!link.createdAt || link.createdAt < beforeIso) {
      data.sessionVoteLinks.splice(i, 1);
      removed += 1;
    }
  }
  if (removed) saveData();
  return removed;
}

// Drop one session's link. Returns the removed row, or null if there was none.
async function deleteSessionVoteLink(roundId, sessionId) {
  const idx = data.sessionVoteLinks.findIndex((l) => l.roundId === roundId && l.sessionId === sessionId);
  if (idx === -1) return null;
  const [removed] = data.sessionVoteLinks.splice(idx, 1);
  saveData();
  return clone(removed);
}

/* ------------------------------- Invitations ------------------------------- */
/*
 * Round-sharing invitations (issue #207). GLOBAL and un-scoped like `round_grants`
 * (an invitation crosses tenants — the inviter owns the round, the invitee is a
 * stranger to that tenant), absent from TENANT_METHODS. An invitation records the
 * inviter's decision, INCLUDING whether the invitee takes over a specific
 * user-less member seat (`memberId`) or gets a fresh one (`memberId: null`) — the
 * invitee never chooses. Accepting creates the round_grant (and the member);
 * declining just resolves it. Delivery is the inbox (#207 slice 1).
 */

async function createInvitation({ roundId, ownerTenantId, inviterUserId, inviteeUserId, memberId = null }) {
  const inv = {
    id: id(),
    roundId,
    ownerTenantId,
    inviterUserId,
    inviteeUserId,
    memberId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  data.invitations.push(inv);
  saveData();
  return clone(inv);
}

async function getInvitation(invId) {
  const inv = data.invitations.find((i) => i.id === invId);
  return inv ? clone(inv) : null;
}

// Every invitation on a round — the send route reads it to reject a duplicate
// PENDING invite and to drop invites whose seat/round changed.
async function listInvitationsForRound(roundId) {
  return data.invitations.filter((i) => i.roundId === roundId).map((i) => clone(i));
}

// Resolve a pending invitation to 'accepted'/'declined'. Returns the updated
// invitation, or null when it is missing or already resolved (so accept/decline
// can't fire twice).
async function resolveInvitation(invId, status) {
  const inv = data.invitations.find((i) => i.id === invId);
  if (!inv || inv.status !== 'pending') return null;
  inv.status = status;
  inv.resolvedAt = new Date().toISOString();
  saveData();
  return clone(inv);
}

/* ------------------------------ Friendships -------------------------------- */
/*
 * Friendships (issue #325). GLOBAL and un-scoped like `users`/`inbox`: a
 * friendship is keyed by two ACCOUNT ids, not a tenant, so it is absent from
 * TENANT_METHODS and reached from the account routes, which scope every query to
 * the authenticated caller. One row per unordered pair; `status` is
 * `pending`/`accepted`; declining, cancelling and unfriending all just delete the
 * row. A friendship shares NO round data — only Freundeskreis feed events (below)
 * flow between friends.
 */

// The two accounts a friendship joins, order-independent (mirrors the Postgres
// canonical (user_lo, user_hi) pair index).
const samePair = (f, a, b) =>
  (f.requesterUserId === a && f.addresseeUserId === b)
  || (f.requesterUserId === b && f.addresseeUserId === a);

// Send a friend request. One row per unordered pair: an existing accepted row is
// reported 'already_friends', an existing pending one 'request_pending' (in either
// direction) — the route maps both to a 409. Returns the created friendship
// otherwise. Self-requests are rejected by the route.
async function createFriendRequest({ requesterUserId, addresseeUserId }) {
  const existing = data.friendships.find((f) => samePair(f, requesterUserId, addresseeUserId));
  if (existing) return existing.status === 'accepted' ? 'already_friends' : 'request_pending';
  const row = {
    id: id(),
    requesterUserId,
    addresseeUserId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    acceptedAt: null,
  };
  data.friendships.push(row);
  saveData();
  return clone(row);
}

// Every friendship the user is a party to (any status), newest first — the route
// splits it into accepted friends, incoming and outgoing pending requests, and
// derives the caps from it.
async function listFriendships(userId) {
  return data.friendships
    .filter((f) => f.requesterUserId === userId || f.addresseeUserId === userId)
    .reverse()
    .map((f) => clone(f));
}

// The ADDRESSEE accepts a pending request by id. Only a pending row addressed to
// `addresseeUserId` flips to accepted (so a stale/second accept, or the requester
// trying to accept their own request, matches nothing → null).
async function acceptFriendRequest(fid, addresseeUserId) {
  const f = data.friendships.find(
    (x) => x.id === fid && x.status === 'pending' && x.addresseeUserId === addresseeUserId);
  if (!f) return null;
  f.status = 'accepted';
  f.acceptedAt = new Date().toISOString();
  saveData();
  return clone(f);
}

// Remove a friendship by id, only if the caller is a party to it — the single
// primitive behind decline (an incoming pending row), cancel (an outgoing pending
// row) and unfriend (an accepted row). Returns the removed row, or null.
async function deleteFriendshipById(fid, userId) {
  const idx = data.friendships.findIndex(
    (f) => f.id === fid && (f.requesterUserId === userId || f.addresseeUserId === userId));
  if (idx === -1) return null;
  const [removed] = data.friendships.splice(idx, 1);
  saveData();
  return clone(removed);
}

/* --------------------------- Freundeskreis feed ---------------------------- */
/*
 * User-attributed activity a friend may read (issue #325). GLOBAL and un-scoped,
 * keyed by the acting account id. The payload is a fixed ALLOWLIST — type, title,
 * optional coverUrl and the timestamp — enforced here by CONSTRUCTING the row
 * from exactly those fields and dropping everything else, the same discipline
 * trackEvent uses (lib/observability.js): a member name, score, vote or round name
 * passed by a call site can never reach a friend's feed. A per-user cap prunes the
 * oldest on write so the store can't grow unboundedly.
 */

const FEED_EVENT_TYPES = new Set(['session_played', 'game_added']);
const feedCap = () => Number(process.env.MAX_FEED_EVENTS) || 50;

// Append one feed event for `uid`. Silently drops (returns null) an unknown type
// or a missing uid — a bad call site must not create an untyped event stream, and
// like trackEvent this is best-effort at the call site.
async function addFeedEvent(uid, event) {
  if (!uid || !event || !FEED_EVENT_TYPES.has(event.type)) return null;
  const row = {
    id: id(),
    uid,
    type: event.type,
    title: String(event.title || ''),
    coverUrl: event.coverUrl || null,
    at: new Date().toISOString(),
  };
  data.feedEvents.push(row);
  // Prune this user's oldest events beyond the cap (insertion order == age).
  const mine = data.feedEvents.filter((e) => e.uid === uid);
  const over = mine.length - feedCap();
  for (let i = 0; i < over; i++) {
    const at = data.feedEvents.indexOf(mine[i]);
    if (at !== -1) data.feedEvents.splice(at, 1);
  }
  saveData();
  return clone(row);
}

// Newest-first feed events for a set of account ids (the caller's friends). An
// empty id list returns nothing. The ROUTE applies the per-friend "since accepted"
// cutoff and enriches with usernames — this stays a plain read.
async function listFeedEvents(uids, limit = 100) {
  const set = new Set(uids || []);
  if (!set.size) return [];
  return data.feedEvents
    .filter((e) => set.has(e.uid))
    .reverse()
    .slice(0, limit)
    .map((e) => clone(e));
}

/* --------------------------------- Members --------------------------------- */

// Add a member to an existing round (issue #207). Until now members could only
// be created by createRound — lib/routes/members.js states outright that adding one
// afterwards was out of scope. Round sharing needs it: accepting an invitation
// either takes over an existing seat (updateMember) or creates a fresh one here,
// named after the invitee's username, optionally linked to their account. `fields`
// is { name, color?, userId? }; absent optional keys stay absent (parity with the
// members createRound writes). Returns the created member, or null if the round is
// missing (or belongs to another tenant). Since #563 it also backs the add-member
// route, so it has two callers with different actors — see the activity note below.
//
// Appends, never prepends: the owner seat is index 0 by construction (#421) and
// memberColor() derives an unset avatar colour from the seat's POSITION, so
// inserting at the front would silently recolour every existing member.
async function createMember(tenant, rid, fields, actorMemberId) {
  const round = live(tenant, rid);
  if (!round) return null;
  const member = { id: id(), name: fields.name };
  if (fields.color !== undefined) member.color = fields.color;
  if (fields.userId !== undefined) member.userId = fields.userId;
  round.members.push(member);
  // A new person in the round is real history, unlike the name/colour tweaks
  // lib/routes/members.js deliberately leaves unlogged (#563). Logged here rather
  // than in the route so BOTH paths get it: a typed-in seat and an accepted
  // invitation (#207) are the same event from the round's point of view. The
  // invitation path passes no actor — attributing "Charlie joined" to Charlie's
  // own brand-new seat would read as self-reported — so that entry simply carries
  // no `· von`, exactly like a single-actor round's feed.
  addActivity(round, 'member_added', { name: member.name }, actorMemberId);
  saveData();
  return clone(member);
}

// Apply a validated { name?, color?, userId? } patch (userId: the optional link
// to an account, #135 — null unlinks). Returns the member, or null if the round
// or member is missing.
async function updateMember(tenant, rid, mid, patch) {
  const round = live(tenant, rid);
  if (!round) return null;
  const member = round.members.find((m) => m.id === mid);
  if (!member) return null;
  if (patch.name !== undefined) member.name = patch.name;
  if (patch.color !== undefined) member.color = patch.color;
  if (patch.userId !== undefined) member.userId = patch.userId;
  saveData();
  return clone(member);
}

/* ---------------------------------- Games ---------------------------------- */

// Create a game from resolved fields (title/min-max players/image, optional
// source). Mints the id, sets retired defaults and logs the game_added activity.
// Returns the game, or null if the round is gone.
async function createGame(tenant, rid, fields, actorMemberId) {
  const round = live(tenant, rid);
  if (!round) return null;
  const game = {
    id: id(),
    title: fields.title,
    minPlayers: fields.minPlayers,
    maxPlayers: fields.maxPlayers,
    image: fields.image,
    retired: false,
    retiredAt: null,
    completed: false,
    completedAt: null,
  };
  if (fields.source) game.source = fields.source;
  if (Array.isArray(fields.tagIds) && fields.tagIds.length) game.tagIds = fields.tagIds;
  round.games.push(game);
  addActivity(round, 'game_added', { gameId: game.id, title: game.title }, actorMemberId);
  saveData();
  return clone(game);
}

// True when the round already holds a game linked to this provider record — the
// idempotence rule for the BGG collection import (#481). Shared by both backends
// via their own copy of the same two-field comparison, so re-running an import
// against an unchanged collection adds nothing.
function sameSource(game, source) {
  const s = game.source;
  return !!s && !!source && s.provider === source.provider && s.externalId === source.externalId;
}

// Create MANY games in one go (#481, the BGG collection import). Not a loop over
// createGame, and that is the whole point of it existing:
//
//   - one `games_imported` activity carrying a COUNT, instead of N Chronik rows
//     burying every other event on the round (a shelf import is routinely 100+);
//   - the games-per-round quota checked ONCE against the resulting total and the
//     import refused WHOLE, so a capped round is never left half-imported;
//   - the already-present check runs here rather than in the route, so it is
//     atomic with the insert — two concurrent imports of the same collection
//     cannot both find a game missing and both create it.
//
// Returns null (no such round), 'quota_games', or { created, skipped }.
async function createGames(tenant, rid, games, actorMemberId, limits) {
  const round = live(tenant, rid);
  if (!round) return null;

  const fresh = [];
  let skipped = 0;
  for (const fields of games) {
    // Compared against the shelf AS IT GROWS, so a candidate list that itself
    // repeats an id cannot slip two copies of one game past the check.
    if (round.games.some((g) => sameSource(g, fields.source))
        || fresh.some((g) => sameSource(g, fields.source))) {
      skipped += 1;
      continue;
    }
    fresh.push({
      id: id(),
      title: fields.title,
      minPlayers: fields.minPlayers,
      maxPlayers: fields.maxPlayers,
      image: fields.image,
      retired: false,
      retiredAt: null,
      completed: false,
      completedAt: null,
      ...(fields.source ? { source: fields.source } : {}),
    });
  }

  // Counts every game the round holds (active + archived), like the per-add cap
  // in lib/routes/games.js — and BEFORE any write, so a refusal changes nothing.
  if (limits && round.games.length + fresh.length > limits.maxGames) return 'quota_games';

  // Nothing new: no activity either. An import that added nothing is not an
  // event, and writing one would put a "0 games imported" row in the Chronik
  // every time someone re-ran it to check.
  if (fresh.length) {
    round.games.push(...fresh);
    addActivity(round, 'games_imported', { count: fresh.length }, actorMemberId);
    saveData();
  }
  return { created: fresh.map(clone), skipped };
}

// Apply a patch of already-resolved fields to a game (the route computes which
// keys change, including image handling). Returns the game, or null if missing.
async function updateGame(tenant, rid, gid, patch) {
  const round = live(tenant, rid);
  if (!round) return null;
  const game = round.games.find((g) => g.id === gid);
  if (!game) return null;
  Object.assign(game, patch);
  saveData();
  return clone(game);
}

// A game is Active, Retired or Completed — never two at once (#250). Both
// mutators below therefore clear the OTHER archived state when they set theirs,
// so the exclusivity holds in the data layer rather than only in the UI.
async function retireGame(tenant, rid, gid, retired, actorMemberId) {
  const round = live(tenant, rid);
  if (!round) return null;
  const game = round.games.find((g) => g.id === gid);
  if (!game) return null;
  game.retired = retired;
  game.retiredAt = retired ? new Date().toISOString() : null;
  if (retired) {
    game.completed = false;
    game.completedAt = null;
  }
  addActivity(round, retired ? 'game_retired' : 'game_restored', { gameId: game.id, title: game.title }, actorMemberId);
  saveData();
  return clone(game);
}

// "Durchgespielt": the group finished the game's content, as opposed to
// retiring it because they want rid of it. Same shape as retireGame.
async function completeGame(tenant, rid, gid, completed, actorMemberId) {
  const round = live(tenant, rid);
  if (!round) return null;
  const game = round.games.find((g) => g.id === gid);
  if (!game) return null;
  game.completed = completed;
  game.completedAt = completed ? new Date().toISOString() : null;
  if (completed) {
    game.retired = false;
    game.retiredAt = null;
  }
  addActivity(round, completed ? 'game_completed' : 'game_uncompleted', { gameId: game.id, title: game.title }, actorMemberId);
  saveData();
  return clone(game);
}

// Permanently delete an ARCHIVED game (retired or completed) and scrub it from
// sessions + the feed. Returns null (game missing), 'not_archived' (refused),
// or { image } — the deleted game's cover path (may be null) so the caller can
// clean up the file.
async function deleteGame(tenant, rid, gid, actorMemberId) {
  const round = live(tenant, rid);
  if (!round) return null;
  const idx = round.games.findIndex((g) => g.id === gid);
  if (idx === -1) return null;
  const game = round.games[idx];
  if (!game.retired && !game.completed) return 'not_archived';

  round.games.splice(idx, 1);

  // Scrub the game from every session of this round.
  round.sessions = round.sessions.filter((s) => {
    s.gameIds = s.gameIds.filter((x) => x !== game.id);
    if (s.gameIds.length === 0) return false; // session only contained this game
    for (const mid in s.votes || {}) delete s.votes[mid][game.id];
    if (s.chosenGameId === game.id) {
      s.chosenGameId = null;
      s.chosenAt = null;
      s.finished = false;
      s.finishedAt = null;
      s.winnerIds = [];
    }
    return true;
  });

  // Drop feed entries that reference the game, then log the deletion itself.
  if (Array.isArray(round.activities)) round.activities = round.activities.filter((a) => a.gameId !== game.id);
  addActivity(round, 'game_deleted', { title: game.title }, actorMemberId);

  saveData();
  return { image: game.image };
}

// Move EVERY game (active + archived) of one round into another round of the
// same tenant, merging the rounds' tags by name (#253).
//
// Returns null when either round is missing, 'same_round' when they are the
// same, one of 'quota_games'/'quota_tags' when `limits` is given and the move
// would push the target past a cap, else { movedGames, mergedTags, createdTags }.
//
// `limits` ({ maxGames, maxTags }) is passed only when quotas are enforced. The
// check lives HERE rather than in the route because the number of tags the move
// would create is only known after building the remap — computing it in the
// route would mean duplicating this whole function's tag reconciliation. It is
// evaluated before any write, so a refusal changes nothing.
async function moveGames(tenant, rid, targetRid, limits, gameIds) {
  // Checked before the lookups so the answer doesn't depend on whether the id
  // exists — the Postgres backend has to do it in that order too (it decides
  // before querying), and the contract suite compares the two.
  if (rid === targetRid) return 'same_round';
  const src = live(tenant, rid);
  const target = live(tenant, targetRid);
  if (!src || !target) return null;

  // A null/undefined `gameIds` moves the whole shelf (#253's behaviour); a
  // subset (#402) must name games this round actually holds — a stale client
  // is refused rather than silently moving fewer games than it asked for. The
  // order comes from the SHELF, never from the request, so moved games keep
  // their relative order in the target either way (and Postgres, which reads
  // ordered by `seq`, can reach the same answer).
  let moving = src.games;
  if (gameIds) {
    const want = new Set(gameIds);
    moving = src.games.filter((g) => want.has(g.id));
    if (moving.length !== want.size) return 'unknown_game';
  }
  // Read-only until the quota gate below: `tags` must stay ABSENT on a round
  // that has none (absent-key parity with the Postgres NULL column), so the
  // array is only written back when tags are actually created.
  const targetTags = target.tags || [];

  // Which of the source round's tags are carried by at least one moving game —
  // an unused tag has nothing to remap and is not worth creating in the target.
  const used = new Set();
  for (const g of moving) for (const x of g.tagIds || []) used.add(x);

  // Find-or-create the equivalent tag in the target, same trimmed,
  // case-insensitive dedupe rule addTag uses (#238).
  const remap = new Map();
  const created = [];
  let mergedTags = 0;
  const norm = (s) => s.trim().toLowerCase();
  for (const tag of src.tags || []) {
    if (!used.has(tag.id)) continue;
    const match = targetTags.find((tg) => norm(tg.name) === norm(tag.name));
    if (match) {
      remap.set(tag.id, match.id);
      mergedTags += 1;
      continue;
    }
    const fresh = { id: id(), name: tag.name };
    if (tag.icon) fresh.icon = tag.icon;
    created.push(fresh);
    remap.set(tag.id, fresh.id);
  }

  if (limits) {
    if (target.games.length + moving.length > limits.maxGames) return 'quota_games';
    if (targetTags.length + created.length > limits.maxTags) return 'quota_tags';
  }

  const movedGames = moving.length;
  if (created.length) target.tags = [...targetTags, ...created];

  // A true reparent: each game keeps its id, cover path and source link, only
  // its tag ids are rewritten to the target round's equivalents. Appended in
  // order, so the moved games land at the end of the target's shelf.
  const movedIds = new Set();
  for (const game of moving) {
    movedIds.add(game.id);
    if (Array.isArray(game.tagIds)) {
      game.tagIds = game.tagIds.map((x) => remap.get(x)).filter(Boolean);
    }
    target.games.push(game);
  }
  src.games = src.games.filter((g) => !movedIds.has(g.id));

  // A session belongs to one round and cannot keep referencing a game that now
  // lives elsewhere — scrub exactly as deleteGame does, including dropping a
  // session left with no games at all. (When the whole shelf moves, that is in
  // practice every session of the source round; a subset move leaves the
  // sessions that still hold a kept game.) The target's own sessions are
  // untouched: a freshly moved game has no history there.
  src.sessions = src.sessions.filter((s) => {
    s.gameIds = s.gameIds.filter((x) => !movedIds.has(x));
    if (s.gameIds.length === 0) return false;
    for (const mid in s.votes || {}) {
      for (const gid of movedIds) delete s.votes[mid][gid];
    }
    if (movedIds.has(s.chosenGameId)) {
      s.chosenGameId = null;
      s.chosenAt = null;
      s.finished = false;
      s.finishedAt = null;
      s.winnerIds = [];
    }
    return true;
  });

  // ONE bulk entry per round, not one per game: merging a full shelf would
  // otherwise flood both Chroniks. Each names the round on the other side.
  // Skipped entirely for an empty source round — "0 games moved" is pure noise.
  if (movedGames) {
    addActivity(src, 'games_moved_out', { count: movedGames, roundId: target.id, roundName: target.name });
    addActivity(target, 'games_moved_in', { count: movedGames, roundId: src.id, roundName: src.name });
  }

  saveData();
  return { movedGames, mergedTags, createdTags: created.length };
}

// Whether any game in any of the tenant's rounds still references this cover
// image path — the SSRF-safe "is the file still used?" check before unlinking
// it. Tenant-scoped: image files never cross tenants (imports copy paths only
// within a tenant), and the Postgres backend couldn't see past RLS anyway.
async function isImageReferenced(tenant, image) {
  return data.rounds.some((r) => tenantOf(r) === tenant && r.games.some((g) => g.image === image));
}

/* --------------------------------- Sessions -------------------------------- */

// Persist a fully-built session object (the route owns the draw / direct-pick
// logic). Mints the id here. Returns the stored session, or null if round gone.
// `filters` ({ tagIds, excludeTagIds, count }) is the draw-flow's remembered
// session-start preset (#252), stored on the round as part of the same
// mutation. Direct-pick sessions pass nothing, so they never overwrite it.
async function createSession(tenant, rid, session, filters) {
  const round = live(tenant, rid);
  if (!round) return null;
  const full = { id: id(), ...session };
  round.sessions.push(full);
  if (filters) round.lastSessionFilters = filters;
  saveData();
  return clone(full);
}

// Small internal helper: run `mutate(session)` on a live session and persist.
async function withSession(tenant, rid, sid, mutate, events) {
  const round = live(tenant, rid);
  if (!round) return null;
  const session = round.sessions.find((s) => s.id === sid);
  if (!session) return null;
  mutate(session);
  // The activity log (#209) is written HERE, inside the one read-modify-write
  // that persists the change it records — never as a second call afterwards,
  // which could fail on its own and leave a session whose state moved with no
  // entry saying so. See lib/session-events.js.
  if (events) pushSessionEvents(session, events);
  saveData();
  return clone(session);
}

async function saveSessionResults(tenant, rid, sid, votes, events) {
  return withSession(tenant, rid, sid, (s) => {
    s.votes = votes;
    s.done = true;
  }, events);
}

// Write ONE person's column of a per-device session (#209), leaving everyone
// else's alone — the read-modify-write that `saveSessionResults` does for the
// whole map at once. `byGame` is already sanitized by the route.
//
// Two people submitting at the same moment is the normal case here, not an edge
// one, so this must never be "read the map, merge client-side, write it back":
// it goes through withSession, which is a single atomic read-modify-write per
// row (the Postgres twin takes FOR UPDATE), so the later writer sees the earlier
// one's column.
async function saveSessionPersonVotes(tenant, rid, sid, personId, byGame, events) {
  return withSession(tenant, rid, sid, (s) => {
    if (!s.votes || typeof s.votes !== 'object') s.votes = {};
    s.votes[personId] = byGame;
  }, events);
}

// Close a per-device session's voting (#209) without touching the votes it has
// collected. Deliberately NOT saveSessionResults(): that one REPLACES the whole
// map, which is right for the hot-seat wizard (it holds every vote) and would
// wipe every remote voter's column here.
async function closeSessionVoting(tenant, rid, sid, events) {
  return withSession(tenant, rid, sid, (s) => {
    s.done = true;
  }, events);
}

async function setSessionChoice(tenant, rid, sid, gameId, events) {
  return withSession(tenant, rid, sid, (s) => {
    s.chosenGameId = gameId;
    s.chosenAt = gameId ? new Date().toISOString() : null;
  }, events);
}

// Set/clear the played state. `winnerIds` is already filtered to real members.
async function finishSession(tenant, rid, sid, { finished, winnerIds }, events) {
  return withSession(tenant, rid, sid, (s) => {
    if (!finished) {
      s.finished = false;
      s.finishedAt = null;
      s.winnerIds = [];
    } else {
      s.winnerIds = winnerIds;
      s.finished = true;
      s.finishedAt = new Date().toISOString();
    }
  }, events);
}

async function cancelSession(tenant, rid, sid, cancelled, events) {
  return withSession(tenant, rid, sid, (s) => {
    if (cancelled) {
      s.cancelled = true;
      s.cancelledAt = new Date().toISOString();
    } else {
      s.cancelled = false;
      s.cancelledAt = null;
    }
  }, events);
}

// Remove one game from a session: drop it from the list + everyone's votes, and
// reset the choice/result if it was the chosen game.
async function removeSessionGame(tenant, rid, sid, gid, events) {
  return withSession(tenant, rid, sid, (s) => {
    s.gameIds = s.gameIds.filter((x) => x !== gid);
    Object.keys(s.votes || {}).forEach((mid) => {
      if (s.votes[mid]) delete s.votes[mid][gid];
    });
    if (s.chosenGameId === gid) {
      s.chosenGameId = null;
      s.chosenAt = null;
      s.finished = false;
      s.finishedAt = null;
      s.winnerIds = [];
    }
  }, events);
}

async function deleteSession(tenant, rid, sid) {
  const round = live(tenant, rid);
  if (!round) return false;
  const idx = round.sessions.findIndex((s) => s.id === sid);
  if (idx === -1) return false;
  round.sessions.splice(idx, 1);
  saveData();
  return true;
}

/* -------------------------------- Activities ------------------------------- */

// The round's activity feed (newest last, as stored). Returns null when the
// round is missing — the feed is no longer part of getRound's snapshot.
async function listActivities(tenant, rid) {
  const round = live(tenant, rid);
  if (!round) return null;
  return clone(round.activities || []);
}

async function deleteActivity(tenant, rid, aid) {
  const round = live(tenant, rid);
  if (!round) return false;
  if (!Array.isArray(round.activities)) round.activities = [];
  const idx = round.activities.findIndex((a) => a.id === aid);
  if (idx === -1) return false;
  round.activities.splice(idx, 1);
  saveData();
  return true;
}

/* -------------------------------- Background -------------------------------- */

// Set the round's design. Returns { previous } (the prior background) so the
// caller can clean up a replaced collage image file, or null if the round gone.
async function setBackground(tenant, rid, bg) {
  const round = live(tenant, rid);
  if (!round) return null;
  const previous = clone(round.background);
  round.background = bg;
  saveData();
  return { previous };
}

/* ----------------------------------- Tags ----------------------------------- */

// Create a round-level tag (#238). A name matching an existing tag (the caller
// trims; compared case-insensitively) reuses that tag instead of duplicating
// it. Returns the (existing or new) tag, or null if the round is gone. The
// `tags` key stays absent until the first tag is created (absent-key parity
// with the Postgres backend's NULL column).
async function addTag(tenant, rid, name, icon) {
  const round = live(tenant, rid);
  if (!round) return null;
  if (!Array.isArray(round.tags)) round.tags = [];
  const existing = round.tags.find((tg) => tg.name.toLowerCase() === name.toLowerCase());
  // A duplicate name reuses the existing tag and deliberately does NOT adopt
  // the passed icon: creating a tag must never silently restyle one the round
  // already has (#255).
  if (existing) return clone(existing);
  const tag = { id: id(), name };
  // `icon` stays absent when unset — absent-key parity with the Postgres
  // backend (.claude/rules/postgres-backend.md).
  if (icon) tag.icon = icon;
  round.tags.push(tag);
  saveData();
  return clone(tag);
}

// Set (or clear, with a null icon) a tag's icon (#255). Returns the updated
// tag, or null when the round or the tag is gone. Name is not patchable —
// renaming a tag is deliberately still unsupported.
async function setTagIcon(tenant, rid, tagId, icon) {
  const round = live(tenant, rid);
  if (!round) return null;
  const tag = (round.tags || []).find((tg) => tg.id === tagId);
  if (!tag) return null;
  if (icon) tag.icon = icon;
  else delete tag.icon;
  saveData();
  return clone(tag);
}

// Delete a round tag and silently unassign it from every game that had it.
// Returns true/false (found) — a missing round reads like a missing tag.
async function deleteTag(tenant, rid, tagId) {
  const round = live(tenant, rid);
  if (!round) return false;
  const idx = (round.tags || []).findIndex((tg) => tg.id === tagId);
  if (idx === -1) return false;
  round.tags.splice(idx, 1);
  round.games.forEach((g) => {
    if (Array.isArray(g.tagIds)) g.tagIds = g.tagIds.filter((x) => x !== tagId);
  });
  saveData();
  return true;
}

/* --------------------------- Lookup providers (#294) -------------------------- */

// Set which lookup providers this round queries. `ids` is already validated
// against the registry by the route. Returns the stored list, or null if the
// round is gone. The key stays ABSENT until first configured — absent means
// "all providers", the pre-#294 behaviour — while an empty array is a distinct,
// legitimate "query nothing" (absent-key parity with the Postgres NULL column).
async function setProviders(tenant, rid, ids) {
  const round = live(tenant, rid);
  if (!round) return null;
  round.providers = [...ids];
  saveData();
  return clone(round.providers);
}

/* ---------------------------- Instance metrics ------------------------------ */
/*
 * Aggregate usage numbers for the operator's Kennzahlen card (#404): how many
 * real accounts exist, how much they have built, and how close anyone is to a
 * quota ceiling. GLOBAL (cross-tenant) like every other operator method, so it
 * stays out of TENANT_METHODS and only the admin-gated route can reach it.
 *
 * Counts and maxima only — never a name, an address or an id. The card is
 * password-gated, not secret-cleared, and the same "a screenshot of it must be
 * harmless" rule lib/status.js states applies to what this returns.
 *
 * DEMO TENANTS ARE EXCLUDED FROM EVERYTHING (#427): a tourist who clicks "try
 * it" would otherwise inflate exactly the numbers that answer "is anyone
 * actually using this", the same reasoning trackEvent applies to its events.
 * lib/status.js adds the demo block back separately, from the live-demo count
 * the MAX_LIVE_DEMOS cap itself enforces.
 *
 * `now` is an argument rather than a Date.now() call so the two date windows are
 * deterministic for a test — the same reason the demo counts take one.
 */
async function instanceMetrics(now = new Date().toISOString()) {
  const at = Date.parse(now);
  const since = (days) => new Date((Number.isFinite(at) ? at : Date.now()) - days * 86400000).toISOString();
  const since7 = since(7);
  const since30 = since(30);
  // ISO-8601 compared as TEXT, the idiom listModeration and the demo predicates
  // already use: it sorts lexicographically, so a string compare is a correct
  // time compare, and a row with no createdAt simply never counts as new —
  // which is the right direction to fail in.
  const isNew = (row, cutoff) => String(row.createdAt || '') >= cutoff;

  const users = data.users.filter((u) => !isDemoTenant(u.tenantId));
  const demoUserIds = new Set(data.users.filter((u) => isDemoTenant(u.tenantId)).map((u) => u.id));
  const rounds = data.rounds.filter((r) => !isDemoTenant(tenantOf(r)));

  // One pass: the totals and the per-round/per-tenant maxima come from the same
  // walk, so they cannot disagree about which rounds were counted.
  const roundsPerTenant = new Map();
  let games = 0;
  let sessions = 0;
  let sessionsFinished = 0;
  let sessions30d = 0;
  let maxGamesPerRound = 0;
  let maxTagsPerRound = 0;
  let maxRoundsPerTenant = 0;
  for (const r of rounds) {
    const tenant = tenantOf(r);
    const owned = (roundsPerTenant.get(tenant) || 0) + 1;
    roundsPerTenant.set(tenant, owned);
    // Tracked as we go rather than Math.max(...map.values()) afterwards: a
    // spread is capped by the engine's argument limit, and tenant count is the
    // one number here that grows without a quota bounding it.
    maxRoundsPerTenant = Math.max(maxRoundsPerTenant, owned);
    games += r.games.length;
    maxGamesPerRound = Math.max(maxGamesPerRound, r.games.length);
    maxTagsPerRound = Math.max(maxTagsPerRound, (r.tags || []).length);
    for (const s of r.sessions) {
      sessions += 1;
      if (s.finished === true) sessionsFinished += 1;
      if (isNew(s, since30)) sessions30d += 1;
    }
  }

  // Distinct rounds, not grants: a round shared with three people is one shared
  // round. Demo accounts cannot invite (demo.refuseDemoAccount), so the owner
  // filter is belt-and-braces — but it is the same filter as everywhere else.
  const sharedRounds = new Set(
    data.roundGrants.filter((g) => !isDemoTenant(g.ownerTenantId)).map((g) => g.roundId),
  );

  return {
    accounts: {
      total: users.length,
      verified: users.filter((u) => u.emailVerified === true).length,
      disabled: users.filter((u) => u.disabled === true).length,
      new7d: users.filter((u) => isNew(u, since7)).length,
      new30d: users.filter((u) => isNew(u, since30)).length,
    },
    rounds: {
      total: rounds.length,
      // Distinct tenants owning at least one round. A tenant is 1:1 with an
      // account (.claude/rules/tenancy-rls.md), so the panel labels this
      // "accounts with at least one round" — but on a self-hosted, accounts-off
      // instance it also counts the legacy 'default' tenant and can exceed
      // accounts.total. That is honest; don't clamp it.
      tenants: roundsPerTenant.size,
    },
    content: {
      games, sessions, sessionsFinished, sessions30d,
    },
    social: {
      sharedRounds: sharedRounds.size,
      invitationsOpen: data.invitations
        .filter((i) => i.status === 'pending' && !isDemoTenant(i.ownerTenantId)).length,
      // Accepted only — a pending request is not a friendship. Filtered by
      // account rather than tenant: a friendship row carries neither.
      friendships: data.friendships.filter((f) => f.status === 'accepted'
        && !demoUserIds.has(f.requesterUserId) && !demoUserIds.has(f.addresseeUserId)).length,
    },
    // The highest value anyone currently holds against each quota ceiling, so
    // the card can show how close the instance is to refusing someone. Keyed
    // exactly like lib/quota.js's ceilings so the panel can zip the two.
    peaks: {
      roundsPerTenant: maxRoundsPerTenant,
      gamesPerRound: maxGamesPerRound,
      tagsPerRound: maxTagsPerRound,
    },
  };
}

// No-ops: the JSON backend needs no async setup or teardown (match postgres.js).
async function init() {}
async function end() {}

// Readiness probe for /readyz (#462): resolves when the backend can serve, and
// REJECTS when it cannot — the rejection is the signal, so never catch in here.
// A GLOBAL method (no tenant argument), so it must stay out of TENANT_METHODS.
//
// Trivially ok on this backend: the whole dataset is the in-memory `data`
// object, loaded once at require time, so if this module is callable at all the
// store is there. Asserting on `data` keeps it a real check rather than a bare
// `return true` that would stay green if loading ever became lazy and failed.
async function ping() {
  if (!data || typeof data !== 'object') throw new Error('store not loaded');
  return true;
}

module.exports = {
  init,
  end,
  instanceMetrics,
  ping,
  listRounds,
  listRoundSummaries,
  getRoundSummary,
  getRoundMeta,
  getSession,
  getGame,
  getRound,
  createRound,
  renameRound,
  deleteRound,
  createUser,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  updateUser,
  deleteUser,
  listUsers,
  countLiveDemoUsers,
  countLiveDemoUsersByIp,
  listExpiredDemoUsers,
  findImageOwner,
  findRoundOwner,
  tenantSummary,
  roundContent,
  redactText,
  takedownImage,
  exportTenant,
  exportAccountData,
  eraseAccount,
  logModeration,
  listModeration,
  countModeration,
  moderationActions,
  getModeration,
  markModerationStatement,
  createFeedback,
  listFeedback,
  countFeedback,
  deleteFeedback,
  createContactNotice,
  listContactNotices,
  countContactNotices,
  setContactNoticeStatus,
  getContactNotice,
  deleteContactNotice,
  addInboxItem,
  listInbox,
  markInboxRead,
  dismissInboxItem,
  createGrant,
  listGrantsForUser,
  listGrantsForRound,
  deleteGrant,
  createSessionVoteLink,
  findSessionVoteLink,
  deleteSessionVoteLink,
  deleteExpiredSessionVoteLinks,
  createInvitation,
  getInvitation,
  listInvitationsForRound,
  resolveInvitation,
  createFriendRequest,
  listFriendships,
  acceptFriendRequest,
  deleteFriendshipById,
  addFeedEvent,
  listFeedEvents,
  createMember,
  updateMember,
  createGame,
  createGames,
  updateGame,
  retireGame,
  completeGame,
  deleteGame,
  moveGames,
  isImageReferenced,
  createSession,
  saveSessionResults,
  saveSessionPersonVotes,
  closeSessionVoting,
  setSessionChoice,
  finishSession,
  cancelSession,
  removeSessionGame,
  deleteSession,
  listActivities,
  deleteActivity,
  setBackground,
  addTag,
  setTagIcon,
  deleteTag,
  setProviders,
};
