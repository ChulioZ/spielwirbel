'use strict';

/* The pure half of the edition-cover picker (#519): which of a game's box arts
   is offered first, and which duplicates are dropped. The DOM half lives in
   public/js/cover-picker.js and is deliberately NOT required here — pulling a
   DOM-only file into the coverage report is the hard `coverage:ci` constraint in
   .claude/rules/frontend-helper-modules-and-coverage.md. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bggCoverLanguage, coverRank, sortEditionCovers, coverCaption } = require('../public/js/bgg-covers');

// Shaped exactly like lib/providers/bgg.js parseVersions' output.
const cover = (edition, languages, imageUrl, year) => ({
  imageUrl: imageUrl || `https://cf.geekdo-images.com/${edition.replace(/\W/g, '')}.jpg`,
  edition,
  year: year === undefined ? 2021 : year,
  languages,
});

test('bggCoverLanguage maps the shipped UI locales onto BGG language values', () => {
  assert.equal(bggCoverLanguage('de'), 'German');
  assert.equal(bggCoverLanguage('en'), 'English');
  // A region tag still resolves — detectLocale() slices two letters too.
  assert.equal(bggCoverLanguage('de-AT'), 'German');
  // A language the app does not speak gets no tier of its own; the
  // English-first fallback is what it lands on.
  assert.equal(bggCoverLanguage('fr'), null);
  assert.equal(bggCoverLanguage(''), null);
  assert.equal(bggCoverLanguage(null), null);
  // A key from Object.prototype must never resolve to a language.
  assert.equal(bggCoverLanguage('constructor'), null);
});

test('coverRank tiers the reader\'s language over English over the rest', () => {
  assert.equal(coverRank(cover('a', ['German']), 'German'), 0);
  assert.equal(coverRank(cover('b', ['English']), 'German'), 1);
  assert.equal(coverRank(cover('c', ['Polish']), 'German'), 2);
  // A multilingual edition counts as the reader's language.
  assert.equal(coverRank(cover('d', ['English', 'German']), 'German'), 0);
  // In an English UI tiers 0 and 1 coincide, which is correct: there is only
  // "my language" and "the rest".
  assert.equal(coverRank(cover('e', ['English']), 'English'), 0);
  // No language at all is not English.
  assert.equal(coverRank(cover('f', []), 'German'), 2);
  assert.equal(coverRank(null, 'German'), 2);
});

test('sortEditionCovers puts the UI language first, English next, BGG\'s order within each tier', () => {
  const covers = [
    cover('Chinese edition', ['Chinese']),
    cover('English first edition', ['English']),
    cover('German edition', ['German']),
    cover('Polish edition', ['Polish']),
    cover('English 2.1 edition', ['English']),
    cover('German retail edition', ['German']),
  ];
  assert.deepEqual(sortEditionCovers(covers, 'de').map((c) => c.edition), [
    'German edition',
    'German retail edition',
    'English first edition',
    'English 2.1 edition',
    'Chinese edition',
    'Polish edition',
  ]);
  // Every edition stays reachable — the tiers reorder, they never filter.
  assert.equal(sortEditionCovers(covers, 'de').length, covers.length);
  // English UI: the English editions lead and the rest keep BGG's own order.
  assert.deepEqual(sortEditionCovers(covers, 'en').map((c) => c.edition), [
    'English first edition',
    'English 2.1 edition',
    'Chinese edition',
    'German edition',
    'Polish edition',
    'German retail edition',
  ]);
});

test('sortEditionCovers dedupes by image URL AFTER sorting, so the reader\'s label survives', () => {
  // Ark Nova's "German edition, fifth printing" and "eigth printing" really do
  // return the same thumbnail (measured live, 2026-07-28) — 35 covers, 19
  // distinct URLs. Without the dedupe the grid shows the same box nine times.
  const shared = 'https://cf.geekdo-images.com/shared.jpg';
  const covers = [
    cover('Chinese edition', ['Chinese'], shared),
    cover('German edition, fifth printing', ['German'], shared),
    cover('German edition, eigth printing', ['German'], shared),
    cover('English edition', ['English']),
  ];
  const sorted = sortEditionCovers(covers, 'de');
  assert.equal(sorted.length, 2);
  // THE POINT: dedupe-first would have kept BGG's arbitrary first entry and
  // labelled the German printing's own box "Chinese edition" for a German
  // reader. Sorting first is what makes the surviving label the right one.
  assert.equal(sorted[0].edition, 'German edition, fifth printing');
  assert.equal(sorted[1].edition, 'English edition');
});

test('sortEditionCovers drops entries with no image and never throws on junk', () => {
  assert.deepEqual(sortEditionCovers([{ edition: 'x', languages: [] }], 'de'), []);
  assert.deepEqual(sortEditionCovers([null, undefined], 'de'), []);
  assert.deepEqual(sortEditionCovers([], 'de'), []);
  assert.deepEqual(sortEditionCovers(null, 'de'), []);
  assert.deepEqual(sortEditionCovers(undefined, undefined), []);
});

test('sortEditionCovers does not mutate the list it was given', () => {
  const covers = [cover('B', ['Polish']), cover('A', ['German'])];
  const before = covers.map((c) => c.edition);
  sortEditionCovers(covers, 'de');
  assert.deepEqual(covers.map((c) => c.edition), before);
});

test('coverCaption joins edition and year, and stays empty when BGG has neither', () => {
  assert.equal(coverCaption({ edition: 'German edition', year: 2019 }), 'German edition · 2019');
  // A year of 0/null is "unknown" in BGG's data — it must not render a stray
  // separator or a bare zero.
  assert.equal(coverCaption({ edition: 'German edition', year: null }), 'German edition');
  assert.equal(coverCaption({ edition: null, year: 2019 }), '2019');
  assert.equal(coverCaption({ edition: null, year: null }), '');
  assert.equal(coverCaption(null), '');
});
