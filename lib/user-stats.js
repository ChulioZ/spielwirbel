'use strict';

/*
 * Account-wide play statistics (issue #1089) — the numbers behind /u/<username>.
 *
 * Every round already computes a rich per-seat record on the member page
 * (`memberStats`, public/js/member-stats.js). Nobody could see it ACROSS rounds:
 * a player in three rounds held three separate, unconnected records. This module
 * is the aggregate of every seat one account holds.
 *
 * Three properties are load-bearing:
 *
 *  - It runs `memberStats` itself rather than re-deriving the arithmetic, so the
 *    profile and the member page can never disagree about what a win rate or a
 *    strongest game is (.claude/rules/shared-constants-across-the-stack.md — the
 *    require-the-frontend-file direction, and the entry in
 *    .claude/rules/shared-constants-inventory.md).
 *
 *  - It is computed ON DEMAND from the round snapshots. Sessions stay the single
 *    source of truth (CLAUDE.md, "don't denormalize"), so deleting a session
 *    removes its effect here for free. The cost is one `listRounds` plus one
 *    `getRound` per grant per profile view — acceptable for a profile screen. If
 *    it ever isn't, CACHE it; do not denormalize.
 *
 *  - It returns plain numbers, game titles and cover paths and NOTHING ELSE — no
 *    round name, no round id, no member name, no tenant id. That is what makes
 *    the payload safe to hand to an accepted friend by construction rather than
 *    by a filter somebody has to remember to apply in lib/routes/profile.js.
 *
 * It is called from a route mounted AHEAD of the /api tenant gate, so `req.repo`
 * does not exist there: every read below sets its tenant explicitly through
 * `repo.forTenant(...)`, the same shape the shared-round listing in
 * lib/routes/rounds.js uses (.claude/rules/tenancy-rls.md).
 */

const repo = require('./repo');
const { DEFAULT_TENANT } = require('./tenant');
const { memberStats, BEST_GAME_MIN_PLAYS } = require('../public/js/member-stats');

/* The six siblings `memberStats` reads off the shared global scope in the
   browser. A public/js file cannot require() a sibling, so the Node caller hands
   them in — the injection shape recap.js and period-recap.js
   already use. Requiring the REAL modules is the whole point: a hand-written
   stand-in for any of them would be a second definition of what a contest, a
   party or a nameable game is. */
const MEMBER_STATS_DEPS = {
  sessionEnding: require('../public/js/session-outcome').sessionEnding,
  sessionPartyCount: require('../public/js/session-people').sessionPartyCount,
  sessionPartyGroups: require('../public/js/session-people').sessionPartyGroups,
  isNameableGame: require('../public/js/recap').isNameableGame,
};

/* A game's identity ACROSS rounds. The same game added to two rounds is two
   unrelated rows with two ids, so the favourite/strongest tiles would otherwise
   name it twice and rank each half separately.

   Provider id when the entry carries one, else the case-folded, trimmed title.
   Deliberately NOT "provider id, falling back to title": a sourced entry and an
   unsourced one of the same name stay apart, because a title match across two
   different people's shelves is a guess while a provider id is an identity. The
   conservative direction — two tiles that should be one — is the harmless one. */
function gameKey(game) {
  const s = game && game.source;
  if (s && s.provider && s.externalId) return `src:${s.provider}:${s.externalId}`;
  return `title:${String((game && game.title) || '').trim().toLowerCase()}`;
}

// Every round the account can hold a seat in: its own tenant's, plus each round
// shared with it by a grant (#207). A grant whose round is gone — the owner
// deleted it — is skipped, exactly as GET /api/rounds does.
async function roundsForUser(user) {
  const rounds = await repo.forTenant(user.tenantId || DEFAULT_TENANT).listRounds();
  const seen = new Set(rounds.map((r) => r.id));
  for (const g of await repo.listGrantsForUser(user.id)) {
    // A round already read above (a grant pointing back into the caller's own
    // tenant) must not be counted twice — it would double every figure on it.
    if (seen.has(g.roundId)) continue;
    const round = await repo.forTenant(g.ownerTenantId).getRound(g.roundId);
    if (!round) continue;
    seen.add(round.id);
    rounds.push(round);
  }
  return rounds;
}

/* The games this seat actually PLAYED: the chosen game of every finished session
   the member joined. No nameability bar — counting is not naming, the same split
   #643 draws for `avgGiven` — so a retired game the account played still counts
   toward `gamesPlayed`, it is simply never the thing a tile is titled with. */
function playedKeys(round, mid, into) {
  (round.sessions || []).forEach((s) => {
    if (!s.finished || !s.chosenGameId) return;
    if (Array.isArray(s.memberIds) && !s.memberIds.includes(mid)) return;
    const game = round.games.find((g) => g.id === s.chosenGameId);
    if (game) into.add(gameKey(game));
  });
}

/* Aggregate every seat `uid` holds into one record.
 *
 * Returns null for an unknown account. An account with no seat at all returns a
 * real record whose `sessions` is 0 — the view's empty state keys off that, and
 * it is a common state (a freshly registered account, or one that has only been
 * granted a round it has not been seated in). */
async function accountStats(uid) {
  const user = await repo.getUserById(uid);
  if (!user) return null;

  let sessions = 0;
  let wins = 0;
  let contested = 0;
  let contestedWins = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  let seats = 0;
  const played = new Set();
  // key -> { title, image, sum, count, plays, gameWins }
  const games = new Map();

  for (const round of await roundsForUser(user)) {
    // A round holds at most one seat for an account today, but nothing enforces
    // it, so every matching seat is aggregated rather than the first one found.
    for (const m of round.members || []) {
      if (m.userId !== uid) continue;
      seats += 1;
      const st = memberStats(round, m.id, MEMBER_STATS_DEPS);
      sessions += st.joined;
      wins += st.wins;
      contested += st.contested;
      contestedWins += st.contestedWins;
      ratingSum += st.ratingSum;
      ratingCount += st.ratingCount;
      playedKeys(round, m.id, played);
      st.games.forEach((e) => {
        const key = gameKey(e.game);
        const acc = games.get(key)
          || { title: e.game.title, image: e.game.image || null, sum: 0, count: 0, plays: 0, gameWins: 0 };
        acc.sum += e.ratings.reduce((a, b) => a + b, 0);
        acc.count += e.ratings.length;
        /* Σ wins / Σ plays, summed as COUNTS and divided once at the end — the
           same reason `winRate` below is recomputed rather than averaged: a game
           played eight times in one round and twice in another is not two equal
           opinions, and averaging the two rates flatters the round with fewer
           plays. The floor is applied to the MERGED total for the same reason,
           so a game played twice in each of two rounds qualifies here. */
        acc.plays += e.plays;
        acc.gameWins += e.gameWins;
        // A cover only where the merged group has one at all, so a second entry
        // without one cannot blank a tile the first entry could illustrate.
        if (!acc.image && e.game.image) acc.image = e.game.image;
        games.set(key, acc);
      });
    }
  }

  // Ties share the tile, as on the member page.
  /* Ties are broken by PLAYS before sharing the tile, exactly as memberStats
     does it — two games both at 100 % are not equal evidence. `plays` rides out
     so the tile can print „67 % · 5×"; for the favourite it is meaningless and
     simply unread. */
  const pick = (value) => {
    let best = null;
    let bestPlays = 0;
    let winners = [];
    games.forEach((acc) => {
      const v = value(acc);
      if (v === null) return;
      if (best === null || v > best || (v === best && acc.plays > bestPlays)) {
        best = v; bestPlays = acc.plays; winners = [acc];
      } else if (v === best && acc.plays === bestPlays) winners.push(acc);
    });
    return { best, plays: bestPlays, winners: winners.map((a) => ({ title: a.title, image: a.image })) };
  };
  const fav = pick((a) => (a.count ? a.sum / a.count : null));
  const strongest = pick((a) => (a.plays >= BEST_GAME_MIN_PLAYS ? a.gameWins / a.plays : null));

  return {
    sessions,
    wins,
    /* Σ contested wins / Σ contested sessions — recomputed from the counts, NOT
       an average of the per-seat rates. Those differ whenever two seats saw
       different numbers of contests, and the averaged form flatters the seat
       with fewer of them. */
    winRate: contested ? contestedWins / contested : null,
    // Count-weighted for the same reason: a seat with 40 ratings and one with 2
    // are not two equal opinions about how this account rates.
    avgGiven: ratingCount ? ratingSum / ratingCount : null,
    rounds: seats,
    gamesPlayed: played.size,
    favorite: fav.winners,
    favAvg: fav.best,
    bestGames: strongest.winners,
    bestScore: strongest.best,
    bestPlays: strongest.plays,
  };
}

module.exports = { accountStats, gameKey };
