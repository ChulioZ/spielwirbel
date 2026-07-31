'use strict';

/*
 * Provider registry for the add-game lookup. One module per external game
 * database; each exposes search(query)/detail(externalId)/imageHostAllowed(url).
 * A second provider (e.g. an analog-games source) is just another entry here.
 */

const psstore = require('./psstore');
const bgg = require('./bgg');
const steam = require('./steam');
const nintendo = require('./nintendo');
const xbox = require('./xbox');

const providers = {
  [psstore.id]: psstore,
  [bgg.id]: bgg,
  [steam.id]: steam,
  [nintendo.id]: nintendo,
  [xbox.id]: xbox,
};

const getProvider = (name) => providers[name] || null;

// May this round query `providerId`? The three states of round.providers are
// ABSENT (never configured -> every provider), a list (exactly those), and an
// empty list (query nothing) — see .claude/rules/round-provider-config.md, which
// is why this tests Array.isArray rather than truthiness: `[]` must not fold
// back into "all". Shared rather than re-decoded per route: a second copy of
// this rule is how the "absent means all" default gets silently defaulted away
// (.claude/rules/shared-constants-across-the-stack.md).
const roundAllowsProvider = (round, providerId) => {
  const enabled = (round || {}).providers;
  return !Array.isArray(enabled) || enabled.includes(providerId);
};

// The cover URL a provider offers for a game we already hold the id of (#518) —
// used by the "re-fetch the cover" action, which starts from a STORED source
// link and therefore has no search hit in hand.
//
// That is the whole reason this is not a one-liner over detail(): PS Store's
// detail answers `imageUrl: null`, because a product page's __NEXT_DATA__ holds
// a bare Product stub with no `media` array — the cover lives solely on the
// SEARCH page. The other four providers populate it from detail (issue #281,
// and public/js/lookup-cover.js is the client-side chokepoint for the same
// asymmetry). So: detail wins where it has one, else search and match the hit
// back to the EXACT stored id.
//
// Never the first search result: at the time this was written "Gran Turismo 7"
// resolved to Grandia and "It Takes Two" to its friend-pass DLC, so taking the
// top hit would quietly stamp another product's artwork onto the game
// (.claude/rules/psstore-full-game-is-not-every-game.md). Matching by id is also
// what makes the answer independent of result order at all.
//
// Returns null when neither hop yields one, which the caller reports honestly
// rather than as a failure. A PS Store id is region-scoped (UP… Americas, EP…
// Europe) and a foreign-region id returns a healthy 200 with no product, so a
// legitimate null is expected here — see .claude/rules/storefront-lookup-locale.md.
async function resolveProviderCover(provider, externalId, title, lang) {
  const detail = await provider.detail(externalId, lang);
  if (detail && detail.imageUrl) return detail.imageUrl;

  // Prefer the provider's own spelling over our stored title: the game may have
  // been renamed locally, and the provider finds its own name more reliably.
  const query = String((detail && detail.title) || title || '').trim();
  if (!query) return null;
  const hits = (await provider.search(query, 8, lang)) || [];
  const hit = hits.find((r) => r && r.providerId === externalId);
  return (hit && hit.thumbnail) || null;
}

// True if url is a cover image any registered provider vouches for.
const isAllowedImageUrl = (url) =>
  Object.values(providers).some((p) => p.imageHostAllowed(url));

// Characters that must never reach a stored cover URL, because the frontend
// interpolates game.image straight into `background-image:url('<image>')` —
// sometimes inside a `style="…"` attribute, sometimes via el.style (core.js
// loadCover). Every render site uses the QUOTED url('…') form, so what actually
// terminates the value is:
//   '   ends the CSS string
//   \   starts a CSS escape
//   "   ends the surrounding HTML style attribute
//   whitespace/control  ends the string / the attribute
//   <>  never needed in a cover URL; refused so a future HTML context is safe
//
// Parens are deliberately ALLOWED: they are legal inside a quoted CSS string,
// and real provider URLs contain them — BGG's CDN serves covers under paths like
// `filters:strip_icc()`, which an over-strict guard silently drops (the cover
// then just never appears, with nothing logged).
const COVER_UNSAFE_RE = /['"<>\\\s]/;

// The cover URL to STORE for a provider image, or null when we don't trust it.
//
// Provider cover art is HOTLINKED, not re-hosted (#172): game.image holds the
// provider's own https URL and the browser fetches it from them. Re-hosting it
// would be reproduction + making available (§§ 16, 19a UrhG) of third-party
// artwork we hold no licence for — see .claude/rules/provider-cover-hotlinking.md.
// https only: a stored http URL would be blocked as mixed content on the live
// (HTTPS) origin and silently render nothing.
const providerCoverUrl = (url) => {
  const u = String(url || '');
  if (!u || COVER_UNSAFE_RE.test(u) || !u.startsWith('https://')) return null;
  return isAllowedImageUrl(u) ? u : null;
};

// CSP img-src sources for provider covers, so the browser may RENDER the hosts
// we vouch for (isAllowedImageUrl) — one source of truth for "hosts we trust for
// covers" (lib/app.js consumes this). Since #172 this is what makes hotlinked
// covers display at all, not just the lookup previews. Each
// provider's download guard accepts a host h and any subdomain (host === h ||
// host.endsWith('.' + h)); CSP mirrors that with both the bare host and a `*.h`
// wildcard (a lone `*.h` does not match the apex).
const imageCspSources = () => {
  const hosts = new Set(Object.values(providers).flatMap((p) => p.imageHosts));
  return [...hosts].flatMap((h) => [h, '*.' + h]);
};

module.exports = {
  providers,
  getProvider,
  roundAllowsProvider,
  resolveProviderCover,
  isAllowedImageUrl,
  providerCoverUrl,
  imageCspSources,
};
