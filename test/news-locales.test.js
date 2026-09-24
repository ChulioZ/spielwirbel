'use strict';

/* Every „Was ist neu" entry carries every shipped locale (#1087).

   The news list is deliberately OUTSIDE the lang/*.js tables — one entry is one
   edit, and test/i18n-parity.test.js never has to care (see the header of
   public/js/news.js). That design is also exactly why nothing warned as seven
   more locales shipped: a reader who had switched the whole UI to Finnish or
   Korean opened the screen and got English, the only screen in the app that did
   that.

   So the required set is DERIVED from public/js/locales.js rather than listed
   here. A tenth language then cannot ship without its news, and it is the same
   call `.claude/rules/locale-set-is-data.md` makes everywhere else: a hardcoded
   ['de', 'en'] is the bug this file exists to prevent, so it must not reappear
   in the test either.

   Named news-locales, not news: test/news-screen.test.js already exists and a
   collision silently overwrites rather than failing
   (.claude/rules/test-file-names-collide-silently.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NEWS, newsText } = require('../public/js/news');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

test('the locale set is derived, and there is something to check', () => {
  // Anti-vacuous on both axes: an empty NEWS or a one-locale set would make
  // every assertion below trivially true.
  assert.ok(NEWS.length >= 1, 'the news list is empty — every check below is vacuous');
  assert.ok(SUPPORTED_LOCALES.length >= 2, 'locales.js yielded fewer than two languages');
});

test('every entry is written in every shipped locale', () => {
  for (const entry of NEWS) {
    for (const code of SUPPORTED_LOCALES) {
      const block = entry[code];
      assert.ok(block, `entry ${entry.revision} has no "${code}" block`);
      assert.ok(typeof block.title === 'string' && block.title.trim(),
        `entry ${entry.revision} has an empty ${code} title`);
      assert.ok(typeof block.body === 'string' && block.body.trim(),
        `entry ${entry.revision} has an empty ${code} body`);
    }
  }
});

test('no entry carries a key that is neither `revision`, `kind` nor a shipped locale', () => {
  /* The half a "has every locale" check misses: `kr:` instead of `ko:` satisfies
     nothing and breaks nothing — newsText() falls back to English and the screen
     renders, so the typo ships and reads as a missing translation forever. */
  // `kind` (#1281) is the one non-locale field besides the revision; its values
  // are pinned in test/tisch-news-stats-disc.test.js.
  const allowed = new Set(['revision', 'kind', ...SUPPORTED_LOCALES]);
  for (const entry of NEWS) {
    for (const key of Object.keys(entry)) {
      assert.ok(allowed.has(key),
        `entry ${entry.revision} carries "${key}", which is not a shipped locale — a typo falls back silently`);
    }
  }
});

test('newsText returns the reader’s own language for every shipped locale', () => {
  /* Asserting the ACCESSOR, not just the data: the fallback chain is what the
     screen actually calls, and a block present under a key newsText does not
     look up would satisfy the checks above and still render English. */
  for (const entry of NEWS) {
    for (const code of SUPPORTED_LOCALES) {
      assert.equal(newsText(entry, code), entry[code],
        `newsText fell back instead of returning the ${code} block of ${entry.revision}`);
    }
  }
});

test('no revision was moved by a translation — the dot must not re-light', () => {
  /* Translating an existing entry changes no capability, so re-lighting the
     unseen dot would spend the attention the Nutzungsbedingungen §11 terms
     notice needs (the #851 call, recorded in news.js). Revisions are dates and
     must stay strictly newest-first: the first entry's revision is what the dot
     compares against. */
  const revisions = NEWS.map((e) => e.revision);
  for (const r of revisions) {
    assert.match(r, /^\d{4}-\d{2}-\d{2}$/, `revision "${r}" is not an ISO date`);
  }
  const sorted = [...revisions].sort().reverse();
  assert.deepEqual(revisions, sorted, 'the list is not newest-first — the unseen dot compares against NEWS[0]');
});
