'use strict';

/* The bulk toggle above the tri-state tag chips (#723), on both screens that
   carry the filter: the session setup screen and the Regal.
 *
 * The rule under test is deliberately NOT `showTransferGames`'s select-all/none.
 * There the question is "is everything on?"; here it is "is there any filter to
 * clear?", so a MIXED state (2 included, 1 excluded) must offer „Alle abwählen"
 * and clear in ONE click. That difference is the whole point of the issue — the
 * reported pain is walking a preset row chip by chip — and it is invisible to a
 * test that only exercises the all-neutral and all-included states. Every spec
 * below that touches a mixed map is guarding exactly that.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): the label flip, the chip
 * repaint and the downstream refresh are three separate wirings, and a regex
 * can see none of them. */

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { filterPanelKit } = require('./support/filter-panel');

const TAGS = [
  { id: 't1', name: 'Area Control', icon: 'map' },
  { id: 't2', name: 'Deck Builder', icon: 'cards' },
  { id: 't3', name: 'Party', icon: 'confetti' },
];

const roundFixture = (over) => ({
  id: 'r1',
  name: 'Freitagsrunde',
  tags: TAGS,
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
  ],
  games: [
    // Azul carries BOTH filterable tags, so it survives „Alle wählen"'s AND —
    // without it every all-included assertion would read 0 games for two
    // different reasons and could not tell them apart.
    { id: 'g1', title: 'Azul', tagIds: ['t1', 't2'] },
    { id: 'g2', title: 'Catan', tagIds: ['t1'] },
    { id: 'g3', title: 'Uno', tagIds: [] },
  ],
  sessions: [],
  ...over,
});

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
/* Since #844 both screens open the filter panel as an OVERLAY, so the tag
   section these specs drive lives under `document.body` rather than under `#app`
   and has to be opened first. `beforeEach` closes it, because an overlay
   survives a re-render of `#app` (test/support/filter-panel.js). */
const { closePanel, tagSection, appliedChips, triggerLabel } = filterPanelKit(dom);
beforeEach(() => closePanel());

/* The chips of whichever screen is currently rendered, in round-tag order.
   Scoped away from the desktop rail, which `renderSubScreenTabs` prepends into
   `#app` and which carries markup of its own (the trap in the jsdom rule). */
const chipsOf = (root) => [...root.querySelectorAll('.filter-chips .chip')];
const stateOf = (chip) =>
  chip.classList.contains('is-on') ? 'include'
  : chip.classList.contains('is-excluded') ? 'exclude'
  : 'ignore';

// ---------------------------------------------------------------- start session

test('start session: the toggle reads „Alle wählen" and includes every tag', async () => {
  await dom.call('showStartSession', roundFixture());
  const field = tagSection();
  const bulk = field.querySelector('.tag-bulk');

  assert.ok(bulk, 'the toggle is rendered inside the tag filter field');
  assert.equal(bulk.tagName, 'BUTTON');
  assert.equal(bulk.getAttribute('type'), 'button');
  // It is an action whose accessible NAME changes, not a state — so no
  // aria-pressed, which would announce a meaning ("pressed") it doesn't have.
  assert.equal(bulk.hasAttribute('aria-pressed'), false);
  // Outside `.filter-chips`: that element is a role="group" over the chips, and
  // an action button is not one of them.
  assert.equal(bulk.closest('.filter-chips'), null);

  assert.equal(bulk.textContent, 'Alle wählen');
  bulk.click();

  assert.deepEqual(chipsOf(field).map(stateOf), ['include', 'include', 'include']);
  assert.equal(bulk.textContent, 'Alle abwählen', 'the label flips with the state');
});

test('start session: one click clears a MIXED filter', async () => {
  await dom.call('showStartSession', roundFixture());
  const field = tagSection();
  const bulk = field.querySelector('.tag-bulk');
  const chips = chipsOf(field);

  chips[0].click();                       // ignore -> include
  chips[1].click(); chips[1].click();     // ignore -> include -> exclude
  assert.deepEqual(chipsOf(field).map(stateOf), ['include', 'exclude', 'ignore']);
  assert.equal(bulk.textContent, 'Alle abwählen',
    'a mixed state offers the CLEAR action — this is the divergence from showTransferGames');

  bulk.click();
  assert.deepEqual(chipsOf(field).map(stateOf), ['ignore', 'ignore', 'ignore']);
  assert.equal(bulk.textContent, 'Alle wählen');
});

test('start session: cycling the last chip back to neutral restores „Alle wählen"', async () => {
  // The chip click has to re-sync the label too, not just the toggle's own
  // click — otherwise the button lies about what it will do next.
  await dom.call('showStartSession', roundFixture());
  const field = tagSection();
  const bulk = field.querySelector('.tag-bulk');
  const chip = chipsOf(field)[0];

  chip.click();
  assert.equal(bulk.textContent, 'Alle abwählen');
  chip.click(); chip.click();             // include -> exclude -> ignore
  assert.equal(stateOf(chip), 'ignore');
  assert.equal(bulk.textContent, 'Alle wählen', 'the map is empty again');
});

test('start session: the pool preview follows the toggle', async () => {
  await dom.call('showStartSession', roundFixture());
  const field = tagSection();
  const bulk = field.querySelector('.tag-bulk');
  const pooled = () =>
    [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();

  assert.deepEqual(pooled(), ['Azul', 'Catan', 'Uno'], 'unfiltered: the whole shelf');

  bulk.click();
  // „Alle wählen" over three tags leaves only a game carrying all three — none,
  // in the DEFAULT mode this spec runs in. That empty pool is the documented,
  // accepted consequence and is handled by the existing empty-pool copy. #726
  // added an opt-in „Mind. ein Tag" mode beside it (test/tag-filter-mode.test.js)
  // and deliberately did NOT change this default — so this assertion still
  // guards the bulk toggle rather than the combination rule.
  assert.deepEqual(pooled(), [], 'updateHint ran on the bulk click');

  bulk.click();
  assert.deepEqual(pooled(), ['Azul', 'Catan', 'Uno'], 'and again on the clear');
});

test('start session: a #252 preset arrives clearable in one click', async () => {
  // The reported pain, exactly: the screen presets the filter from the round's
  // last draw-flow session, so the user starts with chips already set.
  const round = roundFixture({
    lastSessionFilters: { tagIds: ['t1', 't2'], excludeTagIds: ['t3'] },
  });
  await dom.call('showStartSession', round);
  const field = tagSection();
  const bulk = field.querySelector('.tag-bulk');

  assert.deepEqual(chipsOf(field).map(stateOf), ['include', 'include', 'exclude'],
    'the preset is applied — otherwise this spec proves nothing about clearing one');
  assert.equal(bulk.textContent, 'Alle abwählen');

  bulk.click();
  assert.deepEqual(chipsOf(field).map(stateOf), ['ignore', 'ignore', 'ignore']);

  // What the draw would now send: the map is the only source for both lists, so
  // an empty map has to produce two empty arrays.
  const sent = [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();
  assert.deepEqual(sent, ['Azul', 'Catan', 'Uno'], 'the cleared filter draws from everything');
});

test('start session: a round with no tags renders no tag section, and no panel at all', async () => {
  // Since #827 the tag chips are a section INSIDE the one filter control, so
  // "no tags" is now absence rather than a hidden field — and on this fixture,
  // whose games carry no BGG metadata either, the whole panel is absent with
  // them. The mount stays as the anchor the backfill remounts into (#736).
  await dom.call('showStartSession', roundFixture({ tags: [] }));
  assert.equal(dom.app.querySelector('.fpanel__group'), null, 'no tag section');
  assert.equal(dom.app.querySelector('.tag-bulk'), null);
  assert.equal(dom.app.querySelector('.fpanel'), null,
    'no tags AND no metadata means no filter control whatsoever');
  assert.equal(dom.app.querySelector('#filterMount').hidden, true);
});

// ------------------------------------------------------------------------ Regal

/* `renderRegalTab` keeps the filter map per round for the session and resets it
   only when the round ID changes (`regalFiltersRid`). So each spec renders its
   own round id — re-using one would carry the previous spec's chips in and make
   every count wrong for a reason that has nothing to do with the toggle. */
let regalRid = 0;
const regal = (over) => {
  // An overlay outlives `#app`, so a leftover panel would hand the next spec the
  // PREVIOUS round's tag section (test/support/filter-panel.js).
  closePanel();
  dom.app.innerHTML = '';
  const r = roundFixture({ id: `regal-${++regalRid}`, ...over });
  dom.call('renderRegalTab', r, r.games);
  return { wrap: dom.app.querySelector('.regal-filter'), round: r };
};

test('Regal: the toggle sits in the filter panel and flips the same way', () => {
  regal();
  const field = tagSection();
  const bulk = field.querySelector('.tag-bulk');

  assert.ok(bulk, 'rendered inside the panel, so it shows whenever the panel is open');
  assert.equal(bulk.closest('.filter-chips'), null);
  assert.equal(bulk.hasAttribute('aria-pressed'), false);
  assert.equal(bulk.textContent, 'Alle wählen');

  bulk.click();
  assert.deepEqual(chipsOf(field).map(stateOf), ['include', 'include', 'include']);
  assert.equal(bulk.textContent, 'Alle abwählen');
});

test('Regal: the toggle updates the grid AND the applied-filter chips', () => {
  regal();
  const bulk = tagSection().querySelector('.tag-bulk');
  const cards = () => dom.app.querySelectorAll('.cards .game-card').length;

  assert.equal(cards(), 3);
  assert.deepEqual(appliedChips(), [], 'no active filters yet');

  bulk.click();
  // The bulk toggle mutates the map behind the chips' backs, so it has to tell
  // the bar itself — `syncFilterBar` — or the panel would show three included
  // tags over an empty chip row.
  assert.deepEqual(appliedChips(), ['Area Control', 'Deck Builder', 'Party']);
  assert.equal(triggerLabel(), 'Filter (3 aktiv)',
    'the count is announced on the trigger, not left to the chips\' colour alone');
  assert.equal(cards(), 0, 'renderGames ran — three ANDed tags match no game');

  bulk.click();
  assert.deepEqual(appliedChips(), []);
  assert.equal(cards(), 3, 'the grid came back');
});

test('Regal: one click clears a mixed filter, and a chip re-syncs the label', () => {
  const { round } = regal();
  const field = tagSection();
  const bulk = field.querySelector('.tag-bulk');
  const chips = chipsOf(field);

  chips[2].click(); chips[2].click();      // Party -> exclude
  assert.equal(bulk.textContent, 'Alle abwählen', 'an exclusion alone is a filter to clear');
  assert.deepEqual(appliedChips(), ['ohne Party'], 'and the bar names it as an exclusion');
  assert.equal(dom.app.querySelectorAll('.cards .game-card').length, 3, 'no game carries Party');

  // The Regal keeps its filter across a re-render of the SAME round, so the
  // toggle has to read the persisted map when it is rebuilt — a label computed
  // only on click would come back saying „Alle wählen" over a live filter.
  closePanel();
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games);
  const reopened = tagSection();
  assert.deepEqual(chipsOf(reopened).map(stateOf), ['ignore', 'ignore', 'exclude']);
  assert.equal(reopened.querySelector('.tag-bulk').textContent, 'Alle abwählen');

  reopened.querySelector('.tag-bulk').click();
  assert.deepEqual(chipsOf(reopened).map(stateOf), ['ignore', 'ignore', 'ignore']);
  assert.equal(reopened.querySelector('.tag-bulk').textContent, 'Alle wählen');
});

test('Regal: a round with no tags renders no filter at all', () => {
  const { wrap } = regal({ tags: [] });
  // The `.regal-filter` element itself survives since #736 — it is the anchor
  // the shelf-wide backfill's repaint mounts the filter control into — but
  // with no tags and no metadata it must be hidden AND empty, so the screen is
  // the one it always was. These fixture games carry no provider metadata, so
  // nothing can fill it here.
  assert.ok(wrap, 'the repaint anchor must survive');
  assert.equal(wrap.hidden, true);
  assert.equal(wrap.children.length, 0, 'a hidden wrapper must also hold nothing');
  assert.equal(dom.app.querySelector('.tag-bulk'), null);
});
