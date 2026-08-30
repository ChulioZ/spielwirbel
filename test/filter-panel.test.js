'use strict';

/* The ONE filter control (#827/#844) on the two screens that pick games — the
   round's tags and the BGG metadata filters behind a single trigger.

   The predicate itself is unit-tested in `test/draw-pool.test.js`; what cannot
   be seen from there is whether the CONTROLS are wired to it — an option list
   built from BGG's vocabulary instead of the shelf's, an applied chip that says
   something the user cannot see, a preset restoring a category whose last game
   was archived. Each of those renders a screen that looks finished and filters
   wrongly, so they are asserted by rendering the real views.

   Since #844 the body opens as an OVERLAY (`openEditor`), so a spec that wants a
   control has to open the panel first — `openPanel()` below. That is not
   ceremony: it is the property the whole issue turns on, since a body outside the
   page's flow is what stops the trigger being pushed around by its own opening.

   The panel's own CSS contract — that the pre-#827 phone-only collapse is gone,
   and that nothing re-widens the setup row for an open panel — is in
   `test/regal-filter.test.js`. Anything CSS stays parsed out of styles.css:
   jsdom applies no external stylesheet
   (.claude/rules/testing-views-under-jsdom.md). */

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { drawPool } = require('../lib/draw');
const { bodyOf, bodyOfIn } = require('./support/css');
const { loadApp } = require('./support/dom');
const { filterPanelKit } = require('./support/filter-panel');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
// The shared opening kit — including the matchMedia stub without which every
// trigger click throws silently. See test/support/filter-panel.js.
const { trigger, panelBody, openPanel, closePanel, appliedChips, triggerLabel } = filterPanelKit(dom);

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

// Everything below the trigger lives in the overlay, i.e. under `document.body`
// rather than under `#app`, so every query goes through `dom.document`.
const rowLabels = () => [...dom.document.querySelectorAll('.mfilter__label')].map((el) => el.textContent);
const groupLabels = () => [...dom.document.querySelectorAll('.mfilter__group .field__label')].map((el) => el.textContent);
const chipsFor = (label) => {
  const group = [...dom.document.querySelectorAll('.mfilter__group')]
    .find((g) => g.querySelector('.field__label').textContent === label);
  return group ? [...group.querySelectorAll('.chip')] : [];
};
const selectLabelled = (name) =>
  [...dom.document.querySelectorAll('.mfilter__select')]
    .find((s) => s.getAttribute('aria-label') === name
      || (s.id && dom.document.querySelector(`label[for="${s.id}"]`)?.textContent === name));
/* An overlay lives under `document.body`, so re-rendering `#app` does NOT remove
   a previous spec's open panel — and `panelBody()` would then find a stale one,
   which reads as "the panel is already open" in a spec that never opened it. */
beforeEach(() => closePanel());

const previewed = () =>
  [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();

// Drive a <select> the way a user does — jsdom does not fire `change` on an
// assignment, and the whole feature hangs off that listener.
const choose = (sel, value) => {
  sel.value = value;
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

// ------------------------------------------------------------- session setup

test('the panel offers exactly the controls this shelf can fill', async () => {
  await dom.call('showStartSession', roundFixture());

  assert.ok(trigger(), 'the shelf carries metadata, so the control is rendered');
  openPanel();
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

  openPanel();
  assert.deepEqual(rowLabels(), ['Spieldauer'], 'no complexity row, no age row');
  assert.deepEqual(groupLabels(), [], 'and no empty chip groups');
});

test('a shelf with no metadata at all renders no control whatsoever', async () => {
  await dom.call('showStartSession', roundFixture({
    games: [{ id: 'x', title: 'Azul' }, { id: 'y', title: 'Uno' }],
  }));

  assert.equal(trigger(), null, 'a round of hand-typed games sees the screen it always saw');
  // The mount STAYS since #736 — it is the anchor the backfill's repaint mounts
  // into — but it must be `hidden`, or `.setup-grid__aside`'s gap pays for a
  // control that is not there. A `display: none` element is not a flex item at
  // all, so hidden costs exactly what removal did.
  const mount = dom.app.querySelector('#filterMount');
  assert.ok(mount, 'the repaint anchor must survive, or a filled shelf has nowhere to mount');
  assert.equal(mount.hidden, true, 'an empty mount still costs a row of flex gap');
});

test('it is closed by default and shows no applied chips until something filters', async () => {
  await dom.call('showStartSession', roundFixture());

  assert.equal(panelBody(), null,
    'a user who never opens it sees one button more than before, and nothing else');
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');
  assert.deepEqual(appliedChips(), [], 'nothing is filtering yet');
  assert.equal(dom.document.querySelector('.fbar__chips').hidden, true,
    'an empty chip row must not claim the bar\'s gap');
  assert.equal(triggerLabel(), 'Filter (0 aktiv)');
});

test('setting a filter shrinks the pool preview and names itself as a chip', async () => {
  const round = roundFixture();
  await dom.call('showStartSession', round);

  openPanel();
  choose(selectLabelled('Spieldauer'), '30');

  // The absent-field game is still in: that is the rule, stated through the UI.
  assert.deepEqual(previewed(), ['Azul', 'Handgetippt']);
  // …and the preview agrees with what the server would actually draw.
  assert.deepEqual(previewed(), drawPool(round, {
    playerCount: 3,
    metadata: { maxPlaytime: 30, weightMin: null, weightMax: null, youngestAge: null, categories: [], mechanics: [] },
  }).map((g) => g.title).sort());

  // The chip says WHICH filter is on, which is the whole reason it replaced the
  // count badge: a number could only ever say how many.
  assert.deepEqual(appliedChips(), ['Höchstens 30 Min.']);
  assert.equal(dom.document.querySelector('.fbar__chips').hidden, false);
  assert.equal(triggerLabel(), 'Filter (1 aktiv)');
});

test('a category chip toggles, is announced by aria-pressed, and ORs with its siblings', async () => {
  await dom.call('showStartSession', roundFixture());
  openPanel();
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
  openPanel();
  const min = selectLabelled('Komplexität mindestens');
  const max = selectLabelled('Komplexität höchstens');

  choose(max, '2');
  choose(min, '4');
  assert.equal(max.value, '4', 'raising the minimum past the maximum carries the maximum up');

  choose(min, '2');
  choose(max, '1');
  assert.equal(min.value, '1', 'and the other way round');
  // One control, ONE chip — however many of its bounds are set. The two bounds
  // are one question, so a × that cleared half of it would leave a range that
  // admits nothing with nothing on screen saying so.
  assert.deepEqual(appliedChips(), ['Komplexität 1–1']);
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

  assert.deepEqual(appliedChips(), ['Höchstens 60 Min.', 'Economic'],
    'the surviving preset is named; "Wargame" is on no game here, so it has no chip');
  openPanel();
  assert.equal(selectLabelled('Spieldauer').value, '60');
  const on = chipsFor('Kategorien').filter((c) => c.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(on.map((c) => c.textContent), ['Economic']);
  closePanel();

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
  // `youngestAge` would show as an applied chip over a control that is not on
  // screen — a filter the user could clear from the chip but never see the
  // reason for.
  await dom.call('showStartSession', roundFixture({
    games: [{ id: 'x', title: 'Nur Dauer', minPlaytime: 45 }],
    lastSessionFilters: {
      tagIds: [], excludeTagIds: [], count: 3,
      metadata: { maxPlaytime: 60, youngestAge: 10 },
    },
  }));

  assert.deepEqual(appliedChips(), ['Höchstens 60 Min.'], 'the age filter is not carried');
  openPanel();
  assert.deepEqual(rowLabels(), ['Spieldauer'], 'no age control is rendered');
  closePanel();
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
  openPanel();
  dom.document.querySelector('#filterChips .chip').click();
  chipsFor('Kategorien')[0].click();
  assert.deepEqual(previewed(), []);

  // CLOSE it first. The escape hatch lives outside the panel and is reached from
  // an empty pool, which is a state a user arrives at with the panel shut — so
  // `reset` may not depend on a single control existing (#844).
  closePanel();
  assert.equal(panelBody(), null);
  assert.deepEqual(appliedChips(), ['Kenner', 'Abstract Strategy']);

  const reset = dom.app.querySelector('#poolReset button');
  assert.ok(reset, 'an empty pool must offer a way back');
  assert.equal(reset.textContent, 'Filter zurücksetzen');
  reset.click();

  assert.deepEqual(previewed(), ['Azul', 'Catan', 'Gloomhaven', 'Handgetippt']);
  assert.deepEqual(appliedChips(), [], 'the applied chips follow the reset');
  assert.equal(dom.app.querySelector('#poolReset button'), null);

  // And the controls inside catch up when it is next opened, rather than the
  // reset having cleared only the state behind them.
  openPanel();
  assert.equal(chipsFor('Kategorien')[0].getAttribute('aria-pressed'), 'false');
  assert.equal(dom.document.querySelector('#filterChips .chip').getAttribute('aria-pressed'), null);
  closePanel();
});

test('the reset button appears only for an EMPTY pool, not for a merely filtered one', async () => {
  await dom.call('showStartSession', roundFixture());
  openPanel();
  chipsFor('Kategorien')[0].click();
  closePanel();

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
  openPanel();
  choose(selectLabelled('Jüngste Person am Tisch'), '10');
  closePanel();
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
  // An overlay lives under `document.body`, so blanking `#app` would leave a
  // previous spec's panel — and the tag section node inside it — on screen.
  closePanel();
  dom.app.innerHTML = '';
  const r = roundFixture(over);
  dom.call('renderRegalTab', r, r.games);
  return r;
};
const shelved = () =>
  [...dom.app.querySelectorAll('.game-card__title')].map((el) => el.textContent).sort();

test('Regal: the panel filters the cover grid with the same semantics', () => {
  regal();

  assert.ok(trigger(), 'it joins .regal-filter');
  openPanel();
  chipsFor('Mechaniken').find((c) => c.textContent === 'Trading').click();
  assert.deepEqual(shelved(), ['Catan', 'Handgetippt'],
    'the absent-field game survives here too');

  choose(selectLabelled('Spieldauer'), '30');
  assert.deepEqual(shelved(), ['Handgetippt'], 'the two controls AND together');
  assert.deepEqual(appliedChips(), ['Höchstens 30 Min.', 'Trading']);
  closePanel();
});

test('Regal: a round with NO tags but metadata still gets a filter panel', () => {
  regal({ tags: [] });

  const wrap = dom.app.querySelector('.regal-filter');
  assert.ok(wrap, 'the wrapper is no longer conditional on the round having tags');
  const body = openPanel();
  assert.ok(body.querySelector('.mfilter'));
  // `.fpanel__group`, not `.filter-toggle`: since #827 that class exists nowhere,
  // so asserting its absence would pass against a panel full of tag chips.
  assert.equal(body.querySelector('.fpanel__group'), null, 'and carries no tag half');
  closePanel();
});

test('Regal: a round with neither tags nor metadata still gets no panel at all', () => {
  regal({ tags: [], games: [{ id: 'x', title: 'Azul' }] });

  // Present since #736 (the backfill's repaint needs somewhere to mount) and
  // `hidden`, which is what makes it cost nothing: `.regal-filter` declares only
  // a margin, so nothing overrides the UA's `[hidden]`.
  const wrap = dom.app.querySelector('.regal-filter');
  assert.ok(wrap, 'the repaint anchor must survive a shelf that offers nothing yet');
  assert.equal(wrap.hidden, true);
  assert.equal(wrap.textContent.trim(), '', 'a hidden wrapper must also be empty');
});

test('Regal: both halves live in ONE panel, as two labelled sections (#827)', () => {
  regal({
    tags: [{ id: 't1', name: 'Kenner' }],
    games: GAMES.map((g) => ({ ...g, tagIds: g.id === 'g3' ? ['t1'] : [] })),
  });

  const wrap = dom.app.querySelector('.regal-filter');
  assert.equal(wrap.querySelectorAll('.fbar__trigger').length, 1,
    'one control, not a chip row beside a drawer');
  const body = openPanel();
  // Tags first, metadata second, both direct children of the one body: the
  // sections stay separate because a round's own word and a BGG fact combine
  // differently (.claude/rules/provider-metadata-is-a-filter-not-a-tag.md).
  const sections = [...body.querySelectorAll('.fpanel__body > *')].map((el) => el.className);
  assert.deepEqual(sections, ['fpanel__group', 'mfilter']);
  assert.equal(dom.document.querySelector('.filter-toggle'), null,
    'the phone-only tag toggle is gone — the panel is the only collapse now');

  body.querySelector('.fpanel__group .filter-chips .chip').click();
  assert.deepEqual(shelved(), ['Gloomhaven'], 'the tag half still filters the grid');
  closePanel();
});

test('Regal: ONE chip row covers both halves together (#827/#844)', () => {
  // The two counts were deliberately separate while they were two controls that
  // collapsed on different triggers — one number could not say which was
  // filtering. With a single control and a single trigger that question is gone,
  // and a user who set one of each expects to see both named.
  regal({
    tags: [{ id: 't1', name: 'Kenner' }],
    games: GAMES.map((g) => ({ ...g, tagIds: g.id === 'g3' ? ['t1'] : [] })),
  });
  assert.deepEqual(appliedChips(), [], 'nothing filtering yet');
  const body = openPanel();

  body.querySelector('.fpanel__group .filter-chips .chip').click();
  assert.deepEqual(appliedChips(), ['Kenner'], 'the tag half reaches the shared chip row');

  choose(selectLabelled('Spieldauer'), '30');
  assert.deepEqual(appliedChips(), ['Kenner', 'Höchstens 30 Min.'],
    'and the metadata half joins it — tags first, the panel\'s own section order');
  assert.equal(triggerLabel(), 'Filter (2 aktiv)',
    'the count is announced on the trigger, not left to the chips\' colour alone');
  closePanel();
});

test('Regal: switching rounds resets the metadata filters with everything else', () => {
  regal();
  openPanel();
  chipsFor('Kategorien')[0].click();
  assert.deepEqual(appliedChips(), ['Abstract Strategy']);

  regal(); // a fresh round id
  assert.deepEqual(appliedChips(), [], 'another round\'s categories mean nothing here');
  assert.deepEqual(shelved(), ['Azul', 'Catan', 'Gloomhaven', 'Handgetippt']);
});

/* ------------- The overlay presentation, and the jump it removes (#844) ----- */

test('opening the panel puts NOTHING in the row the trigger sits in (#844)', async () => {
  /* The bug, at the only layer jsdom can see it — and the layer that actually
     fixes it. #827's body was a sibling of the count stepper inside
     `.setup-filterbar`, a `flex-wrap: wrap` row, so opening it gave the mount a
     full-row flex-basis and pushed the trigger onto the next line with the pool
     preview behind it.

     A CSS assertion (test/regal-filter.test.js) can only say that today's
     stylesheet grants no such basis. This says the stronger thing: there is
     nothing in that row for ANY rule to widen, because the body is not in the
     page's flow at all. That is what makes the trigger's staying put a property
     of the structure rather than of a rule someone has to keep not writing. */
  await dom.call('showStartSession', roundFixture());
  const bar = dom.app.querySelector('.setup-filterbar');
  const shape = () => [...bar.querySelectorAll('*')].map((el) => el.className || el.tagName);
  const before = shape();

  const body = openPanel();
  assert.ok(body, 'the panel did not open');
  // Compared as STRUCTURE, not innerHTML: the trigger legitimately flips
  // `aria-expanded`, and an innerHTML diff would report that as a layout change.
  assert.deepEqual(shape(), before, 'opening the panel added a node to the trigger\'s row');
  assert.equal(bar.contains(body), false, 'the panel body is back inside the filter row');
  assert.equal(dom.app.contains(body), false,
    'the body is still inside #app, so page layout can push the trigger around');
  assert.ok(dom.document.body.contains(body), 'the overlay must be attached to the document');

  // The pool preview is the thing the filters shape, so it must not move either.
  assert.ok(dom.app.querySelector('.setup-panel'), 'the pool panel is still on screen');
  assert.equal(dom.app.querySelector('.setup-grid__aside').contains(body), false);
});

test('nothing between the trigger and its bar is a flex item of that bar (#854)', async () => {
  /* #844 stopped the trigger moving when the panel OPENS; this is the other way
     it moved — with the panel shut, as a function of how many filters were on.
     `.fbar` held the trigger and the chip row together, so `.setup-filterbar`
     saw one item, and a long chip label inflated it until the whole thing
     wrapped and took the „Filter" button along.

     jsdom applies no stylesheet, so it cannot watch anything wrap. What it CAN
     see is the half the fix actually turns on: which elements the render puts
     between the bar and the two controls, i.e. which elements the bar would
     treat as items. Each one has to be dissolved by a rule in the real
     stylesheet — so this fails on a wrapper added in the markup just as it does
     on a `display: contents` dropped from the CSS, which a text-only assertion
     over styles.css cannot do. */
  await dom.call('showStartSession', roundFixture());
  const bar = dom.app.querySelector('.setup-filterbar');
  const trig = bar.querySelector('.fbar__trigger');
  const chips = bar.querySelector('.fbar__chips');
  assert.ok(trig && chips, 'the setup bar rendered no filter control to check');

  // The chip row must FOLLOW the trigger, or it would claim the line above it.
  assert.equal(trig.compareDocumentPosition(chips) & 4, 4,
    'the chip row renders before the trigger — its full-width line would sit above it');

  const between = (el) => {
    const out = [];
    for (let p = el.parentElement; p && p !== bar; p = p.parentElement) out.push(p);
    return out;
  };
  const wrappers = [...new Set([...between(trig), ...between(chips)])];
  assert.ok(wrappers.length, 'no wrapper at all here — check the fixture actually rendered the bar');
  for (const w of wrappers) {
    const dissolved = [...w.classList]
      .some((c) => /display:\s*contents/.test(bodyOf(`.${c}`) || bodyOfIn(`.${c}`) || ''));
    assert.ok(dissolved,
      `<${w.tagName.toLowerCase()} class="${w.className}"> is a flex item of .setup-filterbar: `
      + 'it wraps together with the chips inside it, carrying the trigger onto another row (#854)');
  }
});

test('the presentation is a sheet below 860px and an anchored popover above it', async () => {
  /* Routed through `openEditor`, so it inherits the #422 split: an anchored
     popover cannot hold a focusable control on a phone, because focusing one
     scrolls the page and openPopover's own scroll teardown removes it mid-open
     (.claude/rules/popover-vs-sheet-editors.md). This panel holds five. */
  await dom.call('showStartSession', roundFixture());

  closePanel();
  dom.run('window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });');
  trigger().click();
  assert.ok(dom.document.querySelector('.popover--filter'), 'no popover above the breakpoint');
  assert.equal(dom.document.querySelector('.sheet-backdrop'), null);

  closePanel();
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  trigger().click();
  const sheet = dom.document.querySelector('.sheet-backdrop .sheet--dialog');
  assert.ok(sheet, 'no sheet below the breakpoint');
  assert.equal(sheet.getAttribute('aria-label'), 'Filter', 'the sheet is a labelled dialog');
  assert.ok(dom.document.querySelector('.editor--filter'),
    'the sheet carries no .editor--filter — its layout rules would not apply');
  assert.equal(dom.document.querySelector('.popover'), null);
});

test('the trigger announces its expanded state, and every exit resets it', async () => {
  /* The <details> gave this for free; an overlay has to earn it back. And it has
     to come from a hook on the overlay's own teardown, not from wrapping the
     `close` the builder is handed — Escape, Back, a backdrop tap and (for a
     popover) a page scroll all bypass that one. */
  await dom.call('showStartSession', roundFixture());
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');

  trigger().click();
  assert.equal(trigger().getAttribute('aria-expanded'), 'true');

  // Escape, i.e. an exit the builder's own `close` never sees.
  dom.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panelBody(), null, 'Escape did not dismiss the panel');
  assert.equal(trigger().getAttribute('aria-expanded'), 'false',
    'the trigger still claims to be expanded over a panel that is gone');

  // A second click on the trigger closes it: openPopover exempts its own anchor
  // from the outside-click guard, so without the toggle the click reads as dead.
  trigger().click();
  assert.ok(panelBody());
  trigger().click();
  assert.equal(panelBody(), null, 'a second click on the trigger did not close it');
});

test('closing the panel hands focus back to the trigger', async () => {
  await dom.call('showStartSession', roundFixture());
  const t = trigger();
  t.focus();
  assert.equal(dom.document.activeElement, t);

  t.click();
  assert.ok(panelBody().contains(dom.document.activeElement),
    'focus never entered the overlay — the sheet is aria-modal, so a keyboard user is left outside it');
  dom.run('closeSheet();');
  assert.equal(dom.document.activeElement, t,
    'a keyboard user who closes the panel is dropped to <body> and restarts from the top');
});

test('an applied chip removes exactly its own filter, with the panel CLOSED', async () => {
  /* The chips are the half the count badge could never do. They also have to work
     from outside the panel — that is where they live — so removal may not depend
     on the control that set the filter still existing. */
  const round = roundFixture();
  await dom.call('showStartSession', round);
  openPanel();
  chipsFor('Kategorien').find((c) => c.textContent === 'Economic').click();
  chipsFor('Kategorien').find((c) => c.textContent === 'Adventure').click();
  choose(selectLabelled('Spieldauer'), '120');
  closePanel();

  assert.deepEqual(appliedChips(), ['Höchstens 120 Min.', 'Economic', 'Adventure']);
  assert.deepEqual(previewed(), ['Catan', 'Gloomhaven', 'Handgetippt']);

  // Drop ONE category. Not the whole list, and not the neighbouring playtime
  // filter — the granularity is per value, which is the only granularity a × can
  // mean on a chip that names one.
  const dismiss = (label) => [...dom.document.querySelectorAll('.fbar__chips .fchip')]
    .find((c) => c.querySelector('.fchip__label').textContent === label)
    .querySelector('.fchip__x');
  assert.equal(dismiss('Economic').getAttribute('aria-label'), 'Economic entfernen');
  dismiss('Economic').click();

  assert.deepEqual(appliedChips(), ['Höchstens 120 Min.', 'Adventure']);
  assert.deepEqual(previewed(), ['Gloomhaven', 'Handgetippt'], 'the pool did not follow the chip');
  assert.deepEqual(previewed(), drawPool(round, {
    playerCount: 3,
    metadata: { maxPlaytime: 120, weightMin: null, weightMax: null, youngestAge: null, categories: ['Adventure'], mechanics: [] },
  }).map((g) => g.title).sort(), 'and the draw agrees with the preview');

  // The control inside catches up too, rather than the chip having cleared only
  // the state behind it.
  openPanel();
  const on = chipsFor('Kategorien').filter((c) => c.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(on.map((c) => c.textContent), ['Adventure']);
});

test('an EXCLUDED tag says so in words, not by a colour its chip cannot carry', async () => {
  /* Include and exclude are opposite filters. Inside the panel the tri-state chip
     distinguishes them with a ban glyph and an aria-label; an applied chip has
     neither, so the word does the work. */
  await dom.call('showStartSession', roundFixture({
    tags: [{ id: 't1', name: 'Solo' }],
    games: GAMES.map((g) => ({ ...g, tagIds: g.id === 'g1' ? ['t1'] : [] })),
  }));
  openPanel();
  const tagChip = dom.document.querySelector('#filterChips .chip');

  tagChip.click(); // ignore -> include
  assert.deepEqual(appliedChips(), ['Solo']);
  assert.deepEqual(previewed(), ['Azul']);

  tagChip.click(); // include -> exclude
  assert.deepEqual(appliedChips(), ['ohne Solo']);
  assert.deepEqual(previewed(), ['Catan', 'Gloomhaven', 'Handgetippt']);

  tagChip.click(); // exclude -> ignore
  assert.deepEqual(appliedChips(), [], 'the third click clears it, so no chip is left');
});

test('removing a tag chip repaints the tri-state chip it came from', async () => {
  await dom.call('showStartSession', roundFixture({
    tags: [{ id: 't1', name: 'Solo' }],
    games: GAMES.map((g) => ({ ...g, tagIds: g.id === 'g1' ? ['t1'] : [] })),
  }));
  openPanel();
  dom.document.querySelector('#filterChips .chip').click();
  assert.deepEqual(appliedChips(), ['Solo']);

  dom.document.querySelector('.fbar__chips .fchip__x').click();

  assert.deepEqual(appliedChips(), []);
  assert.deepEqual(previewed(), ['Azul', 'Catan', 'Gloomhaven', 'Handgetippt']);
  // The tri-state chip is a live node inside the open panel, so a removal that
  // only touched the map would leave it painted as included over a filter that
  // is off — and the next click would cycle it to `exclude`, not to `include`.
  assert.equal(dom.document.querySelector('#filterChips .chip').classList.contains('is-on'), false,
    'the tag chip inside the panel still reads as included');
});

// ---------------------------------------------------------------------- CSS

test('the metadata chips do NOT reuse the shared .filter-chips class', () => {
  // They are different controls: `.filter-chips` carries the tags' tri-state
  // cycle, these are plain multi-select (with OR semantics a third click would
  // have nothing to mean). Sharing the class would invite sharing the behaviour.
  // Invisible from jsdom, which applies no stylesheet, so it is asserted over
  // the markup the renderer emits — and the tag section, which DOES use the
  // shared class, is built by the screens rather than by this file.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'filter-panel.js'), 'utf8');
  assert.match(src, /class="mfilter__chips"/);
  assert.doesNotMatch(src, /class="filter-chips"/);
  assert.ok(bodyOf('.mfilter__chips'), '.mfilter__chips needs its own layout rule');
});

/* ---------------- The shelf-wide backfill's repaint (#736) ----------------- */

/* Until #736 neither screen was a backfill trigger, so a shelf whose games had
   never had their detail page opened offered NO complexity control at all and
   filtered nothing. These specs drive the fold-in: the answer lands after the
   screen has rendered, and the controls plus the pool have to catch up in place
   — without discarding what the user has already done. */

// A shelf whose games are BGG-linked but carry no metadata, which is what makes
// `wantsGameInfo` true and the trigger fire at all. Two games so a filter can
// discriminate once the answer lands.
const UNFILLED = [
  { id: 'u1', title: 'Agricola', source: { provider: 'bgg', externalId: '100' } },
  { id: 'u2', title: 'Leicht', source: { provider: 'bgg', externalId: '101' } },
];

// Resolve the POST by hand so a spec controls exactly when the answer arrives.
const deferredApi = () => {
  const calls = [];
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  dom.set('api', async (method, path) => {
    calls.push(`${method} ${path}`);
    if (method === 'POST' && /provider-info$/.test(path)) return pending;
    return {};
  });
  // Await a macrotask after releasing, so the view's `.then` has run.
  return { calls, deliver: async (games) => { release({ games }); await new Promise((r) => setTimeout(r, 0)); } };
};

const FILLED = [
  { id: 'u1', weight: 3.6, minPlaytime: 90, maxPlaytime: 210, minAge: 12, categories: ['Economic'], mechanics: [] },
  { id: 'u2', weight: 1.0, minPlaytime: 20, maxPlaytime: 30, minAge: 8, categories: ['Family'], mechanics: [] },
];

test('setup: controls the shelf could not offer appear once the backfill lands', async () => {
  const { calls, deliver } = deferredApi();
  await dom.call('showStartSession', roundFixture({ games: UNFILLED.map((g) => ({ ...g })) }));

  // Before: nothing to derive a control from, so there is no trigger at all —
  // which is exactly the reported symptom ("no complexity filter on my shelf").
  assert.equal(trigger(), null);
  assert.ok(calls.includes('POST /api/rounds/mf-1/games/provider-info'.replace('mf-1', calls[0].split('/')[3])),
    'the setup screen must trigger the shelf-wide fill');

  await deliver(FILLED);

  assert.ok(trigger(), 'the control never appeared after the metadata arrived');
  assert.equal(dom.app.querySelector('#filterMount').hidden, false);
  openPanel();
  assert.deepEqual(rowLabels(), ['Spieldauer', 'Komplexität', 'Jüngste Person am Tisch']);
  assert.deepEqual(chipsFor('Kategorien').map((c) => c.textContent), ['Economic', 'Family']);
  closePanel();
});

test('setup: the fold-in keeps the seats, guests and filter picks the user set', async () => {
  /* The reason this is a fold-in and not a re-render: `showStartSession(round)`
     would rebuild the screen and throw away everything below. */
  const { deliver } = deferredApi();
  const round = roundFixture({
    games: [...UNFILLED.map((g) => ({ ...g })), { id: 'u3', title: 'Schon da', minPlaytime: 45 }],
  });
  await dom.call('showStartSession', round);

  // The shelf already offers a playtime control (u3 carries one), so the user
  // can filter before the answer lands — with the panel OPEN, which is the state
  // the rebuild has to respect.
  openPanel();
  choose(selectLabelled('Spieldauer'), '60');
  dom.app.querySelector('.nr-seat').click(); // Anna sits out
  const outBefore = dom.app.querySelectorAll('.nr-seat--out').length;
  assert.equal(outBefore, 1, 'the fixture never took anyone out of the session');

  await deliver(FILLED);

  assert.ok(panelBody(), 'the fold-in tore the open panel down under the user');
  assert.equal(selectLabelled('Spieldauer').value, '60', 'the fold-in discarded the user\'s pick');
  assert.equal(dom.app.querySelectorAll('.nr-seat--out').length, outBefore,
    'the fold-in reset the seat selection');
  // The OPEN panel is left exactly as it is — deliberately. Repainting it would
  // swap controls under a hand mid-adjustment, and rebuilding the bar would
  // replace the very node the popover is anchored to.
  assert.deepEqual(rowLabels(), ['Spieldauer'],
    'the open panel grew a control under the user instead of waiting');

  /* The assertion that actually discriminates, and the one the guard is FOR.
     Without it `mountFilterPanel` builds a second panel and swaps the trigger
     out — while the open overlay's controls keep calling the OLD panel's
     `sync()`, which writes to a chip row that is no longer in the document. So
     the panel stays up and keeps filtering while the applied chips silently
     stop following it. Verified by deleting the guard: this is the only line
     that goes red (.claude/rules/break-the-code-on-purpose.md). */
  choose(selectLabelled('Spieldauer'), '30');
  assert.deepEqual(appliedChips(), ['Höchstens 30 Min.'],
    'the visible chip row stopped following the open panel — its trigger was swapped out under it');

  // Nothing is lost by waiting: the body is rebuilt from the live `activeGames`
  // on every open, and `foldGameInfoList` filled those objects IN PLACE.
  closePanel();
  openPanel();
  assert.deepEqual(rowLabels(), ['Spieldauer', 'Komplexität', 'Jüngste Person am Tisch'],
    'the metadata that arrived while it was open is there the next time it opens');
  assert.equal(selectLabelled('Spieldauer').value, '30',
    'and the pick made WHILE the backfill landed survives the reopen');
  closePanel();
});

test('setup: the pool preview re-filters against the values that just arrived', async () => {
  const { deliver } = deferredApi();
  await dom.call('showStartSession', roundFixture({ games: UNFILLED.map((g) => ({ ...g })) }));
  await deliver(FILLED);

  assert.deepEqual(previewed(), ['Agricola', 'Leicht'], 'unfiltered, both are in the pool');
  openPanel();
  choose(selectLabelled('Komplexität höchstens'), '1');
  assert.deepEqual(previewed(), ['Leicht'], 'the preview still promises a game the draw would not pick');
  closePanel();
});

test('a filled shelf issues no request at all', async () => {
  /* The `wantsGameInfo` gate. Without it every open of either screen would POST,
     and the server would answer an empty list after a round trip nobody needed. */
  const { calls } = deferredApi();
  await dom.call('showStartSession', roundFixture());

  assert.deepEqual(calls.filter((c) => /provider-info/.test(c)), []);
});

test('Regal: the control appears and the grid re-filters after the fold-in', async () => {
  const { deliver } = deferredApi();
  closePanel();
  dom.app.innerHTML = '';
  const r = roundFixture({ tags: [], games: UNFILLED.map((g) => ({ ...g })) });
  dom.call('renderRegalTab', r, r.games);

  assert.equal(trigger(), null);
  assert.equal(dom.app.querySelector('.regal-filter').hidden, true);

  await deliver(FILLED);

  assert.ok(trigger(), 'the Regal never grew the filter control');
  assert.equal(dom.app.querySelector('.regal-filter').hidden, false);
  openPanel();
  chipsFor('Kategorien').find((c) => c.textContent === 'Family').click();
  assert.deepEqual(shelved(), ['Leicht'], 'the grid ignored the metadata that just arrived');
  closePanel();
});

test('a failed backfill leaves the screen exactly as it was', async () => {
  dom.set('api', async (method, path) => {
    if (method === 'POST' && /provider-info$/.test(path)) throw new Error('offline');
    return {};
  });
  await dom.call('showStartSession', roundFixture({ games: UNFILLED.map((g) => ({ ...g })) }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(trigger(), null, 'a rejected trigger must not throw or blank anything');
  assert.deepEqual(previewed(), ['Agricola', 'Leicht'], 'the pool still lists the shelf');
});
