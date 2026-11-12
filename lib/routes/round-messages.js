'use strict';

/*
 * The round chat (#1781): one plain-text message thread per round, for every
 * account with access to it. Mounted at /api/rounds/:rid/messages (mergeParams
 * for :rid), i.e. AFTER resolveRoundGrant and requireRoundRole — so a grantee's
 * req.repo is already re-scoped to the owner tenant and bounded to exactly this
 * round, and every mutating path here is listed in lib/round-access.js.
 *
 * Accounts mode only, and only for a caller who IS an account: a message has an
 * author, and in legacy/shared-password mode there is nobody to name. A shared-
 * password caller on a layered instance carries no req.userId and gets the same
 * 404.
 *
 * The TEXT never reaches a log line: no trackEvent carries it, no logger call
 * names it, and validation failures answer a fixed message rather than echoing
 * the input (product-event-logging.md, „logs carry no message content"). The
 * request logger records paths and status only, and test/round-messages.test.js
 * asserts a posted text appears nowhere in the captured log output.
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const accounts = require('../accounts');
const repo = require('../repo');
const quota = require('../quota');
const { validateBody } = require('../validate');
const { trackEvent } = require('../observability');
const { can } = require('../../public/js/round-roles');
const { CHAT_MESSAGE_MAX, CHAT_PAGE_SIZE, normalizeChatText } = require('../../public/js/round-chat');

const router = express.Router({ mergeParams: true });

router.use((req, res, next) => {
  if (!accounts.accountsEnabled() || !req.userId) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});

// Per ACCOUNT, not per IP: everyone at one table shares a NAT address, and the
// thing being bounded is one person flooding a thread. Read per request so a
// deployment (or a spec) can retune it without a restart. Writes only — reading
// a thread is ordinary browsing and the global limiter covers it.
const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => Number(process.env.CHAT_RATE_LIMIT_MAX) || 20,
  keyGenerator: (req) => `chat:${req.userId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// A fixed message, never zod's: an issue message can quote the offending input.
const textSchema = z.object({
  text: z.string({ message: 'Invalid message' })
    .transform(normalizeChatText)
    .refine((s) => s.length > 0 && s.length <= CHAT_MESSAGE_MAX, { message: 'Invalid message' }),
});
// A seq is a Postgres bigint, and a larger number (1e300) reaches it as a value
// bigint cannot hold — measured, it throws 22P02, i.e. a 500 any account could
// repeat into the operator's error log. Zod's int() IS the bound here: it accepts
// safe integers only (1e300 and MAX_SAFE_INTEGER + 2 both refused, measured on
// zod 4), so a `.max(MAX_SAFE_INTEGER)` beside it was deliberately left out — a
// break sweep showed it guarding nothing. The query cursor below is a string and
// gets the bound by hand.
const SEQ_MAX = Number.MAX_SAFE_INTEGER;
const readSchema = z.object({ seq: z.number().int().min(0) }, { message: 'Invalid marker' });

// username + avatar per author, resolved here and never stored on the message,
// so a renamed account shows its current name everywhere at once.
async function withAuthors(messages, me) {
  const people = new Map();
  await Promise.all([...new Set(messages.map((m) => m.authorUserId))].map(async (uid) => {
    const u = await repo.getUserById(uid);
    people.set(uid, u ? { username: u.username || null, avatar: u.avatar || null } : null);
  }));
  return messages.map(({ authorUserId, ...m }) => ({
    ...m,
    author: people.get(authorUserId),
    own: authorUserId === me,
  }));
}

router.get('/', async (req, res) => {
  const raw = req.query.before;
  const before = raw == null ? null : Number(raw);
  if (before != null && !(Number.isInteger(before) && before > 0 && before <= SEQ_MAX)) {
    return res.status(400).json({ error: 'Invalid cursor' });
  }
  const page = await req.repo.listRoundMessages(req.params.rid, { before, limit: CHAT_PAGE_SIZE });
  if (!page) return res.status(404).json({ error: 'Round not found' });
  const reads = await repo.getRoundMessageReads(req.userId);
  res.json({
    messages: await withAuthors(page.messages, req.userId),
    hasMore: page.hasMore,
    lastRead: reads[req.params.rid] || 0,
  });
});

router.post('/', postLimiter, async (req, res) => {
  const body = validateBody(textSchema, req, res);
  if (!body) return;
  if (quota.enforced()) {
    const limit = quota.messagesPerTenant();
    if (await req.repo.countRoundMessages() >= limit) {
      return res.status(403).json({ error: 'quota_messages', limit });
    }
    // One author's share of the STORING tenant (the round owner's): without it
    // a single invited account could post the whole tenant cap and silence the
    // chat for everyone in every round of the owner's — at 20/min, in a day.
    const perAuthor = quota.messagesPerAuthor();
    if (await req.repo.countRoundMessages(req.userId) >= perAuthor) {
      return res.status(403).json({ error: 'quota_messages_author', limit: perAuthor });
    }
  }
  const msg = await req.repo.createRoundMessage(req.params.rid, {
    authorUserId: req.userId, text: body.text, at: new Date().toISOString(),
  });
  if (!msg) return res.status(404).json({ error: 'Round not found' });
  // Deliberately NO markRoundMessagesRead here. Your own message never lights
  // your dot anyway (roundMessageHeads skips the reader's own), and marking on
  // post would also mark read a message someone else posted a moment earlier
  // that this client never displayed. The view marks what it has SHOWN.
  trackEvent('chat_message_posted', { tenantId: req.tenantId });
  const [out] = await withAuthors([msg], req.userId);
  res.status(201).json(out);
});

// Mark the thread read up to `seq`. Listed as an ordinary write in
// lib/round-access.js so every grant role clears it.
router.post('/read', async (req, res) => {
  const body = validateBody(readSchema, req, res);
  if (!body) return;
  // Through req.repo first: the marker table is global and keyed by round id,
  // so this is what proves the caller may reach the round at all
  // (.claude/rules/round-grant-resolver.md §5).
  if (!(await req.repo.getRoundMeta(req.params.rid))) return res.status(404).json({ error: 'Round not found' });
  const lastRead = await repo.markRoundMessagesRead(req.userId, req.params.rid, body.seq);
  res.json({ lastRead });
});

// Only the author edits — a moderator may remove a message, never reword it.
router.patch('/:mid', async (req, res) => {
  const body = validateBody(textSchema, req, res);
  if (!body) return;
  const msg = await req.repo.getRoundMessage(req.params.rid, req.params.mid);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.authorUserId !== req.userId) return res.status(403).json({ error: 'not_author' });
  const updated = await req.repo.updateRoundMessage(req.params.rid, req.params.mid, {
    text: body.text, editedAt: new Date().toISOString(),
  });
  if (!updated) return res.status(404).json({ error: 'Message not found' });
  const [out] = await withAuthors([updated], req.userId);
  res.json(out);
});

// Every message in this round by the author of :mid — the clean-up after a
// flood, so a moderator need not delete thousands one at a time. The role is
// decided by lib/round-access.js ('chat.moderate', co-owner and up), the one
// guard: an owner holds no grant and passes, every lower role is refused there.
// Scoped to THIS round, never the author's messages elsewhere in the tenant.
router.delete('/by-author/:mid', async (req, res) => {
  const msg = await req.repo.getRoundMessage(req.params.rid, req.params.mid);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const removed = await req.repo.deleteRoundMessagesByAuthor(req.params.rid, msg.authorUserId);
  res.json({ removed });
});

// The author, or a role holding 'chat.moderate' (owner + co-owner).
router.delete('/:mid', async (req, res) => {
  const msg = await req.repo.getRoundMessage(req.params.rid, req.params.mid);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.authorUserId !== req.userId && !can(req.roundRole, 'chat.moderate')) {
    return res.status(403).json({ error: 'not_author' });
  }
  await req.repo.deleteRoundMessage(req.params.rid, req.params.mid);
  res.status(204).end();
});

module.exports = router;
