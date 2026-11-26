'use strict';

/*
 * The web-push store (#1785) as a backend-parameterized contract, beside
 * direct-messages-contract.js for the same reason: a global, account-keyed store
 * that touches no round. test/repo.test.js runs it on the JSON backend,
 * test/repo.postgres.test.js on PostgreSQL.
 *
 * Every case mints its own account ids and endpoints, so the counts it asserts
 * do not depend on what another case wrote.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

module.exports = function pushContract(repo) {
  const uniq = () => crypto.randomBytes(6).toString('hex');
  const at = '2026-11-26T10:00:00.000Z';
  const keys = { p256dh: 'BPp256dhcontractkey0000', auth: 'authcontract' };
  const endpoint = () => `https://fcm.googleapis.com/fcm/send/${uniq()}`;

  async function account(tenant = `t-${uniq()}`) {
    const u = uniq();
    const user = await repo.createUser({
      email: `${u}@example.com`, username: `pu${u}`, createdAt: at, tenantId: tenant,
      emailVerified: true, identities: [], verification: null, reset: null, refreshTokens: [],
    });
    return user.id;
  }

  test('push: a device is stored per endpoint, re-putting updates it, another account MOVES it', async () => {
    const a = await account();
    const b = await account();
    const ep = endpoint();
    await repo.putPushSubscription(a, { endpoint: ep, keys, locale: 'de', createdAt: at });
    await repo.putPushSubscription(a, { endpoint: ep, keys, locale: 'fr', createdAt: at });
    assert.deepEqual(await repo.listPushSubscriptions(a), [{ endpoint: ep, keys, locale: 'fr', createdAt: at }],
      'one device, updated in place');
    // The same browser signs into b: a must stop receiving pushes on it.
    await repo.putPushSubscription(b, { endpoint: ep, keys, locale: 'en', createdAt: at });
    assert.deepEqual(await repo.listPushSubscriptions(a), []);
    assert.equal((await repo.listPushSubscriptions(b)).length, 1);
  });

  test('push: an account deletes only its own device; a dead endpoint goes for whoever holds it', async () => {
    const a = await account();
    const b = await account();
    const ep = endpoint();
    await repo.putPushSubscription(a, { endpoint: ep, keys, locale: 'de', createdAt: at });
    assert.equal(await repo.deletePushSubscription(b, ep), false, "b cannot remove a's device");
    assert.equal((await repo.listPushSubscriptions(a)).length, 1);
    assert.equal(await repo.deleteDeadPushSubscription(ep), true);
    assert.deepEqual(await repo.listPushSubscriptions(a), []);
    assert.equal(await repo.deleteDeadPushSubscription(ep), false, 'a second report is a no-op');
    await repo.putPushSubscription(a, { endpoint: ep, keys, locale: 'de', createdAt: at });
    assert.equal(await repo.deletePushSubscription(a, ep), true);
    assert.deepEqual(await repo.listPushSubscriptions(a), []);
  });

  test('push: mutes are per account and thread, idempotent both ways, listed sorted', async () => {
    const a = await account();
    const b = await account();
    await repo.setPushMute(a, 'round:r2', true);
    await repo.setPushMute(a, 'dm:x1', true);
    await repo.setPushMute(a, 'dm:x1', true);
    await repo.setPushMute(b, 'round:r2', true);
    assert.deepEqual(await repo.listPushMutes(a), ['dm:x1', 'round:r2']);
    await repo.setPushMute(a, 'round:r2', false);
    await repo.setPushMute(a, 'round:r2', false);
    assert.deepEqual(await repo.listPushMutes(a), ['dm:x1']);
    assert.deepEqual(await repo.listPushMutes(b), ['round:r2'], "b's mute is untouched");
  });

  test('push: export carries the service origin, never the endpoint or keys; erasure takes everything', async () => {
    const a = await account();
    const tenant = (await repo.getUserById(a)).tenantId;
    const ep = endpoint();
    await repo.putPushSubscription(a, { endpoint: ep, keys, locale: 'de', createdAt: at });
    await repo.setPushMute(a, 'round:r9', true);
    const out = await repo.exportAccountData(a, tenant);
    assert.deepEqual(out.pushSubscriptions, [{ service: 'https://fcm.googleapis.com', locale: 'de', createdAt: at }]);
    assert.deepEqual(out.pushMutes, ['round:r9']);
    const text = JSON.stringify(out);
    assert.ok(!text.includes(ep) && !text.includes(keys.auth), 'no capability material in the export');
    await repo.eraseAccount(a);
    assert.equal(await repo.deleteDeadPushSubscription(ep), false, 'the device went with the account');
    assert.deepEqual(await repo.listPushMutes(a), []);
  });

  test('push figure: accounts with a device — never a demo, ADMIN_EXCLUDE_TENANTS removes them, two devices count once', async () => {
    const mid = await repo.instanceMetrics();
    assert.equal(typeof mid.adoption.accountsWithPush, 'number');
    const twoDevices = await account();
    const none = await account();
    const tourist = await account(`demo-${uniq()}`);
    const exTenant = `ex-${uniq()}`;
    const hidden = await account(exTenant);
    for (const uid of [twoDevices, twoDevices, tourist, hidden]) {
      await repo.putPushSubscription(uid, { endpoint: endpoint(), keys, locale: 'de', createdAt: at });
    }
    await repo.setPushMute(none, 'round:r1', true); // a mute alone is not a subscription
    const m = await repo.instanceMetrics();
    assert.equal(m.adoption.accountsWithPush - mid.adoption.accountsWithPush, 2,
      'the two-device account once and the excluded one — never the demo or the mute-only account');
    process.env.ADMIN_EXCLUDE_TENANTS = exTenant;
    let ex;
    try {
      ex = await repo.instanceMetrics();
    } finally {
      delete process.env.ADMIN_EXCLUDE_TENANTS;
    }
    assert.equal(m.adoption.accountsWithPush - ex.adoption.accountsWithPush, 1);
  });
};
