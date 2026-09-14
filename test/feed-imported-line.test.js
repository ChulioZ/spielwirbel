'use strict';

/* How a collection import reads in a friend's feed (#1079).

   The line is the whole point of the change: an import of 23 games used to say
   "Ada added Catan to the shelf", which picks one game out of a batch for no
   visible reason. It now says "and N more games" — and the N is `count - 1`,
   which is the part that is easy to get wrong in a way no route test can see.

   The view is RUN through the jsdom harness rather than source-matched
   (.claude/rules/testing-views-under-jsdom.md): the plural and the fallback are
   decisions taken at render time, and a text match over feedText() would pass
   against either branch. The harness loads views via `vm` and never `require`s
   them — a view file in the coverage report sinks coverage:ci
   (.claude/rules/frontend-helper-modules-and-coverage.md).

   Named for the line it covers: test/feed.test.js, test/feed-events.test.js,
   test/feed-report.test.js and test/feed-author-badge.test.js are all taken, and
   a collision silently overwrites
   (.claude/rules/test-file-names-collide-silently.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

const base = {
  username: 'ada',
  title: 'Catan',
  at: '2026-09-01T18:00:00Z',
  coverUrl: null,
};

function lineFor(t, event, locale = 'de') {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  const item = dom.call('renderFeedEvent', { ...base, ...event });
  return { item, text: item.querySelector('.feed-item__text').textContent };
}

test('an import of three games reads "and 2 more games", not "and 3"', (t) => {
  // `{n}` is count - 1: Catan is already named, so the rest is what is "more".
  const { text } = lineFor(t, { type: 'games_imported', count: 3 });
  assert.match(text, /Catan/, 'the first game is still named');
  assert.match(text, /\b2\b/, 'the count in the line must be count - 1');
  assert.doesNotMatch(text, /\b3\b/, 'the line names the total instead of the remainder');
});

test('an import of two games takes the SINGULAR', (t) => {
  const many = lineFor(t, { type: 'games_imported', count: 3 }).text;
  const one = lineFor(t, { type: 'games_imported', count: 2 }).text;
  assert.match(one, /\b1\b/);
  assert.notEqual(one, many, 'both counts produced the same sentence — tn() is not branching');
  assert.match(one, /weiteres Spiel/, 'German singular');
  assert.match(many, /weitere Spiele/, 'German plural');
});

test('the plural branches in every shipped locale, not just German', (t) => {
  // tn() derives its category from Intl.PluralRules per locale
  // (.claude/rules/locale-set-is-data.md). Korean has one category by design, so
  // it is the deliberate exception rather than a missing translation.
  const { LOCALES } = require('../public/js/locales');
  for (const { code } of LOCALES) {
    const one = lineFor(t, { type: 'games_imported', count: 2 }, code).text;
    const many = lineFor(t, { type: 'games_imported', count: 3 }, code).text;
    assert.ok(one.trim() && many.trim(), `${code} rendered nothing`);
    assert.doesNotMatch(one, /friends\.feed\./, `${code} rendered the raw i18n key`);
    if (code !== 'ko') {
      assert.notEqual(one.replace(/\d+/g, '#'), many.replace(/\d+/g, '#'),
        `${code} produced the same sentence for one and many`);
    }
  }
});

test('a games_imported row with NO count renders as a plain "added", never a crash', (t) => {
  /* Defensive, and it describes real production rows: every past import wrote a
     `game_added` for the first game, and those age out over MAX_FEED_EVENTS
     rather than being migrated. A row that somehow arrives as this type without
     a count still carries the title, so the older sentence is the honest one. */
  const { text } = lineFor(t, { type: 'games_imported' });
  assert.match(text, /Catan ins Regal gestellt/);
  assert.doesNotMatch(text, /weiter/, 'it rendered an "and N more" with no N');
});

test('a count of 1 or 0 also falls back rather than saying "and 0 more"', (t) => {
  for (const count of [1, 0]) {
    const { text } = lineFor(t, { type: 'games_imported', count });
    assert.match(text, /Catan ins Regal gestellt/, `count ${count} produced an aggregate line`);
  }
});

test('the two older types are untouched by the new branch', (t) => {
  assert.match(lineFor(t, { type: 'session_played' }).text, /Catan gespielt/);
  assert.match(lineFor(t, { type: 'game_added' }).text, /Catan ins Regal gestellt/);
  // A stray count on an old type must not switch it to the aggregate phrasing.
  assert.match(lineFor(t, { type: 'game_added', count: 9 }).text, /Catan ins Regal gestellt/);
});

test('the row still carries its cover and its report subject', (t) => {
  // The reason the first game's identity rides along at all.
  const { item } = lineFor(t, {
    type: 'games_imported', count: 5, coverUrl: 'https://example.test/c.png',
  });
  assert.match(item.querySelector('.feed-item__img').getAttribute('style') || '', /c\.png/);
  assert.equal(item.querySelector('.feed-item__text').textContent.includes('Catan'), true);
});
