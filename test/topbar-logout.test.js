'use strict';

/*
 * The top bar's two account-gated buttons must BOTH follow the login state.
 *
 * `setupAccountUi()` is the one function every login transition calls (boot,
 * login, logout, session-lost), and it used to reach `setupInboxUi()` only
 * AFTER an early `if (!loggedIn) return;` — so logging out hid the account
 * button and left the inbox button sitting on the landing page. Not a data leak
 * (`showInbox` guards itself and bounces Home) but a dead control on the one
 * screen a logged-out visitor sees.
 *
 * It never showed on a cold boot: `bootApp()` returns before `setupAccountUi()`
 * for a logged-out accounts-mode visitor, so the button keeps the `hidden`
 * attribute it ships with in index.html. Only the logout transition exposed it,
 * which is why a spec has to drive the TRANSITION rather than a single state.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

function boot(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('accountApi', async () => ({ items: [] }));
  dom.context.__user = { id: 'u1', username: 'ada', email: 'a@example.com' };
  dom.run('accountUser = __user');
  const hidden = () => ({
    account: dom.document.getElementById('accountBtn').hidden,
    inbox: dom.document.getElementById('inboxBtn').hidden,
  });
  return { dom, hidden };
}

test('logging out hides BOTH top-bar buttons, not just the account one', (t) => {
  const { dom, hidden } = boot(t);

  dom.call('setupAccountUi');
  assert.deepEqual(hidden(), { account: false, inbox: false },
    'both are shown while logged in, or the assertion below proves nothing');

  dom.set('isLoggedIn', () => false);
  dom.call('setupAccountUi');
  assert.deepEqual(hidden(), { account: true, inbox: true },
    'the inbox button outlived the session — setupInboxUi() is behind an early return');
});

test('a session lost mid-use hides them too', (t) => {
  // onSessionLost() clears the tokens and calls setupAccountUi(); the same early
  // return applied there, so this is the second transition the fix has to cover.
  const { dom, hidden } = boot(t);
  dom.call('setupAccountUi');

  dom.set('isLoggedIn', () => false);
  dom.run('accountUser = null');
  dom.call('setupAccountUi');

  assert.deepEqual(hidden(), { account: true, inbox: true });
});

test('the inbox dot is cleared on the way out, not left lit for the next account', (t) => {
  const { dom } = boot(t);
  dom.call('setupAccountUi');
  dom.call('setInboxDot', true);
  assert.equal(dom.document.getElementById('inboxDot').hidden, false);

  dom.set('isLoggedIn', () => false);
  dom.call('setupAccountUi');
  assert.equal(dom.document.getElementById('inboxDot').hidden, true,
    'a stale unread dot would greet whoever logs in next on this browser');
});
