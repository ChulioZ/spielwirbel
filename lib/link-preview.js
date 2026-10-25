'use strict';

/*
 * The link-preview card per language (#1727). A scraper — Discourse's onebox,
 * the messengers, the social sites — fetches the page once, runs no script and
 * sends no reader's Accept-Language, so the only place a language can ride is
 * the URL the poster shares: `https://spielwirbel.app/?lang=fr`.
 *
 * So the SPA fallback hands the shell through here. German (the static file's
 * own language) and anything not in the shipped set get the file BYTE FOR BYTE;
 * a shipped other language gets the same document with the preview tags
 * rewritten. Everything else in the head stays as it is — the `<title>`, the
 * canonical and the hreflang-free SEO surface are not this change
 * (.claude/rules/link-preview-card.md).
 *
 * The strings come from the lang tables, read through a vm sandbox (they are
 * browser scripts), never from a copy here: a hand-copied set of nine pitches is
 * the drift test/link-preview.test.js exists to catch.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { SUPPORTED_LOCALES, localeTag } = require('../public/js/locales');
const designs = require('../public/js/designs');

const ORIGIN = 'https://spielwirbel.app';
const LANG_DIR = path.join(__dirname, '..', 'public', 'js', 'lang');
// The static file's language: its card is the default and keeps the bare URLs.
const SHELL_LOCALE = 'de';

/* A locale's preview image, next to the face's own card: `og-image.png` for
   German (so caches and test/design-marks.test.js keep holding),
   `og-image-<code>.png` for the rest. scripts/render-design-marks.js writes
   exactly these paths. */
function localizedImagePath(base, code) {
  return code === SHELL_LOCALE ? base : base.replace(/\.png$/, `-${code}.png`);
}

function ogImagePath(code) {
  return localizedImagePath(designs.designMarks(designs.FACE_DESIGN).og, code);
}

function loadTable(code) {
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(path.join(LANG_DIR, `${code}.js`), 'utf8'), context);
  return context.I18N[code];
}

// Our own strings, but they land in an attribute: escape anyway.
function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The card's values for one locale — exported for the spec and for the
// renderer's alt text, so all three read one derivation.
function previewTags(code) {
  const t = loadTable(code);
  const title = `Spielwirbel – ${t['landing.hero.title']}`;
  const description = t['landing.hero.sub'];
  const image = ORIGIN + ogImagePath(code);
  return {
    'property="og:locale"': localeTag(code).replace('-', '_'),
    'property="og:url"': `${ORIGIN}/?lang=${code}`,
    'property="og:title"': title,
    'property="og:description"': description,
    'property="og:image"': image,
    'property="og:image:alt"': `Spielwirbel – ${t['auth.promise.claim']} ${t['linkPreview.imageAlt']}`,
    'name="description"': description,
    'name="twitter:title"': title,
    'name="twitter:description"': description,
    'name="twitter:image"': image,
  };
}

/* Rewrites each tag's content in `html`. A tag that is not there THROWS —
   at startup, since the shells are rendered once — rather than silently
   serving a half-German card after someone edits the head. */
function localizeShell(html, code) {
  let out = html;
  for (const [key, value] of Object.entries(previewTags(code))) {
    const re = new RegExp(`(<meta ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} content=")[^"]*(")`);
    if (!re.test(out)) throw new Error(`link-preview: <meta ${key}> not found in the shell`);
    out = out.replace(re, (_, open, close) => open + attr(value) + close);
  }
  return out;
}

/* One rendered shell per shipped non-German locale, read from whichever
   directory the app serves (public/ or the built dist/, whose hashed asset
   refs must survive). `null` means "send the file as it is". */
function createShellLocalizer(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const shells = new Map(SUPPORTED_LOCALES
    .filter((code) => code !== SHELL_LOCALE)
    .map((code) => [code, localizeShell(html, code)]));
  // An ALLOWLIST, never a passthrough (lib/routes/faq.js makes the same call):
  // the query is attacker-controlled, and an unknown value gets the German file.
  return (lang) => shells.get(String(lang || '')) || null;
}

module.exports = { createShellLocalizer, loadTable, localizeShell, previewTags, ogImagePath, localizedImagePath, SHELL_LOCALE };
