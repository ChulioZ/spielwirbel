'use strict';

/* The round's Einstellungen screen (#561).

   Three round-LEVEL actions used to live in tab footers: "Spiele verschieben"
   and "Einladen" under the whole Regal grid, and "Diese Runde löschen" under the
   whole Chronik timeline. That last one was the sharp end — the Chronik footer
   was the only one that was NOT `rail-owned`, so it sat below the entire
   month-grouped history at every width while the rail carried no entry for it at
   all. On a phone, deleting a round meant switching tabs and scrolling past the
   whole history.

   None of that is observable from Node: it is placement, so the DOM is built
   correctly either way and nothing throws. What a regression looks like is a
   footer quietly growing an action back, or the settings screen losing one —
   with every other test green. So it is pinned as source text, the way
   `editor-presentation.test.js` and `dock-footer-clearance.test.js` pin their
   own silent-visual invariants.

   Comments are stripped before matching: a regex over raw source binds inside a
   comment that merely MENTIONS the thing it is looking for, and every comment
   here names the actions that moved
   (`.claude/rules/css-text-assertions-strip-comments.md`). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { bodyOf } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const SETTINGS = strip(read('public/js/views-round-settings.js'));
const TABS = strip(read('public/js/views-round-tabs.js'));
const ROUND = strip(read('public/js/views-round.js'));
const RAIL = strip(read('public/js/round-rail.js'));
const ROUTER = strip(read('public/js/router.js'));
const SESSION = strip(read('public/js/views-session.js'));

// A function's body, brace-matched from its declaration. `async function X(`
// contains `function X(`, so both forms resolve.
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

const SCREEN = bodyOfFn(SETTINGS, 'showRoundSettings');
const REGAL = bodyOfFn(TABS, 'renderRegalTab');
const CHRONIK = bodyOfFn(TABS, 'renderChronikTab');

test('the round-level actions are gone from the Regal footer, which keeps its archives', () => {
  assert.doesNotMatch(REGAL, /showMoveGames\(/, '"Spiele verschieben" is back under the game grid (#561)');
  assert.doesNotMatch(REGAL, /showInvite\(/, '"Einladen" is back under the game grid (#561)');
  // Anti-vacuous: the footer itself must still be there. Without this the two
  // assertions above pass just as happily against a deleted footer.
  assert.match(REGAL, /showRetired\(/, 'the Regal footer lost its retired-archive link');
  assert.match(REGAL, /showCompleted\(/, 'the Regal footer lost its completed-archive link');
});

test('the Chronik carries no round deletion, and still renders its timeline', () => {
  // `round.`-qualified: the timeline legitimately keeps `activity.deleteConfirm`
  // for deleting a single entry, which a bare /deleteConfirm/ would match.
  assert.doesNotMatch(CHRONIK, /round\.deleteRound|round\.deleteConfirm/, 'deleting the round is back under the history (#561)');
  assert.doesNotMatch(CHRONIK, /share\.leave/, 'leaving the round is back under the history (#561)');
  assert.match(CHRONIK, /renderTimeline\(\)/, 'the Chronik lost its timeline');
});

test('the settings screen offers all three actions it took over', () => {
  assert.match(SCREEN, /showMoveGames\(round\)/, 'the settings screen cannot move games');
  assert.match(SCREEN, /showInvite\(round\)/, 'the settings screen cannot invite');
  assert.match(SCREEN, /'DELETE', '\/api\/rounds\/' \+ rid/, 'the settings screen cannot delete the round');
  assert.match(SCREEN, /shares\/\$\{accountUser\.id\}/, 'the settings screen cannot leave a shared round');
});

/* The gating is the half that is dangerous to lose: both sheet actions are
   owner-only (#207/#411 — the routes 403/404 a grantee), so offering either on a
   shared round would hand a grantee a button that cannot work. The delete/leave
   split is the same fact seen from the other side. */
test('the owner-only gating moved across intact', () => {
  assert.match(SCREEN, /round\.games\.length && !round\.shared/, 'move-games lost its owner/shelf gate');
  assert.match(SCREEN, /accountsActive\(\) && !round\.shared/, 'invite lost its accounts/owner gate');
  assert.match(SCREEN, /round\.shared \?[\s\S]*?leaveIntro/, 'the intro no longer distinguishes leaving from deleting');
  // The destructive branch is picked by round.shared, not by anything else: a
  // grantee must never be offered delete, nor an owner "leave".
  assert.match(SCREEN, /if \(round\.shared\) \{/, 'the delete/leave branch is no longer keyed on round.shared');
});

test('the screen is routed, and both navs agree on which section owns it', () => {
  assert.match(ROUTER, /sub === 'settings'\) return \(\) => showRoundSettings\(rid\)/, '/round/:rid/settings does not resolve');
  assert.match(ROUND, /start: \[[^\]]*'settings'/, "the strip does not know the Start tab owns 'settings'");
  // 'settings' reaches RAIL_OWN_ENTRY through the spread of RAIL_SETTINGS_SUB
  // (#581), so assert the membership rather than a literal in that array.
  assert.match(RAIL, /RAIL_SETTINGS_SUB = \[[^\]]*'settings'/, 'the rail cannot mark its own settings row current');
  assert.match(RAIL, /showRoundSettings\(rid\)/, 'the rail has no way into the settings screen');
});

/* Deliberate: the rail carries NO destructive control. A delete sitting in
   persistent navigation is one misclick away on every screen of the round; the
   danger zone on the settings screen is its single home at every width. */
test('the rail carries no destructive round action', () => {
  assert.doesNotMatch(RAIL, /round\.deleteRound|round\.deleteConfirm|share\.leave/, 'a destructive action was added to the persistent rail (#561)');
});

/* #581: the settings group is ONE row. It briefly held six — the three routed
   screens, both sheet actions, and the screen that already contains all five —
   so the rail was a second, longer navigation model competing with the single
   entry every width below 1280px uses. */
test('the rail settings group is a single Einstellungen entry', () => {
  const rail = bodyOfFn(RAIL, 'buildRoundRail');
  assert.match(rail, /roundPath\(rid, 'settings'\)/, 'the rail lost its way into the settings screen');
  for (const [needle, what] of [
    [/roundPath\(rid, 'tags'\)/, 'Tags'],
    [/roundPath\(rid, 'providers'\)/, 'Provider'],
    [/roundPath\(rid, 'design'\)/, 'Design'],
    [/showMoveGames\(/, 'Spiele verschieben'],
    [/showInvite\(/, 'Einladen'],
  ]) {
    assert.doesNotMatch(rail, needle, `the rail duplicates "${what}", which lives inside the settings screen (#581)`);
  }
  // Anti-vacuous: the archives are NOT part of that group and must survive.
  assert.match(rail, /roundPath\(rid, 'retired'\)/, 'the rail lost its retired archive');
  assert.match(rail, /roundPath\(rid, 'completed'\)/, 'the rail lost its completed archive');
});

/* The two marker states are not interchangeable. On Tags the entry must be
   highlighted AND still clickable — marking it `current` makes railItem drop its
   onNav, which would leave a desktop user on Tags with no rail route back to the
   screen that owns it. */
test('the settings entry stays a live link on the screens it owns', () => {
  assert.match(RAIL, /RAIL_SETTINGS_SUB = \[[^\]]*'settings'[^\]]*'tags'[^\]]*'providers'[^\]]*'design'/, 'the settings entry no longer owns the three screens reached from it');
  assert.match(RAIL, /RAIL_OWN_ENTRY = \[[^\]]*\.\.\.RAIL_SETTINGS_SUB/, 'the own-entry list no longer derives from the settings group — a screen with no row would highlight nothing at all');
  // NOT bodyOfFn here: railItem destructures its argument, so the first `{`
  // after the paren is the parameter pattern and the helper brace-matches that
  // instead of the body — it returns `{ icon, label, … }` and every assertion
  // against it fails for the wrong reason.
  assert.match(RAIL, /inside \? 'true'/, 'railItem lost the inside marker');
  assert.match(RAIL, /navLink\(el, path, current \? null : onNav\)/, 'railItem now inerts the entry on the screens it owns, stranding a desktop user there (#581)');
  // The call site must pass the two states apart, not conflate them.
  assert.match(RAIL, /current: sub === 'settings'/, 'the settings entry is no longer inert on its own screen');
  assert.match(RAIL, /inside: !!sub && sub !== 'settings' && RAIL_SETTINGS_SUB\.includes\(sub\)/, 'the settings entry no longer marks the screens it owns');
});

test('the Start tab points at the settings screen instead of three separate links', () => {
  assert.match(ROUND, /roundPath\(rid, 'settings'\)/, 'the Start tab has no Einstellungen entry');
  // The three it replaced must not linger beside it — that was the crowding the
  // issue set out to remove, and it is what a partial revert would leave behind.
  const actions = ROUND.slice(ROUND.indexOf("h('<div class=\"hub-actions\">"));
  assert.doesNotMatch(actions, /roundPath\(rid, 'tags'\)/, 'the Start tab still links Tags directly');
  assert.doesNotMatch(actions, /roundPath\(rid, 'providers'\)/, 'the Start tab still links Provider directly');
  assert.doesNotMatch(actions, /roundPath\(rid, 'design'\)/, 'the Start tab still links Design directly');
});

/* `views-session.js:854` used to read "like deleting a round" and put the
   session's delete BELOW the terminal back row — the placement this issue
   removed, propagating. Nothing belongs after a back link. */
test('the results screen deletes above the back row, not below it', () => {
  const results = bodyOfFn(SESSION, 'showResults');
  // The APPEND order, not where the string literal happens to sit: `const del =
  // h(...)` is declared well above either append, so comparing the literal's
  // index passes even with the two appends swapped — i.e. against exactly the
  // regression this pins. (Measured: it did.)
  const del = results.indexOf('app.appendChild(del)');
  const back = results.indexOf('app.appendChild(backRow(');
  assert.notEqual(del, -1, 'the results screen lost its delete-session control');
  assert.notEqual(back, -1, 'the results screen lost its back row');
  assert.match(results, /result\.deleteSession/, 'the delete-session control no longer names its own label');
  assert.ok(del < back, 'delete-session is appended below the terminal back row again (#561)');
});

/* A `ti-*` class whose rule is missing renders NOTHING — no tofu, no console
   warning, no failing test (`.claude/rules/tabler-icon-codepoints.md`). The
   codepoint is the one verified against this bundle's own cmap via fontTools;
   0xeb20 is `settings` here, and a wrong-but-present value would render a
   plausible other icon silently. */
test('ti-settings is declared at its cmap-verified codepoint', () => {
  const icons = read('public/fonts/tabler-icons.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(icons, /\.ti-settings::before \{ content: "\\eb20"; \}/, 'ti-settings is missing or moved off 0xeb20');
});

/* The two sheet actions render `.ds-row` as a real <button>, which arrives with
   UA chrome the component does not own. The `font` shorthand would tie with the
   component's own sizing and win on source order
   (`.claude/rules/native-button-vs-focusable-span.md`). */
test('the row button reset never uses the font shorthand', () => {
  const row = bodyOf('.rs-row');
  assert.ok(row, '.rs-row is not declared — the sheet actions render at the UA button size');
  assert.match(row, /font-family:\s*inherit/, '.rs-row does not inherit the app font');
  assert.doesNotMatch(row, /(^|[;\s])font:\s/, '.rs-row uses the `font` shorthand, which beats the component on source order');
  // Icon + label share one line only because .ds-row__main is made flex HERE;
  // the bare component stacks its children on purpose (the Chronik rows).
  assert.ok(bodyOf('.rs-row .ds-row__main'), 'the settings rows lost their one-line icon/label layout');
});
