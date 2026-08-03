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
const { loadApp } = require('./support/dom');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

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

/* ------------- what each screen actually renders (#602) ---------------------

   These four used to slice the three functions out of their files and match
   identifiers in the text. They now RENDER each screen and read the controls,
   which is what the issue was ever about — where an action sits, and who is
   offered it. The navigation wiring below (router, rail, strip) stays
   source-matched: it is about which module knows which path, not about anything
   a rendered screen shows. */

const roundFixture = (over = {}) => ({
  id: 1,
  name: 'Donnerstagsrunde',
  shared: false,
  games: [{ id: 7, title: 'Catan', retired: false, completed: false }],
  members: [],
  sessions: [],
  activity: [],
  tags: [],
  providers: [],
  ...over,
});

/** The Einstellungen screen for an owned (default) or a shared round. */
async function settingsScreen(t, over) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => roundFixture(over));
  dom.set('accountsActive', () => true);
  await dom.call('showRoundSettings', 1);
  return dom;
}

/** Every control label on the screen, flattened for `includes` checks. */
const labels = (root) => [...root.querySelectorAll('button, a')]
  .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
  .filter(Boolean);

test('the round-level actions are gone from the Regal footer, which keeps its archives', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  // The tab renderers append to the global `app` rather than returning a node.
  dom.call('renderRegalTab', roundFixture(), roundFixture().games);
  const found = labels(dom.app);

  assert.ok(!found.includes('Spiele verschieben'), `"Spiele verschieben" is back under the game grid (#561): ${found}`);
  assert.ok(!found.includes('Einladen'), `"Einladen" is back under the game grid (#561): ${found}`);
  // Anti-vacuous: the footer itself must still be there. Without this the two
  // assertions above pass just as happily against a tab that renders nothing.
  assert.ok(found.some((l) => l.startsWith('Aussortiert')), `the Regal footer lost its retired-archive link: ${found}`);
  assert.ok(found.some((l) => l.startsWith('Durchgespielt')), `the Regal footer lost its completed-archive link: ${found}`);
});

test('the Chronik carries no round deletion, and still renders its timeline', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const activities = [{ id: 1, type: 'game_added', at: '2026-08-01T10:00:00Z', gameTitle: 'Catan' }];
  dom.call('renderChronikTab', roundFixture(), activities);

  const found = labels(dom.app);
  assert.ok(!found.includes('Diese Runde löschen'), `deleting the round is back under the history (#561): ${found}`);
  assert.ok(!found.includes('Runde verlassen'), `leaving the round is back under the history (#561): ${found}`);
  assert.ok(dom.app.querySelector('.tl-act'), 'the Chronik lost its timeline');
});

test('the settings screen offers all three actions it took over', async (t) => {
  const dom = await settingsScreen(t);
  const found = labels(dom.app);
  for (const action of ['Spiele verschieben', 'Einladen', 'Diese Runde löschen']) {
    assert.ok(found.includes(action), `the settings screen is missing "${action}": ${found}`);
  }
});

/* The gating is the half that is dangerous to lose: both sheet actions are
   owner-only (#207/#411 — the routes 403/404 a grantee), so offering either on a
   shared round would hand a grantee a button that cannot work. The delete/leave
   split is the same fact seen from the other side. And unlike the regexes this
   replaced, rendering both states proves the branch is actually taken — a gate
   whose condition is present in the source but never reached looks identical. */
test('a grantee is offered none of the owner-only actions, and leaves instead', async (t) => {
  const owner = labels((await settingsScreen(t)).app);
  const grantee = labels((await settingsScreen(t, { shared: true })).app);

  for (const ownerOnly of ['Spiele verschieben', 'Einladen', 'Diese Runde löschen']) {
    assert.ok(!grantee.includes(ownerOnly), `a grantee is offered "${ownerOnly}", which the route 403s: ${grantee}`);
  }
  assert.ok(grantee.includes('Runde verlassen'), `a grantee cannot leave the round: ${grantee}`);
  // The mirror: an owner must never be offered "leave", or the two states have
  // simply merged rather than being kept apart.
  assert.ok(!owner.includes('Runde verlassen'), `an owner is offered "Runde verlassen": ${owner}`);
});

test('a round with an empty shelf offers no move-games action', async (t) => {
  // The other half of the move-games gate (`round.games.length && !round.shared`),
  // which the shared/owner pair above cannot distinguish on its own.
  const found = labels((await settingsScreen(t, { games: [] })).app);
  assert.ok(!found.includes('Spiele verschieben'), `an empty shelf still offers "Spiele verschieben": ${found}`);
  assert.ok(found.includes('Diese Runde löschen'), 'the empty-shelf round lost its delete action, so the assertion above is vacuous');
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
   session's delete BELOW a terminal back row — the placement this issue
   removed, propagating. #623 then moved the back control to the TOP of the
   content, which inverts the order this pins and satisfies #561's own phrasing
   ("nothing belongs after a back link") by construction: the delete is simply
   the last block on the screen now. What still needs pinning is that the two
   have not swapped back, and that neither has been lost in the move. */
test('the results screen opens with the back control and ends with the delete', () => {
  const results = bodyOfFn(SESSION, 'showResults');
  // The APPEND order, not where the string literal happens to sit: `const del =
  // h(...)` is declared well above its append, so comparing the literal's index
  // passes even with the appends swapped — i.e. against exactly the regression
  // this pins. (Measured: it did.)
  const del = results.indexOf('app.appendChild(del)');
  const back = results.indexOf('app.appendChild(backRow(');
  assert.notEqual(del, -1, 'the results screen lost its delete-session control');
  assert.notEqual(back, -1, 'the results screen lost its back control');
  assert.match(results, /result\.deleteSession/, 'the delete-session control no longer names its own label');
  assert.ok(back < del, 'the back control is appended after the delete — it belongs at the top of the content (#623)');
  // Last, not merely after the back control: a block appended below it would
  // put something after the screen's terminal destructive action again.
  assert.equal(results.indexOf('app.appendChild(', del + 1), -1,
    'something is appended after delete-session, which is meant to end the screen');
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
