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
 */

const { getProvider } = require('./providers');
// The field shape lives in its own dependency-free module so the repo backends
// can share it without gaining a path to the provider registry.
const { PROVIDER_INFO_FIELDS, hasProviderField } = require('./provider-info-fields');

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
// `maxBatches` caps how many upstream requests this call may spend per provider
// (#736). The shelf-wide trigger passes 1, so opening the session setup screen
// or the Regal over a 300-game shelf costs exactly one /thing call and the shelf
// fills progressively across successive opens — each filled game drops out of
// `needsProviderInfo`, so the next open starts where this one stopped.
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
async function backfillProviderInfo(repo, rid, games, { maxBatches } = {}) {
  const eligible = (games || []).filter((g) => needsProviderInfo(g));
  const byProvider = new Map();
  for (const g of eligible) {
    const list = byProvider.get(g.source.provider) || [];
    list.push(g);
    byProvider.set(g.source.provider, list);
  }
  for (const [pid, list] of byProvider) {
    let answer;
    try {
      // An undefined `maxBatches` leaves the provider on its own default — a
      // destructuring default fires on an absent AND on an undefined property.
      answer = await getProvider(pid).gameInfo(list.map((g) => g.source.externalId), { maxBatches });
    } catch {
      continue;
    }
    const { items, asked } = answer || {};
    const askedIds = new Set(asked || []);
    const byId = new Map((items || []).map((i) => [i.providerId, i]));
    for (const g of list) {
      if (!askedIds.has(g.source.externalId)) continue;
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
