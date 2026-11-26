'use strict';

/*
 * Web push for chat messages (issue #1785).
 *
 * Both tables belong to an ACCOUNT, never a tenant, so — like `friendships`,
 * `price_watches` and `direct_messages` — they are global and NOT under RLS.
 * They are absent from TENANT_METHODS and reached only from lib/routes/push.js
 * (scoped to the authenticated caller) and lib/push.js (the sender). The admin
 * adoption figure reads them with plain knex for the same reason.
 *
 * `push_subscriptions` — one row per DEVICE (browser profile): the push
 * service's endpoint and the two keys the payload is encrypted to. The endpoint
 * is UNIQUE rather than keyed by (account, endpoint): a device that signs into a
 * second account re-subscribes with the same endpoint, and must stop receiving
 * the first account's pushes the moment it does. The endpoint is a capability
 * URL — anyone holding it plus the keys can push to that device — so it is never
 * logged and the export carries only its origin.
 *
 * `push_mutes` — one row per (account, thread key) the account has muted:
 * `round:<rid>`, `session:<sid>` or `dm:<account id>`, the chat inbox's keys.
 * No content.
 */

exports.up = async (knex) => {
  await knex.raw(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS push_mutes (
  user_id text NOT NULL,
  thread text NOT NULL,
  PRIMARY KEY (user_id, thread)
);
`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS push_mutes');
  await knex.raw('DROP TABLE IF EXISTS push_subscriptions');
};
