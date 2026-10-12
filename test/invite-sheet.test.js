'use strict';

/* The „Einladen" sheet (#1618): one seat at the top, a „Nutzername | Link"
 * switch, and ONE action in the pinned footer — plus the member page's
 * „Einladen" button, which opens the same sheet with that seat fixed.
 *
 * Rendered for real under jsdom (.claude/rules/testing-views-under-jsdom.md).
 * join-link-view.test.js covers the link list's share/revoke ladder; this file
 * is about the sheet's SHAPE and which seat each mode submits.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

const ROUND = () => ({
  id: 'r1',
  name: 'Donnerstagsrunde',
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Bob', userId: 'u2' },
    { id: 'm3', name: 'Clara' },
    { id: 'm4', name: 'Dora', retired: true },
  ],
  games: [],
  sessions: [],
});

const LINKS = [
  { token: 'tok-f', slot: 'fresh', memberId: null, seatName: null, expiresAt: '2026-10-15T12:00:00.000Z' },
  { token: 'tok-a', slot: 'm1', memberId: 'm1', seatName: 'Anna', expiresAt: '2026-10-15T12:00:00.000Z' },
  { token: 'tok-c', slot: 'm3', memberId: 'm3', seatName: 'Clara', expiresAt: '2026-10-15T12:00:00.000Z' },
];

function app(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push([method, url, body && { ...body }]);
    if (method === 'GET') return LINKS;
    if (method === 'POST') return { link: { ...LINKS[1], token: 'tok-new' } };
    return null;
  });
  dom.set('accountApi', async (method, url, body) => {
    calls.push([method, url, body && { ...body }]);
    if (url === '/friends') return { friends: [] };
    return {};
  });
  dom.run('navigator.share = undefined; navigator.clipboard = { writeText: async () => {} };');
  return { dom, calls };
}

const sheetOf = (dom) => dom.document.querySelector('.sheet--dialog');
const modeBtn = (sheet, mode) => sheet.querySelector(`.invite-modes [data-mode="${mode}"]`);

test('without a seat: ONE seat select at the top, and the footer holds only the active mode\'s action', async (t) => {
  const { dom } = app(t);
  dom.call('showInvite', ROUND());
  await flush(); await flush();
  const sheet = sheetOf(dom);

  const seat = sheet.querySelectorAll('#inviteSeat');
  assert.equal(seat.length, 1, 'exactly one seat picker');
  assert.equal(sheet.querySelector('#inviteLinkSeat'), null, 'the link mode asks no second seat');
  assert.deepEqual([...seat[0].options].map((o) => o.value), ['', 'm1', 'm3'],
    'a fresh seat, then every active unlinked seat');
  assert.ok(seat[0].compareDocumentPosition(sheet.querySelector('.invite-modes')) & 4,
    'the seat sits above the switch, shared by both modes');

  // Username mode is the default, and the body carries no action button.
  assert.equal(modeBtn(sheet, 'user').getAttribute('aria-pressed'), 'true');
  assert.equal(modeBtn(sheet, 'link').getAttribute('aria-pressed'), 'false');
  const footer = sheet.querySelector('.sheet__actions');
  assert.equal(sheet.lastElementChild, footer, 'the pinned footer stays the sheet\'s last child');
  assert.equal(footer.querySelectorAll('button').length, 1, 'one action in the footer');
  assert.match(text(footer), /Einladung senden/);
  const bodyActions = [...sheet.querySelectorAll('.btn--primary, #inviteLinkGo')].filter((b) => !footer.contains(b));
  assert.equal(bodyActions.length, 0, 'no action button inside the scrolling body');

  // Typed values survive a round trip through the other mode.
  sheet.querySelector('#inviteHandle').value = 'ada';
  modeBtn(sheet, 'link').click();
  assert.equal(modeBtn(sheet, 'link').getAttribute('aria-pressed'), 'true');
  assert.match(text(footer), /Link erstellen/);
  assert.ok(sheet.querySelector('#inviteHandle').closest('[hidden]'), 'the username form is out of the link mode');
  assert.ok(!sheet.querySelector('.invite-link').closest('[hidden]'), 'the link list is in it');
  assert.match(text(sheet.querySelector('.invite-link')), /Rolle „Mitspielen“/, 'the mode says a link grants the editor role');
  modeBtn(sheet, 'user').click();
  assert.equal(sheet.querySelector('#inviteHandle').value, 'ada');
  assert.equal(dom.document.activeElement, sheet.querySelector('#inviteHandle'), 'focus returns to the username field');
});

test('without a seat: both modes submit the ONE shared seat', async (t) => {
  const { dom, calls } = app(t);
  dom.call('showInvite', ROUND());
  await flush(); await flush();
  const sheet = sheetOf(dom);
  sheet.querySelector('#inviteSeat').value = 'm3';

  modeBtn(sheet, 'link').click();
  sheet.querySelector('.sheet__actions button').click();
  await flush(); await flush();
  assert.deepEqual(calls.find((c) => c[0] === 'POST' && c[1].endsWith('/invite-links')),
    ['POST', '/api/rounds/r1/invite-links', { memberId: 'm3' }]);
  assert.equal(sheet.querySelectorAll('.invite-link__row').length, 3, 'unfixed: every live link is listed');

  modeBtn(sheet, 'user').click();
  sheet.querySelector('#inviteHandle').value = 'ada';
  sheet.querySelector('.sheet__actions button').click();
  await flush();
  const sent = calls.find((c) => c[1] === '/invitations');
  assert.ok(sent, 'the invitation was sent');
  assert.equal(sent[2].memberId, 'm3');
  assert.equal(sent[2].username, 'ada');
});

test('with a fixed seat: no seat picker anywhere, and both modes target that seat only', async (t) => {
  const { dom, calls } = app(t);
  const round = ROUND();
  dom.call('showInvite', round, { seat: round.members[0] });
  await flush(); await flush();
  const sheet = sheetOf(dom);

  assert.equal(sheet.querySelector('#inviteSeat'), null, 'no seat select');
  assert.equal(sheet.querySelector('#inviteLinkSeat'), null, 'no link seat select');
  assert.match(text(sheet.querySelector('.invite-seat')), /Übernehmen: Anna/);

  modeBtn(sheet, 'link').click();
  const rows = sheet.querySelectorAll('.invite-link__row');
  assert.equal(rows.length, 1, 'only this seat\'s link is listed');
  assert.match(text(rows[0]), /Anna/);
  sheet.querySelector('.sheet__actions button').click();
  await flush(); await flush();
  assert.deepEqual(calls.find((c) => c[0] === 'POST' && c[1].endsWith('/invite-links'))[2], { memberId: 'm1' });

  modeBtn(sheet, 'user').click();
  sheet.querySelector('#inviteHandle').value = 'ada';
  sheet.querySelector('.sheet__actions button').click();
  await flush();
  assert.equal(calls.find((c) => c[1] === '/invitations')[2].memberId, 'm1');
});

/* ------------------------------ the member page --------------------------- */

async function openMember(t, mid, { can = ['round.shares.manage', 'member.link'], accounts = true, mutate } = {}) {
  const { dom } = app(t);
  dom.set('showRound', () => {});
  dom.set('accountsActive', () => accounts);
  dom.set('currentUserId', () => 'acct-me');
  dom.set('roundCan', (r, cap) => can.includes(cap));
  dom.run('window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });');
  const round = ROUND();
  // The owner already holds a seat here, so „Das bin ich" stays out of the way.
  round.members.push({ id: 'm9', name: 'Me', userId: 'acct-me' });
  if (mutate) mutate(round);
  dom.set('api', async (method, url) => {
    if (url === '/api/rounds/r1') return round;
    if (/\/shares$/.test(url)) return [];
    return {};
  });
  const opened = [];
  dom.set('showInvite', (r, opts) => { opened.push([r.id, opts && opts.seat && opts.seat.id]); });
  await dom.call('showMember', 'r1', mid);
  return { dom, opened };
}

test('the owner\'s member card offers „Einladen" on an unlinked seat, and it fixes that seat', async (t) => {
  const { dom, opened } = await openMember(t, 'm1');
  const btn = dom.app.querySelector('.member-card__invite');
  assert.ok(btn, 'no Einladen button on an unlinked seat');
  assert.match(text(btn), /Einladen/);
  btn.click();
  assert.deepEqual(opened, [['r1', 'm1']]);
});

for (const [why, mid, opts] of [
  ['a linked seat', 'm2', {}],
  ['a retired member', 'm4', {}],
  ['a non-owner', 'm1', { can: ['member.link'] }],
  ['accounts mode off', 'm1', { accounts: false }],
]) {
  test(`no „Einladen" on the member card for ${why}`, async (t) => {
    const { dom } = await openMember(t, mid, opts);
    assert.ok(dom.app.querySelector('.member-card'), 'the card rendered');
    assert.equal(dom.app.querySelector('.member-card__invite'), null);
  });
}
