'use strict';

/*
 * Web push subscriptions and per-thread mutes (#1785) — the JSON backend's
 * store, spread into lib/repo/json.js. Its own module for the direct messages'
 * reason (lib/repo/direct-messages-json.js): a global, account-keyed store that
 * reads no round data, and json.js sits at its size budget. Its twin is
 * lib/repo/push-subscriptions-postgres.js; test/support/push-contract.js holds
 * the two to one answer.
 *
 * The endpoint is unique across accounts (see the migration): putting one that
 * another account holds MOVES it, because the device now belongs to whoever
 * signed in last.
 */

const { data, saveData, id } = require('../store');

const ensure = () => {
  if (!Array.isArray(data.pushSubscriptions)) data.pushSubscriptions = [];
  if (!Array.isArray(data.pushMutes)) data.pushMutes = [];
};

const subOut = (s) => ({ endpoint: s.endpoint, keys: { ...s.keys }, locale: s.locale, createdAt: s.createdAt });

async function putPushSubscription(userId, { endpoint, keys, locale, createdAt }) {
  ensure();
  const row = data.pushSubscriptions.find((s) => s.endpoint === endpoint);
  if (row) Object.assign(row, { userId, keys: { ...keys }, locale, createdAt });
  else data.pushSubscriptions.push({ id: id(), userId, endpoint, keys: { ...keys }, locale, createdAt });
  saveData();
  return subOut(row || data.pushSubscriptions[data.pushSubscriptions.length - 1]);
}

async function listPushSubscriptions(userId) {
  ensure();
  return data.pushSubscriptions.filter((s) => s.userId === userId).map(subOut);
}

// The caller's own device only: an endpoint another account holds is left alone.
async function deletePushSubscription(userId, endpoint) {
  ensure();
  const idx = data.pushSubscriptions.findIndex((s) => s.userId === userId && s.endpoint === endpoint);
  if (idx === -1) return false;
  data.pushSubscriptions.splice(idx, 1);
  saveData();
  return true;
}

// A subscription the push service answered 404/410 for — gone for whoever held it.
async function deleteDeadPushSubscription(endpoint) {
  ensure();
  const idx = data.pushSubscriptions.findIndex((s) => s.endpoint === endpoint);
  if (idx === -1) return false;
  data.pushSubscriptions.splice(idx, 1);
  saveData();
  return true;
}

async function listPushMutes(userId) {
  ensure();
  return data.pushMutes.filter((m) => m.userId === userId).map((m) => m.thread).sort();
}

async function setPushMute(userId, thread, muted) {
  ensure();
  const idx = data.pushMutes.findIndex((m) => m.userId === userId && m.thread === thread);
  if (muted && idx === -1) { data.pushMutes.push({ userId, thread }); saveData(); }
  if (!muted && idx !== -1) { data.pushMutes.splice(idx, 1); saveData(); }
  return muted;
}

// Erasure: every device and every mute of the account. Called from eraseAccount,
// which saves once at the end.
function erasePushOf(uid) {
  ensure();
  data.pushSubscriptions = data.pushSubscriptions.filter((s) => s.userId !== uid);
  data.pushMutes = data.pushMutes.filter((m) => m.userId !== uid);
}

/* The Art. 15/20 export. A device is reported by its push SERVICE's origin and
   when it subscribed — never the full endpoint or the keys: together those are a
   capability to push to the device, worthless to the account holder and harmful
   in a file that gets mailed around. */
function exportPushOf(uid) {
  ensure();
  return {
    pushSubscriptions: data.pushSubscriptions.filter((s) => s.userId === uid)
      .map((s) => ({ service: endpointOrigin(s.endpoint), locale: s.locale, createdAt: s.createdAt }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    pushMutes: data.pushMutes.filter((m) => m.userId === uid).map((m) => m.thread).sort(),
  };
}

function endpointOrigin(endpoint) {
  try { return new URL(endpoint).origin; } catch { return null; }
}

// The rows instanceMetrics counts from (the caller applies the exclusions).
function pushSubscriptionRows() {
  ensure();
  return data.pushSubscriptions;
}

module.exports = {
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
  endpointOrigin,
  pushSubscriptionRows,
};
