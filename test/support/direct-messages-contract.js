'use strict';

/*
 * The direct-message store (#1783) as a backend-parameterized contract, like
 * repo-contract.js (which it sits beside rather than inside: that file is the
 * round data's, and this store touches no round). test/repo.test.js runs it on
 * the JSON backend, test/repo.postgres.test.js on PostgreSQL.
 *
 * Every case mints its own account ids, so the absolute counts it asserts do
 * not depend on what another case (or another file sharing the store) wrote.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

module.exports = function directMessagesContract(repo) {
  const uniq = () => crypto.randomBytes(6).toString('hex');
  const at = (n) => `2026-11-24T10:00:${String(n).padStart(2, '0')}.000Z`;

  async function account() {
    const u = uniq();
    const user = await repo.createUser({
      email: `${u}@example.com`, username: `dm${u}`, createdAt: at(0), tenantId: `t-${u}`,
      emailVerified: true, identities: [], verification: null, reset: null, refreshTokens: [],
    });
    return user.id;
  }

  test('direct messages: one conversation per pair, paged oldest first, seq never reused', async () => {
    const a = `dm-a-${uniq()}`;
    const b = `dm-b-${uniq()}`;
    const c = `dm-c-${uniq()}`;
    // The other pair FIRST, so m2 below is the store's newest message when it
    // is deleted — the only arrangement in which a seq derived from the row
    // count would hand m2's seq to m3 (measured: the other order stayed green).
    await repo.createDirectMessage({ authorUserId: a, recipientUserId: c, text: 'other pair', at: at(3) });
    const m1 = await repo.createDirectMessage({ authorUserId: a, recipientUserId: b, text: 'hallo', at: at(1) });
    const m2 = await repo.createDirectMessage({ authorUserId: b, recipientUserId: a, text: 'hi', at: at(2) });
    assert.equal(typeof m1.seq, 'number');
    assert.ok(m2.seq > m1.seq);
    assert.deepEqual(Object.keys(m1).sort(), ['authorUserId', 'createdAt', 'id', 'seq', 'text']);

    // The same conversation whichever side asks — the canonical pair.
    const fromA = await repo.listDirectMessages(a, b);
    const fromB = await repo.listDirectMessages(b, a);
    assert.deepEqual(fromA.messages.map((m) => m.text), ['hallo', 'hi']);
    assert.deepEqual(fromB, fromA);
    assert.equal(fromA.hasMore, false);

    // Paging backwards: one per page, `hasMore` on the first.
    const newest = await repo.listDirectMessages(a, b, { limit: 1 });
    assert.deepEqual(newest.messages.map((m) => m.text), ['hi']);
    assert.equal(newest.hasMore, true);
    const older = await repo.listDirectMessages(a, b, { limit: 1, before: newest.messages[0].seq });
    assert.deepEqual(older.messages.map((m) => m.text), ['hallo']);
    assert.equal(older.hasMore, false);

    // Deleting the newest must not hand its seq to the next message: a marker
    // already at that value would read the fresh one as seen.
    const gone = await repo.deleteDirectMessage(m2.id);
    assert.deepEqual([...gone.participants].sort(), [a, b].sort());
    const m3 = await repo.createDirectMessage({ authorUserId: b, recipientUserId: a, text: 'again', at: at(4) });
    assert.ok(m3.seq > m2.seq, 'a deleted seq was reused');
    assert.equal(await repo.deleteDirectMessage(m2.id), null);
  });

  test('direct messages: get/update return the pair and the edit stamp; count is per author', async () => {
    const a = `dm-a-${uniq()}`;
    const b = `dm-b-${uniq()}`;
    const m = await repo.createDirectMessage({ authorUserId: a, recipientUserId: b, text: 'tippfeler', at: at(1) });
    const got = await repo.getDirectMessage(m.id);
    assert.deepEqual([...got.participants].sort(), [a, b].sort());
    assert.equal('editedAt' in got, false, 'absent until edited, on both backends');
    const up = await repo.updateDirectMessage(m.id, { text: 'Tippfehler', editedAt: at(5) });
    assert.equal(up.text, 'Tippfehler');
    assert.equal(up.editedAt, at(5));
    assert.equal(await repo.updateDirectMessage('nope', { text: 'x', editedAt: at(5) }), null);
    assert.equal(await repo.getDirectMessage('nope'), null);

    await repo.createDirectMessage({ authorUserId: b, recipientUserId: a, text: 'x', at: at(2) });
    const n = await repo.countDirectMessages(a);
    assert.equal(typeof n, 'number');
    assert.equal(n, 1);
  });

  test('direct messages: conversations, unread heads and markers agree', async () => {
    const me = `dm-me-${uniq()}`;
    const ana = `dm-ana-${uniq()}`;
    const ben = `dm-ben-${uniq()}`;
    await repo.createDirectMessage({ authorUserId: me, recipientUserId: ana, text: '1', at: at(1) });
    const fromAna = await repo.createDirectMessage({ authorUserId: ana, recipientUserId: me, text: '2', at: at(2) });
    const own = await repo.createDirectMessage({ authorUserId: me, recipientUserId: ana, text: '3', at: at(3) });
    const toBen = await repo.createDirectMessage({ authorUserId: me, recipientUserId: ben, text: '4', at: at(4) });

    const convs = await repo.listDirectConversations(me);
    // Newest conversation first.
    assert.deepEqual(convs.map((c) => c.otherUserId), [ben, ana]);
    const byOther = Object.fromEntries(convs.map((c) => [c.otherUserId, c]));
    // `head` is the newest seq the OTHER party wrote — my own message after it
    // must not move it, and a conversation only I wrote in has none.
    assert.equal(byOther[ana].head, fromAna.seq);
    assert.equal(byOther[ana].lastSeq, own.seq);
    assert.equal(byOther[ana].lastAt, at(3));
    assert.equal(byOther[ben].head, null);
    assert.equal(byOther[ben].lastSeq, toBen.seq);

    assert.equal(await repo.countUnreadDirectMessages(me, ana, 0), 1);
    assert.equal(await repo.countUnreadDirectMessages(ana, me, 0), 2);

    // The marker only ever rises.
    assert.equal(await repo.markDirectMessagesRead(me, ana, fromAna.seq), fromAna.seq);
    assert.equal(await repo.markDirectMessagesRead(me, ana, 1), fromAna.seq);
    assert.deepEqual(await repo.getDirectMessageReads(me), { [ana]: fromAna.seq });
    assert.equal(await repo.countUnreadDirectMessages(me, ana, fromAna.seq), 0);
  });

  test('direct messages: erasure takes every conversation whole, and export returns what was written', async () => {
    const gone = await account();
    const stays = await account();
    const bystander = await account();
    await repo.createDirectMessage({ authorUserId: gone, recipientUserId: stays, text: 'von mir', at: at(1) });
    const reply = await repo.createDirectMessage({ authorUserId: stays, recipientUserId: gone, text: 'von dir', at: at(2) });
    await repo.createDirectMessage({ authorUserId: stays, recipientUserId: bystander, text: 'anderswo', at: at(3) });
    await repo.markDirectMessagesRead(gone, stays, reply.seq);
    await repo.markDirectMessagesRead(stays, gone, reply.seq);
    await repo.putChatInboxItem(stays, `dm:${gone}`, { otherUserId: gone, username: 'x', count: 1 });
    await repo.putChatInboxItem(stays, `dm:${bystander}`, { otherUserId: bystander, username: 'y', count: 1 });

    const exported = await repo.exportAccountData(gone);
    assert.deepEqual(exported.directMessages.map((m) => [m.text, m.withUserId]), [['von mir', stays]]);
    assert.deepEqual(exported.directMessageReads, [{ otherUserId: stays, lastSeq: reply.seq }]);

    await repo.eraseAccount(gone);
    // Both sides' messages go (operator decision, #1783) …
    assert.deepEqual((await repo.listDirectMessages(stays, gone)).messages, []);
    assert.equal(await repo.getDirectMessage(reply.id), null);
    // … and so does every marker touching the account, and the other side's
    // inbox item for the conversation. Nothing else is touched.
    assert.deepEqual(await repo.getDirectMessageReads(stays), {});
    const inbox = (await repo.listInbox(stays)).map((it) => it.payload && it.payload.thread);
    assert.deepEqual(inbox, [`dm:${bystander}`]);
    assert.deepEqual((await repo.listDirectMessages(stays, bystander)).messages.map((m) => m.text), ['anderswo']);
  });

  test('direct-message figures: demo pairs never count, ADMIN_EXCLUDE_TENANTS removes them, silence is no share', async () => {
    const make = async (tenant) => {
      const u = uniq();
      return (await repo.createUser({
        email: `${u}@example.com`, username: `dmm${u}`, createdAt: at(0), tenantId: tenant,
        emailVerified: true, identities: [], verification: null, reset: null, refreshTokens: [],
      })).id;
    };
    const friends = async (x, y) => {
      const f = await repo.createFriendRequest({ requesterUserId: x, addresseeUserId: y });
      await repo.acceptFriendRequest(f.id, y);
    };
    const exTenant = `ex-${uniq()}`;
    const mid = await repo.instanceMetrics();
    const a = await make(`t-${uniq()}`);
    const b = await make(`t-${uniq()}`);
    const silent = await make(`t-${uniq()}`);
    const tourist = await make(`demo-${uniq()}`);
    const hidden = await make(exTenant);
    for (const y of [b, silent, tourist, hidden]) await friends(a, y);
    const now = new Date().toISOString();
    await repo.createDirectMessage({ authorUserId: a, recipientUserId: b, text: '1', at: now });
    await repo.createDirectMessage({ authorUserId: b, recipientUserId: a, text: '2', at: now });
    await repo.createDirectMessage({ authorUserId: a, recipientUserId: tourist, text: '3', at: now });
    await repo.createDirectMessage({ authorUserId: hidden, recipientUserId: a, text: '4', at: now });
    // Outside the window: counts for the share, not for the week.
    await repo.createDirectMessage({ authorUserId: a, recipientUserId: silent, text: 'old', at: '2020-01-01T00:00:00.000Z' });

    const m = await repo.instanceMetrics();
    assert.equal(typeof m.social.friendshipsWithMessages, 'number');
    assert.equal(m.social.friendshipsWithMessages - mid.social.friendshipsWithMessages, 3,
      'b, the old message and the excluded pair — never the demo pair');
    assert.equal(m.adoption.lastWeek.directMessages - mid.adoption.lastWeek.directMessages, 3,
      'two between a and b, one from the excluded account — the demo message and the old one never');

    process.env.ADMIN_EXCLUDE_TENANTS = exTenant;
    let ex;
    try {
      ex = await repo.instanceMetrics();
    } finally {
      delete process.env.ADMIN_EXCLUDE_TENANTS;
    }
    assert.equal(m.social.friendshipsWithMessages - ex.social.friendshipsWithMessages, 1);
    assert.equal(m.adoption.lastWeek.directMessages - ex.adoption.lastWeek.directMessages, 1);
  });
};
