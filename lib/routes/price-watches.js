'use strict';

/*
 * An account's price watches (issue #680): list, set, change, remove, and the
 * game-name search the watch list adds from.
 *
 * Mounted at /api/price-watches INSIDE the /api gate, after withTenant — so the
 * account is resolved, and a suspended or erased one refused, the way every data
 * route gets it — but the store itself is global and keyed by `req.userId`, never
 * by `req.repo`: a watch belongs to the person and a BGG id, not to a tenant.
 * Deliberately not under /api/account, whose routers ride the login limiter
 * (AUTH_RATE_LIMIT_MAX): a search box there would spend the budget that guards
 * sign-in.
 *
 * Invisible (404) unless accounts and prices are both on: without an account
 * there is no one to notify, and without PRICES_ENABLED no price to watch.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../repo');
const accounts = require('../accounts');
const prices = require('../prices');
const quota = require('../quota');
const bgp = require('../prices/boardgameprices');
const { validateBody } = require('../validate');
const { getProvider } = require('../providers');
const { cached } = require('../provider-cache');
const { logger } = require('../observability');

const router = express.Router();

router.use((req, res, next) => {
  if (!accounts.accountsEnabled() || !prices.pricesEnabled()) return res.status(404).json({ error: 'not_found' });
  // Accounts on but no account resolved cannot happen behind the gate; refuse
  // rather than key a watch by `undefined`.
  if (!req.userId) return res.status(401).json({ error: 'auth_required' });
  next();
});

// A BGG id is digits; anything else is not a game the price API can answer for.
const externalId = z.string().regex(/^\d{1,10}$/, 'invalid_game');
// Cents, so the threshold compares exactly; 1 cent to 100,000 in any currency.
const thresholdCents = z.number().int().min(1, 'invalid_threshold').max(10000000, 'invalid_threshold');

const createSchema = z.object({
  externalId,
  // Shown in the list and the inbox item; escaped wherever it is rendered. A
  // game title has no length cap of its own, so a long one is shortened here
  // rather than refused.
  title: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 200) : v), z.string().min(1)),
  thresholdCents,
  // The reader's UI language: decides the market (shipping region + currency),
  // the same way the detail page's price box does, and is stored with the watch.
  lang: z.string().max(10).optional(),
  // The wished game's stored edition (BGG language names), when set from one —
  // so the watch prices the box the group picked (#742). Allowlisted on use.
  editionLanguages: z.array(z.string().max(60)).max(20).optional(),
});
const patchSchema = z.object({ thresholdCents });

// What the client sees. The job's bookkeeping (claims, arming) stays server-side.
const present = (w) => ({
  id: w.id,
  externalId: w.externalId,
  title: w.title,
  thresholdCents: w.thresholdCents,
  currency: w.currency,
  destination: w.destination,
  editionLang: w.editionLang || null,
  lastPrice: w.lastPrice || null,
  lastCheckedAt: w.lastCheckedAt || null,
  createdAt: w.createdAt,
});

router.get('/', async (req, res) => {
  const watches = await repo.listPriceWatches(req.userId);
  res.json({ watches: watches.map(present), limit: quota.priceWatchesPerUser() });
});

// Set a watch — or, when the account already watches this game, change its
// threshold: one watch per account and game, wherever it was set from.
router.post('/', async (req, res) => {
  const body = validateBody(createSchema, req, res);
  if (!body) return;
  const mine = await repo.listPriceWatches(req.userId);
  const existing = mine.find((w) => w.externalId === body.externalId);
  if (existing) {
    const watch = await repo.updatePriceWatch(req.userId, existing.id, rearm(existing, body.thresholdCents));
    return res.json({ watch: present(watch), updated: true });
  }
  if (mine.length >= quota.priceWatchesPerUser()) {
    return res.status(403).json({ error: 'quota_price_watches', limit: quota.priceWatchesPerUser() });
  }
  const market = bgp.marketFor(body.lang);
  const created = await repo.createPriceWatch(req.userId, {
    externalId: body.externalId,
    title: body.title,
    thresholdCents: body.thresholdCents,
    destination: market.destination,
    currency: market.currency,
    editionLang: bgp.editionLang(body.editionLanguages) || bgp.wantedLang(body.lang) || null,
  });
  // A concurrent second POST for the same game lost the unique index's race.
  if (created === 'exists') return res.status(409).json({ error: 'already_watched' });
  res.status(201).json({ watch: present(created) });
});

// A NEW threshold is a new question: re-arm, so a price already under it is
// reported on the next check instead of being treated as the old dip. Saving
// the same value again is not, and must not re-send an alert already sent.
const rearm = (watch, cents) => (watch.thresholdCents === cents
  ? { thresholdCents: cents }
  : { thresholdCents: cents, armed: true, lastNotifiedPrice: null });

router.patch('/:id', async (req, res) => {
  const body = validateBody(patchSchema, req, res);
  if (!body) return;
  const current = await repo.getPriceWatch(req.userId, req.params.id);
  if (!current) return res.status(404).json({ error: 'not_found' });
  const watch = await repo.updatePriceWatch(req.userId, current.id, rearm(current, body.thresholdCents));
  if (!watch) return res.status(404).json({ error: 'not_found' });
  res.json({ watch: present(watch) });
});

router.delete('/:id', async (req, res) => {
  if (!(await repo.deletePriceWatch(req.userId, req.params.id))) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

// The watch list's game search: BGG's own search, through the SAME cache key as
// the add-game lookup (lib/routes/lookup.js), so a name searched in either place
// costs BGG one request per ten minutes. The client searches on Enter, never per
// keystroke (.claude/rules/add-game-lookup-provider.md, BGG's throttling terms).
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const provider = getProvider('bgg');
  try {
    const hits = await cached(`${provider.id}:search:${provider.resolveLocale()}:${q.toLowerCase()}`, () => provider.search(q, 8));
    res.json({ results: hits.map((r) => ({ externalId: String(r.providerId), title: r.title, year: r.year || null })) });
  } catch (err) {
    // Never log q: it is user-typed text (product-event-logging.md).
    logger.warn({ event: 'lookup_provider_failed', provider: provider.id, op: 'watch_search', message: err.message });
    res.status(502).json({ error: 'provider_unreachable' });
  }
});

module.exports = router;
