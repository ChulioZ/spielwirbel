'use strict';

/* The home empty state is the create-round CTA (#358).

   The bug: with no rounds, `.lobby-list` held exactly one item — the dashed
   `.round-card--new` — and from 860px up that grid is
   `repeat(auto-fill, minmax(360px, 1fr))`. `auto-fill` packs items into the
   leftmost track, so the lone card rendered ~360px wide against the left edge
   of an up-to-1800px shell while the welcome text above it stayed capped and
   centred. On the very first screen a new account sees.

   The fix removes the stray card rather than repositioning it: the empty state
   renders one centred `.lobby-cta` anchor and NO grid at all. What is pinned
   here is the pair of properties that make that centring work, both of which
   can be undone silently:

   - the CTA must not be named in the >= 1280px grid exemption (that lifts the
     --w-read cap and stretches it across the full shell — the same defect in a
     different shape), and
   - it must be a real <a href="/round/new"> (`.claude/rules/in-app-nav-links.md`).

   CSS parsing traps (stripped comments, whole-class matching) live in
   test/support/css.js — see `.claude/rules/css-text-assertions-strip-comments.md`. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { RULES, bodyOf, mediaBlocks, whole } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'public/js/views-home.js'), 'utf8');

/** Loads a lang table the way i18n-parity does — they are browser scripts. */
function loadLocale(name) {
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/lang', `${name}.js`), 'utf8'), context);
  return context.I18N[name];
}

test('the empty state renders a .lobby-cta anchor and no lobby grid', () => {
  // The `rounds.length === 0` branch, up to the `else` that renders the grid.
  const branch = VIEW.match(/rounds\.length === 0\)\s*\{([\s\S]*?)\n\s*\}\s*else\s*\{/);
  assert.ok(branch, 'showHome no longer has an `if (rounds.length === 0) { … } else {` shape');
  /* Strip comments first — the same trap as the stylesheet parsing: the branch's
     own comment explains the fix by NAMING `.lobby-list`, so a raw text search
     matches prose and reports the grid as present. */
  const empty = branch[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.match(empty, /<a class="lobby-cta"/, 'the empty state does not build an <a class="lobby-cta">');
  // A real link, not a click-handler div: Cmd/Ctrl/middle-click must work.
  assert.match(
    empty,
    /navLink\(\s*cta\s*,\s*'\/round\/new'/,
    'the empty-state CTA is not wired through navLink() to /round/new',
  );
  /* The whole point: no grid in this state, so there is no lone card to pack
     left. Both spellings are checked — the markup, and the helper that builds
     it. `renderLobbyList` does NOT contain the string "lobby-list", so a class
     search alone stays green against the single most likely regression (calling
     the helper unconditionally again). Verified by making exactly that edit. */
  assert.doesNotMatch(
    empty,
    /renderLobbyList/,
    'the empty state calls renderLobbyList() — the lone new-round card will pack to the left',
  );
  assert.doesNotMatch(
    empty,
    whole('lobby-list'),
    'the empty state builds a .lobby-list again — the lone new-round card will pack to the left',
  );
  assert.doesNotMatch(
    empty,
    whole('round-card--new'),
    'the empty state renders the separate dashed new-round card again',
  );
});

test('.lobby-cta is declared and keeps the CTA inside a readable, centred column', () => {
  const body = bodyOf('.lobby-cta');
  assert.ok(body, '.lobby-cta rule not found');
  assert.match(body, /text-align:\s*center/, '.lobby-cta is not centred');

  /* The >= 1280px block caps every direct `.app` child at --w-read and centres
     it (`.app:not(:has(.rail)) > *`), which is what makes the CTA sit in the
     middle of the shell without a rule of its own. Naming it in the exemption
     alongside the grids would lift that cap and stretch it edge to edge. */
  const wide = mediaBlocks().filter(([q]) => /min-width:\s*1280px/.test(q));
  assert.ok(wide.length, 'no min-width: 1280px block found');

  const exemptions = RULES.filter(([sel]) => /max-width:\s*none/.test(bodyOf(sel) || '') && /\.app\s*>/.test(sel));
  assert.ok(exemptions.length, 'the grid width exemption rule was not found');
  for (const [sel] of exemptions) {
    // Not vacuous: .lobby-list must still be exempt, so a deleted exemption
    // fails here rather than making the .lobby-cta assertion trivially true.
    assert.match(sel, whole('.lobby-list'), 'the lobby grid lost its width exemption');
    assert.doesNotMatch(
      sel,
      whole('.lobby-cta'),
      '.lobby-cta was added to the grid width exemption — it will stretch across the full shell',
    );
  }
});

test('the empty-state copy no longer points at a separate button', () => {
  // The sub-lines used to read "Gründet UNTEN eure erste Runde" / "Start your
  // first round BELOW", pointing at the dashed card this change removes. Left
  // as-is they would direct a new user at a control that is no longer there.
  const pointers = { de: /\bunten\b/i, en: /\bbelow\b/i };
  for (const lang of ['de', 'en']) {
    const dict = loadLocale(lang);
    for (const key of ['home.empty.sub', 'home.onboard.sub']) {
      assert.ok(dict[key], `${lang}.js is missing ${key}`);
      assert.doesNotMatch(
        String(dict[key]),
        pointers[lang],
        `${lang}.js "${key}" still points below at the removed new-round card`,
      );
    }
  }
});
