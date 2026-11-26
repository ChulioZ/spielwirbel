'use strict';

/*
 * The browser half of web push (#1785) under jsdom: the thread bell (shown only
 * where push is offered, toggles a mute, defers to a muted round), and the Konto
 * row (absent without VAPID, never prompting on render). The server half is
 * test/push.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { pushKeyBytes } = require('../public/js/push-client');

const BO = 'u-bo';
const thread = {
  partner: { userId: BO, username: 'bo', avatar: null }, friend: true, canPost: true, hasMore: false, lastRead: 0,
  messages: [{ id: 'm1', seq: 1, text: 'hi', createdAt: '2026-11-26T10:00:00.000Z', author: { username: 'bo', avatar: null }, own: false }],
};

function boot(t, { push = true, supported = true, mutes = [] } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const calls = [];
  const prompts = [];
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('isDemoAccount', () => false);
  dom.set('withAppConfig', (cb) => cb({ push }));
  dom.set('pushSupported', () => supported);
  dom.set('pushNeedsInstall', () => false);
  dom.set('currentPushSubscription', async () => null);
  dom.set('refreshInboxBadge', async () => {});
  dom.set('api', async (method, url, body) => {
    calls.push([method, url, body]);
    if (url === '/api/account/push') return { available: push, publicKey: 'BKey', mutes };
    if (url === '/api/account/push/mutes') return { thread: body.thread, muted: body.muted };
    if (url.startsWith(`/api/account/messages/${BO}`)) return thread;
    return {};
  });
  dom.run('globalThis.Notification = { permission: "default", requestPermission: () => { globalThis.__prompted = true; return Promise.resolve("denied"); } }');
  return { dom, calls, prompts };
}

const bellOf = (dom) => dom.app.querySelector('.chat__bell');

test('a conversation gets a bell; tapping it mutes the thread for the account', async (t) => {
  const { dom, calls } = boot(t);
  await dom.call('showDirectThread', BO);
  await flush();
  const bell = bellOf(dom);
  assert.ok(bell, 'the bell is there');
  assert.equal(bell.getAttribute('aria-pressed'), 'false');
  assert.equal(bell.getAttribute('aria-label'), dom.run("t('chat.push.mute')"));
  bell.click();
  await flush();
  assert.ok(calls.some(([m, url, b]) => m === 'PUT' && url === '/api/account/push/mutes'
    && b.thread === `dm:${BO}` && b.muted === true));
  assert.equal(bell.getAttribute('aria-pressed'), 'true');
  assert.ok(bell.querySelector('.ti-bell-off'), 'muted reads by its glyph, not by colour alone');
});

test('no bell where push is not offered — no VAPID, or a browser without PushManager', async (t) => {
  for (const opts of [{ push: false }, { supported: false }]) {
    const { dom, calls } = boot(t, opts);
    await dom.call('showDirectThread', BO);
    await flush();
    assert.equal(bellOf(dom), null, JSON.stringify(opts));
    assert.ok(!calls.some(([, url]) => url === '/api/account/push' && opts.supported === false),
      'an unsupported browser does not even ask');
  }
});

test('a session bell defers to its muted round: shown muted, and not a control', async (t) => {
  const { dom } = boot(t, { mutes: ['round:r1'] });
  const host = dom.document.createElement('div');
  dom.app.appendChild(host);
  dom.call('mountPushBell', host, 'session:s1', 'round:r1');
  await flush();
  const bell = host.querySelector('.chat__bell');
  assert.equal(bell.getAttribute('aria-pressed'), 'true');
  assert.equal(bell.disabled, true);
});

test('Konto: the push row exists only with VAPID, and rendering it never prompts', async (t) => {
  const off = boot(t, { push: false });
  const formOff = off.dom.call('buildNotifyForm', {});
  assert.equal(formOff.textContent.includes(off.dom.run("t('konto.push.label')")), false);

  const on = boot(t, { push: true });
  const form = on.dom.call('buildNotifyForm', {});
  await flush();
  assert.ok(form.textContent.includes(on.dom.run("t('konto.push.label')")), 'the row is offered');
  assert.equal(on.dom.run('globalThis.__prompted === true'), false, 'no permission prompt without a tap');
  // A refused prompt leaves the box off and says why.
  const box = [...form.querySelectorAll('input[type=checkbox]')].pop();
  box.checked = true;
  box.dispatchEvent(new on.dom.window.Event('change'));
  await flush();
  await flush();
  assert.equal(on.dom.run('globalThis.__prompted === true'), true, 'the tap is what prompts');
  assert.equal(box.checked, false);
});

test('pushKeyBytes decodes the base64url VAPID key into raw bytes', () => {
  assert.deepEqual([...pushKeyBytes('AQID_-8')], [1, 2, 3, 255, 239]);
});
