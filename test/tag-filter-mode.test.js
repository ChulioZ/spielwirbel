'use strict';

/* The AND/OR mode for INCLUDED tag chips (#726), on both screens that carry the
   filter: the session setup screen and the Regal.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): the control, the chips it
 * repaints, the pool preview / grid it refreshes and the request body it ends up
 * in are four separate wirings, and the whole feature is that they agree.
 *
 * The predicate itself is unit-tested server-side (test/draw.test.js). What is
 * pinned here is the CLIENT half of the "the preview must not promise a pool the
 * draw won't produce" contract (.claude/rules/active-games-filter-sites.md) —
 * the two express one rule over different inputs and are deliberately not
 * shared, so each side needs its own coverage. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const TAGS = [
  { id: 't1', name: 'Area Control', icon: 'map' },
  { id: 't2', name: 'Deck Builder', icon: 'cards' },
  { id: 't3', name: 'Party', icon: 'confetti' },
];

/* Azul carries BOTH filterable tags and Catan only one, which is the whole
   discrimination: under AND the pool is {Azul}, under OR it is {Azul, Catan}.
   Uno carries none, so 'any' can be shown to still be a FILTER rather than an
   off switch — without it `some(...)` replaced by `true` passes every assertion. */
const roundFixture = (over) => ({
  id: 'r1',
  name: 'Freitagsrunde',
  tags: TAGS,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
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

const chipsOf = (root) => [...root.querySelectorAll('.filter-chips .chip')];
const optsOf = (root) => [...root.querySelectorAll('.tag-mode__opt')];
const pressed = (root) => optsOf(root).map((b) => b.getAttribute('aria-pressed'));
/* #787: the control is never removed from the flow — it goes INERT below two
   included tags. So "is it usable" is read off `disabled`, and `hidden` is
   asserted to stay false everywhere it used to flip. */
const inert = (root) => {
  const el = root.querySelector('.tag-mode');
  const dis = optsOf(root).map((b) => b.disabled);
  assert.equal(el.hidden, false, 'the control never leaves the flow (#787)');
  assert.equal(el.classList.contains('tag-mode--inert'), dis[0],
    'the styling hook must follow the disabled state');
  assert.deepEqual(dis[0], dis[1], 'both options share one inert state');
  return dis[0];
};

// ---------------------------------------------------------------- start session

test('start session: the control is INERT until TWO tags are included (#787)', async () => {
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  const chips = chipsOf(field);

  assert.ok(field.querySelector('.tag-mode'), 'rendered up front, not built on demand');
  assert.equal(inert(field), true, 'no included tags yet');

  chips[0].click();                    // 1 included: both modes are identical
  assert.equal(inert(field), true, 'one included tag makes the two modes the same');

  chips[1].click();                    // 2 included
  assert.equal(inert(field), false);

  chips[1].click();                    // -> exclude, so back to 1 included
  assert.equal(inert(field), true, 'an EXCLUDED tag does not count towards the two');
});

test('start session: cycling a chip never moves the chip row (#787)', async () => {
  // The bug: the control was `hidden` below two included tags and sits ABOVE the
  // chips, so the first click of a tri-state cycle pushed the row down ~30px and
  // the second click of the same cycle landed on a different tag. jsdom has no
  // layout, so what is pinned is the cause rather than the pixels — the control
  // keeps its box (never `hidden`) and its position among its siblings through
  // every step of a full cycle, with one tag already included so the count really
  // does cross the two-tag boundary in both directions.
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  const el = field.querySelector('.tag-mode');
  const siblings = () => [...el.parentNode.children].indexOf(el);
  const at = siblings();

  chipsOf(field)[0].click();           // tag A included; still below the boundary
  for (const step of ['include', 'exclude', 'unset']) {
    chipsOf(field)[2].click();         // walk tag C through its whole cycle
    assert.equal(el.hidden, false, `still in the flow after -> ${step}`);
    assert.equal(siblings(), at, `still in the same slot after -> ${step}`);
  }
});

test('start session: an inert option cannot be activated (#787)', async () => {
  // It is rendered rather than hidden now, so it is reachable by a stray click.
  // `disabled` on a native <button> is what keeps that click from silently
  // changing a mode the user cannot see the effect of — and what keeps the
  // option out of the Tab order.
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  assert.equal(inert(field), true);

  optsOf(field)[1].click();            // „Mind. ein Tag", while inert
  assert.deepEqual(pressed(field), ['true', 'false'], 'the mode did not move');

  chipsOf(field)[0].click(); chipsOf(field)[1].click();
  assert.equal(inert(field), false);
  optsOf(field)[1].click();
  assert.deepEqual(pressed(field), ['false', 'true'], 'and it works once interactive');
});

test('start session: the mode survives while the control is inert', async () => {
  // Dropping to one included tag makes the control inert; adding one back must
  // restore the mode the user picked rather than silently resetting it to „Alle
  // Tags" — and the pick must keep PAINTING as selected while inert, or the user
  // watches it disappear.
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  const chips = chipsOf(field);

  chips[0].click(); chips[1].click();
  optsOf(field)[1].click();                        // -> „Mind. ein Tag"
  assert.deepEqual(pressed(field), ['false', 'true']);

  chips[1].click();                                // -> exclude, back to 1 included
  assert.equal(inert(field), true);
  assert.deepEqual(pressed(field), ['false', 'true'], 'still painted while inert');
  assert.deepEqual(optsOf(field).map((b) => b.classList.contains('is-on')), [false, true]);

  chips[1].click(); chips[1].click();               // ignore -> include
  assert.equal(inert(field), false);
  assert.deepEqual(pressed(field), ['false', 'true'], 'the choice came back');
});

test('start session: the pool preview follows the mode (#726)', async () => {
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  const pooled = () =>
    [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort();

  chipsOf(field)[0].click(); chipsOf(field)[1].click();
  assert.deepEqual(pooled(), ['Azul'], 'AND: only the game carrying both');

  optsOf(field)[1].click();
  assert.deepEqual(pooled(), ['Azul', 'Catan'], 'OR: at least one of them');
  assert.ok(!pooled().includes('Uno'), "'any' still filters — it is not an off switch");

  optsOf(field)[0].click();
  assert.deepEqual(pooled(), ['Azul'], 'and back');
});

test('start session: the included chips describe the ACTIVE mode', async () => {
  // The only string in the app that states the semantics out loud, so it is the
  // one thing a screen reader user has to go on.
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  const chips = chipsOf(field);
  chips[0].click(); chips[1].click();

  assert.match(chips[0].getAttribute('aria-label'), /nur Spiele damit/);
  optsOf(field)[1].click();
  assert.match(chips[0].getAttribute('aria-label'), /zählt mit/,
    'switching the mode has to repaint the chips, not just the pool');
  // The excluded and ignored labels are mode-independent — an exclusion rejects
  // a game carrying it whatever the included tags do.
  const before = chips[2].getAttribute('aria-label');
  optsOf(field)[0].click();
  assert.equal(chips[2].getAttribute('aria-label'), before);
});

test('start session: the selection is not conveyed by colour alone', async () => {
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  chipsOf(field)[0].click(); chipsOf(field)[1].click();

  assert.deepEqual(pressed(field), ['true', 'false'], 'AND is the default');
  assert.deepEqual(optsOf(field).map((b) => b.tagName), ['BUTTON', 'BUTTON']);
  assert.deepEqual(optsOf(field).map((b) => b.getAttribute('type')), ['button', 'button']);
  // A group label, so the pair announces as one control rather than two loose
  // buttons — and a glyph in BOTH options, hidden by CSS on the inactive one, so
  // switching cannot resize either pill.
  const group = field.querySelector('.tag-mode');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'Wie die Tags kombiniert werden');
  assert.equal(field.querySelectorAll('.tag-mode__opt .ti').length, 2);
});

test('start session: the draw sends the mode it is showing (#726)', async () => {
  const sent = [];
  dom.set('api', async (method, path, body) => {
    sent.push({ ...body });
    return { session: { id: 's1', gameIds: [] }, games: [], members: [], guests: [], teams: [] };
  });
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  chipsOf(field)[0].click(); chipsOf(field)[1].click();
  optsOf(field)[1].click();

  dom.app.querySelector('#go').click();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].tagMode, 'any');
  // Copied into this realm first: the view built that array inside the vm
  // context, so deepEqual fails it on the prototype alone
  // (.claude/rules/testing-views-under-jsdom.md).
  assert.deepEqual([...sent[0].tagIds], ['t1', 't2']);
  dom.set('api', async () => { throw new Error('unstubbed api call'); });
});

test('start session: a #252 preset reopens on the mode the last draw used', async () => {
  const round = roundFixture({
    lastSessionFilters: { tagIds: ['t1', 't2'], excludeTagIds: [], count: 3, tagMode: 'any' },
  });
  await dom.call('showStartSession', round);
  const field = dom.app.querySelector('.fpanel__group');
  assert.equal(inert(field), false, 'the preset includes two tags, so it is live');
  assert.deepEqual(pressed(field), ['false', 'true']);
  assert.deepEqual(
    [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort(),
    ['Azul', 'Catan'], 'the preset mode is applied to the preview, not just to the buttons');
});

test('start session: a preset with no tagMode opens on „Alle Tags" (#726)', async () => {
  // Every round that drew before #726, and every AND draw after it — the key is
  // absent rather than 'all', so this is the path almost every user takes.
  const round = roundFixture({
    lastSessionFilters: { tagIds: ['t1', 't2'], excludeTagIds: [], count: 3 },
  });
  await dom.call('showStartSession', round);
  const field = dom.app.querySelector('.fpanel__group');
  assert.deepEqual(pressed(field), ['true', 'false']);
  assert.deepEqual(
    [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort(), ['Azul']);
});

test('start session: the bulk toggle wakes and re-inerts the control', async () => {
  // „Alle wählen" jumps straight from 0 to 3 included tags without a chip click,
  // so it needs its own sync — otherwise the control stays inert over a filter
  // the mode very much applies to.
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('.fpanel__group');
  const bulk = field.querySelector('.tag-bulk');

  assert.equal(inert(field), true);
  bulk.click();
  assert.equal(inert(field), false, 'three tags included');
  bulk.click();
  assert.equal(inert(field), true, 'cleared again');
});

// ------------------------------------------------------------------------ Regal

let regalRid = 0;
const regal = (over) => {
  dom.app.innerHTML = '';
  const r = roundFixture({ id: `regal-${++regalRid}`, ...over });
  dom.call('renderRegalTab', r, r.games);
  return { wrap: dom.app.querySelector('.regal-filter'), round: r };
};
const titles = () =>
  [...dom.app.querySelectorAll('.cards .game-card__title')].map((el) => el.textContent).sort();

test('Regal: the control filters the shelf the same way', () => {
  const { wrap } = regal();
  const chips = chipsOf(wrap);

  assert.equal(inert(wrap), true);
  chips[0].click(); chips[1].click();
  assert.equal(inert(wrap), false);
  assert.deepEqual(titles(), ['Azul'], 'AND');

  optsOf(wrap)[1].click();
  assert.deepEqual(titles(), ['Azul', 'Catan'], 'OR — renderGames ran');
});

test('Regal: the count badge ignores the mode', () => {
  // It counts actively-filtering tags, which the mode does not change — a badge
  // that moved with it would report a number nothing else in the UI means.
  const { wrap } = regal();
  chipsOf(wrap)[0].click(); chipsOf(wrap)[1].click();
  const badge = wrap.querySelector('.fpanel__badge');
  assert.equal(badge.textContent, '2');
  optsOf(wrap)[1].click();
  assert.equal(badge.textContent, '2');
  assert.equal(wrap.querySelector('.fpanel__summary').getAttribute('aria-label'),
    'Filter (2 aktiv)');
});

test('Regal: the mode survives a re-render of the same round', () => {
  // `regalFilters` keeps the whole filter for the session, scoped to one round —
  // a mode held in the view closure instead would silently reset every time the
  // user came back to the tab.
  const { wrap, round } = regal();
  chipsOf(wrap)[0].click(); chipsOf(wrap)[1].click();
  optsOf(wrap)[1].click();
  assert.deepEqual(titles(), ['Azul', 'Catan']);

  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games);
  const again = dom.app.querySelector('.regal-filter');
  assert.deepEqual(pressed(again), ['false', 'true']);
  assert.equal(inert(again), false);
  assert.deepEqual(titles(), ['Azul', 'Catan'], 'the grid came back filtered the same way');
});

test('Regal: opening a DIFFERENT round resets the mode', () => {
  const { wrap } = regal();
  chipsOf(wrap)[0].click(); chipsOf(wrap)[1].click();
  optsOf(wrap)[1].click();

  const { wrap: fresh } = regal();          // a new round id
  assert.deepEqual(pressed(fresh), ['true', 'false']);
  assert.deepEqual(chipsOf(fresh).map((c) => c.className), ['chip', 'chip', 'chip']);
  assert.deepEqual(titles(), ['Azul', 'Catan', 'Uno']);
});
