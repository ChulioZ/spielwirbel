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
 * Session comments (#1782) are the SAME router, mounted a second time at
 * /api/rounds/:rid/sessions/:sid/messages: a thread is either the round's (no
 * :sid) or one session's. Everything else — the people, the cap, the quota,
 * edit/delete, the report link, the inbox — is shared by construction, which
 * is why it is one module and not two. Two asymmetries are deliberate:
 *   - the round thread's GET lists the WHOLE conversation, comments included
 *     (the Chat tab shows them, so its one read marker stays honest), while a
 *     session's GET lists that session's comments only;
 *   - a session view marks read only up to the first unread message it does
 *     NOT show (firstUnreadOutsideSession), since everything at or under the
 *     marker must have been shown somewhere.
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
const { trackEvent, logger } = require('../observability');
const chatInbox = require('../chat-inbox');
const { can } = require('../../public/js/round-roles');
const { CHAT_MESSAGE_MAX, CHAT_PAGE_SIZE, normalizeChatText } = require('../../public/js/round-chat');

const router = express.Router({ mergeParams: true });

// The session a thread belongs to, or null for the round's own (#1782).
const threadSid = (req) => req.params.sid || null;
const notFound = (req) => (threadSid(req) ? 'Session not found' : 'Round not found');

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

// Bring every recipient's inbox item for this thread in line (#1784). Without
// `create` (a deletion) it only lowers or clears items that exist, so it never
// resurrects one a user dismissed. req.tenantId is the STORING tenant here:
// resolveRoundGrant re-scoped it for a grantee.
// The round read sits inside the try too: by now the message write (or delete)
// has happened, and a 500 would tell the client it had not.
async function syncInbox(req, opts = {}) {
  try {
    const round = await req.repo.getRoundMeta(req.params.rid);
    if (round) await chatInbox.syncRoundRecipients(req.repo, req.tenantId, round, opts);
  } catch (err) {
    logger.error({ event: 'chat_inbox_sync_failed', code: err.code || err.name });
  }
}

// A message of THIS thread. On a session's path a message of the round, or of
// another session, is not found; on the round's path every message of the
// round is reachable, comments included, since the Chat tab shows them all.
async function threadMessage(req) {
  const msg = await req.repo.getRoundMessage(req.params.rid, req.params.mid);
  if (!msg) return null;
  const sid = threadSid(req);
  return sid && msg.sessionId !== sid ? null : msg;
}

// How many comments each session carries — the Chronik row's badge (#1782).
// The round's path only; a session's own thread already holds its count.
router.get('/session-counts', async (req, res) => {
  if (threadSid(req)) return res.status(404).json({ error: 'Not found' });
  if (!(await req.repo.getRoundMeta(req.params.rid))) return res.status(404).json({ error: 'Round not found' });
  res.json({ counts: await req.repo.countSessionMessages(req.params.rid) });
});

router.get('/', async (req, res) => {
  const raw = req.query.before;
  const before = raw == null ? null : Number(raw);
  if (before != null && !(Number.isInteger(before) && before > 0 && before <= SEQ_MAX)) {
    return res.status(400).json({ error: 'Invalid cursor' });
  }
  const page = await req.repo.listRoundMessages(req.params.rid, {
    before, limit: CHAT_PAGE_SIZE, sessionId: threadSid(req),
  });
  if (!page) return res.status(404).json({ error: notFound(req) });
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
    authorUserId: req.userId, text: body.text, at: new Date().toISOString(), sessionId: threadSid(req),
  });
  if (!msg) return res.status(404).json({ error: notFound(req) });
  // Deliberately NO markRoundMessagesRead here. Your own message never lights
  // your dot anyway (roundMessageHeads skips the reader's own), and marking on
  // post would also mark read a message someone else posted a moment earlier
  // that this client never displayed. The view marks what it has SHOWN.
  trackEvent(threadSid(req) ? 'session_comment_posted' : 'chat_message_posted', { tenantId: req.tenantId });
  // #1784: one collapsed inbox item per OTHER account that can reach the round.
  // Awaited so a spec reads a settled inbox, but it never throws (the message
  // is already stored) — see lib/chat-inbox.js.
  await syncInbox(req, { except: req.userId, create: true });
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
  let seq = body.seq;
  const sid = threadSid(req);
  if (sid) {
    if (!(await req.repo.getSession(req.params.rid, sid))) return res.status(404).json({ error: 'Session not found' });
    // The round has ONE marker, and this view shows one session's comments:
    // stop just below the oldest unread message it did not show, or that
    // message would read as seen without ever having been on a screen.
    const reads = await repo.getRoundMessageReads(req.userId);
    const first = await req.repo.firstUnreadOutsideSession(
      req.params.rid, req.userId, reads[req.params.rid] || 0, sid);
    if (first != null) seq = Math.min(seq, first - 1);
  }
  const lastRead = await repo.markRoundMessagesRead(req.userId, req.params.rid, seq);
  // Opening the thread clears its inbox item — or lowers its count, when a
  // message arrived after the one the view last showed.
  try {
    const round = await req.repo.getRoundMeta(req.params.rid);
    if (round) await chatInbox.syncRoundThread(req.repo, round, req.userId);
  } catch (err) {
    logger.error({ event: 'chat_inbox_sync_failed', code: err.code || err.name });
  }
  res.json({ lastRead });
});

// Only the author edits — a moderator may remove a message, never reword it.
router.patch('/:mid', async (req, res) => {
  const body = validateBody(textSchema, req, res);
  if (!body) return;
  const msg = await threadMessage(req);
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
  // Round-wide by definition, so only on the round's own path — on a
  // session's it would read as "this session only" and do more.
  if (threadSid(req)) return res.status(404).json({ error: 'Not found' });
  const msg = await req.repo.getRoundMessage(req.params.rid, req.params.mid);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const removed = await req.repo.deleteRoundMessagesByAuthor(req.params.rid, msg.authorUserId);
  await syncInbox(req);
  res.json({ removed });
});

// The author, or a role holding 'chat.moderate' (owner + co-owner).
router.delete('/:mid', async (req, res) => {
  const msg = await threadMessage(req);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.authorUserId !== req.userId && !can(req.roundRole, 'chat.moderate')) {
    return res.status(403).json({ error: 'not_author' });
  }
  await req.repo.deleteRoundMessage(req.params.rid, req.params.mid);
  await syncInbox(req);
  res.status(204).end();
});

module.exports = router;
