'use strict';

/* Infinite scroll for the Freundeskreis and profile feeds (#1357) — the client
   half, run under jsdom (.claude/rules/testing-views-under-jsdom.md).

   The Browser pane fires no IntersectionObserver at all
   (.claude/rules/preview-pane-paint-artifacts.md), so this is where the scroll
   trigger is proved: a fake observer the spec fires by hand. The guarantees:
   - the sentinel is a real <button> („Mehr laden"), usable without the observer;
   - a page APPENDS to the same grid, and the button leaves at nextCursor null;
   - one request in flight at a time, whoever asks (a click or the observer);
   - a failed load leaves a working button and does not re-arm the observer;
   - both screens ask their own route for the next page;
   - with no cursor the feed renders exactly as before (no button, no is-open). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, flush, waitFor } = require('./support/dom');

const ev = (title) => ({ type: 'game_added', username: 'dora', avatar: null, title, at: '2026-09-01T18:00:00Z', coverUrl: null });
const many = (n, prefix = 'G') => Array.from({ length: n }, (_, i) => ev(`${prefix}${i}`));

function boot(t, { io = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const observers = [];
  if (io) {
    dom.set('IntersectionObserver', class {
      constructor(cb) { this.cb = cb; this.observed = []; this.log = []; this.disconnected = false; observers.push(this); }
      observe(el) { this.observed.push(el); this.log.push('observe'); }
      unobserve(el) { this.observed = this.observed.filter((x) => x !== el); this.log.push('unobserve'); }
      disconnect() { this.disconnected = true; this.observed = []; }
      fire(isIntersecting = true) { this.cb(this.observed.map((target) => ({ target, isIntersecting }))); }
    });
  }
  return { dom, observers };
}

const loadBtn = (wrap) => wrap.querySelector('.e-feed__load button');
const titles = (wrap) => [...wrap.querySelectorAll('.e-tile__title')].map((x) => x.textContent);

test('no cursor, no pager: the feed renders exactly as it did before paging', (t) => {
  const { dom } = boot(t);
  const wrap = dom.call('renderFeedTiles', many(3), { more: { nextCursor: null, load: () => assert.fail('loaded') } });
  assert.equal(wrap.querySelector('.e-feed__load'), null);
  assert.equal(wrap.classList.contains('is-open'), false);
  const plain = dom.call('renderFeedTiles', many(3));
  assert.equal(plain.querySelector('.e-feed__load'), null);
});

test('„Mehr laden" is a real button, and a click appends the next page to the same grid', async (t) => {
  const { dom } = boot(t);
  const calls = [];
  const pages = { c1: { events: many(2, 'P2-'), nextCursor: 'c2' }, c2: { events: many(1, 'P3-'), nextCursor: null } };
  const wrap = dom.call('renderFeedTiles', many(3), { more: { nextCursor: 'c1', load: async (cur) => { calls.push(cur); return pages[cur]; } } });
  const grid = wrap.querySelector('.e-grid');
  const btn = loadBtn(wrap);
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.type, 'button');
  assert.equal(btn.textContent, dom.run("t('friends.feedLoadMore')"));
  // Three events, so no expander — the list opens now, or page two arrives hidden.
  assert.ok(wrap.classList.contains('is-open'));

  btn.click();
  await waitFor(() => titles(wrap).length === 5, { label: 'page two appended' });
  assert.equal(wrap.querySelector('.e-grid'), grid, 'appended, not re-rendered');
  assert.deepEqual(titles(wrap), ['G0', 'G1', 'G2', 'P2-0', 'P2-1']);
  assert.ok(loadBtn(wrap), 'more to come, so the button stays');

  loadBtn(wrap).click();
  await waitFor(() => titles(wrap).length === 6, { label: 'page three appended' });
  assert.deepEqual(calls, ['c1', 'c2']);
  assert.equal(wrap.querySelector('.e-feed__load'), null, 'nextCursor null removes the button');
});

test('one request in flight: a second click while loading asks for nothing', async (t) => {
  const { dom } = boot(t);
  let release;
  const calls = [];
  const wrap = dom.call('renderFeedTiles', many(2), { more: { nextCursor: 'c1', load: (cur) => { calls.push(cur); return new Promise((r) => { release = r; }); } } });
  const btn = loadBtn(wrap);
  btn.click();
  btn.click();
  btn.click();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, dom.run("t('friends.feedLoading')"));
  release({ events: many(1, 'N'), nextCursor: 'c2' });
  await waitFor(() => !btn.disabled, { label: 'the button is released' });
  assert.equal(btn.textContent, dom.run("t('friends.feedLoadMore')"));
});

test('a failed load leaves a working button, appends nothing and does not re-arm the observer', async (t) => {
  const { dom, observers } = boot(t, { io: true });
  let fail = true;
  const wrap = dom.call('renderFeedTiles', many(2), { more: { nextCursor: 'c1', load: async () => { if (fail) throw new Error('offline'); return { events: many(1, 'R'), nextCursor: null }; } } });
  const btn = loadBtn(wrap);
  const io = observers[0];
  io.fire();
  await waitFor(() => !btn.disabled, { label: 'the failed load settles' });
  assert.equal(titles(wrap).length, 2);
  assert.deepEqual(io.log, ['observe'], 'no re-observe after a failure, or an outage becomes a request loop');
  // …and the retry works.
  fail = false;
  btn.click();
  await waitFor(() => titles(wrap).length === 3, { label: 'the retry appended' });
});

test('the observer clicks the button when it scrolls into view, re-arms per page, and disconnects at the end', async (t) => {
  const { dom, observers } = boot(t, { io: true });
  const calls = [];
  const pages = { c1: { events: many(1, 'A'), nextCursor: 'c2' }, c2: { events: many(1, 'B'), nextCursor: null } };
  const wrap = dom.call('renderFeedTiles', many(2), { more: { nextCursor: 'c1', load: async (cur) => { calls.push(cur); return pages[cur]; } } });
  assert.equal(observers.length, 1);
  const io = observers[0];
  assert.deepEqual(io.observed, [loadBtn(wrap)], 'the observer watches the button itself');

  io.fire(false);
  await flush();
  assert.equal(calls.length, 0, 'not intersecting: nothing loads');

  io.fire(true);
  await waitFor(() => titles(wrap).length === 3, { label: 'the observer loaded page two' });
  // Re-observed, so a short page that leaves the button in view fires again.
  assert.deepEqual(io.log, ['observe', 'unobserve', 'observe']);

  io.fire(true);
  await waitFor(() => titles(wrap).length === 4, { label: 'the observer loaded page three' });
  assert.deepEqual(calls, ['c1', 'c2']);
  assert.ok(io.disconnected, 'no cursor left: the observer is disconnected');
  assert.equal(wrap.querySelector('.e-feed__load'), null);
});

test('a collapsed list keeps its expander, and the paging button hides behind the same collapse', (t) => {
  const { dom } = boot(t);
  const wrap = dom.call('renderFeedTiles', many(12), { more: { nextCursor: 'c1', load: async () => ({ events: [], nextCursor: null }) } });
  assert.equal(wrap.classList.contains('is-open'), false, 'more than eight: collapsed until „Alle anzeigen"');
  assert.ok(wrap.querySelector('.e-feed__more'));
  assert.ok(loadBtn(wrap));

  // jsdom applies no stylesheet, so the collapse itself is read from the CSS.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = css.match(/@media \(max-width: 1023px\) \{([^{}]*\{[^{}]*\})*[^{}]*\}/g)
    .find((b) => b.includes('.e-feed:not(.is-open) .e-tile'));
  assert.match(block, /\.e-feed:not\(\.is-open\) \.e-feed__load \{ display: none; \}/);
});

/* ------------------------------ the two screens --------------------------- */

test('the Freundeskreis asks /friends/feed?before= for the next page', async (t) => {
  const { dom } = boot(t);
  const paths = [];
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('refreshInboxBadge', () => {});
  dom.set('accountApi', async (method, p) => {
    paths.push(p);
    if (p === '/friends') return { friends: [], incoming: [], outgoing: [] };
    if (p === '/friends/feed') return { friendCount: 1, events: many(3), nextCursor: 'abc_-1' };
    return { events: many(2, 'Later'), nextCursor: null };
  });
  await dom.call('showFriends');
  loadBtn(dom.app).click();
  await waitFor(() => titles(dom.app).length === 5, { label: 'the next page rendered' });
  assert.equal(paths[paths.length - 1], '/friends/feed?before=abc_-1');
});

test('a profile asks its own feed route for the next page', async (t) => {
  const { dom } = boot(t);
  const paths = [];
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('accountApi', async (method, p) => {
    paths.push(p);
    if (p === '/profile/dora') {
      return { userId: 'u1', username: 'dora', avatar: null, self: false, friendship: 'friends', events: many(3), nextCursor: 'xyz' };
    }
    return { events: [{ type: 'game_added', title: 'Later', at: '2026-08-01T18:00:00Z', coverUrl: null }], nextCursor: null };
  });
  await dom.call('showProfile', 'dora');
  loadBtn(dom.app).click();
  await waitFor(() => titles(dom.app).length === 4, { label: 'the next profile page rendered' });
  assert.equal(paths[paths.length - 1], '/profile/dora/feed?before=xyz');
  assert.equal(dom.app.querySelector('.e-feed__load'), null);
});
