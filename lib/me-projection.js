'use strict';

/*
 * The account fields a client may see — ONE projection, shared by every
 * endpoint that hands a `user` object to the browser (issue #785).
 *
 * Two jobs, and the second is why this is a module rather than a local helper
 * in lib/routes/account.js:
 *
 *  - It is the SECURITY BOUNDARY. The stored record also holds password hashes,
 *    refresh tokens and the verification/reset challenges, so a response built
 *    by hand is one forgotten line away from leaking one of them. Every response
 *    going through this projection means a field added to the stored user shape
 *    is never exposed by accident.
 *  - It is the CLIENT'S WHOLE PICTURE of the account. `accountUser` is seated
 *    straight from whatever started the session — POST /login, POST
 *    /passkeys/login or POST /demo — and only refreshed from GET /me on the next
 *    cold load. All three used to hand-build a small `{ id, email, username }`
 *    object, so any field they forgot read as `undefined` for the entire logged-in
 *    session. That shipped: the „Was ist neu" dot (#741) re-lit after every login
 *    although the stored stamp was correct, and `bggUsername`, both notification
 *    opt-outs and `bgStats` were sitting behind the same trap unnoticed.
 *
 * So the rule is: a route never assembles a user payload of its own. It answers
 * meProjection(user), and a new field is added here once.
 * (.claude/rules/shared-constants-across-the-stack.md — the same "two
 * descriptions of one thing, and the forgotten copy is the one that rots" shape,
 * a layer up from a shared constant.)
 */

// The terms-change notice (#521): the resolver that applies the legacy fallback.
const { termsAcceptanceOf } = require('./legal');

const meProjection = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username || null,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt,
  // Accounts predating #481 carry no key at all, so the projection — not the
  // stored shape — is what guarantees the client always sees the field.
  bggUsername: user.bggUsername || null,
  // The profile picture (#841), a '/uploads/<key>.webp' path or null. Same
  // reasoning as bggUsername: accounts predating it carry no key at all, so the
  // projection is what guarantees the client always sees the field rather than
  // `undefined` — which the avatar helper would read as "not loaded yet" and the
  // account screen as "cannot tell whether there is one to remove".
  avatar: user.avatar || null,
  // The two inbox-mail opt-outs (#618). `!== false` rather than a truthiness
  // check, because ABSENT must read as ON: an account predating this change
  // carries neither key, and it has to behave identically to one that has never
  // touched the toggle. Coerced here so the client always gets a real boolean and
  // never has to re-implement the default.
  notifyRoundInvitations: user.notifyRoundInvitations !== false,
  notifyFriendRequests: user.notifyFriendRequests !== false,
  // The BG Stats push opt-in (#485). `=== true`, not `!== false`: this one
  // defaults OFF, so an account predating it — carrying no key at all — must
  // read as off rather than inheriting the other two's opt-out shape.
  bgStats: user.bgStats === true,
  // #427. The client renders the persistent "this is a demo" banner off this,
  // so it has to survive a reload — which is exactly why it belongs on /me and
  // not only on the POST /demo response. Coerced to a real boolean: every other
  // account answers `false` here rather than `undefined`.
  demo: user.demo === true,
  demoExpiresAt: user.demo === true ? user.demoExpiresAt || null : null,
  // The terms-change notice (#521), delivering what Nutzungsbedingungen §11
  // promises. BOTH values ride here, and the client shows the banner when they
  // differ:
  //
  //  - the RESOLVED accepted revision, so the client never re-implements the
  //    LEGACY_TERMS_REVISION fallback (an absent key means "registered under the
  //    text live at rollout", i.e. up to date today and correctly behind after
  //    the next bump);
  //  - the CURRENT revision, deliberately on this per-user projection rather
  //    than on the public GET /api/config. Both arrive in one response, so the
  //    comparison cannot straddle two requests and read a stale pair — and the
  //    ungated config response keeps the exact shape test/config.test.js pins.
  ...termsAcceptanceOf(user),
  // The „Was ist neu" seen-state (#741). Only ONE value rides here, unlike the
  // terms pair above: the current revision lives in public/js/news.js, which the
  // client already has in its own bundle, so sending it would be the server
  // telling the browser something it is holding. `|| null` is what makes an
  // account predating the field read as "has seen nothing" — correct, because
  // the list is empty at rollout, so those accounts have missed nothing and the
  // first entry that ever lands is genuinely new to them.
  lastSeenNewsRevision: user.lastSeenNewsRevision || null,
});

module.exports = { meProjection };
