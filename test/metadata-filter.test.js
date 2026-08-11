'use strict';

/* The „Weitere Filter" disclosure (#725) on the two screens that pick games.

   The predicate itself is unit-tested in `test/draw-pool.test.js`; what cannot
   be seen from there is whether the CONTROLS are wired to it — an option list
   built from BGG's vocabulary instead of the shelf's, a badge that counts
   something the user cannot see, a preset restoring a category whose last game
   was archived. Each of those renders a screen that looks finished and filters
   wrongly, so they are asserted by rendering the real views.

   Anything CSS stays parsed out of styles.css: jsdom applies no external
   stylesheet (.claude/rules/testing-views-under-jsdom.md). */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool } = require('../lib/draw');
const { bodyOf, rulesOf, mediaBlocks, whole } = require('./support/css');
const { loadApp } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);

// A shelf that discriminates on every one of the five controls, and — crucially
// — carries one game with NO metadata at all, so every assertion below also
// states that the absent-field game survives the filter.
const GAMES = [
  { id: 'g1', title: 'Azul', minPlaytime: 30, weight: 2, minAge: 8, categories: ['Abstract Strategy'], mechanics: ['Tile Placement'] },
  { id: 'g2', title: 'Catan', minPlaytime: 60, weight: 3, minAge: 10, categories: ['Economic'], mechanics: ['Trading', 'Dice Rolling'] },
  { id: 'g3', title: 'Gloomhaven', minPlaytime: 120, weight: 4, minAge: 14, categories: ['Adventure'], mechanics: ['Deck Building'] },
  { id: 'g4', title: 'Handgetippt' },
];

let rid = 0;
const roundFixture = (over = {}) => ({
  id: `mf-${++rid}`,
  name: 'Freitagsrunde',
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cleo' }],
  tags: [],
  sessions: [], // renderRegalTab computes gameStats(), which walks them
  games: GAMES.map((g) => ({ ...g })),
  ...over,
});

const disclosure = () => dom.app.querySelector('.mfilter');
const summaryBadge = () => dom.app.querySelector('.mfilter__badge');
const rowLabels = () => [...dom.app.querySelectorAll('.mfilter__label')].map((el) => el.textContent);
const groupLabels = () => [...dom.app.querySelectorAll('.mfilter__group .field__label')].map((el) => el.textContent);
const chipsFor = (label) => {
  const group = [...dom.app.querySelectorAll('.mfilter__group')]
    .find((g) => g.querySelector('.field__label').textContent === label);
  return group ? [...group.querySelectorAll('.chip')] : [];
};
const selectLabelled = (name) =>
  [...dom.app.querySelectorAll('.mfilter__select')]
    .find((s) => s.getAttribute('aria-label') === name
      || (s.id && dom.app.querySelector(`label[for="${s.id}"]`)?.textContent === name));
const previewed = () =>
  [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();

// Drive a <select> the way a user does — jsdom does not fire `change` on an
// assignment, and the whole feature hangs off that listener.
const choose = (sel, value) => {
  sel.value = value;
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

// ------------------------------------------------------------- session setup

test('the disclosure offers exactly the controls this shelf can fill', async () => {
  await dom.call('showStartSession', roundFixture());

  assert.ok(disclosure(), 'the shelf carries metadata, so the disclosure is rendered');
  assert.deepEqual(rowLabels(), ['Spieldauer', 'Komplexität', 'Jüngste Person am Tisch']);
  assert.deepEqual(groupLabels(), ['Kategorien', 'Mechaniken']);
  // Derived from the round's own games, not from BGG's ~84 categories — and
  // sorted, deduped, with the metadata-less game contributing nothing.
  assert.deepEqual(chipsFor('Kategorien').map((c) => c.textContent),
    ['Abstract Strategy', 'Adventure', 'Economic']);
  assert.deepEqual(chipsFor('Mechaniken').map((c) => c.textContent),
    ['Deck Building', 'Dice Rolling', 'Tile Placement', 'Trading']);
});

test('a control is absent — not empty — when no game on the shelf carries its field', async () => {
  await dom.call('showStartSession', roundFixture({
    games: [{ id: 'x', title: 'Nur Dauer', minPlaytime: 45 }],
  }));

  assert.ok(disclosure());
  assert.deepEqual(rowLabels(), ['Spieldauer'], 'no complexity row, no age row');
  assert.deepEqual(groupLabels(), [], 'and no empty chip groups');
});

test('a shelf with no metadata at all renders no disclosure whatsoever', async () => {
  await dom.call('showStartSession', roundFixture({
    games: [{ id: 'x', title: 'Azul' }, { id: 'y', title: 'Uno' }],
  }));

  assert.equal(disclosure(), null, 'a round of hand-typed games sees the screen it always saw');
  // The placeholder must be gone too, or `.setup-grid__aside`'s gap pays for a
  // control that is not there.
  assert.equal(dom.app.querySelector('#metaFilterMount'), null);
});

test('it is collapsed by default and its badge is silent until something filters', async () => {
  await dom.call('showStartSession', roundFixture());

  assert.equal(disclosure().hasAttribute('open'), false,
    'a user who never opens it sees one summary row more than before, and nothing else');
  assert.equal(summaryBadge().hidden, true, 'no "0" badge on an unfiltered screen');
  assert.equal(dom.app.querySelector('.mfilter__summary').getAttribute('aria-label'),
    'Weitere Filter (0 aktiv)');
});

test('setting a filter shrinks the pool preview and shows the count', async () => {
  const round = roundFixture();
  await dom.call('showStartSession', round);

  choose(selectLabelled('Spieldauer'), '30');

  // The absent-field game is still in: that is the rule, stated through the UI.
  assert.deepEqual(previewed(), ['Azul', 'Handgetippt']);
  // …and the preview agrees with what the server would actually draw.
  assert.deepEqual(previewed(), drawPool(round, {
    playerCount: 3,
    metadata: { maxPlaytime: 30, weightMin: null, weightMax: null, youngestAge: null, categories: [], mechanics: [] },
  }).map((g) => g.title).sort());

  assert.equal(summaryBadge().hidden, false);
  assert.equal(summaryBadge().textContent, '1');
  assert.equal(dom.app.querySelector('.mfilter__summary').getAttribute('aria-label'),
    'Weitere Filter (1 aktiv)');
});

test('a category chip toggles, is announced by aria-pressed, and ORs with its siblings', async () => {
  await dom.call('showStartSession', roundFixture());
  const [abstract, adventure] = chipsFor('Kategorien');

  assert.equal(abstract.getAttribute('aria-pressed'), 'false',
    'state is never carried by the fill alone');
  abstract.click();
  assert.equal(abstract.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(previewed(), ['Azul', 'Handgetippt']);

  adventure.click();
  assert.deepEqual(previewed(), ['Azul', 'Gloomhaven', 'Handgetippt'], 'OR, not AND');

  abstract.click();
  assert.equal(abstract.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(previewed(), ['Gloomhaven', 'Handgetippt']);
});

test('the complexity selects carry each other rather than allowing an inverted range', async () => {
  await dom.call('showStartSession', roundFixture());
  const min = selectLabelled('Komplexität mindestens');
  const max = selectLabelled('Komplexität höchstens');

  choose(max, '2');
  choose(min, '4');
  assert.equal(max.value, '4', 'raising the minimum past the maximum carries the maximum up');

  choose(min, '2');
  choose(max, '1');
  assert.equal(min.value, '1', 'and the other way round');
  // One control, one badge unit — however many of its bounds are set.
  assert.equal(summaryBadge().textContent, '1');
});

test('the preset restores the last draw and drops a category the shelf lost', async () => {
  const calls = [];
  dom.set('api', async (method, path, body) => {
    calls.push(body);
    return { session: { id: 's1', gameIds: [] }, games: [], members: [], guests: [], teams: [] };
  });
  dom.set('showSessionLobby', () => {});
  await dom.call('showStartSession', roundFixture({
    lastSessionFilters: {
      tagIds: [], excludeTagIds: [], count: 3,
      metadata: { maxPlaytime: 60, categories: ['Economic', 'Wargame'], mechanics: [] },
    },
  }));

  assert.equal(selectLabelled('Spieldauer').value, '60');
  const on = chipsFor('Kategorien').filter((c) => c.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(on.map((c) => c.textContent), ['Economic']);
  assert.equal(summaryBadge().textContent, '2', 'two controls, both of them visible');

  // The chips alone cannot see the failure: "Wargame" has no chip to press
  // either way, so a state that still holds it looks identical on screen. The
  // draw payload is where it shows — and a stale value there means the next
  // preset is written back carrying it.
  dom.app.querySelector('#go').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].metadata.categories)), ['Economic'],
    '"Wargame" is on no game here any more, so it is dropped rather than riding along');
  dom.set('api', async () => ({}));
});

test('a preset filtering a field the shelf no longer carries is dropped, not counted', async () => {
  // The numeric half of the same rule, and the sharper one: with no game
  // carrying a minimum age there is no age row at all, so a surviving
  // `youngestAge` would show as a badge count over a control that is not on
  // screen — a filter the user can neither see nor clear.
  await dom.call('showStartSession', roundFixture({
    games: [{ id: 'x', title: 'Nur Dauer', minPlaytime: 45 }],
    lastSessionFilters: {
      tagIds: [], excludeTagIds: [], count: 3,
      metadata: { maxPlaytime: 60, youngestAge: 10 },
    },
  }));

  assert.deepEqual(rowLabels(), ['Spieldauer'], 'no age control is rendered');
  assert.equal(summaryBadge().textContent, '1', 'and the age filter is not counted');
});

test('an empty pool offers a reset that clears the metadata filters AND the tags', async () => {
  const round = roundFixture({
    tags: [{ id: 't1', name: 'Kenner' }],
    games: GAMES.map((g) => ({ ...g, tagIds: [] })),
  });
  await dom.call('showStartSession', round);
  assert.equal(dom.app.querySelector('#poolReset button'), null, 'nothing to reset yet');

  // Filter on both controls until nothing is left: the tag no game carries, plus
  // a metadata pick.
  dom.app.querySelector('#filterChips .chip').click();
  chipsFor('Kategorien')[0].click();
  assert.deepEqual(previewed(), []);

  const reset = dom.app.querySelector('#poolReset button');
  assert.ok(reset, 'an empty pool must offer a way back');
  assert.equal(reset.textContent, 'Filter zurücksetzen');
  reset.click();

  assert.deepEqual(previewed(), ['Azul', 'Catan', 'Gloomhaven', 'Handgetippt']);
  assert.equal(summaryBadge().hidden, true, 'the badge follows the reset');
  assert.equal(chipsFor('Kategorien')[0].getAttribute('aria-pressed'), 'false',
    'the chips are repainted in place — the disclosure must not snap shut mid-recovery');
  assert.equal(dom.app.querySelector('#poolReset button'), null);
});

test('the reset button appears only for an EMPTY pool, not for a merely filtered one', async () => {
  await dom.call('showStartSession', roundFixture());
  chipsFor('Kategorien')[0].click();

  assert.deepEqual(previewed(), ['Azul', 'Handgetippt']);
  assert.equal(dom.app.querySelector('#poolReset button'), null);
});

test('the draw sends the metadata filters with the request', async () => {
  const calls = [];
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body });
    return { session: { id: 's1', gameIds: [] }, games: [], members: [], guests: [], teams: [] };
  });
  dom.set('showSessionLobby', () => {});
  await dom.call('showStartSession', roundFixture());
  choose(selectLabelled('Jüngste Person am Tisch'), '10');
  dom.app.querySelector('#go').click();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(calls.length, 1);
  // Round-trip through JSON first: every object and array the view built carries
  // the vm context's prototypes, and `assert/strict` compares those — a spread
  // only rescues the top level (.claude/rules/testing-views-under-jsdom.md).
  const sent = JSON.parse(JSON.stringify(calls[0].body.metadata));
  assert.deepEqual(sent, {
    maxPlaytime: null, weightMin: null, weightMax: null,
    youngestAge: 10, categories: [], mechanics: [],
  }, 'the canonical shape goes out, so the route normalizes exactly what it offered');
  dom.set('api', async () => ({}));
});

// -------------------------------------------------------------------- Regal

/* `renderRegalTab` keeps its filters per round for the session and resets them
   only when the round id changes, so every spec renders its own id. */
const regal = (over) => {
  dom.app.innerHTML = '';
  const r = roundFixture(over);
  dom.call('renderRegalTab', r, r.games);
  return r;
};
const shelved = () =>
  [...dom.app.querySelectorAll('.game-card__title')].map((el) => el.textContent).sort();

test('Regal: the disclosure filters the cover grid with the same semantics', () => {
  regal();

  assert.ok(disclosure(), 'it joins .regal-filter');
  chipsFor('Mechaniken').find((c) => c.textContent === 'Trading').click();
  assert.deepEqual(shelved(), ['Catan', 'Handgetippt'],
    'the absent-field game survives here too');

  choose(selectLabelled('Spieldauer'), '30');
  assert.deepEqual(shelved(), ['Handgetippt'], 'the two controls AND together');
  assert.equal(summaryBadge().textContent, '2');
});

test('Regal: a round with NO tags but metadata still gets a filter panel', () => {
  regal({ tags: [] });

  const wrap = dom.app.querySelector('.regal-filter');
  assert.ok(wrap, 'the wrapper is no longer conditional on the round having tags');
  assert.ok(wrap.querySelector('.mfilter'));
  assert.equal(wrap.querySelector('.filter-toggle'), null, 'and carries no tag half');
});

test('Regal: a round with neither tags nor metadata still gets no panel at all', () => {
  regal({ tags: [], games: [{ id: 'x', title: 'Azul' }] });

  assert.equal(dom.app.querySelector('.regal-filter'), null);
});

test('Regal: the tag half is untouched when the round has tags', () => {
  regal({
    tags: [{ id: 't1', name: 'Kenner' }],
    games: GAMES.map((g) => ({ ...g, tagIds: g.id === 'g3' ? ['t1'] : [] })),
  });

  const wrap = dom.app.querySelector('.regal-filter');
  assert.ok(wrap.querySelector('.filter-toggle'), 'the collapsed-chips toggle still exists');
  wrap.querySelector('#filterChips .chip, .filter-chips .chip').click();
  assert.deepEqual(shelved(), ['Gloomhaven']);
  // The two badges are independent — the tag toggle counts tags, the disclosure
  // counts metadata. One number over both could not say which is filtering.
  assert.equal(wrap.querySelector('.filter-toggle__badge').textContent, '1');
  assert.equal(summaryBadge().hidden, true);
});

test('Regal: switching rounds resets the metadata filters with everything else', () => {
  regal();
  chipsFor('Kategorien')[0].click();
  assert.equal(summaryBadge().textContent, '1');

  regal(); // a fresh round id
  assert.equal(summaryBadge().hidden, true, 'another round\'s categories mean nothing here');
  assert.deepEqual(shelved(), ['Azul', 'Catan', 'Gloomhaven', 'Handgetippt']);
});

// ---------------------------------------------------------------------- CSS

test('the badge honours the hidden attribute (its explicit display would override it)', () => {
  // `.mfilter__badge { display: inline-flex }` beats the UA sheet's
  // `[hidden] { display: none }`, so without the paired rule the unfiltered
  // summary renders a literal "0" — the trap `.filter-chips[hidden]` records.
  const guard = bodyOf('.mfilter__badge[hidden]');
  assert.ok(guard, '.mfilter__badge[hidden] rule not found in styles.css');
  assert.match(guard, /display:\s*none/);
});

test('the disclosure chips do NOT reuse the shared .filter-chips class', () => {
  // The Regal's phone block hides `.regal-filter .filter-chips` behind its own
  // "Filter" button, and this disclosure mounts inside `.regal-filter`. Borrowing
  // the class would collapse these chips behind a control that does not govern
  // them — invisible from jsdom, which applies no stylesheet, so it is asserted
  // over the markup the renderer emits.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'metadata-filter.js'), 'utf8');
  assert.match(src, /class="mfilter__chips"/);
  assert.doesNotMatch(src, /class="filter-chips"/);
  assert.ok(bodyOf('.mfilter__chips'), '.mfilter__chips needs its own layout rule');
});

test('the narrow Regal block never hides the disclosure it now contains', () => {
  // The tag chips collapse below 860px; the metadata disclosure is collapsed by
  // its own summary at every width and must stay reachable there. A rule hiding
  // `.mfilter` inside that block would make it unopenable on every phone.
  const narrow = mediaBlocks()
    .filter(([, css]) => whole('.regal-filter').test(css))
    .find(([q]) => /max-width/.test(q));
  assert.ok(narrow, 'no narrow @media block scopes rules to .regal-filter');
  const offenders = rulesOf(narrow[1])
    .filter(([sel, body]) => whole('.mfilter').test(sel) && /display:\s*none/.test(body));
  assert.deepEqual(offenders, [], 'the phone block must not hide the metadata disclosure');
});
