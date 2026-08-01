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
  };
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
  const params = new URLSearchParams({ id: externalId });
  return parseThing(await fetchXml(`${API}/thing?${params.toString()}`), externalId);
}

// The games a BGG user marks as OWNED, for the one-shot Regal import (#481).
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
async function collection(username) {
  const name = String(username || '').trim();
  if (!name || !apiToken()) return { state: 'ok', items: [] };
  const params = new URLSearchParams({
    username: name,
    own: '1',
    excludesubtype: 'boardgameexpansion',
    stats: '1',
  });
  let xml;
  try {
    xml = await fetchXml(`${API}/collection?${params.toString()}`);
  } catch (err) {
    if (err && err.status === 202) return { state: 'queued', items: [] };
    throw err;
  }
  const { invalidUser, items } = parseCollection(xml);
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

module.exports = {
  id: 'bgg',
  label: 'BoardGameGeek',
  search,
  detail,
  collection,
  covers,
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
  pickImage,
  scoreName,
  decodeXml,
};
