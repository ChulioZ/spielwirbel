'use strict';

/*
 * The „Was spielen wir heute?" guide (issue #1171): one public, indexable page
 * per shipped language, each at its own translated path
 * (`/de/was-spielen-wir-heute`, `/en/what-should-we-play-tonight`, …).
 *
 * It answers the question people type into a search engine on the day they have
 * the problem the app solves — nobody searches the brand. So it is written as a
 * GUIDE first (how groups decide, what matters in the choice, a method that
 * works with pen and paper) and only then says how Spielwirbel does it, ending
 * in the demo. One page per language, deliberately: several near-duplicate
 * pages per query variant read as doorway pages to a search engine and cost the
 * whole domain.
 *
 * SERVER-RENDERED for the reason lib/faq.js gives: the call to action depends on
 * how this instance is configured (the demo exists only where DEMO_ENABLED is on
 * and accounts are live), and a crawler never runs the JS that would hide a
 * button that 404s. Here the demo CTA is simply absent where it cannot work
 * (.claude/rules/instance-specific-claims-must-be-server-rendered.md).
 *
 * Content rules — the FAQ's, plus two of its own:
 *  - Every claim must hold on EVERY instance that serves the page, or be gated.
 *    The prose describes only what any instance does (draw by player count,
 *    secret 1–5 ratings, the shared vote link); it says nothing about EU hosting,
 *    cost or accounts, which are instance facts.
 *  - No device kind (test/guide.test.js reuses the FAQ's per-locale ban) and no
 *    „Abend"/"evening"/"night" for a session (test/session-naming.test.js scans
 *    this text too) — awkward for a page about the evening's game, so the prose
 *    says „heute", "tonight", « ce soir »: time-of-day words the naming rule
 *    allows.
 *  - German is the reference text; each other page says so in one line.
 *
 * The per-language text lives in lib/guide-text/<code>.js — one file per
 * language, because a translation is edited and reviewed as a whole and never
 * one sentence across nine files at once (the opposite of the FAQ, whose unit is
 * one answer). The slugs live in public/js/guide-paths.js, shared with the
 * landing screen that links here.
 *
 * Nothing here interpolates env or user input: every string is a literal in this
 * file or a text file, so there is no escaping to get wrong.
 */

const legal = require('./legal');
const { DEFAULT_CANONICAL } = require('./canonical');
// The face design (#1198), stamped onto <html> exactly as /faq does.
const { FACE_DESIGN } = require('../public/js/designs');
const { SUPPORTED_LOCALES, LOCALE_LABELS, localeTag } = require('../public/js/locales');
// One slug table for the server and the landing screen's link
// (.claude/rules/shared-constants-across-the-stack.md).
const { GUIDE_SLUGS, guidePath } = require('../public/js/guide-paths');

const ORIGIN = `https://${DEFAULT_CANONICAL}`;

// The text per locale. Required eagerly and derived from SUPPORTED_LOCALES, so a
// tenth language without a text file fails at require time — loudly, in every
// spec — rather than 404ing one page in production.
const TEXT = Object.fromEntries(SUPPORTED_LOCALES.map((code) => [code, require(`./guide-text/${code}`)]));

// The path a crawler and a browser actually request: percent-encoded, which is
// what Express hands over in `req.path`. The Korean slug is Hangul, so the
// decoded form would never match.
function encodedGuidePath(code) {
  return encodeURI(guidePath(code));
}

// encoded path → locale, for the router and the rate limiter's exempt set.
const GUIDE_PATHS = new Map(SUPPORTED_LOCALES.map((code) => [encodedGuidePath(code), code]));

// Absolute URL of a locale's page on the canonical host — the canonical, the
// hreflang set, og:url and the sitemap all use exactly this.
function guideUrl(code) {
  return ORIGIN + encodedGuidePath(code);
}

// Every other shipped language's guide, the current one as plain text — the
// FAQ's language row, pointing at guide pages instead.
function langRow(lang) {
  const items = SUPPORTED_LOCALES.map((code) => (code === lang
    ? `<strong>${LOCALE_LABELS[code]}</strong>`
    : `<a href="${encodedGuidePath(code)}" hreflang="${code}" lang="${code}">${LOCALE_LABELS[code]}</a>`));
  return `<nav class="langs" aria-label="${TEXT[lang].chrome.langs}">${items.join(' · ')}</nav>`;
}

/* A self-referencing canonical per language plus the full hreflang set and
   x-default (the German reference page) — the decision /faq made in #1088, for
   the same reason: nine genuinely different documents, none a duplicate. */
function headLinks(lang) {
  const alts = SUPPORTED_LOCALES.map((code) =>
    `  <link rel="alternate" hreflang="${code}" href="${guideUrl(code)}" />`);
  alts.push(`  <link rel="alternate" hreflang="x-default" href="${guideUrl('de')}" />`);
  return `  <link rel="canonical" href="${guideUrl(lang)}" />
${alts.join('\n')}`;
}

// Open Graph: one card per language. og:locale wants an underscore
// (`de_DE`), the alternates every other shipped language.
function openGraph(lang) {
  const t = TEXT[lang];
  const ogLocale = (code) => localeTag(code).replace('-', '_');
  const alternates = SUPPORTED_LOCALES.filter((c) => c !== lang)
    .map((c) => `  <meta property="og:locale:alternate" content="${ogLocale(c)}" />`);
  return `  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Spielwirbel" />
  <meta property="og:locale" content="${ogLocale(lang)}" />
${alternates.join('\n')}
  <meta property="og:url" content="${guideUrl(lang)}" />
  <meta property="og:title" content="${t.title}" />
  <meta property="og:description" content="${t.description}" />
  <meta property="og:image" content="${ORIGIN}/icons/tisch/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />`;
}

/* The call to action. The demo button exists only where the demo does
   (`demo.demoEnabled()` — DEMO_ENABLED and accounts both on); everywhere else the
   page ends in a plain link to the app, which every instance serves. */
function renderCta(lang) {
  const c = TEXT[lang].cta;
  // Required here rather than at the top: lib/demo pulls in the repo (and with
  // it the store's require-time read of DATA_DIR), and the text scans in
  // test/session-naming.test.js require this module only for TEXT.
  const body = require('./demo').demoEnabled()
    ? `<p>${c.demoText}</p>
      <p><a class="cta-btn" href="/demo">${c.demoButton}</a></p>`
    : `<p>${c.openText}</p>
      <p><a class="cta-btn" href="/">${c.openButton}</a></p>`;
  return `<section class="cta" id="guide-cta">
      <h2>${c.title}</h2>
      ${body}
    </section>`;
}

// The foot: the FAQ in the reader's language, the way back, and — only where
// they serve something — the legal pages (the FAQ's all-or-nothing gate).
function footLinks(lang) {
  const ch = TEXT[lang].chrome;
  const faq = `<a href="/faq?lang=${lang}">${ch.faq}</a>`;
  if (!legal.legalConfigured()) return `<p class="foot"><a href="/">${ch.back}</a> · ${faq}</p>`;
  return `<p class="foot"><a href="/">${ch.back}</a> · ${faq}
· <a href="/impressum">Impressum</a>
· <a href="/datenschutz">Datenschutz</a>
· <a href="/nutzungsbedingungen">Nutzungsbedingungen</a></p>`;
}

function renderSections(lang) {
  return TEXT[lang].sections.map((s) => `
    <section class="part">
      <h2>${s.h}</h2>
      ${s.html}
    </section>`).join('\n');
}

/*
 * The whole document. `lang` is trusted to be a shipped code — the route only
 * calls this for a path found in GUIDE_PATHS; the `|| 'de'` is the belt for a
 * direct caller.
 *
 * The CSS is INLINE in this template, never hoisted into a const: the token copy
 * below is licensed by test/standalone-page-brand.test.js, which reads this file
 * as TEXT and sweeps the `<style>` block for stray palette hexes — an
 * interpolated block would make that sweep pass vacuously (lib/faq.js's header
 * records the measurement). The tokens and most rules are the FAQ's, copied for
 * the reason that page gives.
 */
function renderGuide(lang) {
  const loc = TEXT[lang] ? lang : 'de';
  const t = TEXT[loc];

  return `<!DOCTYPE html>
<html lang="${localeTag(loc)}" data-design="${FACE_DESIGN}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t.title} · Spielwirbel</title>
  <meta name="description" content="${t.description}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#c2410c" />
  <link rel="icon" href="/icons/tisch/favicon-32.png" sizes="32x32" type="image/png" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
${headLinks(loc)}
${openGraph(loc)}
  <style>
    :root {
      --page-bg: #f4f1ea;
      --brand: #c2410c;
      --surface: #ffffff;
      --ink: #2b2620;
      --ink-soft: #6b6358;
      --shade: #000;
      --line: color-mix(in oklab, var(--page-bg), var(--shade) 7%);
      --sunken: color-mix(in oklab, var(--page-bg), var(--shade) 4%);
      --brand-strong: color-mix(in oklab, var(--brand), var(--shade) 13%);
      --page-glow: color-mix(in oklab, var(--brand) 7%, transparent);
      --radius-lg: 18px;
      --shadow-2: 0 2px 8px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.06);
      --font: "Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-display-std: "Baloo 2", "Nunito", -apple-system, BlinkMacSystemFont, sans-serif;
      --font-display: var(--font-display-std);
    }
    /* Der Tisch as the face (#1198): the FAQ's second token copy, pinned by
       test/standalone-page-brand.test.js against the design's own resolved
       tokens, applied only under <html data-design="tisch">. */
    :root[data-design="tisch"] {
      --page-bg: #3b2a12;
      --brand: #d9a951;
      --surface: #4a3423;
      --ink: #f6ecd8;
      --ink-soft: #e8d0aa;
      --shade: #fff;
      --line: color-mix(in oklab, var(--page-bg), var(--shade) 21%);
      --sunken: color-mix(in oklab, var(--page-bg), var(--shade) 19%);
      --brand-strong: color-mix(in oklab, var(--brand), var(--shade) 13%);
      --page-glow: color-mix(in oklab, var(--brand) 7%, transparent);
      --radius-lg: 6px;
      --shadow-2: 0 6px 14px var(--cast-soft), 0 1px 2px var(--cast);
      --font: "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-display-std: "Baloo 2", "Nunito", -apple-system, BlinkMacSystemFont, sans-serif;
      --font-display: "Bricolage Grotesque", "Manrope", -apple-system, BlinkMacSystemFont, sans-serif;
      --radius-sm: 3px;
      --radius-md: 4px;
      --on-accent: #2a1a08;
      --paper: #f8f3e7;
      --paper-raised: #efe7d5;
      --paper-ink: #2f2620;
      --paper-ink-soft: #4a4038;
      --paper-edge: #8d6436;
      --gold-deep: #d9a951;
      --gold-edge: #9a6d2b;
      --brass-hi: #f6d795;
      --accent-deep: #ab3c22;
      --cast: rgba(0, 0, 0, 0.35);
      --cast-soft: rgba(0, 0, 0, 0.30);
      --cast-deep: rgba(0, 0, 0, 0.45);
    }
    @font-face { font-family: 'Nunito'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/nunito-latin-400-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Nunito'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/nunito-latin-600-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Baloo 2'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/baloo-2-latin-700-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/manrope-latin-500-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/manrope-latin-600-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/manrope-latin-700-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Bricolage Grotesque'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/bricolage-grotesque-latin-700-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Bricolage Grotesque'; font-style: normal; font-weight: 800; font-display: swap; src: url('/fonts/bricolage-grotesque-latin-800-normal.woff2') format('woff2'); }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background-color: var(--page-bg);
      background-image: radial-gradient(120% 70% at 50% 0%, var(--page-glow), transparent 70%);
      background-attachment: fixed;
      color: var(--ink);
      font-family: var(--font);
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
      padding: 2rem 1rem 4rem;
    }
    .card {
      width: 100%;
      max-width: 720px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 2rem 1.5rem;
      box-shadow: var(--shadow-2);
    }
    .brand { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.25rem; text-decoration: none; }
    .brand img { display: block; width: 32px; height: 32px; border-radius: 9px; }
    .brand span { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; color: var(--brand); }
    h1 { font-family: var(--font-display); font-size: 2rem; line-height: 1.2; font-weight: 700; margin: 0 0 0.8rem; overflow-wrap: break-word; }
    .langs { font-size: 0.88rem; color: var(--ink-soft); margin: 0 0 1.4rem; line-height: 1.9; }
    .langs a { color: var(--brand-strong); }
    .lang-note { background: var(--sunken); border-radius: 12px; padding: 0.7rem 1rem; font-size: 0.9rem; margin: 0 0 1.6rem; }
    .lead p { font-size: 1.05rem; margin: 0 0 1rem; }
    .part { margin: 2.2rem 0 0; }
    .part h2, .cta h2 { font-family: var(--font-display); font-size: 1.3rem; line-height: 1.3; font-weight: 700; margin: 0 0 0.7rem; color: var(--brand); }
    .part p { margin: 0 0 0.9rem; }
    .part ul, .part ol { margin: 0 0 0.9rem; padding-left: 1.3rem; }
    .part li { margin: 0 0 0.6rem; }
    .cta { margin: 2.6rem 0 0; padding: 1.4rem 1.3rem; background: var(--sunken); border-radius: 14px; border-left: 4px solid var(--brand); }
    .cta p { margin: 0 0 0.9rem; }
    .cta p:last-child { margin-bottom: 0; }
    .cta-btn {
      display: inline-block;
      min-height: 44px;
      padding: 0.6rem 1.3rem;
      border-radius: 999px;
      background: var(--brand-strong);
      color: #fff;
      font-weight: 700;
      text-decoration: none;
    }
    a { color: var(--brand-strong); }
    .foot { margin-top: 2.5rem; text-align: center; font-size: 0.88rem; color: var(--ink-soft); }
    .foot a { color: var(--ink-soft); display: inline-block; min-height: 24px; line-height: 24px; }
    @media (min-width: 720px) {
      body { padding: 3rem 1.5rem 5rem; }
      .card { padding: 2.75rem 3rem; }
      h1 { font-size: 2.4rem; }
    }
    /* ---- Der Tisch: the FAQ's "paper on the walnut table" treatment ---- */
    :root[data-design="tisch"] body {
      background-image: repeating-linear-gradient(180deg, var(--page-glow) 0 2px, transparent 2px 7px);
    }
    :root[data-design="tisch"] .card {
      --surface: var(--paper);
      --ink: var(--paper-ink);
      --ink-soft: var(--paper-ink-soft);
      --line: var(--paper-edge);
      --sunken: var(--paper-raised);
      --brand-strong: var(--accent-deep);
      background: linear-gradient(180deg, var(--paper), var(--paper-raised));
      color: var(--ink);
      border-color: var(--gold-edge);
      box-shadow: 0 14px 30px var(--cast-deep);
    }
    :root[data-design="tisch"] .brand span {
      padding: 4px 10px;
      border: 1px solid var(--gold-edge);
      border-radius: var(--radius-sm);
      background: linear-gradient(180deg, var(--brass-hi), var(--gold-deep));
      color: var(--on-accent);
      font-weight: 800;
      font-size: 0.95rem;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    :root[data-design="tisch"] h1 { font-weight: 800; }
    /* Brass is not a colour on paper (1.9:1), so headings take the paper ink —
       the FAQ's choice for its questions. */
    :root[data-design="tisch"] .part h2,
    :root[data-design="tisch"] .cta h2 { color: var(--ink); font-weight: 800; }
    :root[data-design="tisch"] .part p,
    :root[data-design="tisch"] .part li { color: var(--ink-soft); font-weight: 500; }
    :root[data-design="tisch"] .cta { border-left-color: var(--gold-deep); }
    :root[data-design="tisch"] .cta-btn {
      border-radius: var(--radius-md);
      border: 1px solid var(--gold-edge);
      background: linear-gradient(180deg, var(--brass-hi), var(--gold-deep));
      color: var(--on-accent);
    }
  </style>
</head>
<body>
  <main class="card">
    <a class="brand" href="/">
      <img src="/icons/tisch/icon-192.png" alt="" width="32" height="32" />
      <span>Spielwirbel</span>
    </a>
    <article>
      <h1>${t.h1}</h1>
      ${langRow(loc)}
${t.chrome.note ? `      <p class="lang-note">${t.chrome.note}</p>` : ''}
      <div class="lead">${t.lead}</div>
${renderSections(loc)}
      ${renderCta(loc)}
    </article>
${footLinks(loc)}
  </main>
</body>
</html>`;
}

module.exports = { renderGuide, GUIDE_PATHS, GUIDE_SLUGS, TEXT, guideUrl, encodedGuidePath };
