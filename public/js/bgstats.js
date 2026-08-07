/* Spielwirbel – pushing a finished session to BG Stats as a play (#485).

   BG Stats takes ONE play per URL — `createPlay.html?data=<url-encoded JSON>` —
   not a file, so this file is a payload builder and nothing else. Nothing is
   sent from our servers: the results screen renders a link and the user taps it
   on their own device, which is what keeps BG Stats out of the processor list
   (see the privacy policy's §9 note and .claude/rules/keep-legal-docs-current.md).

   Pure and dependency-free, so it works both as a shared-scope frontend script
   and as a CommonJS module the test suite can require — the session-share.js
   shape, and the coverage constraint in
   .claude/rules/frontend-helper-modules-and-coverage.md.

   The builder takes the domain objects showResults has already resolved
   (sessionPeople / sessionParties / winnerIds) rather than the raw session, so
   the guest and team rules live in ONE resolver
   (.claude/rules/session-guests-are-not-members.md) instead of being re-derived
   here against a shape that has already caught ~10 sites out.

   Load order: see index.html. */

'use strict';

// Identifies us as the sending app. BG Stats remembers a user's game/player
// matches per (sourceName, sourceGameId/sourcePlayerId) pair, so this string is
// part of that key and must stay stable — renaming it makes every group re-match
// every game and every person, once, silently.
const BGSTATS_SOURCE = 'Spielwirbel';
const BGSTATS_CREATE_PLAY = 'https://app.bgstatsapp.com/createPlay.html';

// The whole play travels as one query parameter, so length is the real
// constraint on what may go in it — which is why `comments` is not sent at all.
// 8000 is the conservative floor across browsers and OS link handlers; the
// app's own worst case is measured against it in test/bgstats.test.js.
const BGSTATS_URL_MAX = 8000;

// "2026-08-06 19:16:58" — BG Stats' required playDate format, in UTC. Returns
// null for anything unparseable so the caller can decline to build a play at
// all rather than sending an invalid required field.
function bgStatsPlayDate(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// A guest's re-matching id, derived from their NAME.
//
// Guest ids are minted fresh inside the request that starts each session
// (`resolveGuests`, lib/routes/sessions.js), so passing one through would hand BG
// Stats a new stranger every evening and force the user to re-match Dana at
// every push. A name-derived id makes "Dana" the same person across sessions —
// which is the same identity the group means when they type the name again.
//
// FNV-1a over the trimmed, lower-cased name. The `guest-` prefix is what keeps
// the namespace disjoint from member ids, which are bare hex.
function bgStatsGuestId(name) {
  let hash = 0x811c9dc5;
  const norm = String(name || '').trim().toLowerCase();
  for (let i = 0; i < norm.length; i++) {
    hash ^= norm.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 'guest-' + hash.toString(16).padStart(8, '0');
}

// Team labels are A, B, … AA — BG Stats groups players by an equal `team`
// string, so the label only has to be short, distinct and language-neutral. Our
// own team names are the members' names joined ("Anna, Ben und Dana"), which
// would repeat every name a second time inside a URL that is already the
// feature's binding constraint.
function bgStatsTeamLabel(index) {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

// The BGG thing id, when the game is linked to BGG. Recommended but optional —
// name + sourceGameId carry the match on their own, which is what lets a digital
// game (Steam, PS Store, …) export cleanly instead of being dropped.
function bgStatsBggId(game) {
  const source = game && game.source;
  if (!source || source.provider !== 'bgg') return null;
  const id = Number(source.externalId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// The play, or null when this session is not one.
//
// `model` is { session, game, people, parties, winnerIds } — the values
// showResults already holds. `game` is the CHOSEN game resolved against the
// round, so a null there means "nothing chosen" and needs no second check.
function bgStatsPlay(model) {
  const { session, game, people, parties, winnerIds } = model || {};
  if (!session || !game) return null;
  if (!session.finished || session.cancelled) return null;
  // The end of the evening, falling back to when it started: a session finished
  // before finishedAt existed still has a createdAt, and a play with no date is
  // one BG Stats will refuse.
  const playDate = bgStatsPlayDate(session.finishedAt || session.createdAt);
  if (!playDate) return null;

  // party id -> label, for the teamed parties only. Built in `parties` order so
  // the labels are stable for one session rather than depending on which person
  // is looked up first.
  const teamOf = new Map();
  let teamIndex = 0;
  (parties || []).forEach((party) => {
    if (!party.team) return;
    const label = bgStatsTeamLabel(teamIndex++);
    (party.people || []).forEach((p) => teamOf.set(p.id, label));
  });

  const won = new Set(winnerIds || []);
  const play = {
    sourceName: BGSTATS_SOURCE,
    sourcePlayId: session.id,
    playDate,
    // durationMin is deliberately absent: `finishedAt - createdAt` spans the
    // voting as well as the play, so it would overstate every game's length, and
    // we measure no play time anywhere.
    game: {
      name: game.title,
      // Round-scoped, so the same physical game in two rounds is matched twice.
      // Accepted: it is the only id the game actually has, and the alternative
      // (matching on title) is exactly what BG Stats' own re-matching replaces.
      sourceGameId: game.id,
      // BG Stats has no per-player RATING field — only score/rank/winner — and
      // our 1-5 votes are a Spielwirbel concept, not a play record. So they stay
      // here: no points, no scores, winners only.
      noPoints: true,
    },
    players: (people || []).map((person) => {
      const player = {
        name: person.name,
        sourcePlayerId: person.guest ? bgStatsGuestId(person.name) : person.id,
        winner: won.has(person.id),
      };
      const team = teamOf.get(person.id);
      if (team) player.team = team;
      return player;
    }),
  };
  const bggId = bgStatsBggId(game);
  if (bggId) play.game.bggId = bggId;
  return play;
}

// The tappable link, or null when the session is not a play. One gate, so the
// button's visibility and the payload's validity can never disagree.
function bgStatsPlayUrl(model) {
  const play = bgStatsPlay(model);
  if (!play) return null;
  return BGSTATS_CREATE_PLAY + '?data=' + encodeURIComponent(JSON.stringify(play));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BGSTATS_SOURCE,
    BGSTATS_CREATE_PLAY,
    BGSTATS_URL_MAX,
    bgStatsPlayDate,
    bgStatsGuestId,
    bgStatsTeamLabel,
    bgStatsBggId,
    bgStatsPlay,
    bgStatsPlayUrl,
  };
}
