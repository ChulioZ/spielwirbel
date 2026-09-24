/* Spielwirbel – logged-out landing page (issue #322): the marketing "front door"
   a cold visitor sees at GET / in accounts mode, before being asked to register.
   bootApp() (account.js) routes here for a logged-out accounts-mode visitor on
   the "/" path; every other path (deep links, the /v and /r mail links)
   still goes straight to the auth screens.

   Rebuilt in #1090 around ONE offer. Before it the page made two — the hero led
   with the demo while the closing block led with "Registrieren" — and rendered
   every chapter at the same weight in the 900px reading measure, so on a phone
   645px of copy and three same-size buttons came before any picture. The page
   now states the offer once (in one renderer, on three surfaces), moves
   "Anmelden" out of the hero into the top bar, and shows the loop as three phone
   screenshots instead of describing onboarding in prose.

   Part of the frontend's shared global scope. Loads after core.js and
   account.js (showLogin/showRegister), before router.js — see index.html.
   Cross-file names (showRegister/showLogin) are referenced only inside click
   handlers, i.e. at call time, per
   .claude/rules/frontend-script-load-order.md. */

'use strict';

// The claims strip: [icon class, i18n key prefix]. Every icon is declared in the
// bundled tabler subset (public/fonts/tabler-icons.css) — an undeclared class
// renders NOTHING, silently (.claude/rules/tabler-icon-codepoints.md).
//
// #483 replaced the per-round themes card with `noAccounts`: "nobody but the
// round owner needs an account" is one of the app's defining design choices and
// the copy never said it, while a colour theme is the most cosmetic thing here.
// Since #1090 each is an icon + title + ONE line rather than a card holding a
// paragraph — the vote card carried four sentences and its neighbours one, which
// is what made the first row of that grid 325px tall against the second's 209.
const LANDING_FEATURES = [
  ['ti-cards', 'landing.features.shelf'],
  ['ti-tornado', 'landing.features.vote'],
  ['ti-trophy', 'landing.features.ratings'],
  ['ti-history', 'landing.features.chronicle'],
  ['ti-users', 'landing.features.noAccounts'],
  ['ti-rocket', 'landing.features.pwa'],
];

// The walkthrough (#1090): [shot name, copy key prefix, alt key]. It replaced
// "In drei Schritten los", whose three steps were ONBOARDING (account → round →
// session) while the single picture beside them showed the vote — so the section
// illustrated something other than what it listed. These three are the loop
// itself, one picture each, in the order it runs.
const LANDING_WALK = [
  ['shelfPhone', 'landing.walk.shelf', 'landing.shot.shelfAlt'],
  ['vote', 'landing.walk.whirl', 'landing.shot.voteAlt'],
  ['result', 'landing.walk.result', 'landing.shot.resultAlt'],
];

// Real product screenshots (#438). The hero used to show six abstract
// coverPlaceholder() gradients, which told a visitor nothing about the app they
// were being asked to register for — "man erkennt nicht, wie es funktioniert".
//
// Committed static assets, generated once with headless Chrome against a
// throwaway seeded dataset, exactly like public/icons/og-image.png — there is no
// image tooling in this repo and no build step here (see the regeneration recipe
// in .claude/rules/landing-product-screenshots.md). Three things about them are
// load-bearing:
//
//  - The walkthrough's three are PHONE shots since #1090. The set used to carry
//    a 1280-wide desktop shelf capture for the hero's wide branch; at the
//    660–800px the two-column hero gives it, its tile labels shrink to ~9px, so
//    that capture was retired along with its <picture> and breakpoint.
//  - `desktop` (#1199) is the one wide capture, and it is back for a reason the
//    retired one never served: with only phones on the page, the app read as
//    phone-only (operator decision, 2026-09-24). It does NOT go back into the
//    hero column — that was #1090's problem, not the capture's. It gets a band of
//    its own under the hero at close to the page's full width (max 1200 CSS px
//    for a 1440-wide layout, so app text lands at ~11–12px), the size at which a
//    desktop screenshot is legible at all. On a phone it simply scales down:
//    there it is not read, it is the evidence that a desktop layout exists.
//  - Every declared width/height is the asset's REAL pixel size, so the hero
//    reserves its box before the image lands (no layout shift above the fold).
//    test/landing-shots.test.js reads the dimensions back out of the files.
//  - The games in them carry NO cover art: their titles are invented and their
//    covers are the app's own deterministic gradients. A provider's cover art in
//    a committed marketing image would be re-hosting someone else's copyrighted
//    artwork — the exact thing .claude/rules/provider-cover-hotlinking.md avoids.
//
// One set per shipped locale (#457), keyed by locale code. Everything else on
// this page switches language — headline, claims, walkthrough, chips — so a
// German screenshot under English copy was the one part of the page that stayed
// half-translated, on the page whose whole job is "what is this and how does it
// work". Each set is shot against its own seed, so the *content* is localized
// too (round name, member names, game titles), not just the app's chrome; the
// seeds live in scripts/landing-seed-data.js.
//
// The dimensions stay PER ASSET rather than per family: they are asserted
// against the real files, so re-shooting one locale may legitimately change one
// height (a title that wraps to two lines moves the crop) without touching the
// other.
const LANDING_SHOTS = {
  en: {
    shelfPhone: { src: '/img/landing-shelf-phone.en.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.en.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.en.webp', w: 624, h: 1384 },
    desktop: { src: '/img/landing-desktop.en.webp', w: 1800, h: 1125 },
  },
  de: {
    shelfPhone: { src: '/img/landing-shelf-phone.de.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.de.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.de.webp', w: 624, h: 1384 },
    desktop: { src: '/img/landing-desktop.de.webp', w: 1800, h: 1125 },
  },
  es: {
    shelfPhone: { src: '/img/landing-shelf-phone.es.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.es.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.es.webp', w: 624, h: 1446 },
    desktop: { src: '/img/landing-desktop.es.webp', w: 1800, h: 1125 },
  },
  fr: {
    shelfPhone: { src: '/img/landing-shelf-phone.fr.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.fr.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.fr.webp', w: 624, h: 1446 },
    desktop: { src: '/img/landing-desktop.fr.webp', w: 1800, h: 1125 },
  },
  it: {
    shelfPhone: { src: '/img/landing-shelf-phone.it.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.it.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.it.webp', w: 624, h: 1446 },
    desktop: { src: '/img/landing-desktop.it.webp', w: 1800, h: 1125 },
  },
  nl: {
    shelfPhone: { src: '/img/landing-shelf-phone.nl.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.nl.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.nl.webp', w: 624, h: 1443 },
    desktop: { src: '/img/landing-desktop.nl.webp', w: 1800, h: 1125 },
  },
  pt: {
    shelfPhone: { src: '/img/landing-shelf-phone.pt.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.pt.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.pt.webp', w: 624, h: 1384 },
    desktop: { src: '/img/landing-desktop.pt.webp', w: 1800, h: 1125 },
  },
  fi: {
    shelfPhone: { src: '/img/landing-shelf-phone.fi.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.fi.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.fi.webp', w: 624, h: 1446 },
    desktop: { src: '/img/landing-desktop.fi.webp', w: 1800, h: 1125 },
  },
  ko: {
    shelfPhone: { src: '/img/landing-shelf-phone.ko.webp', w: 624, h: 1246 },
    vote: { src: '/img/landing-vote.ko.webp', w: 624, h: 1152 },
    result: { src: '/img/landing-result.ko.webp', w: 624, h: 1346 },
    desktop: { src: '/img/landing-desktop.ko.webp', w: 1800, h: 1125 },
  },
};

// Der Tisch's set (#1199), shot by `scripts/capture-landing-shots.js
// --design=tisch` over the same per-locale seed, into public/img/tisch/. Same
// four shots and the same widths; the heights are the design's own —
// its vote card stacks five full-width faces, so that crop is derived from the
// card rather than held at Klassisch's fixed point (the script says why).
const LANDING_SHOTS_TISCH = {
  en: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.en.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.en.webp', w: 624, h: 1330 },
    result: { src: '/img/tisch/landing-result.en.webp', w: 624, h: 1578 },
    desktop: { src: '/img/tisch/landing-desktop.en.webp', w: 1800, h: 1126 },
  },
  de: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.de.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.de.webp', w: 624, h: 1309 },
    result: { src: '/img/tisch/landing-result.de.webp', w: 624, h: 1717 },
    desktop: { src: '/img/tisch/landing-desktop.de.webp', w: 1800, h: 1165 },
  },
  es: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.es.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.es.webp', w: 624, h: 1330 },
    result: { src: '/img/tisch/landing-result.es.webp', w: 624, h: 1640 },
    desktop: { src: '/img/tisch/landing-desktop.es.webp', w: 1800, h: 1126 },
  },
  fr: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.fr.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.fr.webp', w: 624, h: 1330 },
    result: { src: '/img/tisch/landing-result.fr.webp', w: 624, h: 1669 },
    desktop: { src: '/img/tisch/landing-desktop.fr.webp', w: 1800, h: 1175 },
  },
  it: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.it.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.it.webp', w: 624, h: 1330 },
    result: { src: '/img/tisch/landing-result.it.webp', w: 624, h: 1669 },
    desktop: { src: '/img/tisch/landing-desktop.it.webp', w: 1800, h: 1175 },
  },
  nl: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.nl.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.nl.webp', w: 624, h: 1330 },
    result: { src: '/img/tisch/landing-result.nl.webp', w: 624, h: 1699 },
    desktop: { src: '/img/tisch/landing-desktop.nl.webp', w: 1800, h: 1125 },
  },
  pt: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.pt.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.pt.webp', w: 624, h: 1330 },
    result: { src: '/img/tisch/landing-result.pt.webp', w: 624, h: 1669 },
    desktop: { src: '/img/tisch/landing-desktop.pt.webp', w: 1800, h: 1165 },
  },
  fi: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.fi.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.fi.webp', w: 624, h: 1330 },
    result: { src: '/img/tisch/landing-result.fi.webp', w: 624, h: 1640 },
    desktop: { src: '/img/tisch/landing-desktop.fi.webp', w: 1800, h: 1165 },
  },
  ko: {
    shelfPhone: { src: '/img/tisch/landing-shelf-phone.ko.webp', w: 624, h: 1246 },
    vote: { src: '/img/tisch/landing-vote.ko.webp', w: 624, h: 1309 },
    result: { src: '/img/tisch/landing-result.ko.webp', w: 624, h: 1578 },
    desktop: { src: '/img/tisch/landing-desktop.ko.webp', w: 1800, h: 1125 },
  },
};

// Which set the page shows: the design the landing is WEARING, which is the
// face (FACE_DESIGN) for every logged-out visitor — so production keeps
// Klassisch's pictures until the flip (#1202) moves the face, and Der Tisch's
// appear the moment it does, with no second edit here. A design without a set
// of its own shows Klassisch's rather than nothing.
const LANDING_SHOT_SETS = { klassisch: LANDING_SHOTS, tisch: LANDING_SHOTS_TISCH };

function landingShotSet() {
  const worn = typeof activeDesign === 'function' ? activeDesign().id : FACE_DESIGN;
  return LANDING_SHOT_SETS[worn] || LANDING_SHOTS;
}

// The set for the active locale, resolved at RENDER time — showLanding() sets
// currentView, and the top-bar picker re-runs it after setLocale(), so reading
// getLocale() here is the whole language-switch mechanism.
//
// Falls back to the first shipped locale rather than rendering a broken src,
// matching how t() falls back: a locale that ships a language file but no
// screenshots yet shows somebody else's product, which is a great deal better
// than an empty box in the hero.
function landingShots() {
  const set = landingShotSet();
  return set[getLocale()] || set[SUPPORTED_LOCALES[0]];
}

// The public repository, linked from the "code out in the open" trust chip
// (#483). The chip claims the code can be inspected, so it has to be reachable
// — an unverifiable claim is worth less than no claim. Hardcoded like the
// canonical origin in index.html: this is a fact of this deployment, and a fork
// edits it here rather than through a templating layer.
//
// Deliberately says nothing about the LICENCE: the repo is source-available
// (PolyForm Noncommercial), not open source, and that term must never appear in
// user-facing copy. The chip is phrased as a benefit, so it needs no term at all.
const LANDING_REPO_URL = 'https://github.com/ChulioZ/spielwirbel';

// Memoized /api/config, used to gate the operator-only trust claim (below). The
// same unauthenticated endpoint initFooter() reads; cached so a language-switch
// re-render doesn't refetch.
let landingCfg = null;

/* ------------------------------------------------------------- the offer ---- */

// THE offer, rendered by every surface that makes it: the hero, the closing
// block, and /entdecken's logged-out CTA (renderEntdeckenCta, views-stats.js).
// One renderer rather than three copies, because the page's whole defect in
// #1090 was that its two copies had drifted into two different offers — the hero
// led with the demo and the close led with registering, so a visitor who
// scrolled was asked for two different things.
//
// Addressed by CLASS, not by id: the landing page renders this twice, and ids
// may not repeat. `landingRevealOperatorClaims` reveals every [data-demo-only]
// and hides every .landing-offer__register, so an instance whose /api/config
// reports no demo keeps a single "Kostenlos registrieren" primary and renders no
// dead demo element at all.
//
// `trust` adds the claims row; only the hero passes it. The four claims used to
// be their own chapter ("Fair und datensparsam") AND appear in the footer AND in
// the demo note — three statements of the same thing on one page.
function renderLandingOffer(opts) {
  const trust = !!(opts && opts.trust);
  // (No backticks in the comments inside this literal: it is a template literal.)
  return `<div class="landing-offer">
        <button class="btn btn--primary btn--lg landing-offer__demo" type="button" data-demo-only hidden>${esc(t('landing.hero.ctaDemo'))}</button>
        <p class="landing-offer__note muted" data-demo-only hidden>${esc(t('landing.hero.demoNote'))}</p>
        <p class="landing-offer__alt" data-demo-only hidden>${esc(t('landing.hero.or'))}
          <button class="link-btn landing-offer__register-link" type="button">${esc(t('landing.hero.registerLink'))}</button></p>
        <button class="btn btn--primary btn--lg landing-offer__register" type="button">${esc(t('landing.hero.ctaPrimary'))}</button>
        ${trust ? `<ul class="landing-offer__trust">
          <li class="landing-chip"><i class="ti ti-heart" aria-hidden="true"></i>${esc(t('landing.trust.free'))}</li>
          <li class="landing-chip"><i class="ti ti-eye-off" aria-hidden="true"></i>${esc(t('landing.trust.noTracking'))}</li>
          <li><a class="landing-chip landing-chip--link" href="${LANDING_REPO_URL}"
                 target="_blank" rel="noopener noreferrer"><i class="ti ti-code" aria-hidden="true"></i>${esc(t('landing.trust.source'))}</a></li>
          <li class="landing-chip" data-operator-only hidden><i class="ti ti-shield" aria-hidden="true"></i>${esc(t('landing.trust.eu'))}</li>
        </ul>` : ''}
      </div>`;
}

// Wire every offer block inside `root`. startDemo/showRegister live in
// account.js, which loads BEFORE this file — and both are referenced inside
// handlers either way, so they resolve at click time
// (.claude/rules/frontend-script-load-order.md).
function wireLandingOffer(root) {
  root.querySelectorAll('.landing-offer__demo').forEach((btn) => {
    btn.addEventListener('click', () => startDemo(btn));
  });
  root.querySelectorAll('.landing-offer__register, .landing-offer__register-link').forEach((btn) => {
    btn.addEventListener('click', () => showRegister());
  });
}

// The EU-hosting claim is only true on the operator's configured public instance
// (a self-hoster on a US VPS must not publish it). Gate it on the SAME cfg.footer
// flag that reveals the legal footer links (mail + Impressum configured) — the
// element ships hidden and is revealed only when that flag is set. Degrades like
// initFooter(): any error leaves it hidden.
function landingRevealOperatorClaims(root) {
  const apply = (cfg) => {
    if (cfg && cfg.footer) {
      root.querySelectorAll('[data-operator-only]').forEach((el) => { el.hidden = false; });
    }
    // The demo CTA (#427), gated on its own flag rather than cfg.footer: an
    // instance can perfectly well have its legal surfaces configured and the
    // demo switched off, and a button that answers 404 is worse than no button.
    if (cfg && cfg.demo) {
      root.querySelectorAll('[data-demo-only]').forEach((el) => { el.hidden = false; });
      // With a demo the offer IS the demo, so the standalone register button
      // steps back to a link beside it ('.landing-offer__alt', revealed above).
      // Done here rather than in the markup so an instance without the demo
      // keeps its single primary CTA, byte-for-byte.
      root.querySelectorAll('.landing-offer__register').forEach((el) => { el.hidden = true; });
      // A visitor who already holds a live demo re-enters it rather than
      // minting a second (#502), so the CTA has to say so — "ausprobieren"
      // would read as starting over, which is exactly what it no longer does.
      // getDemoToken lives in account.js, which loads before this file.
      if (getDemoToken()) {
        root.querySelectorAll('.landing-offer__demo').forEach((el) => { el.textContent = t('landing.hero.ctaResume'); });
      }
    }
  };
  if (landingCfg) { apply(landingCfg); return; }
  fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => { if (cfg) landingCfg = cfg; apply(cfg); })
    .catch(() => {});
}

/* -------------------------------------------------------------- the view ---- */

// The landing view. Full-screen like the auth screens (authScreen(true) hides the
// top-bar home/context/feedback; the language picker stays), but scrollable
// multi-section marketing content rather than a single centred card. Sets
// currentView so a language switch re-renders it in place (core.js langPicker).
function showLanding() {
  currentView = showLanding;
  // The landing owns '/' (#501). Without this a deliberate logout would swap the
  // card while the address bar still named the round the user just left — the
  // bug would move rather than be fixed. Callers that must REPLACE the entry
  // they came from (a failed /demo deep link) go through routeTo() instead.
  syncUrl('/');
  authScreen(true);
  // authScreen() hides it on every screen, so the two that offer it turn it back
  // on afterwards (#1090). The hero has no login control any more: with the demo
  // as the single primary, a third button competing with it is exactly the
  // "two offers on one page" this rebuild removes — and a returning user is
  // looking for "Anmelden" in the chrome, not in the pitch.
  showLoginLink(true);
  setContext('');
  // The one screen that keeps the DEFAULT tab title rather than naming itself
  // (#522): this is the front door, and its title is the app's own pitch —
  // the same string the static <title> carries for crawlers. applyTabTitle()
  // rather than setDocTitle(), because that pitch is 'app.tabTitle', not the
  // bare brand a part-less setDocTitle() would produce.
  applyTabTitle();
  applyBackground(null);
  app.innerHTML = '';

  const claims = LANDING_FEATURES.map(([icon, key]) => `
      <li class="landing-claim">
        <span class="landing-claim__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
        <div>
          <h3 class="landing-claim__title">${esc(t(key + '.title'))}</h3>
          <p class="landing-claim__desc muted">${esc(t(key + '.desc'))}</p>
        </div>
      </li>`).join('');

  // Informative images, not decoration: each carries real alt text, so the page
  // still explains itself to a screen reader.
  const shots = landingShots();
  const walk = LANDING_WALK.map(([name, key, altKey], i) => `
      <li class="landing-walk__item">
        <img class="landing-shot" src="${shots[name].src}"
             width="${shots[name].w}" height="${shots[name].h}"
             alt="${esc(t(altKey))}" />
        <h3 class="landing-walk__title"><span class="landing-step__num">${i + 1}</span>${esc(t(key + '.title'))}</h3>
        <p class="landing-walk__desc muted">${esc(t(key + '.desc'))}</p>
      </li>`).join('');

  const view = h(`<div class="landing">
    <section class="landing-hero">
      <div class="landing-hero__text">
        <div class="landing-hero__brand">
          <i class="ti ti-tornado" aria-hidden="true"></i><span>${esc(t('app.title'))}</span>
        </div>
        <h1 class="landing-hero__title">${esc(t('landing.hero.title'))}</h1>
        <p class="landing-hero__sub">${esc(t('landing.hero.sub'))}</p>
        ${renderLandingOffer({ trust: true })}
      </div>
      <!-- EMPTY on purpose: renderLandingMoments() (landing-moments.js) fills it
           below with the app's own three moments, played once from the shipped
           components (#1091). It replaced a static shelf screenshot, which still
           opens the walkthrough further down — the hero now SHOWS the loop and
           the walkthrough explains it, rather than both doing the second thing.
           (No backticks in here: this comment is inside a template literal.) -->
      <div class="landing-hero__visual" id="landingMoments"></div>
    </section>

    <!-- The desktop band (#1199): the one wide capture, at close to the page's
         full width rather than in the hero column that retired its predecessor
         (#1090 - see LANDING_SHOTS). Lazy: on a phone it sits a screen below the
         fold, and on a desktop it is within the browser's lazy-load distance of
         the first viewport anyway, so it costs a desktop visitor nothing. The
         width/height reserve its box. (No backticks in here: this comment is
         inside a template literal.) -->
    <section class="landing-desktop">
      <figure class="landing-desktop__figure">
        <img class="landing-shot landing-desktop__shot" src="${shots.desktop.src}"
             width="${shots.desktop.w}" height="${shots.desktop.h}"
             alt="${esc(t('landing.desktop.alt'))}" loading="lazy" decoding="async" />
        <figcaption class="landing-desktop__caption">${esc(t('landing.desktop.caption'))}</figcaption>
      </figure>
    </section>

    <!-- The strip holds no focusable content, so below 720px — where it becomes
         a horizontal snap strip — it needs tabindex and a name of its own for a
         keyboard user to be able to scroll it at all (WCAG 2.1.1). -->
    <section class="landing-section">
      <h2 class="landing-section__title" id="landingWalkTitle">${esc(t('landing.walk.title'))}</h2>
      <ol class="landing-walk" tabindex="0" aria-labelledby="landingWalkTitle">${walk}</ol>
    </section>

    <section class="landing-section">
      <h2 class="landing-section__title">${esc(t('landing.features.title'))}</h2>
      <ul class="landing-claims">${claims}</ul>
    </section>

    <!-- The design band (#1198, T12.1). EMPTY here and filled by
         mountLandingDesigns below, which removes it outright when the instance
         offers fewer than two designs. styles.css keeps it display: none, so
         Klassisch renders exactly as before; a design that wants it (Der Tisch
         as the face) shows it from its own stylesheet. (No backticks in here:
         this comment is inside a template literal.) -->
    <section class="landing-section landing-designs" id="landingDesigns"></section>

    <!-- Instance-wide statistics (#564). An EMPTY placeholder: mountLandingStats
         fills it once GET /api/stats/public answers, and removes it outright
         when there is nothing to publish — so an instance with the feature off
         renders no heading, no container and no gap, and there is no hidden
         attribute here needing a paired display rule. (No backticks in here:
         this comment is inside a template literal.) -->
    <section class="landing-section landing-stats" id="landingStats"></section>

    <section class="landing-section landing-close">
      <h2 class="landing-section__title">${esc(t('landing.cta.title'))}</h2>
      ${renderLandingOffer({ trust: false })}
      <!-- The FAQ (#489) is ungated on purpose, unlike the site footer's copy of
           this link: GET /faq answers on every instance, and this is the only
           entry point a logged-out visitor on an unconfigured one would have.
           A real <a> rather than a routed button — the page lives outside the
           SPA, so it opens in a new tab like the footer's legal links (#390). -->
      <p class="landing-close__faq muted">${esc(t('landing.faq.q'))}
        <a href="/faq?lang=${esc(getLocale())}" target="_blank" rel="noopener">${esc(t('landing.faq.link'))}</a></p>
    </section>
  </div>`);

  app.appendChild(view);
  // After the append: the stage's replay button moves focus to itself, and a
  // detached tree has no focus to move. It is also what makes the isConnected
  // guard in the timeline meaningful (landing-moments.js).
  view.querySelector('#landingMoments').appendChild(renderLandingMoments());
  wireLandingOffer(view);
  landingRevealOperatorClaims(view);
  // Not awaited: the landing page must render at once, and the block appears
  // (or its placeholder disappears) when the payload lands.
  mountLandingStats(view.querySelector('#landingStats'));
  mountLandingDesigns(view.querySelector('#landingDesigns'));
}

/* The design band (#1198, T12.1): every design an account may wear, as a row of
   small posters under one line of copy. It prepares the first-start chooser
   (#1186) so that choosing a look is not a surprise.

   THE COUNT COMES FROM THE SERVER, never from the sheet. T12.1 says „Sieben" —
   true of the finished programme, false of every instance before it: production
   offers only the designs that are `enabled` (designs.js), and a public page
   promising seven looks while the chooser offers two is a claim the next click
   contradicts. So the heading takes {n} from GET /api/config's `designs`, the
   posters are exactly those designs, and fewer than two removes the band — one
   design is not a choice, which is the same bar buildDesignSection sets.

   Built whatever the design worn, and SHOWN only by a design that asks for it:
   styles.css keeps `.landing-designs` at display: none, which is what keeps
   Klassisch byte-for-byte today's page. offeredDesigns/designTile live in
   design-picker.js, which loads before this file and is only called here, at
   render time (.claude/rules/frontend-script-load-order.md). */
function mountLandingDesigns(section) {
  withAppConfig((cfg) => {
    if (!section.isConnected) return;
    const designs = offeredDesigns(cfg);
    if (designs.length < 2) { section.remove(); return; }
    section.appendChild(h(`<div class="landing-designs__text">
        <h2 class="landing-designs__title">${esc(t('landing.designs.title', { n: designs.length }))}</h2>
        <p class="landing-designs__desc">${esc(t('landing.designs.desc'))}</p>
      </div>`));
    const list = h('<ul class="landing-designs__list"></ul>');
    for (const design of designs) {
      const item = h(`<li class="landing-design"><span class="landing-design__name">${esc(t(design.labelKey))}</span></li>`);
      item.insertBefore(designTile(design), item.firstChild);
      list.appendChild(item);
    }
    section.appendChild(list);
  });
}
