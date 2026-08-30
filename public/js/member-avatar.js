/* Spielwirbel – the ONE thing that decides whether a person renders as a photo
   or as their initials (#841).

   The avatar span is written out at seventeen sites across eleven files
   (core.js, round-rail.js, views-home.js, views-round.js, views-member.js,
   views-pokale.js, views-session.js, views-session-live.js, views-vote-link.js,
   views-friends.js, views-account.js). Every one of them calls avatarFace(), so
   a person cannot appear as a photograph on the Regal and as two letters on the
   results screen — which is the failure this file exists to make impossible,
   not merely unlikely. Adding an eighteenth site means calling this, not
   writing another `esc(initials(...))`.

   Note views-friends.js reaches it through its own friendAvatar(), which is the
   one wrapper allowed to sit in between: it owns the deterministic colour an
   account gets when there is no round palette to borrow from, and it serves the
   profile head, the Freundeskreis rows and the feed badge from one place.

   Dependency-free and requireable into Node, like every other testable helper
   here (.claude/rules/frontend-helper-modules-and-coverage.md): it takes the
   fallback TEXT rather than reaching for core.js's initials(), and the batch
   fetch is injected rather than calling api(). Part of the shared frontend
   scope; loaded before core.js.

   NOTHING here is denormalized. The cache is per page load and is keyed by
   account id; the stored truth is the `avatar` field on the user row, and a
   round read carries no part of it (#841 §3). */

'use strict';

// userId -> '/uploads/<key>.webp' | null. `null` is a real, cached answer ("this
// account has no picture"), which is why membership is tested with .has() and
// never with a truthiness check — otherwise every account without a picture
// would be re-requested on every render.
const AVATAR_CACHE = new Map();

// Attribute-safe escaping. Its own three lines rather than core.js's esc()
// because this file must be requireable outside the browser, where the shared
// scope does not exist. The values are server-minted (an opaque id, an
// /uploads path) — this is discipline, not a live hole.
function aesc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Seat one account's picture from a payload that already resolved it — /me, the
// profile response, the friends list, the feed. These surfaces never need the
// batch endpoint, so telling the cache what they already know keeps a friend's
// face from being re-fetched when the same person turns up on a round screen.
function rememberAvatar(userId, path) {
  if (!userId) return;
  AVATAR_CACHE.set(userId, path || null);
}

// What we currently believe, or undefined when the id has never been resolved.
// Deliberately three-valued: undefined (unknown), null (no picture), a path.
function knownAvatar(userId) {
  return userId ? AVATAR_CACHE.get(userId) : undefined;
}

// Resolve the ids we do not yet know through the caller's fetcher, which is
// api()-shaped in the app and a stub in tests.
//
// Returns early when nothing is missing — and that is the common case rather
// than an optimisation: member.userId is set only by the seat self-claim (#421),
// so a round whose seats are all name-only asks for NOTHING and costs no extra
// request at all. That is what makes priming before render affordable, and it is
// why this is a prime-then-render rather than a render-then-patch.
//
// A failed fetch caches nothing and throws nothing: the screen renders initials,
// which is the correct fallback, and the next view tries again.
async function primeAvatars(userIds, fetcher) {
  const missing = [...new Set((userIds || []).filter(Boolean))]
    .filter((uid) => !AVATAR_CACHE.has(uid));
  if (!missing.length) return;
  let answer;
  try {
    answer = await fetcher(missing);
  } catch {
    return;
  }
  const avatars = (answer && answer.avatars) || {};
  // EVERY requested id is cached, including ones the answer omitted — an id the
  // server did not name has no picture (or no account), and leaving it unknown
  // would re-request it on every single render for the rest of the page's life.
  for (const uid of missing) AVATAR_CACHE.set(uid, avatars[uid] || null);
}

// The inner content of an avatar element: the picture when we have one, the
// initials otherwise. The CALLER keeps its own outer element, class and
// per-member background colour untouched — this replaces only what goes inside,
// which is what let all sixteen sites adopt it without restyling any of them.
//
// `fallbackText` is passed in already computed (initials(name)) and is escaped
// here. `opts.src` short-circuits the cache for a payload that carried the path
// itself; `opts.userId` reads the cache.
function avatarFace(fallbackText, opts) {
  const o = opts || {};
  const src = o.src || (o.userId ? AVATAR_CACHE.get(o.userId) : null);
  const text = aesc(fallbackText == null ? '' : fallbackText);
  if (!src) return text;
  // alt="" on purpose: every site renders the person's NAME beside or under the
  // avatar, so alt text here would make a screen reader say it twice. The
  // fallback rides in a data attribute so a picture that 404s (taken down,
  // erased mid-page) can degrade to the initials it replaced — see
  // installAvatarFallback.
  return `<img class="avatar__img" src="${aesc(src)}" alt="" decoding="async" `
    + `loading="lazy" data-avatar-fallback="${text}">`;
}

// Swap a broken picture back to the initials it replaced. `error` does not
// bubble, so the listener is registered in the CAPTURE phase — a per-image
// onerror attribute would need inline script, which the CSP refuses.
//
// Why this matters beyond tidiness: an operator takedown or an account erasure
// removes the bytes while a page holding the path is still open, and without
// this the person renders as a broken-image glyph inside a coloured circle
// rather than as the avatar the app has always had.
function installAvatarFallback(doc) {
  if (!doc || !doc.addEventListener) return;
  doc.addEventListener('error', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'IMG' || !el.classList.contains('avatar__img')) return;
    const parent = el.parentNode;
    if (!parent) return;
    parent.textContent = el.getAttribute('data-avatar-fallback') || '';
  }, true);
}

// Drop everything we believe. Called on logout: the next account must not read
// the previous one's resolutions, and an id it cannot see would otherwise
// render from a cache entry it never had the right to.
function resetAvatarCache() {
  AVATAR_CACHE.clear();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    avatarFace, primeAvatars, rememberAvatar, knownAvatar, installAvatarFallback, resetAvatarCache,
  };
}
