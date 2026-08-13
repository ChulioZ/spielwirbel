'use strict';

/* The Pokale Lieblingsspiele cards anchor on their game's cover art (#695).
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): the claim is about what the
 * card ends up containing, and the cover arrives through two different paths —
 * the inline placeholder for a coverless game, the lazy loader for a real one.
 *
 * Both paths are asserted, and that pairing is what keeps either assertion from
 * being vacuous: a view that emitted a placeholder unconditionally satisfies the
 * first test on its own, and one that never emitted a placeholder at all
 * satisfies the second. The fixture therefore carries one game of each kind,
 * held by two different members so both cards render at once.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { gameHue } = require('../public/js/cover');

const RID = 'r1';
/* A PlayStation-CDN URL on purpose, not the BGG one a modern capture would
   store: `coverUrl` rewrites only the hosts in COVER_RESIZERS, and geekdo can
   never be one of them (its transform paths are signed). So a BGG fixture would
   pass through byte-identically and the sizing assertion below could not tell
   `coverUrl(image, COVER_THUMB)` apart from a bare `game.image` — vacuously
   green against a render site that forgot to size its thumb at all. These hosts
   are legacy data since #744 but still render, which is exactly why the sizing
   path has to keep working (`.claude/rules/provider-cover-sizing.md`). */
const IMAGE = 'https://image.api.playstation.com/example/img/abc.jpg';

/* Anna's favourite is the game WITH a cover, Ben's the one without — so a card
   built with the two paths swapped fails by name rather than by count. */
const VOTES = {
  m1: { g1: { rating: 5 }, g2: { rating: 2 } },
  m2: { g1: { rating: 1 }, g2: { rating: 4 } },
};

const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
  ],
  games: [
    { id: 'g1', title: 'Ark Nova', image: IMAGE, tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
  ],
  sessions: [
    {
      id: 's1',
      createdAt: '2026-07-01T20:00:00.000Z',
      gameIds: ['g1', 'g2'],
      memberIds: ['m1', 'm2'],
      votes: VOTES,
      votedIds: Object.keys(VOTES),
      finished: true,
      cancelled: false,
      done: true,
      winnerIds: ['m1'],
      chosenGameId: 'g1',
      events: [],
    },
  ],
};

function bootApp(t) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return ROUND;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

/** The favourite card belonging to one member, found by the name it renders. */
const favCardOf = (root, name) =>
  [...root.querySelectorAll('.recap-fav')].find(
    (c) => (c.querySelector('.recap-fav__name') || {}).textContent === name
  );

test('a favourite whose game has no cover falls back to the placeholder gradient', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  const ben = favCardOf(dom.app, 'Ben');
  assert.ok(ben, "Ben's favourite card is missing entirely");
  assert.equal(ben.querySelector('.pokale-card__value').textContent, 'Azul');

  const cover = ben.querySelector('.recap-fav__cover');
  assert.ok(cover, 'the card renders no cover anchor at all');
  const ph = cover.querySelector('.cover-ph');
  assert.ok(ph, 'a coverless game must still get the deterministic placeholder layer');
  // Pinned against the real hash rather than "some number is present": the
  // custom property is what colours the gradient, and it must be UNITLESS —
  // `calc(h + 40deg)` inside `oklch(from …)` is a type error the browser drops
  // silently, leaving every card a flat box (cover.js, #256).
  assert.equal(ph.getAttribute('style'), `--cover-h:${gameHue('Azul')}`);
  assert.equal(cover.style.backgroundImage, '', 'nothing should have been loaded into a placeholder frame');
});

test("a favourite whose game has a cover loads it into the anchor", async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  const anna = favCardOf(dom.app, 'Anna');
  assert.ok(anna, "Anna's favourite card is missing entirely");
  assert.equal(anna.querySelector('.pokale-card__value').textContent, 'Ark Nova');

  const cover = anna.querySelector('.recap-fav__cover');
  assert.ok(cover, 'the card renders no cover anchor at all');
  assert.equal(cover.querySelector('.cover-ph'), null, 'a game with real art must not also draw the placeholder');
  // jsdom has no IntersectionObserver, so createCoverLoader takes its eager
  // fallback branch and the background is applied synchronously. The width term
  // is what proves the thumb size was requested rather than the full-size
  // original (`.claude/rules/provider-cover-sizing.md`).
  assert.match(cover.style.backgroundImage, /^url\(/);
  assert.ok(cover.style.backgroundImage.includes('abc.jpg'), 'the game\'s own image must be the one loaded');
  assert.ok(/[?&]w=160\b/.test(cover.style.backgroundImage), `expected a 160px thumb, got ${cover.style.backgroundImage}`);
});

test('the cover anchor targets its game but stays out of the tab order', async (t) => {
  const dom = bootApp(t);
  await dom.call('showRound', RID, 'pokale');
  const anna = favCardOf(dom.app, 'Anna');
  const cover = anna.querySelector('.recap-fav__cover');
  const title = anna.querySelector('.pokale-card__value');
  // Same target as the title beside it, so it is a redundant link: mouse-
  // clickable, but hidden from the accessibility tree rather than announcing as
  // a nameless control (`.claude/rules/ds-row-is-a-click-target.md`, and the
  // archive rows' precedent in #663).
  assert.equal(cover.getAttribute('href'), title.getAttribute('href'));
  assert.equal(cover.getAttribute('aria-hidden'), 'true');
  assert.equal(cover.getAttribute('tabindex'), '-1');
  assert.equal(title.getAttribute('aria-hidden'), null, 'the title must stay the reachable link');
});
