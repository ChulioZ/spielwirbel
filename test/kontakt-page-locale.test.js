'use strict';

/* The contact page's two locales are not one locale — issue #993.
 *
 * public/js/pages/kontakt.js conflated WHICH OF ITS TWO LANGUAGES a visitor is
 * shown with WHAT THE VISITOR'S APP LOCALE IS, and both halves were wrong:
 *
 *  1. The stored feedback `locale` was the display language, so every shipped
 *     locale other than German reported `en` — losing the one field that routes
 *     a "this wording is wrong" report to the language it is about.
 *  2. The in-page DE/EN toggle wrote the SPA's own `locale` key, silently
 *     re-languaging the whole app for someone who asked to read one page.
 *
 * The server side of (1) was already covered — test/contact.test.js proves the
 * allowlist is read from public/js/locales.js and that an unknown locale is
 * dropped rather than 400ed. That spec passed the entire time the bug was live,
 * because nothing tested the PRODUCER. This file is the producer half.
 */

const test = require('node:test');
const assert = require('node:assert');

const { loadKontakt, flush } = require('./support/dom');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

/* Boot the page with a recording fetch, fill in a message, submit, and hand back
   what was POSTed to /api/contact. The submit handler is async, but everything up
   to its `await fetch(...)` runs synchronously on dispatch, so the body is
   recorded by the time dispatchEvent returns; the flush only lets the rest of the
   handler finish. */
async function submit(opts = {}, { category = 'feedback', message = 'Hallo' } = {}) {
  const sent = [];
  const dom = loadKontakt({
    ...opts,
    fetch: (url, init) => {
      // The page also probes /api/config on load, with no init at all. Answer it
      // as "channel configured" so the form is not hidden out from under us.
      if (!init) return Promise.resolve({ ok: true, json: () => Promise.resolve({ footer: true }) });
      sent.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
  });
  const doc = dom.window.document;
  doc.getElementById('message').value = message;
  doc.getElementById('category').value = category;
  // Art. 16(2)(d): a report category refuses to submit without it, so an
  // unticked box would leave the assertions below reading a POST that never
  // happened rather than a locale that was never sent.
  doc.getElementById('goodFaith').checked = true;
  doc.getElementById('contactForm')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  const posted = sent.filter((r) => r.url === '/api/contact');
  // Without this the assertions below read `undefined.locale` on a form that
  // never submitted at all, which would fail for the wrong reason.
  assert.equal(posted.length, 1, 'the form did not POST /api/contact');
  return { body: posted[0].body, dom };
}

/* ---- bug 1: the reported locale is the visitor's, not the display language ---- */

test('every shipped locale is reported on the feedback it produces (#993)', async () => {
  // The whole set, not a sample: before the fix exactly two of the seven —
  // the two the display language can hold — round-tripped, and a spec pinning
  // one of those would have passed forever (the members-palette lesson in
  // .claude/rules/shared-constants-across-the-stack.md).
  for (const locale of SUPPORTED_LOCALES) {
    const { body, dom } = await submit({ saved: locale, systemLanguage: 'en-US' });
    assert.equal(body.locale, locale, `feedback from the ${locale} app reported ${body.locale}`);
    dom.window.close();
  }
});

test('the reported locale and the displayed language are separate (#993)', async () => {
  // The sharpest single case: Portuguese is not one of the page's two languages,
  // so the page correctly renders in English (#822) while the feedback must still
  // say `pt`. One value cannot do both jobs, which is the bug in one line.
  const { body, dom } = await submit({ saved: 'pt', systemLanguage: 'pt-BR' });
  assert.equal(body.locale, 'pt');
  assert.equal(dom.window.document.documentElement.lang, 'en');
  dom.window.close();
});

test('with no saved choice the system language is reported (#993)', async () => {
  // What the SPA itself would resolve to (detectLocale, public/js/i18n.js), so
  // this is the locale the visitor is actually reading the app in.
  const { body, dom } = await submit({ systemLanguage: 'nl-NL' });
  assert.equal(body.locale, 'nl');
  dom.window.close();
});

test('a locale the app does not ship is never substituted with en (#993)', async () => {
  // The old code answered `en` here — a wrong value, indistinguishable from a
  // genuine English visitor. The page now reports what it actually has and lets
  // the server's allowlist decide; test/contact.test.js proves that end drops an
  // unknown locale without failing the submission.
  const { body, dom } = await submit({ systemLanguage: 'ja-JP' });
  assert.ok(!SUPPORTED_LOCALES.includes('ja'), 'pick a code the app does not ship');
  assert.notEqual(body.locale, 'en', 'a Japanese visitor was reported as English');
  assert.equal(body.locale, 'ja');
  dom.window.close();
});

test('an over-long stored locale is capped before it is sent (#993)', async () => {
  const { body, dom } = await submit({ saved: 'x'.repeat(500), systemLanguage: 'en-US' });
  assert.equal(body.locale.length, 20);
  dom.window.close();
});

test('only feedback carries the locale — a report and a general message do not', async () => {
  for (const category of ['', 'copyright']) {
    const { body, dom } = await submit({ saved: 'pt' }, { category });
    assert.equal(body.locale, undefined, `category "${category}" leaked a locale`);
    dom.window.close();
  }
});

/* ---- bug 2: the toggle is the page's own, not the app's ---- */

const clickLang = (dom, code) => dom.window.document
  .querySelector(`.langs button[data-lang="${code}"]`).dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );

test('the page language toggle does not change the app language (#993)', () => {
  const dom = loadKontakt({ saved: 'pt', systemLanguage: 'pt-BR' });
  const doc = dom.window.document;
  assert.equal(doc.documentElement.lang, 'en');

  clickLang(dom, 'de');

  // The guard first: without it, "localStorage.locale is untouched" would pass
  // just as well against a toggle that did nothing at all.
  assert.equal(doc.documentElement.lang, 'de', 'the toggle did not switch the page');
  assert.equal(doc.getElementById('t-title').textContent, 'Kontakt');
  assert.equal(dom.window.localStorage.getItem('locale'), 'pt', 'the app language was rewritten');
  assert.equal(dom.window.localStorage.getItem('kontaktLang'), 'de');
  dom.window.close();
});

test('the page remembers its own language choice across visits (#993)', () => {
  // And it beats the SPA locale — the visitor said, on this page, which of the
  // two languages they want to read it in.
  const dom = loadKontakt({ saved: 'de', pageLang: 'en', systemLanguage: 'de-DE' });
  assert.equal(dom.window.document.documentElement.lang, 'en');
  dom.window.close();

  const back = loadKontakt({ saved: 'en', pageLang: 'de', systemLanguage: 'en-US' });
  assert.equal(back.window.document.documentElement.lang, 'de');
  back.window.close();
});

test('a junk page-language value falls back instead of being shown', () => {
  const dom = loadKontakt({ saved: 'de', pageLang: 'klingon', systemLanguage: 'en-US' });
  assert.equal(dom.window.document.documentElement.lang, 'de');
  dom.window.close();
});

/* ---- the page survives a browser with storage blocked ---- */

test('the page still renders when localStorage throws', () => {
  // Chrome with site data blocked throws on the property access itself. Every
  // label here is written by JS, so an unguarded read took the whole page — the
  // DSA notice-and-action channel — down to a blank form.
  const dom = loadKontakt({ storageBlocked: true, systemLanguage: 'de-DE' });
  const doc = dom.window.document;
  assert.equal(doc.documentElement.lang, 'de');
  assert.equal(doc.getElementById('t-title').textContent, 'Kontakt');
  assert.ok(doc.getElementById('t-submit').textContent, 'the submit button has no label');

  // And the toggle must not throw on the write either.
  clickLang(dom, 'en');
  assert.equal(doc.documentElement.lang, 'en');
  dom.window.close();
});
