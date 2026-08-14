'use strict';

/*
 * The one-off cover backfill window (#779).
 *
 * `parseCorpusThing` began reading `<thumbnail>` in #779, so every corpus row
 * enriched before that deploy carries attributes with no `imageUrl` key at all.
 * `replaceCorpus` carries enrichment across a re-upload and `enrichedAt` is only
 * re-asked after BGG_CORPUS_STALE_DAYS (30), so without a nudge those rows keep
 * the placeholder for up to a month. `listCorpusPending` therefore also returns
 * a row whose stored `info` LACKS the key.
 *
 * WHY THE CUTOFF EXISTS — the clause is not self-retiring without it, and the
 * failure is silent and permanent. A row BGG answers nothing for (merged or
 * deleted upstream) is stamped with a fresh `enrichedAt` and NO `info`, on
 * purpose: nulling the stored attributes would empty the corpus one upstream
 * hiccup at a time (.claude/rules/bgg-corpus.md §2). So such a row can never
 * gain the key — keyed on absence alone it returns to the queue on every 15-min
 * tick, for the life of the instance, spending an upstream request each time
 * against a provider whose terms ask for few. Measured by driving the real
 * enrichment pass against a provider that answers nothing: asked on every pass,
 * pending after every pass.
 *
 * The cutoff makes "has this row had its turn?" answerable from the row itself,
 * and the invariant it buys is exactly this:
 *
 *   ANY ask that happens after the cutoff retires the row, answered or not,
 *   because stamping moves `enrichedAt` past it.
 *
 * So the queue drains no matter what BGG does. Before the cutoff a silent row
 * can still repeat, which is why the cutoff must sit at or after the deploy
 * rather than far beyond it — that repeat window is the one unbounded thing
 * left, and the constant is what bounds it.
 *
 * Choosing the value: at or just after the deploy. Too EARLY and a row enriched
 * between the cutoff and the deploy is never eligible, so it keeps the
 * placeholder for up to the full staleness window. Too LATE and the repeat
 * window above stays open that much longer. Note the second condition — the key
 * must be absent — already excludes every row the new parser has touched, so
 * erring slightly late costs only that, never a re-queue of enriched rows.
 *
 * This is a WINDOW, not a schema fact, so the whole clause — this file, both
 * backends' predicates, and their contract cases — is deletable once the corpus
 * has turned over (one pass takes about a day at the default pace, and every row
 * is re-asked within 30 days regardless via the ordinary staleness path). It is
 * deliberately not a migration in CLAUDE.md's sense: nothing rewrites stored
 * data, the enrichment job simply does its normal work slightly sooner.
 */

// Just after #779's deploy. Rows last enriched before this predate covers and
// are owed one re-ask; every ask from here on retires its row.
//
// Must NOT be moved forward later: that would reopen the repeat window and put
// every row enriched in between back in the queue.
const COVER_BACKFILL_BEFORE = '2026-08-16T00:00:00.000Z';

module.exports = { COVER_BACKFILL_BEFORE };
