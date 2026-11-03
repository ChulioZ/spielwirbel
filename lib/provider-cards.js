'use strict';

/*
 * Fill a cover and a player range onto provider-linked games that were created
 * without either — the play-history import (#1665), whose sources name a game
 * by BGG id and title only. The lazy provider-info backfill
 * (lib/provider-info.js) cannot do it: it fills PROVIDER_INFO_FIELDS, never an
 * image or a range.
 *
 * Server-side and after the write, fire-and-forget, rather than the Myludo
 * import's client-side GET …/lookup/cards (#1758): the play import sends many
 * batches and has no preview of covers to show, so fetching first would only
 * make the user wait for pictures nobody looks at before the import.
 *
 * What it must never do, and how:
 *   - overwrite what a user set in the meantime — repo.fillGameCards writes
 *     only into a game still lacking the field (lib/repo/card-patch.js);
 *   - store a cover outside the host allowlist — every URL passes
 *     providerCoverUrl, which also keeps it a HOTLINK (#172);
 *   - block or fail the import — the caller does not await it, and every
 *     failure here is logged and swallowed.
 *
 * No `providerInfoAt`-style stamp: this runs once per import, never on a view,
 * so there is no repeated trigger to suppress.
 */

const { getProvider, providerCoverUrl } = require('./providers');
const { logger } = require('./observability');

// Same bound and pacing as the shelf fill (lib/provider-info.js), read from the
// same env var so a spec drives a multi-batch pass without waiting it out.
const MAX_BATCHES = 15;
const batchPauseMs = () => {
  const n = Number(process.env.PROVIDER_INFO_BATCH_PAUSE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
};
const sleep = (ms) => new Promise((r) => {
  const t = setTimeout(r, ms);
  if (typeof t.unref === 'function') t.unref();
});

const lacksCard = (g) => !g.image || (g.minPlayers == null && g.maxPlayers == null);

async function fillProviderCards(repo, rid, games) {
  const byProvider = new Map();
  for (const g of games || []) {
    if (!g || !g.source || !g.source.externalId || !lacksCard(g)) continue;
    const provider = getProvider(g.source.provider);
    if (!provider || typeof provider.cards !== 'function') continue;
    const list = byProvider.get(g.source.provider) || [];
    list.push(g);
    byProvider.set(g.source.provider, list);
  }

  const result = { batches: 0, updated: 0, failed: false };
  for (const [pid, list] of byProvider) {
    const provider = getProvider(pid);
    const size = Number.isInteger(provider.MAX_THING_IDS) ? provider.MAX_THING_IDS : list.length;
    for (let i = 0; i < list.length && result.batches < MAX_BATCHES; i += size) {
      const slice = list.slice(i, i + size);
      if (result.batches > 0) await sleep(batchPauseMs());
      result.batches += 1;
      let cards;
      try {
        cards = await provider.cards(slice.map((g) => g.source.externalId));
      } catch (err) {
        logger.warn({
          event: 'provider_cards_fill_failed',
          provider: pid,
          batch: result.batches,
          ids: slice.length,
          status: err.status,
          message: err.message,
        });
        result.failed = true;
        continue;
      }
      const byId = new Map((cards || []).map((c) => [String(c.providerId), c]));
      const updates = [];
      for (const g of slice) {
        const c = byId.get(String(g.source.externalId));
        if (!c) continue;
        updates.push({
          gameId: g.id,
          image: providerCoverUrl(c.imageUrl),
          minPlayers: c.minPlayers,
          maxPlayers: c.maxPlayers,
        });
      }
      if (!updates.length) continue;
      const out = await repo.fillGameCards(rid, updates);
      if (out) result.updated += out.updated;
    }
  }
  return result;
}

module.exports = { fillProviderCards };
