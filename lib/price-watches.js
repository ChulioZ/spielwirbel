'use strict';

/* The daily price-watch check (#680). The logic half — lib/scheduler.js runs it,
   a test drives it through runJob — split like lib/vote-link.js.

   ## When a watch notifies (decided on #680)

   - A reading AT OR BELOW the threshold notifies when the watch is armed (the
     first reading of a new dip) OR the price is lower than the one last reported.
   - A reading ABOVE the threshold re-arms the watch.
   - No in-stock offer is no reading: the check time moves and the last price
     clears („zuletzt nicht vorrätig"); the dip state is untouched.
   - A body in another currency is not even that — only the check time moves.

   `decideWatch` is that rule as a pure function, so it is pinned case by case
   rather than through the job.

   ## Why the claim

   Two processes run this on every deploy overlap
   (.claude/rules/deploy-invariants-are-pinned-in-code.md). Each due watch is
   claimed first — a compare-and-set on `lastAttemptAt` in the repo — and only
   the claimer fetches and records, so the second process finds nothing to do.
   The claim is also the retry pause: a watch whose fetch failed is due again
   RETRY_AFTER_MS later, not on the next 15-minute tick against an upstream that
   is down.

   ## Why batches

   Their API takes a comma-separated `eid` list, and its only conditions are
   attribution and an hour's caching. One request per watch per day would scale
   with watches; one per (market, 20 games) scales with the catalogue. */

const repo = require('./repo');
const prices = require('./prices');
const bgp = require('./prices/boardgameprices');
const { logger } = require('./observability');

const HOUR = 60 * 60 * 1000;
// "Once a day", with slack: the tick drifts, and a strict 24 h would let each
// check land a quarter-hour later every day.
const CHECK_EVERY_MS = 20 * HOUR;
const RETRY_AFTER_MS = 2 * HOUR;
// Watches handled per tick. At the default quota (50 per account) this is ten
// busy accounts per tick and ~48,000 a day — far past this instance — while
// keeping one tick's upstream work bounded if it ever is not.
const PER_TICK = 500;

const toCents = (amount) => Math.round(Number(amount) * 100);

// The rule above. Returns { patch, notify } for one watch and one reading
// (`null` = nothing in stock to quote).
function decideWatch(watch, reading, nowIso) {
  if (!reading) return { patch: { lastCheckedAt: nowIso, lastPrice: null }, notify: false };
  const cents = toCents(reading.amount);
  const lastPrice = { amountCents: cents, currency: reading.currency, shippingKnown: reading.shippingKnown, observedAt: nowIso };
  const patch = { lastCheckedAt: nowIso, lastPrice };
  if (cents > watch.thresholdCents) return { patch: { ...patch, armed: true }, notify: false };
  const lower = Number.isFinite(watch.lastNotifiedPrice) && cents < watch.lastNotifiedPrice;
  if (watch.armed === false && !lower) return { patch, notify: false };
  return { patch: { ...patch, armed: false, lastNotifiedPrice: cents, lastNotifiedAt: nowIso }, notify: true };
}

// The inbox item: everything the row renders, frozen at the reading — the item
// must say when the price was seen, never imply it is live (#679's PAngV notes),
// and carry the aggregator link their terms ask for when a price is presented.
function inboxPayload(watch, reading, nowIso) {
  return {
    watchId: watch.id,
    externalId: watch.externalId,
    title: watch.title,
    amountCents: toCents(reading.amount),
    currency: reading.currency,
    shippingKnown: reading.shippingKnown,
    thresholdCents: watch.thresholdCents,
    observedAt: nowIso,
    url: reading.url,
  };
}

async function checkPriceWatches({ now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();
  const due = await repo.listDuePriceWatches(
    new Date(now - CHECK_EVERY_MS).toISOString(), new Date(now - RETRY_AFTER_MS).toISOString(), PER_TICK);
  const claimed = [];
  for (const w of due) {
    if (await repo.claimPriceWatch(w.id, w.lastAttemptAt, nowIso)) claimed.push(w);
  }
  const result = { due: due.length, claimed: claimed.length, requests: 0, checked: 0, notified: 0, failed: 0 };
  if (!claimed.length) return result;

  // Batched per market: the threshold is only comparable in the currency the
  // watch was set in, so a batch never mixes two.
  const byMarket = new Map();
  for (const w of claimed) {
    const key = `${w.destination}:${w.currency}`;
    if (!byMarket.has(key)) byMarket.set(key, []);
    byMarket.get(key).push(w);
  }
  // One upstream: once a request fails, the rest of this tick would only wait
  // out the same 12 s timeout chunk after chunk, holding up every job after this
  // one. The claimed watches stay claimed, i.e. due again after RETRY_AFTER_MS.
  let down = false;
  for (const watches of byMarket.values()) {
    const market = { destination: watches[0].destination, currency: watches[0].currency };
    const ids = [...new Set(watches.map((w) => w.externalId))];
    for (let i = 0; i < ids.length; i += bgp.BATCH_MAX) {
      const chunk = ids.slice(i, i + bgp.BATCH_MAX);
      if (down) {
        result.failed += watches.filter((w) => chunk.includes(w.externalId)).length;
        continue;
      }
      let answer;
      result.requests += 1;
      try {
        answer = await bgp.infoBatch(chunk, market);
      } catch (err) {
        // The watches stay exactly as they were apart from the claim, which is
        // what makes them due again after RETRY_AFTER_MS. No inbox item can come
        // out of a failed fetch, because nothing below runs for this chunk.
        result.failed += watches.filter((w) => chunk.includes(w.externalId)).length;
        logger.warn({ event: 'price_watch_fetch_failed', games: chunk.length, error: err.message });
        down = true;
        continue;
      }
      for (const w of watches.filter((x) => chunk.includes(x.externalId))) {
        const reading = bgp.priceFromItems(answer.byId.get(w.externalId) || [], {
          want: w.editionLang || null, market, currency: answer.currency,
        });
        // A body in another currency than asked cannot be compared to the
        // threshold — and is no evidence about stock either, so only the check
        // time moves rather than guessing a rate or claiming „nicht vorrätig".
        const mismatch = reading && reading.currency !== w.currency;
        const { patch, notify } = mismatch ? { patch: { lastCheckedAt: nowIso }, notify: false } : decideWatch(w, reading, nowIso);
        // Recorded only if the threshold is still the one decided against: an
        // edit during this tick re-armed the watch, and must not be undone.
        const recorded = await repo.recordPriceWatchCheck(w.id, patch, notify ? inboxPayload(w, reading, nowIso) : null, w.thresholdCents);
        if (!recorded) continue;
        result.checked += 1;
        if (notify) result.notified += 1;
      }
    }
  }
  logger.info({ event: 'price_watches_checked', ...result });
  return result;
}

const enabled = () => prices.pricesEnabled();

module.exports = { checkPriceWatches, decideWatch, enabled, CHECK_EVERY_MS, RETRY_AFTER_MS, PER_TICK };
