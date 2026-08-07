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
const { app } = require('./helpers');
const { bodyOf } = require('./support/css');

/* Comments are stripped before ANY of the matching below — DEFENSIVELY, not
   because anything in index.html trips it today. Dropping this call currently
   changes no result (measured), because that file's comments were deliberately
   written to avoid spelling `<noscript>` and `<main id="app">` as literal tags.

   It stays because that spelling discipline is one careless edit from being
   undone, and this file matches both tags out of raw text — the trap
   test/support/css.js records for the stylesheet
   (.claude/rules/css-text-assertions-strip-comments.md). #525's own first draft
   proved it is not theoretical: a comment explaining why the block sits outside
   <main> made an existing spec's block match start inside that comment and
   swallow two banners, failing against entirely correct markup. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

async function servedShell() {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  return stripComments(res.text);
}

test('the served shell explains itself to a visitor with JavaScript off (#525)', async () => {
  const html = await servedShell();
  const m = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(m, 'the served shell carries no <noscript> block — a JS-off visitor gets a dead page');

  // Both shipped languages, spelled out. A bare `includes('<noscript>')` would
  // pass against an empty element, which is the same dead page with extra
  // markup.
  assert.match(m[1], /Spielwirbel benötigt JavaScript\./,
    'the German sentence is missing from the <noscript> block');
  assert.match(m[1], /Spielwirbel requires JavaScript\./,
    'the English sentence is missing from the <noscript> block');
});

test('the fallback sits outside <main id="app"> (#525)', async () => {
  // Two reasons, and only the first is obvious: showLanding() overwrites that
  // block wholesale on boot, and test/seo.test.js scopes its crawlable-hero
  // assertion to it (.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md
  // §3). Inside <main> the notice would be both pointless and in the way of the
  // one region a non-rendering crawler is read for.
  const html = await servedShell();
  const main = html.match(/<main id="app"[\s\S]*?<\/main>/);
  assert.ok(main, 'the served shell still has a <main id="app">');
  assert.doesNotMatch(main[0], /<noscript/,
    'the <noscript> fallback must live outside <main id="app">');
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
  const html = await servedShell();
  const docLang = html.match(/<html lang="([a-z-]+)"/);
  assert.ok(docLang, 'index.html still declares a document language');

  const found = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(found, 'the served shell carries no <noscript> block');
  const lines = [...found[1].matchAll(/<p(?:\s+lang="([a-z-]+)")?\s*>/g)].map((p) => p[1] || null);
  assert.equal(lines.length, 2, 'the fallback still holds exactly two sentences');
  assert.equal(
    lines.filter(Boolean).length, 1,
    `exactly one sentence must carry its own lang (document is "${docLang[1]}")`,
  );
  assert.notEqual(lines.find(Boolean), docLang[1],
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
  // JS-toggled element, which this is not: with scripting on the parser never
  // builds .noscript-banner at all (measured — the <noscript> holds one text
  // node and querySelector('.noscript-banner') returns null), so there is no
  // element for an author `display` rule to leak to.
  assert.equal(bodyOf('.noscript-banner[hidden]'), null,
    '.noscript-banner[hidden] is dead weight — with JS on the class is never an element');
});
