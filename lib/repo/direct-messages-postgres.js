'use strict';

/*
 * Direct messages (#1783) — the Postgres backend's store, spread into
 * lib/repo/postgres.js. The twin of lib/repo/direct-messages-json.js; see its
 * header for why this is a module of its own.
 *
 * Both tables are global and outside RLS (migration
 * 20261124120000_direct_messages.js), so every statement is plain `knex` — no
 * tx(tenant), no atx(). `seq` is a bigserial and comes back as a STRING, so
 * every read goes through Number() (.claude/rules/round-chat.md §2).
 *
 * Built by a factory because it needs the backend's own knex instance and its
 * jsonb helpers; requiring knexfile again here would open a second pool.
 */

module.exports = function makeDirectMessages({ knex, newId, J, mergeData }) {
  const pairOf = (a, b) => (a <= b ? [a, b] : [b, a]);
  const COLS = ['id', 'seq', 'user_lo', 'user_hi', 'author_user_id', 'data'];
  const dmOut = (r) => {
    const out = {
      id: r.id, seq: Number(r.seq), authorUserId: r.author_user_id,
      text: r.data.text, createdAt: r.data.createdAt,
    };
    if (r.data.editedAt) out.editedAt = r.data.editedAt;
    return out;
  };
  const withPair = (r) => ({ ...dmOut(r), participants: [r.user_lo, r.user_hi] });

  async function createDirectMessage({ authorUserId, recipientUserId, text, at }) {
    const [lo, hi] = pairOf(authorUserId, recipientUserId);
    const [row] = await knex('direct_messages')
      .insert({ id: newId(), user_lo: lo, user_hi: hi, author_user_id: authorUserId, data: J({ text, createdAt: at }) })
      .returning(COLS);
    return dmOut(row);
  }

  async function listDirectMessages(a, b, { before = null, limit = 50 } = {}) {
    const [lo, hi] = pairOf(a, b);
    const q = knex('direct_messages').where({ user_lo: lo, user_hi: hi });
    if (before != null) q.andWhere('seq', '<', before);
    // One past the page, newest first, so `hasMore` needs no second count.
    const rows = await q.orderBy('seq', 'desc').limit(limit + 1).select(COLS);
    return { messages: rows.slice(0, limit).reverse().map(dmOut), hasMore: rows.length > limit };
  }

  async function getDirectMessage(mid) {
    const row = await knex('direct_messages').where({ id: mid }).first(COLS);
    return row ? withPair(row) : null;
  }

  async function updateDirectMessage(mid, { text, editedAt }) {
    const rows = await knex('direct_messages').where({ id: mid })
      .update({ data: mergeData({ text, editedAt }) }).returning(COLS);
    return rows.length ? dmOut(rows[0]) : null;
  }

  async function deleteDirectMessage(mid) {
    const rows = await knex('direct_messages').where({ id: mid }).del().returning(COLS);
    return rows.length ? withPair(rows[0]) : null;
  }

  async function countDirectMessages(authorUserId) {
    const [{ n }] = await knex('direct_messages').where({ author_user_id: authorUserId }).count('* as n');
    return Number(n);
  }

  async function listDirectConversations(userId) {
    const rows = await knex.raw(`
SELECT CASE WHEN user_lo = ? THEN user_hi ELSE user_lo END AS other,
       max(seq) AS last_seq,
       (array_agg(data->>'createdAt' ORDER BY seq DESC))[1] AS last_at,
       max(seq) FILTER (WHERE author_user_id <> ?) AS head
  FROM direct_messages
 WHERE user_lo = ? OR user_hi = ?
 GROUP BY 1
 ORDER BY 2 DESC`, [userId, userId, userId, userId]);
    return rows.rows.map((r) => ({
      otherUserId: r.other,
      lastSeq: Number(r.last_seq),
      lastAt: r.last_at,
      head: r.head == null ? null : Number(r.head),
    }));
  }

  async function countUnreadDirectMessages(userId, otherUserId, afterSeq) {
    const [lo, hi] = pairOf(userId, otherUserId);
    const [{ n }] = await knex('direct_messages')
      .where({ user_lo: lo, user_hi: hi })
      .andWhereNot({ author_user_id: userId })
      .andWhere('seq', '>', afterSeq)
      .count('* as n');
    return Number(n);
  }

  async function markDirectMessagesRead(userId, otherUserId, seq) {
    const res = await knex.raw(`
INSERT INTO direct_message_reads (user_id, other_user_id, last_seq) VALUES (?, ?, ?)
ON CONFLICT (user_id, other_user_id)
DO UPDATE SET last_seq = GREATEST(direct_message_reads.last_seq, EXCLUDED.last_seq)
RETURNING last_seq`, [userId, otherUserId, seq]);
    return Number(res.rows[0].last_seq);
  }

  async function getDirectMessageReads(userId) {
    const rows = await knex('direct_message_reads').where({ user_id: userId }).select('other_user_id', 'last_seq');
    const out = {};
    for (const r of rows) out[r.other_user_id] = Number(r.last_seq);
    return out;
  }

  // Erasure: every conversation the account is part of goes WHOLE, plus every
  // marker that is the account's or points at it. Global tables, plain knex.
  async function eraseDirectMessagesOf(uid) {
    await knex('direct_messages').where({ user_lo: uid }).orWhere({ user_hi: uid }).del();
    await knex('direct_message_reads').where({ user_id: uid }).orWhere({ other_user_id: uid }).del();
    // The other side's unread item for the conversation names the erased
    // account, and would lead to a conversation that no longer exists.
    await knex('inbox').whereRaw("data->>'type' = 'chat_unread' AND data->'payload'->>'thread' = ?", [`dm:${uid}`]).del();
  }

  async function exportDirectMessagesOf(uid) {
    const msgs = await knex('direct_messages').where({ author_user_id: uid }).orderBy('seq').select(COLS);
    const reads = await knex('direct_message_reads').where({ user_id: uid })
      .orderBy('other_user_id').select('other_user_id', 'last_seq');
    return {
      directMessages: msgs.map((r) => ({ ...dmOut(r), withUserId: r.user_lo === uid ? r.user_hi : r.user_lo })),
      directMessageReads: reads.map((r) => ({ otherUserId: r.other_user_id, lastSeq: Number(r.last_seq) })),
    };
  }

  return {
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
  };
};
