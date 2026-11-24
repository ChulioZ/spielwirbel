'use strict';

/*
 * The direct-message screens under jsdom (#1783): the Freundeskreis
 * „Nachrichten" band, the one-conversation screen (writable and ended), its
 * not-found branch, and the inbox row for a `dm:` thread. The route is
 * test/direct-messages.test.js; this file is what the views build from its
 * answers.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

const BO = 'u-bo';
const thread = (over = {}) => ({
  partner: { userId: BO, username: 'bo', avatar: null },
  friend: true,
  canPost: true,
  hasMore: false,
  lastRead: 0,
  messages: [
    { id: 'm1', seq: 1, text: 'Freitag?', createdAt: '2026-11-24T10:00:00.000Z', author: { username: 'bo', avatar: null }, own: false },
    { id: 'm2', seq: 2, text: '<img src=x onerror=alert(1)> klar', createdAt: '2026-11-24T10:01:00.000Z', author: { username: 'ada', avatar: null }, own: true },
  ],
  ...over,
});

function boot(t, { api, accountApi } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const calls = [];
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('api', async (method, url, body) => {
    calls.push([method, url, body]);
    return api ? api(method, url, body) : {};
  });
  dom.set('accountApi', async (method, url) => (accountApi ? accountApi(method, url) : {}));
  dom.set('refreshInboxBadge', async () => {});
  return { dom, calls };
}

test('the Freundeskreis lists conversations as links, unread ones dotted and bold-named', async (t) => {
  const { dom } = boot(t, {
    accountApi: async (m, url) => {
      if (url === '/friends') return { friends: [], incoming: [], outgoing: [] };
      if (url === '/friends/feed') return { events: [] };
      if (url === '/messages') {
        return {
          conversations: [
            { userId: BO, username: 'bo', avatar: null, friend: true, unread: true, lastAt: '2026-11-24T10:00:00.000Z' },
            { userId: 'u-ex', username: 'ex', avatar: null, friend: false, unread: false, lastAt: '2026-11-01T10:00:00.000Z' },
          ],
        };
      }
      return {};
    },
  });
  await dom.call('showFriends');
  const rows = [...dom.app.querySelectorAll('.dm-row')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tagName, 'A', 'the whole row is the link — it holds nothing else');
  assert.equal(rows[0].getAttribute('href'), `/freunde/nachrichten/${BO}`);
  assert.ok(rows[0].classList.contains('dm-row--unread'));
  const dot = rows[0].querySelector('.dm-row__dot');
  assert.ok(dot && dot.getAttribute('aria-label'), 'the dot has its own accessible name');
  assert.equal(rows[1].querySelector('.dm-row__dot'), null);
  assert.match(rows[1].textContent, new RegExp(dom.run("t('dm.ended')")), 'an ex-friend says so');
});

test('no conversations, no band — and a failed list costs the screen nothing', async (t) => {
  for (const messages of [async () => ({ conversations: [] }), async () => { throw new Error('boom'); }]) {
    const { dom } = boot(t, {
      accountApi: async (m, url) => {
        if (url === '/friends') return { friends: [], incoming: [], outgoing: [] };
        if (url === '/friends/feed') return { events: [] };
        if (url === '/messages') return messages();
        return {};
      },
    });
    await dom.call('showFriends');
    assert.ok(dom.app.querySelector('.friends-screen'), 'the screen rendered');
    assert.equal(dom.app.querySelectorAll('.dm-row').length, 0);
  }
});

test('a conversation renders text as text, offers a composer, and marks what it showed', async (t) => {
  const { dom, calls } = boot(t, {
    api: async (method) => (method === 'GET' ? thread() : { lastRead: 2 }),
  });
  await dom.call('showDirectThread', BO);
  await flush();
  assert.equal(dom.app.querySelectorAll('.back-row').length, 1);
  assert.equal(dom.document.title.startsWith(dom.run("t('dm.title', { name: 'bo' })")), true);
  const texts = [...dom.app.querySelectorAll('.chat-msg__text')].map((p) => p.textContent);
  assert.deepEqual(texts, ['Freitag?', '<img src=x onerror=alert(1)> klar']);
  assert.equal(dom.app.querySelector('.chat-msg__text img'), null, 'user text never becomes markup');
  const input = dom.app.querySelector('#dmInput');
  assert.ok(input, 'the composer is there, under its own id');
  assert.equal(dom.app.querySelector(`label[for="dmInput"]`) !== null, true);
  // Own message: edit and delete. Bo's: no edit, no delete — a conversation has
  // no moderator.
  const own = dom.app.querySelector('.chat-msg[data-id="m2"]');
  const theirs = dom.app.querySelector('.chat-msg[data-id="m1"]');
  assert.equal(own.querySelectorAll('.chat-msg__act').length >= 2, true);
  assert.equal(theirs.querySelector('[aria-label="' + dom.run("t('chat.delete')") + '"]'), null);
  assert.ok(calls.some(([m, url, body]) => m === 'POST' && url === `/api/account/messages/${BO}/read` && body.seq === 2),
    'the newest message on screen was marked read');
});

test('an ended friendship: the history stays readable, the composer and edit go, delete stays', async (t) => {
  const { dom } = boot(t, { api: async (method) => (method === 'GET' ? thread({ canPost: false, friend: false }) : { lastRead: 2 }) });
  await dom.call('showDirectThread', BO);
  await flush();
  assert.equal(dom.app.querySelector('.chat__compose'), null, 'no composer');
  assert.equal(dom.app.querySelector('.chat__closed').textContent, dom.run("t('dm.closed')"));
  const own = dom.app.querySelector('.chat-msg[data-id="m2"]');
  assert.equal(own.querySelector('[aria-label="' + dom.run("t('chat.edit')") + '"]'), null, 'no edit');
  assert.ok(own.querySelector('[aria-label="' + dom.run("t('chat.delete')") + '"]'), 'delete stays');
});

test('a conversation that is not the caller\'s still offers the way back', async (t) => {
  const { dom } = boot(t, { api: async () => { throw new Error('not_found'); } });
  await dom.call('showDirectThread', 'u-nobody');
  assert.equal(dom.app.querySelectorAll('.back-row').length, 1);
  assert.equal(dom.app.querySelector('.empty-note').textContent, dom.run("t('dm.notFound')"));
});

test('the inbox row for a direct thread names the person and opens the conversation', async (t) => {
  const { dom } = boot(t);
  const row = dom.run(`renderChatUnreadItem({ id: 'i1', read: false, type: 'chat_unread',
    payload: { thread: 'dm:${BO}', otherUserId: '${BO}', username: 'bo', count: 2 } })`);
  const link = row.querySelector('.inbox-row__chat');
  assert.equal(link.getAttribute('href'), `/freunde/nachrichten/${BO}`);
  assert.match(row.textContent, /bo/);
  assert.equal(row.textContent.includes(dom.run("tn(2, 'inbox.dm.titleOne', 'inbox.dm.titleMany', { name: 'bo' })")), true);
  // A round thread is untouched by the branch.
  const roundRow = dom.run(`renderChatUnreadItem({ id: 'i2', read: false, type: 'chat_unread',
    payload: { thread: 'round:r1', roundId: 'r1', roundName: 'Freitag', count: 1 } })`);
  assert.equal(roundRow.querySelector('.inbox-row__chat').getAttribute('href'), '/round/r1/chat');
});
