'use strict';

/* The way back INTO a game that has left the shelf (#663).
 *
 * The three off-shelf screens — Aussortiert, Durchgespielt and the Wunschliste
 * (#250, #560) — list games whose detail pages render perfectly well but were
 * reachable by URL only: no row on any of them was a link. The Wunschliste felt
 * it hardest, because the detail page is where a game's title, cover, player
 * range and tags are edited, so a wish was uncorrectable.
 *
 * Linking the rows is the small half. The half that MUST ship with it is the
 * detail page's missing `wish` branch: a wished-for game fell through the
 * retired/completed branches into the active `else` and was offered „Direkt
 * spielen", which the server refuses with a 400 (`isActiveGame`, see
 * `.claude/rules/active-games-filter-sites.md`). That was latent only because
 * nothing linked to the page — which is exactly what this change ends.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): every claim here is about
 * which element carries the href, which buttons exist, and where Back lands —
 * none of which a regex over the view can see.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator } = require('./support/dom');

const RID = 'r1';
const t = translator('de');

/* One fixture serving all three screens and all four detail-page states: an
   active game, one per off-shelf state. The wished-for game carries a player
   range and a tag so its detail page is not the `sparse` onboarding variant —
   the state chip and the action toolbar render either way, but a realistic page
   is what the assertions below are about. */
function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [{ id: 't1', name: 'Kennerspiel', icon: 'brain' }],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [] },
      { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
      { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
      {
        id: 'g4', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z',
        minPlayers: 1, maxPlayers: 4, tagIds: ['t1'],
      },
    ],
    sessions: [],
  };
}

/** A booted app answering the network from the fixture; `calls` records writes. */
function bootApp(t_, { onApi } = {}) {
  const dom = loadApp();
  t_.after(() => dom.close());
  const round = roundFixture();
  const calls = [];
  dom.set('api', async (method, url, body) => {
    if (method !== 'GET') calls.push({ method, url, body });
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    if (onApi) return onApi(method, url, body);
    return {};
  });
  dom.set('toast', () => {});
  dom.set('confirm', () => true);
  return { dom, round, calls };
}

/* Deep-link into a screen: with location.pathname already equal to the view's
   own path, syncUrl REPLACES instead of pushing, so navIndex stays 0 and the
   back control takes its fallback rather than history.back(). That is precisely
   the case the state-derived fallback exists for — a game opened from a URL,
   which is what a shared or bookmarked link is. */
const deepLink = (dom, path) => dom.run(`history.replaceState({}, '', ${JSON.stringify(path)})`);

const tick = () => new Promise((r) => setImmediate(r));

/** Text of every <button> in the detail page's action toolbar. */
function actionLabels(app) {
  const bar = app.querySelector('.toolbar');
  assert.ok(bar, 'the detail page rendered no action toolbar at all');
  return [...bar.querySelectorAll('button')].map((b) => b.textContent.trim());
}

const SCREENS = [
  ['retired archive', 'showRetired', 'g2', 'Azul'],
  ['completed archive', 'showCompleted', 'g3', 'Cascadia'],
  ['wish list', 'showWishlist', 'g4', 'Ark Nova'],
];

for (const [name, view, gid, title] of SCREENS) {
  test(`the ${name}'s rows link their title and cover to the game's detail page`, async (t_) => {
    const { dom } = bootApp(t_);
    await dom.call(view, RID);

    const row = dom.app.querySelector('.archive-row');
    assert.ok(row, `the ${name} rendered no row — check the fixture`);
    assert.match(row.textContent, new RegExp(title));

    const href = `/round/${RID}/game/${gid}`;
    const titleEl = row.querySelector('.archive-row__title');
    assert.equal(titleEl.tagName, 'A', `the ${name}'s row title is a <${titleEl.tagName}>, so there is no way into the game`);
    assert.equal(titleEl.getAttribute('href'), href);

    const imgEl = row.querySelector('.archive-row__img');
    assert.equal(imgEl.tagName, 'A', `the ${name}'s row cover is a <${imgEl.tagName}>`);
    assert.equal(imgEl.getAttribute('href'), href);
  });

  test(`the ${name}'s row keeps ONE tab stop and its own two actions`, async (t_) => {
    const { dom } = bootApp(t_);
    await dom.call(view, RID);
    const row = dom.app.querySelector('.archive-row');

    /* The title is the named tab stop; the cover targets the same game beside
       it, so it stays mouse-clickable but leaves the tab order and the
       accessibility tree rather than announcing as a second, nameless control
       (the #145 pattern the results rows already use). */
    const titleEl = row.querySelector('.archive-row__title');
    assert.equal(titleEl.getAttribute('tabindex'), null);
    assert.equal(titleEl.getAttribute('aria-hidden'), null);
    assert.ok(titleEl.textContent.trim(), 'the row title link has no accessible name');

    const imgEl = row.querySelector('.archive-row__img');
    assert.equal(imgEl.getAttribute('aria-hidden'), 'true');
    assert.equal(imgEl.getAttribute('tabindex'), '-1');

    /* A <button> inside an <a> is invalid HTML, so the row is a linked half plus
       an inert remainder, never a clickable row
       (`.claude/rules/ds-row-is-a-click-target.md`). */
    const acts = [...row.querySelectorAll('.archive-row__actions button')];
    assert.equal(acts.length, 2, 'the row lost its Restore/Delete buttons');
    for (const btn of acts) {
      assert.equal(btn.closest('a'), null, 'an action button ended up inside the row link — invalid HTML');
    }
  });
}

test('a wished-for game offers only the way onto the shelf', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g4');

  const labels = actionLabels(dom.app);
  /* „Direkt spielen" is the one that matters: the server refuses it with a 400
     `Game is on the wishlist`, so offering it hands the user a seat picker, a
     start button and an English server error. */
  assert.deepEqual(labels, [t('wish.restore')],
    `a wish's detail page offers ${JSON.stringify(labels)}; it may offer only „${t('wish.restore')}"`);
});

test('„Ins Regal" from the detail page hits the wish endpoint, like the row button', async (t_) => {
  const { dom, calls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g4');

  dom.app.querySelector('.toolbar button').click();
  await tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `/api/rounds/${RID}/games/g4/wish`);
  /* Spread into THIS realm before comparing: the body was built inside the
     jsdom vm context, so it carries that context's Object.prototype and
     deepStrictEqual fails on prototype identity alone. */
  assert.deepEqual({ ...calls[0].body }, { wish: false });
});

test('a wished-for game wears a Wunschliste chip beside its title', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g4');

  /* Scoped to `.gd-head`: the desktop rail carries its own <h1> and its own
     `.gd-title` (the round-name editor), so an unscoped selector answers about
     the wrong screen furniture entirely. */
  const chip = dom.app.querySelector('.gd-head h1 .tag--wish');
  assert.ok(chip, 'a wished-for game shows no state chip, so the page looks like an ordinary shelf game');
  assert.equal(chip.textContent.trim(), t('wish.tag'));

  /* The two archives keep theirs — this is a third chip, not a replacement. */
  await dom.call('showGameDetail', RID, 'g2');
  assert.ok(dom.app.querySelector('.gd-head h1 .tag--retired'));
  await dom.call('showGameDetail', RID, 'g3');
  assert.ok(dom.app.querySelector('.gd-head h1 .tag--completed'));
});

test("a wish's title can be edited from its detail page", async (t_) => {
  const { dom, calls } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g4');

  /* The capability the Wunschliste gains from being linked at all: the inline
     title editor lives here and PATCH carries no state guard, so nothing had to
     be built for it — but nothing proved it either. */
  dom.app.querySelector('.gd-head .gd-title').click();
  const input = dom.app.querySelector('.gd-title-input');
  assert.ok(input, 'clicking a wish title opened no editor');
  input.value = 'Ark Nova: Marine Worlds';
  input.dispatchEvent(new dom.window.FocusEvent('blur'));
  await tick();

  assert.deepEqual(calls.map((c) => [c.method, c.url]), [['PATCH', `/api/rounds/${RID}/games/g4`]]);
  assert.equal(calls[0].body.title, 'Ark Nova: Marine Worlds');
});

/* Back from a deep-linked detail page lands on the screen that lists the game.
   Derived from the game's own state rather than from an origin argument, so it
   is right for a page reached by URL, from a results screen or from Pokale. */
const BACK = [
  ['an active game', 'g1', `/round/${RID}/regal`],
  ['a retired game', 'g2', `/round/${RID}/retired`],
  ['a completed game', 'g3', `/round/${RID}/completed`],
  ['a wished-for game', 'g4', `/round/${RID}/wishlist`],
];

for (const [name, gid, expected] of BACK) {
  test(`Back from ${name}'s page falls back to the screen that lists it`, async (t_) => {
    const { dom } = bootApp(t_);
    deepLink(dom, `/round/${RID}/game/${gid}`);
    await dom.call('showGameDetail', RID, gid);

    dom.app.querySelector('.back-row button').click();
    await tick();

    assert.equal(dom.window.location.pathname, expected,
      `Back from ${name} lands on ${dom.window.location.pathname}, not on the screen it belongs to`);
  });
}
