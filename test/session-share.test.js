'use strict';

/*
 * The shareable session summary (#526).
 *
 * These specs run the builder against the REAL translate function over the real
 * lang tables (the vm harness players-plural.test.js established), not a stub
 * that echoes keys back. That is deliberate: a stubbed `t` would pass just as
 * happily against a key that exists in neither language file, so the one thing
 * most likely to go wrong — a typo'd or half-added key — would be invisible.
 * Asserting the rendered German and English text is what makes that impossible.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { sessionShareText, SHARE_MEDALS, SHARE_TROPHY } = require('../public/js/session-share');

function loadI18n() {
  const dir = path.join(__dirname, '..', 'public', 'js');
  const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
  const context = {
    I18N: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: {} },
    navigator: { language: 'en' },
  };
  vm.createContext(context);
  vm.runInContext(read('locales.js'), context);
  vm.runInContext(read('i18n.js'), context);
  vm.runInContext(read('lang/en.js'), context);
  vm.runInContext(read('lang/de.js'), context);
  return context;
}

// A translate function bound to one locale, exactly as the view passes `t` in.
function translator(loc) {
  const ctx = loadI18n();
  ctx.setLocale(loc);
  return (key, params) => ctx.t(key, params);
}

// core.js's joinNames, which the view injects. It cannot be required here: it
// lives in a DOM view file, and requiring one drags its whole body into the
// coverage report (.claude/rules/frontend-helper-modules-and-coverage.md). The
// conjunction itself is read from the real lang table, so only the two-line join
// shape is restated — and the assertions pin the exact rendered sentence, which
// is what would catch it drifting from the h1.
function joinNames(loc) {
  const tr = translator(loc);
  return (names) =>
    names.length <= 1
      ? names[0] || ''
      : names.slice(0, -1).join(', ') + ' ' + tr('list.and') + ' ' + names[names.length - 1];
}

// The view model showResults hands over: rows already sorted and placed.
const model = (over = {}) => ({
  roundName: 'Donnerstagsrunde',
  when: '29.07.2026, 20:00',
  cancelled: false,
  playedTitle: 'Catan',
  winnerNames: ['Anna'],
  rows: [
    { title: 'Catan', avg: 4.5, count: 4, place: 1 },
    { title: 'Azul', avg: 4, count: 4, place: 2 },
    { title: 'Splendor', avg: 3.25, count: 4, place: 3 },
  ],
  ...over,
});

test('the summary carries the headline and every rated game, in screen order', () => {
  const text = sessionShareText(model(), translator('de'));
  assert.equal(
    text,
    'Donnerstagsrunde · 29.07.2026, 20:00\n' +
      '🏆 „Catan“ wurde gespielt. Anna hat gewonnen!\n' +
      '\n' +
      'Bewertungen:\n' +
      '🥇 Catan · Ø 4.5\n' +
      '🥈 Azul · Ø 4.0\n' +
      '🥉 Splendor · Ø 3.3'
  );
});

test('the summary is localized, not German with the numbers swapped', () => {
  const text = sessionShareText(model(), translator('en'));
  assert.match(text, /“Catan” was played\. Anna won!/);
  assert.match(text, /^Ratings:$/m);
  // No stray German copy leaked through a missing English key. `t()` falls back
  // to English, so the reverse direction cannot be checked this way — but this
  // is the direction a half-added key actually fails in.
  assert.ok(!/Bewertungen|wurde gespielt/.test(text), text);
});

test('several winners take the plural headline; none takes the played-only one', () => {
  const de = translator('de');
  assert.match(
    sessionShareText(model({ winnerNames: ['Anna', 'Ben'] }), de, joinNames('de')),
    /Anna und Ben haben gewonnen!/
  );
  assert.match(sessionShareText(model({ winnerNames: [] }), de), /„Catan“ wurde gespielt\.\n/);
  assert.ok(!/gewonnen/.test(sessionShareText(model({ winnerNames: [] }), de)));
});

test('the headline joins winners exactly as the screen\'s h1 does, in each language', () => {
  // The h1 uses core.js's joinNames ("Anna und Ben"). A local names.join(', ')
  // in the builder would put a subtly different — and worse — sentence in the
  // chat than the one the user is looking at, in every language at once.
  const three = { winnerNames: ['Anna', 'Ben', 'Clara'] };
  assert.match(
    sessionShareText(model(three), translator('de'), joinNames('de')),
    /Anna, Ben und Clara haben gewonnen!/
  );
  assert.match(
    sessionShareText(model(three), translator('en'), joinNames('en')),
    /Anna, Ben and Clara won!/
  );
});

test('a cancelled session says so and STILL carries its ratings', () => {
  // The group rated the games; they just did not play one. Dropping the ratings
  // here would throw away the only content such a message has.
  const text = sessionShareText(model({ cancelled: true, playedTitle: null, winnerNames: [] }), translator('de'));
  assert.match(text, /Session abgebrochen/);
  assert.match(text, /🥇 Catan · Ø 4\.5/);
});

test('a session with no outcome yet shares the ratings alone — no empty headline line', () => {
  const text = sessionShareText(model({ playedTitle: null, winnerNames: [] }), translator('de'));
  assert.equal(text.split('\n')[0], 'Donnerstagsrunde · 29.07.2026, 20:00');
  assert.equal(text.split('\n')[1], '');
  assert.match(text, /Bewertungen:/);
});

test('unrated games are omitted rather than shared as a bare dash', () => {
  const text = sessionShareText(
    model({ rows: [...model().rows, { title: 'Ungespielt', avg: 0, count: 0, place: null }] }),
    translator('de')
  );
  assert.ok(!/Ungespielt/.test(text), text);
});

test('with nothing rated at all the ratings block is dropped entirely', () => {
  const text = sessionShareText(
    model({ rows: [{ title: 'Ungespielt', avg: 0, count: 0, place: null }] }),
    translator('de')
  );
  assert.ok(!/Bewertungen/.test(text), text);
  assert.match(text, /„Catan“ wurde gespielt/);
});

test('tied games share a place number, exactly as the screen prints it', () => {
  // computePlaces gives "1, 2, 2, 4"; the summary must not renumber them.
  const text = sessionShareText(
    model({
      rows: [
        { title: 'Catan', avg: 4.5, count: 3, place: 1 },
        { title: 'Azul', avg: 4, count: 3, place: 2 },
        { title: 'Splendor', avg: 4, count: 3, place: 2 },
      ],
    }),
    translator('de')
  );
  assert.match(text, /🥈 Azul · Ø 4\.0\n🥈 Splendor · Ø 4\.0/);
});

test('places past bronze fall back to a plain number, as the screen does', () => {
  // The screen medals places 1-3 and nothing else (rank-medal--gold/silver/
  // bronze), so a fourth game must not invent a medal or drop out of the list.
  const text = sessionShareText(
    model({
      rows: [
        { title: 'Catan', avg: 4.5, count: 3, place: 1 },
        { title: 'Azul', avg: 4, count: 3, place: 2 },
        { title: 'Splendor', avg: 3.5, count: 3, place: 3 },
        { title: 'Carcassonne', avg: 3, count: 3, place: 4 },
      ],
    }),
    translator('de')
  );
  assert.match(text, /^4\. Carcassonne · Ø 3\.0$/m);
  assert.equal(SHARE_MEDALS.length, 3, 'a fourth medal would silently change the fallback');
});

test('the trophy marks a win and nothing else', () => {
  const de = translator('de');
  const has = (over) => sessionShareText(model(over), de).includes(SHARE_TROPHY);
  assert.ok(has({}), 'a recorded win should carry the trophy');
  // A trophy over „Session abgebrochen" would be reading the room badly, and a
  // played-but-unrecorded session has no result to crown yet.
  assert.ok(!has({ cancelled: true, playedTitle: null, winnerNames: [] }), 'cancelled');
  assert.ok(!has({ winnerNames: [] }), 'played, no winner recorded');
  assert.ok(!has({ playedTitle: null, winnerNames: [] }), 'no outcome yet');
});

test('the summary contains no cover art, link or footer — only the group\'s own words', () => {
  // Provider covers may not be redistributed, and the issue scopes the text to
  // what the screen already shows. A URL creeping in would also make the
  // message an outbound reference we never agreed to publish.
  const text = sessionShareText(model(), translator('de'));
  assert.ok(!/https?:\/\/|spielwirbel\.app|\.jpg|\.png/i.test(text), text);
});
