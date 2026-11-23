'use strict';

/*
 * A round export (#1702) back in as a NEW round (#1756) — the pure translation
 * from the file's `round.json` to the rows both repo backends write.
 *
 * ONE module for both backends, for the reason lib/repo/import-copy.js is one:
 * the two must reach the same answer and the question is pure field shape. The
 * id minter is injected because that is the one part they disagree about.
 *
 * What the file is: the `GET /api/rounds/:rid` snapshot of ANOTHER instance (or
 * another account), so every value in it is untrusted input. Three properties
 * follow, and each fails silently if undone:
 *
 *   1. ALLOWLISTED, per entity. Only the top-level keys named in *_FIELDS below
 *      are carried; everything else is dropped rather than stored. A key the
 *      export DOES carry and the import drops on purpose is named in DROPPED
 *      with its reason. test/round-import.test.js builds a round through
 *      the real routes and fails on a stored key that is in neither list — so a
 *      field added tomorrow is decided here, rather than silently lost or
 *      silently trusted.
 *   2. EVERY ID RE-MINTED, every reference remapped. Postgres ids are global
 *      primary keys, so importing one file twice on one host would otherwise
 *      collide. The remap is GENERIC rather than a list of reference fields: every
 *      `id` anywhere in the carried tree gets a fresh one, and then every string
 *      VALUE and object KEY equal to an old id is replaced, at any depth. So a
 *      reference field added later (a new map keyed by seat, a new list of game
 *      ids) is remapped without an edit here — the list approach is the one that
 *      rots. Ids are 16 random hex characters (12 for scoring categories), so a
 *      user's text coinciding with one is not a case worth guarding.
 *      `importRef` is the one subtree that is NOT collected: its `id` is the
 *      play's id in BG Stats/BGG (#1665), an external key that re-import dedupe
 *      reads, not one of ours.
 *   3. NOTHING THAT GRANTS ACCESS. `/uploads` answers "whose object is this?" by
 *      finding a game cover, a session photo or a collage background that names
 *      the path (lib/upload-access.js). A carried `/uploads/<key>` would
 *      therefore hand the importer another tenant's object. All three are dropped
 *      here; a game's cover is kept only when it is a provider hotlink that
 *      passes `providerCoverUrl` (which is also the CSS-injection guard on a
 *      value interpolated into `background-image`). `member.userId` is dropped
 *      for the same family of reason: on the target it would link a seat to an
 *      arbitrary account.
 */

const { z } = require('zod');
const { getProvider, providerCoverUrl } = require('./providers');
const { normalizeEdition } = require('./edition');
const { TAG_ICONS } = require('./tag-icons');
const { MEMBER_COLORS } = require('../public/js/member-colors');
const { sessionOutcome, sessionChildIds } = require('../public/js/session-outcome');
const { resolveMarker } = require('../public/js/round-marker');
const { gamePitchFrom } = require('../public/js/game-pitch');
const { PROVIDER_INFO_FIELDS, assignProviderInfo } = require('../public/js/provider-info-fields');
const {
  roundExportProblem, roundImportSessions, ROUND_IMPORT_SESSIONS_MAX, ROUND_IMPORT_BYTES_MAX,
} = require('../public/js/round-import-file');

// The provenance stamp the operator's „aus Export importiert" figure counts.
const IMPORTED_FROM_EXPORT = 'export';

// Array caps, independent of the quotas: a self-hosted instance enforces none,
// and the schema must bound the request either way (the byte limit is derived
// from these — ROUND_IMPORT_BYTES_MAX in round-import-file.js).
const ROUND_IMPORT_LIMITS = {
  members: 500,
  games: 5000,
  sessions: ROUND_IMPORT_SESSIONS_MAX,
  tags: 500,
};

// The route's body limit — the shared number the browser checks too.
const ROUND_IMPORT_BODY_LIMIT = ROUND_IMPORT_BYTES_MAX;

const ROUND_FIELDS = [
  'tags', 'lastSessionFilters', 'savedFilters', 'dismissedRecommendations',
  'drawBoost', 'challenge', 'challengeHistory',
];
const MEMBER_FIELDS = ['name', 'color', 'retired', 'retiredAt', 'ownerPreset'];
const GAME_FIELDS = [
  'title', 'minPlayers', 'maxPlayers', 'image',
  'retired', 'retiredAt', 'completed', 'completedAt', 'wish', 'wishAt', 'guestGame',
  'source', 'edition', 'providerInfoAt', 'expansionOf', 'expansions',
  'playtimeOverride', 'purchasePrice', 'pitch', 'tagIds', 'ownerIds', 'loan',
  'lowScoreWins', 'scoreCategories',
  ...PROVIDER_INFO_FIELDS,
];
const SESSION_FIELDS = [
  'events', 'createdAt', 'dateOnly', 'durationMinutes', 'startedPlayingAt',
  'tagIds', 'excludeTagIds', 'tagMode', 'requestedCount', 'memberIds',
  'withoutShelfIds', 'guests', 'teams', 'multiTable', 'minTableSeats', 'voteBoost',
  'gameIds', 'votes', 'votedIds', 'verdicts', 'chosenGameId', 'chosenAt',
  'finished', 'finishedAt', 'winnerIds', 'ending', 'scores', 'scoreParts', 'automa',
  'cancelled', 'cancelledAt', 'done', 'tableProposals',
  'parentSessionId', 'childSessionIds', 'removedPeople', 'importRef',
];

// What the export carries and the import leaves behind ON PURPOSE. The spec
// reads these lists, so a reason here is the record of a decision.
const DROPPED = {
  round: {
    id: 're-minted',
    members: 'imported as rows', games: 'imported as rows', sessions: 'imported as rows',
    marker: 'resolved again (resolveMarker) so a legacy round keeps its colour',
    background: 'the retired per-round design (#1202); a collage names an /uploads path',
    shared: 'a grant flag of the SOURCE instance — the importer owns the new round',
    role: 'a grant flag of the SOURCE instance — the importer owns the new round',
    format: 'the file marker', formatVersion: 'the file marker', exportedAt: 'the file marker',
  },
  member: {
    id: 're-minted',
    userId: 'an account on the SOURCE instance; on the target it would link the seat to a stranger',
  },
  game: { id: 're-minted' },
  session: {
    id: 're-minted',
    photo: 'an /uploads path — carrying it would grant access to another tenant\'s object',
  },
};

class RoundImportError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// The envelope, validated before anything is translated. Entities only need an
// object with a string id here — their fields are allowlisted below, where an
// unknown key is DROPPED rather than refused (a file from a newer release with a
// field this one does not know still imports).
const entity = z.object({ id: z.string().min(1).max(64) }).passthrough();
const roundFileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  members: z.array(entity.extend({ name: z.string().trim().min(1).max(200) })).max(ROUND_IMPORT_LIMITS.members),
  games: z.array(entity.extend({ title: z.string().trim().min(1).max(500) })).max(ROUND_IMPORT_LIMITS.games),
  sessions: z.array(entity).max(ROUND_IMPORT_LIMITS.sessions),
  tags: z.array(entity.extend({ name: z.string().trim().min(1).max(200) }))
    .max(ROUND_IMPORT_LIMITS.tags).nullish(),
}).passthrough();

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Copy the allowlisted keys that are present. A stored null is carried as null
// (the source had that exact shape); an absent key stays absent.
function pick(src, fields) {
  const out = {};
  for (const k of fields) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

// A provider link as the games route builds one (buildSource) — the url is
// rendered as a link, so it must be http(s) or nothing.
function cleanSource(src) {
  if (!isObject(src)) return null;
  const provider = getProvider(src.provider);
  const externalId = String(src.externalId == null ? '' : src.externalId).trim();
  if (!provider || !externalId) return null;
  const url = typeof src.url === 'string' && /^https?:\/\//.test(src.url) ? src.url : null;
  return { provider: provider.id, externalId, url };
}

function cleanMember(m) {
  const out = pick(m, MEMBER_FIELDS);
  out.name = m.name.trim();
  if (out.color !== undefined && !MEMBER_COLORS.includes(out.color)) delete out.color;
  return out;
}

// Returns the game and whether a stored cover had to be dropped.
function cleanGame(g) {
  const out = pick(g, GAME_FIELDS.filter((k) => !PROVIDER_INFO_FIELDS.includes(k)));
  out.title = g.title.trim();
  // The provider-metadata guards decide what counts as a value (#724).
  assignProviderInfo(out, g);
  let droppedCover = false;
  if (out.image != null) {
    const safe = providerCoverUrl(out.image);
    if (!safe) droppedCover = true;
    out.image = safe;
  } else {
    out.image = null;
  }
  if (out.source !== undefined) {
    const s = cleanSource(out.source);
    if (s) out.source = s; else delete out.source;
  }
  if (out.edition !== undefined) {
    const e = normalizeEdition(out.edition);
    if (e) out.edition = e; else delete out.edition;
  }
  if (out.pitch !== undefined) {
    const r = gamePitchFrom(out.pitch);
    if (r.error || !r.pitch) delete out.pitch; else out.pitch = r.pitch;
  }
  if (Array.isArray(out.expansions)) {
    out.expansions = out.expansions.filter(isObject).map((e) => {
      const x = { ...e };
      if (x.source != null) x.source = cleanSource(x.source);
      return x;
    });
  } else if (out.expansions !== undefined) {
    delete out.expansions;
  }
  return { game: out, droppedCover };
}

function cleanTag(tag) {
  const out = { id: tag.id, name: tag.name.trim() };
  if (TAG_ICONS.includes(tag.icon)) out.icon = tag.icon;
  return out;
}

// Every `id` value anywhere in the tree, except inside `importRef`.
function collectIds(node, into) {
  if (Array.isArray(node)) { node.forEach((v) => collectIds(v, into)); return into; }
  if (!isObject(node)) return into;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'importRef') continue;
    if (k === 'id' && typeof v === 'string') into.add(v);
    else collectIds(v, into);
  }
  return into;
}

// A deep copy with every old id — as a value or as a key — replaced.
function remap(node, map) {
  if (typeof node === 'string') return map.has(node) ? map.get(node) : node;
  if (Array.isArray(node)) return node.map((v) => remap(v, map));
  if (!isObject(node)) return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[map.has(k) ? map.get(k) : k] = k === 'importRef' ? structuredClone(v) : remap(v, map);
  }
  return out;
}

/*
 * The whole translation. Returns
 *   { round: { id, name, marker, importedFrom, ...ROUND_FIELDS },
 *     members, games, sessions, report: { sessions, skippedSessions, droppedImages } }
 * with every id fresh. Throws RoundImportError('not_a_round' | 'newer_format' |
 * 'invalid') for a file that is not one.
 */
function buildRoundImport(file, mintId) {
  const problem = roundExportProblem(file);
  if (problem) throw new RoundImportError(problem);
  const parsed = roundFileSchema.safeParse(file);
  if (!parsed.success) throw new RoundImportError('invalid');

  const members = file.members.map(cleanMember).map((m, i) => ({ id: file.members[i].id, ...m }));
  let droppedImages = 0;
  const games = file.games.map((g) => {
    const { game, droppedCover } = cleanGame(g);
    if (droppedCover) droppedImages += 1;
    return { id: g.id, ...game };
  });
  // Open sessions skipped, split links pruned (the shared fixed point).
  const kept = roundImportSessions(file.sessions, { sessionOutcome, sessionChildIds });
  const sessions = kept.map((s) => {
    if (typeof s.photo === 'string' && s.photo) droppedImages += 1;
    return { id: s.id, ...pick(s, SESSION_FIELDS) };
  });
  const roundFields = pick(file, ROUND_FIELDS);
  if (roundFields.tags != null) roundFields.tags = (file.tags || []).map(cleanTag);
  if (roundFields.drawBoost !== true) delete roundFields.drawBoost;

  const ids = collectIds({ members, games, sessions, roundFields }, new Set([file.id]));
  const map = new Map([...ids].map((old) => [old, mintId()]));
  const out = remap({ members, games, sessions, roundFields }, map);

  return {
    round: {
      id: map.get(file.id),
      name: file.name.trim(),
      // The source's stored marker, else the one its retired design mapped to,
      // so a round older than markers keeps its colour. Only the final fallback
      // hashes an id, and it is the NEW one: the source id is file input, and
      // hashing it is a loop bounded by a user-supplied length (CodeQL
      // js/loop-bound-injection).
      marker: resolveMarker({ marker: file.marker, background: file.background, id: map.get(file.id) }),
      importedFrom: IMPORTED_FROM_EXPORT,
      ...out.roundFields,
    },
    members: out.members,
    games: out.games,
    sessions: out.sessions,
    report: {
      sessions: sessions.length,
      skippedSessions: file.sessions.length - sessions.length,
      droppedImages,
    },
  };
}

module.exports = {
  buildRoundImport,
  RoundImportError,
  ROUND_IMPORT_LIMITS,
  ROUND_IMPORT_BODY_LIMIT,
  IMPORTED_FROM_EXPORT,
  ROUND_FIELDS,
  MEMBER_FIELDS,
  GAME_FIELDS,
  SESSION_FIELDS,
  DROPPED,
};
