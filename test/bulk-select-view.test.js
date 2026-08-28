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
const { loadApp } = require('./support/dom');

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
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body: body && JSON.parse(JSON.stringify(body)) });
    return method === 'GET' && round ? round : reply;
  });
  dom.set('confirm', (msg) => { confirms.push(msg); return confirm; });
  dom.set('toast', () => {});
  dom.set('showRound', () => {});
  return { calls, confirms, posts: () => calls.filter((c) => c.method === 'POST') };
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
test('"select all" means everything the FILTERS currently show, not the whole shelf', () => {
  const { calls, confirms } = spy();
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
  assert.equal(confirms.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/rounds/${r.id}/games/bulk-retire`);
  assert.deepEqual([...calls[0].body.gameIds].sort(), ['g2', 'g3'],
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
test('deleting games that were PLAYED warns about the session history', () => {
  const { confirms, calls } = spy();
  regal({ sessions: [{ id: 's1', gameIds: ['g1'], votes: {} }] });
  toggleBtn().click();
  cardFor('Azul').click();
  act('delete').click();

  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /Session/, 'the history consequence is not stated');
  assert.equal(calls[0].path.endsWith('/games/bulk-delete'), true);
});

test('deleting never-played games states the count without crying wolf', () => {
  const { confirms } = spy();
  regal({ sessions: [{ id: 's1', gameIds: ['g3'], votes: {} }] });
  toggleBtn().click();
  cardFor('Azul').click();
  cardFor('Brass').click();
  act('delete').click();

  assert.match(confirms[0], /2/, 'the count is not named');
  assert.equal(/Session/.test(confirms[0]), false,
    'an unplayed selection loses no history, so the warning must not appear');
});

test('declining the confirm sends nothing', () => {
  const { calls, confirms } = spy({ confirm: false });
  regal();
  toggleBtn().click();
  cardFor('Azul').click();
  act('retire').click();
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
