'use strict';

/*
 * Direct messages (#1783) — the JSON backend's store, spread into lib/repo/json.js.
 *
 * Its own module because the conversation is a store of its own: global, keyed
 * by an ACCOUNT pair, touching no round and no tenant — so nothing in the
 * round-data code it would sit among in json.js reads it, and that file was
 * already at its size budget (test/token-budget.test.js). lib/repo/
 * direct-messages-postgres.js is its twin; test/support/repo-contract.js holds
 * the two to one answer.
 *
 * `data.directMessageSeq` is a persistent counter, NOT derived from the array —
 * the round chat's reason (.claude/rules/round-chat.md §2): deleting the newest
 * message would otherwise hand its seq to the next one, and a reader whose
 * marker already sat at that value would see a fresh message as read.
 */

const { data, saveData, id } = require('../store');

const ensure = () => {
  if (!Array.isArray(data.directMessages)) data.directMessages = [];
  if (!Array.isArray(data.directMessageReads)) data.directMessageReads = [];
  if (typeof data.directMessageSeq !== 'number') data.directMessageSeq = 0;
};

// The canonical pair, the friendships convention: one key whichever side asks.
const pairOf = (a, b) => (a <= b ? [a, b] : [b, a]);
const inPair = (m, a, b) => {
  const [lo, hi] = pairOf(a, b);
  return m.userLo === lo && m.userHi === hi;
};
const otherOf = (m, me) => (m.userLo === me ? m.userHi : m.userLo);

// The stored row minus its pair — the shape both backends return.
const dmOut = (m) => {
  const out = { id: m.id, seq: m.seq, authorUserId: m.authorUserId, text: m.text, createdAt: m.createdAt };
  if (m.editedAt) out.editedAt = m.editedAt;
  return out;
};

async function createDirectMessage({ authorUserId, recipientUserId, text, at }) {
  ensure();
  const [userLo, userHi] = pairOf(authorUserId, recipientUserId);
  data.directMessageSeq += 1;
  const row = { id: id(), userLo, userHi, authorUserId, text, createdAt: at, seq: data.directMessageSeq };
  data.directMessages.push(row);
  saveData();
  return dmOut(row);
}

// A page of one conversation, oldest first; `before` (a seq) pages backwards.
async function listDirectMessages(a, b, { before = null, limit = 50 } = {}) {
  ensure();
  const thread = data.directMessages.filter((m) => inPair(m, a, b) && (before == null || m.seq < before))
    .sort((x, y) => x.seq - y.seq);
  const page = thread.slice(-limit);
  return { messages: page.map(dmOut), hasMore: thread.length > page.length };
}

// One message by id, with the two accounts it is between — the route checks
// the caller is one of them, the operator lookup names both.
async function getDirectMessage(mid) {
  ensure();
  const m = data.directMessages.find((x) => x.id === mid);
  return m ? { ...dmOut(m), participants: [m.userLo, m.userHi] } : null;
}

async function updateDirectMessage(mid, { text, editedAt }) {
  ensure();
  const m = data.directMessages.find((x) => x.id === mid);
  if (!m) return null;
  m.text = text;
  m.editedAt = editedAt;
  saveData();
  return dmOut(m);
}

async function deleteDirectMessage(mid) {
  ensure();
  const idx = data.directMessages.findIndex((x) => x.id === mid);
  if (idx === -1) return null;
  const [removed] = data.directMessages.splice(idx, 1);
  saveData();
  return { ...dmOut(removed), participants: [removed.userLo, removed.userHi] };
}

// How many messages one account has written, in every conversation — the
// per-account quota.
async function countDirectMessages(authorUserId) {
  ensure();
  return data.directMessages.filter((m) => m.authorUserId === authorUserId).length;
}

// Every conversation the account has a message in, newest first: the other
// party, the newest seq and its time, and `head` — the newest seq the OTHER
// party wrote (null when only the caller has written), which is what the
// unread dot compares against the read marker.
async function listDirectConversations(userId) {
  ensure();
  const byOther = new Map();
  for (const m of data.directMessages) {
    if (m.userLo !== userId && m.userHi !== userId) continue;
    const other = otherOf(m, userId);
    const c = byOther.get(other) || { otherUserId: other, lastSeq: 0, lastAt: null, head: null };
    if (m.seq > c.lastSeq) { c.lastSeq = m.seq; c.lastAt = m.createdAt; }
    if (m.authorUserId !== userId && (c.head == null || m.seq > c.head)) c.head = m.seq;
    byOther.set(other, c);
  }
  return [...byOther.values()].sort((x, y) => y.lastSeq - x.lastSeq);
}

// Messages the other party wrote past `afterSeq` — the inbox item's count,
// the same filter as `head` above so the two cannot disagree.
async function countUnreadDirectMessages(userId, otherUserId, afterSeq) {
  ensure();
  return data.directMessages.filter((m) => inPair(m, userId, otherUserId)
    && m.authorUserId !== userId && m.seq > afterSeq).length;
}

// Raise the reader's marker; never lowers it. Returns the stored value.
async function markDirectMessagesRead(userId, otherUserId, seq) {
  ensure();
  const row = data.directMessageReads.find((r) => r.userId === userId && r.otherUserId === otherUserId);
  if (row) {
    if (seq > row.lastSeq) { row.lastSeq = seq; saveData(); }
    return row.lastSeq;
  }
  data.directMessageReads.push({ userId, otherUserId, lastSeq: seq });
  saveData();
  return seq;
}

async function getDirectMessageReads(userId) {
  ensure();
  const out = {};
  for (const r of data.directMessageReads) if (r.userId === userId) out[r.otherUserId] = r.lastSeq;
  return out;
}

// Erasure (#1783, operator decision): every conversation the account is part
// of goes WHOLE — both sides' messages — together with every read marker that
// is the account's or points at it. Called from eraseAccount; saves nothing
// itself, since that caller saves once at the end.
function eraseDirectMessagesOf(uid) {
  ensure();
  for (let i = data.directMessages.length - 1; i >= 0; i -= 1) {
    const m = data.directMessages[i];
    if (m.userLo === uid || m.userHi === uid) data.directMessages.splice(i, 1);
  }
  for (let i = data.directMessageReads.length - 1; i >= 0; i -= 1) {
    const r = data.directMessageReads[i];
    if (r.userId === uid || r.otherUserId === uid) data.directMessageReads.splice(i, 1);
  }
  // The other side's unread item for the conversation names the erased
  // account, and would lead to a conversation that no longer exists.
  for (let i = data.inbox.length - 1; i >= 0; i -= 1) {
    const it = data.inbox[i];
    if (it.type === 'chat_unread' && it.payload && it.payload.thread === `dm:${uid}`) data.inbox.splice(i, 1);
  }
}

// The Art. 15/20 export: what the account wrote (with whom) and its markers.
function exportDirectMessagesOf(uid) {
  ensure();
  return {
    directMessages: data.directMessages
      .filter((m) => m.authorUserId === uid)
      .sort((x, y) => x.seq - y.seq)
      .map((m) => ({ ...dmOut(m), withUserId: otherOf(m, uid) })),
    directMessageReads: data.directMessageReads
      .filter((r) => r.userId === uid)
      .map((r) => ({ otherUserId: r.otherUserId, lastSeq: r.lastSeq }))
      .sort((a, b) => (a.otherUserId < b.otherUserId ? -1 : a.otherUserId > b.otherUserId ? 1 : 0)),
  };
}

// The rows instanceMetrics counts from (the caller applies the exclusions).
function directMessageRows() {
  ensure();
  return data.directMessages;
}

module.exports = {
  api: {
    createDirectMessage,
    listDirectMessages,
    getDirectMessage,
    updateDirectMessage,
    deleteDirectMessage,
    countDirectMessages,
    listDirectConversations,
    countUnreadDirectMessages,
    markDirectMessagesRead,
    getDirectMessageReads,
  },
  eraseDirectMessagesOf,
  exportDirectMessagesOf,
  directMessageRows,
};
