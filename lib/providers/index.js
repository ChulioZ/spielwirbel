'use strict';

/*
 * Provider registry for the add-game lookup. One module per external game
 * database; each exposes search(query)/detail(externalId)/imageHostAllowed(url).
 * A second provider (e.g. a video-game source) is just another entry here.
 *
 * Since #744 BoardGameGeek is the only one, and it is UNCONDITIONAL: the four
 * digital storefronts (PS Store, Steam, Nintendo eShop, Xbox) were retired and
 * the per-round `providers` setting went with them. Read
 * .claude/rules/add-game-lookup-provider.md before adding a fifth — two of the
 * four were queried against explicit written prohibitions, so "is this allowed"
 * is the first question, not the last.
 */

const bgg = require('./bgg');

const providers = {
  [bgg.id]: bgg,
};

const getProvider = (name) => providers[name] || null;

// The cover URL a provider offers for a game we already hold the id of (#518) —
// used by the "re-fetch the cover" action, which starts from a STORED source
// link and therefore has no search hit in hand.
//
// That is the whole reason this is not a one-liner over detail(): a provider may
// answer `imageUrl: null` on detail while its SEARCH hits carry the cover (PS
// Store was exactly that shape before #744, and public/js/lookup-cover.js is the
// client-side chokepoint for the same asymmetry). So: detail wins where it has
// one, else search and match the hit back to the EXACT stored id.
//
// Never the first search result: at the time this was written "Gran Turismo 7"
// resolved to Grandia and "It Takes Two" to its friend-pass DLC, so taking the
// top hit would quietly stamp another product's artwork onto the game. Matching
// by id is also what makes the answer independent of result order at all.
//
// Returns null when neither hop yields one, which the caller reports honestly
// rather than as a failure.
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

// Cover hosts that are no longer vouched for by any registered provider, but
// whose already-stored covers must keep RENDERING (#744).
//
// CSP img-src sources for game covers, so the browser may RENDER them
// (lib/app.js consumes this). Since #172 this is what makes hotlinked covers
// display at all, not just the lookup previews.
//
// It used to answer a DIFFERENT question from isAllowedImageUrl: #744 retired
// four storefront providers while their hotlinked covers stayed on real shelves,
// so "what may be RENDERED" was the live registry PLUS a frozen legacy list.
// #981's operator action cleared those rows, so the two questions have the same
// answer again and the frozen list is gone with the data that needed it.
//
// Each provider's download guard accepts a host h and any subdomain
// (host === h || host.endsWith('.' + h)); CSP mirrors that with both the bare
// host and a `*.h` wildcard (a lone `*.h` does not match the apex).
const imageCspSources = () => {
  const hosts = new Set(Object.values(providers).flatMap((p) => p.imageHosts));
  return [...hosts].flatMap((h) => [h, '*.' + h]);
};

module.exports = {
  providers,
  getProvider,
  resolveProviderCover,
  isAllowedImageUrl,
  providerCoverUrl,
  imageCspSources,
};
