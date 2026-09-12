'use strict';

/*
 * The selection mode itself (#832) — on the Regal's cover grid and on the three
 * off-shelf screens — rendered for real and driven through the DOM.
 *
 * What this can see that a route spec cannot: that the mode is reachable at all,
 * that it composes with the Regal's filters (the whole reason it lives in the
 * grid rather than in a flat picker sheet), what the confirm actually says, and
 * that the request carries exactly the ids the user confirmed a count for.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);

let rid = 0;
const roundFixture = (over = {}) => ({
  id: `bs-${++rid}`,
  name: 'Freitagsrunde',
  members: [{ id: 'm1', name: 'Anna' }],
  tags: [],
  sessions: [],
  games: [
    { id: 'g1', title: 'Azul' },
    { id: 'g2', title: 'Brass' },
    { id: 'g3', title: 'Cascadia' },
  ],
  ...over,
});

/* Record every request the view makes and every confirm it puts up. `fetchRound`
   is a top-level const (so unstubbable — .claude/rules/testing-views-under-jsdom.md);
   the GET is answered through `api` instead, which is what it calls. */
function spy({ confirm = true, reply = {}, round = null } = {}) {
  const calls = [];
  const confirms = [];
  const confirmOpts = [];
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body: body && JSON.parse(JSON.stringify(body)) });
    return method === 'GET' && round ? round : reply;
  });
  dom.set('confirmDialog', (o) => {
    confirms.push(o.body); confirmOpts.push(o); return Promise.resolve(confirm);
  });
  dom.set('toast', () => {});
  dom.set('showRound', () => {});
  return { calls, confirms, confirmOpts, posts: () => calls.filter((c) => c.method === 'POST') };
}

const regal = (over) => {
  dom.app.innerHTML = '';
  const r = roundFixture(over);
  dom.call('renderRegalTab', r, r.games.filter((g) => !g.retired && !g.completed && !g.wish));
  return r;
};
const cards = () => [...dom.app.querySelectorAll('.game-card')];
const cardFor = (title) => cards().find((c) => c.querySelector('.game-card__title').textContent === title);
const toggleBtn = () => [...dom.app.querySelectorAll('.section-tools .link-btn')]
  .find((b) => /Auswählen|Fertig/.test(b.textContent));
const bar = () => dom.app.querySelector('.bulk-bar');
const act = (name) => bar().querySelector(`[data-act="${name}"]`);

// ------------------------------------------------------------------- Regal

test('the Regal offers a selection mode, and the bar is hidden until it is on', () => {
  spy();
  regal();
  assert.ok(toggleBtn(), 'no way into the mode at all');
  assert.equal(bar().hidden, true);

  toggleBtn().click();
  assert.equal(bar().hidden, false);
  assert.match(toggleBtn().textContent, /Fertig/, 'the toggle states how to leave');
});

/* A card is a link to the game's detail page. In selection mode it must become a
   toggle instead — dropping the href and swapping the role is what keeps that
   honest for assistive tech, and what stops a pick from navigating away. */
test('a card stops being a link while selecting, and says so in ARIA', () => {
  spy();
  regal();
  const card = cardFor('Azul');
  assert.ok(card.getAttribute('href'), 'fixture: a card is a link to start with');
  assert.equal(card.getAttribute('aria-pressed'), null);

  toggleBtn().click();
  assert.equal(card.getAttribute('href'), null, 'still a link -> a pick would navigate away');
  assert.equal(card.getAttribute('role'), 'button');
  assert.equal(card.getAttribute('aria-pressed'), 'false');

  card.click();
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.ok(card.classList.contains('is-picked'), 'state is not conveyed by ARIA alone');

  toggleBtn().click(); // leave the mode
  assert.ok(cardFor('Azul').getAttribute('href'), 'the link comes back');
  assert.equal(cardFor('Azul').getAttribute('aria-pressed'), null);
});

test('the live count follows the selection and gates both actions', () => {
  spy();
  regal();
  toggleBtn().click();
  const count = () => bar().querySelector('.bulk-bar__count').textContent;

  assert.match(count(), /^0 /);
  assert.equal(act('retire').disabled, true, 'an empty selection must not be actionable');
  assert.equal(act('delete').disabled, true);

  cardFor('Azul').click();
  assert.match(count(), /^1 /);
  assert.equal(act('retire').disabled, false);

  cardFor('Brass').click();
  assert.match(count(), /^2 /);
  cardFor('Azul').click(); // deselect
  assert.match(count(), /^1 /);
});

/* THE reason the mode lives in the grid rather than in a picker sheet: it
   inherits the Regal's search, so "select all" means "everything I narrowed
   to" rather than "the whole shelf". */
test('"select all" means everything the FILTERS currently show, not the whole shelf', async () => {
  const { posts, confirms } = spy();
  const r = regal();
  toggleBtn().click();

  const search = dom.app.querySelector('.search-pill input');
  search.value = 'as'; // Brass, Cascadia
  search.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(cards().filter((c) => c.isConnected).map((c) => c.querySelector('.game-card__title').textContent).sort(),
    ['Brass', 'Cascadia'], 'fixture: the search narrowed the grid');

  bar().querySelector('[data-act="all"]').click();
  assert.match(bar().querySelector('.bulk-bar__count').textContent, /^2 /);

  act('retire').click();
  await flush();
  assert.equal(confirms.length, 1);
  assert.equal(posts().length, 1);
  assert.equal(posts()[0].path, `/api/rounds/${r.id}/games/bulk-retire`);
  assert.deepEqual([...posts()[0].body.gameIds].sort(), ['g2', 'g3'],
    'Azul was filtered out, so it must not be retired');
});

/* The selection deliberately survives a filter change — picking a few, searching
   again and picking a few more is the normal way to use it — and the count is
   what makes a selection reaching beyond the visible grid visible at all. */
test('the selection survives a filter change, and the count states it', () => {
  spy();
  regal();
  toggleBtn().click();
  cardFor('Azul').click();

  const search = dom.app.querySelector('.search-pill input');
  search.value = 'Brass';
  search.dispatchEvent(new dom.window.Event('input'));

  assert.match(bar().querySelector('.bulk-bar__count').textContent, /^1 /,
    'the off-screen pick is still counted, not silently dropped');
  cardFor('Brass').click();
  assert.match(bar().querySelector('.bulk-bar__count').textContent, /^2 /);
});

/* ---------------------------------------------------- owners (#972) */

/* The owner picker is the only bulk action that goes through a SHEET, so its OK
   travels closeSheet -> history.back() -> popstate -> the deferred callback
   (.claude/rules/sheet-history-back-dismissal.md).

   `flush()` CANNOT await that: it is a `setImmediate`, and jsdom queues popstate
   on a task source `setImmediate` does not drain — measured, twenty of them move
   it no further than one. The pop then lands during the NEXT test, which reads as
   this one's request simply never being made while the following test passes.
   A real timer drains it; see .claude/rules/jsdom-popstate-needs-a-real-timer.md. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => dom.window.setTimeout(r, 0));
};

const sheet = () => dom.document.querySelector('.sheet-backdrop .sheet');
const ownerChips = () => [...sheet().querySelectorAll('.filter-chips .chip')];
const chipFor = (name) => ownerChips().find((c) => c.textContent.includes(name));
const sheetBtn = (label) => [...sheet().querySelectorAll('.sheet__actions .btn')]
  .find((b) => b.textContent.trim() === label);

const OWNERS_ROUND = {
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
};

const TAGS_ROUND = {
  tags: [{ id: 't1', name: 'Kenner' }, { id: 't2', name: 'Kurz' }],
};

/* Each of these closes its picker before finishing. A sheet left open is torn
   down by the NEXT openSheet, but its history marker is not — so the following
   test's closeSheet finds no marker to consume and never runs its callback,
   which presents as the request simply not being made. */
test('the owners action opens a picker over the round\'s members', async () => {
  spy();
  regal(OWNERS_ROUND);
  toggleBtn().click();
  assert.equal(act('owners').disabled, true, 'an empty selection must not be actionable');

  cardFor('Azul').click();
  assert.equal(act('owners').disabled, false);
  act('owners').click();

  assert.ok(sheet(), 'no picker opened');
  // The chip carries an avatar before the name, so match on the name, not equality.
  assert.equal(ownerChips().length, 2, 'one chip per seat of the round');
  assert.ok(chipFor('Anna') && chipFor('Ben'), 'both seats must be offered');
  assert.ok(ownerChips().every((c) => c.getAttribute('aria-pressed') === 'false'),
    'the picker must start empty — the selection can hold games with different owners');

  sheetBtn('Abbrechen').click();
  await settle();
});

test('picking owners sends exactly the selected games and the chosen seats', async () => {
  const { posts, confirms, confirmOpts } = spy();
  const r = regal(OWNERS_ROUND);
  toggleBtn().click();
  cardFor('Azul').click();
  cardFor('Cascadia').click();
  act('owners').click();

  chipFor('Anna').click();
  chipFor('Ben').click();
  chipFor('Ben').click(); // toggled back off — only Anna should travel
  sheetBtn('OK').click();
  await settle();

  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /Anna/, 'the confirm must name who, not just how many');
  assert.equal(confirmOpts[0].danger, false, 'setting owners destroys nothing');
  assert.equal(confirmOpts[0].confirmLabel, 'Besitzer setzen');
  assert.equal(posts().length, 1);
  assert.equal(posts()[0].path, `/api/rounds/${r.id}/games/bulk-owners`);
  assert.deepEqual([...posts()[0].body.gameIds].sort(), ['g1', 'g3']);
  assert.deepEqual(posts()[0].body.ownerIds, ['m1']);
});

/* An empty pick is the CLEAR, and it gets its own wording: "set the owners of 3
   games to ''" is not a sentence, and this is the half worth a warning. */
test('OK with nobody picked sends the clear, under its own confirm', async () => {
  const { posts, confirms, confirmOpts } = spy();
  regal(OWNERS_ROUND);
  toggleBtn().click();
  cardFor('Azul').click();
  act('owners').click();
  sheetBtn('OK').click();
  await settle();

  assert.equal(posts().length, 1);
  assert.deepEqual(posts()[0].body.ownerIds, [], 'an empty pick must reach the server as the clear');
  assert.match(confirms[0], /entfernen/, 'the clear needs its own wording, not the set one');
  // The verb on the button must match the deed — a danger button reading „Besitzer
  // setzen" over a question about REMOVING them is the worst moment to be vague.
  assert.equal(confirmOpts[0].danger, true, 'clearing is the half worth a warning');
  assert.equal(confirmOpts[0].confirmLabel, 'Besitz entfernen');
});

test('cancelling the picker sends nothing at all', async () => {
  const { posts, confirms } = spy();
  regal(OWNERS_ROUND);
  toggleBtn().click();
  cardFor('Azul').click();
  act('owners').click();
  chipFor('Anna').click();
  sheetBtn('Abbrechen').click();
  await settle();

  assert.equal(posts().length, 0, 'a cancelled picker must not write');
  assert.equal(confirms.length, 0, 'and must not even reach the confirm');
});

/* A round with no seats has nobody to name, so the picker could only ever clear.
   Hidden rather than disabled — the same call renderOwnerChips makes for itself. */
/* ------------------------------------------------------------- bulk tags

   The tags picker (#1000) shares openBulkPicker with the owners one, so the
   sheet scaffolding above already covers the OK/cancel path. What is specific
   here — and what no route spec can see — is the TRI-STATE: one chip means
   three different edits depending on how often it was clicked, and the third
   state is „leave alone", which must reach the server as neither list. */

const tagChipFor = (name) => [...sheet().querySelectorAll('.bulk-tags__chips .chip')]
  .find((c) => c.textContent.includes(name));

test('the tags action opens a picker over the round\'s tags, all three neutral', async () => {
  spy();
  regal(TAGS_ROUND);
  toggleBtn().click();
  assert.equal(act('tags').disabled, true, 'an empty selection must not be actionable');

  cardFor('Azul').click();
  assert.equal(act('tags').disabled, false);
  act('tags').click();

  assert.ok(sheet(), 'no picker opened');
  assert.equal(sheet().querySelectorAll('.bulk-tags__chips .chip').length, 2, 'one chip per round tag');
  // Neutral is the only safe start: the selection may hold games whose tags
  // differ, so any preselected state would be a claim about all of them.
  assert.ok([...sheet().querySelectorAll('.bulk-tags__chips .chip')]
    .every((c) => !c.classList.contains('is-on') && !c.classList.contains('is-excluded')));
  assert.equal(sheetBtn('OK').disabled, true, 'nothing picked is an unfinished sentence, not a no-op');

  sheetBtn('Abbrechen').click();
  await settle();
});

test('one click adds, two removes, three leaves the tag out of both lists', async () => {
  const { posts, confirms } = spy();
  const r = regal(TAGS_ROUND);
  toggleBtn().click();
  cardFor('Azul').click();
  cardFor('Cascadia').click();
  act('tags').click();

  tagChipFor('Kenner').click();                       // add
  tagChipFor('Kurz').click(); tagChipFor('Kurz').click(); // remove
  assert.ok(tagChipFor('Kenner').classList.contains('is-on'));
  assert.ok(tagChipFor('Kurz').classList.contains('is-excluded'));
  sheetBtn('OK').click();
  await settle();

  assert.match(confirms[0], /Kenner/, 'the confirm must name the tags, not just a count');
  assert.equal(posts().length, 1);
  assert.equal(posts()[0].path, `/api/rounds/${r.id}/games/bulk-tags`);
  assert.deepEqual([...posts()[0].body.gameIds].sort(), ['g1', 'g3']);
  assert.deepEqual([...posts()[0].body.addTagIds], ['t1']);
  assert.deepEqual([...posts()[0].body.removeTagIds], ['t2']);
});

test('a third click returns the chip to neutral and sends neither instruction', async () => {
  const { posts } = spy();
  regal(TAGS_ROUND);
  toggleBtn().click();
  cardFor('Azul').click();
  act('tags').click();

  tagChipFor('Kenner').click();
  const chip = tagChipFor('Kurz');
  chip.click(); chip.click(); chip.click();           // add -> remove -> neutral
  assert.ok(!tagChipFor('Kurz').classList.contains('is-on'));
  assert.ok(!tagChipFor('Kurz').classList.contains('is-excluded'));
  sheetBtn('OK').click();
  await settle();

  assert.deepEqual([...posts()[0].body.addTagIds], ['t1']);
  assert.deepEqual([...posts()[0].body.removeTagIds], [], 'a neutral chip must travel in neither list');
});

test('the tags action is absent when the round has no tags', () => {
  spy();
  regal();
  toggleBtn().click();
  assert.equal(act('tags'), null);
  assert.ok(act('retire'), 'the other actions are unaffected');
});

test('the owners action is absent when the round has no members', () => {
  spy();
  regal({ members: [] });
  toggleBtn().click();
  assert.equal(act('owners'), null);
  assert.ok(act('retire'), 'the other actions are unaffected');
});

test('leaving the mode clears the selection', () => {
  spy();
  regal();
  toggleBtn().click();
  cardFor('Azul').click();
  toggleBtn().click();
  toggleBtn().click();
  assert.match(bar().querySelector('.bulk-bar__count').textContent, /^0 /);
});

// --------------------------------------------------------------- the confirm

/* The confirm is the only thing standing between a click and an irreversible
   delete, so it must name the count AND state the session-history consequence —
   but only when the selection actually carries history, or it cries wolf and
   gets clicked through. */
test('deleting games that were PLAYED warns about the session history', async () => {
  const { confirms, calls } = spy();
  regal({ sessions: [{ id: 's1', gameIds: ['g1'], votes: {} }] });
  toggleBtn().click();
  cardFor('Azul').click();
  act('delete').click();
  await flush();

  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /Session/, 'the history consequence is not stated');
  assert.equal(calls[0].path.endsWith('/games/bulk-delete'), true);
});

test('deleting never-played games states the count without crying wolf', async () => {
  const { confirms } = spy();
  regal({ sessions: [{ id: 's1', gameIds: ['g3'], votes: {} }] });
  toggleBtn().click();
  cardFor('Azul').click();
  cardFor('Brass').click();
  act('delete').click();
  await flush();

  assert.match(confirms[0], /2/, 'the count is not named');
  assert.equal(/Session/.test(confirms[0]), false,
    'an unplayed selection loses no history, so the warning must not appear');
});

test('declining the confirm sends nothing', async () => {
  const { calls, confirms } = spy({ confirm: false });
  regal();
  toggleBtn().click();
  cardFor('Azul').click();
  act('retire').click();
  await flush();
  assert.equal(confirms.length, 1);
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------- off-shelf screens

/* The same idiom on the three archives, minus retire — which has no meaning for
   a game that has already left the shelf. */
const archiveFixture = (over = {}) => roundFixture({
  games: [
    { id: 'g1', title: 'Azul', retired: true, retiredAt: '2026-01-01T00:00:00Z' },
    { id: 'g2', title: 'Brass', retired: true, retiredAt: '2026-01-02T00:00:00Z' },
  ],
  ...over,
});
const archive = async (r) => {
  dom.app.innerHTML = '';
  await dom.call('showArchive', r.id, 'retired');
  return r;
};
const archiveToggle = () => [...dom.app.querySelectorAll('.page-head .link-btn')]
  .find((b) => /Auswählen|Fertig/.test(b.textContent));
const archiveBoxes = () => [...dom.app.querySelectorAll('.archive-row__pick input')];

test('an off-shelf screen offers bulk delete over its rows', async () => {
  const r = archiveFixture();
  const s = spy({ round: r });
  await archive(r);
  assert.ok(archiveToggle(), 'no way into the mode on the archive');
  assert.equal(dom.app.querySelector('.bulk-bar').hidden, true);
  assert.equal(archiveBoxes().length, 2, 'every row is selectable');

  archiveToggle().click();
  assert.equal(dom.app.querySelector('.bulk-bar').hidden, false);
  assert.equal(dom.app.querySelector('.bulk-bar [data-act="retire"]'), null,
    'retire is meaningless for a game that already left the shelf');

  const box = archiveBoxes()[0];
  box.checked = true;
  box.dispatchEvent(new dom.window.Event('change'));
  dom.app.querySelector('.bulk-bar [data-act="delete"]').click();
  await flush();

  assert.equal(s.posts().length, 1);
  assert.equal(s.posts()[0].path, `/api/rounds/${r.id}/games/bulk-delete`);
  assert.equal(s.posts()[0].body.gameIds.length, 1);
});

test('the archive\'s "select all" ticks every row', async () => {
  const r = archiveFixture();
  spy({ round: r });
  await archive(r);
  archiveToggle().click();
  dom.app.querySelector('.bulk-bar [data-act="all"]').click();
  assert.deepEqual(archiveBoxes().map((b) => b.checked), [true, true]);
  assert.match(dom.app.querySelector('.bulk-bar__count').textContent, /^2 /);
});

/* Deleting a game takes its whole rating history with it, so it is a co-owner
   action (#137). Below that the per-row button is already absent — the entry
   point into the bulk mode must be too, or the screen offers a control whose
   every use 403s. */
test('a plain grantee is offered no bulk delete at all', async () => {
  const r = archiveFixture({ shared: true, role: 'editor' });
  spy({ round: r });
  await archive(r);
  assert.equal(archiveToggle(), undefined, 'the mode is offered below game.delete');
  assert.equal(dom.app.querySelector('.bulk-bar'), null);
});

test('the Regal hides bulk delete from a plain grantee but keeps retire', () => {
  spy();
  regal({ shared: true, role: 'editor' });
  toggleBtn().click();
  assert.equal(act('delete'), null, 'delete is a co-owner action');
  assert.ok(act('retire'), 'retiring is an ordinary write and must stay');
});
