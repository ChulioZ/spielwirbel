'use strict';

/*
 * How Discover's ranked lists are numbered (#1424, #1648) — split out of
 * lib/public-stats.js, which keeps everything that resolves, budgets and
 * caches. Everything here is pure: no repo, no provider, no env.
 *
 * The numbering is COMPETITION RANKING on the value a card shows: equal values
 * share a place (1, 1, 3), and every entry tied with the last place is
 * published, up to STATS_LIST_MAX. The order inside a tie is the caller's
 * (each metric's own tiebreak), always ending on the provider key so a rebuild
 * never reshuffles.
 */

const { SCORE_MIN } = require('../public/js/vote-score');

// How many PLACES each card publishes (#1424): a short ranked list, not a
// full ranking. A card with fewer qualifying entries simply carries fewer.
const STATS_LIST_SIZE = 3;

// How many ENTRIES a card may carry at most (#1648). Places are shared on a tie
// (competition ranking: 1, 1, 3), and every entry tied with the last place is
// published rather than one of them picked at random — up to this cap. A tie
// group that would overflow it is cut by the card's own tiebreak order, so the
// cut is deterministic and never flickers between rebuilds.
const STATS_LIST_MAX = 5;

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The last link of every tiebreak chain: the provider key, never the title —
// titles resolve later and can change, and ranking happens before any provider
// call. So two rebuilds over the same data publish the same order, whatever
// order the repo aggregate happened to return its rows in.
const byProviderKey = (a, b) => cmpStr(`${a.provider}:${a.externalId}`, `${b.provider}:${b.externalId}`);

// Clamped and rounded for DISPLAY only, so every surface shows the same number
// and no float tail reaches the payload. Also what defines a tie on a score
// card: two entries tie when the number the card SHOWS is equal.
const displayScore = (score) => Math.round(Math.max(SCORE_MIN, score) * 10) / 10;

/*
 * The place the next entry takes, or null when it is not published at all.
 *
 * `placed` is what the card has published so far, best first, as
 * [{ shown, rank }]; `shown` is the value the next entry's card displays.
 * Competition ranking: an entry showing the same value as the one above it
 * shares its place, and the next distinct value takes 1 + the entries above it
 * (1, 1, 3). So every entry tied with place STATS_LIST_SIZE is published, up to
 * STATS_LIST_MAX entries.
 *
 * Computed over the PUBLISHED list, so a candidate skipped because nobody can
 * name it leaves no gap — never „1, 3" because #2 failed to resolve.
 */
function nextPlace(placed, shown) {
  if (placed.length >= STATS_LIST_MAX) return null;
  const last = placed[placed.length - 1];
  const rank = last && last.shown === shown ? last.rank : placed.length + 1;
  return rank <= STATS_LIST_SIZE ? rank : null;
}

/*
 * Rank one attribute's names by the MEAN Spielwirbel-Score of their games, the
 * shelf profile's rule (#1556) lifted to the instance. Pure, so a spec can pin
 * the ranking without seeding a store.
 *
 * `games` is [{ score, tenants, values }]: the game's unclamped score, its
 * tenant spread and the names it carries for this attribute.
 *
 * THE SPREAD IS THE LARGEST OF ITS GAMES' SPREADS, not a count of distinct
 * tenants across them: the aggregate reports spreads as counts, never as ids,
 * so a union is not available. A max never overstates how many groups stand
 * behind a name — the safe direction for a public card, and the same stance
 * `bestRated` takes for its own two spreads.
 *
 * Ranked on the unclamped mean (two names at the display floor are still
 * different), ties to more games, then by name so a rebuild is deterministic.
 * Each result keeps its contributing `games` entries as `items` (#1560), so the
 * caller can list exactly the games the average was computed from.
 */
function rankNames(games, { minGames, minTenants }) {
  const byName = new Map();
  for (const g of games) {
    // A name listed twice on one game (it happens in BGG data) counts once.
    for (const name of new Set(g.values)) {
      const acc = byName.get(name) || { name, sum: 0, games: 0, tenants: 0, items: [] };
      acc.sum += g.score;
      acc.games += 1;
      acc.items.push(g);
      acc.tenants = Math.max(acc.tenants, g.tenants);
      byName.set(name, acc);
    }
  }
  return [...byName.values()]
    .filter((n) => n.games >= minGames && n.tenants >= minTenants)
    .map((n) => ({ name: n.name, mean: n.sum / n.games, games: n.games, items: n.items }))
    .sort((a, b) => (b.mean - a.mean) || (b.games - a.games) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

module.exports = {
  STATS_LIST_SIZE, STATS_LIST_MAX, cmpStr, byProviderKey, displayScore, nextPlace, rankNames,
};
