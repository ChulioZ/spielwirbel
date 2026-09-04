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
  counters: { rounds: 90, players: 120, games: 1400, sessions: 260 },
  games: {
    mostOwned: {
      title: 'Cascadia', image: 'https://cf.geekdo-images.com/x.png',
      url: 'https://boardgamegeek.com/boardgame/295947', shelves: 42,
    },
    playedWeek: { title: 'Ark Nova', image: null, url: null, plays: 9 },
    bestRated: { title: 'Wingspan', image: null, url: null, score: 4.6, ratings: 88 },
  },
};

// Boot the app with `fetch` answering one canned response for /api/stats/public,
// and one for the /api/config probe that gates the demo CTA. `cfg` is what
// landingRevealOperatorClaims() sees — `{}` is an instance with the demo off.
function bootWith(t, answer, cfg = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/stats/public')) return answer();
    // The operator/demo gate's probe, shared by the landing page and the
    // /entdecken CTA (#786) — both go through landingRevealOperatorClaims().
    if (String(url).startsWith('/api/config')) return { ok: true, json: async () => cfg };
    // Anything else a booted view reaches for is a bug in the spec.
    throw new Error(`unexpected fetch: ${url}`);
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  return dom;
}

// landingRevealOperatorClaims() reveals on a `.then`, so the CTA's demo block is
// still hidden when the view's own promise resolves. One macrotask is enough.
const settle = () => new Promise((r) => setTimeout(r, 0));

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
  /* The Spielwirbel-Score, and the copy must not call it an average (#914) —
     „von 5" is what it used to say, and the podium is the one surface a
     logged-out visitor meets the number on. It follows the reader's notation
     too: German writes 4,6, and a raw number interpolates as '4.6'. */
  const rated = [...dom.document.querySelectorAll('.stats-card__value')]
    .map((n) => n.textContent).find((x) => x.includes('88'));
  assert.match(rated, /^Score 4,6 — 88 Bewertungen$/);
  // Exactly the three the payload carried — the two absent metrics render no
  // card at all, rather than an empty or zeroed one.
  assert.equal(dom.document.querySelectorAll('.stats-card').length, 3);
  assert.equal(dom.document.querySelector('.empty-note'), null);
});

/* The ⓘ is on the podium for one reason the in-round ones do not have: this is
   where somebody who has never used the app meets the score. So it is asserted
   per SURFACE rather than once — the landing page is the surface that matters
   most and the one a spec is least likely to reach for. */
test('the bestRated podium carries the score ⓘ, and only that podium does', async (t) => {
  const dom = bootWith(t, ok(FULL));
  await dom.call('showEntdecken');

  const infos = dom.document.querySelectorAll('.stats-card [data-info-topic]');
  assert.equal(infos.length, 1, 'one ⓘ per screen, beside the primary occurrence — not one per podium');
  assert.equal(infos[0].dataset.infoTopic, 'score');
  const card = infos[0].closest('.stats-card');
  assert.equal(card.querySelector('.stats-card__title').textContent, 'Wingspan');
  /* On the LABEL, not beside the number — a placement decision with a measured
     reason (views-stats.js): the value line leaves no room for a 28px control at
     1100px, so beside the number it wraps and, because the cards are a grid,
     costs EVERY card 28px of height. On the label the cards grow by 7px, which
     is just the control's own height. jsdom applies no stylesheet and so cannot
     see the wrap; this pins the placement the browser check settled on. */
  assert.ok(infos[0].closest('.stats-card__label'), 'the ⓘ moved off the card label');
});

test('the ⓘ opens the score sheet on the LOGGED-OUT landing page, and closes again', async (t) => {
  const dom = bootWith(t, ok(FULL));
  await dom.call('showLanding');
  await new Promise((r) => setTimeout(r, 0));

  const btn = dom.document.querySelector('#landingStats [data-info-topic="score"]');
  assert.ok(btn, 'the landing podium carries no ⓘ');
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  const sheet = dom.document.querySelector('.sheet[role="dialog"]');
  assert.ok(sheet, 'the sheet did not open');
  // Wired through openSheet, so it is a real modal rather than a bare div.
  assert.equal(sheet.getAttribute('aria-modal'), 'true');
  assert.match(sheet.textContent, /Spielwirbel-Score/);

  sheet.querySelector('.sheet__close').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(dom.document.querySelector('.sheet[role="dialog"]'), null, 'the sheet did not close');
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
        title: 'Altlast', shelves: 3, url: null,
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

/* --------------------- the logged-out CTA on /entdecken --------------------- */

/*
 * The screen is published in order to be SHARED with people who have no account
 * (#564) — and until #786 it gave exactly that audience nowhere to go. A
 * logged-out visitor is on the auth-screen chrome, which hides the top bar's
 * home button, context and feedback, and the screen deliberately carries no back
 * control; so someone arriving from a shared link could read the stats and then
 * only edit the URL.
 *
 * The demo assertions double as the pin on a SHARED interface: the CTA reuses
 * landingRevealOperatorClaims() rather than fetching /api/config a second time,
 * and that helper addresses the two buttons by the ids `#landingDemo` and
 * `#landingRegister`. Rename those in the helper and the *reveal* still works
 * (it keys off `[data-demo-only]`), but the demo silently stops being promoted
 * over registering and a returning visitor is told to start a demo they already
 * hold — measured: exactly the two tests below go red, and the hidden-when-off
 * one correctly stays green.
 */

test('a logged-out visitor gets a CTA offering register and login', async (t) => {
  const dom = bootWith(t, ok(FULL));
  await dom.call('showEntdecken');
  await settle();

  const cta = dom.document.querySelector('.stats-cta');
  assert.ok(cta, 'the CTA is rendered');
  assert.ok(cta.querySelector('#landingRegister'));
  assert.ok(cta.querySelector('#landingLogin'));
  // The screen title is the page h1, so the CTA heading is one level down.
  assert.equal(cta.querySelector('.landing-section__title').tagName, 'H2');
  assert.equal(dom.document.querySelectorAll('h1').length, 1);
});

test('the CTA buttons reach the register and login screens', async (t) => {
  const dom = bootWith(t, ok(FULL));
  const seen = [];
  dom.set('showRegister', () => seen.push('register'));
  dom.set('showLogin', () => seen.push('login'));
  await dom.call('showEntdecken');
  await settle();

  dom.document.querySelector('#landingRegister').click();
  dom.document.querySelector('#landingLogin').click();
  assert.deepEqual(seen, ['register', 'login']);
});

test('the CTA renders in the EMPTY state too', async (t) => {
  // The state where a visitor most needs somewhere to go: an instance with
  // nothing to publish still has an app to offer.
  const dom = bootWith(t, notFound);
  await dom.call('showEntdecken');
  await settle();

  assert.ok(dom.document.querySelector('.empty-note'));
  assert.ok(dom.document.querySelector('.stats-cta'));
});

test('a LOGGED-IN visitor sees no CTA — the screen is unchanged for them', async (t) => {
  const dom = bootWith(t, ok(FULL));
  dom.set('isLoggedIn', () => true);
  await dom.call('showEntdecken');
  await settle();

  assert.equal(dom.document.querySelector('.stats-cta'), null);
});

test('an instance running without accounts gets no CTA either', async (t) => {
  // Nothing to register for, and it is the same expression authScreen() is
  // already given — one `loggedOut` const, not two evaluations that can drift.
  const dom = bootWith(t, ok(FULL));
  dom.set('accountsActive', () => false);
  await dom.call('showEntdecken');
  await settle();

  assert.equal(dom.document.querySelector('.stats-cta'), null);
});

test('the demo block stays hidden on an instance whose demo is off', async (t) => {
  // cfg.footer set but cfg.demo unset: the legal surfaces are configured and the
  // demo is not, which is a perfectly ordinary instance.
  const dom = bootWith(t, ok(FULL), { footer: true });
  await dom.call('showEntdecken');
  await settle();

  const demo = dom.document.querySelector('.stats-cta .landing-hero__demo');
  assert.ok(demo, 'the block is in the DOM');
  assert.equal(demo.hidden, true, 'a demo button that 404s is worse than no button');
  // And registering keeps the primary slot it shipped with.
  assert.ok(dom.document.querySelector('#landingRegister').classList.contains('btn--primary'));
});

test('the demo leads when the instance has it on, and register is demoted', async (t) => {
  const dom = bootWith(t, ok(FULL), { demo: true });
  await dom.call('showEntdecken');
  await settle();

  const demo = dom.document.querySelector('.stats-cta .landing-hero__demo');
  assert.equal(demo.hidden, false);
  const demoBtn = dom.document.querySelector('#landingDemo');
  assert.ok(demoBtn.classList.contains('btn--primary'), 'the demo is THE primary action');
  assert.ok(!dom.document.querySelector('#landingRegister').classList.contains('btn--primary'));
  assert.equal(demoBtn.textContent, 'Ohne Anmeldung ausprobieren');
  // The note rides the wrapper, so it is revealed with it rather than separately.
  assert.ok(demo.querySelector('.landing-hero__demo-note'));
});

test('a visitor already holding a live demo is offered to RESUME it', async (t) => {
  const dom = bootWith(t, ok(FULL), { demo: true });
  dom.set('getDemoToken', () => 'a-live-demo-token');
  await dom.call('showEntdecken');
  await settle();

  // Minting a second demo strands the first one's slot for its whole TTL (#502),
  // so the label has to say resume rather than read as starting over.
  assert.equal(dom.document.querySelector('#landingDemo').textContent, 'Demo fortsetzen');
});

test('the demo button starts the demo, passing itself as the busy control', async (t) => {
  const dom = bootWith(t, ok(FULL), { demo: true });
  const started = [];
  dom.set('startDemo', (busy) => { started.push(busy && busy.id); });
  await dom.call('showEntdecken');
  await settle();

  // Passing the button is what disables it — without it a second click mints a
  // second demo tenant and abandons the first.
  dom.document.querySelector('#landingDemo').click();
  assert.deepEqual(started, ['landingDemo']);
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

/* #842 replaced the one-line teaser strip with a panel that draws REAL podium
   cards. The point of the rebuild is that the tile now says something about the
   instance instead of merely linking to somewhere that does, so the cards are
   what is pinned — a panel that rendered only a heading and a link would be the
   old teaser wearing a new class name, and would pass a mere presence check. */
test('the home Entdecken panel renders podium cards from statsCard() and links into /entdecken', async (t) => {
  const dom = bootWith(t, ok(FULL));
  dom.set('isLoggedIn', () => true);
  // fetchRoundList is a top-level const (unstubbable, see dom.js); api() is the
  // function declaration underneath it.
  dom.set('api', async () => []);
  await dom.call('showHome');
  await new Promise((r) => setTimeout(r, 0));

  const panel = dom.document.querySelector('#homeStats');
  assert.ok(panel, 'the Entdecken panel is absent when there is something behind it');

  const cards = panel.querySelectorAll('.stats-card');
  assert.ok(cards.length >= 2, `the panel drew ${cards.length} podium cards — the strip is back`);
  assert.ok(cards.length <= 3, `the panel drew ${cards.length} cards; the dashboard tile takes the first few`);
  // The cover art is the visible difference from the old strip, and it comes
  // from the ONE renderer (statsCard) rather than a second copy of the markup.
  assert.ok(panel.querySelector('.stats-card__cover'), 'the podium cards render no cover art');
  assert.ok(panel.querySelector('.stats-card__title'), 'the podium cards render no title');

  /* The provenance note travels WITH the claim: the podiums cover only
     provider-linked games (lib/public-stats.js), so a tile that shows the cards
     without it is a claim about every shelf. */
  assert.ok(panel.querySelector('.stats-note'), 'the podium cards render without the provenance note');

  // A real href, so Cmd-click and "copy link address" work
  // (.claude/rules/in-app-nav-links.md).
  const all = panel.querySelector('a.link-btn');
  assert.ok(all, 'the panel has no "see all" link');
  assert.equal(all.getAttribute('href'), '/entdecken');
});

test('the home Entdecken panel is removed when there is nothing behind it', async (t) => {
  const dom = bootWith(t, notFound);
  dom.set('isLoggedIn', () => true);
  // fetchRoundList is a top-level const (unstubbable, see dom.js); api() is the
  // function declaration underneath it.
  dom.set('api', async () => []);
  await dom.call('showHome');
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(dom.document.querySelector('.stats-card'), null);
  assert.equal(dom.document.querySelector('.stats-note'), null, 'an orphaned provenance note survived');
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
  // Counted PER ENDPOINT rather than in total: since #786 the logged-out
  // /entdecken also mounts the CTA, whose demo gate probes /api/config. A
  // blanket counter would fold that unrelated request into this claim and
  // report a second stats fetch that never happened.
  const calls = {};
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  dom.set('fetch', async (url) => {
    const key = String(url).split('?')[0];
    calls[key] = (calls[key] || 0) + 1;
    return { ok: true, json: async () => FULL };
  });

  await dom.call('showEntdecken');
  await dom.call('showEntdecken');
  await dom.run('loadPublicStats()');
  // Three surfaces on one page must not mean three requests for one payload.
  assert.equal(calls['/api/stats/public'], 1);
});
