'use strict';

/* Unit tests for public/js/doc-title.js — the per-view browser tab title (#522).

   The interesting cases are all the ones where a caller passes something it did
   not check first: a round whose fetch has not resolved, a game with no title,
   an account surface with no second part. Those must degrade to a shorter but
   still correct title, never to a title with a hole in it — a tab reading
   "Regal –  · Spielwirbel" looks broken in a way a missing word does not. */

const test = require('node:test');
const assert = require('node:assert');

const { docTitle, DOC_TITLE_SEP, DOC_TITLE_BRAND_SEP } = require('../public/js/doc-title');

const BRAND = 'Spielwirbel';

test('joins screen and round ahead of the brand', () => {
  assert.equal(docTitle(['Regal', 'Donnerstagsrunde'], BRAND), 'Regal – Donnerstagsrunde · Spielwirbel');
});

test('a single part still gets the brand', () => {
  assert.equal(docTitle(['Meine Runden'], BRAND), 'Meine Runden · Spielwirbel');
});

test('with no parts at all the brand alone is the title', () => {
  // A screen that forgot to name itself must not blank the tab.
  for (const parts of [[], undefined, null, [''], [null, undefined, '   ']]) {
    assert.equal(docTitle(parts, BRAND), BRAND);
  }
});

test('an empty part is dropped, never rendered as a gap', () => {
  // This is the not-yet-loaded round: showRound names its tab before the name
  // exists only if someone moves the call, and the fallback must read as a
  // shorter title rather than as a broken one.
  assert.equal(docTitle(['Regal', ''], BRAND), 'Regal · Spielwirbel');
  assert.equal(docTitle(['Regal', null], BRAND), 'Regal · Spielwirbel');
  assert.equal(docTitle(['', 'Donnerstagsrunde'], BRAND), 'Donnerstagsrunde · Spielwirbel');
  // …and specifically NOT with a separator left stranded either side.
  assert.ok(!docTitle(['Regal', ''], BRAND).includes(DOC_TITLE_SEP));
});

test('parts are trimmed, so a padded name cannot double the spacing', () => {
  assert.equal(docTitle(['  Regal  ', ' Donnerstagsrunde '], BRAND), 'Regal – Donnerstagsrunde · Spielwirbel');
});

test('three parts chain with the same separator', () => {
  assert.equal(docTitle(['a', 'b', 'c'], BRAND), 'a – b – c · Spielwirbel');
});

test('non-string parts are coerced rather than dropped', () => {
  // A round named "2026" arrives from JSON as a string, but a caller passing a
  // number must not silently lose it.
  assert.equal(docTitle([2026], BRAND), '2026 · Spielwirbel');
  assert.equal(docTitle([0], BRAND), '0 · Spielwirbel');
});

test('a missing brand leaves the trail alone rather than a dangling separator', () => {
  // t('app.title') always resolves, so this is defence in depth — but the
  // failure it prevents ("Regal · ") would be visible in every tab.
  for (const brand of ['', null, undefined, '  ']) {
    assert.equal(docTitle(['Regal', 'Donnerstagsrunde'], brand), 'Regal – Donnerstagsrunde');
  }
  assert.equal(docTitle([], ''), '');
});

test('the two separators are distinct, so the brand reads apart from the trail', () => {
  // The whole shape depends on this; equal separators would make the brand look
  // like one more level of the hierarchy.
  assert.notEqual(DOC_TITLE_SEP, DOC_TITLE_BRAND_SEP);
});
