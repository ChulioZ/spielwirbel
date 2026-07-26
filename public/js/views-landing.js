/* Spielwirbel – logged-out landing page (issue #322): the marketing "front door"
   a cold visitor sees at GET / in accounts mode, before being asked to register.
   bootApp() (account.js) routes here for a logged-out accounts-mode visitor on
   the "/" path; every other path (deep links, the /v and /r mail links)
   still goes straight to the auth screens.

   Part of the frontend's shared global scope. Loads after core.js and
   account.js (showLogin/showRegister), before router.js — see index.html.
   Cross-file names (showRegister/showLogin) are referenced only inside click
   handlers, i.e. at call time, per
   .claude/rules/frontend-script-load-order.md. */

'use strict';

// Feature highlight cards: [icon class, i18n key prefix]. Every icon is declared
// in the bundled tabler subset (public/fonts/tabler-icons.css) — no new codepoint
// to verify (.claude/rules/tabler-icon-codepoints.md).
const LANDING_FEATURES = [
  ['ti-cards', 'landing.features.shelf'],
  ['ti-tornado', 'landing.features.vote'],
  ['ti-trophy', 'landing.features.ratings'],
  ['ti-history', 'landing.features.chronicle'],
  ['ti-palette', 'landing.features.themes'],
  ['ti-rocket', 'landing.features.pwa'],
];

// The three how-it-works steps, numbered 1–3 in render order.
const LANDING_STEPS = ['landing.how.step1', 'landing.how.step2', 'landing.how.step3'];

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
//  - The shelf ships in TWO widths because a 1280px-wide desktop screenshot
//    scaled into a 375px phone column is illegible; <picture> downloads only the
//    one that matches, so the phone never pays for the desktop pixels.
//  - Every declared width/height is the asset's REAL pixel size, so the hero
//    reserves its box before the image lands (no layout shift above the fold).
//    test/landing-shots.test.js reads the dimensions back out of the files.
//  - The games in them carry NO cover art: their titles are invented and their
//    covers are the app's own deterministic gradients. A provider's cover art in
//    a committed marketing image would be re-hosting someone else's copyrighted
//    artwork — the exact thing .claude/rules/provider-cover-hotlinking.md avoids.
const LANDING_SHOTS = {
  shelfWide: { src: '/img/landing-shelf-wide.webp', w: 1600, h: 988 },
  shelfPhone: { src: '/img/landing-shelf-phone.webp', w: 624, h: 1248 },
  vote: { src: '/img/landing-vote.webp', w: 624, h: 1248 },
};

// The width at which the hero swaps the phone shelf shot for the desktop one.
// Same 720px the stylesheet's landing breakpoint uses — they must agree, or the
// wide screenshot renders in the stacked one-column layout.
const LANDING_SHOT_BP = '(min-width: 720px)';

// Memoized /api/config, used to gate the operator-only trust claim (below). The
// same unauthenticated endpoint initFooter() reads; cached so a language-switch
// re-render doesn't refetch.
let landingCfg = null;

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
  };
  if (landingCfg) { apply(landingCfg); return; }
  fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => { if (cfg) landingCfg = cfg; apply(cfg); })
    .catch(() => {});
}

// The landing view. Full-screen like the auth screens (authScreen(true) hides the
// top-bar home/context/feedback; the language picker stays), but scrollable
// multi-section marketing content rather than a single centred card. Sets
// currentView so a language switch re-renders it in place (core.js langPicker).
function showLanding() {
  currentView = showLanding;
  authScreen(true);
  setContext('');
  applyBackground(null);
  app.innerHTML = '';

  const featureCards = LANDING_FEATURES.map(([icon, key]) => `
      <li class="landing-card">
        <span class="landing-card__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
        <h3 class="landing-card__title">${esc(t(key + '.title'))}</h3>
        <p class="landing-card__desc muted">${esc(t(key + '.desc'))}</p>
      </li>`).join('');

  const steps = LANDING_STEPS.map((key, i) => `
      <li class="landing-step">
        <span class="landing-step__num">${i + 1}</span>
        <div>
          <h3 class="landing-step__title">${esc(t(key + '.title'))}</h3>
          <p class="landing-step__desc muted">${esc(t(key + '.desc'))}</p>
        </div>
      </li>`).join('');

  // Informative images, not decoration: each carries real alt text (localized,
  // even though the screenshots themselves are German — the app's product
  // language), so the page still explains itself to a screen reader.
  const shelfShot = `
      <picture>
        <source media="${LANDING_SHOT_BP}" srcset="${LANDING_SHOTS.shelfWide.src}"
                width="${LANDING_SHOTS.shelfWide.w}" height="${LANDING_SHOTS.shelfWide.h}" />
        <img class="landing-shot" src="${LANDING_SHOTS.shelfPhone.src}"
             width="${LANDING_SHOTS.shelfPhone.w}" height="${LANDING_SHOTS.shelfPhone.h}"
             alt="${esc(t('landing.shot.shelfAlt'))}" />
      </picture>`;

  const view = h(`<div class="landing">
    <section class="landing-hero">
      <div class="landing-hero__text">
        <div class="landing-hero__brand">
          <i class="ti ti-tornado" aria-hidden="true"></i><span>${esc(t('app.title'))}</span>
        </div>
        <h1 class="landing-hero__title">${esc(t('landing.hero.title'))}</h1>
        <p class="landing-hero__sub">${esc(t('landing.hero.sub'))}</p>
        <div class="landing-hero__cta">
          <button class="btn btn--primary btn--lg" id="landingRegister">${esc(t('landing.hero.ctaPrimary'))}</button>
          <button class="btn btn--lg" id="landingLogin">${esc(t('landing.hero.ctaSecondary'))}</button>
        </div>
      </div>
      <div class="landing-hero__visual">${shelfShot}</div>
    </section>

    <section class="landing-section">
      <h2 class="landing-section__title">${esc(t('landing.features.title'))}</h2>
      <ul class="landing-cards">${featureCards}</ul>
    </section>

    <section class="landing-section">
      <h2 class="landing-section__title">${esc(t('landing.how.title'))}</h2>
      <div class="landing-how">
        <ol class="landing-steps">${steps}</ol>
        <img class="landing-shot landing-how__shot" src="${LANDING_SHOTS.vote.src}"
             width="${LANDING_SHOTS.vote.w}" height="${LANDING_SHOTS.vote.h}"
             alt="${esc(t('landing.shot.voteAlt'))}" />
      </div>
    </section>

    <section class="landing-section landing-trust">
      <h2 class="landing-section__title">${esc(t('landing.trust.title'))}</h2>
      <ul class="landing-trust__chips">
        <li class="landing-chip"><i class="ti ti-heart" aria-hidden="true"></i>${esc(t('landing.trust.free'))}</li>
        <li class="landing-chip"><i class="ti ti-eye-off" aria-hidden="true"></i>${esc(t('landing.trust.noTracking'))}</li>
        <li class="landing-chip" data-operator-only hidden><i class="ti ti-shield" aria-hidden="true"></i>${esc(t('landing.trust.eu'))}</li>
      </ul>
    </section>

    <section class="landing-section landing-close">
      <h2 class="landing-section__title">${esc(t('landing.cta.title'))}</h2>
      <button class="btn btn--primary btn--lg" id="landingRegisterClose">${esc(t('landing.hero.ctaPrimary'))}</button>
    </section>
  </div>`);

  app.appendChild(view);
  view.querySelector('#landingRegister').addEventListener('click', () => showRegister());
  view.querySelector('#landingRegisterClose').addEventListener('click', () => showRegister());
  view.querySelector('#landingLogin').addEventListener('click', () => showLogin());
  landingRevealOperatorClaims(view);
}
