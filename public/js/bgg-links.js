'use strict';

/*
 * BoardGameGeek pages for the categories, mechanics and designers a game names
 * (#1638) — the link-type table, the URL builder, the client's resolve cache and
 * the DOM helper the three surfaces share (game detail „Mehr zum Spiel", the
 * Regal-Steckbrief top lists, the Entdecken favourites).
 *
 * SHARED ACROSS THE STACK (.claude/rules/shared-constants-across-the-stack.md):
 * the parser in lib/providers/bgg.js maps BGG's `<link type>` onto these keys,
 * POST /api/bgg-links validates against them, and lib/public-stats.js reads them
 * to attach ids to the favourites. A hand-copied type list on either side would
 * store rows the client never asks for, or 400 a question the client was right
 * to ask — with no error anywhere a user could see.
 *
 * A link URL needs BGG's NUMERIC id; the slug after it is optional and there is
 * no URL that looks a name up. So a name the instance has no id for stays plain
 * text, exactly as before this feature — never a fallback to a search URL.
 */

// Our type -> BGG's own <link type="…"> and URL path segment (the two are the
// same word on BGG's side). A frozen object read through hasOwnProperty, so a
// request-supplied `__proto__` reaches nothing
// (.claude/rules/allowlist-request-values-that-reach-a-url.md).
const BGG_LINK_TYPES = Object.freeze({
  category: 'boardgamecategory',
  mechanic: 'boardgamemechanic',
  designer: 'boardgamedesigner',
});

// How many names one POST /api/bgg-links may ask about, across all three types.
// The detail screen of a heavy game names ~25; the Steckbrief's three panels at
// most a few dozen. The client chunks above it, the route 400s above it.
const BGG_LINK_NAMES_MAX = 100;

// The longest name either side accepts. BGG's longest category/mechanic names
// are ~40 characters and designer names shorter; the bound exists so a request
// cannot make the lookup compare megabyte strings.
const BGG_LINK_NAME_MAX = 200;

const BGG_LINK_BASE = 'https://boardgamegeek.com';

function isBggLinkType(type) {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(BGG_LINK_TYPES, type);
}

// The page for one entry, or null for anything that is not a known type and a
// positive integer id. The id is the only part of the URL that varies, and it is
// a number — never a name — so no BGG text ever reaches an href.
function bggLinkUrl(type, id) {
  if (!isBggLinkType(type)) return null;
  const n = typeof id === 'number' ? id : Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return `${BGG_LINK_BASE}/${BGG_LINK_TYPES[type]}/${encodeURIComponent(String(n))}`;
}

// A comma-separated run of names in which each name with a known id is an
// outbound link and every other one is plain text. Built from DOM nodes:
// names go in via textContent, the href only from the integer id.
//
// `ids` is `{ <name>: <id> }` for this type, as POST /api/bgg-links answers it.
function bggLinkedNames(type, names, ids) {
  const frag = document.createDocumentFragment();
  (names || []).forEach((name, i) => {
    if (i > 0) frag.appendChild(document.createTextNode(', '));
    const href = ids && Object.prototype.hasOwnProperty.call(ids, name) ? bggLinkUrl(type, ids[name]) : null;
    if (!href) {
      frag.appendChild(document.createTextNode(name));
      return;
    }
    const a = document.createElement('a');
    a.className = 'bgg-link';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = name;
    frag.appendChild(a);
  });
  return frag;
}

// The ids this page load has already learned, `<type>\u0000<name>` -> id, or
// null for a name the instance answered it does not know. Remembering the
// misses too is what keeps a re-render from asking about them again.
const bggLinkCache = new Map();
const bggLinkKey = (type, name) => `${type}\u0000${name}`;

// Resolve `{ category: [names], mechanic: [...], designer: [...] }` to the same
// shape with `{ name: id }` maps, asking the server only about names this page
// load has not seen. A failed request answers with what the cache already knew,
// never throws: an unlinked name is the feature's ordinary degradation.
//
// `ask` is the request, injected so the cache can be tested without api().
async function resolveBggLinks(query, ask) {
  const want = [];
  for (const type of Object.keys(BGG_LINK_TYPES)) {
    for (const name of new Set((query && query[type]) || [])) {
      if (typeof name !== 'string' || !name || name.length > BGG_LINK_NAME_MAX) continue;
      if (!bggLinkCache.has(bggLinkKey(type, name))) want.push([type, name]);
    }
  }
  for (let i = 0; i < want.length; i += BGG_LINK_NAMES_MAX) {
    const chunk = want.slice(i, i + BGG_LINK_NAMES_MAX);
    const body = {};
    for (const [type, name] of chunk) (body[type] = body[type] || []).push(name);
    let answer;
    try {
      answer = await (ask || ((b) => api('POST', '/api/bgg-links', b)))(body);
    } catch {
      // Not cached as a miss: the next render may well get an answer.
      continue;
    }
    for (const [type, name] of chunk) {
      const map = (answer && answer[type]) || {};
      const id = Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
      bggLinkCache.set(bggLinkKey(type, name), bggLinkUrl(type, id) ? id : null);
    }
  }
  const out = {};
  for (const type of Object.keys(BGG_LINK_TYPES)) {
    out[type] = {};
    for (const name of (query && query[type]) || []) {
      const id = bggLinkCache.get(bggLinkKey(type, name));
      if (id != null) out[type][name] = id;
    }
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BGG_LINK_TYPES,
    BGG_LINK_NAMES_MAX,
    BGG_LINK_NAME_MAX,
    isBggLinkType,
    bggLinkUrl,
    bggLinkedNames,
    resolveBggLinks,
    bggLinkCache,
  };
}
