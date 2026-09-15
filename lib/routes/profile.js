'use strict';

/*
 * Public account profiles (issue #558) — GET /api/account/profile/:username.
 *
 * Mounted at /api/account/profile, so this is account-scoped and reached BEFORE
 * the /api tenant gate: a profile crosses no tenant, and the caller may well be
 * a stranger to the subject's tenant. Mounted ahead of /api/account so that
 * router's prefix match doesn't field it, same as invitations and friends.
 *
 * What a profile discloses is deliberately thin: the public username (#320), the
 * registration month, and the CALLER'S OWN friendship state with that account.
 * Rounds, games, sessions and ratings stay tenant-private under RLS
 * (.claude/rules/tenancy-rls.md), and a friendship grants no access to any of it
 * (lib/routes/friends.js).
 *
 * #1089 added ONE cross-tenant aggregate on top of that, and it went through the
 * gate this comment used to describe as hypothetical: privacy policy §5 +
 * docs/legal/vvt.md row 2 + a PRIVACY_REVISION bump
 * (.claude/rules/keep-legal-docs-current.md). `stats` is an account-wide summary
 * of every seat the subject holds — counts, a win rate, a rating average and at
 * most two game TITLES — built by lib/user-stats.js, which by construction
 * returns no round name, round id, member name or tenant id. It is shown to the
 * subject themselves, and to an ACCEPTED FRIEND unless the subject has switched
 * `statsVisible` off. A stranger or a pending request gets no `stats` key at
 * all — absent, never empty, for the same reason `events` is.
 *
 * The friends-only feed reuses /friends/feed's shape for a single account,
 * INCLUDING its acceptedAt cutoff: a new friend must not retroactively see the
 * whole prior history. The SELF feed deliberately has no cutoff — there is no
 * friendship to date it from, and it is the account's own activity.
 */

const express = require('express');
const repo = require('../repo');
const accounts = require('../accounts');
const demo = require('../demo');
const { collapseFeedEvents } = require('../feed');
const { accountStats } = require('../user-stats');

const router = express.Router();

// Env-gated like the rest of the account surface (lib/routes/account.js): invisible
// (404) unless accounts are on. In legacy/shared-password mode there are no
// accounts to have a profile.
router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

// Mirrors lib/routes/friends.js FEED_READ/FEED_SHOW: read a wider window from the
// store, then trim after the cutoff has been applied.
const FEED_READ = 200;
const FEED_SHOW = 50;

// The other party of a friendship, from the caller's perspective. Same
// definition as lib/routes/friends.js — derived here from the caller's own rows so
// "incoming" means the same thing on both surfaces.
const otherParty = (f, me) => (f.requesterUserId === me ? f.addresseeUserId : f.requesterUserId);

/* --------------------------------- profile --------------------------------- */

// refuseDemoAccount (#877): the FIRST read to carry it — every other call site
// guards a POST. It is here because two documents lean on the sign-in gate to
// describe who may see a profile picture (docs/legal/vvt.md row 4: "für
// angemeldete Konten sichtbar … keine Veröffentlichung gegenüber der
// Allgemeinheit"; lib/legal.js: "Das Profil setzt eine Anmeldung voraus"), and
// since #427 a sign-in is something an anonymous visitor gets in one request.
// A picture of a person (vvt.md calls it its own data category) reachable that
// way makes both sentences true-but-misleading.
//
// It costs the demo nothing: nothing in the demo's UI reaches a profile —
// public/js/views-profile.js links one only from Der Kreis and the feed,
// and a demo can hold no friendships (friends.js refuses the send). So the only
// way here is a typed or shared URL.
//
// SINCE #1089 it is applied inside the handler rather than as middleware, because
// it must no longer refuse a demo looking at ITS OWN profile: the reasoning above
// is about seeing a picture of ANOTHER person, an account looking at itself
// discloses nothing it did not supply, and the demo is exactly where we want the
// self profile reachable — it is the showcase.
//
// It still runs BEFORE the lookup, and that ordering is the load-bearing part.
// The "is this me?" test compares the requested handle against the CALLER'S OWN
// username, so the refusal depends on nothing but the caller's own record — a
// demo asking about an unknown handle and a demo asking about a real stranger
// still get the identical 403, and this is not the username oracle the signed-in
// surface deliberately is not. Deciding it from `target.id === me` instead would
// read correctly and quietly reintroduce that oracle, since an unknown handle
// would then 404 where a real one 403s.
//
// Note this comparison gates the REFUSAL only. What the response discloses is
// still keyed off `self` below, which is identity (`target.id === me`) rather
// than a string compare.
router.get('/:username', accounts.requireUser, async (req, res) => {
  const me = req.userId;

  const caller = await repo.getUserById(me);
  const fold = (u) => String(u || '').trim().toLowerCase();
  const asksAboutSelf = !!(caller && caller.username
    && fold(caller.username) === fold(req.params.username));
  if (!asksAboutSelf && demo.isDemoUser(caller)) {
    return res.status(403).json({ error: 'demo_forbidden' });
  }

  // Addressed by public username (#320), case-insensitively via
  // getUserByUsername. An unknown handle is a plain 404 with the same code and
  // the same reasoning as POST /api/account/friends: a username is public, so
  // this reveals nothing — unlike e-mail, which stays anti-enumerated
  // (.claude/rules/user-accounts.md).
  const target = await repo.getUserByUsername(req.params.username);

  // A SUSPENDED account answers the identical 404. Suspension is an operator
  // moderation action (.claude/rules/admin-moderation-surface.md); an account
  // that stayed browsable through here would be a hole in it. The check belongs
  // in this route because lib/tenant.js enforces suspension on the /api gate,
  // which this route deliberately sits ahead of.
  if (!target || target.disabled) return res.status(404).json({ error: 'user_not_found' });

  const self = target.id === me;
  const body = {
    userId: target.id,
    username: target.username || null,
    // The profile picture (#841). It rides the profile payload rather than the
    // batch endpoint because this response already IS one account — and it needs
    // no extra suppression for a suspended account: the 404 above happens first,
    // so the picture disappears with the rest of the profile by construction.
    avatar: target.avatar || null,
    createdAt: target.createdAt || null,
    self,
    friendship: 'none',
  };

  // Your own profile has no relationship to render; the view shows no CTA. It
  // does carry the two things #1089 gave it: the account's own activity, with no
  // cutoff, and its own statistics — which the subject always sees, whatever
  // `statsVisible` says. That preference governs what FRIENDS see; hiding a
  // number from the person it is about would make the toggle unverifiable.
  if (self) {
    body.events = await feedFor(target.id, null);
    body.stats = await accountStats(target.id);
    return res.json(body);
  }

  // One read of the caller's own friendships answers the state, the id the
  // action buttons need, and the cutoff the feed needs — so the view renders
  // the right button without a second request.
  const rows = await repo.listFriendships(me);
  const link = rows.find((f) => otherParty(f, me) === target.id);
  if (!link) return res.json(body);

  body.friendshipId = link.id;
  if (link.status === 'accepted') {
    body.friendship = 'friends';
    body.since = link.acceptedAt;
    body.events = await feedFor(target.id, link.acceptedAt);
    // `!== false` so an account predating the field reads as VISIBLE, matching
    // meProjection's resolution of the same key
    // (.claude/rules/defaulted-account-fields-need-a-legacy-shape-spec.md).
    // Absent, not empty, when it is off: `stats: null` would be indistinguishable
    // from an account with nothing to show.
    if (target.statsVisible !== false) body.stats = await accountStats(target.id);
    return res.json(body);
  }
  // Pending: which way round decides which actions the view offers.
  body.friendship = link.addresseeUserId === me ? 'incoming' : 'outgoing';
  body.at = link.createdAt;
  res.json(body);
});

// This friend's own feed events, newest first. The acceptedAt cutoff is the
// deliberate privacy property of /friends/feed and must not be dropped here:
// without it a fresh friendship exposes the friend's entire prior history.
async function feedFor(uid, since) {
  const events = collapseFeedEvents(
    (await repo.listFeedEvents([uid], FEED_READ)).filter((e) => String(e.at) >= String(since || '')),
  )
    // Collapse BEFORE the slice, same as /friends/feed (#856).
    .slice(0, FEED_SHOW);
  return events.map((e) => ({
    type: e.type, title: e.title, coverUrl: e.coverUrl, count: e.count, at: e.at,
  }));
}

module.exports = router;
