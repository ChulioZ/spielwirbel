'use strict';

/* The trophy cards and the Chronik's period cards lead with the named game's
 * cover (#979) — the move `.recap-fav` made for the Lieblingsspiele tiles
 * (#695), applied to the rest of the family. Before it, the Pokale tab was the
 * one hub tab with no imagery above the fold.
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): the claim is about what the
 * card ends up containing, and the cover arrives by two different paths — the
 * inline placeholder for a coverless game, the lazy loader for a real one.
 *
 * BOTH PATHS ARE ASSERTED, and that pairing is what keeps either from being
 * vacuous: a builder that emitted a placeholder unconditionally satisfies the
 * placeholder test alone, and one that never emitted a placeholder satisfies
 * the loaded-cover test alone. The fixture therefore carries one game of each
 * kind, and arranges for a DIFFERENT trophy card to name each — Meistgespielt
 * the game with art, Staubfänger the one without.
 *
 * Cards are located by the icon IN THEIR EYEBROW LINE, which makes the "the
 * trophy icon moved into the label" half of the change load-bearing rather than
 * a separate weak assertion: if the icon goes back to its own
 * `.pokale-card__icon` row, every lookup here misses and the tests fail by name.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { bodyOf, outranks } = require('./support/css');
const { gameHue } = require('../public/js/cover');

const RID = 'r1';

/* A PlayStation-CDN URL on purpose, not the BGG one a modern capture would
   store: `coverUrl` rewrites only the hosts in COVER_RESIZERS, and geekdo can
   never be one of them (its transform paths are signed). So a BGG fixture would
   pass through byte-identically and the sizing assertion below could not tell
   `coverUrl(image, COVER_THUMB)` apart from a bare `game.image` — vacuously
   green against a card that forgot to size its thumb at all
   (`.claude/rules/provider-cover-sizing.md`). */
const IMAGE = 'https://image.api.playstation.com/example/img/abc.jpg';

const VOTES = {
  m1: { g1: { rating: 5 }, g2: { rating: 4 } },
  m2: { g1: { rating: 4 }, g2: { rating: 4 } },
  m3: { g1: { rating: 5 }, g2: { rating: 3 } },
};

const played = (id, at, votes = {}) => ({
  id,
  createdAt: at,
  gameIds: ['g1', 'g2'],
  memberIds: ['m1', 'm2', 'm3'],
  votes,
  votedIds: Object.keys(votes),
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: ['m1'],
  chosenGameId: 'g1', // only ever g1, so Ark Nova is Meistgespielt …
  events: [],
});

const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
    { id: 'm3', name: 'Cem' },
  ],
  /* … and Azul, never chosen, is the Staubfänger. Two active games, which is
     also the minimum that card requires. */
  games: [
    { id: 'g1', title: 'Ark Nova', image: IMAGE, tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
  ],
  sessions: [
    played('s1', '2026-07-01T20:00:00.000Z', VOTES),
    played('s2', '2026-07-02T20:00:00.000Z'),
  ],
};

function boot(t) {
  const dom = loadApp({ locale: 'de' });
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

/** The one card whose EYEBROW carries `iconClass`, scoped to a container. */
const cardByEyebrow = (root, iconClass) => {
  const hits = [...root.querySelectorAll('.pokale-card')].filter((c) =>
    c.querySelector(`.pokale-card__label .${iconClass}`)
  );
  assert.equal(hits.length, 1, `expected exactly one card with .${iconClass} in its eyebrow, got ${hits.length}`);
  return hits[0];
};

// ---- the Pokale trophy cards ----------------------------------------------

test('the Meistgespielt card leads with its game’s cover, sized for the thumb', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'pokale');
  const card = cardByEyebrow(dom.app, 'ti-flame');

  assert.ok(card.classList.contains('pokale-card--cover'), 'the card must opt into the cover grid');
  assert.equal(card.querySelector('.pokale-card__icon'), null, 'the trophy icon must not also keep a row of its own');
  assert.equal(card.querySelector('.pokale-game__title').textContent, 'Ark Nova');

  const thumb = card.querySelector('.pokale-card__thumb');
  assert.ok(thumb, 'the card renders no cover frame at all');
  assert.equal(thumb.querySelector('.cover-ph'), null, 'a game with real art must not also draw the placeholder');
  /* jsdom has no IntersectionObserver, so createCoverLoader takes its eager
     fallback branch and the background is applied synchronously. The width term
     is what proves the thumb size was requested rather than the provider's
     full-resolution master. */
  assert.ok(thumb.style.backgroundImage.includes('abc.jpg'), 'the game’s own image must be the one loaded');
  assert.ok(/[?&]w=160\b/.test(thumb.style.backgroundImage), `expected a 160px thumb, got ${thumb.style.backgroundImage}`);
});

test('the Staubfänger card falls back to the deterministic placeholder gradient', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'pokale');
  const card = cardByEyebrow(dom.app, 'ti-sparkles');
  assert.equal(card.querySelector('.pokale-game__title').textContent, 'Azul');

  const thumb = card.querySelector('.pokale-card__thumb');
  assert.ok(thumb, 'a coverless game must still get a cover frame, not a missing column');
  const ph = thumb.querySelector('.cover-ph');
  assert.ok(ph, 'a coverless game must get the deterministic placeholder layer');
  /* Pinned against the real hash rather than "some number is present": the
     custom property is what colours the gradient, and it must be UNITLESS —
     `calc(h + 40deg)` inside `oklch(from …)` is a type error the browser drops
     silently, leaving every card a flat box (cover.js, #256). */
  assert.equal(ph.getAttribute('style'), `--cover-h:${gameHue('Azul')}`);
  assert.equal(thumb.style.backgroundImage, '', 'nothing should have been loaded into a placeholder frame');
});

test('the trophy thumb targets its game but stays out of the tab order', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'pokale');
  const card = cardByEyebrow(dom.app, 'ti-flame');
  const thumb = card.querySelector('.pokale-card__thumb');
  const title = card.querySelector('.pokale-game__title');
  /* Same target as the title beside it, so it is a redundant link: mouse-
     clickable, but hidden from the accessibility tree rather than announcing as
     a second, nameless control (`.claude/rules/ds-row-is-a-click-target.md`,
     and the archive rows' precedent in #663). */
  assert.equal(thumb.getAttribute('href'), title.getAttribute('href'));
  assert.match(thumb.getAttribute('href'), /\/game\//);
  assert.equal(thumb.getAttribute('aria-hidden'), 'true');
  assert.equal(thumb.getAttribute('tabindex'), '-1');
  assert.equal(title.getAttribute('aria-hidden'), null, 'the title must stay the reachable link');
});

// ---- the Chronik's period cards -------------------------------------------

/* Scoped to `.precap`, never to a bare `.pokale-card`: the Chronik carries the
   recap section's cards AND the timeline below it, so an unscoped selector on
   this screen answers about whichever came first (the trap the period-recap
   spec's own header describes). */
test('the period card on the Chronik leads with the cover too', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'chronik');
  const sec = dom.app.querySelector('.precap');
  assert.ok(sec, 'the period recap section is missing from the Chronik entirely');

  const card = cardByEyebrow(sec, 'ti-flame');
  assert.ok(card.classList.contains('pokale-card--cover'), 'the period card must opt into the cover grid');
  assert.equal(card.querySelector('.pokale-game__title').textContent, 'Ark Nova');

  const thumb = card.querySelector('.pokale-card__thumb');
  assert.ok(thumb, 'the period card renders no cover frame at all');
  assert.ok(/[?&]w=160\b/.test(thumb.style.backgroundImage), `expected a 160px thumb, got ${thumb.style.backgroundImage}`);
});

// ---- the layout the DOM above assumes -------------------------------------

/* jsdom applies no external stylesheet, so the two claims the markup rests on
   are parsed out of styles.css instead (`.claude/rules/testing-views-under-jsdom.md`).
   Without them the thumb is an unstyled inline anchor: `background-size: cover`
   on a zero-height box paints nothing, and every DOM assertion above still
   passes. */
test('the cover modifier outranks .pokale-card’s own display, and the thumb is a real frame', () => {
  assert.ok(
    outranks('.pokale-card.pokale-card--cover', '.pokale-card'),
    'a tie would leave the grid layout to lose or win on source order'
  );
  const grid = bodyOf('.pokale-card.pokale-card--cover');
  assert.ok(grid && /display:\s*grid/.test(grid), 'the cover card must be a grid');
  assert.match(grid, /grid-template-columns:\s*64px/, 'the cover column must be the 64px lead');

  const thumb = bodyOf('.pokale-card__thumb');
  assert.ok(thumb, '.pokale-card__thumb has no rule at all');
  assert.match(thumb, /width:\s*64px/);
  assert.match(thumb, /height:\s*64px/);
  // The .cover-ph layer is absolutely positioned, so the frame must contain it.
  assert.match(thumb, /position:\s*relative/);
  assert.match(thumb, /overflow:\s*hidden/);
});
