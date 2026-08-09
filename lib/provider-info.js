'use strict';

/*
 * Lazy backfill of provider-sourced game info — weight + description (#717),
 * playing time / age / categories / mechanics / rating (#724).
 *
 * Games added before the fields existed (and BGG collection imports, whose
 * bodies never carry any of them) get them filled in silently, server-side,
 * from the two places where the fields are about to be read: opening a game's
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

// Every field the provider fills in (#717, widened by #724). ONE list, because
// the completeness check and the write loop below must not drift: a field
// written but not counted leaves every game permanently incomplete (re-asking
// BGG once per TTL forever), and a field counted but not written can never
// complete. Adding a field here is all it takes to backfill it.
const PROVIDER_INFO_FIELDS = [
  'weight', 'description', 'minPlaytime', 'maxPlaytime', 'minAge',
  'categories', 'mechanics', 'rating',
];

// Whether the game already carries a value for one field. Arrays (categories,
// mechanics) count as filled only when non-empty, matching the accretion rule in
// setGameProviderInfo: an empty list is "the provider said nothing", never a
// stored answer.
function hasProviderField(game, key) {
  const v = game[key];
  return Array.isArray(v) ? v.length > 0 : v != null;
}

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
//     detail-open or session start, and gameInfo() batches 60 ids per call, so a
//     session draw still costs one upstream request.
function needsProviderInfo(game, now = Date.now()) {
  if (!game || !game.source || !game.source.externalId) return false;
  const provider = getProvider(game.source.provider);
  if (!provider || typeof provider.gameInfo !== 'function') return false;
  if (PROVIDER_INFO_FIELDS.every((k) => hasProviderField(game, k))) return false;
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
      const patch = {};
      for (const k of PROVIDER_INFO_FIELDS) patch[k] = info[k] == null ? null : info[k];
      await repo.setGameProviderInfo(rid, g.id, patch);
    }
  }
}

module.exports = {
  needsProviderInfo, backfillProviderInfo, PROVIDER_INFO_TTL_MS, PROVIDER_INFO_FIELDS,
};
