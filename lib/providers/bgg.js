'use strict';

/*
 * BoardGameGeek provider (analog games) for the add-game lookup.
 *
 * Since #117 both hops run on BGG's official XML API2 under a registered
 * application token:
 *
 *   - search:     /xmlapi2/search?query=…&type=boardgame,boardgameexpansion
 *   - detail:     /xmlapi2/thing?id=…
 *   - collection: /xmlapi2/collection?username=…&own=1 (#481, the Regal import)
 *
 * It replaced a key-free two-hop workaround (Wikidata SPARQL as the search
 * index, BGG's private api.geekdo.com/geekitems JSON for the detail) that
 * existed only because the XML API closed to anonymous callers on 2025-07-02.
 * Both halves were problems: Wikidata indexes only games that happen to carry a
 * Wikidata entity with a BGG id (P2339), so most of BGG's catalogue was
 * unfindable, and geekitems is one of the private endpoints BGG's terms
 * explicitly grant no licence for. See .claude/rules/add-game-lookup-provider.md.
 *
 * The parsers are pure, degrade to null/empty instead of throwing, and are
 * exported for unit tests.
 */

// The token host must NOT carry the www subdomain — BGG's docs are explicit that
// www interferes with request authorization (a 401 with a perfectly valid token).
const API = 'https://boardgamegeek.com/xmlapi2';
const WEB = 'https://boardgamegeek.com';
// BGG asks that requests be identifiable, server-side and cached (all three are
// true here: lib/routes/lookup.js caches every answer for 10 minutes).
const USER_AGENT = 'spielwirbel/1.0 (+https://spielwirbel.app)';
// Overall budget for one provider call, retries included (see fetchXml).
const TIMEOUT_MS = 8000;

// Expansions are searched alongside base games on purpose: a group that owns one
// wants it on the shelf, and the Wikidata index this replaced found them too.
// The relevance ranking in parseSearch is what keeps a popular game's 50-odd
// expansions from burying the base game.
const SEARCH_TYPES = 'boardgame,boardgameexpansion';

// Cover images live on BGG's image CDN; only hosts a provider vouches for may be
// stored and rendered (this list also feeds the CSP img-src allowlist).
const IMAGE_HOSTS = ['cf.geekdo-images.com', 'geekdo-images.com'];

// Read per call, not at module load, so a test (or a live re-tune) picks up the
// current env — the same reason lib/app.js reads its rate-limit ceilings per
// createApp(). Absent token = the provider contributes nothing, never an error.
function apiToken() {
  return String(process.env.BGG_API_TOKEN || '').trim();
}

// BGG throttles by answering "too busy" rather than queueing (500/503 per its
// own docs; 429 and the 202 "queued, retry" of the collection endpoint are
// included for completeness). Retry those a bounded number of times inside the
// overall TIMEOUT_MS budget — never a tight loop, and never more requests than
// the budget allows. Every other status is final.
const RETRY_STATUS = new Set([202, 429, 500, 503]);
const RETRY_DELAYS_MS = [300, 1200];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- XML ------------------------------------------------------------------
//
// The two responses are flat, attribute-shaped documents, so they get a small
// scanner rather than an XML dependency (same call every other provider makes
// for its own format). Two details make it correct on real BGG data:
//   - an attribute value may legally contain a raw '>' — game titles do — which
//     a naive /<[^>]*>/ would cut in half, so the tag pattern consumes quoted
//     runs before bare characters;
//   - titles arrive entity-encoded ("Tigris &amp; Euphrates"), so every value
//     and text node is decoded.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] !== '#') {
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : m;
    }
    const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isInteger(cp) || cp < 1 || cp > 0x10ffff) return m;
    try {
      return String.fromCodePoint(cp);
    } catch {
      return m;
    }
  });
}

// The three alternatives must stay DISJOINT — a quote may only ever start a
// quoted run, never also be consumed as a bare character. An earlier `[^>]` as
// the third branch let `""` be matched two ways, which is exponential
// backtracking (CodeQL js/redos) on a body that never closes its tag: a
// truncated upstream response would then hang the request rather than degrade
// to []. Self-closing is read off the captured attribute chunk instead of a
// trailing `(\/?)` group, which would reintroduce ambiguity at every `/`.
const TAG_RE = /<(\/?)([\w:-]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attrsOf(raw) {
  const out = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    out[m[1].toLowerCase()] = decodeXml(m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

// Flatten <items> into [{ attrs, children: [{ name, attrs, text }] }]. Never
// throws — a truncated or non-XML body simply yields [].
//
// It handles a FLAT item list only, which is all /search, /thing and /collection
// return. A NESTED item list — which only `versions=1` produces (#519) — is not
// merely "flattened": the outer <item> sets `current`, the first nested <item>
// OVERWRITES it (dropping the parent's accumulated children), and the parent's
// own </item> then finds `current === null` and pushes nothing. So the game item
// DISAPPEARS and the result is the versions alone. Measured live on 2026-07-28:
// a versions=1 body for Catan (id 13) yields 145 items whose first is a
// `boardgameversion`, with no game item anywhere — which is why parseVersions
// slices the <versions> block out first rather than letting this loose on the
// whole document, and why parseThing must never be handed such a body.
function parseItems(xml) {
  const s = typeof xml === 'string' ? xml : '';
  const out = [];
  let current = null;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(s)) !== null) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    // A trailing slash can only be the self-closing marker: it sits outside any
    // quoted run, and attrsOf ignores it (it matches name="value" pairs only).
    const selfClosing = /\/\s*$/.test(m[3]);
    if (name === 'item') {
      if (closing) {
        if (current) out.push(current);
        current = null;
      } else if (selfClosing) {
        out.push({ attrs: attrsOf(m[3]), children: [] });
      } else {
        current = { attrs: attrsOf(m[3]), children: [] };
      }
      continue;
    }
    if (!current || closing) continue;
    // Text content (<image>, <thumbnail>) runs from here to the next tag.
    let text = '';
    if (!selfClosing) {
      const next = s.indexOf('<', TAG_RE.lastIndex);
      text = decodeXml(s.slice(TAG_RE.lastIndex, next < 0 ? s.length : next)).trim();
    }
    current.children.push({ name, attrs: attrsOf(m[3]), text });
  }
  return out;
}

// --- relevance ------------------------------------------------------------

// Fold a title to a comparable form: ß→ss, diacritics stripped, everything that
// is not a letter or digit collapsed to single spaces. So "Noch mal so gut!"
// matches "noch mal so gut" and "Die Siedler von Catan" matches "siedler".
//
// Letters are \p{L}, not [a-z]: BGG carries plenty of non-Latin editions, and
// stripping their scripts would fold e.g. "Catan Двубоят" down to bare "catan"
// and score it as an EXACT match for the base game (seen live on 2026-07-22).
function norm(s) {
  return String(s)
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// How well a BGG name answers the typed query. BGG's search is a plain name
// match with no relevance order of its own, so an unranked slice of the first
// N results routinely drops the game the user meant — "catan" alone matches
// well over a hundred items. Exported for unit tests.
function scoreName(name, query) {
  const n = norm(name);
  const q = norm(query);
  if (!n || !q) return 0;
  if (n === q) return 4;
  if (n.startsWith(q + ' ')) return 3;
  if (n.startsWith(q)) return 2;
  return n.includes(q) ? 1 : 0;
}

// Parse an /xmlapi2/search response into [{ providerId, title, thumbnail }],
// best match first. thumbnail is null — search carries no image, the cover
// arrives with the detail on pick. Never throws.
function parseSearch(xml, limit = 8, query = '') {
  const seen = new Set();
  const hits = [];
  for (const item of parseItems(xml)) {
    const id = item.attrs.id;
    if (!id || !/^\d+$/.test(id) || seen.has(id)) continue;
    const names = item.children.filter((c) => c.name === 'name' && c.attrs.value);
    if (!names.length) continue;
    // BGG answers with the name that MATCHED, so a German query yields the
    // game's German alternate name. That is the title worth offering, so the
    // best-scoring name wins rather than the primary one — it is what keeps
    // localized titles working now that the Wikidata label hop is gone (#117).
    let title = names[0].attrs.value;
    let score = scoreName(title, query);
    for (const n of names.slice(1)) {
      const s = scoreName(n.attrs.value, query);
      if (s > score) {
        title = n.attrs.value;
        score = s;
      }
    }
    seen.add(id);
    hits.push({ providerId: id, title, score });
  }
  // Score first, then the shorter name — among equally-matching hits the short
  // one is the base game and the long ones its editions and expansions.
  hits.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
  return hits.slice(0, limit).map((h) => ({ providerId: h.providerId, title: h.title, thumbnail: null }));
}

// Coerce a BGG attribute (numbers arrive as strings like "4") to a positive
// integer, or null. BGG uses "0" for "unknown", which we treat as null.
function toPositiveInt(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// The community weight (complexity) is a 1–5 FLOAT ("2.2809"), so toPositiveInt
// is unusable — parseInt('2.28') would round every game down to its integer.
// "0" is BGG's "no data yet" here like everywhere else, and anything outside
// the scale's range is treated as unknown rather than stored.
function toWeight(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : null;
}

// The community rating (#724) is the same shape one scale up: a 1–10 FLOAT
// ("7.09054"). Same "0" = no votes yet, same out-of-range = unknown.
function toRating(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : null;
}

// The `value` strings of one <link type="…"> family, in BGG's own vocabulary and
// unmodified (the licence forbids rewriting retrieved data), so they are English
// even in the German UI — the same reality storefront-lookup-locale.md records
// for identifiers.
//
// Deliberately NOT filtered on `inbound="true"`, unlike expansionLinks: measured
// live 2026-08-09 across five items (Catan 13, Ark Nova 342942, Toriki 417403 and
// the two expansions 325 / 368966), the flag appears on `boardgameexpansion`
// links only — 0 of 41 category and mechanic links carried it, including on both
// expansion items. It marks the inverse of a RELATION, and a taxonomy link has no
// inverse to mark. (The `inbound` category link in test/providers-bgg.test.js is
// a hand-written distractor for the expansion-parent parser, not BGG data.)
function linkValues(children, type) {
  return (children || [])
    .filter((c) => c.name === 'link' && c.attrs.type === type && c.attrs.value)
    .map((c) => c.attrs.value);
}

// The standard metadata off a /thing?stats=1 item's flattened children — weight
// + description (#717), playing time / age / categories / mechanics / rating
// (#724).
//
// `averageweight` and `average` MUST be matched by their exact names: parseItems
// flattens every descendant of <item> into one child list, so the
// <statistics><ratings> block's `average`, `bayesaverage`, `stddev`, `median` and
// `rank` all sit right beside `averageweight`. A startsWith/includes match would
// silently store the GEEK rating (bayesaverage) instead of the community one —
// they differ on every game, wildly so on a thinly-rated one (Toriki: 8.51 vs
// 6.02, captured live 2026-08-09). Exact-name matching is safe because each item
// carries exactly one `average` node (verified on the same capture).
//
// <playingtime> is skipped as redundant: it equalled <maxplaytime> on all five
// captured items (120/120, 150/150, 600/600, 90/90, 150/150). Both BOUNDS are
// kept because the spread is the information — Toriki reports 20–600, where 20 is
// one sitting and 600 the full campaign, and any single number describes neither.
//
// <description> is a TEXT node of entity-encoded prose, not an attrs.value —
// the same shape trap as the collection's name (bgg-collection-import.md §1).
// The decoded text is stored unmodified; any clamping is display-only.
function infoOf(children) {
  const list = children || [];
  const node = (name) => list.find((c) => c.name === name);
  const weightNode = node('averageweight');
  const ratingNode = node('average');
  const descNode = list.find((c) => c.name === 'description' && c.text);
  const num = (name) => {
    const n = node(name);
    return n ? toPositiveInt(n.attrs.value) : null;
  };
  return {
    weight: weightNode ? toWeight(weightNode.attrs.value) : null,
    description: descNode ? descNode.text : null,
    minPlaytime: num('minplaytime'),
    maxPlaytime: num('maxplaytime'),
    minAge: num('minage'),
    categories: linkValues(list, 'boardgamecategory'),
    mechanics: linkValues(list, 'boardgamemechanic'),
    rating: ratingNode ? toRating(ratingNode.attrs.value) : null,
  };
}

// The cover URL to hotlink, or null. <thumbnail> on purpose, not <image>: the
// XML API offers exactly two variants and <image> is the untouched master
// (measured 2026-07-22 across eight popular games: 68 KB – 2.0 MB, Ark Nova at
// 1.96 MB / 1 MP+). geekdo signs its resize paths — a hand-built variant 400s
// and a ?w= query is ignored byte-for-byte — so cover-size.js cannot shrink it
// at render time the way it does for Sony and Microsoft. <thumbnail> is a
// pre-sized fit-in/200x150 variant at 4–13 KB. See
// .claude/rules/provider-cover-sizing.md.
function pickImage(children) {
  const node = (children || []).find((c) => c.name === 'thumbnail' && c.text);
  return node ? node.text : null;
}

// The expansions BGG knows for a game, off the SAME /thing body the detail hop
// already fetches (#653) — `<link type="boardgameexpansion" id=… value=…/>`
// children `parseItems` has always preserved and `parseThing` simply never read.
// So the tick-list costs no extra request and no extra parameter (unlike
// `versions=1`, which multiplies the body — .claude/rules/bgg-edition-covers.md).
//
// `inbound="true"` MUST be filtered. On an expansion item BGG marks the reverse
// relation with the same `type`, so without it a base game turns up as its own
// expansion's expansion — a plausible-looking wrong list, never an error.
function parseExpansionLinks(children) {
  return expansionLinks(children, false);
}

// The base games an EXPANSION belongs to (#664) — the exact inverse of the
// above, off the same `<link type="boardgameexpansion">` children. BGG marks
// "expands X" with `inbound="true"` and "is expanded by Y" without it, using one
// type for both, so the two directions differ only by that flag.
//
// It is a LIST, not a single parent: a promo can fit two base games. Keeping all
// of them is what lets the acquire flow attach silently when exactly one is in
// the round and ask otherwise, rather than guessing.
function parseInboundExpansionLinks(children) {
  return expansionLinks(children, true);
}

function expansionLinks(children, inbound) {
  return (children || [])
    .filter((c) => c.name === 'link'
      && c.attrs.type === 'boardgameexpansion'
      && (c.attrs.inbound === 'true') === inbound
      && c.attrs.id
      && c.attrs.value)
    .map((c) => ({ providerId: String(c.attrs.id), title: c.attrs.value }));
}

// Parse an /xmlapi2/thing response into a normalized detail object. Never null
// (mirrors the other providers): a missing or short item yields the same shape
// with null fields, so the "View on BoardGameGeek" link still works.
function parseThing(xml, externalId) {
  const item = parseItems(xml)[0] || null;
  const children = item ? item.children : [];
  const value = (name) => {
    const c = children.find((x) => x.name === name);
    return c ? c.attrs.value : null;
  };
  const names = children.filter((c) => c.name === 'name' && c.attrs.value);
  const primary = names.find((n) => n.attrs.type === 'primary') || names[0] || null;
  // BGG serves /boardgameexpansion/<id> for expansions; /boardgame/<id> also
  // redirects there, but using the item's own type keeps the link canonical.
  const itemType = item && /^[a-z]+$/.test(String(item.attrs.type || '')) ? item.attrs.type : 'boardgame';
  return {
    provider: 'bgg',
    externalId,
    title: primary ? primary.attrs.value : null,
    minPlayers: toPositiveInt(value('minplayers')),
    maxPlayers: toPositiveInt(value('maxplayers')),
    type: 'analog',
    imageUrl: pickImage(children),
    url: `${WEB}/${itemType}/${externalId}`,
    // Standard metadata (#717, widened by #724): null-shaped like every other
    // field when the body lacks it (a token-absent detail() call, or a game BGG
    // has no votes for). Only `weight`/`rating` need stats=1 on the request;
    // description, the playtime bounds, the age and the category/mechanic links
    // are in every /thing body — measured 2026-08-09, a no-stats Catan body
    // carries the same 2 categories and 15 mechanics as the stats=1 one, so the
    // fields #724 adds cost no extra request and no extra byte (the +885 B
    // stats=1 delta #717 recorded is unchanged: 47,659 → 48,544).
    ...infoOf(children),
    // Always present (possibly empty), so the shape stays uniform for the
    // token-absent and empty-body paths above. `parseCollection` deliberately
    // does NOT grow it: a collection body carries no such links, and the record
    // it produces is the one that gets STORED — where expansions are written
    // only through setGameExpansions.
    expansions: parseExpansionLinks(children),
  };
}

// Resolve MANY expansion ids in ONE request (#653). BGG's /thing accepts a
// comma-separated id list, so ticking twelve boxes costs one hop, not twelve.
//
// Only the fields an owned expansion stores: its title and the player range it
// admits. A range BGG has no numbers for stays null, and null widens NOTHING
// (public/js/draw-pool.js) — the opposite of what an absent range means on a
// base game.
function parseExpansionDetails(xml) {
  return parseItems(xml)
    .map((item) => {
      const children = item.children;
      const value = (name) => {
        const c = children.find((x) => x.name === name);
        return c ? c.attrs.value : null;
      };
      const names = children.filter((c) => c.name === 'name' && c.attrs.value);
      const primary = names.find((n) => n.attrs.type === 'primary') || names[0] || null;
      return {
        providerId: String(item.attrs.id || ''),
        title: primary ? primary.attrs.value : null,
        minPlayers: toPositiveInt(value('minplayers')),
        maxPlayers: toPositiveInt(value('maxplayers')),
        url: item.attrs.id ? `${WEB}/boardgameexpansion/${item.attrs.id}` : null,
      };
    })
    .filter((e) => e.providerId);
}

// Which base games each of a set of expansions belongs to (#664), off a
// MULTI-item /thing body. Only the ids and titles the inbound links carry — an
// absent base game is fetched with the ordinary detail() hop when it is actually
// needed, since a link says nothing about a cover or a player range.
//
// An item with no inbound link keeps an EMPTY parent list rather than being
// dropped: a wished expansion whose parent BGG does not report is still a game
// the group wants, and it lands as an unattached wish.
//
// `expansion` carries the /thing body's own `type` (#703), because the parents
// alone cannot answer "is this an expansion?" — a BASE game also yields no
// inbound links, indistinguishable from an orphan expansion. Unlike the
// collection body's `subtype` attribute (which lies, #702), a /thing item's
// `type` is truthful — it is what parseThing keys the canonical URL off.
function parseExpansionParents(xml) {
  return parseItems(xml)
    .map((item) => ({
      providerId: String(item.attrs.id || ''),
      parents: parseInboundExpansionLinks(item.children),
      expansion: item.attrs.type === 'boardgameexpansion',
    }))
    .filter((e) => e.providerId);
}

// --- edition covers (#519) ------------------------------------------------

// The <versions> block of an /xmlapi2/thing?versions=1 body. Sliced out before
// parsing because parseItems handles a flat item list only (see its comment):
// run over the whole document it returns the versions AND silently loses the
// game item. Slicing keeps parseItems — which search, thing and collection all
// depend on — completely untouched.
//
// Greedy on purpose: `versions` nests no `</versions>`, and a greedy match to
// the LAST close tag cannot be cut short by one appearing inside an attribute
// value (an edition name may legally contain '<' only entity-encoded).
const VERSIONS_RE = /<versions\b[^>]*>([\s\S]*)<\/versions>/i;

// The per-edition box arts BGG holds for one game, as
// [{ imageUrl, edition, year, languages }] in BGG's own order.
//
// Two things must not be "tidied":
//   - <thumbnail>, never <image>, for the same reason pickImage() takes it: the
//     master runs 68 KB – 2 MB and geekdo signs its resize paths, so
//     cover-size.js cannot shrink one at render time. The version thumbnails are
//     the same fit-in/200x150 variant today's cover already uses, so this
//     feature leaves the cover budget unchanged
//     (.claude/rules/provider-cover-sizing.md).
//   - versions with NO thumbnail are dropped, or they render as empty tiles.
//     Measured 2026-07-28: 10 of 145 (Catan), 2 of 37 (Ark Nova), 1 of 38
//     (Terraforming Mars).
//
// Deduping by image URL is deliberately NOT done here: several editions really
// do share one thumbnail (Ark Nova's 35 covers are 19 distinct URLs), and which
// of them survives depends on the UI language the client sorts by — so the
// client dedupes AFTER sorting (public/js/bgg-covers.js) and keeps the label
// that matches the reader's language. Never throws.
function parseVersions(xml) {
  const block = VERSIONS_RE.exec(String(xml || ''));
  if (!block) return [];
  const out = [];
  for (const item of parseItems(block[1])) {
    const imageUrl = pickImage(item.children);
    if (!imageUrl) continue;
    const name = item.children.find((c) => c.name === 'name' && c.attrs.value);
    const year = item.children.find((c) => c.name === 'yearpublished');
    out.push({
      imageUrl,
      edition: name ? name.attrs.value : null,
      // BGG writes "0" for an unknown year, like every other numeric attribute.
      year: toPositiveInt(year ? year.attrs.value : null),
      languages: item.children
        .filter((c) => c.name === 'link' && c.attrs.type === 'language' && c.attrs.value)
        .map((c) => c.attrs.value),
    });
  }
  return out;
}

// An /xmlapi2/collection answer for a username BGG doesn't know is an ERROR
// DOCUMENT served with HTTP 200 — `<errors><error><message>Invalid username
// specified</message></error></errors>` — so it parses to zero items and is
// otherwise indistinguishable from a real, empty collection. Those two need
// opposite messages ("check the name" vs "nothing marked as owned"), hence the
// explicit probe. Safe against a game title containing the word: every title
// arrives inside a text node or an attribute, where a literal '<' is encoded.
const ERROR_DOC_RE = /<error[\s/>]/i;

// Parse an /xmlapi2/collection response into { invalidUser, items }, each item in
// the SAME shape parseThing produces — so an imported game and a game added
// through the lookup are byte-for-byte the same record. Never throws.
//
// The one structural difference from search/thing: a collection item carries its
// name as TEXT (`<name sortindex="1">CATAN</name>`) rather than as a `value`
// attribute, and its player counts as attributes of the `<stats>` child that
// `stats=1` adds. The attribute form is accepted as a fallback so a shape change
// on BGG's side degrades to a missing count rather than to zero games.
function parseCollection(xml) {
  const items = [];
  const seen = new Set();
  for (const item of parseItems(xml)) {
    const externalId = item.attrs.objectid;
    if (!externalId || !/^\d+$/.test(externalId) || seen.has(externalId)) continue;
    const nameNode = item.children.find((c) => c.name === 'name' && (c.text || c.attrs.value));
    const title = nameNode ? nameNode.text || nameNode.attrs.value : null;
    if (!title) continue;
    seen.add(externalId);
    const stats = item.children.find((c) => c.name === 'stats') || { attrs: {} };
    // Collection items name their own subtype; keep the link canonical the way
    // parseThing does rather than assuming /boardgame/.
    const subtype = /^[a-z]+$/.test(String(item.attrs.subtype || '')) ? item.attrs.subtype : 'boardgame';
    items.push({
      provider: 'bgg',
      externalId,
      title,
      minPlayers: toPositiveInt(stats.attrs.minplayers),
      maxPlayers: toPositiveInt(stats.attrs.maxplayers),
      type: 'analog',
      imageUrl: pickImage(item.children),
      url: `${WEB}/${subtype}/${externalId}`,
      // A collection body carries no <link> elements at all, so which base game
      // an expansion belongs to needs the separate expansionParents() hop
      // (#664). Present on every item so the shape stays uniform for the owned
      // shelf, which never sees a true. And on the WISHLIST this attribute is
      // only a first guess: an unscoped collection query mislabels every
      // expansion "boardgame" (#702), so collection() overrides the flag from
      // its subtype-scoped probe — trust that, not this, on that shelf.
      expansion: subtype === 'boardgameexpansion',
    });
  }
  // Only trust the error probe when nothing parsed: a well-formed collection can
  // never also be an error document, and this way a future advisory <error> block
  // alongside real items doesn't discard the whole import.
  return { invalidUser: items.length === 0 && ERROR_DOC_RE.test(String(xml || '')), items };
}

// True if url points at a BGG image host (gates what may be stored/rendered).
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

// --- transport ------------------------------------------------------------

async function fetchOnce(url, deadline) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, deadline - Date.now()));
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/xml',
        Authorization: `Bearer ${apiToken()}`,
      },
      signal: ctrl.signal,
    });
    // 202 is 2xx but means "queued, ask again" — never a body worth parsing.
    const ok = res.status >= 200 && res.status < 300 && res.status !== 202;
    return { ok, status: res.status, text: ok ? await res.text() : '' };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a BGG XML document, retrying a throttled answer within the budget.
// Throws on a final non-2xx so lib/routes/lookup.js can answer 502.
//
// The final status rides out on the error, because one caller has to tell the
// statuses apart: /collection answers 202 "queued, come back" while BGG builds
// the export, for as long as that takes. Widening TIMEOUT_MS to sit that out
// would slow every search down for a case only the collection has, so the budget
// stays put and collection() turns a final 202 into its own "still building"
// answer instead of an outage.
async function fetchXml(url) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchOnce(url, deadline);
    if (res.ok) return res.text;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined || !RETRY_STATUS.has(res.status) || Date.now() + delay >= deadline) {
      const err = new Error(`BGG provider upstream responded ${res.status}`);
      err.status = res.status;
      throw err;
    }
    await sleep(delay);
  }
}

// Without a token BGG contributes nothing rather than failing: the frontend
// merges providers with Promise.allSettled, so an empty list leaves the other
// four intact, while a throw would look like an outage. The cost is that a
// missing token is invisible from inside the app — the admin panel surfaced it
// until #404 dropped every configuration row; check the Railway env var.
async function search(query, limit = 8) {
  if (!apiToken()) return [];
  const params = new URLSearchParams({ query, type: SEARCH_TYPES });
  return parseSearch(await fetchXml(`${API}/search?${params.toString()}`), limit, query);
}

async function detail(externalId) {
  // Same degradation as search: the null-shaped product keeps an already-linked
  // game's "View on BoardGameGeek" link working with no data refresh.
  if (!apiToken()) return parseThing('', externalId);
  // stats=1 adds the <statistics> block the weight lives in (#717). Measured
  // 2026-08-09: +885 B on Catan's 47.7 KB body (+1.9%), +749 B on Ark Nova's
  // 16.8 KB (+4.4%) — nothing like the 2.5–5× that keeps versions=1 out of
  // this hop (.claude/rules/bgg-edition-covers.md §4).
  const params = new URLSearchParams({ id: externalId, stats: '1' });
  return parseThing(await fetchXml(`${API}/thing?${params.toString()}`), externalId);
}

// The collection filters this provider will ask BGG for, mapped to the query
// parameter each one is spelled with. A Map, not an object literal, so a
// request-supplied '__proto__'/'constructor' reaches nothing.
const COLLECTION_STATUS = new Map([
  ['own', 'own'],
  ['wishlist', 'wishlist'],
]);

// The games a BGG user marks as OWNED (`status: 'own'`, the default) or has on
// their WISHLIST (`status: 'wishlist'`, #560), for the one-shot Regal and
// Wunschliste imports (#481).
//
// The status is an allowlist lookup, never interpolated: it reaches a fetched
// URL's query string, so an unrecognised value falls back to `own` rather than
// letting a caller name a BGG collection filter of their choosing (the same
// shape as resolveLocale, .claude/rules/storefront-lookup-locale.md §1).
//
// Answers { state, items } rather than throwing per outcome, because four of the
// five outcomes are normal and each needs its own message upstream:
//
//   'ok'           -> items (possibly empty: a real collection with nothing owned)
//   'invalid_user' -> BGG does not know that username
//   'queued'       -> BGG is still building the export; ask again shortly
//   (a throw)      -> a genuine upstream failure, which the route turns into 502
//
// Without a token it degrades to an empty 'ok' exactly like search(), so a fork
// running without one sees the empty state instead of an error it cannot fix.
// Expansions are excluded here (unlike the search, which offers them
// deliberately): a bulk import of somebody's whole shelf is the one place where
// 50 expansions of one game are noise rather than choice.
async function collection(username, status) {
  const name = String(username || '').trim();
  if (!name || !apiToken()) return { state: 'ok', items: [] };
  const filter = COLLECTION_STATUS.get(status) || 'own';
  const params = new URLSearchParams({
    username: name,
    [filter]: '1',
    stats: '1',
    // Expansions are excluded from the OWNED shelf only (#664). There, 50
    // expansions of one game are noise and belong on that game's row anyway. On
    // the WISHLIST an expansion is precisely what the group means to record —
    // you own Catan, you want Seefahrer — so filtering them out silently dropped
    // a large share of every wishlist import.
    ...(filter === 'own' ? { excludesubtype: 'boardgameexpansion' } : {}),
  });
  let xml;
  let probeXml = null;
  try {
    xml = await fetchXml(`${API}/collection?${params.toString()}`);
    // Which wishlist items are expansions comes from a SECOND, subtype-scoped
    // request, not from the main body's `subtype` attribute — that attribute
    // LIES in BGG's XMLAPI2 (#702): a collection query without an explicit
    // `subtype` parameter includes expansions but labels every one of them
    // "boardgame" (captured live 2026-08-09, the operator's wishlist: both
    // expansions mislabeled in the main body, both listed by this probe). The
    // two fetches are ONE unit sharing this try: a failed or queued probe must
    // fail/queue the whole collection rather than degrade, because a probe that
    // silently answers "no expansions" recreates the very bug through the error
    // path — a bulk import quietly creating unmarked expansion rows. Contrast
    // expansionParents(), where degrading to "no parents known" is a good
    // answer. Sequential like that hop, and no stats: ids are all that matters.
    if (filter === 'wishlist') {
      const probe = new URLSearchParams({ username: name, [filter]: '1', subtype: 'boardgameexpansion' });
      probeXml = await fetchXml(`${API}/collection?${probe.toString()}`);
    }
  } catch (err) {
    if (err && err.status === 202) return { state: 'queued', items: [] };
    throw err;
  }
  const { invalidUser, items } = parseCollection(xml);
  if (probeXml !== null) {
    const expansionIds = new Set(parseItems(probeXml).map((it) => it.attrs.objectid).filter(Boolean));
    for (const g of items) {
      g.expansion = expansionIds.has(g.externalId);
      // The mislabeled subtype also built a /boardgame/ link; keep it canonical
      // the way parseThing does (/boardgame/<id> would merely redirect).
      if (g.expansion) g.url = `${WEB}/boardgameexpansion/${g.externalId}`;
    }
  }
  return { state: invalidUser ? 'invalid_user' : 'ok', items };
}

// Every edition cover BGG holds for one game (#519), so the round can pick the
// printing that is actually on their shelf instead of whatever /thing serves as
// the item's default image. BGG-only: the four storefronts expose no equivalent
// per-edition image set, so lib/routes/lookup.js treats this as an OPTIONAL
// capability the same way it treats collection().
//
// It is a SECOND request on purpose, never folded into detail(): `versions=1`
// makes the same body 2.5–5× heavier and ~200 ms slower (measured 2026-07-28 —
// Catan 47 KB -> 244 KB), which every add-game pick would pay for a picker most
// picks never open. The route fetches it lazily, only when the picker is opened.
//
// Without a token it degrades to [] exactly like search(): the picker then shows
// its empty state instead of an error a fork cannot fix.
async function covers(externalId) {
  if (!apiToken()) return [];
  const params = new URLSearchParams({ id: externalId, versions: '1' });
  return parseVersions(await fetchXml(`${API}/thing?${params.toString()}`));
}

// The player ranges for a set of ticked expansions, in ONE /thing call (#653).
// BGG-only, like collection() and covers(): the four storefronts have no concept
// of an expansion, so lib/routes/lookup.js treats the presence of this function
// as the capability marker and answers 400 for a provider without it.
//
// Bounded because the ids go into a URL and the caller is a client-supplied
// list; the route caps the stored list at the same order of magnitude. Without a
// token it degrades to [] exactly like search(), so a fork sees the free-text
// path rather than an error it cannot fix.
const MAX_EXPANSION_BATCH = 60;

async function expansionDetails(ids) {
  const list = [...new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean))]
    .slice(0, MAX_EXPANSION_BATCH);
  if (!list.length || !apiToken()) return [];
  const params = new URLSearchParams({ id: list.join(',') });
  return parseExpansionDetails(await fetchXml(`${API}/thing?${params.toString()}`));
}

// The standard metadata for MANY games in one /thing?stats=1 call (#717, #724),
// for the lazy backfill of games added before the fields existed. BGG-only like
// collection()/covers(): the storefronts have no comparable weight, so the
// presence of this function is the capability marker lib/provider-info.js and
// lib/routes/games.js check. Batched and bounded like expansionDetails, and it
// degrades to [] without a token so a fork simply keeps games without the info.
function parseGameInfo(xml) {
  return parseItems(xml)
    .map((item) => ({ providerId: String(item.attrs.id || ''), ...infoOf(item.children) }))
    .filter((e) => e.providerId);
}

// Batched past 60 like expansionParents (sequential, same ceiling): the
// collection import is the one bulk caller, and a 130-game shelf must not
// silently fill only its first batch — the rest would stay field-less AND
// unstamped, invisible until someone opens each detail page.
async function gameInfo(ids) {
  const list = [...new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean))]
    .slice(0, MAX_PARENT_BATCHES * MAX_EXPANSION_BATCH);
  if (!list.length || !apiToken()) return [];
  const out = [];
  for (let i = 0; i < list.length; i += MAX_EXPANSION_BATCH) {
    const params = new URLSearchParams({ id: list.slice(i, i + MAX_EXPANSION_BATCH).join(','), stats: '1' });
    out.push(...parseGameInfo(await fetchXml(`${API}/thing?${params.toString()}`)));
  }
  return out;
}

// How many batches expansionParents will ever issue. Each is its own fetchXml
// with its own 8 s budget, so an unbounded loop over a huge wishlist could hold
// a request open for minutes. Beyond the ceiling the remaining expansions simply
// arrive with no parents — i.e. as unattached wishes, which is the same
// degradation an item BGG reports no inbound link for.
const MAX_PARENT_BATCHES = 5;

// The base games a set of wished expansions belong to (#664). BGG-only, like its
// three sibling capabilities, and it degrades to [] without a token so a fork
// imports the expansions unattached rather than seeing an error it cannot fix.
//
// Batched at the same 60 ids per /thing call expansionDetails uses. Sequential
// rather than parallel on purpose: the batches share one upstream's throttling
// budget, and BGG's terms ask for few requests, not fast ones.
async function expansionParents(ids) {
  const list = [...new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean))]
    .slice(0, MAX_PARENT_BATCHES * MAX_EXPANSION_BATCH);
  if (!list.length || !apiToken()) return [];
  const out = [];
  for (let i = 0; i < list.length; i += MAX_EXPANSION_BATCH) {
    const params = new URLSearchParams({ id: list.slice(i, i + MAX_EXPANSION_BATCH).join(',') });
    out.push(...parseExpansionParents(await fetchXml(`${API}/thing?${params.toString()}`)));
  }
  return out;
}

module.exports = {
  id: 'bgg',
  label: 'BoardGameGeek',
  search,
  detail,
  collection,
  covers,
  expansionDetails,
  expansionParents,
  gameInfo,
  // BGG is deliberately NOT localized (#505). Its search is driven by the QUERY,
  // not by a configured locale: it matches alternate names, parseSearch keeps
  // the best-scoring name rather than the primary one, and pickedTitle() keeps
  // the search hit's title for bgg so the /thing hop cannot overwrite it. So it
  // already answers correctly in every language, and adding a locale parameter
  // would at best do nothing and at worst re-break #117.
  //
  // Returning a constant keeps its cache to ONE entry instead of fragmenting it
  // per UI locale for byte-identical results. search()/detail() ignore the extra
  // argument the route passes every provider.
  resolveLocale: () => '',
  imageHostAllowed,
  imageHosts: IMAGE_HOSTS, // trusted cover hosts (feeds the CSP img-src allowlist)
  tokenSet: () => apiToken() !== '',
  // exported for unit tests:
  parseItems,
  parseSearch,
  parseThing,
  parseCollection,
  parseVersions,
  parseExpansionLinks,
  parseInboundExpansionLinks,
  parseExpansionDetails,
  parseExpansionParents,
  parseGameInfo,
  pickImage,
  scoreName,
  decodeXml,
};
