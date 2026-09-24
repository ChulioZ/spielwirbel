'use strict';

/* Der Tisch's split sign-in (#1266, T5.1 / T5.4).
 *
 * Under Der Tisch, login and register are composed as the sheet's split
 * screen: a promise panel beside the form, the form headed by an
 * „Anmelden | Registrieren" segmented control that replaces the logo and the
 * two cross-links. Under Klassisch nothing moves — that half is asserted as
 * the card's exact child sequence, so ANY structural leak of the Tisch branch
 * into the default path goes red here rather than on a screenshot.
 *
 * The CSS half (the side-by-side board at 860px+, the collapsed panel on a
 * phone) cannot be seen by jsdom, which applies no external stylesheet; it was
 * checked in a real browser at 390 and 1440.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

function boot(t, design, cfg = { footer: false }) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  dom.set('withAppConfig', (cb) => cb(cfg));
  dom.set('authFetch', () => new Promise(() => {}));
  return dom;
}

// The card's element children, each named by its first class or its id —
// the structure a Klassisch visitor sees, in order.
const shape = (card) => [...card.children].map((el) =>
  (el.id ? `#${el.id}` : '') || el.classList[0] || el.tagName.toLowerCase());

const click = (dom, el) => {
  const ev = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  el.dispatchEvent(ev);
  return ev;
};

/* ------------------------------ Klassisch ----------------------------------- */

test('Klassisch: the login card is exactly the single card it always was', (t) => {
  const dom = boot(t, 'klassisch');
  dom.call('showLogin');
  const wrap = dom.app.querySelector('.auth');
  assert.equal(wrap.children.length, 1, 'the auth wrapper must hold the card alone');
  const card = wrap.firstElementChild;
  assert.ok(card.matches('form.auth__card'));
  assert.deepEqual(shape(card), [
    'auth__logo', 'auth__title', 'auth__sub', 'field', 'field',
    'auth__error', 'btn', '#passkeyAlt', 'auth__links',
  ]);
  assert.deepEqual([...card.querySelectorAll('.auth__links button')].map((b) => b.id), ['toForgot', 'toRegister']);
  assert.equal(dom.document.querySelector('.auth-split, .auth-promise, .auth-seg'), null,
    'the Tisch composition leaked into Klassisch');
});

test('Klassisch: the register card keeps its logo and its „Schon ein Konto?" link', (t) => {
  const dom = boot(t, 'klassisch');
  dom.call('showRegister');
  const card = dom.app.querySelector('.auth > form.auth__card');
  assert.ok(card, 'the register card is no longer the wrapper\'s direct child');
  assert.deepEqual(shape(card), [
    'auth__logo', 'auth__title', 'auth__sub', 'field', 'field', 'field',
    'auth__error', 'btn', 'auth__terms', 'auth__links',
  ]);
  assert.ok(card.querySelector('.auth__links #toLogin'));
  assert.equal(dom.document.querySelector('.auth-split, .auth-promise, .auth-seg'), null);
});

/* -------------------------------- Der Tisch --------------------------------- */

test('Der Tisch: login is the promise panel, THEN the form — DOM order is the picture\'s', (t) => {
  const dom = boot(t, 'tisch');
  dom.call('showLogin');
  const split = dom.app.querySelector('.auth > .auth-split');
  assert.ok(split, 'no split screen under Der Tisch');
  assert.deepEqual([...split.children].map((el) => el.className), ['auth-promise', 'auth__card']);

  const card = split.querySelector('form.auth__card');
  assert.deepEqual(shape(card), [
    'auth-seg', 'auth__title', 'auth__sub', 'field', 'field',
    'auth__error', 'btn', '#passkeyAlt', 'auth__links',
  ], 'the tray heads the card, the logo is gone, and the passkey stays BELOW the submit');
  assert.deepEqual([...card.querySelectorAll('.auth__links button')].map((b) => b.id), ['toForgot'],
    'forgot-password stays; the cross-link to register is the segment now');
});

test('Der Tisch: the segments are links to the two routes, the current one aria-current', (t) => {
  const dom = boot(t, 'tisch');
  dom.call('showLogin');
  const segs = [...dom.app.querySelectorAll('nav.auth-seg a.auth-seg__item')];
  assert.equal(dom.app.querySelector('nav.auth-seg').getAttribute('aria-label'), dom.run("t('auth.seg.label')"));
  assert.deepEqual(segs.map((a) => a.getAttribute('href')), ['/login', '/register']);
  assert.deepEqual(segs.map((a) => a.getAttribute('aria-current')), ['page', null]);
  assert.deepEqual(segs.map((a) => a.textContent), [dom.run("t('auth.seg.login')"), dom.run("t('auth.seg.register')")]);
  assert.equal(dom.app.querySelector('[role="tablist"], [role="tab"]'), null, 'links, not a fake tablist');

  // The current segment is inert: swallowed, and the screen is NOT re-rendered
  // (a re-render would detach the node just clicked — the title alone reads
  // the same either way, which is why it is not the assertion).
  assert.equal(click(dom, segs[0]).defaultPrevented, true);
  assert.equal(segs[0].isConnected, true, 'clicking the current segment re-rendered the screen');

  // The other one routes in-app to the register screen, which marks itself.
  assert.equal(click(dom, segs[1]).defaultPrevented, true);
  assert.equal(dom.app.querySelector('.auth__title').textContent, dom.run("t('auth.register.title')"));
  assert.equal(dom.window.location.pathname, '/register');
  const now = [...dom.app.querySelectorAll('.auth-seg__item')];
  assert.deepEqual(now.map((a) => a.getAttribute('aria-current')), [null, 'page']);

  // And back.
  click(dom, now[0]);
  assert.equal(dom.app.querySelector('.auth__title').textContent, dom.run("t('auth.login.title')"));
  assert.equal(dom.window.location.pathname, '/login');
});

test('Der Tisch: register drops the now-empty link row and keeps everything else', (t) => {
  const dom = boot(t, 'tisch');
  dom.call('showRegister');
  const card = dom.app.querySelector('.auth-split > form.auth__card');
  assert.deepEqual(shape(card), [
    'auth-seg', 'auth__title', 'auth__sub', 'field', 'field', 'field',
    'auth__error', 'btn', 'auth__terms',
  ]);
  assert.equal(card.querySelector('#toLogin'), null);
});

test('Der Tisch: the promise is copy only — no control, no heading, and the page keeps one h1', (t) => {
  const dom = boot(t, 'tisch');
  dom.call('showLogin');
  const promise = dom.app.querySelector('.auth-promise');
  assert.equal(promise.querySelector('a, button, input, select, textarea, [tabindex], h1, h2, h3'), null);
  assert.equal(promise.querySelector('.auth-promise__claim').textContent, dom.run("t('auth.promise.claim')"));
  assert.equal(promise.querySelectorAll('.auth-promise__points li').length, 3);
  assert.equal(dom.app.querySelectorAll('h1').length, 1);
  // The tab title is still read off the form's own heading, not the claim.
  assert.ok(dom.document.title.startsWith(dom.run("t('auth.login.title')")), dom.document.title);
});

test('Der Tisch: „EU-Hosting" stays hidden unless the instance is the configured operator\'s', (t) => {
  // Before /api/config answers — or when it never does (withAppConfig swallows
  // a failed fetch) — the markup's own `hidden` is the only thing hiding it.
  const pending = boot(t, 'tisch');
  pending.set('withAppConfig', () => {});
  pending.call('showLogin');
  assert.equal(pending.app.querySelector('.auth-promise [data-operator-only]').hidden, true);

  const off = boot(t, 'tisch', { footer: false });
  off.call('showLogin');
  assert.equal(off.app.querySelector('.auth-promise [data-operator-only]').hidden, true);

  const on = boot(t, 'tisch', { footer: true });
  on.call('showLogin');
  assert.equal(on.app.querySelector('.auth-promise [data-operator-only]').hidden, false);
});

test('Der Tisch: forgot-password keeps the single card the sheet never redraws', (t) => {
  const dom = boot(t, 'tisch');
  dom.call('showForgot');
  assert.equal(dom.app.querySelector('.auth-split, .auth-promise, .auth-seg'), null);
  assert.ok(dom.app.querySelector('.auth > form.auth__card .auth__logo'));
});

/* ---------------------------------- CSS ------------------------------------- */

const fs = require('node:fs');
const path = require('node:path');
const { rulesOf, bodyOf } = require('./support/css');

const TISCH_CSS = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const TISCH_RULES = rulesOf(TISCH_CSS);
const G = ':root[data-design="tisch"][data-scheme="dark"]';

// The claimlet is given `display: inline-flex` at 860px+, which beats the UA's
// `[hidden]` — so without its paired rule „EU-Hosting" would publish on every
// instance, exactly the #322 landing-chip defect.
test('the gated trust claim keeps its paired [hidden] rule', () => {
  assert.match(bodyOf(`${G} .auth-promise__claimlet`, TISCH_RULES) || '', /display:\s*inline-flex/,
    'the claimlet no longer declares a display — re-check whether the pair below is still needed');
  assert.match(bodyOf(`${G} .auth-promise__claimlet[hidden]`, TISCH_RULES) || '', /display:\s*none/);
});

// WCAG 2.4.3: the panel precedes the form in the DOM, so no rule may move it
// visually. Scanned over every rule naming a split selector.
test('nothing in the split reorders it visually', () => {
  const split = TISCH_RULES.filter(([sel]) => /\.auth-(split|promise|seg)/.test(sel));
  assert.ok(split.length >= 10, `only ${split.length} split rules found — the scan is looking at the wrong file`);
  for (const [sel, body] of split) {
    assert.doesNotMatch(body, /(^|[;\s])order\s*:|grid-(row|column|area)\s*:|flex-direction:\s*(row|column)-reverse/,
      `${sel} reorders the split`);
  }
});

/* Contrast of every new text/ground pair, from the design's resolved tokens.
 * The panel's grounds are the two felt stops, the tray's is --sunken on the
 * walnut card, and the plate is the brass pair. Measured in a browser too
 * (DOM walk at 390 and 1440): claim/lede/points 5.38, trust line 4.79, idle
 * segment 5.34, plate and struck segment 7.80 — these pin the same pairs. */
const { contrast, token, evaluate } = require('./support/theme');
const { designById } = require('../public/js/designs');

test('every new foreground clears its floor on every ground it is painted on', () => {
  const TISCH = designById('tisch');
  const tk = (n) => token(n, TISCH);
  const felt = [tk('--felt'), tk('--felt-deep')];
  const brass = [evaluate('var(--brass-hi)', TISCH), tk('--gold-deep')];
  const pairs = [
    // [what, fg, grounds, floor]
    ['claim, lede and points on the felt', tk('--felt-ink'), felt, 4.5],
    ['trust line on the felt', tk('--felt-ink-soft'), felt, 4.5],
    ['wordmark and struck segment on the brass plate', tk('--on-accent'), brass, 4.5],
    ['idle segment on the tray', tk('--gold'), [tk('--sunken')], 4.5],
    ['point glyph on its disc', tk('--gold'), [tk('--felt-deep')], 3],
    ['disc ring on the felt', tk('--gold'), felt, 3],
    ['tray edge on the card', tk('--control-edge'), [tk('--surface')], 3],
  ];
  for (const [what, fg, grounds, floor] of pairs) {
    for (const g of grounds) {
      const r = contrast(fg, g);
      assert.ok(Number.isFinite(r), `${what}: not measured (a token failed to resolve)`);
      assert.ok(r >= floor, `${what}: ${r.toFixed(2)}:1 (floor ${floor})`);
    }
  }
});
