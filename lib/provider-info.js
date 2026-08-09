'use strict';

/*
 * Lazy backfill of provider-sourced game info — weight + description (#717).
 *
 * Games added before the fields existed (and BGG collection imports, whose
 * bodies never carry either) get them filled in silently, server-side, from
 * the two places where the fields are about to be read: opening a game's
 * detail (GET …/games/:gid/provider-info) and starting a session
 * (fire-and-forget in lib/routes/sessions.js, so both voting surfaces read
 * stored values). The triggering request never blocks on or fails with the
 * provider — see backfillProviderInfo.
 */

const { getProvider } = require('./providers');

// How long a recorded attempt suppresses a re-fetch for a game the provider
// had no data for. Generous on purpose: weight and description barely change,
// and BGG's terms ask for few requests — the cost of staleness here is a
// missing nicety, not a wrong answer.
const PROVIDER_INFO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Whether a game is worth asking the provider about: linked to a provider that
// exposes the capability, missing at least one of the two fields, and not
// already asked within the TTL. `providerInfoAt` records the ATTEMPT, so a
// game BGG genuinely has no data for is not re-fetched on every view.
function needsProviderInfo(game, now = Date.now()) {
  if (!game || !game.source || !game.source.externalId) return false;
  const provider = getProvider(game.source.provider);
  if (!provider || typeof provider.gameInfo !== 'function') return false;
  if (game.weight != null && game.description != null) return false;
  const at = game.providerInfoAt ? Date.parse(game.providerInfoAt) : NaN;
  return !(Number.isFinite(at) && now - at < PROVIDER_INFO_TTL_MS);
}

// Fetch and persist missing info for these games, best-effort. One batched
// /thing call per provider (BGG accepts a comma-separated id list), so a
// session draw of five unfilled games costs one upstream request.
//
// Two failure rules, deliberately asymmetric:
//   - an UPSTREAM failure stamps nothing, so a throttled answer is retried on
//     the next trigger rather than suppressed for the whole TTL;
//   - a successful answer that lacks a game's data stamps `providerInfoAt`
//     anyway — that is the "BGG has nothing for this one" case the TTL exists
//     for.
async function backfillProviderInfo(repo, rid, games) {
  const eligible = (games || []).filter((g) => needsProviderInfo(g));
  const byProvider = new Map();
  for (const g of eligible) {
    const list = byProvider.get(g.source.provider) || [];
    list.push(g);
    byProvider.set(g.source.provider, list);
  }
  for (const [pid, list] of byProvider) {
    let infos;
    try {
      infos = await getProvider(pid).gameInfo(list.map((g) => g.source.externalId));
    } catch {
      continue;
    }
    const byId = new Map(infos.map((i) => [i.providerId, i]));
    for (const g of list) {
      const info = byId.get(g.source.externalId) || {};
      await repo.setGameProviderInfo(rid, g.id, {
        weight: info.weight == null ? null : info.weight,
        description: info.description == null ? null : info.description,
      });
    }
  }
}

module.exports = { needsProviderInfo, backfillProviderInfo, PROVIDER_INFO_TTL_MS };
