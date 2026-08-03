'use strict';

/* A forward navigation lands at the top of the new screen (#623).

   `history.pushState` does not touch scroll, so every in-app navigation used to
   keep the previous screen's offset and let the browser clamp it to the new
   document. Measured in a browser before the fix: a Regal (8871px tall)
   scrolled to 2600, opening a game detail (2080px tall), landed at 2080 — the
   very bottom of the game detail, past the cover, the title and every chip.
   Eighteen views had no reset; only the session flow hand-rolled three.

   Both constraints below fail SILENTLY, which is why they are pinned rather
   than left to review:

   1. Push branch only. The replace branch is also how a screen re-renders
      itself in place (`updateGame()` → `showGameDetail()` after every PATCH),
      so a reset there would jump the user to the top every time they renamed a
      game.
   2. AFTER `pushState`, never before. The browser records the OUTGOING entry's
      scroll position at navigation time, so resetting first writes 0 into that
      entry and destroys back-restoration. Measured in isolation:
      pushState-then-scroll restores 2600, scroll-then-pushState restores 0. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

/* Record pushState / replaceState / scrollTo in ONE sequence. The order is the
   assertion, so two separate counters would not be able to state it. */
function instrument(dom) {
  dom.run(`
    globalThis.__seq = [];
    const _push = history.pushState.bind(history);
    history.pushState = (...a) => { __seq.push('push'); return _push(...a); };
    const _replace = history.replaceState.bind(history);
    history.replaceState = (...a) => { __seq.push('replace'); return _replace(...a); };
    window.scrollTo = (...a) => { __seq.push('scroll:' + a.join(',')); };
  `);
  // Round-trip through JSON: an array built inside the vm context belongs to
  // another realm, so assert.deepEqual fails it against a native array on the
  // prototype alone — a false red that says `['replace'] !== ['replace']`.
  return () => JSON.parse(dom.get('JSON.stringify(__seq)'));
}

test('a forward navigation resets scroll, after the push', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const seq = instrument(dom);

  dom.call('syncUrl', '/round/r1/game/g1');

  assert.deepEqual(seq(), ['push', 'scroll:0,0'],
    'a pushed navigation must push first and then reset scroll — the order is what preserves back-restoration');
});

test('a same-path re-render does NOT reset scroll', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());

  // Put the app on the path first, so the second call takes the replace branch
  // the way an in-place re-render does.
  dom.call('syncUrl', '/round/r1/game/g1');
  const seq = instrument(dom);
  dom.call('syncUrl', '/round/r1/game/g1');

  assert.deepEqual(seq(), ['replace'],
    'a screen re-rendering itself (rename a game, save a member) jumps to the top');
});

test('the session flow no longer hand-rolls its own scroll resets', async () => {
  /* The wizard's four `window.scrollTo` calls fired on EVERY render — including
     a popstate-driven re-render (where the browser is restoring the position)
     and a language switch (where nothing navigated at all). The central reset
     in syncUrl subsumes the forward case and leaves the other two alone, so
     keeping them would actively undo back-restoration inside the wizard. */
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views-session.js'), 'utf8');
  const strays = [...src.matchAll(/window\.scrollTo\s*\(/g)];
  assert.equal(strays.length, 0,
    `views-session.js still hand-rolls ${strays.length} scroll reset(s); syncUrl covers the forward case for every view`);
});
