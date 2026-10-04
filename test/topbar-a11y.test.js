'use strict';

/* Two top-bar controls that announced the wrong thing (audit 2026-10-04).

   A2 / A-009 — `#inboxBtn` was a <button> whose click called showInbox(): a
   route change wearing a button's role, so Cmd/Ctrl/middle-click did nothing,
   there was no "Copy link address", and a screen reader announced a button
   where the destination is a page. It is a real <a href="/inbox"> wired with
   navLink now, the shape #loginBtn beside it has had since #1090
   (.claude/rules/in-app-nav-links.md).

   A4 / SC 4.1.2 — `#accountBtn` opens a menu but never carried
   `aria-expanded`, while its neighbours #designBtn and #moreBtn always did. It
   is synced through openPopover's onClose (never by wrapping `close`, which
   misses four of the six exits — .claude/rules/popover-vs-sheet-editors.md §2b),
   and like them it is a toggle.

   Both driven through the jsdom harness (.claude/rules/testing-views-under-jsdom.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { bodyOf } = require('./support/css');

function boot(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('accountApi', async () => ({ items: [] }));
  dom.context.__user = { id: 'u1', username: 'ada', email: 'a@example.com' };
  dom.run('accountUser = __user');
  const inboxCalls = [];
  dom.set('showInbox', () => { inboxCalls.push(1); });
  dom.call('setupAccountUi');
  return { dom, doc: dom.document, inboxCalls };
}

/* Record whether the SPA swallowed a click, then block the browser's own
   default either way — a modified click's default action would otherwise be a
   navigation (.claude/rules/in-app-nav-links.md §1: probe the decision). */
function clickSink(dom) {
  const seen = [];
  dom.document.addEventListener('click', (e) => { seen.push(e.defaultPrevented); e.preventDefault(); }, false);
  return seen;
}

/* ------------------------------------------------------------------ A2 inbox */

test('the inbox control is a real link to /inbox', (t) => {
  const { doc } = boot(t);
  const inbox = doc.getElementById('inboxBtn');
  assert.equal(inbox.tagName, 'A', 'the inbox is a route change — it must be an <a>, not a <button>');
  assert.equal(inbox.getAttribute('href'), '/inbox');
  assert.ok(inbox.classList.contains('nav-link'), 'not wired through navLink()');
  assert.equal(inbox.hidden, false, 'precondition: shown while logged in');
  assert.ok(inbox.getAttribute('aria-label'), 'the icon-only link lost its accessible name');
});

test('a plain click opens the inbox in-app; a Cmd-click is left to the browser', (t) => {
  const { dom, doc, inboxCalls } = boot(t);
  const seen = clickSink(dom);
  const inbox = doc.getElementById('inboxBtn');

  // Modified first: a plain click may re-render (in-app-nav-links.md §1).
  inbox.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true }));
  assert.deepEqual(seen, [false], 'a Cmd-click was swallowed — no new tab');
  assert.equal(inboxCalls.length, 0, 'and the SPA navigated this tab as well');

  inbox.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.deepEqual(seen, [false, true], 'a plain click was not routed in-app');
  assert.equal(inboxCalls.length, 1, 'showInbox did not run exactly once');
});

test('every login transition leaves exactly ONE click handler on the link', (t) => {
  // setupAccountUi runs on boot, login, logout and session-lost; a navLink()
  // call inside it would stack a listener per transition.
  const { dom, doc, inboxCalls } = boot(t);
  dom.call('setupAccountUi');
  dom.call('setupAccountUi');
  clickSink(dom);
  doc.getElementById('inboxBtn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal(inboxCalls.length, 1, `one click opened the inbox ${inboxCalls.length} times`);
});

test('folded into „…", the inbox row still opens the inbox in-app', (t) => {
  // The „…" menu runs each folded control by CLICKING it (topbar-overflow.js),
  // so the row's path is now an anchor's click — it must reach navLink's
  // handler and route in-app, not fall through to a full page navigation.
  const { dom, doc, inboxCalls } = boot(t);
  dom.set('topbarRoom', () => ({ available: 60, gap: 10 }));
  dom.set('topbarWidth', (el) => (el && el.id === 'context' ? null : 38));
  dom.call('fitTopbar');
  assert.ok(doc.getElementById('inboxBtn').dataset.folded, 'precondition: the inbox folded');
  const seen = clickSink(dom);
  dom.call('openMoreMenu', doc.getElementById('moreBtn'));
  const row = [...doc.querySelectorAll('.popover .popover__opt')]
    .find((b) => b.textContent.trim() === doc.getElementById('inboxBtn').getAttribute('aria-label'));
  assert.ok(row, 'the folded inbox has no row in „…"');
  row.click();
  assert.equal(inboxCalls.length, 1, 'the row did not open the inbox');
  assert.ok(seen.includes(true), 'the anchor\'s click was not swallowed — the browser would reload the page');
});

test('the link draws exactly like the icon BUTTONS beside it', () => {
  /* Measured in the Browser pane in all six designs: a bare <a> came out 41px
     tall in Klassisch beside 35px buttons (the body's line height instead of the
     control font's), and in Forest's 44px pill its icon sat 2.5px from the top
     instead of centred. These three declarations are what the <button> had for
     free; with them the link matched to the pixel everywhere. */
  const body = bodyOf('a.topbar__acct:not(.topbar__login)');
  assert.ok(body, 'the rule that makes an icon LINK match the icon buttons is gone');
  assert.match(body, /font:\s*-webkit-small-control/, 'a button takes the UA control font — and its line height');
  assert.match(body, /text-align:\s*center/, 'a button centres its content across');
  assert.match(body, /align-content:\s*center/, 'a button centres its content down (Forest\'s 44px pill)');
  // The shorthand resets the size, so the size must be restated AFTER it.
  assert.ok(body.indexOf('font-size') > body.indexOf('font:'), 'font-size must follow the font shorthand that resets it');
  assert.doesNotMatch(body, /(^|[\s;])display:/, 'a display here would un-hide the link for a logged-out visitor');
});

/* ------------------------------------------------------------ A4 account menu */

test('the account button says whether its menu is open, through every exit', (t) => {
  const { dom, doc } = boot(t);
  const btn = doc.getElementById('accountBtn');
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'closed, it must say so — not omit the state');

  btn.focus(); // a keyboard user's Enter: the button holds focus when it opens
  btn.click();
  assert.ok(doc.querySelector('.popover'), 'the account menu did not open');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');

  // Escape — an exit the popover owns, not the button.
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(doc.querySelector('.popover'), null);
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'aria-expanded stuck on true after Escape');
  assert.equal(doc.activeElement, btn, 'focus did not return to the account button');

  // A menu ROW — the exit through the `close` the builder was handed.
  btn.click();
  dom.set('showFriends', () => {});
  [...doc.querySelectorAll('.popover .popover__opt')].find((b) => /Freund/.test(b.textContent)).click();
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'aria-expanded stuck on true after picking a row');
});

test('the account menu opens with focus on its first row, and a second press closes it', (t) => {
  const { doc } = boot(t);
  const btn = doc.getElementById('accountBtn');
  btn.focus();
  btn.click();
  const first = doc.querySelector('.popover .popover__opt');
  assert.equal(doc.activeElement, first, 'the menu opened with focus left on the button (A1)');

  // A toggle, like #designBtn and #moreBtn: a button that says "expanded" must
  // collapse on the next press rather than close-and-reopen.
  btn.click();
  assert.equal(doc.querySelector('.popover'), null, 'a second press re-opened the menu instead of closing it');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
});
