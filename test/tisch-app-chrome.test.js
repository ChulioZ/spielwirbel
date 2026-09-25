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
const { rulesOf, mediaBlocks, bodyOf } = require('./support/css');
const theme = require('./support/theme');
const { DESIGN_REGISTRY } = require('../public/js/designs');
const { MEMBER_COLORS } = require('../public/js/member-colors');

const TISCH_DESIGN = DESIGN_REGISTRY.find((d) => d.id === 'tisch');

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

test('the „Was ist neu" dot is the SAME node, lit, across Tisch → Klassisch → Tisch (#1326)', (t) => {
  // renderAccountFace MOVES #newsDot, never rebuilds it — a rebuilt one would
  // come back unlit, and the badge would silently stop showing after a switch.
  const dom = boot(t, 'tisch');
  login(dom);
  dom.call('setupAccountUi');
  dom.call('setNewsDot', true);
  const dot = dom.document.getElementById('newsDot');
  assert.ok(acct(dom).querySelector('.topbar__avatar'), 'precondition: Tisch drew its face');
  for (const design of ['klassisch', 'tisch']) {
    dom.call('applyDesign', design);
    const now = dom.document.getElementById('newsDot');
    assert.equal(now, dot, `the dot was rebuilt on the switch to ${design}`);
    assert.equal(now.parentElement, acct(dom), `the dot left the account button on ${design}`);
    assert.equal(now.hidden, false, `the dot went dark on the switch to ${design}`);
  }
  dom.call('setNewsDot', false);
  assert.equal(dot.hidden, true, 'setNewsDot no longer reaches the moved dot');
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

/* ------------------------- the news / inbox badge (#1326) ------------------ */

const TISCH = ':root[data-design="tisch"][data-scheme="dark"]';
const badgeRule = (sel) => {
  const hits = rulesOf(SHEET).filter(([s]) => s === `${TISCH} ${sel}`);
  assert.equal(hits.length, 1, `expected exactly one Tisch rule for ${sel}`);
  return hits[0][1];
};
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+)`).exec(body);
  return m ? m[1].trim() : null;
};

test('Tisch: both top-bar dots are ringed 14px badges, and the account one sits on the avatar', () => {
  const dot = badgeRule('.topbar-dot');
  assert.equal(decl(dot, 'width'), '14px');
  assert.equal(decl(dot, 'height'), '14px');
  assert.equal(decl(dot, 'background'), 'var(--danger)');
  assert.equal(decl(dot, 'border'), '2px solid var(--control-fill)');
  assert.equal(decl(dot, 'display'), null, 'a display would defeat the dot\'s `hidden` toggle');
  // Anchored from the LEFT to the 32px disc (3px padding), so the badge is on
  // the avatar's top-right at every width instead of on the pill's rim.
  const face = badgeRule('.topbar__acct--face .topbar-dot');
  assert.equal(decl(face, 'top'), '1px');
  assert.equal(decl(face, 'left'), '23px');
  assert.equal(decl(face, 'right'), 'auto', 'styles.css\'s right: 3px would stretch the badge across the pill');
});

test('Tisch: every boundary of the badge clears 3:1 — disc | ring and ring | core (SC 1.4.11)', (t) => {
  /* No flat colour clears 3:1 against both the lifted discs and --control-fill
     (the tisch.css comment has why), so the RING carries the disc side. The
     tokens are read out of the shipped rule and the discs out of the shipped
     memberTone(), so a retune of either lands here. */
  const body = badgeRule('.topbar-dot');
  const core = theme.evaluate(decl(body, 'background'), TISCH_DESIGN);
  const ring = theme.evaluate(decl(body, 'border').replace(/^2px solid /, ''), TISCH_DESIGN);
  const fill = theme.token('--control-fill', TISCH_DESIGN);
  const dom = boot(t, 'tisch');
  const failures = [];
  const ringCore = theme.contrast(ring, core);
  if (ringCore < 3) failures.push(`core on ring ${ringCore.toFixed(2)}`);
  for (const c of MEMBER_COLORS) {
    const disc = theme.evaluate(dom.run(`memberTone(${JSON.stringify(c)})`), TISCH_DESIGN);
    const r = theme.contrast(ring, disc);
    if (r < 3) failures.push(`ring on ${c} disc ${r.toFixed(2)}`);
  }
  // The ring IS the button fill, so on the fill side the core is the boundary.
  const onFill = theme.contrast(core, fill);
  if (onFill < 3) failures.push(`core on --control-fill ${onFill.toFixed(2)}`);
  assert.deepEqual(failures, []);
});

test('Klassisch: styles.css\'s .topbar-dot is exactly what it was', () => {
  const body = bodyOf('.topbar-dot');
  assert.ok(body, 'the Klassisch .topbar-dot rule is gone');
  for (const [prop, value] of [['position', 'absolute'], ['top', '3px'], ['right', '3px'], ['width', '8px'],
    ['height', '8px'], ['border-radius', '50%'], ['background', 'var(--brand)'], ['border', '1px solid var(--surface)']]) {
    assert.equal(decl(body, prop), value, `Klassisch .topbar-dot ${prop} changed`);
  }
});
