'use strict';

/*
 * Session comments in the frontend (#1782), run in the jsdom harness
 * (.claude/rules/testing-views-under-jsdom.md): the result screen's thread, the
 * context line a comment carries on the Chat tab, and the Chronik row's count.
 * The thread machinery itself is the round chat's and is covered by
 * test/round-chat-view.test.js; this file pins what differs.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

function chatApp(t, { loggedIn = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => loggedIn);
  dom.set('isLoggedIn', () => loggedIn);
  dom.run('setContactAvailable(false)');
  return dom;
}

const SESSION = { id: 's1', createdAt: '2026-11-10T19:00:00.000Z', gameIds: ['g1'], chosenGameId: 'g1' };
const ROUND = {
  id: 'r1', name: 'Runde', members: [],
  games: [{ id: 'g1', title: 'Catan' }],
  sessions: [SESSION],
};
const msg = (over) => ({ id: 'm1', seq: 1, text: 'hi', createdAt: '2026-11-12T10:00:00.000Z',
  author: { username: 'bea', avatar: null }, own: false, ...over });

test('no thread on the result screen outside accounts mode', (t) => {
  const dom = chatApp(t, { loggedIn: false });
  assert.equal(dom.call('renderSessionComments', ROUND, SESSION), null);
});

test('the result screen mounts ONE session\'s thread, without the round-wide clean-up', async (t) => {
  const dom = chatApp(t);
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push([method, url]);
    if (method === 'GET') return { messages: [msg({ sessionId: 's1' })], hasMore: false, lastRead: 0 };
    if (url.endsWith('/read')) return { lastRead: body.seq };
    return {};
  });
  const wrap = dom.call('renderSessionComments', ROUND, SESSION); // the owner: a moderator
  dom.app.appendChild(wrap);
  await flush();

  assert.equal(wrap.querySelector('h2').textContent, 'Kommentare');
  assert.equal(calls[0][1], '/api/rounds/r1/sessions/s1/messages', 'the session\'s own thread');
  const row = wrap.querySelector('.chat-msg');
  assert.ok(row);
  assert.equal(row.querySelector('.chat-msg__context'), null, 'no „zu: …" line on the session\'s own thread');
  const acts = [...row.querySelectorAll('.chat-msg__act')].map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(acts, ['Löschen'], 'a moderator deletes, but the per-person clean-up stays on the Chat tab');
  const input = wrap.querySelector('textarea.chat__input');
  assert.equal(input.id, 'sessionCommentInput');
  assert.equal(wrap.querySelector('label').htmlFor, 'sessionCommentInput', 'the label still names its field');
  assert.ok(calls.some(([m, u]) => m === 'POST' && u === '/api/rounds/r1/sessions/s1/messages/read'));
});

test('on the Chat tab a session comment names and links its session', async (t) => {
  const dom = chatApp(t);
  dom.set('api', async (method) => (method === 'GET'
    ? { messages: [msg({ id: 'r', seq: 1, text: 'Runde' }), msg({ id: 'c', seq: 2, text: 'Snacks?', sessionId: 's1' }),
      msg({ id: 'x', seq: 3, text: 'neu', sessionId: 'unknown' })], hasMore: false, lastRead: 3 }
    : {}));
  dom.app.innerHTML = '';
  await dom.call('renderChatTab', ROUND);
  await flush();
  const [roundRow, commentRow, unknownRow] = dom.app.querySelectorAll('.chat-msg');
  assert.equal(roundRow.querySelector('.chat-msg__context'), null, 'a round message has no context line');
  const ctx = commentRow.querySelector('a.chat-msg__context');
  assert.ok(ctx, 'a session comment carries its context line');
  assert.match(ctx.textContent, /^zu: Catan, /);
  assert.equal(ctx.getAttribute('href'), dom.call('resultsPath', 'r1', 's1'), 'links to the session\'s own screen');
  const stale = unknownRow.querySelector('.chat-msg__context');
  assert.equal(stale.textContent, 'zu einer Session', 'a session the snapshot lacks still gets a line');
  assert.equal(stale.hasAttribute('href'), false, 'but no link to a screen that cannot load it');
});

test('a Chronik card gets its count once the counts arrive, and loses a stale one', async (t) => {
  const dom = chatApp(t);
  let counts = { s1: 3 };
  dom.set('api', async () => ({ counts }));
  const card = dom.window.document.createElement('a');
  card.innerHTML = '<div class="session-card__title">Catan</div>';
  dom.app.appendChild(card);
  const cards = dom.run('[]');
  cards.push([card, 's1']);
  await dom.call('loadSessionCommentBadges', ROUND, cards);
  const badge = card.querySelector('.session-card__comments');
  assert.ok(badge);
  assert.equal(badge.querySelector('.sr-only').textContent, '3 Kommentare');

  counts = {};
  await dom.call('loadSessionCommentBadges', ROUND, cards);
  assert.equal(card.querySelector('.session-card__comments'), null, 'a refreshed zero removes the badge');
});
