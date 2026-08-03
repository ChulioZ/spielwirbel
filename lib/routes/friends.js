'use strict';

/*
 * Friendships & the Freundeskreis feed (issue #325) — send / accept / decline /
 * unfriend a friend request, list friends & pending requests, and read the feed.
 *
 * Mounted at /api/account/friends, so these are account-scoped actions reached
 * BEFORE the /api tenant gate (a friendship crosses no tenant — it shares no round
 * data, only feed events). requireUser sets req.userId; every repo call is on the
 * module-level repo (the friendship + feed stores are global, keyed by account id)
 * and scoped to req.userId, so a caller only ever touches their own relationships.
 *
 * Delivery of a request is the inbox (#207): send writes a `friend_request` item
 * to the addressee; accept/decline dismiss it. A friendship shares NOTHING about a
 * round — the feed carries only a game title + optional cover snapshot, and only
 * events created after the friendship was accepted are shown.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../repo');
const accounts = require('../accounts');
const demo = require('../demo');
const notify = require('../notify');
const quota = require('../quota');
const { validateBody } = require('../validate');

const router = express.Router();

// Env-gated like the rest of the account surface: invisible (404) unless accounts
// are on. In legacy/shared-password mode there are no accounts to befriend.
router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

// How many feed events the feed endpoint returns after the per-friend "since
// accepted" cutoff. Read a wider window from the store, then trim.
const FEED_READ = 200;
const FEED_SHOW = 50;

// Resolve a set of account ids to their public usernames in one pass (small,
// capped sets — the friends list / a page of feed authors). A missing account
// (edge: mid-erasure) maps to null; the frontend shows a neutral fallback.
async function usernamesFor(ids) {
  const map = new Map();
  await Promise.all([...new Set(ids)].map(async (uid) => {
    const u = await repo.getUserById(uid);
    map.set(uid, (u && u.username) || null);
  }));
  return map;
}

// The other party of a friendship, from the caller's perspective.
const otherParty = (f, me) => (f.requesterUserId === me ? f.addresseeUserId : f.requesterUserId);

/* ---------------------------- list friends/requests ------------------------ */
// The Freundeskreis view's data: accepted friends plus pending requests split by
// direction (incoming = addressed to me, outgoing = sent by me).
router.get('/', accounts.requireUser, async (req, res) => {
  const me = req.userId;
  const rows = await repo.listFriendships(me);
  const names = await usernamesFor(rows.map((f) => otherParty(f, me)));

  const shape = (f) => ({ friendshipId: f.id, userId: otherParty(f, me), username: names.get(otherParty(f, me)) });
  res.json({
    friends: rows.filter((f) => f.status === 'accepted').map((f) => ({ ...shape(f), since: f.acceptedAt })),
    incoming: rows.filter((f) => f.status === 'pending' && f.addresseeUserId === me).map((f) => ({ ...shape(f), at: f.createdAt })),
    outgoing: rows.filter((f) => f.status === 'pending' && f.requesterUserId === me).map((f) => ({ ...shape(f), at: f.createdAt })),
  });
});

/* ---------------------------------- feed ----------------------------------- */
// The Freundeskreis feed: friends' game_added / session_played events, only those
// created AFTER the friendship was accepted (privacy-friendlier — a friend does
// not retroactively see your whole history). friendCount lets the home screen
// decide whether to render its compact section at all (#325: accounts + >=1 friend).
router.get('/feed', accounts.requireUser, async (req, res) => {
  const me = req.userId;
  const friends = (await repo.listFriendships(me)).filter((f) => f.status === 'accepted');
  const since = new Map(friends.map((f) => [otherParty(f, me), f.acceptedAt]));

  const events = (await repo.listFeedEvents([...since.keys()], FEED_READ))
    // Only events the friend produced after we became friends (string ISO compare).
    .filter((e) => String(e.at) >= String(since.get(e.uid) || ''))
    .slice(0, FEED_SHOW);

  const names = await usernamesFor(events.map((e) => e.uid));
  res.json({
    friendCount: friends.length,
    events: events.map((e) => ({ type: e.type, title: e.title, coverUrl: e.coverUrl, at: e.at, username: names.get(e.uid) })),
  });
});

/* ---------------------------------- send ----------------------------------- */
const sendSchema = z.object({ username: z.string().min(1) });

// refuseDemoAccount (#427): a throwaway demo account must not be able to send a
// friend request to a named stranger — see lib/demo.js for why that guard is
// here rather than only absent from the UI.
router.post('/', accounts.requireUser, demo.refuseDemoAccount, async (req, res) => {
  const body = validateBody(sendSchema, req, res);
  if (!body) return;

  const caller = await repo.getUserById(req.userId);
  if (!caller) return res.status(401).json({ error: 'auth_required' });

  // Addressed by public username (#320). Unknown handle is a plain 404 — a username
  // is public, so this reveals nothing (unlike e-mail, which stays anti-enumerated).
  const target = await repo.getUserByUsername(body.username);
  if (!target) return res.status(404).json({ error: 'user_not_found' });
  if (target.id === caller.id) return res.status(400).json({ error: 'cannot_friend_self' });

  // Per-account caps (#139-style): the sender's accepted friends and open outgoing
  // requests. Distinct 403 codes → localized toasts. Derived from one read.
  const mine = await repo.listFriendships(caller.id);
  if (mine.filter((f) => f.status === 'accepted').length >= quota.friendsPerUser())
    return res.status(403).json({ error: 'quota_friends' });
  if (mine.filter((f) => f.status === 'pending' && f.requesterUserId === caller.id).length >= quota.friendRequestsPerUser())
    return res.status(403).json({ error: 'quota_requests' });

  const f = await repo.createFriendRequest({ requesterUserId: caller.id, addresseeUserId: target.id });
  if (f === 'already_friends') return res.status(409).json({ error: 'already_friends' });
  if (f === 'request_pending') return res.status(409).json({ error: 'request_pending' });

  const item = await repo.addInboxItem(target.id, {
    type: 'friend_request',
    payload: { friendshipId: f.id, requesterUserId: caller.id, requesterUsername: caller.username || null },
  });

  // Also reach the addressee by e-mail (#618). Not awaited — see the note on the
  // matching call in lib/routes/invitations.js. notifyInboxItem never rejects.
  notify.notifyInboxItem(target.id, item);

  res.status(201).json({ friendship: f });
});

/* --------------------------------- accept ---------------------------------- */
// The ADDRESSEE accepts (driven from the inbox item). The accepter's own friend
// cap is re-checked here — accepting also grows their friends by one.
router.post('/:id/accept', accounts.requireUser, async (req, res) => {
  const mine = await repo.listFriendships(req.userId);
  if (mine.filter((f) => f.status === 'accepted').length >= quota.friendsPerUser())
    return res.status(403).json({ error: 'quota_friends' });

  const accepted = await repo.acceptFriendRequest(req.params.id, req.userId);
  // Not a pending request addressed to this account → indistinguishable from missing.
  if (!accepted) return res.status(404).json({ error: 'not_found' });
  await dismissFriendRequestInbox(req.userId, req.params.id);
  res.json({ friendship: accepted });
});

/* --------------------------------- decline --------------------------------- */
// Silent (the requester is not notified, #325). Removes an incoming pending row —
// or, if the caller is the requester, cancels their own outgoing one.
router.post('/:id/decline', accounts.requireUser, async (req, res) => {
  const removed = await repo.deleteFriendshipById(req.params.id, req.userId);
  if (!removed) return res.status(404).json({ error: 'not_found' });
  await dismissFriendRequestInbox(req.userId, req.params.id);
  res.status(204).end();
});

/* -------------------------------- unfriend --------------------------------- */
// Unilateral and silent, effective both ways immediately (#325): the same delete,
// distinct verb. Either party may end an accepted friendship.
router.delete('/:id', accounts.requireUser, async (req, res) => {
  const removed = await repo.deleteFriendshipById(req.params.id, req.userId);
  if (!removed) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

// Clear the caller's inbox item for a resolved friend request (delivery was the
// inbox, so resolving it must clear the notification). Best-effort, by design.
async function dismissFriendRequestInbox(userId, friendshipId) {
  const item = (await repo.listInbox(userId)).find(
    (it) => it.type === 'friend_request' && it.payload && it.payload.friendshipId === friendshipId);
  if (item) await repo.dismissInboxItem(userId, item.id);
}

module.exports = router;
