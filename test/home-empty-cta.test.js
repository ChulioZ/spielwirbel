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
const { loadApp } = require('./support/dom');

const ROOT = path.join(__dirname, '..');

/** Loads a lang table the way i18n-parity does — they are browser scripts. */
function loadLocale(name) {
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/lang', `${name}.js`), 'utf8'), context);
  return context.I18N[name];
}

/** The home screen over a given round list, rendered for real (#602). */
async function home(t, rounds) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => rounds);
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showHome');
  return dom;
}

test('the empty state renders a .lobby-cta anchor and no lobby grid', async (t) => {
  /* This used to slice showHome's `rounds.length === 0` branch out of the file
     and match strings in it. It now renders the screen, which removes the whole
     class of ways that could be wrong — a branch that stops being taken, a
     helper renamed, markup moved behind a call the slice does not span. */
  const { document } = await home(t, []);

  const cta = document.querySelector('.lobby-cta');
  assert.ok(cta, 'the empty state does not render a .lobby-cta');
  // A real link, not a click-handler div: Cmd/Ctrl/middle-click must work
  // (`.claude/rules/in-app-nav-links.md`), which needs a genuine href.
  assert.equal(cta.tagName, 'A', `the CTA is a <${cta.tagName.toLowerCase()}>, so a modified click cannot open it in a new tab`);
  assert.equal(cta.getAttribute('href'), '/round/new');
  // navLink() stamps this class on what it wires; without it the anchor is a
  // full page reload rather than an in-app route.
  assert.ok(cta.classList.contains('nav-link'), 'the empty-state CTA is not wired through navLink()');

  /* The whole point: no grid in this state, so there is no lone card to pack
     left against an 1800px shell. */
  assert.equal(document.querySelector('.lobby-list'), null,
    'the empty state renders a .lobby-list again — the lone new-round card will pack to the left');
  assert.equal(document.querySelector('.round-card--new'), null,
    'the empty state renders the separate dashed new-round card again');
});

test('a non-empty home still renders the grid — and no CTA', async (t) => {
  /* The control that makes the test above non-vacuous. Every assertion up
     there is satisfied by a showHome that renders nothing at all, or that
     threw early; only the other branch proves the grid still exists and that
     the two states are genuinely distinct. */
  // The shape listRoundSummaries returns (lib/repo/json.js), not an invented one.
  const { document } = await home(t, [{
    id: 1, name: 'Donnerstagsrunde', members: [], memberCount: 0,
    gameCount: 3, sessionCount: 1, playedCount: 1, background: null, lastPlayed: null,
  }]);

  assert.ok(document.querySelector('.lobby-list'), 'the populated home lost its round grid');
  assert.ok(document.querySelector('.round-card--new'), 'the populated home lost its dashed new-round card');
  assert.equal(document.querySelector('.lobby-cta'), null, 'the empty-state CTA renders on a home that has rounds');
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
