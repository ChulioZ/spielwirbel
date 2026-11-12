'use strict';

/*
 * The round chat's frontend (#1781): the shared rules in public/js/round-chat.js
 * (required into Node — a pure, dependency-free helper) and the Chat tab itself,
 * RUN in the jsdom harness rather than source-matched
 * (.claude/rules/testing-views-under-jsdom.md). Named for what it covers, not
 * after a module basename (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { normalizeChatText, chatSegments, chatUnread, CHAT_MESSAGE_MAX } = require('../public/js/round-chat');

test('normalizeChatText unifies line endings and trims only the outside', () => {
  assert.equal(normalizeChatText('  a\r\n\r\nb\r  '), 'a\n\nb');
  assert.equal(normalizeChatText(null), '');
  assert.ok(CHAT_MESSAGE_MAX >= 500);
});

test('chatSegments links http(s) only, and leaves closing punctuation outside the link', () => {
  assert.deepEqual(chatSegments('Regeln: https://example.com/a?b=1. Danke'), [
    { text: 'Regeln: ' }, { href: 'https://example.com/a?b=1', text: 'https://example.com/a?b=1' }, { text: '. Danke' },
  ]);
  assert.deepEqual(chatSegments('javascript:alert(1)'), [{ text: 'javascript:alert(1)' }], 'never an href');
  assert.deepEqual(chatSegments('(siehe http://x.de)'), [
    { text: '(siehe ' }, { href: 'http://x.de', text: 'http://x.de' }, { text: ')' },
  ]);
  assert.deepEqual(chatSegments('https://'), [{ text: 'https://' }], 'a bare scheme is text');
});

test('chatUnread is lit only past the marker', () => {
  assert.equal(chatUnread(5, 4), true);
  assert.equal(chatUnread(5, 5), false);
  assert.equal(chatUnread(undefined, 0), false, 'no head (only your own messages) is never unread');
  assert.equal(chatUnread(1, undefined), true, 'no marker reads as nothing read');
});

function chatApp(t, { loggedIn = true, contact = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => loggedIn);
  dom.set('isLoggedIn', () => loggedIn);
  dom.run(`setContactAvailable(${contact})`);
  return dom;
}

const ROUND = { id: 'r1', name: 'Runde', games: [], members: [], sessions: [] };

test('the Chat tab is offered to a signed-in account only, and carries the unread dot', (t) => {
  const off = chatApp(t, { loggedIn: false });
  off.call('renderHubTabs', { ...ROUND, chatUnread: true }, 'start');
  assert.equal([...off.app.querySelectorAll('.dock__item')].some((a) => a.getAttribute('href') === '/round/r1/chat'), false);

  const on = chatApp(t);
  on.call('renderHubTabs', { ...ROUND, chatUnread: true }, 'start');
  const tab = [...on.app.querySelectorAll('.dock__item')].find((a) => a.getAttribute('href') === '/round/r1/chat');
  assert.ok(tab, 'no Chat tab in the dock');
  assert.ok(tab.querySelector('.hub-chat-dot[role="img"][aria-label]'), 'the dot has its own accessible name');
  const railTab = [...on.app.querySelectorAll('.rail__item')].find((a) => a.getAttribute('href') === '/round/r1/chat');
  assert.ok(railTab && railTab.querySelector('.hub-chat-dot'), 'the rail offers the same section with the same dot');

  const read = chatApp(t);
  read.call('renderHubTabs', ROUND, 'start');
  assert.equal(read.app.querySelector('.hub-chat-dot'), null, 'no dot when nothing is unread');
});

test('the thread renders text as TEXT, links safely, offers the right actions, and marks read what it showed', async (t) => {
  const dom = chatApp(t);
  const calls = [];
  const messages = [
    { id: 'm1', seq: 3, text: '<img src=x onerror=alert(1)> https://bgg.cc/x.', createdAt: '2026-11-12T10:00:00.000Z',
      author: { username: 'bea', avatar: null }, own: false },
    { id: 'm2', seq: 4, text: 'meins', createdAt: '2026-11-12T10:01:00.000Z', editedAt: '2026-11-12T10:02:00.000Z',
      author: { username: 'ich', avatar: null }, own: true },
  ];
  dom.set('api', async (method, url, body) => {
    calls.push([method, url, body]);
    if (method === 'GET') return { messages, hasMore: true, lastRead: 2 };
    if (url.endsWith('/read')) return { lastRead: body.seq };
    return {};
  });
  // An editor grantee: may post and edit their own, may not remove others'.
  dom.app.innerHTML = '';
  await dom.call('renderChatTab', { ...ROUND, shared: true, role: 'editor' });
  await flush();

  const rows = dom.app.querySelectorAll('.chat-msg');
  assert.equal(rows.length, 2);
  assert.equal(dom.app.querySelector('.chat img'), null, 'message text must never become markup');
  assert.match(rows[0].querySelector('.chat-msg__text').textContent, /<img src=x/);
  const link = rows[0].querySelector('.chat-msg__text a');
  assert.equal(link.getAttribute('href'), 'https://bgg.cc/x');
  assert.equal(link.getAttribute('rel'), 'noopener nofollow ugc');

  const labels = (row) => [...row.querySelectorAll('.chat-msg__act')].map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(labels(rows[0]), ['Melden'], 'someone else\'s message: report only, for an editor');
  const report = rows[0].querySelector('a.chat-msg__act');
  assert.match(report.getAttribute('href'), /^\/kontakt\.html\?/);
  assert.equal(new URLSearchParams(report.getAttribute('href').split('?')[1]).get('subject'), 'Chat-Nachricht m1');
  assert.deepEqual(labels(rows[1]), ['Bearbeiten', 'Löschen'], 'your own: edit and delete, no report');
  assert.ok(rows[1].querySelector('.chat-msg__edited'), 'an edited message says so');
  assert.equal(dom.app.querySelector('.chat__older').hidden, false, 'older pages are offered');

  // JSON, not deepEqual: the body was built inside the vm context, a different realm.
  assert.equal(JSON.stringify(calls.filter(([m, u]) => m === 'POST' && u.endsWith('/read')).map(([, , b]) => b)),
    JSON.stringify([{ seq: 4 }]), 'marked read up to the newest message on screen');
});

test('a co-owner may remove someone else\'s message; with no contact channel there is no report link', async (t) => {
  const dom = chatApp(t, { contact: false });
  dom.set('api', async (method) => (method === 'GET'
    ? { messages: [{ id: 'm1', seq: 1, text: 'hi', createdAt: '2026-11-12T10:00:00.000Z', author: { username: 'bea' }, own: false }], hasMore: false, lastRead: 1 }
    : {}));
  dom.app.innerHTML = '';
  await dom.call('renderChatTab', { ...ROUND, shared: true, role: 'coowner' });
  await flush();
  const acts = [...dom.app.querySelectorAll('.chat-msg__act')].map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(acts, ['Löschen', 'Alle Nachrichten von bea löschen'], 'delete + the per-person clean-up, no report');
});

test('the thread\'s hidden controls stay hidden in every design', () => {
  // jsdom applies no stylesheet, so the cascade fight that put „Ältere
  // Nachrichten laden" under a two-message thread in Der Tisch (its
  // `.link-btn` rule outranks a plain [hidden] guard) is only visible as text.
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.chat__older\[hidden\],\s*\.chat__empty\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test('a moderator gets the per-person clean-up on someone else\'s message, never on their own', async (t) => {
  const dom = chatApp(t, { contact: false });
  dom.set('api', async (method) => (method === 'GET'
    ? { messages: [
      { id: 'm1', seq: 1, text: 'spam', createdAt: '2026-11-12T10:00:00.000Z', author: { username: 'bea' }, own: false },
      { id: 'm2', seq: 2, text: 'meins', createdAt: '2026-11-12T10:00:00.000Z', author: { username: 'ich' }, own: true },
    ], hasMore: false, lastRead: 2 }
    : {}));
  dom.app.innerHTML = '';
  await dom.call('renderChatTab', ROUND); // the owner: no grant
  await flush();
  const [other, mine] = [...dom.app.querySelectorAll('.chat-msg')].map((r) =>
    [...r.querySelectorAll('.chat-msg__act')].map((b) => b.getAttribute('aria-label')));
  assert.deepEqual(other, ['Löschen', 'Alle Nachrichten von bea löschen']);
  assert.deepEqual(mine, ['Bearbeiten', 'Löschen']);
});
