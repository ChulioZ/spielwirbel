'use strict';

/*
 * Steam provider (digital PC games) for the add-game lookup.
 *
 * Unlike the console stores, Steam exposes near-official, key-free JSON
 * endpoints behind the storefront, so this provider talks JSON on both hops
 * (like the BGG detail call) rather than scraping an HTML page:
 *
 *   - search: store.steampowered.com/api/storesearch — returns
 *     { items: [{ type, id (appid), name, tiny_image }] }. We keep only
 *     type 'app' (drops 'sub'/'bundle' packages) and map to
 *     { providerId, title, thumbnail }.
 *   - detail: store.steampowered.com/api/appdetails?appids=<id> — returns
 *     { <id>: { success, data: { name, header_image, categories, … } } }.
 *
 * These are undocumented/store-facing, so every parser degrades to null/empty
 * instead of throwing. Steam has no player-count field; player count is inferred
 * best-effort from the (locale-independent) category ids. The pure parsers are
 * exported for unit tests (no network needed).
 */

const locales = require('./locales');

const BASE = 'https://store.steampowered.com';
// Steam localizes by country code + language, and the requesting user's UI
// language decides both (#505). Note the language field takes an English WORD
// ('german'), not a code, and spells pt-BR 'brazilian'.
//
// Unlike the other storefronts these two travel as query parameters rather than
// in the URL path, so they are not an SSRF primitive — but they go through the
// same closed table anyway, so every provider resolves a locale the one way.
// ONE table holding both halves, deliberately not a cc table plus a parallel
// cc->language table: those must be edited together, and a drifted pair yields
// `l=undefined` on the wire — a silently wrong request, not an error.
const LOCALES = new Map([
  ['de', { cc: 'de', l: 'german' }],
  ['en', { cc: 'us', l: 'english' }],
  ['fr', { cc: 'fr', l: 'french' }],
  ['es', { cc: 'es', l: 'spanish' }],
  ['it', { cc: 'it', l: 'italian' }],
  ['nl', { cc: 'nl', l: 'dutch' }],
  ['pt', { cc: 'br', l: 'brazilian' }],
]);
// Read per call, never at module load, so a test can drive them
// (.claude/rules/security-middleware.md).
const defaultCc = () => process.env.STEAM_CC || 'de';
const defaultLanguage = () => process.env.STEAM_LOCALE || 'german';

// The { cc, l } pair this request should use. A mapped locale brings both
// halves; only the unmapped fallback takes them from the env, so a deployment
// that pins STEAM_CC/STEAM_LOCALE to a mismatched pair keeps that pairing.
function steamLocale(requested) {
  const hit = locales.resolveLocale(LOCALES, requested, null);
  return hit === null ? { cc: defaultCc(), l: defaultLanguage() } : hit;
}

// The effective upstream locale, as the cache-key component lib/routes/lookup.js
// stores. Both halves are in it: a deployment could pin cc and language
// independently, so the country alone would not identify the response.
function resolveLocale(requested) {
  const { cc, l } = steamLocale(requested);
  return `${cc}/${l}`;
}
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120 Safari/537.36';
const TIMEOUT_MS = 10000;

// Cover images live on Steam's CDN (shared.akamai.steamstatic.com,
// cdn.cloudflare.steamstatic.com, …); the games route only downloads images
// whose host is on a provider's allowlist (a small SSRF guard).
const IMAGE_HOSTS = ['steamstatic.com'];

// Steam store "category" ids are stable across languages (the descriptions are
// localized, the ids are not). Any of these implies more than one player;
// category 2 is Single-player. Covers Multi-player, Co-op and PvP variants.
const MULTIPLAYER_CATEGORY_IDS = new Set([1, 9, 27, 36, 37, 38, 39, 47, 48, 49]);
const SINGLE_PLAYER_CATEGORY_ID = 2;

// Choose the best cover image URL from an appdetails data object, or null.
// header_image is Steam's canonical store cover; capsule_image is the fallback.
function pickImage(data) {
  if (!data || typeof data !== 'object') return null;
  for (const url of [data.header_image, data.capsule_image]) {
    if (typeof url === 'string' && url) return url;
  }
  return null;
}

// Parse a storesearch JSON response into [{ providerId, title, thumbnail }].
// Keeps only full games (type 'app'), dropping 'sub'/'bundle' packages. Deduped
// by appid; entries without an id or name are skipped. Never throws.
function parseSearch(json, limit = 8) {
  const items = json && Array.isArray(json.items) ? json.items : [];
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || item.type !== 'app') continue;
    const id = item.id != null ? String(item.id) : '';
    const title = item.name ? String(item.name) : '';
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({
      providerId: id,
      title,
      thumbnail: typeof item.tiny_image === 'string' && item.tiny_image ? item.tiny_image : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Infer a best-effort { min, max } player count from an appdetails categories
// array. Steam exposes no numeric counts, only category flags, so: a
// multiplayer category => { min: 1, max: null } (upper bound unknown, never
// invented); otherwise single-player only => { min: 1, max: 1 }; neither =>
// { min: null, max: null }.
function parsePlayers(categories) {
  const list = Array.isArray(categories) ? categories : [];
  let multiplayer = false;
  let singleplayer = false;
  for (const c of list) {
    const cid = c && c.id != null ? parseInt(c.id, 10) : NaN;
    if (MULTIPLAYER_CATEGORY_IDS.has(cid)) multiplayer = true;
    if (cid === SINGLE_PLAYER_CATEGORY_ID) singleplayer = true;
  }
  if (multiplayer) return { min: 1, max: null };
  if (singleplayer) return { min: 1, max: 1 };
  return { min: null, max: null };
}

// The current store price, from the `price_overview` the detail hop has always
// received and discarded (#679). Null whenever there is no price to show.
//
// Three things about the field are load-bearing:
//  - amounts are in MINOR units (5999 = 59,99 €), so they need dividing;
//  - a free or unreleased app carries no `price_overview` at all — inventing a
//    "0,00 €" for those is worse than showing nothing;
//  - `initial` is the pre-discount price and equals `final` when nothing is on
//    sale, so the discount is read from `discount_percent`, never from the gap.
function parsePrice(json, appId) {
  const entry = json && typeof json === 'object' ? json[String(appId)] : null;
  const data = entry && entry.success && entry.data && typeof entry.data === 'object' ? entry.data : null;
  const po = data && data.price_overview && typeof data.price_overview === 'object' ? data.price_overview : null;
  if (!po) return null;
  const final = typeof po.final === 'number' ? po.final : NaN;
  if (!Number.isFinite(final) || final <= 0) return null;
  const currency = typeof po.currency === 'string' && po.currency ? po.currency : null;
  const initial = typeof po.initial === 'number' && po.initial > 0 ? po.initial : final;
  const pct = typeof po.discount_percent === 'number' ? po.discount_percent : 0;
  return {
    amount: Math.round(final) / 100,
    regular: Math.round(initial) / 100,
    discountPercent: pct > 0 ? pct : 0,
    currency,
  };
}

// The price hop (#679). Deliberately a separate call rather than a field on
// detail(): the add-game lookup must not pay for a price nobody asked for, and a
// price source is not a lookup provider (.claude/rules/add-game-lookup-provider.md).
async function price(externalId, requested) {
  const { cc, l } = steamLocale(requested);
  const params = new URLSearchParams({ appids: externalId, cc, l });
  return parsePrice(await fetchJson(`${BASE}/api/appdetails?${params.toString()}`), externalId);
}

// Parse an appdetails JSON response into a normalized detail object. Never null
// (mirrors the other providers): a missing/failed entry yields the same shape
// with null fields, so the "View on Steam" link still works.
function parseAppDetails(json, appId) {
  const entry = json && typeof json === 'object' ? json[String(appId)] : null;
  const data = entry && entry.success && entry.data && typeof entry.data === 'object' ? entry.data : null;
  const { min, max } = parsePlayers(data && data.categories);
  return {
    provider: 'steam',
    externalId: String(appId),
    title: data && data.name ? String(data.name) : null,
    minPlayers: min,
    maxPlayers: max,
    type: 'digital',
    imageUrl: pickImage(data),
    url: `${BASE}/app/${encodeURIComponent(appId)}/`,
  };
}

// True if url points at a Steam image host (used to gate the cover download).
function imageHostAllowed(urlStr) {
  let host;
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return IMAGE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// Fetch a URL as parsed JSON with a browser-like UA and a timeout. Throws on
// non-2xx or invalid JSON.
async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Steam responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function search(query, limit = 8, requested) {
  const { cc, l } = steamLocale(requested);
  const params = new URLSearchParams({ term: query, cc, l });
  return parseSearch(await fetchJson(`${BASE}/api/storesearch/?${params.toString()}`), limit);
}

async function detail(externalId, requested) {
  const { cc, l } = steamLocale(requested);
  const params = new URLSearchParams({ appids: externalId, cc, l });
  return parseAppDetails(await fetchJson(`${BASE}/api/appdetails?${params.toString()}`), externalId);
}

module.exports = {
  id: 'steam',
  label: 'Steam',
  search,
  detail,
  price,
  resolveLocale,
  imageHostAllowed,
  imageHosts: IMAGE_HOSTS, // trusted cover hosts (feeds the CSP img-src allowlist)
  // exported for unit tests:
  parseSearch,
  parseAppDetails,
  parsePlayers,
  parsePrice,
  pickImage,
};
