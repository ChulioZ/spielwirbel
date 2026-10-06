'use strict';

/*
 * Instance-wide public statistics (#564) — the scale counters, the six
 * "which game" podiums and the three "which name" favourites (#1557: designer,
 * category, mechanic) published on the logged-out landing page and on
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
// The calendar boundaries the repo aggregate counted over (#964). Called again
// here rather than threaded through the rows: it is a pure function of the same
// `now`, so the period a card NAMES cannot describe a different window than the
// counts beside it.
const { periodBoundaries } = require('./calendar-periods');
// BGG's `(Uncredited)` sentinel is stored verbatim and dropped by every reader
// (#1505) — the favourite-designer card is one more reader.
const { creditedDesigners } = require('../public/js/provider-info-fields');

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
//
// 30 since #1557: the six podiums can spend 18 on a cold start, and the
// favourites spend what is left on games the BGG corpus does not cover (most
// games it does, at no cost — see `attributesFor`).
const DEFAULT_RESOLVE_MAX = 30;

// How deep to look for a resolvable game per metric. Only the winner is
// published, but the runner-up is what keeps the metric alive when the leader
// happens to be a game the provider cannot answer for right now.
const CANDIDATES_PER_METRIC = 3;

// externalId key -> { title, image, url }. Long-lived on purpose: a provider
// game's name and cover change very rarely, so re-asking on every rebuild would
// be pure upstream cost. Process-local like lib/provider-cache.js — under
// several replicas (#215's shared store was closed unshipped) each keeps its
// own, which is harmless for a read-only payload.
const resolved = new Map();

// externalId key -> { designers, categories, mechanics }, for the favourites
// (#1557). Same lifetime and same reasoning as `resolved`; filled for free
// whenever `resolveGame` makes a hop anyway, and from the corpus otherwise.
const attributes = new Map();

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
 * The play count is `plays.lift` (#1329): all-time, never a window — the lift
 * is a fact about the game over its whole life, and reading `plays.year` here
 * would make the public number drop for a game that simply had a quiet year
 * while the Regal's number for it stood still — and counted the way the Regal
 * counts (`playCounts`: every non-cancelled session with a chosen game,
 * FINISHED OR NOT). Until #1329 this read `plays.all`, the finished-only count
 * the „Dauerbrenner" card publishes, so a game with open direct picks scored
 * lower here than on its own shelf.
 */
const ratingScore = (r) => {
  const sc = scoreTally(r.ratings.tiles);
  return shelfScore(sc ? sc.score : null, sc ? sc.count : 0, r.plays.lift.count);
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
   * card on the page saying almost nothing. Defaults rise with the period.
   *
   * THESE ARE CALENDAR PERIODS (#964), so they START EMPTY and a card is simply
   * absent early on: on a Monday morning `playedWeek` has almost no plays and
   * falls under its floor, as does the month card in its first days and the year
   * card through part of January. THAT IS INTENDED — it is the stance this
   * module's header already takes, that the page fills in on its own rather than
   * publishing a number too thin to mean anything. Do not lower the defaults or
   * prorate a floor by how far into the period we are to keep a card alive; an
   * operator who wants one sooner can raise or lower any of these live, which is
   * what the env vars are for.
   *
   * `identity` is which key of the boundary set names this period, so the card
   * can say WHICH month or year it is showing. The week has none deliberately —
   * nobody reads calendar-week numbers, so its label is unchanged.
   */
  ...[
    { window: 'week', key: 'playedWeek', identity: null, plays: ['PUBLIC_STATS_MIN_PLAYS_WEEK', 3], spread: ['PUBLIC_STATS_MIN_PLAY_TENANTS_WEEK', 2] },
    { window: 'month', key: 'playedMonth', identity: 'monthKey', plays: ['PUBLIC_STATS_MIN_PLAYS_MONTH', 8], spread: ['PUBLIC_STATS_MIN_PLAY_TENANTS_MONTH', 3] },
    { window: 'year', key: 'playedYear', identity: 'yearKey', plays: ['PUBLIC_STATS_MIN_PLAYS_YEAR', 25], spread: ['PUBLIC_STATS_MIN_PLAY_TENANTS_YEAR', 5] },
  ].map(({ window, key, identity, plays, spread }) => ({
    key,
    qualifies: (r) => r.plays[window].count >= threshold(plays[0], plays[1])
      && r.plays[window].tenants >= threshold(spread[0], spread[1]),
    rank: (r) => r.plays[window].count,
    value: (r, period) => ({
      plays: r.plays[window].count,
      ...(identity ? { period: period[identity] } : {}),
    }),
  })),
  /*
   * THE ALL-TIME CARD (#1035) — „Spielwirbels Dauerbrenner".
   *
   * Deliberately NOT folded into the `.map()` above it, although the shape is
   * nearly identical: that block's whole argument is about calendar periods
   * that start empty and rise with their length, and this is the one play
   * metric that is neither bounded nor floored.
   *
   * TWO FLOORS, TWO DECISIONS — don't let one be read as the other.
   *
   *  - The MAGNITUDE floor (`PUBLIC_STATS_MIN_PLAYS_ALL`) defaults to 0, an
   *    operator decision (#1035) and not an omission: the one durable fact
   *    about the instance's shelf is worth stating from the first play. 0 is a
   *    documented, meaningful `threshold()` value ("publish whatever it says"),
   *    and the lever is kept so the card can be pulled back live.
   *  - The TENANT-SPREAD floor (`PUBLIC_STATS_MIN_PLAY_TENANTS_ALL`) defaults
   *    to 2, like every other podium's (legal audit 2026-10-04, L-016, operator
   *    option a). It is not a magnitude floor at all: it is the privacy
   *    safeguard that keeps ONE group's evenings off a public page on their
   *    own, and docs/legal/vvt.md row 22 states it for every ranking. #1035 set
   *    both to 0 together, which made that statement false for this card —
   *    lowering the magnitude floor never needed the spread floor to go with it.
   *
   * `plays.all` has been in both backends since #928, where it fed the
   * Spielwirbel-Score's play lift. It is FINISHED plays only, and stays so:
   * since #1329 the lift reads its own `plays.lift`, which also counts open
   * sessions the way the Regal does. Don't point this card at that count — a
   * "most played" tile counts evenings that happened (#1059).
   */
  {
    key: 'playedAll',
    qualifies: (r) => r.plays.all.count >= threshold('PUBLIC_STATS_MIN_PLAYS_ALL', 0)
      && r.plays.all.tenants >= threshold('PUBLIC_STATS_MIN_PLAY_TENANTS_ALL', 2),
    rank: (r) => r.plays.all.count,
    value: (r) => ({ plays: r.plays.all.count }),
  },
  {
    key: 'bestRated',
    /* AT LEAST ONE RATING, spelled explicitly rather than inferred from a null
       score. Until #928 this read `ratingScore(r) !== null` and that was
       sufficient, because the raw curve has nothing to say about a row with no
       votes. It is not sufficient any more: `shelfScore` answers a played-but-
       unrated game with its lifted prior — deliberately, since that is what
       gives a direct-pick round a ranked shelf at all — so the null test stopped
       excluding anything and a game with ZERO ratings could take a podium
       labelled „Bestbewertet".

       Only reachable by setting both floors below to 0, which `threshold`
       documents as a meaningful operator setting ("publish this metric whatever
       it says"), and the two of them are what the null test was standing in for
       at their defaults. So the clause is not redundant with them — it is the
       one that must not depend on an operator's number. Since #1329 it is also
       what the floors below cannot replace at ANY value: they count plays as
       evidence, so ten plays and no rating would clear them.

       THE FLOORS ARE EVIDENCE, RATINGS PLUS PLAYS (#1329). The score is lifted
       by plays, so a game rated once and played twelve times has a number its
       plays earned — and a ratings-only floor kept it off the podium however
       often it was played, while a game scoring lower on its own shelf took
       first place. The env var names still say RATING: production sets
       `PUBLIC_STATS_MIN_RATING_TENANTS`, and a rename would silently reset it
       to the default.

       The spread is the larger of the two tenant counts, not their union: a max
       never overstates the true number of rounds behind the evidence, so it
       needs no third, distinct-union aggregate from either backend. It can
       understate it (two tenants, one only rating and one only playing, read
       as 1) — the safe direction for a public card. */
    qualifies: (r) => r.ratings.count > 0
      && ratingScore(r) !== null
      && r.ratings.count + r.plays.lift.count >= threshold('PUBLIC_STATS_MIN_RATINGS', 5)
      && Math.max(r.ratings.tenants, r.plays.lift.tenants)
        >= threshold('PUBLIC_STATS_MIN_RATING_TENANTS', 2),
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
      // The plays that lifted the score (#1329), so the line can show the
      // evidence the podium was admitted on — „1 Bewertung" alone would read
      // as too thin to qualify.
      plays: r.plays.lift.count,
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
  // The same answer carries the game's links, so the favourites never pay a
  // second hop for a game a podium already resolved.
  attributes.set(key, attributesOf(detail));
  return entry;
}

/* ------------------------- the favourites (#1557) -------------------------- */

const strings = (list) => (Array.isArray(list) ? list : [])
  .filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());

// The three name lists of one provider record (a detail() answer or a corpus
// row's `info`) — BGG's own link values, never anything a user typed.
function attributesOf(src) {
  return {
    designers: creditedDesigners(src.designers).map((v) => v.trim()).filter(Boolean),
    categories: strings(src.categories),
    mechanics: strings(src.mechanics),
  };
}

// The favourite cards, each naming which attribute it ranks.
const FAVOURITES = [
  { key: 'favDesigner', attr: 'designers' },
  { key: 'favCategory', attr: 'categories' },
  { key: 'favMechanic', attr: 'mechanics' },
];

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
 */
function rankNames(games, { minGames, minTenants }) {
  const byName = new Map();
  for (const g of games) {
    // A name listed twice on one game (it happens in BGG data) counts once.
    for (const name of new Set(g.values)) {
      const acc = byName.get(name) || { name, sum: 0, games: 0, tenants: 0 };
      acc.sum += g.score;
      acc.games += 1;
      acc.tenants = Math.max(acc.tenants, g.tenants);
      byName.set(name, acc);
    }
  }
  return [...byName.values()]
    .filter((n) => n.games >= minGames && n.tenants >= minTenants)
    .map((n) => ({ name: n.name, mean: n.sum / n.games, games: n.games }))
    .sort((a, b) => (b.mean - a.mean) || (b.games - a.games) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/*
 * Each admitted game's links: memo first, then the BGG corpus (no upstream
 * cost — it already stores parsed /thing attributes), then a provider hop
 * from the rebuild's remaining budget. A game none of the three can answer for
 * this rebuild is left out of every average until a later one can — the
 * favourites may read slightly differently while the memo fills, which is the
 * same "fewer podiums this rebuild" degradation the podiums accept.
 *
 * NOT `game.designers` etc. from the stored rows: those are provider-written
 * today, but the payload's guarantee should not rest on a route never
 * changing — the provider and the corpus are the structural source.
 */
async function attributesFor(rows, budget) {
  const missing = rows.filter((r) => !attributes.has(keyOf(r)));
  const bggIds = missing.filter((r) => r.provider === 'bgg').map((r) => String(r.externalId));
  if (bggIds.length) {
    let entries = [];
    try {
      entries = await repo.getCorpusEntries(bggIds);
    } catch (err) {
      logger.warn({ event: 'public_stats_corpus_failed', err: err.message });
    }
    for (const e of entries) {
      // A row enriched before designers were parsed (#1505) lacks the key; it
      // would read as "no designer", so it is not an answer — ask the provider.
      if (e.info && Object.prototype.hasOwnProperty.call(e.info, 'designers')) {
        attributes.set(keyOf({ provider: 'bgg', externalId: e.externalId }), attributesOf(e.info));
      }
    }
  }
  for (const row of rows) {
    if (attributes.has(keyOf(row))) continue;
    if (budget.left <= 0) break;
    budget.left -= 1;
    // resolveGame memoizes the attributes alongside the title.
    await resolveGame(row);
  }
  return rows
    .map((row) => ({ row, attrs: attributes.get(keyOf(row)) }))
    .filter((x) => x.attrs);
}

// The favourites block, or null when no name clears its floors.
async function favouritesFrom(rows, budget) {
  const bestRated = METRICS.find((m) => m.key === 'bestRated');
  // Admitted on the „Bestbewertet" evidence floor: a game too thin to be named
  // on its own must not move a designer's average.
  const admitted = rows
    .filter(bestRated.qualifies)
    // Best evidence first, so a tight budget spends its hops on the games that
    // weigh most rather than on whichever the aggregate listed first.
    .sort((a, b) => (b.ratings.count + b.plays.lift.count) - (a.ratings.count + a.plays.lift.count));
  if (!admitted.length) return null;

  const known = await attributesFor(admitted, budget);
  const floors = {
    minGames: threshold('PUBLIC_STATS_MIN_NAME_GAMES', 3),
    minTenants: threshold('PUBLIC_STATS_MIN_NAME_TENANTS', 2),
  };
  const out = {};
  for (const fav of FAVOURITES) {
    const games = known.map(({ row, attrs }) => ({
      score: ratingScore(row),
      tenants: Math.max(row.ratings.tenants, row.plays.lift.tenants),
      values: attrs[fav.attr],
    }));
    const [winner] = rankNames(games, floors);
    if (!winner) continue;
    out[fav.key] = {
      name: winner.name,
      // Clamped and rounded for display only, exactly like `bestRated`.
      score: Math.round(Math.max(SCORE_MIN, winner.mean) * 10) / 10,
      games: winner.games,
    };
  }
  return Object.keys(out).length ? out : null;
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
 * (six) instead of to the size of every shelf on the instance.
 *
 * THE BUDGET IS SHARED: six metrics x CANDIDATES_PER_METRIC (3) is 18 of
 * PUBLIC_STATS_RESOLVE_MAX's default (30 since #1557), and the favourites take
 * what the podiums leave. That fits,
 * and a run that hits the bound degrades correctly — fewer podiums this
 * rebuild, and the next one resumes from the memo — so nothing here is
 * required to change. A new metric that spends hops raises the default with
 * it, as #1557 did for the favourites.
 */
async function podiumsFrom(nameable, period, budget) {
  const out = {};

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
      if (!known && budget.left <= 0) break;
      if (!known) budget.left -= 1;
      const game = await resolveGame(row);
      if (!game) continue;
      out[metric.key] = { ...game, ...metric.value(row, period) };
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
    const metrics = await repo.instanceMetrics();
    const rows = await repo.publicGameAggregates(now);
    const counters = countersFrom(metrics);
    // Anything whose provider has left the registry can never be named, so it
    // is dropped before it can occupy a podium place or move an average.
    const nameable = rows.filter((r) => getProvider(r.provider));
    // ONE budget for the whole rebuild, podiums first: they publish a game,
    // and a favourite can wait a rebuild for its last few hops.
    const budget = { left: threshold('PUBLIC_STATS_RESOLVE_MAX', DEFAULT_RESOLVE_MAX) };
    const games = await podiumsFrom(nameable, periodBoundaries(now), budget);
    const names = await favouritesFrom(nameable, budget);
    payload = {
      generatedAt: now,
      ...(counters ? { counters } : {}),
      ...(games ? { games } : {}),
      ...(names ? { names } : {}),
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
  attributes.clear();
}

module.exports = { publicStatsEnabled, rebuild, publicStats, resetForTests, rankNames };
