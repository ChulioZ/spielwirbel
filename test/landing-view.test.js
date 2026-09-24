'use strict';

/*
 * The rebuilt logged-out landing page (#1090), RUN rather than regex-matched —
 * see .claude/rules/testing-views-under-jsdom.md. Never
 * `require('../public/js/views-landing.js')`: pulling a view into the coverage
 * report is an ~11-point drop and a red `coverage:ci` with every test green.
 *
 * `test/landing-copy.test.js` pins the claims that can go from true to false in
 * the SOURCE (the licence term, the unlinked chip, the [hidden] pairs). What is
 * under test here is the rendered page: that the offer appears on both surfaces
 * from one renderer, that „Anmelden" is in the chrome rather than in the pitch,
 * and that the walkthrough is three shots of the loop rather than a list of
 * onboarding steps. None of that is visible to a text scan — the source could
 * declare every one of these and render none of them.
 *
 * Named `landing-view`, not `landing`: `test/landing-copy.test.js` and
 * `test/landing-shots.test.js` already exist, and a spec that overwrites a
 * sibling is silent in both directions
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

// `cfg` is what landingRevealOperatorClaims() sees. `{}` is an instance with the
// demo off and no legal surfaces configured — the self-hosting default.
function boot(t, cfg = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/config')) return { ok: true, json: async () => cfg };
    // The statistics block fetches this and removes its own placeholder on a 404.
    if (String(url).startsWith('/api/stats/public')) return { ok: false, status: 404, json: async () => ({}) };
    throw new Error(`unexpected fetch: ${url}`);
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  return dom;
}

// Both the config gate and the statistics mount resolve on a `.then` the view
// does not await, so one macrotask is what separates "rendered" from "settled".
const settle = () => new Promise((r) => setTimeout(r, 0));

test('the page makes ONE offer, rendered twice from one function', async (t) => {
  const dom = boot(t);
  await dom.call('showLanding');
  await settle();

  const offers = dom.document.querySelectorAll('.landing-offer');
  assert.equal(offers.length, 2, 'the hero and the closing block each render the offer');
  // The hero's carries the trust claims; the closing one must not — the four
  // claims appearing twice on one page is half of what #1090 removed (they were
  // a chapter of chips AND the footer line AND part of the demo note).
  assert.ok(offers[0].querySelector('.landing-offer__trust'), 'the hero offer carries the trust row');
  assert.equal(offers[1].querySelector('.landing-offer__trust'), null,
    'the closing offer repeats the offer, not the claims');
  assert.equal(dom.document.querySelectorAll('.landing-offer__trust').length, 1);

  // …and the chapter of chips that used to state them a third time is gone.
  assert.equal(dom.document.querySelector('.landing-trust'), null);
});

test('nothing on the page renders as a raw i18n key', async (t) => {
  // The defect this exists for shipped past every other test in this PR: two new
  // keys were added to the view and never landed in the lang tables, so the
  // offer's second action read „landing.hero.or landing.hero.registerLink" on
  // the page a cold visitor meets. `t()` falls back to the KEY, which is the
  // right default everywhere else and is indistinguishable from working copy to
  // anything that only asks whether an element exists.
  //
  // i18n-parity cannot see it either: it compares the locales against each
  // other, and a key missing from ALL of them is in perfect parity. This walks
  // the RENDERED text instead, which is the only layer where the fallback shows.
  const dom = boot(t, { demo: true, footer: true });
  await dom.call('showLanding');
  await settle();

  const text = dom.document.querySelector('.landing').textContent;
  const keys = text.match(/\b(?:landing|app|stats)\.[a-z][\w.]*\b/gi) || [];
  assert.deepEqual(keys, [], `untranslated keys rendered as copy: ${keys.join(', ')}`);

  // …and the same for the chrome this screen turns on.
  await dom.call('applyStaticTexts');
  assert.doesNotMatch(dom.document.getElementById('loginBtn').textContent, /^landing\./);
});

test('„Anmelden" is in the top bar, and the hero holds no login control', async (t) => {
  const dom = boot(t);
  await dom.call('showLanding');
  await settle();

  const login = dom.document.querySelector('#loginBtn');
  assert.equal(login.hidden, false, 'the landing offers „Anmelden" in the bar');
  assert.equal(login.getAttribute('href'), '/login', 'it is a real link, not a button');
  // The label is chrome, so it is written by applyStaticTexts() on locale init
  // and on every change rather than by the view — which is what makes it follow
  // the top-bar picker. The harness boots no main.js, so it is called here; that
  // still exercises the real function, and it is the one place the label exists.
  await dom.call('applyStaticTexts');
  assert.equal(login.textContent, 'Anmelden', 'applyStaticTexts labels it from the lang table');
  await dom.call('setLocale', 'en');
  await dom.call('applyStaticTexts');
  assert.equal(login.textContent, 'Log in', 'and re-labels it on a language change');

  // The hero's own third button is what made the page compete with itself: a
  // demo, a register and a login, all the same size, before any picture.
  assert.equal(dom.document.querySelector('.landing-hero #landingLogin'), null);
  assert.equal(dom.document.querySelector('.landing button[id*="ogin"]'), null);
});

test('authScreen() hides „Anmelden" again, in BOTH directions', async (t) => {
  // The failure this guards is silent and one-way: without the `false` branch
  // the landing's link follows the visitor onto the very login form it opened,
  // and without a caller turning it back on the landing simply never offers it.
  // Both screens call authScreen(true), so only the unconditional hide separates
  // them from the landing.
  const dom = boot(t);
  await dom.call('showLanding');
  await settle();
  assert.equal(dom.document.querySelector('#loginBtn').hidden, false);

  await dom.call('showLogin');
  assert.equal(dom.document.querySelector('#loginBtn').hidden, true,
    'the login screen must not offer „Anmelden" in the bar');

  await dom.call('showRegister');
  assert.equal(dom.document.querySelector('#loginBtn').hidden, true);
});

test('the walkthrough is three numbered product shots of the loop', async (t) => {
  const dom = boot(t);
  await dom.call('showLanding');
  await settle();

  const items = dom.document.querySelectorAll('.landing-walk__item');
  assert.equal(items.length, 3);
  assert.deepEqual([...items].map((li) => li.querySelector('.landing-step__num').textContent),
    ['1', '2', '3']);
  // The shelf, the vote and the result, in the order the loop runs. Asserted
  // through the file names rather than the copy: the pictures are the section.
  assert.deepEqual(
    [...items].map((li) => li.querySelector('img').getAttribute('src').replace(/\.de\.webp$/, '')),
    ['/img/landing-shelf-phone', '/img/landing-vote', '/img/landing-result'],
  );
  // Every one is an informative image — the alt is what explains the product to
  // a screen reader, which sees no pictures at all.
  for (const li of items) {
    assert.ok((li.querySelector('img').getAttribute('alt') || '').length > 20);
  }
  // The strip is keyboard-scrollable: below 720px it becomes a horizontal snap
  // strip holding no focusable content, so without these a keyboard user cannot
  // reach steps 2 and 3 at all (WCAG 2.1.1).
  const strip = dom.document.querySelector('.landing-walk');
  assert.equal(strip.getAttribute('tabindex'), '0');
  assert.ok(strip.getAttribute('aria-labelledby'), 'the scrollable strip has an accessible name');
  assert.ok(dom.document.getElementById(strip.getAttribute('aria-labelledby')),
    'aria-labelledby points at an element that exists');

  // The onboarding list it replaced is gone — it described account → round →
  // session while the picture beside it showed the vote.
  assert.equal(dom.document.querySelector('.landing-how'), null);
  assert.equal(dom.document.querySelector('.landing-steps'), null);
});

test('with no demo configured the offer is a single register primary', async (t) => {
  const dom = boot(t, { footer: true });
  await dom.call('showLanding');
  await settle();

  for (const offer of dom.document.querySelectorAll('.landing-offer')) {
    assert.equal(offer.querySelector('.landing-offer__register').hidden, false);
    assert.equal(offer.querySelector('.landing-offer__demo').hidden, true);
    assert.equal(offer.querySelector('.landing-offer__note').hidden, true);
    assert.equal(offer.querySelector('.landing-offer__alt').hidden, true);
  }
  // The operator-gated EU claim rides cfg.footer, which IS set here.
  assert.equal(dom.document.querySelector('[data-operator-only]').hidden, false);
});

test('with a demo configured the demo leads and register steps back to a link', async (t) => {
  const dom = boot(t, { demo: true });
  await dom.call('showLanding');
  await settle();

  for (const offer of dom.document.querySelectorAll('.landing-offer')) {
    const demo = offer.querySelector('.landing-offer__demo');
    assert.equal(demo.hidden, false);
    assert.ok(demo.classList.contains('btn--primary'), 'the demo is THE primary action');
    assert.equal(offer.querySelector('.landing-offer__note').hidden, false);
    assert.equal(offer.querySelector('.landing-offer__alt').hidden, false);
    // The one that would otherwise make the page read as two offers again.
    assert.equal(offer.querySelector('.landing-offer__register').hidden, true);
  }
  // …and the EU claim stays hidden: cfg.footer is unset here, so an instance
  // with a demo but no configured legal surfaces publishes no hosting claim.
  assert.equal(dom.document.querySelector('[data-operator-only]').hidden, true);
});

test('both offers are wired — the closing block is not decoration', async (t) => {
  // Wiring by class rather than by id is what lets the page render the offer
  // twice at all; a `querySelector` left behind from the id form would wire the
  // hero and leave the closing block's button inert, with nothing on screen to
  // say so.
  const dom = boot(t, { demo: true });
  const started = [];
  const registered = [];
  dom.set('startDemo', (busy) => started.push(busy.className));
  dom.set('showRegister', () => registered.push(true));
  await dom.call('showLanding');
  await settle();

  const offers = dom.document.querySelectorAll('.landing-offer');
  offers.forEach((o) => o.querySelector('.landing-offer__demo').click());
  assert.equal(started.length, 2, 'both demo buttons start the demo');
  assert.ok(started.every((c) => c.includes('landing-offer__demo')),
    'startDemo is passed the button itself — that is what disables it');

  offers.forEach((o) => o.querySelector('.landing-offer__register-link').click());
  assert.equal(registered.length, 2, 'both „kostenlos registrieren" links open the form');
});

test('the claims strip is six one-line claims, not a grid of cards', async (t) => {
  const dom = boot(t);
  await dom.call('showLanding');
  await settle();

  const claims = dom.document.querySelectorAll('.landing-claim');
  assert.equal(claims.length, 6);
  assert.equal(dom.document.querySelector('.landing-cards'), null,
    'the card grid is gone — its rows were 325px and 209px tall because one card held four sentences');
  for (const li of claims) {
    assert.ok(li.querySelector('.landing-claim__icon .ti'), 'each claim keeps its icon');
    const desc = li.querySelector('.landing-claim__desc').textContent.trim();
    assert.ok(desc.length > 0 && desc.length <= 70,
      `a claim line must stay a line, got ${desc.length} chars: ${desc}`);
  }
});

test('the desktop band sits right under the hero, in the design the page wears (#1199)', async (t) => {
  // Operator decision 2026-09-24: phone captures alone read as a phone-only app,
  // so ONE wide desktop capture follows the hero. Its position is the decision
  // — directly after the hero, before the walkthrough — and it is the HUB at
  // desktop width, never back in the hero column (#1090 retired a wide capture
  // there because its labels shrank to ~9px).
  for (const [design, folder] of [['klassisch', '/img/'], ['tisch', '/img/tisch/']]) {
    const dom = boot(t);
    dom.call('applyDesign', design);
    await dom.call('showLanding');
    await settle();

    const band = dom.document.querySelector('.landing-hero + .landing-desktop');
    assert.ok(band, `${design}: the band is the hero's next sibling`);
    assert.equal(dom.document.querySelectorAll('.landing-desktop').length, 1);
    assert.equal(dom.document.querySelector('.landing-hero .landing-desktop__shot'), null,
      'the wide capture stays out of the hero column');

    const img = band.querySelector('figure img.landing-desktop__shot');
    assert.equal(img.getAttribute('src'), `${folder}landing-desktop.de.webp`,
      `${design}: the band shows the worn design's capture, in the page's locale`);
    // The reserved box: without both attributes the image lands late and moves
    // the walkthrough below it.
    assert.ok(Number(img.getAttribute('width')) > Number(img.getAttribute('height')),
      'a landscape box is reserved from the real asset size');
    assert.equal(img.getAttribute('loading'), 'lazy');
    assert.ok((img.getAttribute('alt') || '').length > 40, 'an informative alt, not decoration');
    assert.equal(img.getAttribute('aria-hidden'), null);
    const caption = band.querySelector('figcaption').textContent.trim();
    assert.ok(caption.length > 0 && !caption.startsWith('landing.'), `${design}: a translated caption`);
  }
});
