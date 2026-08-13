'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

/*
 * The three surfaces of the public statistics block (#564), RUN rather than
 * regex-matched — see .claude/rules/testing-views-under-jsdom.md. Never
 * `require('../public/js/views-stats.js')`: pulling a view into the coverage
 * report is an ~11-point drop and a red `coverage:ci` with every test green.
 *
 * What is under test on this side is the DEFAULT: with the feature off, or with
 * a payload that cleared no threshold, the surfaces must render NOTHING — no
 * heading, no empty container, no stray gap. That is the assertion the server
 * side cannot make.
 */

// A payload shaped like a healthy instance's.
const FULL = {
  generatedAt: '2026-08-13T12:00:00.000Z',
  counters: { accounts: 120, rounds: 90, games: 1400, sessions: 260 },
  games: {
    mostOwned: {
      title: 'Cascadia', image: 'https://cf.geekdo-images.com/x.png',
      url: 'https://boardgamegeek.com/boardgame/295947', owners: 42,
    },
    playedWeek: { title: 'Ark Nova', image: null, url: null, plays: 9 },
    bestRated: { title: 'Wingspan', image: null, url: null, average: 4.6, ratings: 88 },
  },
};

// Boot the app with `fetch` answering one canned response for /api/stats/public.
function bootWith(t, answer) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/stats/public')) return answer();
    // Anything else a booted view reaches for is a bug in the spec.
    throw new Error(`unexpected fetch: ${url}`);
  });
  // The landing page's own config probe goes through the same stub.
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const ok = (body) => () => ({ ok: true, json: async () => body });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });

/* --------------------------------- /entdecken ------------------------------- */

test('/entdecken renders the counters and one card per qualifying metric', async (t) => {
  const dom = bootWith(t, ok(FULL));
  await dom.call('showEntdecken');

  const counters = [...dom.document.querySelectorAll('.stats-counter__num')].map((n) => n.textContent);
  assert.equal(counters.length, 4);
  // Formatted for the locale, so a big number reads as a number.
  assert.ok(counters.includes('1.400'), `expected a de-formatted 1400, got ${counters.join(', ')}`);

  const titles = [...dom.document.querySelectorAll('.stats-card__title')].map((n) => n.textContent);
  assert.deepEqual(titles, ['Cascadia', 'Ark Nova', 'Wingspan']);
  // Exactly the three the payload carried — the two absent metrics render no
  // card at all, rather than an empty or zeroed one.
  assert.equal(dom.document.querySelectorAll('.stats-card').length, 3);
  assert.equal(dom.document.querySelector('.empty-note'), null);
});

test('a linked game gets an outbound provider link; an unlinked one stays text', async (t) => {
  const dom = bootWith(t, ok(FULL));
  await dom.call('showEntdecken');

  const linked = dom.document.querySelector('a.stats-card__title');
  assert.equal(linked.getAttribute('href'), 'https://boardgamegeek.com/boardgame/295947');
  assert.equal(linked.getAttribute('rel'), 'noopener noreferrer');
  // Ark Nova carried no url, so its title must not be an anchor.
  const arkNova = [...dom.document.querySelectorAll('.stats-card__title')]
    .find((n) => n.textContent === 'Ark Nova');
  assert.equal(arkNova.tagName, 'SPAN');
});

test('a cover goes through coverUrl, and is left decorative', async (t) => {
  /*
   * The fixture deliberately uses a PLAYSTATION host, not a BGG one.
   * `COVER_RESIZERS` (public/js/cover-size.js) only knows the two retired
   * storefront hosts — BGG's stored URL is already a `fit-in/200x150` thumbnail
   * (.claude/rules/provider-cover-sizing.md), so `coverUrl()` returns it
   * BYTE-IDENTICAL. A BGG fixture therefore cannot tell "the renderer calls
   * coverUrl" from "the renderer interpolates entry.image raw" — it passes
   * either way. Only a resizer host discriminates.
   */
  const dom = bootWith(t, ok({
    generatedAt: 'x',
    games: {
      mostOwned: {
        title: 'Altlast', owners: 3, url: null,
        image: 'https://image.api.playstation.com/vulcan/master.png',
      },
    },
  }));
  await dom.call('showEntdecken');
  const img = dom.document.querySelector('.stats-card__cover');
  // A master here is 3840×2160 = ~31 MB decoded, so the rewrite is not cosmetic.
  assert.match(img.getAttribute('src'), /^https:\/\/image\.api\.playstation\.com\/vulcan\/master\.png\?w=\d+$/);
  // The title beside it is the accessible name, so the image adds nothing.
  assert.equal(img.getAttribute('alt'), '');
});

test('/entdecken says so honestly when there is nothing to show', async (t) => {
  const dom = bootWith(t, notFound);
  await dom.call('showEntdecken');
  // Arriving here deliberately and finding a blank page reads as broken, so
  // this is the ONE surface with an empty state.
  assert.ok(dom.document.querySelector('.empty-note'));
  assert.equal(dom.document.querySelector('.stats-block'), null);
  assert.equal(dom.document.querySelector('.stats-counter'), null);
});

test('a payload that cleared no threshold renders no block either', async (t) => {
  // The feature is ON — the endpoint answered 200 — but every metric is still
  // below its minimum, so both blocks are absent from the payload.
  const dom = bootWith(t, ok({ generatedAt: '2026-08-13T12:00:00.000Z' }));
  await dom.call('showEntdecken');
  assert.ok(dom.document.querySelector('.empty-note'));
  assert.equal(dom.document.querySelector('.stats-block'), null);
});

test('the podium note is rendered only alongside actual podiums', async (t) => {
  const withCounters = bootWith(t, ok({ generatedAt: 'x', counters: { rounds: 90 } }));
  await withCounters.call('showEntdecken');
  // The note explains that the CARDS cover only provider-linked games; with no
  // cards it would be a caveat about nothing.
  assert.equal(withCounters.document.querySelector('.stats-note'), null);
  assert.ok(withCounters.document.querySelector('.stats-counter'));
});

/* ------------------------------ the landing page ---------------------------- */

test('the landing block appears only when there is something to publish', async (t) => {
  const dom = bootWith(t, ok(FULL));
  await dom.call('showLanding');
  // mountLandingStats is not awaited by the view, so let its promise settle.
  await new Promise((r) => setTimeout(r, 0));

  const section = dom.document.querySelector('#landingStats');
  assert.ok(section, 'the placeholder stayed and was filled');
  assert.ok(section.querySelector('.landing-section__title'), 'it got its heading');
  assert.ok(section.querySelector('.stats-cards'));
});

test('the landing placeholder is REMOVED when the feature is off', async (t) => {
  const dom = bootWith(t, notFound);
  await dom.call('showLanding');
  await new Promise((r) => setTimeout(r, 0));

  // Removed outright rather than left empty: an empty section still occupies
  // the landing page's section gap, which reads as a rendering bug.
  assert.equal(dom.document.querySelector('#landingStats'), null);
  assert.equal(dom.document.querySelector('.stats-block'), null);
  // And no orphaned heading anywhere on the page.
  const headings = [...dom.document.querySelectorAll('.landing-section__title')].map((n) => n.textContent);
  assert.ok(!headings.some((h) => /Spielwirbel$/.test(h) && h.startsWith('Gerade')), headings.join(' | '));
});

/* ------------------------------- the home hub ------------------------------- */

test('the home teaser links into /entdecken as a real anchor', async (t) => {
  const dom = bootWith(t, ok(FULL));
  dom.set('isLoggedIn', () => true);
  // fetchRoundList is a top-level const (unstubbable, see dom.js); api() is the
  // function declaration underneath it.
  dom.set('api', async () => []);
  await dom.call('showHome');
  await new Promise((r) => setTimeout(r, 0));

  const teaser = dom.document.querySelector('.stats-teaser');
  assert.ok(teaser, 'the teaser is present when there is something behind it');
  // A real href, so Cmd-click and "copy link address" work
  // (.claude/rules/in-app-nav-links.md).
  assert.equal(teaser.tagName, 'A');
  assert.equal(teaser.getAttribute('href'), '/entdecken');
});

test('the home teaser is removed when there is nothing behind it', async (t) => {
  const dom = bootWith(t, notFound);
  dom.set('isLoggedIn', () => true);
  // fetchRoundList is a top-level const (unstubbable, see dom.js); api() is the
  // function declaration underneath it.
  dom.set('api', async () => []);
  await dom.call('showHome');
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(dom.document.querySelector('.stats-teaser'), null);
  assert.equal(dom.document.querySelector('#homeStats'), null, 'the placeholder went too');
});

/* --------------------------- the cold-loaded deep link ---------------------- */

/*
 * The screen is published FOR people with no account, so a cold-loaded
 * /entdecken must render it rather than being parked in `pendingPath` and
 * swapped for the login wall — the carve-out /vote/:token already has.
 *
 * Found in a browser, not here: every spec above calls `showEntdecken()`
 * directly, so none of them goes anywhere near bootApp's routing, and the deep
 * link landed on the login screen with the whole suite green.
 */
test('a logged-out visitor cold-loading /entdecken gets the screen, not the login wall', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  dom.set('initAccounts', async () => 'ok');

  const routed = [];
  dom.set('routeTo', (p) => { routed.push(p); });
  dom.run("history.replaceState({}, '', '/entdecken')");
  await dom.call('bootApp');

  assert.deepEqual(routed, ['/entdecken']);
});

test('an ordinary deep link still goes to login — the carve-out is not a hole', async (t) => {
  // The control: without it the assertion above is satisfied by a bootApp that
  // routes every path straight through and never asks anyone to log in.
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  dom.set('initAccounts', async () => 'ok');

  const routed = [];
  dom.set('routeTo', (p) => { routed.push(p); });
  dom.run("history.replaceState({}, '', '/round/abc')");
  await dom.call('bootApp');

  assert.deepEqual(routed, ['/login']);
});

/* --------------------------------- the fetch -------------------------------- */

test('the payload is fetched ONCE for the whole page load', async (t) => {
  let calls = 0;
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  dom.set('fetch', async () => { calls += 1; return { ok: true, json: async () => FULL }; });

  await dom.call('showEntdecken');
  await dom.call('showEntdecken');
  await dom.run('loadPublicStats()');
  // Three surfaces on one page must not mean three requests for one payload.
  assert.equal(calls, 1);
});
