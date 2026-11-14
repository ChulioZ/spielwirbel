'use strict';

/*
 * The Discover past-winners lists (#1732): every completed calendar week's and
 * month's most-played game, newest first. Pure — no repo, no provider, no env —
 * so the bucketing, the floors and the ties are specified here and
 * lib/public-stats.js only resolves the names.
 *
 * RECOMPUTED ON EVERY REBUILD, NOT SNAPSHOTTED. There is no table of past
 * winners: a period's #1 is derived from the plays dated inside it, under the
 * floors in force NOW. So raising PUBLIC_STATS_MIN_PLAYS_WEEK can remove a
 * past week from the list, and that is accepted — the alternative is a stored
 * history that has to be migrated, redacted and erased with everything else.
 *
 * A period is published only when a game cleared the SAME floors its live card
 * applies (play count and distinct tenants), so a week that never had a card
 * never gets a winner after the fact. The running period is excluded: it is
 * the card itself.
 */

const { periodKeysOf } = require('./calendar-periods');
const { STATS_LIST_MAX, cmpStr, byProviderKey } = require('./public-stats-ranking');

/*
 * `plays` is publicPlayHistory's rows ({ provider, externalId, tenant,
 * playedAt }); `now` decides which period is still running; `floors` is
 * { week: { plays, tenants }, month: { plays, tenants } }.
 *
 * Returns { week: [{ period, games }], month: [...] } where `games` is the
 * period's #1 — every game tied on the count, up to STATS_LIST_MAX — as raw
 * provider keys, in a total order: the game that reached the count first
 * (earlier latest play, the live cards' #1648 tiebreak), then the provider key.
 */
function pastWinners(plays, now, floors) {
  const current = periodKeysOf(now) || { week: '', month: '' };
  const out = {};
  for (const kind of ['week', 'month']) {
    // period -> game key -> { provider, externalId, count, tenants, lastAt }
    const periods = new Map();
    for (const p of plays) {
      const keys = periodKeysOf(p.playedAt);
      if (!keys || keys[kind] >= current[kind]) continue;
      let games = periods.get(keys[kind]);
      if (!games) { games = new Map(); periods.set(keys[kind], games); }
      const id = JSON.stringify([p.provider, p.externalId]);
      let g = games.get(id);
      if (!g) {
        g = { provider: p.provider, externalId: p.externalId, count: 0, tenants: new Set(), lastAt: '' };
        games.set(id, g);
      }
      g.count += 1;
      g.tenants.add(p.tenant);
      if (p.playedAt > g.lastAt) g.lastAt = p.playedAt;
    }
    const floor = floors[kind];
    const list = [];
    for (const [period, games] of periods) {
      const qualifying = [...games.values()]
        .filter((g) => g.count >= floor.plays && g.tenants.size >= floor.tenants);
      if (!qualifying.length) continue;
      const top = Math.max(...qualifying.map((g) => g.count));
      const winners = qualifying
        .filter((g) => g.count === top)
        .sort((a, b) => cmpStr(a.lastAt, b.lastAt) || byProviderKey(a, b))
        .slice(0, STATS_LIST_MAX)
        .map((g) => ({ provider: g.provider, externalId: g.externalId }));
      list.push({ period, games: winners });
    }
    // Newest first; `YYYY-MM-DD` and `YYYY-MM` sort as strings.
    out[kind] = list.sort((a, b) => cmpStr(b.period, a.period));
  }
  return out;
}

// The earliest instant whose play can be in a COMPLETED period of either kind:
// everything before the later of the two running periods' starts. Lets the
// repo read stop at the running week/month instead of returning every play.
function historyCutoff(boundaries) {
  return boundaries.week > boundaries.month ? boundaries.week : boundaries.month;
}

module.exports = { pastWinners, historyCutoff };
