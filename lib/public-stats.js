'use strict';

/*
 * Instance-wide public statistics (#564) — the scale counters and the four
 * "which game" podiums published on the logged-out landing page and on
 * /entdecken.
 *
 * THE WHOLE BLOCK IS OFF BY DEFAULT (`PUBLIC_STATS_ENABLED`), and each metric
 * additionally hides itself until it clears its own minimum. Small numbers on a
 * public front door are worse than none — they answer a question the visitor was
 * not asking, badly — so the page fills in on its own as the instance grows
 * rather than needing a judgement call and a second deploy. Every threshold is
 * an env-tunable ceiling read PER CALL, like every other ceiling in this
 * codebase, so a single weak metric can be pulled back live by raising its
 * minimum, with no deploy and without taking the whole block down.
 *
 * NO USER-AUTHORED BYTE REACHES THIS PAYLOAD. `game.title` is free text someone
 * typed; the repo aggregate therefore returns raw `(provider, externalId)` keys
 * and the display name is resolved from the PROVIDER here. That is a structural
 * guarantee rather than a moderation duty — a user can rename their copy to
 * anything at all and it changes nothing about what is published. The
 * consequence to accept: only provider-linked games are nameable, so hand-typed
 * games (and games linked to the four storefronts retired in #744, whose modules
 * no longer exist) drop out of the podiums entirely while still counting in the
 * scale counters. The two blocks are deliberately not consistent with each
 * other, and the copy must not claim the podiums cover the whole shelf.
 *
 * NOTHING IS COMPUTED PER REQUEST. The scheduler rebuilds the payload
 * (lib/scheduler.js) and the route serves whatever is cached, so a visitor never
 * waits on a provider and a burst of visitors cannot turn into a burst of
 * upstream calls.
 */

const repo = require('./repo');
const { getProvider } = require('./providers');
const { logger } = require('./observability');
// The Spielwirbel-Score's curve (#893) and its shelf-scope shrinkage (#894,
// #928), applied here rather than in the repo's SQL — see `scoreTally`'s header
// for why the aggregate reports a histogram.
const { scoreTally, shelfScore, SCORE_MIN } = require('../public/js/vote-score');

/*
 * Whether the block exists at all. `PUBLIC_STATS_ENABLED=false` serves a 404 and
 * makes no provider call; anything else — including unset — publishes.
 *
 * THIS INVERTS THE REPO'S USUAL OPT-IN SHAPE (`=== 'true'`, as DEMO_ENABLED and
 * PRICES_ENABLED use), deliberately and for one reason: this is the only
 * feature here that renders on a PUBLIC page, so the switch that matters is the
 * one that takes it down in a hurry. The per-metric floors below can each hide
 * their own metric, but hiding the whole block through them means editing nine
 * variables under time pressure. Operator decision, 2026-08-13.
 *
 * The floors are what make shipping it on safe: an instance too small for a
 * number to mean anything publishes nothing at all, without anyone deciding.
 */
function publicStatsEnabled() {
  return process.env.PUBLIC_STATS_ENABLED !== 'false';
}

/*
 * A threshold read from env, defaulting when unset or unusable.
 *
 * Deliberately NOT the `Number(process.env.X) || DEFAULT` idiom the ceilings in
 * lib/quota.js use: here **0 is a meaningful value** ("publish this metric
 * whatever it says"), and that idiom silently swallows it back to the default —
 * an operator setting a floor to 0 would see no change and no error. A negative
 * or non-numeric value falls back, because those cannot be intended.
 */
function threshold(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Scale counters: pure magnitude signals, so their floors are high — these stay
// dark until they are genuinely impressive.
const COUNTERS = [
  { key: 'rounds', env: 'PUBLIC_STATS_MIN_ROUNDS', min: 25, of: (m) => m.rounds.total },
  // PLAYERS, not accounts. Most people in a round never hold an account — that
  // is the whole design — so an account count understates the app by exactly the
  // thing that makes it usable. Seats are not deduplicated across rounds: there
  // is no identity to dedupe them by, and the same four people in two rounds are
  // two tables either way.
  { key: 'players', env: 'PUBLIC_STATS_MIN_PLAYERS', min: 100, of: (m) => m.content.members },
  // The ACTIVE shelf, not every stored row: wishes are games nobody owns, and
  // an archived game is not out on the table.
  { key: 'games', env: 'PUBLIC_STATS_MIN_GAMES', min: 500, of: (m) => m.content.activeGames },
  { key: 'sessions', env: 'PUBLIC_STATS_MIN_SESSIONS', min: 100, of: (m) => m.content.sessionsFinished },
];

// How many provider hops one rebuild may make. Bounds the upstream cost of a
// sudden influx of new games; a run that hits the bound simply resolves fewer
// podiums and the next run picks up where this one stopped, because successful
// resolutions are memoized.
const DEFAULT_RESOLVE_MAX = 20;

// How deep to look for a resolvable game per metric. Only the winner is
// published, but the runner-up is what keeps the metric alive when the leader
// happens to be a game the provider cannot answer for right now.
const CANDIDATES_PER_METRIC = 3;

// externalId key -> { title, image, url }. Long-lived on purpose: a provider
// game's name and cover change very rarely, so re-asking on every rebuild would
// be pure upstream cost. Process-local like lib/provider-cache.js — under
// several replicas (#215) each keeps its own, which is harmless for a read-only
// payload.
const resolved = new Map();

// The cached payload the route serves. `null` until the first successful
// rebuild, and reset to null the moment the feature is switched off.
let payload = null;

const keyOf = (row) => JSON.stringify([row.provider, row.externalId]);

/*
 * One row's Spielwirbel-Score, or null when it carries neither a scoreable vote
 * nor a play.
 *
 * The repo aggregate hands back a per-tile histogram rather than a rating sum
 * precisely so this call can happen in JS: the curve is six tunable numbers in
 * public/js/vote-score.js, and the Postgres aggregate is SQL that cannot
 * require() them (.claude/rules/shared-constants-across-the-stack.md).
 *
 * SHRUNK EXACTLY AS THE REGAL SHRINKS IT (#928). This podium and a round's own
 * shelf print the same label on the same 0–5 ring, and until #928 they were two
 * different quantities: this one applied the raw curve with no prior, no
 * shrinkage and no play lift, so a game with five votes that were all 5s
 * outranked one with two hundred averaging 4,5. `shelfScore` takes no prior
 * argument, so the two surfaces cannot be handed different ones — the pooled
 * cross-tenant votes are scored by the identical rule as one round's own.
 *
 * The play count is the ALL-TIME one (`plays.all`), never a window: the lift is
 * a fact about the game over its whole life, and reading `plays365` here would
 * make the public number drop for a game that simply had a quiet year while the
 * Regal's number for it stood still.
 */
const ratingScore = (r) => {
  const sc = scoreTally(r.ratings.tiles);
  return shelfScore(sc ? sc.score : null, sc ? sc.count : 0, r.plays.all.count);
};

/*
 * The metrics, each as: which rows qualify, how they rank, and what the entry
 * says. Kept as data so the threshold reads, the ranking and the payload
 * assembly cannot disagree about which metric they are talking about.
 *
 * A period metric needs BOTH a play count and a spread of tenants: three plays
 * are three plays whether one group played it three times or three groups played
 * it once, and only the second is a fact about the instance.
 */
const METRICS = [
  {
    key: 'mostOwned',
    // DISPLAYED in shelves, GATED on accounts. "In 12 Regalen" is literally true
    // of a round's shelf, and needs no word for "the account that owns rounds" —
    // which the app does not have. The account floor is what stops one person
    // with several rounds reaching the podium alone.
    qualifies: (r) => r.shelves >= threshold('PUBLIC_STATS_MIN_SHELVES', 3)
      && r.owners >= threshold('PUBLIC_STATS_MIN_OWNER_TENANTS', 2),
    rank: (r) => r.shelves,
    value: (r) => ({ shelves: r.shelves }),
  },
  /*
   * The three period cards get their OWN floors, because the same number means
   * very different things over a week and over a year: three sessions in seven
   * days is a fact about the instance, three in a year is noise that would put a
   * card on the page saying almost nothing. Defaults rise with the window.
   */
  ...[
    { window: 'd7', key: 'playedWeek', plays: ['PUBLIC_STATS_MIN_PLAYS_WEEK', 3], spread: ['PUBLIC_STATS_MIN_PLAY_TENANTS_WEEK', 2] },
    { window: 'd30', key: 'playedMonth', plays: ['PUBLIC_STATS_MIN_PLAYS_MONTH', 8], spread: ['PUBLIC_STATS_MIN_PLAY_TENANTS_MONTH', 3] },
    { window: 'd365', key: 'playedYear', plays: ['PUBLIC_STATS_MIN_PLAYS_YEAR', 25], spread: ['PUBLIC_STATS_MIN_PLAY_TENANTS_YEAR', 5] },
  ].map(({ window, key, plays, spread }) => ({
    key,
    qualifies: (r) => r.plays[window].count >= threshold(plays[0], plays[1])
      && r.plays[window].tenants >= threshold(spread[0], spread[1]),
    rank: (r) => r.plays[window].count,
    value: (r) => ({ plays: r.plays[window].count }),
  })),
  {
    key: 'bestRated',
    // The score is null only for a row with no scoreable vote at all, which the
    // floors below already exclude at their defaults — but a floor of 0 is a
    // meaningful operator setting (see `threshold`), so the guard is real.
    qualifies: (r) => ratingScore(r) !== null
      && r.ratings.count >= threshold('PUBLIC_STATS_MIN_RATINGS', 5)
      && r.ratings.tenants >= threshold('PUBLIC_STATS_MIN_RATING_TENANTS', 2),
    /* Ranked on the SPIELWIRBEL-SCORE (#893), not the raw mean (#914), and
       shrunk since #928 — which is what now does the work the vote-count floor
       above was standing in for: a single 5-star vote can no longer top a game
       with fifty, because it is pulled four fifths of the way back to the
       neutral prior. The floor is kept anyway, as an evidence bar for a PUBLIC
       card rather than as a correctness patch. Unclamped, like every other
       ranking in the app: two games at the display floor are still genuinely
       different disasters and must not tie (core.js's `displayScore`). */
    rank: (r) => ratingScore(r),
    value: (r) => ({
      // Clamped for DISPLAY only, and rounded here rather than in the client so
      // every surface shows the same number and no float tail reaches the
      // payload.
      score: Math.round(Math.max(SCORE_MIN, ratingScore(r)) * 10) / 10,
      ratings: r.ratings.count,
    }),
  },
];

/*
 * Resolve one provider game's display name and cover, memoized.
 *
 * Returns null — never throws — when the provider is gone from the registry, has
 * no token configured, is down, or simply has no name for the id. Every one of
 * those degrades to "this metric is absent today", which is the same stance
 * search() takes and the reason a provider outage cannot break the landing page.
 */
async function resolveGame(row) {
  const key = keyOf(row);
  if (resolved.has(key)) return resolved.get(key);

  const provider = getProvider(row.provider);
  if (!provider) return null;
  let detail;
  try {
    detail = await provider.detail(row.externalId);
  } catch (err) {
    logger.warn({ event: 'public_stats_resolve_failed', provider: row.provider, err: err.message });
    return null;
  }
  const title = detail && typeof detail.title === 'string' ? detail.title.trim() : '';
  // A nameless answer is NOT memoized: it is what an unset BGG_API_TOKEN and a
  // bad day upstream both look like, and caching it would make a transient
  // outage permanent for the life of the process.
  if (!title) return null;

  const entry = {
    title,
    image: (detail && detail.imageUrl) || null,
    url: (detail && detail.url) || null,
  };
  resolved.set(key, entry);
  return entry;
}

// The scale-counter block, or null when every counter is below its floor.
function countersFrom(metrics) {
  const out = {};
  for (const c of COUNTERS) {
    const value = c.of(metrics);
    if (value >= threshold(c.env, c.min)) out[c.key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/*
 * The podium block, or null when no metric clears its thresholds and resolves.
 *
 * RANKING HAPPENS ON THE RAW NUMBERS, BEFORE ANY PROVIDER CALL — the aggregate
 * is already grouped by provider key, so nothing about ordering needs a title.
 * Only the handful of candidates that could actually be published are resolved,
 * which is what keeps the upstream cost proportional to the number of podiums
 * (five) instead of to the size of every shelf on the instance.
 */
async function podiumsFrom(rows) {
  // Anything whose provider has left the registry can never be named, so it is
  // dropped before it can occupy a podium place.
  const nameable = rows.filter((r) => getProvider(r.provider));
  const out = {};
  let budget = threshold('PUBLIC_STATS_RESOLVE_MAX', DEFAULT_RESOLVE_MAX);

  for (const metric of METRICS) {
    const candidates = nameable
      .filter(metric.qualifies)
      .sort((a, b) => metric.rank(b) - metric.rank(a))
      .slice(0, CANDIDATES_PER_METRIC);

    for (const row of candidates) {
      // A memoized game costs no hop, so it must not spend from the budget —
      // otherwise a steady state with five known podiums would still burn the
      // whole allowance every rebuild.
      const known = resolved.has(keyOf(row));
      if (!known && budget <= 0) break;
      if (!known) budget -= 1;
      const game = await resolveGame(row);
      if (!game) continue;
      out[metric.key] = { ...game, ...metric.value(row) };
      break;
    }
  }
  return Object.keys(out).length ? out : null;
}

/*
 * Rebuild the cached payload. Returns it (or null when the feature is off), so
 * the scheduler job and a test can both assert on what it did.
 *
 * Never throws: a failure here must leave the previous payload standing rather
 * than blanking a working landing page.
 */
async function rebuild(now = new Date().toISOString()) {
  if (!publicStatsEnabled()) {
    payload = null;
    return null;
  }
  try {
    const metrics = await repo.instanceMetrics(now);
    const rows = await repo.publicGameAggregates(now);
    const counters = countersFrom(metrics);
    const games = await podiumsFrom(rows);
    payload = {
      generatedAt: now,
      ...(counters ? { counters } : {}),
      ...(games ? { games } : {}),
    };
    return payload;
  } catch (err) {
    logger.error({ event: 'public_stats_rebuild_failed', err: err.message });
    return payload;
  }
}

// What the route serves: the cached payload, or null when the feature is off or
// nothing has been built yet. Never computes.
function publicStats() {
  if (!publicStatsEnabled()) return null;
  return payload;
}

// Test seam only — the module cache and the memo are process-global, so a spec
// that does not reset them inherits the previous spec's answers.
function resetForTests() {
  payload = null;
  resolved.clear();
}

module.exports = { publicStatsEnabled, rebuild, publicStats, resetForTests };
