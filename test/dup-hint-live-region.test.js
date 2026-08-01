'use strict';

/* The add-game duplicate-title hint (#524) was VISIBLE but silent: a screen
   reader user typing a title already in the round got no signal at all, and it
   is the only warning before a duplicate row is created. #584 made it an
   announced live region.

   The obvious fix — an `aria-live` attribute on the element as it stood — would
   have looked correct and changed nothing audible, because the hint was toggled
   with the `hidden` attribute while its text was assigned in the same moment,
   and a region revealed with its text already in place is never announced
   (`.claude/rules/accessibility-contrast-and-modals.md` §4). So what has to be
   pinned is the MECHANISM, not the presence of the attributes: the element must
   stay rendered and empty, and only its text may change.

   No test can prove an ANNOUNCEMENT happened — there is no accessibility tree
   in Node and the Browser pane cannot observe one either. But the mechanism
   that decides whether one can happen is ordinary DOM, so since #602 the sheet
   is rendered and the element inspected: it must be in the tree from the start,
   empty, and only its text may change. A regression here is otherwise
   invisible: the hint still appears, still reads correctly, still never blocks
   saving, and every other test stays green. Only the announcement dies.

   The CSS half stays source-matched — jsdom applies no external stylesheet, so
   a `display: none` that removes the region from the tree is exactly what it
   cannot see (parsed via test/support/css.js, which strips comments first:
   `.claude/rules/css-text-assertions-strip-comments.md`). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { bodyOf, RULES, whole } = require('./support/css');
const { loadApp } = require('./support/dom');

/* ------------------- the rendered sheet (#602) ------------------------------ */

const ROUND = {
  id: 1,
  name: 'Donnerstagsrunde',
  games: [{ id: 7, title: 'Catan', retired: false, completed: false }],
  tags: [],
  providers: [],
  members: [],
  sessions: [],
  activity: [],
};

/** The add-game sheet, opened for real, with its title field and hint. */
async function addGameSheet(t) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ROUND);
  await dom.call('showAddGame', ROUND);
  const title = dom.document.getElementById('title');
  const hint = dom.document.getElementById('dupHint');
  assert.ok(title && hint, 'the add-game sheet rendered without its title field or duplicate hint');
  // Typing, as the user does — `.value =` alone fires no input event.
  const type = (text) => {
    title.value = text;
    title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  return { dom, title, hint, type };
}

test('the duplicate hint is an announced live region', async (t) => {
  const { hint } = await addGameSheet(t);
  assert.equal(hint.getAttribute('role'), 'status', '#dupHint must carry role="status"');
  assert.equal(hint.getAttribute('aria-live'), 'polite', '#dupHint must carry aria-live="polite"');
  /* aria-atomic, so the whole hint is read rather than only the words that
     changed between "Ist schon im Regal." and "Ist im Archiv dieser Runde." */
  assert.equal(hint.getAttribute('aria-atomic'), 'true', '#dupHint must carry aria-atomic="true"');
});

test('the hint is in the tree from the start, and empty', async (t) => {
  /* The exact shape #584 replaced: a region revealed WITH its text already in
     place is never announced. So it must be present before anything is typed
     (the `hidden` attribute and `display: none` both take it out of the tree)
     and it must be empty, or the first real duplicate is not a mutation. */
  const { hint } = await addGameSheet(t);
  assert.equal(hint.hasAttribute('hidden'), false, '#dupHint must not ship the `hidden` attribute');
  assert.equal(hint.textContent, '', 'the hint starts with text in place — the first duplicate would announce nothing');
});

test('typing a duplicate fills the hint; typing past it empties the SAME node', async (t) => {
  /* The mechanism, end to end. The old version asserted that refreshDupHint's
     source contained a `? … : ''` ternary — which is true of a function that
     writes to the wrong element, is never wired to the input, or removes the
     node on the way. */
  const { hint, type } = await addGameSheet(t);

  /* `hidden` is re-checked after every transition, not only at first render:
     refreshDupHint runs on input, so a `dupHint.hidden = !state` reintroduced
     inside it leaves the initial markup untouched and only takes the region out
     of the tree once the user starts typing — i.e. exactly when it matters, and
     invisibly to a check made before the first keystroke. (Found by making that
     edit on purpose: the render-time assertion alone stayed green.) */
  const inTree = (where) => {
    assert.equal(hint.isConnected, true, `the hint left the document ${where} — it cannot be announced`);
    assert.equal(hint.hasAttribute('hidden'), false, `the hint was hidden ${where}, which removes it from the tree`);
  };

  type('Catan');
  assert.notEqual(hint.textContent, '', 'typing a title already in the round announced nothing');
  assert.equal(hint.classList.contains('is-on'), true, 'the hint has text but is not shown');
  inTree('while showing a duplicate');

  type('Azul');
  assert.equal(hint.textContent, '', 'the hint kept its text for a title that is not a duplicate');
  assert.equal(hint.classList.contains('is-on'), false, 'the hint stayed visible with nothing to say');
  /* Blanking rather than removing is what makes re-typing the SAME title a
     reported mutation rather than a no-op — the reason toast() does it too. */
  inTree('once the duplicate cleared');

  type('Catan');
  assert.notEqual(hint.textContent, '', 'the same duplicate a second time no longer announces');
});

test('the title field points at the hint with aria-describedby', async (t) => {
  const { title, hint } = await addGameSheet(t);
  assert.equal(title.getAttribute('aria-describedby'), 'dupHint', '#title must describe itself with the hint');
  assert.equal(hint.id, 'dupHint');
});

test('CSS must not take the live region out of the tree', () => {
  /* jsdom applies no external stylesheet, so this is the one half the rendered
     tests above cannot see — and `display: none` on the empty state is exactly
     what a later "tidy-up" reaches for, because it looks equivalent to the
     class toggle and is not. Every rule naming the hint is checked, so a
     `.field__hint--dup:not(.is-on) { display: none }` is caught too. */
  const hintRules = RULES.filter(([sel]) => whole('field__hint--dup').test(sel));
  assert.ok(hintRules.length >= 2, `expected >= 2 .field__hint--dup rules, found ${hintRules.length}`);
  for (const [sel, css] of hintRules) {
    assert.doesNotMatch(css, /display\s*:\s*none/, `${sel} must not hide the live region with display: none`);
  }
});

test('the empty hint costs no vertical space', () => {
  /* The price of keeping the region rendered. Note this reset is REDUNDANT as
     the sheet is built today — the hint is `.field`'s last child and has zero
     height, so its margin collapses through into `.field`'s 18px margin-bottom;
     measured in a browser, removing the reset moves nothing. It is pinned
     anyway because it stops being redundant the moment `.field` gains a
     padding-bottom or a border, and the regression then is a 6px gap under the
     search hint on EVERY add-game open, duplicate or not — invisible to every
     other test and easy to blame on the wrong change. It also has to win on
     SPECIFICITY, (0,2,0) against `.field__hint`'s (0,1,0), not on source
     order. */
  const base = bodyOf('.field__hint');
  assert.ok(base && /margin-top:\s*6px/.test(base), '.field__hint should still declare its 6px margin-top');

  const collapsed = bodyOf('.field__hint--dup:not(.is-on)');
  assert.ok(collapsed, 'the empty duplicate hint must reset the inherited margin');
  assert.match(collapsed, /margin-top:\s*0/, `expected margin-top: 0, got: ${collapsed}`);
});
