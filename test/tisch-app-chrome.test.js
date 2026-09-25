'use strict';

/* Der Tisch's APP CHROME (#1279): the brass „SPIELWIRBEL" plate, the lobby's
 * „Spielecafé · deine Tische" kicker, the account button as avatar + name —
 * and the desktop lobby's „Neue Runde gründen" table, whose label rendered
 * above its dashed circle instead of inside it.
 *
 * Two instruments, as in tisch-hub-lobby.test.js. The DOM half runs the real
 * views under jsdom and pins BOTH designs: Klassisch's markup must be exactly
 * what shipped before this change (the issue's first acceptance criterion),
 * and Tisch's must carry the new pieces. The geometry half is CSS text, because
 * jsdom lays nothing out — it pins the declarations the fix rests on, and the
 * label-inside-circle measurement itself stays a browser probe.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, mediaBlocks } = require('./support/css');

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The account button exactly as index.html ships it — Klassisch's face.
const KLASSISCH_ACCOUNT = '<i class="ti ti-user" aria-hidden="true"></i><span id="newsDot" class="topbar-dot" hidden=""></span>';

const ROUNDS = [{
  id: 1, name: 'Donnerstagsrunde', members: [{ id: 1, name: 'Ada' }], gameCount: 3, playedCount: 1,
  background: null, marker: 2, openSessions: [], lastPlayed: null,
}];

function boot(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => false);
  dom.set('api', async () => ROUNDS);
  dom.call('applyStaticTexts'); // main.js's first call, which the harness skips
  if (design) dom.call('applyDesign', design);
  return dom;
}

// A logged-in account for the top-bar half.
function login(dom) {
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('accountApi', async () => ({ items: [] }));
  dom.set('hasUnseenNews', () => false); // the dot's state is not this spec's business
  dom.context.__user = { id: 'u1', username: 'ada', email: 'a@example.com' };
  dom.run('accountUser = __user');
}

const acct = (dom) => dom.document.getElementById('accountBtn');
const context = (dom) => dom.document.getElementById('context');

/* ------------------------------- Klassisch -------------------------------- */

test('Klassisch: the lobby head, the context slot and the home link are what they were', async (t) => {
  const dom = boot(t);
  dom.call('applyStaticTexts');
  await dom.call('showHome');
  const head = dom.app.querySelector('.lobby-head');
  assert.deepEqual([...head.children].map((el) => el.className || el.tagName),
    ['H1', 'muted lobby-head__sub'], 'Klassisch lobby head gained or lost a child');
  assert.equal(dom.app.querySelector('.lobby-head__kicker'), null, 'Klassisch renders the Tisch kicker');
  assert.equal(context(dom).textContent, '', 'Klassisch home has a context label');
  assert.equal(context(dom).className, 'topbar__context', 'Klassisch context slot gained a class');
  const home = dom.document.getElementById('homeBtn');
  assert.equal(home.getAttribute('aria-label'), dom.run("t('a11y.home')"));
});

test('Klassisch: the account button keeps index.html\'s glyph, class and label', (t) => {
  const dom = boot(t);
  login(dom);
  dom.call('setupAccountUi');
  assert.equal(acct(dom).innerHTML, KLASSISCH_ACCOUNT, 'Klassisch account button markup changed');
  assert.equal(acct(dom).className, 'topbar__acct');
  assert.equal(acct(dom).getAttribute('aria-label'), 'Konto');
});

test('switching Tisch → Klassisch restores the Klassisch account button byte for byte', (t) => {
  const dom = boot(t, 'tisch');
  login(dom);
  dom.call('setupAccountUi');
  assert.ok(acct(dom).querySelector('.topbar__avatar'), 'precondition: Tisch drew its face');
  dom.call('applyDesign', 'klassisch');
  assert.equal(acct(dom).innerHTML, KLASSISCH_ACCOUNT);
  assert.equal(acct(dom).className, 'topbar__acct');
  assert.equal(acct(dom).getAttribute('aria-label'), 'Konto');
});

/* --------------------------------- Tisch ---------------------------------- */

test('Tisch: the lobby carries the kicker twice — in the bar and above the greeting', async (t) => {
  const dom = boot(t, 'tisch');
  await dom.call('showHome');
  const kicker = dom.run("t('home.tischKicker')");
  assert.equal(kicker, 'Spielecafé · deine Tische');
  const head = dom.app.querySelector('.lobby-head');
  assert.equal(head.firstElementChild.className, 'lobby-head__kicker', 'the kicker is not the head\'s first line');
  assert.equal(head.firstElementChild.textContent, kicker);
  assert.equal(context(dom).textContent, kicker);
  assert.ok(context(dom).classList.contains('topbar__context--kicker'));
  // Any other screen's setContext clears the mark along with the text.
  dom.call('setContext', 'Donnerstagsrunde');
  assert.equal(context(dom).classList.contains('topbar__context--kicker'), false,
    'a round name inherited the kicker styling');
});

test('Tisch: the account button is avatar + name, and its label contains the name', (t) => {
  const dom = boot(t, 'tisch');
  login(dom);
  dom.call('setNewsDot', true);
  dom.call('setupAccountUi');
  const btn = acct(dom);
  assert.equal(btn.querySelector('.topbar__avatar').textContent, 'AD');
  assert.equal(btn.querySelector('.topbar__avatar').getAttribute('aria-hidden'), 'true');
  assert.equal(btn.querySelector('.topbar__name').textContent, 'ada');
  assert.ok(btn.classList.contains('topbar__acct--face'));
  assert.equal(btn.getAttribute('aria-label'), 'Konto: ada', 'WCAG 2.5.3: the visible name is not in the label');
  assert.ok(btn.contains(dom.document.getElementById('newsDot')), 'the „Was ist neu" dot was lost');
  // applyStaticTexts (the language switch) must not drop the name again.
  dom.call('applyStaticTexts');
  assert.equal(btn.getAttribute('aria-label'), 'Konto: ada');
});

test('Tisch: logging out takes the name off the button', (t) => {
  const dom = boot(t, 'tisch');
  login(dom);
  dom.call('setupAccountUi');
  dom.set('isLoggedIn', () => false);
  dom.run('accountUser = null');
  dom.call('setupAccountUi');
  assert.equal(acct(dom).querySelector('.topbar__name'), null);
  assert.equal(acct(dom).hidden, true);
});

test('Tisch: the plate is the home link\'s own text, and its accessible name is unchanged', (t) => {
  const dom = boot(t, 'tisch');
  dom.call('applyStaticTexts');
  const home = dom.document.getElementById('homeBtn');
  assert.equal(home.querySelector('.topbar__word').textContent, dom.run("t('app.title')"));
  assert.equal(home.getAttribute('aria-label'), dom.run("t('a11y.home')"));
  assert.equal(home.querySelector('img'), null, 'the plate must be text, not an image');
});

/* ------------------------------- the geometry ----------------------------- */

const desktopLobby = () => {
  const block = mediaBlocks(SHEET).find(([q]) => /min-width:\s*1100px/.test(q));
  assert.ok(block, 'the 1100px lobby block is gone');
  return rulesOf(block[1]);
};

test('the new-round table is a flex column, and it outranks the table card\'s display: block', () => {
  /* The bug: `.round-card { display: block }` in this block made the new card a
     block, so its label flowed at the TOP of the 392px card while the dashed
     circle is centred 170px down. The flex rule must beat that rule on
     specificity, not on source order. */
  const rules = desktopLobby();
  const own = rules.filter(([sel]) => /\.round-card\.round-card--new$/.test(sel.trim()));
  assert.equal(own.length, 1, 'no compounded .round-card.round-card--new rule in the 1100px block');
  const body = own[0][1];
  assert.match(body, /display:\s*flex/);
  assert.match(body, /flex-direction:\s*column/);
  assert.match(body, /justify-content:\s*center/);
  assert.match(body, /align-items:\s*center/);
});

test('the new-round label is centred on the circle: its content box is centred at --table-y', () => {
  /* With the card border-box and height --card-h, a bottom padding of
     (--card-h − 2·--table-y) leaves a content box 2·--table-y tall starting at
     the top, i.e. centred exactly where the circle's ::before is centred. */
  const rules = desktopLobby();
  const body = rules.find(([sel]) => /\.round-card\.round-card--new$/.test(sel.trim()))[1];
  assert.match(body, /height:\s*var\(--card-h\)/);
  assert.match(body, /padding-bottom:\s*calc\(var\(--card-h\)\s*-\s*2\s*\*\s*var\(--table-y\)\)/);
  assert.match(body, /padding-inline:\s*calc\(50%\s*-\s*var\(--table-d\)\s*\/\s*2\s*\+\s*\d+px\)/,
    'the label is not held inside the circle\'s width');
  const circle = rules.find(([sel]) => /\.round-card--new::before$/.test(sel.trim()));
  assert.ok(circle, 'the dashed circle rule is gone');
  assert.match(circle[1], /top:\s*var\(--table-y\)/);
  // The old fix nudged `> *`, which cannot reach the label: it is a TEXT node.
  assert.equal(rules.filter(([sel]) => /\.round-card--new\s*>\s*\*/.test(sel)).length, 0,
    'a child-offset rule is back — it moves the icon and leaves the text where it was');
});

test('the chrome rules are scheme-gated and the account face keeps `hidden` working', () => {
  const all = rulesOf(SHEET.replace(/@media[^{]+\{/g, ''));
  const chrome = all.filter(([sel]) => /topbar|lobby-head__kicker/.test(sel));
  assert.ok(chrome.length >= 8, `only ${chrome.length} chrome rules found — did the section move?`);
  for (const [sel] of chrome) {
    assert.match(sel, /:root\[data-design="tisch"\]\[data-scheme="dark"\]/, `${sel} is not scheme-gated`);
  }
  for (const [sel, body] of chrome.filter(([s]) => /topbar__acct/.test(s))) {
    if (/display:/.test(body)) assert.match(sel, /:not\(\[hidden\]\)/, `${sel} would un-hide a logged-out button`);
  }
  // At (0,4,0) a display on the plate beats `body.auth-screen .topbar__home
  // { display: none }` and puts it on the sign-in screens.
  for (const [sel, body] of chrome.filter(([s]) => /\.topbar__home$/.test(s.trim()))) {
    assert.doesNotMatch(body, /display:/, `${sel} would show the plate on the auth screens`);
  }
});
