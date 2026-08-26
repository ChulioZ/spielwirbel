'use strict';

/*
 * Lazy backfill of provider-sourced game info — weight (#717), playing time /
 * age / categories / mechanics / rating (#724).
 *
 * Games added before the fields existed (and BGG collection imports, whose
 * bodies never carry any of them) get them filled in silently, server-side,
 * from the places where the fields are about to be read. There are FIVE:
 *
 *   1. opening a game's detail          GET  …/games/:gid/provider-info
 *   2. a BGG collection import          lib/routes/lookup.js (#721)
 *   3. starting a session               lib/routes/sessions.js, after the draw
 *   4. the two FILTER screens           POST …/games/provider-info (#736) —
 *      the session setup screen and the Regal, shelf-wide and bounded to one
 *      upstream request per call
 *   5. a session start CARRYING metadata filters (#736) — the one blocking
 *      trigger, before the draw, since the filters are applied to these values
 *
 * (4) and (5) exist because #725 gave two screens filters over these fields
 * while neither was a trigger, and an absent value passes every filter by
 * design — so the filters silently did not filter and the controls silently did
 * not appear. Every trigger but (5) is fire-and-forget, and even (5) never
 * blocks the draw for longer than its timeout — see backfillProviderInfo.
 *
 * SINCE #829 every trigger tries the LOCAL BGG CORPUS first (#681). It already
 * holds each of these fields for its enriched rows, fetched under the same
 * licence, so a shelf of mainstream games fills at zero upstream cost and the
 * paced pass below shrinks to whatever the corpus does not cover.
 *
 * SINCE #828 triggers (2) and (4) share one paced pass over the whole shelf
 * (`startShelfFill`) instead of each spending a single batch of its own. The
 * reason is arithmetic: BGG answers at most 20 ids per request, so one batch per
 * screen open would fill a 150-game shelf in eight visits. The screen trigger
 * still answers after its FIRST batch — so the filters appear at once — and
 * leaves the rest running behind the response.
 */

const { getProvider } = require('./providers');
const { logger } = require('./observability');
// The MODULE-LEVEL repo, deliberately not the tenant-scoped one every function
// here is handed: the corpus is global and un-scoped, so `forTenant` does not
// carry these methods at all (lib/repo/index.js). Same shape lib/corpus.js uses.
//
// NAMED `corpusRepo`, not `repo`, and that is not cosmetic: every function below
// takes the TENANT-scoped repo as a parameter called `repo`, so a module-level
// binding of that name would be shadowed inside exactly the functions that use
// both — silently reading round data through one and the corpus through the
// other depending on scope. The two are different objects with different reach;
// the names have to say which is which.
const corpusRepo = require('./repo');
// Only the ACTIVE shelf is worth filling: a wished or archived game reaches no
// draw pool and no filter screen (.claude/rules/active-games-filter-sites.md).
const { isActiveGame } = require('../public/js/draw-pool');
// The field shape lives in its own dependency-free module so the repo backends
// can share it without gaining a path to the provider registry.
const { PROVIDER_INFO_FIELDS, hasProviderField, assignProviderInfo } = require('./provider-info-fields');

// How long a recorded attempt suppresses a re-fetch for a game the provider
// had no data for. Generous on purpose: the provider metadata barely changes,
// and BGG's terms ask for few requests — the cost of staleness here is a
// missing nicety, not a wrong answer.
const PROVIDER_INFO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Whether a game is worth asking the provider about: linked to a provider that
// exposes the capability, missing at least one field, and not already asked
// within the TTL. `providerInfoAt` records the ATTEMPT, so a game BGG genuinely
// has no data for is not re-fetched on every view.
//
// THE TRAP (#724): this check short-circuits on the fields it knows about, so
// shipping a new field without adding it to PROVIDER_INFO_FIELDS means every
// game #717's backfill already filled returns false here FOREVER — the games
// with the best coverage are exactly the ones that never receive it, with no
// error and no failing test. Two consequences of widening it, both accepted:
//   - a game BGG genuinely has no categories (or no weight) for is re-asked once
//     per TTL, forever. That was already true before #724, so it is the standing
//     cost of the lazy design rather than a new one;
//   - the one-time re-fetch after a deploy is spread across every game's next
//     detail-open or session start, and a draw's unfilled games ride one batch,
//     so a session draw still costs one upstream request.
function needsProviderInfo(game, now = Date.now()) {
  if (!game || !game.source || !game.source.externalId) return false;
  const provider = getProvider(game.source.provider);
  if (!provider || typeof provider.gameInfo !== 'function') return false;
  if (PROVIDER_INFO_FIELDS.every((k) => hasProviderField(game, k))) return false;
  const at = game.providerInfoAt ? Date.parse(game.providerInfoAt) : NaN;
  return !(Number.isFinite(at) && now - at < PROVIDER_INFO_TTL_MS);
}

// Pacing between two upstream attempts in one pass, mirroring lib/corpus.js's
// BATCH_PAUSE_MS. Only a MULTI-batch caller ever waits it out — the pause is
// taken between attempts, never before the first — so the interactive triggers
// are untouched by it.
//
// Read per call from env, like DRAW_BACKFILL_TIMEOUT_MS in lib/routes/sessions.js,
// which is what lets a spec drive a multi-batch pass in milliseconds instead of
// parking the suite for six seconds per shelf.
const batchPauseMs = () => {
  const n = Number(process.env.PROVIDER_INFO_BATCH_PAUSE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
};

// How many batches one shelf fill may spend. 15 x MAX_THING_IDS = 300 games,
// which is the ceiling gameInfo itself used to carry; past it the pass simply
// ends and the next screen open resumes where it stopped, because each filled
// game drops out of `needsProviderInfo`.
const SHELF_FILL_BATCHES = 15;

// unref'd, like the draw's own race timer: this pause runs behind a response
// already sent, so an un-unref'd one would hold `node --test` open after the
// last assertion and keep a shutting-down server waiting on a fill nobody is
// reading (lib/scheduler.js's header, for the same trap one layer over).
const sleep = (ms) => new Promise((r) => {
  const t = setTimeout(r, ms);
  if (typeof t.unref === 'function') t.unref();
});

// Fetch and persist missing info for these games, best-effort. Chunked into
// upstream requests of at most `provider.MAX_THING_IDS` ids, exactly as
// lib/corpus.js chunks its own enrichment — the batch SIZE belongs to the
// provider, the batch COUNT and the pacing to the caller.
//
// `maxBatches` caps how many upstream requests the whole call may spend — across
// providers, not per provider, since what it is really bounding is this app's
// draw on someone else's server (#736) — and `pauseMs` how long it waits
// between them. The interactive triggers
// pass `{ maxBatches: 1 }` and no pause; the background shelf fill passes many
// and paces them.
//
// Returns a summary — `{ batches, asked, filled, failed }` — which the caller
// needs for two things it cannot otherwise see: whether the pass is making
// progress, and whether the upstream is failing. Before #828 every failure was
// swallowed here and reported nowhere, which is how a hop that answered 400 to
// EVERY request ran unnoticed in production from the day it shipped.
//
// Three failure rules, the first two deliberately asymmetric:
//   - an UPSTREAM failure stamps nothing, so a throttled answer is retried on
//     the next trigger rather than suppressed for the whole TTL;
//   - a successful answer that lacks a game's data stamps `providerInfoAt`
//     anyway — that is the "BGG has nothing for this one" case the TTL exists
//     for;
//   - a game the provider never ASKED about is left completely untouched. It is
//     the same rule as the first, for the failure one layer up: the provider
//     bounds how many ids it will carry and drops the overflow, so stamping the
//     whole eligible list recorded games as "asked, BGG had nothing" without a
//     request ever going out — invisible, and good for a full 7 days. Hence
//     `asked`, which the provider reports rather than this file re-deriving a
//     bound that is not its own.
//
// A FAILED BATCH IS SKIPPED, and only a second CONSECUTIVE failure ends the pass
// (#780's lesson, which had only ever been applied to the corpus hop). Stopping
// on the first is the right instinct for an outage and the wrong one for a
// single slow answer; the counter is what tells them apart. Either way the
// batches already written stay written and the skipped ids stay unstamped, so
// they are simply still owed on the next trigger.
async function backfillProviderInfo(repo, rid, games, { maxBatches = 1, pauseMs = 0 } = {}) {
  const eligible = (games || []).filter((g) => needsProviderInfo(g));
  const byProvider = new Map();
  for (const g of eligible) {
    const list = byProvider.get(g.source.provider) || [];
    list.push(g);
    byProvider.set(g.source.provider, list);
  }

  const result = { batches: 0, asked: 0, filled: 0, fromCorpus: 0, failed: false };
  for (const [pid, list] of byProvider) {
    const provider = getProvider(pid);
    // The local corpus first (#829): free, and it covers most of a typical
    // shelf. Only what it cannot fill costs an upstream request.
    const pending = pid === CORPUS_PROVIDER
      ? await fillFromCorpus(repo, rid, list, result)
      : list;
    // A provider that batches without saying how much is asked for the whole
    // list at once — its own hop is then what bounds the request, exactly as
    // gameInfo's slice does. Never a number invented here: a ceiling copied into
    // the caller is the drift this file's `asked` contract exists to prevent.
    const size = Number.isInteger(provider.MAX_THING_IDS) ? provider.MAX_THING_IDS : pending.length;
    let consecutiveFailures = 0;
    for (let i = 0; i < pending.length && result.batches < maxBatches; i += size) {
      const slice = pending.slice(i, i + size);
      // Paced off ATTEMPTS, not written batches: a struggling upstream is the
      // last one to hammer, so a failed batch is still followed by a pause.
      if (result.batches > 0 && pauseMs > 0) await sleep(pauseMs);
      result.batches += 1;

      let answer;
      try {
        answer = await provider.gameInfo(slice.map((g) => g.source.externalId));
        consecutiveFailures = 0;
      } catch (err) {
        logger.warn({
          event: 'provider_info_backfill_failed',
          provider: pid,
          batch: result.batches,
          ids: slice.length,
          status: err.status,
          message: err.message,
        });
        result.failed = true;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 2) break;
        continue;
      }

      const { items, asked } = answer || {};
      const askedIds = new Set(asked || []);
      const byId = new Map((items || []).map((i) => [i.providerId, i]));
      result.asked += askedIds.size;
      for (const g of slice) {
        if (!askedIds.has(g.source.externalId)) continue;
        const info = byId.get(g.source.externalId) || {};
        const patch = {};
        for (const k of PROVIDER_INFO_FIELDS) patch[k] = info[k] == null ? null : info[k];
        await repo.setGameProviderInfo(rid, g.id, patch);
        result.filled += 1;
      }
    }
  }
  return result;
}

// Which provider the corpus is about. It is BGG's by construction — the table is
// `bgg_corpus`, the ingest is BGG's ranks CSV, the enrichment is BGG's /thing —
// so this is a fact stated once rather than a capability a second provider could
// ever advertise.
const CORPUS_PROVIDER = 'bgg';

// One corpus row in provider-info shape, or NULL when it cannot fill the game
// COMPLETELY.
//
// The two halves come from different places and neither is optional: `rating` is
// the uploaded CSV's `average`, sitting at the row's top level, while everything
// else rides in `info` from the enrichment hop. A row nobody has enriched yet
// therefore carries the rating alone — which is exactly the partial case below.
//
// COMPLETE-OR-NOTHING, and that is the whole stamping rule (§2 of
// .claude/rules/provider-info-triggers-and-stamping.md). `setGameProviderInfo`
// always stamps `providerInfoAt`, and the stamp is what suppresses the next
// fetch for a full TTL — so writing a partial row here would hide a game from
// the upstream hop that could have completed it, for seven days, with no request
// ever having gone out. Skipping it instead costs nothing: the hop fills it a
// moment later anyway, and stamps it honestly.
//
// Extra corpus keys (families, designers, imageUrl, recommendedWith …) are
// dropped by assignProviderInfo, which copies PROVIDER_INFO_FIELDS only.
function corpusPatch(entry) {
  if (!entry) return null;
  const patch = assignProviderInfo({}, { ...(entry.info || {}), rating: entry.rating });
  return PROVIDER_INFO_FIELDS.every((k) => hasProviderField(patch, k)) ? patch : null;
}

// Fill what the local corpus already knows, and return the games it could not.
// ONE query for the whole list, and no upstream request at all — which is why it
// deliberately ignores `maxBatches`: that budget bounds this app's draw on BGG's
// server, and this spends none of it.
//
// Every failure degrades to "the corpus knows nothing", never to a failed fill:
// the upstream hop behind it is the real path and was the only path before #829.
async function fillFromCorpus(tenantRepo, rid, games, result) {
  if (typeof corpusRepo.getCorpusEntries !== 'function') return games;
  let entries;
  try {
    entries = await corpusRepo.getCorpusEntries(games.map((g) => g.source.externalId));
  } catch (err) {
    logger.warn({ event: 'provider_info_corpus_read_failed', rid, message: err.message });
    return games;
  }
  const byId = new Map((entries || []).map((e) => [e.externalId, e]));
  const remaining = [];
  const updates = [];
  for (const g of games) {
    const patch = corpusPatch(byId.get(g.source.externalId));
    if (!patch) { remaining.push(g); continue; }
    updates.push({ gameId: g.id, info: patch });
  }
  // ONE write for the whole shelf, not one per game. The corpus read costs no
  // upstream request, so a fully-covered 300-game shelf lands here in a burst
  // with nothing pacing it — and the single-game writer rewrites the entire
  // data.json on the JSON backend (or opens a transaction per game on Postgres).
  if (updates.length) {
    await tenantRepo.setGameProviderInfoMany(rid, updates);
    result.fromCorpus += updates.length;
    result.filled += updates.length;
  }
  return remaining;
}

// rid -> the pass running for it, so a second trigger joins the first rather
// than starting a second pass over the same shelf.
//
// PROCESS-LOCAL, and that is an optimisation rather than a correctness
// requirement — it has to be, because a deploy overlaps two containers even at
// `numReplicas: 1` (.claude/rules/deploy-invariants-are-pinned-in-code.md). A
// double pass is harmless: `needsProviderInfo` re-reads the stored row, so the
// second one finds the games already filled and asks nothing.
const filling = new Map();

// Fill a round's whole active shelf in the background, paced (#828). Awaited by
// nobody: every caller has already answered the request the user is waiting on,
// so a failure here changes nothing they can see and the next trigger retries.
//
// Deliberately re-reads the round rather than taking the caller's game list. The
// import's list is what it just created, but the shelf may hold older unfilled
// games too, and "fill the shelf" is what both callers actually want.
function startShelfFill(repo, rid) {
  const running = filling.get(rid);
  if (running) return running;
  const pass = (async () => {
    try {
      const round = await repo.getRound(rid);
      if (!round) return null;
      const eligible = (round.games || []).filter(isActiveGame).filter((g) => needsProviderInfo(g));
      if (!eligible.length) return null;
      return await backfillProviderInfo(repo, rid, eligible, {
        maxBatches: SHELF_FILL_BATCHES,
        pauseMs: batchPauseMs(),
      });
    } catch (err) {
      logger.warn({ event: 'provider_info_shelf_fill_failed', rid, message: err.message });
      return null;
    }
  })().finally(() => filling.delete(rid));
  filling.set(rid, pass);
  return pass;
}

// The pass running for a round, or null. A test seam, and the same one
// lib/scheduler.js draws for the same reason: a background job that can only be
// observed by sleeping is a job that ends up untested. The routes deliberately
// do NOT await it — nobody is waiting on the fill.
function shelfFillInFlight(rid) {
  return filling.get(rid) || null;
}

module.exports = {
  needsProviderInfo,
  backfillProviderInfo,
  startShelfFill,
  shelfFillInFlight,
  PROVIDER_INFO_TTL_MS,
  PROVIDER_INFO_FIELDS,
  SHELF_FILL_BATCHES,
};
