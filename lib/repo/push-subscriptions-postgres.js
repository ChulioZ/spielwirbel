'use strict';

/*
 * Web push subscriptions and per-thread mutes (#1785) — the Postgres backend's
 * store, spread into lib/repo/postgres.js. The twin of
 * lib/repo/push-subscriptions-json.js; see its header.
 *
 * Both tables are global and outside RLS (migration
 * 20261126120000_push_subscriptions.js), so every statement is plain `knex`.
 * Built by a factory for the direct messages' reason: it needs the backend's
 * own knex instance rather than a second pool.
 */

const { endpointOrigin } = require('./push-subscriptions-json');

module.exports = function makePushSubscriptions({ knex, newId, J }) {
  const subOut = (r) => ({
    endpoint: r.endpoint, keys: { ...r.data.keys }, locale: r.data.locale, createdAt: r.data.createdAt,
  });

  async function putPushSubscription(userId, { endpoint, keys, locale, createdAt }) {
    // ON CONFLICT on the unique endpoint MOVES a device another account held.
    const [row] = await knex.raw(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, data) VALUES (?, ?, ?, ?::jsonb)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data
      RETURNING endpoint, data`, [newId(), userId, endpoint, J({ keys, locale, createdAt })])
      .then((r) => r.rows);
    return subOut(row);
  }

  async function listPushSubscriptions(userId) {
    const rows = await knex('push_subscriptions').where({ user_id: userId }).orderBy('id').select('endpoint', 'data');
    return rows.map(subOut);
  }

  async function deletePushSubscription(userId, endpoint) {
    return (await knex('push_subscriptions').where({ user_id: userId, endpoint }).del()) > 0;
  }

  async function deleteDeadPushSubscription(endpoint) {
    return (await knex('push_subscriptions').where({ endpoint }).del()) > 0;
  }

  async function listPushMutes(userId) {
    const rows = await knex('push_mutes').where({ user_id: userId }).orderBy('thread').select('thread');
    return rows.map((r) => r.thread);
  }

  async function setPushMute(userId, thread, muted) {
    if (muted) {
      await knex('push_mutes').insert({ user_id: userId, thread }).onConflict(['user_id', 'thread']).ignore();
    } else {
      await knex('push_mutes').where({ user_id: userId, thread }).del();
    }
    return muted;
  }

  async function erasePushOf(uid) {
    await knex('push_subscriptions').where({ user_id: uid }).del();
    await knex('push_mutes').where({ user_id: uid }).del();
  }

  // The JSON twin's export, for its reason: the service's origin, never the
  // endpoint or the keys.
  async function exportPushOf(uid) {
    const subs = await knex('push_subscriptions').where({ user_id: uid }).select('endpoint', 'data');
    return {
      pushSubscriptions: subs
        .map((r) => ({ service: endpointOrigin(r.endpoint), locale: r.data.locale, createdAt: r.data.createdAt }))
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
      pushMutes: await listPushMutes(uid),
    };
  }

  return {
    api: {
      putPushSubscription,
      listPushSubscriptions,
      deletePushSubscription,
      deleteDeadPushSubscription,
      listPushMutes,
      setPushMute,
    },
    erasePushOf,
    exportPushOf,
  };
};
