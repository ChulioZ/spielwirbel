'use strict';

/*
 * The BGG corpus (#681) held in process memory for the recommender (#682).
 *
 * WHY IT EXISTS. Scoring the candidates is milliseconds; READING them is not.
 * `GET …/recommendations` would pay the whole corpus per request — the same
 * "the transfer dominates" arithmetic as
 * .claude/rules/railway-db-same-region.md, which is why listRoundSummaries
 * exists at all.
 *
 * MEASURED 2026-08-14, because the sizing is the operator's call and the default
 * is not the interesting case. docs/configuration.md records that a real dump
 * yields 17,483 ELIGIBLE rows, and advises setting BGG_CORPUS_SIZE above that so
 * the ratings floor rather than the rank cap decides what is kept:
 *
 *   rows    JSON     heap held    recommend() per request
 *   5,000   2.5 MB    4 MB          9.6 ms
 *  17,483   8.9 MB   10 MB         27.7 ms   <- the realistic setting
 * 100,000  50.4 MB   68 MB        171.2 ms   <- the hard ceiling in lib/corpus.js
 *
 * So the read this avoids is ~9 MB, not a rounding error, and the snapshot costs
 * ~10 MB of heap. The last row is the one to keep in mind before raising the
 * ceiling much further: the corpus is held PER PROCESS, and a Railway deploy
 * overlaps two of them. It is unreachable from today's dump — above the eligible
 * count the cap stops binding — but a future dump could change that.
 *
 * Process-local and READ-ONLY, so overlapping replicas each holding a copy is
 * fine: nothing here is authoritative, and two containers with slightly
 * different copies answer slightly differently-ranked lists of public game
 * facts. Same reasoning as lib/provider-cache.js.
 *
 * TWO refresh triggers, and both are needed:
 *   - `invalidate()` from lib/corpus.js, on the writes THIS process made (an
 *     operator upload, an enrichment batch), so a freshly enriched row is
 *     scored on the next request rather than in half an hour;
 *   - a TTL, for the writes it did not make. Railway overlaps two containers on
 *     every deploy (.claude/rules/deploy-invariants-are-pinned-in-code.md), so
 *     the enrichment tick that wrote a row may have run in the OTHER one, where
 *     no invalidate() of ours can reach. Without the TTL that process would
 *     serve its boot-time snapshot until it was replaced.
 */

const repo = require('./repo');

// Generous on purpose: the corpus changes on a monthly operator upload and on an
// enrichment tick every 15 minutes, and a recommendation computed against a
// half-hour-old snapshot of BGG's ranks is not observably different from one
// computed against the current row.
const TTL_MS = 30 * 60 * 1000;

let entries = null;
let loadedAt = 0;
// The in-flight load is shared, so a burst of concurrent requests on a cold
// process issues ONE read instead of one each — the shape /readyz uses
// (.claude/rules/liveness-vs-readiness-probes.md).
let inFlight = null;

// Drop the snapshot. Called after this process writes to the corpus; the next
// read re-fetches. Deliberately NOT an immediate re-read: an enrichment pass
// writes ten batches per tick, and re-reading the whole corpus after each would
// spend the cost this module exists to avoid.
function invalidate() {
  entries = null;
  loadedAt = 0;
}

async function corpusEntries({ now = Date.now() } = {}) {
  if (entries && now - loadedAt < TTL_MS) return entries;
  if (!inFlight) {
    inFlight = repo
      .listCorpusEntries()
      .then((rows) => {
        entries = rows;
        loadedAt = now;
        return rows;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

module.exports = { corpusEntries, invalidate, TTL_MS };
