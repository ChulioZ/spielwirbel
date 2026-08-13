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

// The "what you get" cards: [icon class, i18n key prefix]. Every icon is
// declared in the bundled tabler subset (public/fonts/tabler-icons.css) — an
// undeclared class renders NOTHING, silently (.claude/rules/tabler-icon-codepoints.md).
//
// #483 replaced the per-round themes card with `noAccounts`: "nobody but the
// round owner needs an account" is one of the app's defining design choices and
// the copy never said it, while a colour theme is the most cosmetic thing here.
// Six stays a clean grid — .landing-cards is auto-fill from 240px.
const LANDING_FEATURES = [
  ['ti-cards', 'landing.features.shelf'],
  ['ti-tornado', 'landing.features.vote'],
  ['ti-trophy', 'landing.features.ratings'],
  ['ti-history', 'landing.features.chronicle'],
  ['ti-users', 'landing.features.noAccounts'],
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
//
// One set per shipped locale (#457), keyed by locale code. Everything else on
// this page switches language — headline, cards, steps, chips — so a German
// screenshot under English copy was the one part of the page that stayed
// half-translated, on the page whose whole job is "what is this and how does it
// work". Each set is shot against its own seed, so the *content* is localized
// too (round name, member names, game titles), not just the app's chrome; the
// two seeds live in the regeneration recipe.
//
// The dimensions stay PER ASSET rather than per family: they are asserted
// against the real files, so re-shooting one locale may legitimately change one
// height (a title that wraps to two lines moves the crop) without touching the
// other.
const LANDING_SHOTS = {
  de: {
    shelfWide: { src: '/img/landing-shelf-wide.de.webp', w: 1600, h: 1090 },
    shelfPhone: { src: '/img/landing-shelf-phone.de.webp', w: 624, h: 1314 },
    vote: { src: '/img/landing-vote.de.webp', w: 624, h: 1152 },
  },
  en: {
    shelfWide: { src: '/img/landing-shelf-wide.en.webp', w: 1600, h: 1090 },
    shelfPhone: { src: '/img/landing-shelf-phone.en.webp', w: 624, h: 1314 },
    vote: { src: '/img/landing-vote.en.webp', w: 624, h: 1152 },
  },
};

// The set for the active locale, resolved at RENDER time — showLanding() sets
// currentView, and the top-bar picker re-runs it after setLocale(), so reading
// getLocale() here is the whole language-switch mechanism.
//
// Falls back to the first shipped locale rather than rendering a broken src,
// matching how t() falls back: a locale that ships a language file but no
// screenshots yet shows somebody else's product, which is a great deal better
// than an empty box in the hero.
function landingShots() {
  return LANDING_SHOTS[getLocale()] || LANDING_SHOTS[SUPPORTED_LOCALES[0]];
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
    // The demo CTA (#427), gated on its own flag rather than cfg.footer: an
    // instance can perfectly well have its legal surfaces configured and the
    // demo switched off, and a button that answers 404 is worse than no button.
    if (cfg && cfg.demo) {
      root.querySelectorAll('[data-demo-only]').forEach((el) => { el.hidden = false; });
      // Promote the demo to THE primary action and demote registering, because
      // "try it without signing up" is the offer this page is making. Done here
      // rather than in the markup so an instance without the demo keeps its
      // existing single primary CTA, byte-for-byte.
      const demoBtn = root.querySelector('#landingDemo');
      const registerBtn = root.querySelector('#landingRegister');
      if (demoBtn) demoBtn.classList.add('btn--primary');
      if (registerBtn) registerBtn.classList.remove('btn--primary');
      // A visitor who already holds a live demo re-enters it rather than
      // minting a second (#502), so the CTA has to say so — "ausprobieren"
      // would read as starting over, which is exactly what it no longer does.
      // getDemoToken lives in account.js, which loads before this file.
      if (demoBtn && getDemoToken()) demoBtn.textContent = t('landing.hero.ctaResume');
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
  // The landing owns '/' (#501). Without this a deliberate logout would swap the
  // card while the address bar still named the round the user just left — the
  // bug would move rather than be fixed. Callers that must REPLACE the entry
  // they came from (a failed /demo deep link) go through routeTo() instead.
  syncUrl('/');
  authScreen(true);
  setContext('');
  // The one screen that keeps the DEFAULT tab title rather than naming itself
  // (#522): this is the front door, and its title is the app's own pitch —
  // the same string the static <title> carries for crawlers. applyTabTitle()
  // rather than setDocTitle(), because that pitch is 'app.tabTitle', not the
  // bare brand a part-less setDocTitle() would produce.
  applyTabTitle();
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

  // Informative images, not decoration: each carries real alt text, so the page
  // still explains itself to a screen reader.
  const shots = landingShots();
  const shelfShot = `
      <picture>
        <source media="${LANDING_SHOT_BP}" srcset="${shots.shelfWide.src}"
                width="${shots.shelfWide.w}" height="${shots.shelfWide.h}" />
        <img class="landing-shot" src="${shots.shelfPhone.src}"
             width="${shots.shelfPhone.w}" height="${shots.shelfPhone.h}"
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
        <!-- The demo (#427) leads, ahead of registering: the whole point is
             that a visitor can judge the app before being asked for anything.
             Its note lives INSIDE this block rather than under the button row
             (#503): the row wraps, so „Sofort loslegen, ohne E-Mail" ended up
             directly beneath „Anmelden" at both 375px and 1600px — a promise of
             no-e-mail attached to the two actions that require one.
             The data-demo-only/hidden pair sits on the wrapper alone, so the
             whole group collapses on an instance whose /api/config reports the
             demo off and the hero keeps its pre-#503 single row — the reveal is
             in landingRevealOperatorClaims(). (No backticks in here: this
             comment is inside a template literal.) -->
        <div class="landing-hero__demo" data-demo-only hidden>
          <button class="btn btn--lg" id="landingDemo">${esc(t('landing.hero.ctaDemo'))}</button>
          <p class="landing-hero__demo-note muted">${esc(t('landing.hero.demoNote'))}</p>
        </div>
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
        <img class="landing-shot landing-how__shot" src="${shots.vote.src}"
             width="${shots.vote.w}" height="${shots.vote.h}"
             alt="${esc(t('landing.shot.voteAlt'))}" />
      </div>
    </section>

    <section class="landing-section landing-trust">
      <h2 class="landing-section__title">${esc(t('landing.trust.title'))}</h2>
      <ul class="landing-trust__chips">
        <li class="landing-chip"><i class="ti ti-heart" aria-hidden="true"></i>${esc(t('landing.trust.free'))}</li>
        <li class="landing-chip"><i class="ti ti-eye-off" aria-hidden="true"></i>${esc(t('landing.trust.noTracking'))}</li>
        <li><a class="landing-chip landing-chip--link" href="${LANDING_REPO_URL}"
               target="_blank" rel="noopener noreferrer"><i class="ti ti-code" aria-hidden="true"></i>${esc(t('landing.trust.source'))}</a></li>
        <li class="landing-chip" data-operator-only hidden><i class="ti ti-shield" aria-hidden="true"></i>${esc(t('landing.trust.eu'))}</li>
      </ul>
    </section>

    <section class="landing-section landing-close">
      <h2 class="landing-section__title">${esc(t('landing.cta.title'))}</h2>
      <button class="btn btn--primary btn--lg" id="landingRegisterClose">${esc(t('landing.hero.ctaPrimary'))}</button>
      <!-- The FAQ (#489) is ungated on purpose, unlike the site footer's copy of
           this link: GET /faq answers on every instance, and this is the only
           entry point a logged-out visitor on an unconfigured one would have.
           A real <a> rather than a routed button — the page lives outside the
           SPA, so it opens in a new tab like the footer's legal links (#390). -->
      <p class="landing-close__faq muted">${esc(t('landing.faq.q'))}
        <a href="/faq" target="_blank" rel="noopener">${esc(t('landing.faq.link'))}</a></p>
    </section>
  </div>`);

  app.appendChild(view);
  // startDemo lives in account.js, which loads BEFORE this file — and it is
  // referenced inside a handler either way, so it resolves at click time
  // (.claude/rules/frontend-script-load-order.md).
  const demoBtn = view.querySelector('#landingDemo');
  demoBtn.addEventListener('click', () => startDemo(demoBtn));
  view.querySelector('#landingRegister').addEventListener('click', () => showRegister());
  view.querySelector('#landingRegisterClose').addEventListener('click', () => showRegister());
  view.querySelector('#landingLogin').addEventListener('click', () => showLogin());
  landingRevealOperatorClaims(view);
}
