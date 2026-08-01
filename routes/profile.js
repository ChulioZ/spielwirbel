'use strict';

/*
 * Public account profiles (issue #558) — GET /api/account/profile/:username.
 *
 * Mounted at /api/account/profile, so this is account-scoped and reached BEFORE
 * the /api tenant gate: a profile crosses no tenant, and the caller may well be
 * a stranger to the subject's tenant. Mounted ahead of /api/account so that
 * router's prefix match doesn't field it, same as invitations and friends.
 *
 * What a profile discloses is deliberately thin and is the whole scoping
 * argument of #558: the public username (#320), the registration month, and the
 * CALLER'S OWN friendship state with that account — nothing that crosses the
 * tenant boundary. Rounds, games, sessions and ratings are tenant-private under
 * RLS (.claude/rules/tenancy-rls.md) and a friendship grants no access to any of
 * it (routes/friends.js). Adding any cross-tenant aggregate here is a new
 * disclosure needing its own privacy-policy §5 + vvt.md change and a
 * PRIVACY_REVISION bump (.claude/rules/keep-legal-docs-current.md).
 *
 * The friends-only feed reuses /friends/feed's shape for a single account,
 * INCLUDING its acceptedAt cutoff: a new friend must not retroactively see the
 * whole prior history.
 */

const express = require('express');
const repo = require('../lib/repo');
const accounts = require('../lib/accounts');

const router = express.Router();

// Env-gated like the rest of the account surface (routes/account.js): invisible
// (404) unless accounts are on. In legacy/shared-password mode there are no
// accounts to have a profile.
router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

// Mirrors routes/friends.js FEED_READ/FEED_SHOW: read a wider window from the
// store, then trim after the cutoff has been applied.
const FEED_READ = 200;
const FEED_SHOW = 50;

// The other party of a friendship, from the caller's perspective. Same
// definition as routes/friends.js — derived here from the caller's own rows so
// "incoming" means the same thing on both surfaces.
const otherParty = (f, me) => (f.requesterUserId === me ? f.addresseeUserId : f.requesterUserId);

/* --------------------------------- profile --------------------------------- */

router.get('/:username', accounts.requireUser, async (req, res) => {
  const me = req.userId;

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
    createdAt: target.createdAt || null,
    self,
    friendship: 'none',
  };

  // Your own profile has no relationship to render; the view shows no CTA.
  if (self) return res.json(body);

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
  const events = (await repo.listFeedEvents([uid], FEED_READ))
    .filter((e) => String(e.at) >= String(since || ''))
    .slice(0, FEED_SHOW);
  return events.map((e) => ({ type: e.type, title: e.title, coverUrl: e.coverUrl, at: e.at }));
}

module.exports = router;
