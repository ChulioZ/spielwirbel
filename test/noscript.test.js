'use strict';

// The no-JS fallback (issue #525). The app renders itself client-side, so with
// scripting off the served shell painted the static crawlable hero (#510) and
// then sat there: every control inert, every later screen never rendered, and
// nothing on the page saying why.
//
// Asserted over HTTP rather than against the file, like test/seo.test.js and
// for the same reason — what a visitor gets is the SERVED bytes. The styling
// half reads styles.css instead, because markup naming a class the stylesheet
// never declares renders as unstyled prose above the hero: visible, wrong, and
// green in every other test. Same failure family as
// .claude/rules/hidden-attribute-vs-display-rule.md and
// .claude/rules/tabler-icon-codepoints.md.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { JSDOM } = require('jsdom');
const { app } = require('./helpers');
const { bodyOf } = require('./support/css');

/* The served shell, PARSED — and the parse is not a convenience, it is what
   makes this file able to see its subject at all. jsdom runs no scripts, so its
   parser builds the <noscript> contents as real ELEMENTS: this document is
   literally the DOM a JS-off browser constructs, which is the thing under test.
   (A scripting-enabled browser stores the same markup as one text node — the
   measured reason .noscript-banner needs no `[hidden]` guard, pinned below.)
   Parse a bare JSDOM of the response, not the harness's document.

   Parsing also avoids two traps that both fired for real on #525, and matching
   this markup out of raw text walks into one or the other
   (.claude/rules/css-text-assertions-strip-comments.md):

   - A regex takes the FIRST occurrence, and index.html documents this block in
     prose. The first draft's comment named `<main id="app">`, which made
     test/landing-copy.test.js's block match start inside that comment and
     swallow the demo and terms banners — failing on entirely correct markup.
   - The obvious remedy, `.replace(/<!--[\s\S]*?-->/g, '')`, costs a
     HIGH-severity CodeQL js/incomplete-multi-character-sanitization alert. That
     is not hypothetical either: this file shipped it to PR #689 and reddened
     the CodeQL check, in a test file, for a regex. */
async function servedShell() {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  return new JSDOM(res.text).window.document;
}

test('the served shell explains itself to a visitor with JavaScript off (#525)', async () => {
  const doc = await servedShell();
  const ns = doc.querySelector('noscript');
  assert.ok(ns, 'the served shell carries no <noscript> — a JS-off visitor gets a dead page');

  const banner = ns.querySelector('.noscript-banner');
  assert.ok(banner, 'the <noscript> holds no .noscript-banner');

  // Both shipped languages, spelled out. Asserting only that a <noscript>
  // exists would pass against an empty one, i.e. the same dead page with extra
  // markup.
  assert.match(banner.textContent, /Spielwirbel benötigt JavaScript\./,
    'the German sentence is missing from the fallback');
  assert.match(banner.textContent, /Spielwirbel requires JavaScript\./,
    'the English sentence is missing from the fallback');
});

test('the fallback sits outside <main id="app"> (#525)', async () => {
  // Two reasons, and only the first is obvious: showLanding() overwrites that
  // block wholesale on boot, and test/seo.test.js scopes its crawlable-hero
  // assertion to it (.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md
  // §3). Inside <main> the notice would be both pointless and in the way of the
  // one region a non-rendering crawler is read for.
  const doc = await servedShell();
  const main = doc.querySelector('main#app');
  assert.ok(main, 'the served shell still has a <main id="app">');
  assert.equal(main.querySelector('noscript'), null,
    'the <noscript> fallback must live outside <main id="app">');
  // Without this, deleting the fallback outright satisfies the assertion above.
  assert.ok(doc.querySelector('noscript'), 'and it must still be somewhere in the document');
});

test('the line that is not in the document language declares its own lang (#525)', async () => {
  // The document ships `lang="en"` while its static head copy is German for
  // crawlers (#436/#510); i18n.js corrects the attribute at runtime and is
  // precisely what does not run here. So one of the two sentences is always in
  // a language the document does not claim, and it needs its own `lang` or a
  // screen reader voices it with the wrong phonetics.
  //
  // Pinned as the RELATIONSHIP rather than as `lang="de"`: flipping the
  // document to German would silently move the burden to the English line, and
  // a literal assertion would keep passing while the marked-up sentence became
  // the wrong one.
  const doc = await servedShell();
  const docLang = doc.documentElement.lang;
  assert.ok(docLang, 'index.html still declares a document language');

  const ns = doc.querySelector('noscript');
  assert.ok(ns, 'the served shell carries no <noscript>');
  const lines = [...ns.querySelectorAll('p')];
  assert.equal(lines.length, 2, 'the fallback still holds exactly two sentences');

  const marked = lines.filter((p) => p.hasAttribute('lang'));
  assert.equal(marked.length, 1,
    `exactly one sentence must carry its own lang (document is "${docLang}")`);
  assert.notEqual(marked[0].getAttribute('lang'), docLang,
    'the marked-up sentence must be the one NOT in the document language');
});

test('the fallback banner is actually styled, and needs no [hidden] guard (#525)', () => {
  // The class has to exist in the stylesheet or the block ships as bare prose
  // over the hero — a JS-off visitor is the one audience nobody spot-checks.
  const body = bodyOf('.noscript-banner');
  assert.ok(body, '.noscript-banner is used in index.html but declared nowhere in styles.css');
  assert.match(body, /display:\s*flex/);

  // Its colours come from the theme families, like every other strip on this
  // page (.claude/rules/theme-derived-colors.md) — a literal pastel would clash
  // the moment --warn or --surface is retuned.
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, 'no literal hex in .noscript-banner');
  assert.match(body, /var\(--warn\)/);

  // And the inverse of .demo-banner[hidden]: this one MUST NOT have that guard.
  // A `[hidden]` rule here would be cargo-culted from its neighbour and imply a
  // JS-toggled element, which this is not: in a scripting-ENABLED browser the
  // parser never builds .noscript-banner at all (measured in Chrome — the
  // <noscript> holds one text node and querySelector returns null), so there is
  // no element for an author `display` rule to leak to.
  assert.equal(bodyOf('.noscript-banner[hidden]'), null,
    '.noscript-banner[hidden] is dead weight — with JS on the class is never an element');
});
