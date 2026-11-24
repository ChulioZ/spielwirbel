'use strict';

/*
 * Unread chat threads in the in-app inbox (issue #1784).
 *
 * One `chat_unread` item per (account, thread), stating the thread's name and how
 * many messages someone else wrote since the account last read it — collapsed, so
 * a busy thread is one item rather than fifty. The count is never stored as a
 * running tally: every write RECOMPUTES it from the message store and the read
 * marker (countUnreadRoundMessages, the unread dot's own filter), so the item, the
 * dot and the thread can never disagree, and a missed update self-corrects on the
 * next one.
 *
 * A thread is named by a key (`round:<rid>`, or `dm:<account id>` for a direct
 * conversation since #1783) rather than a round id, so one item kind, one repo
 * pair and one client renderer serve both.
 *
 * What it must never do, each asserted in test/chat-inbox.test.js:
 *  - carry a message's TEXT — the payload is the key, the round's id and name and
 *    a count (`.claude/rules/product-event-logging.md`'s promise, one store over);
 *  - mail anyone. lib/notify.js's NOTIFIABLE allowlist does not name this type,
 *    and nothing here calls it: chat is not an actionable item, and the shared
 *    mail budget exists to keep verification mail flowing;
 *  - resurrect an item the user dismissed. Only a NEW message creates one; a read
 *    or a deletion only rewrites or removes an item that is already there.
 */

const repo = require('./repo');
const { logger } = require('./observability');

const roundThread = (rid) => `round:${rid}`;

// Everyone who can reach the round: the account its tenant belongs to (the
// owner, who holds no grant) and every grantee. Grants are global and keyed by
// round id, so this reads no other tenant's data.
async function roundRecipients(ownerTenant, rid) {
  const ids = new Set();
  const owner = await repo.getUserByTenant(ownerTenant);
  if (owner) ids.add(owner.id);
  for (const g of await repo.listGrantsForRound(rid)) ids.add(g.userId);
  return [...ids];
}

/*
 * Bring one account's item for one round thread in line with the store.
 * `scoped` is the STORING tenant's repo (req.repo after resolveRoundGrant).
 * `create` is true only on a new message, and only an account that has not
 * switched the items off (notifyChatInbox, default on) gets a new one; turning
 * it off stops new items but still lets an existing one clear.
 */
async function syncRoundThread(scoped, round, userId, { create = false } = {}) {
  const thread = roundThread(round.id);
  const reads = await repo.getRoundMessageReads(userId);
  const count = await scoped.countUnreadRoundMessages(round.id, userId, reads[round.id] || 0);
  if (!count) return repo.removeChatInboxItem(userId, thread);
  let mayCreate = create;
  if (mayCreate) {
    const user = await repo.getUserById(userId);
    mayCreate = !!user && user.notifyChatInbox !== false;
  }
  return repo.putChatInboxItem(userId, thread,
    { roundId: round.id, roundName: round.name || '', count }, { create: mayCreate });
}

// Every recipient of a round thread, except `except` (a message's author never
// gets an item for their own message). Never throws: the message is already
// stored when this runs, so a failure here must not turn the post into a 500 —
// it is logged (code only; no field of a chat row is ever in a log line) and the
// next write to the thread repairs the item.
async function syncRoundRecipients(scoped, ownerTenant, round, { except = null, create = false } = {}) {
  try {
    for (const uid of await roundRecipients(ownerTenant, round.id)) {
      if (uid !== except) await syncRoundThread(scoped, round, uid, { create });
    }
  } catch (err) {
    logger.error({ event: 'chat_inbox_sync_failed', code: err.code || err.name });
  }
}

// Clear the round's item for each account in `userIds` — a deleted round, or a
// revoked/left share, where the thread is no longer reachable at all.
async function clearRoundThread(rid, userIds) {
  for (const uid of userIds) await repo.removeChatInboxItem(uid, roundThread(rid));
}

/*
 * Direct conversations (#1783) take the key `dm:<other account id>` — one item
 * per (reader, other party), named after the OTHER party's current username so a
 * rename shows everywhere at once. Same three promises as a round thread: the
 * count is recomputed from the store and the marker, only a new message may
 * create, and nothing here mails anyone.
 */
const dmThread = (otherUserId) => `dm:${otherUserId}`;

async function syncDirectThread(userId, otherUserId, { create = false } = {}) {
  const thread = dmThread(otherUserId);
  const reads = await repo.getDirectMessageReads(userId);
  const count = await repo.countUnreadDirectMessages(userId, otherUserId, reads[otherUserId] || 0);
  if (!count) return repo.removeChatInboxItem(userId, thread);
  let mayCreate = create;
  if (mayCreate) {
    const user = await repo.getUserById(userId);
    mayCreate = !!user && user.notifyChatInbox !== false;
  }
  const other = await repo.getUserById(otherUserId);
  return repo.putChatInboxItem(userId, thread,
    { otherUserId, username: (other && other.username) || '', count }, { create: mayCreate });
}

// Never throws, for the round helper's reason: the message is already stored.
async function syncDirectThreadSafe(userId, otherUserId, opts) {
  try {
    await syncDirectThread(userId, otherUserId, opts);
  } catch (err) {
    logger.error({ event: 'chat_inbox_sync_failed', code: err.code || err.name });
  }
}

module.exports = {
  roundThread, roundRecipients, syncRoundThread, syncRoundRecipients, clearRoundThread,
  dmThread, syncDirectThread, syncDirectThreadSafe,
};
