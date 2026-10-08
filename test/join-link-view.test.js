'use strict';

/* The two screens of round invite links (#1515), rendered for real under jsdom
   (.claude/rules/testing-views-under-jsdom.md): the /join/<token> screen a link
   opens, and the owner's link section inside the „Einladen" sheet. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const TOKEN = 'NOT-A-REAL-TOKEN-just-a-path-segment';

function app(t, { loggedIn = true, accounts = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => accounts);
  dom.set('isLoggedIn', () => loggedIn);
  dom.set('toast', () => {});
  const routed = [];
  dom.set('routeTo', (p) => { routed.push(p); });
  return { dom, routed };
}

test('logged out: the screen says what the link is and parks itself for after sign-in', async (t) => {
  const { dom, routed } = app(t, { loggedIn: false });
  const calls = [];
  dom.set('accountApi', async (...a) => { calls.push(a); return {}; });
  await dom.call('showJoinLink', TOKEN);
  assert.equal(calls.length, 0, 'nothing is asked of the server without an account');
  assert.match(text(dom.app.querySelector('h1')), /eingeladen/);
  dom.app.querySelector('#joinLogin').click();
  assert.deepEqual(routed, ['/login']);
  assert.equal(dom.run('pendingPath'), `/join/${TOKEN}`, 'sign-in returns to the link');
  dom.app.querySelector('#joinRegister').click();
  assert.deepEqual(routed, ['/login', '/register']);
});

test('signed in: „Runde beitreten?" with the seat, and joining opens the round', async (t) => {
  const { dom } = app(t);
  const calls = [];
  dom.set('accountApi', async (method, path, body) => {
    calls.push([method, path, { ...body }]);
    return path === '/join/preview' ? { roundName: 'Donnerstagsrunde', seatName: 'Bob' } : { roundId: 'r9' };
  });
  const opened = [];
  dom.set('showRound', (rid, tab) => { opened.push([rid, tab]); });
  await dom.call('showJoinLink', TOKEN);
  assert.match(text(dom.app.querySelector('h1')), /„Donnerstagsrunde“ beitreten\?/);
  assert.match(text(dom.app), /Platz von Bob/);
  assert.match(text(dom.app), /Mitspielen/, 'the role is named');
  assert.deepEqual(calls[0], ['POST', '/join/preview', { token: TOKEN }], 'the token travels in the body');

  dom.app.querySelector('#joinGo').click();
  await flush();
  assert.deepEqual(calls[1], ['POST', '/join', { token: TOKEN }]);
  assert.deepEqual(opened, [['r9', 'start']]);
});

test('every refusal gets its own words, and an unknown one a generic line', async (t) => {
  for (const [code, title] of [['invalid_link', /ins Leere/], ['own_round', /deine eigene Runde/],
    ['already_member', /schon dabei/], ['quota_members', /voll/], ['demo_forbidden', /Demo-Konto/], ['weird', /nicht geklappt/]]) {
    const { dom } = app(t);
    dom.set('accountApi', async () => { throw new Error(code); });
    await dom.call('showJoinLink', TOKEN);
    assert.match(text(dom.app.querySelector('h1')), title, code);
  }
});

test('accounts off: the link cannot do anything, and says so', async (t) => {
  const { dom } = app(t, { accounts: false });
  let asked = false;
  dom.set('accountApi', async () => { asked = true; return {}; });
  await dom.call('showJoinLink', TOKEN);
  assert.equal(asked, false);
  assert.match(text(dom.app.querySelector('h1')), /ins Leere/);
});

test('the owner\'s sheet lists live links and mints one for the chosen seat', async (t) => {
  const { dom } = app(t);
  const round = { id: 'r1', name: 'Donnerstagsrunde', members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Bob', userId: 'u2' }] };
  const calls = [];
  const live = [{ token: 'tok-a', slot: 'fresh', memberId: null, seatName: null, expiresAt: '2026-10-15T12:00:00.000Z' }];
  dom.set('api', async (method, url, body) => {
    calls.push([method, url, body && { ...body }]);
    if (method === 'GET') return live;
    if (method === 'POST') return { link: { token: 'tok-b', slot: 'm1', memberId: 'm1', seatName: 'Anna', expiresAt: '2026-10-15T12:00:00.000Z' } };
    return null;
  });
  dom.set('accountApi', async () => ({ friends: [] }));
  dom.run('navigator.share = undefined; navigator.clipboard = { writeText: async (u) => { window.__copied = u; } };');
  dom.call('showInvite', round);
  await flush(); await flush();

  const section = dom.document.querySelector('.invite-link');
  assert.ok(section, 'the link section is in the invite sheet');
  assert.ok(section.nextElementSibling.classList.contains('sheet__actions'), 'above the pinned footer, which stays last');
  const rows = section.querySelectorAll('.invite-link__row');
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /Eigener neuer Platz/);
  // Only Anna's seat is free — Bob's is an account's already.
  const seats = [...section.querySelectorAll('#inviteLinkSeat option')].map((o) => o.value);
  assert.deepEqual(seats, ['', 'm1']);

  section.querySelector('#inviteLinkSeat').value = 'm1';
  section.querySelector('#inviteLinkGo').click();
  await flush(); await flush();
  assert.deepEqual(calls.find((c) => c[0] === 'POST'), ['POST', '/api/rounds/r1/invite-links', { memberId: 'm1' }]);
  assert.match(dom.run('window.__copied'), /\/join\/tok-b$/, 'the new link is copied for the owner');

  rows[0].querySelector('.invite-link__revoke').click();
  await flush();
  assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1] === '/api/rounds/r1/invite-links/fresh'), 'revoked by slot, never by token');
});

test('a refused clipboard falls back to the URL, and the new link is still listed', async (t) => {
  const { dom } = app(t);
  const round = { id: 'r1', name: 'Donnerstagsrunde', members: [{ id: 'm1', name: 'Anna' }] };
  let gets = 0;
  dom.set('api', async (method) => {
    if (method === 'GET') { gets += 1; return []; }
    return { link: { token: 'tok-c', slot: 'fresh', memberId: null, seatName: null, expiresAt: '2026-10-15T12:00:00.000Z' } };
  });
  dom.set('accountApi', async () => ({ friends: [] }));
  const shown = [];
  dom.set('showShareUrlSheet', (url) => { shown.push(url); });
  const toasts = [];
  dom.set('toast', (msg, opts) => { toasts.push([msg, opts && opts.tone]); });
  dom.run('navigator.share = undefined; navigator.clipboard = { writeText: async () => { throw new Error(\'NotAllowedError\'); } };');
  dom.call('showInvite', round);
  await flush(); await flush();
  const before = gets;
  dom.document.querySelector('#inviteLinkGo').click();
  await flush(); await flush(); await flush();
  assert.equal(gets, before + 1, 'the list is reloaded with the new link');
  assert.equal(shown.length, 1, 'the URL is shown for a manual copy');
  assert.match(shown[0], /\/join\/tok-c$/);
  assert.ok(!toasts.some(([, tone]) => tone === 'error'), 'no error for a link that was created');
});
