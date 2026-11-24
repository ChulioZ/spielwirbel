'use strict';

/*
 * Direct messages between friends (#1783). Mounted at /api/account/messages,
 * beside the friends router and for the same reason: a conversation joins two
 * ACCOUNTS and crosses no tenant, so it sits ahead of the /api tenant gate and
 * every repo call is on the module-level repo, scoped to req.userId here. The
 * stores are global (lib/repo/direct-messages-*.js); RLS is not widened.
 *
 * Who may do what, decided per request from the caller's OWN friendship rows:
 *  - a CONFIRMED friend may read and write the conversation;
 *  - an EX-friend may still read it, and delete their own messages, but write
 *    nothing new — not even an edit, which would be a new text by another name.
 *    Ending the friendship is the block (#1783: "reuse ending the friendship");
 *  - anyone else gets the same 404 as an unknown account, so the route never
 *    says whether two strangers once talked;
 *  - a guest-demo account gets nothing at all (refuseDemoAccount on the whole
 *    router): a throwaway account must never reach a real user's conversation,
 *    and a demo partner is treated as unknown for the same reason.
 *
 * The TEXT never reaches a log line, an event or an inbox item — the round
 * chat's promise (product-event-logging.md), asserted in
 * test/direct-messages.test.js. Validation failures answer a fixed message.
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const repo = require('../repo');
const accounts = require('../accounts');
const demo = require('../demo');
const quota = require('../quota');
const chatInbox = require('../chat-inbox');
const { validateBody } = require('../validate');
const { trackEvent } = require('../observability');
const { CHAT_MESSAGE_MAX, CHAT_PAGE_SIZE, normalizeChatText } = require('../../public/js/round-chat');

const router = express.Router();

router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});
router.use(accounts.requireUser, demo.refuseDemoAccount);

// Per ACCOUNT, the round chat's ceiling and its reasoning; its own key prefix,
// so a busy round thread and a conversation do not spend one bucket.
const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => Number(process.env.CHAT_RATE_LIMIT_MAX) || 20,
  keyGenerator: (req) => `dm:${req.userId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

const textSchema = z.object({
  text: z.string({ message: 'Invalid message' })
    .transform(normalizeChatText)
    .refine((s) => s.length > 0 && s.length <= CHAT_MESSAGE_MAX, { message: 'Invalid message' }),
});
// zod's int() accepts safe integers only — the bound the round chat measured.
const readSchema = z.object({ seq: z.number().int().min(0) }, { message: 'Invalid marker' });
const SEQ_MAX = Number.MAX_SAFE_INTEGER;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const otherParty = (f, me) => (f.requesterUserId === me ? f.addresseeUserId : f.requesterUserId);

async function acceptedFriendIds(me) {
  return new Set((await repo.listFriendships(me))
    .filter((f) => f.status === 'accepted')
    .map((f) => otherParty(f, me)));
}

// The other party of `:uid`, or null when the conversation is not the caller's
// to see. `canPost` is the one capability that depends on the friendship NOW.
async function resolvePartner(req) {
  const uid = req.params.uid;
  if (!ID_RE.test(uid) || uid === req.userId) return null;
  const other = await repo.getUserById(uid);
  if (!other || demo.isDemoUser(other)) return null;
  const friend = (await acceptedFriendIds(req.userId)).has(uid);
  if (!friend) {
    const history = await repo.listDirectMessages(req.userId, uid, { limit: 1 });
    if (!history.messages.length) return null;
  }
  return { user: other, friend, canPost: friend && !other.disabled };
}

const person = (u) => (u ? { username: u.username || null, avatar: u.avatar || null } : null);

// username + avatar per author, resolved here and never stored, so a renamed
// account shows its current name at once (the round chat's shape). A
// conversation has exactly two authors, so both are passed in rather than
// looked up per message.
async function withAuthors(messages, req, partner) {
  const me = await repo.getUserById(req.userId);
  return messages.map(({ authorUserId, ...m }) => ({
    ...m,
    author: person(authorUserId === req.userId ? me : partner),
    own: authorUserId === req.userId,
  }));
}

// The message `:mid`, only if it belongs to THIS conversation.
async function pairMessage(req) {
  if (!ID_RE.test(req.params.mid)) return null;
  const msg = await repo.getDirectMessage(req.params.mid);
  if (!msg) return null;
  const [a, b] = msg.participants;
  const mine = (a === req.userId && b === req.params.uid) || (b === req.userId && a === req.params.uid);
  return mine ? msg : null;
}

/* ------------------------------ the list ---------------------------------- */
// One row per confirmed friend, plus every ex-friend with history, newest
// conversation first; friends nobody has written to yet follow by name.
router.get('/', async (req, res) => {
  const me = req.userId;
  const friends = await acceptedFriendIds(me);
  const convs = await repo.listDirectConversations(me);
  const reads = await repo.getDirectMessageReads(me);
  const byId = new Map(convs.map((c) => [c.otherUserId, c]));
  const ids = [...new Set([...convs.map((c) => c.otherUserId), ...friends])];
  const rows = [];
  for (const uid of ids) {
    const u = await repo.getUserById(uid);
    if (!u || demo.isDemoUser(u)) continue;
    const c = byId.get(uid);
    rows.push({
      userId: uid,
      ...person(u),
      friend: friends.has(uid),
      unread: !!(c && c.head != null && c.head > (reads[uid] || 0)),
      lastAt: c ? c.lastAt : null,
      lastSeq: c ? c.lastSeq : 0,
    });
  }
  rows.sort((x, y) => (y.lastSeq - x.lastSeq)
    || String(x.username || '').localeCompare(String(y.username || '')));
  for (const r of rows) delete r.lastSeq; // the sort key, not part of the answer
  res.json({ conversations: rows });
});

/* ----------------------------- one thread --------------------------------- */
router.get('/:uid', async (req, res) => {
  const raw = req.query.before;
  const before = raw == null ? null : Number(raw);
  if (before != null && !(Number.isInteger(before) && before > 0 && before <= SEQ_MAX)) {
    return res.status(400).json({ error: 'Invalid cursor' });
  }
  const partner = await resolvePartner(req);
  if (!partner) return res.status(404).json({ error: 'not_found' });
  const page = await repo.listDirectMessages(req.userId, req.params.uid, { before, limit: CHAT_PAGE_SIZE });
  const reads = await repo.getDirectMessageReads(req.userId);
  res.json({
    partner: { userId: req.params.uid, ...person(partner.user) },
    friend: partner.friend,
    canPost: partner.canPost,
    messages: await withAuthors(page.messages, req, partner.user),
    hasMore: page.hasMore,
    lastRead: reads[req.params.uid] || 0,
  });
});

router.post('/:uid', postLimiter, async (req, res) => {
  const body = validateBody(textSchema, req, res);
  if (!body) return;
  const partner = await resolvePartner(req);
  if (!partner) return res.status(404).json({ error: 'not_found' });
  if (!partner.canPost) return res.status(403).json({ error: 'not_friends' });
  const limit = quota.directMessagesPerUser();
  if (await repo.countDirectMessages(req.userId) >= limit) {
    return res.status(403).json({ error: 'quota_direct_messages', limit });
  }
  const msg = await repo.createDirectMessage({
    authorUserId: req.userId, recipientUserId: req.params.uid, text: body.text, at: new Date().toISOString(),
  });
  // Deliberately NO read mark here — the round chat's §3: the view marks what
  // it has SHOWN, and posting would mark read a message that arrived unseen.
  const me = await repo.getUserById(req.userId);
  trackEvent('direct_message_posted', { tenantId: me && me.tenantId });
  // The recipient's collapsed inbox item. Awaited so a spec reads a settled
  // inbox; never throws, since the message is already stored.
  await chatInbox.syncDirectThreadSafe(req.params.uid, req.userId, { create: true });
  res.status(201).json((await withAuthors([msg], req, partner.user))[0]);
});

router.post('/:uid/read', async (req, res) => {
  const body = validateBody(readSchema, req, res);
  if (!body) return;
  const partner = await resolvePartner(req);
  if (!partner) return res.status(404).json({ error: 'not_found' });
  const lastRead = await repo.markDirectMessagesRead(req.userId, req.params.uid, body.seq);
  await chatInbox.syncDirectThreadSafe(req.userId, req.params.uid);
  res.json({ lastRead });
});

// Only the author edits, and only while the two are still friends.
router.patch('/:uid/:mid', async (req, res) => {
  const body = validateBody(textSchema, req, res);
  if (!body) return;
  const partner = await resolvePartner(req);
  if (!partner) return res.status(404).json({ error: 'not_found' });
  const msg = await pairMessage(req);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.authorUserId !== req.userId) return res.status(403).json({ error: 'not_author' });
  if (!partner.canPost) return res.status(403).json({ error: 'not_friends' });
  const updated = await repo.updateDirectMessage(msg.id, { text: body.text, editedAt: new Date().toISOString() });
  if (!updated) return res.status(404).json({ error: 'Message not found' });
  res.json((await withAuthors([updated], req, partner.user))[0]);
});

// The author may always take their own message back, friends or not.
router.delete('/:uid/:mid', async (req, res) => {
  const partner = await resolvePartner(req);
  if (!partner) return res.status(404).json({ error: 'not_found' });
  const msg = await pairMessage(req);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.authorUserId !== req.userId) return res.status(403).json({ error: 'not_author' });
  await repo.deleteDirectMessage(msg.id);
  // The recipient's count may drop (or its item go) — never a new item.
  await chatInbox.syncDirectThreadSafe(req.params.uid, req.userId);
  res.status(204).end();
});

module.exports = router;
