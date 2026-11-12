'use strict';

/*
 * The inbox row for an unread chat thread (#1784, renderChatUnreadItem in
 * views-round-chat.js) under jsdom: it names the round and the count through the
 * plural pair, links to the round's Chat tab, and dismisses through the shared
 * inbox route. The server half is test/chat-inbox.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

async function inbox(t, items) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('refreshInboxBadge', () => {});
  dom.set('setInboxDot', () => {});
  dom.set('showHome', () => {});
  const calls = [];
  const opened = [];
  dom.set('accountApi', async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path === '/inbox') return { items: items.map((i) => ({ ...i })) };
    return {};
  });
  dom.set('showRound', (rid, sub) => { opened.push([rid, sub]); });
  await dom.call('showInbox');
  return { dom, calls, opened };
}

const item = (id, count, roundName, read = false) => ({
  id, type: 'chat_unread', read, createdAt: '2026-11-12T18:00:00Z',
  payload: { thread: `round:r-${id}`, roundId: `r-${id}`, roundName, count },
});

test('a chat row states the count in the right plural and the round by name, as text', async (t) => {
  const { dom } = await inbox(t, [item('a', 3, 'Spieleabend'), item('b', 1, '<b>Familie</b>', true)]);
  const rows = [...dom.document.querySelectorAll('.inbox-row--chat')];
  assert.equal(rows.length, 2, 'the chat type has its own row, not the generic one');
  assert.equal(rows[0].querySelector('.ds-row__date').textContent.trim(), '3 neue Nachrichten in »Spieleabend«');
  assert.equal(rows[1].querySelector('.ds-row__date').textContent.trim(), '1 neue Nachricht in »<b>Familie</b>«',
    'singular for one, and a round name is text, never markup');
  assert.equal(rows[1].querySelector('b'), null);
  assert.ok(rows[0].querySelector('.inbox-row__dot'), 'unread rows carry the dot');
  assert.equal(rows[1].querySelector('.inbox-row__dot'), null);
});

test('the row opens the round\'s Chat tab, and dismisses through the inbox route', async (t) => {
  const { dom, calls, opened } = await inbox(t, [item('a', 2, 'Spieleabend')]);
  const link = dom.document.querySelector('.inbox-row__chat');
  assert.equal(link.getAttribute('href'), '/round/r-a/chat');
  link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(opened, [['r-a', 'chat']]);

  dom.document.querySelector('.inbox-row__del').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.includes('DELETE /inbox/a'), calls.join(', '));
});
