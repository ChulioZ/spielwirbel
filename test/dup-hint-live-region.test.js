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

   None of that is observable from Node — there is no accessibility tree — and
   the Browser pane cannot prove an announcement either. So it is pinned as
   source text, the way editor-presentation.test.js and ds-row-affordance.test.js
   pin their own silent invariants. A regression here is invisible: the hint
   still appears, still reads correctly, still never blocks saving, and every
   other test stays green. Only the announcement dies.

   Comments are stripped before matching — a regex over raw source binds inside
   a comment that merely MENTIONS the thing it is looking for
   (`.claude/rules/css-text-assertions-strip-comments.md`). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, bodyOf, RULES, whole } = require('./support/css');

const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const LOOKUP = strip(fs.readFileSync(path.join(ROOT, 'public/js/views-round-lookup.js'), 'utf8'));

// A function's body, brace-matched from its declaration.
function bodyOfFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// The `<div … id="dupHint" …>` tag as written in showAddGame's template.
function dupHintTag() {
  const m = LOOKUP.match(/<div[^>]*\bid="dupHint"[^>]*>/);
  assert.ok(m, 'the #dupHint element was not found in views-round-lookup.js');
  return m[0];
}

test('the duplicate hint is an announced live region', () => {
  const tag = dupHintTag();
  assert.match(tag, /\brole="status"/, `#dupHint must carry role="status": ${tag}`);
  assert.match(tag, /\baria-live="polite"/, `#dupHint must carry aria-live="polite": ${tag}`);
  /* aria-atomic, so the whole hint is read rather than only the words that
     changed between "Ist schon im Regal." and "Ist im Archiv dieser Runde." */
  assert.match(tag, /\baria-atomic="true"/, `#dupHint must carry aria-atomic="true": ${tag}`);
});

test('the duplicate hint is never removed from the accessibility tree', () => {
  /* The `hidden` attribute is the exact shape #584 replaced: it takes the
     region out of the tree, so un-hiding it re-inserts it with its text already
     in place and nothing is announced. */
  assert.doesNotMatch(dupHintTag(), /\shidden(?=[\s/>=])/, '#dupHint must not ship the `hidden` attribute');

  const body = bodyOfFn(LOOKUP, 'refreshDupHint');
  assert.doesNotMatch(body, /\.hidden\s*=/, 'refreshDupHint must not assign the `hidden` property');

  /* CSS is the other way out of the tree, and it is the one a later "tidy-up"
     reaches for — `display: none` on the empty state looks equivalent and is
     not. Check every rule whose selector names the hint, not just the base one,
     so a `.field__hint--dup:not(.is-on) { display: none }` is caught too. */
  const hintRules = RULES.filter(([sel]) => whole('field__hint--dup').test(sel));
  assert.ok(hintRules.length >= 2, `expected >= 2 .field__hint--dup rules, found ${hintRules.length}`);
  for (const [sel, css] of hintRules) {
    assert.doesNotMatch(css, /display\s*:\s*none/, `${sel} must not hide the live region with display: none`);
  }
});

test('the duplicate hint clears its text when there is no duplicate', () => {
  const body = bodyOfFn(LOOKUP, 'refreshDupHint');
  /* Blanking on hide is what makes re-typing the SAME title a reported mutation
     rather than a no-op — the reason toast() does it too. The ternary's empty
     branch is that blanking. */
  assert.match(
    body,
    /textContent\s*=\s*state\s*\?[^;]*:\s*''/,
    'refreshDupHint must clear textContent when there is no duplicate state',
  );
  // Visibility is a class, which is all that is left once `hidden` is gone.
  assert.match(body, /classList\.toggle\('is-on'/, 'refreshDupHint must toggle visibility with a class');
});

test('the title field points at the hint with aria-describedby', () => {
  const m = LOOKUP.match(/<input[^>]*\bid="title"[^>]*>/);
  assert.ok(m, 'the #title input was not found in views-round-lookup.js');
  assert.match(m[0], /\baria-describedby="dupHint"/, `#title must describe itself with the hint: ${m[0]}`);
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
