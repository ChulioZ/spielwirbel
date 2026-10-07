'use strict';

/* The profile's two columns at desktop width, for every design (#1583).
 *
 * Die Brücke, Das Programmheft and Forest drew the Spielerkarte at the left and
 * „Dein Rückblick" + „Aktivitäten" beside it in their own sheets; Klassisch,
 * Der Tisch and Ocean stacked everything full width, so the Rückblick's month
 * picker alone was ~1280px wide at 1440. The composition now lives in
 * styles.css as the base every design inherits.
 *
 * What jsdom cannot see (it applies no stylesheet) is pinned as CSS text; the
 * pixels — two columns at 1100/1280/1440, the picker inside its column, the
 * phone unchanged, the three earlier designs byte-identical — were measured in
 * headless Chrome and are recorded on the PR.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES, mediaBlocks, rulesOf, topLevel } = require('./support/css');
const { loadApp } = require('./support/dom');

const decl = (body, prop) => {
  const m = body && body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

// The base rules, read from the (min-width: 1100px) block that holds them.
const desktop = () => {
  const blocks = mediaBlocks().filter(([q, css]) => /min-width:\s*1100px/.test(q)
    && rulesOf(css).some(([sel]) => sel === '.profile-screen'));
  assert.equal(blocks.length, 1, 'expected exactly one (min-width: 1100px) block laying out .profile-screen');
  const rules = rulesOf(blocks[0][1]);
  return (sel) => {
    const hit = rules.find(([s]) => s === sel);
    return hit ? hit[1] : null;
  };
};

test('from 1100px the profile is two columns: the card left, everything else right', () => {
  const body = desktop();
  const screen = body('.profile-screen');
  assert.equal(decl(screen, 'display'), 'grid');
  const tracks = decl(screen, 'grid-template-columns');
  assert.ok(tracks, 'no grid-template-columns on .profile-screen');
  const parts = tracks.match(/minmax\([^)]*\)/g) || [];
  assert.equal(parts.length, 2, `expected two tracks, got "${tracks}"`);

  assert.equal(decl(body('.profile-screen > *'), 'grid-column'), '2',
    'the Rückblick, the note and Aktivitäten must sit in the right-hand column');
  const card = body('.profile-screen > .profile-card');
  assert.equal(decl(card, 'grid-column'), '1');
  assert.match(decl(card, 'grid-row') || '', /^1\s*\/\s*span\s+\d+$/,
    'the card must span the right column\'s rows, or the feed starts below it');
});

test('the card track is wide enough for the two game tiles side by side', () => {
  /* Measured in Klassisch and Ocean: at a 460px card the „Lieblingsspiel"
     kicker's ink ran 1–3px past its tile; at 520 it clears by 10–27px. */
  const tracks = decl(desktop()('.profile-screen'), 'grid-template-columns');
  const px = Number((tracks.match(/minmax\(0,\s*(\d+)px\)/) || [])[1]);
  assert.ok(px >= 520, `card track ${px}px — the game tiles' kickers spill below 520`);
});

test('the column gap survives a design that declares no spacing scale', () => {
  /* Klassisch and Der Tisch declare no --space-6. A bare var() is invalid at
     computed-value time there, column-gap falls back to normal (0) and the two
     columns touch — measured 0px before the fallback. */
  const gap = decl(desktop()('.profile-screen'), 'column-gap');
  assert.ok(gap, 'no column-gap');
  const bare = [...gap.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]);
  const rootDeclares = (name) => RULES.some(([sel, b]) => sel === ':root' && new RegExp(`${name}\\s*:`).test(b));
  bare.forEach((name) => assert.ok(rootDeclares(name),
    `column-gap reads ${name} with no fallback, and styles.css's :root does not declare it`));
});

test('the phone keeps its single column — nothing outside the desktop block makes it a grid', () => {
  const unconditional = rulesOf(topLevel()).filter(([sel]) => /\.profile-screen(?![\w-])/.test(sel));
  unconditional.forEach(([sel, b]) => assert.notEqual(decl(b, 'display'), 'grid', `${sel} makes the profile a grid at every width`));
  mediaBlocks()
    .filter(([q]) => /max-width/.test(q))
    .forEach(([q, css]) => rulesOf(css)
      .filter(([sel]) => sel === '.profile-screen')
      .forEach(([, b]) => assert.notEqual(decl(b, 'display'), 'grid', `@media ${q} makes the phone profile a grid`)));
});

test('DOM order is visual order: the card is the screen\'s first child', async (t_) => {
  const dom = loadApp();
  t_.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => 'user-me');
  dom.set('isDemoAccount', () => false);
  dom.set('accountApi', async (method, url) => (/^\/profile\//.test(url)
    ? { userId: 'user-me', username: 'ada', avatar: null, createdAt: '2026-01-01T00:00:00.000Z', self: true, friendship: 'none', events: [] }
    : {}));
  await dom.call('showProfile', 'ada');
  const screen = dom.app.querySelector('.profile-screen');
  assert.ok(screen, 'no .profile-screen');
  assert.ok(screen.firstElementChild.classList.contains('profile-card'),
    'the card must lead the DOM, so the left column is also what a screen reader and Tab reach first');
  assert.ok(screen.children.length > 1, 'nothing beside the card — the right column would be empty');
});
