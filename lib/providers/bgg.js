'use strict';

/*
 * BoardGameGeek provider (analog games) for the add-game lookup.
 *
 * Talks to the public BGG XML API2 (https://boardgamegeek.com/xmlapi2):
 *   - search?query=…&type=boardgame  -> candidate list
 *   - thing?id=…                     -> full details for one game
 *
 * BGG sends no CORS headers, so this must run server-side (see routes/lookup.js).
 * The XML surface we need is tiny and attribute-based, so we extract the few
 * fields with focused regexes rather than pulling in an XML-parser dependency.
 *
 * The pure parsers (parseSearch/parseThing/bucketDuration) are exported so they
 * can be unit-tested without any network access.
 */

const BASE = 'https://boardgamegeek.com/xmlapi2';
// BGG asks callers to identify themselves; a real UA also avoids some blocking.
const USER_AGENT = 'Spieleabend/1.0 (+https://github.com/ChulioZ/game-sessions)';
const TIMEOUT_MS = 10000;

// BGG cover images are served from these hosts; the games route only downloads
// images whose host is on a provider's allowlist (a small SSRF guard).
const IMAGE_HOSTS = ['boardgamegeek.com', 'geekdo.com', 'geekdo-images.com'];

// Decode the handful of XML entities BGG puts inside attribute values.
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const attr = (block, re) => {
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
};

// Map BGG's playing time (minutes) to the app's short|medium|long buckets.
// Thresholds: < 30 short, 30–90 medium, > 90 long. Unknown/0 -> null.
function bucketDuration(minutes) {
  const n = parseInt(minutes, 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (n < 30) return 'short';
  if (n <= 90) return 'medium';
  return 'long';
}

// Parse a /search response into [{ providerId, title, year, thumbnail }].
// Search results carry no image, so thumbnail is always null here.
function parseSearch(xml, limit = 8) {
  const out = [];
  const seen = new Set();
  const itemRe = /<item\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue; // BGG can list the same id twice (primary+alt)
    seen.add(id);
    const block = m[2];
    const title =
      attr(block, /<name\b[^>]*type="primary"[^>]*value="([^"]*)"/) ||
      attr(block, /<name\b[^>]*value="([^"]*)"/);
    if (!title) continue;
    out.push({
      providerId: id,
      title,
      year: attr(block, /<yearpublished\b[^>]*value="([^"]*)"/),
      thumbnail: null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Parse a /thing response into a normalized detail object, or null if empty.
function parseThing(xml) {
  const m = xml.match(/<item\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/item>/);
  if (!m) return null;
  const externalId = m[1];
  const block = m[2];
  const title =
    attr(block, /<name\b[^>]*type="primary"[^>]*value="([^"]*)"/) ||
    attr(block, /<name\b[^>]*value="([^"]*)"/);
  const min = parseInt(attr(block, /<minplayers\b[^>]*value="([^"]*)"/), 10);
  const max = parseInt(attr(block, /<maxplayers\b[^>]*value="([^"]*)"/), 10);
  const image = attr(block, /<image>([^<]*)<\/image>/);
  return {
    provider: 'bgg',
    externalId,
    title: title || null,
    minPlayers: Number.isInteger(min) && min >= 1 ? min : null,
    maxPlayers: Number.isInteger(max) && max >= 1 ? max : null,
    type: 'analog',
    duration: bucketDuration(attr(block, /<playingtime\b[^>]*value="([^"]*)"/)),
    imageUrl: image ? decodeEntities(image).trim() : null,
    url: `https://boardgamegeek.com/boardgame/${externalId}`,
  };
}

// True if url points at a BGG image host (used to gate the cover download).
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

// Fetch a URL as text with a User-Agent and a timeout. Throws on non-2xx.
async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`BGG responded ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function search(query, limit = 8) {
  const url = `${BASE}/search?type=boardgame&query=${encodeURIComponent(query)}`;
  return parseSearch(await fetchText(url), limit);
}

async function detail(externalId) {
  const url = `${BASE}/thing?id=${encodeURIComponent(externalId)}`;
  return parseThing(await fetchText(url));
}

module.exports = {
  id: 'bgg',
  label: 'BoardGameGeek',
  search,
  detail,
  imageHostAllowed,
  // exported for unit tests:
  parseSearch,
  parseThing,
  bucketDuration,
};
