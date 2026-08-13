'use strict';

/*
 * The two findings of the 2026-08-04 accessibility audit (issue #638), both of
 * them things only a RENDERED view can answer:
 *
 *  - A-011: the Freundeskreis request field had a placeholder and no accessible
 *    name, so a screen reader announced an unnamed edit field (WCAG 2.2 SC
 *    3.3.2 / 4.1.2). A placeholder is not a label — and it is not a label in a
 *    way no source-text regex can see, because the markup looks complete.
 *  - A-014: the round hub's Start screen had NO h1 at rail widths. The hero
 *    carrying the only h1 is `rail-owned`, i.e. CSS-hidden from 1280px up,
 *    while the rail that replaces it rendered the round name as a plain <div>.
 *    Regal/Chronik/Pokale were unaffected — each has its own section h1.
 *
 * The heading half needs BOTH halves of this file to mean anything, and the
 * split is the point: jsdom applies no external stylesheet, so it can say which
 * elements exist and which are headings, but never which of them is displayed.
 * So the DOM half pins "each of the two identity blocks contributes exactly one
 * h1 on Start, and the rail contributes none anywhere else", and the CSS half
 * pins "exactly one of those two blocks is ever displayed". Neither alone
 * establishes the one-h1 guarantee; asserting only the first would in fact pass
 * against a stylesheet that showed both.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, translator } = require('./support/dom');
const { bodyOf, mediaBlocks, rulesOf } = require('./support/css');
const { LOCALES } = require('../public/js/locales');

/* ------------------------------- A-011 ------------------------------------ */

const FRIEND_INPUT_KEY = 'friends.addLabel';

/* showFriends() fetches two payloads before rendering anything; neither needs
   content for the add-form, which renders unconditionally above them — but both
   shapes have to be right, because a wrong one throws inside the view and the
   spec reddens with a TypeError that has nothing to do with the assertion.
   The feed is `{events: [...]}`, NOT a bare array (`GET /api/account/friends/feed`). */
const EMPTY_FRIENDS = { friends: [], incoming: [], outgoing: [] };
const EMPTY_FEED = { events: [] };

async function friendsView(t, locale) {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('accountApi', async (method, path) => (path === '/friends' ? EMPTY_FRIENDS : EMPTY_FEED));
  await dom.call('showFriends');
  return dom;
}

test('the Freundeskreis request field has an accessible name, not just a placeholder', async (t) => {
  const dom = await friendsView(t, 'de');
  const input = dom.document.querySelector('#friendUser');
  assert.ok(input, 'the add-a-friend input did not render');

  /* The name has to be programmatic. Checking `aria-label` alone would pass on
     an empty string, and checking "some attribute is set" would pass on the
     placeholder that caused the finding — so resolve the name the way the
     accessibility tree does (aria-label, or a <label for> / aria-labelledby if
     the fix ever moves to one) and require it to be non-empty. */
  const label = input.getAttribute('aria-label');
  const labelledby = input.getAttribute('aria-labelledby');
  const forLabel = dom.document.querySelector('label[for="friendUser"]');
  const name = (label || (labelledby && dom.document.getElementById(labelledby)?.textContent) || forLabel?.textContent || '').trim();

  assert.ok(name, 'the input has no accessible name (placeholder is not a label — WCAG 2.2 SC 3.3.2/4.1.2)');
  assert.notEqual(name, input.getAttribute('placeholder'),
    'the accessible name merely repeats the placeholder — it should say what the field is FOR');
});

test('the accessible name is localized, not a hardcoded string or a raw key', async (t) => {
  const de = (await friendsView(t, 'de')).document.querySelector('#friendUser').getAttribute('aria-label');
  const en = (await friendsView(t, 'en')).document.querySelector('#friendUser').getAttribute('aria-label');

  assert.ok(de && en, 'one of the locales rendered no aria-label at all');
  /* A missing key renders as the key itself (i18n.js), which is a non-empty
     string and would satisfy the test above — this is what discriminates. */
  assert.doesNotMatch(de, /^friends\./, 'the German name rendered the raw i18n key');
  assert.doesNotMatch(en, /^friends\./, 'the English name rendered the raw i18n key');
  assert.notEqual(de, en, 'both locales produced the same string — the name is hardcoded, not translated');
});

test('the field is named in EVERY shipped locale, derived from locales.js', () => {
  /* i18n-parity already forbids en/de drift, so this is not about parity — it
     is about the locale set being data (`.claude/rules/locale-set-is-data.md`):
     a language added as a row in locales.js must not be able to ship this field
     unnamed. Resolving through t() per locale is also what catches the
     missing-key case, which renders the key itself rather than throwing. */
  for (const { code } of LOCALES) {
    const t = translator(code);
    const name = t(FRIEND_INPUT_KEY);
    assert.notEqual(name, FRIEND_INPUT_KEY, `lang/${code}.js is missing '${FRIEND_INPUT_KEY}'`);
    assert.ok(name.trim(), `lang/${code}.js has '${FRIEND_INPUT_KEY}' but it is blank`);
  }
});

/* ------------------------------- A-014 ------------------------------------ */

const ROUND = {
  id: 1,
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 1, name: 'Ada' }],
  games: [{ id: 1, title: 'Cascadia' }],
  sessions: [],
  tags: [],
};

async function hub(t, tab, sub) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // Route by path: the Chronik tab also fetches the activity feed, and answering
  // it with the round object throws inside the renderer rather than failing an
  // assertion — a red that looks like the one under test and is not.
  dom.set('api', async (method, path) => (path.endsWith('/activities') ? [] : ROUND));
  if (sub) await dom.call('renderSubScreenTabs', ROUND, sub);
  else await dom.call('showRound', ROUND.id, tab);
  return dom;
}

/* `.find` is wrong here: the stylesheet has THREE `min-width: 1280px` blocks, so
   a lookup that stops at the first reports "no such rule" for anything declared
   in the other two — which is a confident, wrong red. Concatenate them. */
const wideRules = () => rulesOf(mediaBlocks()
  .filter(([q]) => q.includes('min-width: 1280px'))
  .map(([, css]) => css)
  .join('\n'));

// The rail and the content column each own headings; which of the two is on
// screen is decided purely by width, so they are counted separately.
const railOf = (dom) => dom.app.querySelector('.rail');
const railH1s = (dom) => railOf(dom).querySelectorAll('h1');
const contentH1s = (dom) => [...dom.app.querySelectorAll('h1')].filter((el) => !railOf(dom).contains(el));

test('Start: the rail carries an h1, because the hero holding the other one is hidden there', async (t) => {
  const dom = await hub(t, 'start');

  assert.equal(railH1s(dom).length, 1, 'the rail contributes no h1 on Start — the screen has none at rail widths');
  assert.match(railH1s(dom)[0].textContent, /Freitagsrunde/, 'the rail h1 is not the round name');

  // The hero keeps its own, for the widths where IT is the one displayed.
  const hero = dom.app.querySelector('.hero');
  assert.equal(hero.querySelectorAll('h1').length, 1, 'the hero lost its h1');
  assert.equal(contentH1s(dom).length, 1, 'the content column has more than the hero h1 on Start');
});

for (const tab of ['regal', 'chronik', 'pokale']) {
  test(`${tab}: the rail carries NO h1 — that tab renders its own section heading`, async (t) => {
    const dom = await hub(t, tab);

    assert.equal(railH1s(dom).length, 0,
      `the rail added a second h1 on ${tab}, which already has its own`);
    assert.equal(contentH1s(dom).length, 1,
      `${tab} does not render exactly one section h1`);
  });
}

test('a sub-screen: the rail carries no h1 — the page-head owns it', async (t) => {
  const dom = await hub(t, null, 'tags');
  assert.equal(railH1s(dom).length, 0, 'the rail added an h1 on a sub-screen that has its own page-head h1');
});

test('the rail name resets the UA heading margin it inherits by becoming an h1', () => {
  // `.rail__name` was a <div>; as an <h1> it picks up the UA `0.67em 0` margin,
  // which opens a gap in the identity block that nothing else would catch.
  const body = bodyOf('.rail__name', wideRules());
  assert.ok(body, '.rail__name has no rule in the ≥1280px block');
  assert.match(body, /margin:\s*0/, '.rail__name does not zero the margin it now inherits as a heading');
});

test('the hero and the rail are never displayed at the same time', () => {
  /* This is what turns the DOM assertions above into a one-h1 guarantee: on
     Start both identity blocks are in the DOM and each holds exactly one h1, so
     the accessibility tree shows exactly one only because CSS displays exactly
     one. Assert the complementary pair rather than either half. */
  const wide = wideRules();

  // Below 1280px: the rail is out of the tree, the hero shows.
  assert.match(bodyOf('.rail'), /display:\s*none/,
    'the base .rail rule no longer hides the rail — both identity blocks would render');
  // From 1280px up: the rail shows, the hero (`rail-owned`) is out of the tree.
  assert.match(bodyOf('.rail', wide), /display:\s*flex/, 'the rail is not displayed at rail widths');
  assert.match(bodyOf('.app .rail-owned', wide), /display:\s*none/,
    'the hero is no longer hidden at rail widths — Start would render two h1s');
});

/* ------------------- every top-bar control is LOCALIZED --------------------- */

/* index.html can only carry one hardcoded language, so `applyStaticTexts()`
   re-labels each icon-only top-bar control on locale init and on every change —
   the aria-label is the ONLY thing a screen reader announces for them. #145 did
   that for five controls and missed `#inboxBtn`, which therefore announced the
   German "Postfach" to an English reader from #207 until #764 found it.
   Nothing could catch it: the markup looks complete and the label is a real
   word, just the wrong language.

   The assertion names the key each control must render, rather than the string.
   The tempting generic form — "the name must differ between de and en" — needs
   no key map and is WRONG: `feedback.button` is „Feedback" in both languages,
   so that spec fails on a control which is perfectly localized, while a future
   locale pair that happens to coincide would let a genuinely static label pass.
   Comparing against `t(key)` has neither failure. */
const TOPBAR_NAMES = {
  homeBtn: 'a11y.home',
  langPicker: 'a11y.language',
  feedbackBtn: 'feedback.button',
  supportBtn: 'support.button',
  inboxBtn: 'inbox.title',
  accountBtn: 'a11y.account',
};

test('every icon-only top-bar control is announced in the reader\u2019s language', (t) => {
  for (const locale of LOCALES.map((l) => l.code)) {
    const dom = loadApp({ locale });
    t.after(() => dom.close());
    dom.call('applyStaticTexts');
    const t_ = translator(locale);

    for (const [id, key] of Object.entries(TOPBAR_NAMES)) {
      const el = dom.document.getElementById(id);
      assert.ok(el, `#${id} is gone from index.html \u2014 this spec is guarding nothing`);
      assert.equal(el.getAttribute('aria-label'), t_(key),
        `#${id} announces "${el.getAttribute('aria-label')}" in ${locale} \u2014 its aria-label is not localized from ${key}`);
    }
  }
});
