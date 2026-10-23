'use strict';

/*
 * Instance-wide public statistics (#564) — the scale counters, the six
 * "which game" podiums and the three "which name" favourites (#1557: designer,
 * category, mechanic) published on the logged-out landing page and on
 * /entdecken. Each podium and favourite is a RANKED LIST of STATS_LIST_SIZE
 * places (#1424) — tied entries share a place and each carries its `rank`
 * (#1648) — never padded: every entry clears the card's own floors, so a card
 * may carry fewer and a card with none is absent.
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
const { getProvider, providerCoverUrl } = require('./providers');
const { logger } = require('./observability');
const { lookupBggLinks } = require('./bgg-links');
// The Spielwirbel-Score's curve (#893) and its shelf-scope shrinkage (#894,
// #928), applied here rather than in the repo's SQL — see `scoreTally`'s header
// for why the aggregate reports a histogram.
const { scoreTally, eveningEvidence, shelfScore } = require('../public/js/vote-score');
// The calendar boundaries the repo aggregate counted over (#964). Called again
// here rather than threaded through the rows: it is a pure function of the same
// `now`, so the period a card NAMES cannot describe a different window than the
// counts beside it.
const { periodBoundaries } = require('./calendar-periods');
// BGG's `(Uncredited)` sentinel is stored verbatim and dropped by every reader
// (#1505) — the favourite-designer card is one more reader.
const { creditedDesigners } = require('../public/js/provider-info-fields');
// How places are numbered and ties ordered (#1648), and how favourite names
// rank — pure, so it lives apart from the resolution and budget below.
const {
  STATS_LIST_SIZE, STATS_LIST_MAX, cmpStr, byProviderKey, displayScore, nextPlace, rankNames,
} = require('./public-stats-ranking');

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
// sudden influx of new games; a run that hits the bound simply publishes
// shorter lists and the next run picks up where this one stopped, because
// successful resolutions are memoized.
//
// 62 since #1648 (50 since #1424, 30 since #1557, 20 before): the six podiums
// can spend 6 x CANDIDATES_PER_METRIC = 42 on a cold start, which leaves the
// favourites the 20 they had before tied places widened the lists, to spend on
// games the BGG corpus does not cover (most games it does, at no cost — see
// `attributesFor`). Steady state costs next to nothing: the period cards
// mostly name the same games, and every name is memoized.
const DEFAULT_RESOLVE_MAX = 62;

// How deep to look for resolvable games per metric: the longest list plus two
// spares, so a list stays full when one or two of its games are ones the
// provider cannot answer for right now.
const CANDIDATES_PER_METRIC = STATS_LIST_MAX + 2;

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

// externalId key -> { title, image, url } for a game whose links came from the
// BGG corpus rather than a provider hop (#1560), so the favourites can name the
// games behind a name without spending budget. Memoized alongside `attributes`
// because the corpus is only read for games missing from it.
const corpusNamed = new Map();

// The BGG corpus holds base games only (lib/corpus.js drops expansions), so its
// link is always /boardgame/ — the shape the provider itself builds.
const BGG_WEB = 'https://boardgamegeek.com';

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
 * Since #1721 that rule counts EVENINGS, so the aggregate also hands back one
 * histogram per rated session (`ratings.evenings`); each is scored on its own
 * here, through the same curve, and folded exactly as the Regal folds them.
 *
 * The play count is `plays.lift` (#1329; since #1721 each play is a pick, the
 * name is history): all-time, never a window — the play count
 * is a fact about the game over its whole life, and reading `plays.year` here
 * would make the public number drop for a game that simply had a quiet year
 * while the Regal's number for it stood still — and counted the way the Regal
 * counts (`playCounts`: every non-cancelled session with a chosen game,
 * FINISHED OR NOT). Until #1329 this read `plays.all`, the finished-only count
 * the „Dauerbrenner" card publishes, so a game with open direct picks scored
 * lower here than on its own shelf.
 */
const ratingScore = (r) => {
  const { sum, evenings } = eveningEvidence((r.ratings.evenings || []).map(scoreTally));
  return shelfScore(sum, evenings, r.plays.lift.count);
};

/*
 * The play cards' tiebreak (#1648): with equal counts, the game that reached
 * the count FIRST — for N plays each, the one whose N-th counted play happened
 * earlier, i.e. the earlier LATEST counted play (`lastAt`, the newest
 * `createdAt` among the plays the window counted). A missing stamp sorts as
 * the empty string, ahead of every date; the provider key settles the rest.
 */
const playedFirst = (window) => (a, b) => cmpStr(a.plays[window].lastAt || '', b.plays[window].lastAt || '');

/*
 * The metrics, each as: which rows qualify, how they rank, and what the entry
 * says. Kept as data so the threshold reads, the ranking and the payload
 * assembly cannot disagree about which metric they are talking about.
 *
 * A period metric needs BOTH a play count and a spread of tenants: three plays
 * are three plays whether one group played it three times or three groups played
 * it once, and only the second is a fact about the instance.
 *
 * Each metric ranks on `shown` — the number its card DISPLAYS, so a tie is a
 * tie the reader can see (#1648) — then on its own `tiebreak`, then on the
 * provider key.
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
    shown: (r) => r.shelves,
    /* A tie cannot be ordered by "who got there first": a game row carries no
       "added to the shelf" timestamp, and adding a stored field for a tiebreak
       would be the tail wagging the dog. More distinct ACCOUNTS is the next
       best fact — the same number the card is gated on. */
    tiebreak: (a, b) => b.owners - a.owners,
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
    shown: (r) => r.plays[window].count,
    tiebreak: playedFirst(window),
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
   * since #1329 the score's play count reads its own `plays.lift` (the field
   * name predates #1721, which counts each play as a pick), which also counts open
   * sessions the way the Regal does. Don't point this card at that count — a
   * "most played" tile counts evenings that happened (#1059).
   */
  {
    key: 'playedAll',
    qualifies: (r) => r.plays.all.count >= threshold('PUBLIC_STATS_MIN_PLAYS_ALL', 0)
      && r.plays.all.tenants >= threshold('PUBLIC_STATS_MIN_PLAY_TENANTS_ALL', 2),
    shown: (r) => r.plays.all.count,
    tiebreak: playedFirst('all'),
    value: (r) => ({ plays: r.plays.all.count }),
  },
  {
    key: 'bestRated',
    /* AT LEAST ONE RATING, spelled explicitly rather than inferred from a null
       score. Until #928 this read `ratingScore(r) !== null` and that was
       sufficient, because the raw curve has nothing to say about a row with no
       votes. It is not sufficient any more: `shelfScore` answers a played-but-
       unrated game with a score from its plays alone — deliberately, since that is what
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
       different disasters (core.js's `displayScore`).

       So since #1648 the PLACE and the ORDER answer different questions. Two
       games tie — share a place — when the score the card shows is equal, the
       clamp included: anything else draws „4,2" on place 1 and „4,2" on place
       2. Inside the tie the unrounded score still orders them, so the hidden
       ordering keeps favouring the genuinely higher one; then more evidence.
       "Reached it first" has no meaning for a mean. */
    shown: (r) => displayScore(ratingScore(r)),
    tiebreak: (a, b) => (ratingScore(b) - ratingScore(a))
      || ((b.ratings.count + b.plays.lift.count) - (a.ratings.count + a.plays.lift.count)),
    value: (r) => ({
      score: displayScore(ratingScore(r)),
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
  { key: 'favDesigner', attr: 'designers', type: 'designer' },
  { key: 'favCategory', attr: 'categories', type: 'category' },
  { key: 'favMechanic', attr: 'mechanics', type: 'mechanic' },
];

// Each published favourite's BGG id (#1638), so the public page links the name
// without a request of its own. A name the link table does not know keeps no
// `bggId` and renders as plain text; a failed lookup costs the links, never the
// block (lookupBggLinks is best-effort).
async function attachLinkIds(out) {
  const query = Object.fromEntries(FAVOURITES.filter((f) => out[f.key]).map((f) => [f.type, out[f.key].map((e) => e.name)]));
  const ids = await lookupBggLinks(query);
  for (const fav of FAVOURITES) {
    for (const e of out[fav.key] || []) {
      if (Object.prototype.hasOwnProperty.call(ids[fav.type], e.name)) e.bggId = ids[fav.type][e.name];
    }
  }
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
        const key = keyOf({ provider: 'bgg', externalId: e.externalId });
        attributes.set(key, attributesOf(e.info));
        const title = typeof e.name === 'string' ? e.name.trim() : '';
        if (title) {
          corpusNamed.set(key, {
            title,
            // Stored verbatim by lib/corpus.js, so vouched for here — the same
            // gate lib/recommend.js puts a corpus cover through.
            image: providerCoverUrl(e.info.imageUrl) || null,
            url: `${BGG_WEB}/boardgame/${encodeURIComponent(e.externalId)}`,
          });
        }
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

/*
 * The games behind one favourite name (#1560): every game its average counted,
 * best first, each named by the provider memo or the corpus — never by a
 * stored title, so the payload keeps its no-typed-byte guarantee.
 *
 * ALL OR NOTHING. A game that neither source can name this rebuild could be
 * dropped from the list or from the average; dropping it from the average would
 * let a naming hiccup re-rank the card, so instead the name loses its list and
 * its count renders as plain text, as before #1560. `list.length === games`
 * therefore always holds when a list is present. In practice it never fires:
 * every game with known links got them from a named provider answer or a
 * corpus row, and both carry a title.
 */
function gamesBehind(items) {
  const rows = [];
  for (const g of items) {
    const named = resolved.get(g.key) || corpusNamed.get(g.key);
    if (!named) return null;
    rows.push({ g, named });
  }
  return rows
    .sort((a, b) => (b.g.score - a.g.score)
      || (a.named.title < b.named.title ? -1 : a.named.title > b.named.title ? 1 : 0))
    .map(({ g, named }) => ({
      title: named.title, image: named.image, url: named.url, score: displayScore(g.score),
    }));
}

// The favourites block — each card a ranked list of names — or null when no
// name clears its floors.
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
      key: keyOf(row),
    }));
    // Places are shared on the DISPLAYED mean, exactly like `bestRated`
    // (#1648); `rankNames` already orders inside a tie (raw mean, more games,
    // name), so only the numbering is decided here.
    const placed = [];
    const list = [];
    for (const n of rankNames(games, floors)) {
      // Clamped and rounded for display only, exactly like `bestRated`.
      const score = displayScore(n.mean);
      const rank = nextPlace(placed, score);
      if (rank === null) break;
      placed.push({ shown: score, rank });
      const entry = { name: n.name, score, games: n.games, rank };
      const behind = gamesBehind(n.items);
      if (behind) entry.list = behind;
      list.push(entry);
    }
    if (list.length) out[fav.key] = list;
  }
  if (!Object.keys(out).length) return null;
  await attachLinkIds(out);
  return out;
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

// A metric's qualifying rows, best first and in a TOTAL order (#1648): what is
// shown, then the metric's tiebreak, then the provider key — so the order never
// depends on the order the repo aggregate returned.
function orderRows(metric, rows) {
  return rows.slice().sort((a, b) => (metric.shown(b) - metric.shown(a))
    || metric.tiebreak(a, b) || byProviderKey(a, b));
}

/*
 * The podium block — each metric a ranked list of STATS_LIST_SIZE places, tied
 * entries sharing one (at most STATS_LIST_MAX entries, #1648) — or null when no
 * metric clears its thresholds and resolves.
 *
 * RANKING HAPPENS ON THE RAW NUMBERS, BEFORE ANY PROVIDER CALL — the aggregate
 * is already grouped by provider key, so nothing about ordering needs a title.
 * Only the handful of candidates that could actually be published are resolved,
 * which is what keeps the upstream cost proportional to the number of podiums
 * (six) instead of to the size of every shelf on the instance.
 *
 * THE BUDGET IS SHARED: six metrics x CANDIDATES_PER_METRIC (7) is 42 of
 * PUBLIC_STATS_RESOLVE_MAX's default (62 since #1648), and the favourites take
 * what the podiums leave. A run that hits the bound degrades correctly —
 * SHORTER lists this rebuild, never a blanked card that already had an entry,
 * and the next one resumes from the memo. A new metric that spends hops raises
 * the default with it, as #1557 and #1424 did.
 */
async function podiumsFrom(nameable, period, budget) {
  const out = {};

  for (const metric of METRICS) {
    const candidates = orderRows(metric, nameable.filter(metric.qualifies))
      .slice(0, CANDIDATES_PER_METRIC);

    const placed = [];
    const list = [];
    for (const row of candidates) {
      const shown = metric.shown(row);
      const rank = nextPlace(placed, shown);
      if (rank === null) break;
      // A memoized game costs no hop, so it must not spend from the budget —
      // otherwise a steady state with every list known would still burn the
      // whole allowance every rebuild.
      const known = resolved.has(keyOf(row));
      if (!known && budget.left <= 0) break;
      if (!known) budget.left -= 1;
      const game = await resolveGame(row);
      // An unresolvable game is skipped, not published blank: the next
      // candidate takes its place, which is what the spares are for.
      if (!game) continue;
      placed.push({ shown, rank });
      list.push({ ...game, ...metric.value(row, period), rank });
    }
    if (list.length) out[metric.key] = list;
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
  corpusNamed.clear();
}

// `orderFor` is a test seam over the same `orderRows` the podiums use, keyed by
// metric so a spec can hand it rows without seeding a store.
const orderFor = (key, rows) => orderRows(METRICS.find((m) => m.key === key), rows);

module.exports = {
  publicStatsEnabled, rebuild, publicStats, resetForTests, rankNames, nextPlace, orderFor,
  STATS_LIST_SIZE, STATS_LIST_MAX,
};
