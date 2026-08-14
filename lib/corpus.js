'use strict';

/*
 * The licensed BoardGameGeek game corpus (issue #681) — ingest and enrichment.
 *
 * WHY IT EXISTS. BGG's XML API has no browse, filter or attribute-search
 * endpoint at all: `thing` (by id), `search` (by name), `collection`, `hot`,
 * `family`, `forum`, `user`, `guild`, `plays`. There is no way to ask for "games
 * with weight 2-3 that play well at four", so a recommender cannot query for
 * fits — it has to hold its own candidate pool and score it locally. This module
 * builds and maintains that pool. It computes no scores itself; the features
 * that read it are separate issues.
 *
 * WHERE THE DATA COMES FROM, and why it is a manual upload. BGG publishes one
 * CSV of every game's name, id, rank and rating, and says of it: "For licensing
 * purposes, this data is considered to be part of the XML API" — i.e. the
 * commercial licence this instance already holds (#117) covers it. But
 * https://boardgamegeek.com/data_dumps/bg_ranks requires a logged-in BGG SESSION
 * COOKIE, not the API token, so the server cannot fetch it from production. The
 * operator downloads the zip, unzips it locally and uploads the .csv in the
 * admin panel. That is the design, not a stopgap — do not add a scraper.
 *
 * TWO LICENCE CONDITIONS carry over from #117 and are met here: BGG is credited
 * by name (the "Powered by BGG" logo in the site footer), and THE DATA MAY NOT
 * BE MODIFIED — so everything is stored exactly as BGG reports it. Nothing here
 * translates a category, rescales a weight or rewrites a title. A derived score
 * computed later is new data alongside BGG's, never a rewrite of it.
 *
 * NO PERSONAL DATA, and the legal check was made rather than skipped
 * (.claude/rules/keep-legal-docs-current.md, both directions): the corpus holds
 * public metadata about published games, the fetch is server-side so a visitor's
 * browser contacts nobody new, and BGG is an already-disclosed processor. No
 * privacy-policy, VVT or revision change is needed.
 */

const repo = require('./repo');
const { fromCsv } = require('./csv');
const bgg = require('./providers/bgg');
const { logger } = require('./observability');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every ceiling is read PER CALL, never at module load, so a live retune takes
// effect without a restart — the same reason lib/app.js reads its rate limits
// per createApp().
const num = (name, fallback, min, max) => {
  const n = parseInt(process.env[name], 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

// How many games the corpus keeps, best-ranked first. 5000 is roughly BGG's
// "everything anyone has heard of" band and about 40 MB of JSON at full
// enrichment; there is no point storing 140k rows to score 5k of them.
const corpusSize = () => num('BGG_CORPUS_SIZE', 5000, 1, 100000);

// Below this many ratings BGG's own averages are noise — a weight of 4.5 from
// eleven people says nothing. BGG itself only ranks a game past 30 ratings, so
// the cap above already does most of this work; the floor is what keeps a thinly
// -rated row out if the cap is ever raised.
const minRatings = () => num('BGG_CORPUS_MIN_RATINGS', 100, 0, 100000);

// How many /thing requests one scheduler tick may spend. At 20 ids each and a
// 15-minute tick, the default fills a 5000-game corpus in about six hours and
// then trickles: once every row is enriched, the staleness window below yields
// well under one batch per tick. BGG's terms ask for FEW requests, not fast
// ones, which is what this number is really tuned against.
const batchesPerTick = () => num('BGG_CORPUS_BATCHES_PER_TICK', 10, 0, 250);

// When an enriched row goes back into the queue. Weights and player-count polls
// move over months, so 30 days is generous; the point is that the corpus keeps
// itself current between the operator's uploads rather than freezing at whatever
// the first enrichment pass saw.
const staleDays = () => num('BGG_CORPUS_STALE_DAYS', 30, 1, 3650);

// Deliberate spacing between batches. Not a rate limiter — fetchXml already
// retries BGG's "too busy" statuses — but the courtesy their terms ask for.
const BATCH_PAUSE_MS = 2000;

/* --------------------------------- ingest ---------------------------------- */

// The ranks dump's columns. Only `id`, `name` and `rank` are required: a file
// missing any of them is not this dump, and refusing on that basis is what turns
// "the operator picked the wrong file" into a clear error instead of an empty
// corpus. Everything else degrades to null.
const REQUIRED = ['id', 'name', 'rank'];

const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
};
const float = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// BGG names the zip `boardgames_ranks_<date>.zip`, and the csv inside it carries
// no date at all — so this finds one only when the operator's file name kept it.
// A null is honest and the panel says so; `uploadedAt`, which is always known, is
// what the staleness verdict actually keys off.
const DUMP_DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const dumpDateFrom = (filename) => {
  const m = DUMP_DATE_RE.exec(String(filename || ''));
  return m ? m[1] : null;
};

/*
 * Parse the ranks CSV into the rows worth keeping. Returns
 * { entries, total, dropped } or the marker string 'invalid_csv'.
 *
 * Three filters, all applied HERE rather than at read time, because the point of
 * the cap is that the store never holds 140k rows:
 *   - expansions are dropped (they are recorded on the game they expand, not as
 *     candidates of their own — .claude/rules/expansions-widen-by-union.md);
 *   - unranked rows are dropped (rank 0 is BGG's "not ranked", and the ranking
 *     is the only quality signal in this file);
 *   - rows under the ratings floor are dropped.
 * Then the best-ranked `corpusSize()` survive.
 */
function parseRanksCsv(text) {
  const rows = fromCsv(text);
  if (!rows.length) return 'invalid_csv';
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const at = (name) => header.indexOf(name);
  if (REQUIRED.some((name) => at(name) === -1)) return 'invalid_csv';

  const idAt = at('id');
  const nameAt = at('name');
  const rankAt = at('rank');
  const yearAt = at('yearpublished');
  const ratingAt = at('average');
  const bayesAt = at('bayesaverage');
  const ratedAt = at('usersrated');
  // BGG spells it `is_expansion`; the fallback covers a renamed column rather
  // than silently letting every expansion into the pool.
  const expansionAt = at('is_expansion') === -1 ? at('isexpansion') : at('is_expansion');

  const floor = minRatings();
  const entries = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const cell = (idx) => (idx === -1 ? '' : (r[idx] ?? ''));
    const externalId = String(cell(idAt)).trim();
    const name = String(cell(nameAt)).trim();
    const rank = int(cell(rankAt));
    if (!/^\d+$/.test(externalId) || !name) continue;
    if (expansionAt !== -1 && int(cell(expansionAt)) === 1) continue;
    if (rank === null || rank <= 0) continue;
    const usersRated = int(cell(ratedAt));
    if (floor > 0 && (usersRated === null || usersRated < floor)) continue;
    entries.push({
      externalId,
      name,
      year: int(cell(yearAt)),
      rank,
      rating: float(cell(ratingAt)),
      bayesRating: float(cell(bayesAt)),
      usersRated,
    });
  }

  if (!entries.length) return 'invalid_csv';
  entries.sort((a, b) => a.rank - b.rank);
  const kept = entries.slice(0, corpusSize());
  return { entries: kept, total: rows.length - 1, dropped: rows.length - 1 - kept.length };
}

/*
 * Ingest an uploaded dump. Returns the parse marker unchanged on a bad file, so
 * the route can answer 400 — and NOTHING IS WRITTEN in that case, which is the
 * acceptance criterion that matters: a mis-picked file must leave the corpus
 * that features are reading exactly as it was.
 */
async function ingestCsv(text, { filename, uploadedAt } = {}) {
  const parsed = parseRanksCsv(text);
  if (typeof parsed === 'string') return parsed;
  const meta = {
    dumpDate: dumpDateFrom(filename),
    uploadedAt: uploadedAt || new Date().toISOString(),
  };
  const { rows } = await repo.replaceCorpus(parsed.entries, meta);
  logger.info({ event: 'bgg_corpus_uploaded', rows, dropped: parsed.dropped });
  return { rows, total: parsed.total, dropped: parsed.dropped, ...meta };
}

/* ------------------------------- enrichment -------------------------------- */

// What of a parsed /thing item is stored. `providerId` is dropped because it is
// the key the row is found by; keeping it would store the id twice and let the
// two disagree.
function attributesOf(item) {
  const rest = { ...item };
  delete rest.providerId;
  return rest;
}

/*
 * One bounded, resumable pass over the enrichment queue.
 *
 * RESUMABLE WITHOUT A CURSOR, which is the part worth stating because a stored
 * cursor is what the issue proposed. The queue itself is the cursor: a row is
 * pending exactly while `enrichedAt` is null or stale, so a restart mid-pass
 * simply re-reads what is still owed. That is strictly better than a stored
 * position — a cursor can point past rows a concurrent upload inserted, and it
 * needs its own reset when the corpus is replaced.
 *
 * IDEMPOTENT ACROSS REPLICAS for the same reason. Railway's zero-downtime deploy
 * overlaps two containers on every deploy (regardless of numReplicas — see
 * .claude/rules/deploy-invariants-are-pinned-in-code.md), so two passes can run
 * at once. Both would fetch the same head of the queue and write the same
 * attributes: wasted requests, never wrong data or duplicated rows.
 *
 * EVERY ASKED-ABOUT ID IS STAMPED, including ones BGG answered nothing for. A
 * row left unstamped returns to the head of the queue on the next tick forever
 * and blocks everything behind it — the asked-vs-answered lesson from #736. The
 * attributes of such a row are left untouched rather than nulled, so a transient
 * gap in BGG's answer cannot erase what an earlier pass learned.
 */
async function enrich({ maxBatches, pauseMs, now } = {}) {
  const batches = maxBatches === undefined ? batchesPerTick() : Math.max(0, maxBatches);
  const pause = pauseMs === undefined ? BATCH_PAUSE_MS : Math.max(0, pauseMs);
  const at = now instanceof Date ? now : new Date();
  const staleBefore = new Date(at.getTime() - staleDays() * 86400000).toISOString();

  const result = { batches: 0, asked: 0, enriched: 0, failed: false };
  if (!batches) return result;

  const pending = await repo.listCorpusPending(batches * bgg.MAX_CORPUS_BATCH, staleBefore);
  if (!pending.length) return result;

  for (let i = 0; i < pending.length; i += bgg.MAX_CORPUS_BATCH) {
    const slice = pending.slice(i, i + bgg.MAX_CORPUS_BATCH);
    if (result.batches > 0 && pause > 0) await sleep(pause);

    let answer;
    try {
      answer = await bgg.corpus(slice.map((e) => e.externalId));
    } catch (err) {
      // A batch that fails stops the pass rather than taking the whole job down:
      // the batches already written stay written, and the rest is simply still
      // owed on the next tick. Reported so a standing BGG outage is visible in
      // the operator panel's log card rather than as a silent no-op.
      logger.warn({ event: 'bgg_corpus_enrich_failed', batch: result.batches, message: err.message });
      result.failed = true;
      break;
    }

    // No token: nothing was asked, so nothing may be stamped. Stopping here (not
    // continuing) keeps a tokenless instance from spending the whole pass
    // discovering the same thing 10 times.
    if (!answer.asked.length) break;

    const byId = new Map(answer.items.map((it) => [it.providerId, it]));
    const stamp = new Date().toISOString();
    const updates = answer.asked.map((externalId) => {
      const item = byId.get(externalId);
      // `info` is deliberately OMITTED (not null) when BGG had nothing, so the
      // repo leaves whatever is stored alone.
      return item
        ? { externalId, enrichedAt: stamp, info: attributesOf(item) }
        : { externalId, enrichedAt: stamp };
    });
    await repo.updateCorpusEntries(updates);

    result.batches += 1;
    result.asked += answer.asked.length;
    result.enriched += byId.size;
  }

  if (result.asked) logger.info({ event: 'bgg_corpus_enriched', ...result });
  return result;
}

// The corpus is only ever filled by BGG, so an instance without a token has
// nothing to enrich with — and must not spend a query per tick discovering it.
const enrichEnabled = () => bgg.tokenSet();

module.exports = {
  parseRanksCsv,
  ingestCsv,
  enrich,
  enrichEnabled,
  corpusSize,
  minRatings,
  batchesPerTick,
  staleDays,
  BATCH_PAUSE_MS,
};
