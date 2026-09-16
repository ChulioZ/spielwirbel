'use strict';

/* The two username fields that name ANOTHER account must be invisible to
   password managers (#1077).

   Safari's AutoFill offered saved spielwirbel.app logins on the add-friend field
   of /freunde and on the invite sheet's field, although both already carried
   `autocomplete="off"` — which WebKit ignores for anything its heuristics read as
   a login form. Neither field is a credential input: it names the person you want
   to add, so a saved login is never the right answer.

   This is a shape guard, and it is deliberately NOT the acceptance test — only
   real Safari with a Keychain entry can answer whether the offer is gone (the
   Browser pane is Chromium, .claude/rules/browser-pane-is-chromium-only.md).
   What it pins is that the mitigations stay applied: the ids stop looking like
   credential fields, no `name` lands on either input, no credential
   `autocomplete` token appears, and the three password-manager opt-outs are
   present. Those are exactly what a later edit would quietly undo.

   Named for what it covers rather than for a view file: test/friends.test.js is
   the route spec and test/round-settings.test.js is the settings one
   (.claude/rules/test-file-names-collide-silently.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

// The heuristic's own vocabulary. An id containing any of these is what makes
// WebKit read the field as a login, so the guard bans the WORDS, not one spelling.
const CREDENTIAL_WORDS = /user|login|name|mail|pass/i;
// Tokens that tell a manager "this IS a credential field" — the opposite of what
// these two fields are. `off` and `nickname` are fine.
const CREDENTIAL_AUTOCOMPLETE = /\b(username|current-password|new-password|email)\b/i;

const EMPTY_FRIENDS = { friends: [], incoming: [], outgoing: [] };
const EMPTY_FEED = { events: [] };

async function friendsField(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('accountApi', async (method, path) => (path === '/friends' ? EMPTY_FRIENDS : EMPTY_FEED));
  await dom.call('showFriends');
  /* Since #1092 the field lives inside the „＋" tile and only exists once it is
     pressed — so the spec presses it. Asserting against the tile instead would
     quietly stop testing the input, which is the whole subject here. */
  const tile = dom.app.querySelector('.k-tile--add');
  assert.ok(tile, 'the „＋" tile did not render — the add form has moved again');
  tile.click();
  const form = dom.document.querySelector('form.friends-add');
  assert.ok(form, 'pressing the „＋" tile rendered no add-a-friend form');
  const input = form.querySelector('input[type="text"], input[type="search"]');
  assert.ok(input, 'the add-a-friend form rendered no text input');
  return { dom, form, input };
}

async function inviteField(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  await dom.call('showInvite', {
    id: 'r1', name: 'Freitagsrunde',
    members: [{ id: 'm1', name: 'Ada' }],
    games: [], sessions: [],
  });
  const sheet = dom.document.querySelector('.sheet--dialog');
  assert.ok(sheet, 'the invite sheet did not render');
  const input = sheet.querySelector('input[type="text"], input[type="search"]');
  assert.ok(input, 'the invite sheet rendered no text input');
  return { dom, sheet, input };
}

const CASES = [
  ['the add-friend field on /freunde', friendsField],
  ['the invite sheet field', inviteField],
];

for (const [what, render] of CASES) {
  test(`${what} carries an id no password manager reads as a credential`, async (t) => {
    const { input } = await render(t);
    assert.ok(input.id, 'the input lost its id — the view queries it by id');
    assert.doesNotMatch(input.id, CREDENTIAL_WORDS,
      `id "${input.id}" contains a credential word, which is what Safari's heuristic reads`);
  });

  test(`${what} carries no name attribute`, async (t) => {
    const { input } = await render(t);
    assert.equal(input.getAttribute('name'), null,
      'a name attribute is the second thing the heuristic keys on, and nothing here submits natively');
  });

  test(`${what} claims no credential autocomplete token`, async (t) => {
    const { input } = await render(t);
    const value = input.getAttribute('autocomplete') || '';
    assert.doesNotMatch(value, CREDENTIAL_AUTOCOMPLETE,
      `autocomplete="${value}" tells a manager this field IS a credential`);
  });

  test(`${what} opts out of 1Password, LastPass and Bitwarden`, async (t) => {
    const { input } = await render(t);
    for (const attr of ['data-1p-ignore', 'data-bwignore']) {
      assert.ok(input.hasAttribute(attr), `${attr} is missing`);
    }
    assert.equal(input.getAttribute('data-lpignore'), 'true', 'data-lpignore must be the string "true"');
  });

  test(`${what} keeps its accessible name`, async (t) => {
    const { dom, input } = await render(t);
    const label = input.getAttribute('aria-label');
    const forLabel = input.id && dom.document.querySelector(`label[for="${input.id}"]`);
    const name = (label || forLabel?.textContent || '').trim();
    assert.ok(name, 'the field lost its accessible name (WCAG 2.2 SC 3.3.2/4.1.2)');
    assert.doesNotMatch(name, /^(friends|invite)\./, 'the name rendered a raw i18n key');
  });
}

/* The registration form's own username field is a REAL credential field and is
   deliberately left alone — `autocomplete="nickname"` there is a considered
   choice with its own comment. Asserting it stays put is what stops a future
   sweep from "fixing" all three fields alike. */
test('the registration username field keeps its credential semantics', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public/js/views-auth.js'), 'utf8');
  assert.match(src, /id="regUser"/, 'the registration username input lost its id');
  assert.match(src, /autocomplete="nickname"/, 'the registration field lost its deliberate nickname token');
  assert.doesNotMatch(src, /id="regUser"[^>]*data-1p-ignore/, 'registration must stay visible to password managers');
});

/* The invite field is focused on open on purpose (iOS only raises the soft
   keyboard for a focus() inside the opening gesture). The mitigations must not
   have moved that. */
test('the invite field still receives focus when the sheet opens', async (t) => {
  const { dom, input } = await inviteField(t);
  assert.equal(dom.document.activeElement, input, 'the invite sheet stopped focusing its field');
});
