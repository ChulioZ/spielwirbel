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

// ---------------------------------------------------------------- start session

test('start session: the control is absent until TWO tags are included', async () => {
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('#gamesFilterField');
  const mode = field.querySelector('.tag-mode');
  const chips = chipsOf(field);

  assert.ok(mode, 'the control is rendered, hidden — not built on demand');
  assert.equal(mode.hidden, true, 'no included tags yet');

  chips[0].click();                    // 1 included: both modes are identical
  assert.equal(mode.hidden, true, 'one included tag makes the two modes the same');

  chips[1].click();                    // 2 included
  assert.equal(mode.hidden, false);

  chips[1].click();                    // -> exclude, so back to 1 included
  assert.equal(mode.hidden, true, 'an EXCLUDED tag does not count towards the two');
});

test('start session: the mode survives while the control is hidden', async () => {
  // Dropping to one included tag hides the control; adding one back must restore
  // the mode the user picked rather than silently resetting it to „Alle Tags".
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('#gamesFilterField');
  const mode = field.querySelector('.tag-mode');
  const chips = chipsOf(field);

  chips[0].click(); chips[1].click();
  optsOf(field)[1].click();                        // -> „Mind. ein Tag"
  assert.deepEqual(pressed(field), ['false', 'true']);

  chips[1].click(); chips[1].click(); chips[1].click();   // exclude -> ignore -> include
  assert.equal(mode.hidden, false);
  assert.deepEqual(pressed(field), ['false', 'true'], 'the choice came back');
});

test('start session: the pool preview follows the mode (#726)', async () => {
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('#gamesFilterField');
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
  const field = dom.app.querySelector('#gamesFilterField');
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
  const field = dom.app.querySelector('#gamesFilterField');
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
  const field = dom.app.querySelector('#gamesFilterField');
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
  const field = dom.app.querySelector('#gamesFilterField');
  assert.equal(field.querySelector('.tag-mode').hidden, false);
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
  const field = dom.app.querySelector('#gamesFilterField');
  assert.deepEqual(pressed(field), ['true', 'false']);
  assert.deepEqual(
    [...dom.app.querySelectorAll('.pool-tile__name')].map((el) => el.textContent).sort(), ['Azul']);
});

test('start session: the bulk toggle reveals and hides the control', async () => {
  // „Alle wählen" jumps straight from 0 to 3 included tags without a chip click,
  // so it needs its own sync — otherwise the control stays hidden over a filter
  // the mode very much applies to.
  await dom.call('showStartSession', roundFixture());
  const field = dom.app.querySelector('#gamesFilterField');
  const bulk = field.querySelector('.tag-bulk');
  const mode = field.querySelector('.tag-mode');

  assert.equal(mode.hidden, true);
  bulk.click();
  assert.equal(mode.hidden, false, 'three tags included');
  bulk.click();
  assert.equal(mode.hidden, true, 'cleared again');
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

  assert.equal(wrap.querySelector('.tag-mode').hidden, true);
  chips[0].click(); chips[1].click();
  assert.equal(wrap.querySelector('.tag-mode').hidden, false);
  assert.deepEqual(titles(), ['Azul'], 'AND');

  optsOf(wrap)[1].click();
  assert.deepEqual(titles(), ['Azul', 'Catan'], 'OR — renderGames ran');
});

test('Regal: the count badge ignores the mode', () => {
  // It counts actively-filtering tags, which the mode does not change — a badge
  // that moved with it would report a number nothing else in the UI means.
  const { wrap } = regal();
  chipsOf(wrap)[0].click(); chipsOf(wrap)[1].click();
  const badge = wrap.querySelector('.filter-toggle__badge');
  assert.equal(badge.textContent, '2');
  optsOf(wrap)[1].click();
  assert.equal(badge.textContent, '2');
  assert.equal(wrap.querySelector('.filter-toggle').getAttribute('aria-label'),
    'Nach Tags filtern (2 aktiv)');
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
  assert.equal(again.querySelector('.tag-mode').hidden, false);
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
