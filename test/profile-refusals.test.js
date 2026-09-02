'use strict';

/* The two refusals the profile screen must EXPLAIN rather than swallow (#877).
 *
 * `showProfile()` renders a loading ellipsis, awaits the profile, and — for any
 * error code it does not recognise — falls through to a bare `return`, on the
 * assumption that `accountApi` has already handled a dead session. That is
 * correct for 401 and wrong for every refusal the route can answer with: the
 * ellipsis simply stays on screen forever, with no message, no error and no way
 * back. Nothing is red when it happens; the screen just never finishes.
 *
 * #877 added the second such code (`demo_forbidden`, for a guest demo account),
 * so both branches are pinned here together — `user_not_found` is the control
 * that keeps this from passing against a screen that shows one message for
 * everything.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): what went wrong is the
 * ABSENCE of a rendered node, which a regex over the view cannot see.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator } = require('./support/dom');

const t = translator('de');

/** A booted app whose profile fetch rejects with `code`. */
function bootRefusing(t_, code) {
  const dom = loadApp();
  t_.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'user-me');
  dom.set('accountApi', async (method, url) => {
    if (/^\/profile\//.test(url)) throw new Error(code);
    return {};
  });
  return dom;
}

const notes = (app) => [...app.querySelectorAll('.empty-note')].map((el) => el.textContent);

test('a demo account gets the demo explanation, not a stuck loading screen', async (t_) => {
  const dom = bootRefusing(t_, 'demo_forbidden');
  await dom.call('showProfile', 'ada');

  assert.deepEqual(notes(dom.app), [t('profile.demoBlocked')]);
  // The regression itself: the ellipsis is what the screen shows while the
  // fetch is in flight, and leaving it is indistinguishable from a hang.
  assert.equal(dom.app.textContent.includes('…'), false, 'the loading ellipsis is still on screen');
  assert.ok(dom.app.querySelector('h1'), 'the screen rendered a heading, so it really rendered');
});

test('an unknown handle still gets its own explanation', async (t_) => {
  const dom = bootRefusing(t_, 'user_not_found');
  await dom.call('showProfile', 'nobody');

  assert.deepEqual(notes(dom.app), [t('profile.notFound')]);
});

test('a dead session renders nothing — accountApi has already handled it', async (t_) => {
  const dom = bootRefusing(t_, 'unauthorized');
  await dom.call('showProfile', 'ada');

  assert.deepEqual(notes(dom.app), [], 'an unrecognised code must not be given a message of its own');
});
