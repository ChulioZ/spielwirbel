'use strict';

/*
 * The „Was spielen wir heute?" guide (issue #1171): one server-rendered page per
 * shipped language at a translated path. What is asserted here is the PAGE —
 * that every locale has one, that it is reachable, honest and well-formed. The
 * findability mechanics a crawler reads (head tags, hreflang, canonical,
 * sitemap) are in test/seo.test.js beside the rest of the crawler surface.
 *
 * Everything is derived from SUPPORTED_LOCALES and the slug table, never a hand
 * copy: a tenth language must fail here until it brings a slug and a text.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');
const { createApp } = require('../lib/app');
const guide = require('../lib/guide');
const { renderFaq } = require('../lib/faq');
const { SUPPORTED_LOCALES, localeTag } = require('../public/js/locales');
const { GUIDE_SLUGS, guidePath } = require('../public/js/guide-paths');
const { BANNED_BY_LOCALE } = require('./support/device-words');
const { FACE_DESIGN } = require('../public/js/designs');

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// Every prose string a locale's page carries, flattened — what the content
// scans below read.
function proseOf(t) {
  return [t.title, t.description, t.h1, t.lead,
    ...t.sections.flatMap((s) => [s.h, s.html]),
    ...Object.values(t.cta), ...Object.values(t.chrome).filter(Boolean)];
}

test('every shipped locale has a slug and a complete text', () => {
  assert.deepEqual(Object.keys(GUIDE_SLUGS).sort(), [...SUPPORTED_LOCALES].sort(),
    'GUIDE_SLUGS must name exactly the shipped locales');
  assert.deepEqual(Object.keys(guide.TEXT).sort(), [...SUPPORTED_LOCALES].sort());
  for (const code of SUPPORTED_LOCALES) {
    const t = guide.TEXT[code];
    for (const k of ['title', 'description', 'h1', 'lead']) {
      assert.ok(typeof t[k] === 'string' && t[k].trim(), `${code}.${k} is empty`);
    }
    assert.ok(t.sections.length >= 4, `${code} has ${t.sections.length} sections`);
    for (const k of ['title', 'demoText', 'demoButton', 'openText', 'openButton']) {
      assert.ok(t.cta[k] && t.cta[k].trim(), `${code}.cta.${k} is empty`);
    }
    for (const k of ['back', 'faq', 'langs']) assert.ok(t.chrome[k], `${code}.chrome.${k} is empty`);
    // German is the reference text; every translation says so in one line.
    if (code === 'de') assert.equal(t.chrome.note, null);
    else assert.ok(t.chrome.note && t.chrome.note.trim(), `${code} lacks the translation note`);
    // A search snippet is cut around 160 characters; a description far past it
    // is a sentence the reader never sees the end of.
    assert.ok(t.description.length <= 175, `${code}.description is ${t.description.length} chars`);
  }
});

test('the slugs are URL-shaped and pairwise distinct', () => {
  const seen = new Set();
  for (const [code, slug] of Object.entries(GUIDE_SLUGS)) {
    // Lowercase, hyphenated; Korean keeps Hangul by design (guide-paths.js).
    assert.match(slug, code === 'ko' ? /^[\p{Script=Hangul}-]+$/u : /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      `${code} slug "${slug}" is not URL-shaped`);
    assert.ok(!seen.has(slug), `slug "${slug}" is used twice`);
    seen.add(slug);
  }
  assert.equal(guidePath('de'), '/de/was-spielen-wir-heute');
  // An unknown locale gets the reference page, not a path the SPA answers.
  assert.equal(guidePath('xx'), guidePath('de'));
  assert.equal(guidePath('__proto__'), guidePath('de'));
});

test('GET /<lang>/<slug> renders the guide in that language, for every locale', async () => {
  for (const code of SUPPORTED_LOCALES) {
    // supertest sends the path as given; encodeURI is what a browser sends for
    // the Hangul slug, and what the router matches.
    const res = await request(app).get(encodeURI(guidePath(code)));
    assert.equal(res.status, 200, `${code}: ${res.status}`);
    assert.match(res.headers['content-type'], /text\/html/);
    // Nothing on the page is personal, so a shared cache may keep it.
    assert.match(res.headers['cache-control'], /^public\b/, `${code}: ${res.headers['cache-control']}`);
    // The face design stamped on the server, as /faq does (#1198) — the page
    // must never paint Klassisch first and switch.
    assert.match(res.text, new RegExp(`<html lang="${localeTag(code)}" data-design="${FACE_DESIGN}">`));
    assert.ok(res.text.includes(`<h1>${guide.TEXT[code].h1}</h1>`), `${code}: h1 missing`);
    // The page is a guide first: its prose is in the served bytes, not in a JS
    // bundle a crawler never runs.
    assert.ok(res.text.includes(guide.TEXT[code].sections[0].h), `${code}: first section missing`);
  }
});

test('a near-miss path falls through to the SPA exactly as before', async () => {
  const shell = (await request(app).get('/')).text;
  const misses = [
    '/de/what-should-we-play-tonight',  // a real slug under the wrong locale
    '/xx/was-spielen-wir-heute',        // an unknown locale
    '/de/was-spielen-wir-morgen',       // an unknown slug
    '/de/was-spielen-wir-heute/',       // a trailing slash
  ];
  for (const p of misses) {
    const res = await request(app).get(p);
    assert.equal(res.status, 200, `${p}: ${res.status}`);
    assert.equal(res.text, shell, `${p} should be the SPA shell`);
  }
});

test('each page is valid in the ways a crawler cares about', async () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const code of SUPPORTED_LOCALES) {
    const html = guide.renderGuide(code);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${code}: exactly one <h1>`);
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    const desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(!titles.has(title), `${code}: <title> repeats another locale's`);
    assert.ok(!descriptions.has(desc), `${code}: description repeats another locale's`);
    titles.add(title); descriptions.add(desc);
    assert.doesNotMatch(html, /noindex/i, `${code}: the guide exists to be indexed`);
    // No attribute value may be broken by a stray double quote in the copy.
    assert.doesNotMatch(desc + guide.TEXT[code].title, /"/, `${code}: a " in title/description breaks the attribute`);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${code}: duplicate id`);
  }
});

test('the prose is a real guide: 500–1100 words per language', () => {
  for (const code of SUPPORTED_LOCALES) {
    const t = guide.TEXT[code];
    const body = text([t.lead, ...t.sections.map((s) => s.h + ' ' + s.html)].join(' '));
    const words = body.split(' ').length;
    // Korean spaces by phrase (eojeol) rather than by word, so it counts
    // lower for the same text (~630 against ~850) — still inside the band.
    assert.ok(words >= 500 && words <= 1100, `${code}: ${words} words`);
  }
});

test('the guide never names a specific kind of device', () => {
  const offending = [];
  let checked = 0;
  for (const code of SUPPORTED_LOCALES) {
    const rx = BANNED_BY_LOCALE[code];
    assert.ok(rx, `no banned-word pattern for "${code}"`);
    for (const s of proseOf(guide.TEXT[code])) {
      checked += 1;
      if (rx.test(text(s))) offending.push(`${code}: ${text(s).slice(0, 80)}`);
    }
  }
  assert.ok(checked >= SUPPORTED_LOCALES.length * 15, `scanned only ${checked} strings`);
  assert.deepEqual(offending, []);
});

/* The call to action is the one instance-dependent claim on the page. The demo
   button must not be in the bytes where /demo cannot work — a crawler never
   runs the JS that could hide it (.claude/rules/instance-specific-claims-must-
   be-server-rendered.md). The shared test app runs accounts-off, demo-off. */
test('the demo CTA renders only where the demo exists', () => {
  const html = guide.renderGuide('de');
  assert.ok(!html.includes('href="/demo"'), 'no demo link on an instance without the demo');
  assert.ok(html.includes(guide.TEXT.de.cta.openButton));

  const saved = { a: process.env.ACCOUNTS_ENABLED, d: process.env.DEMO_ENABLED, s: process.env.SESSION_SECRET };
  try {
    process.env.ACCOUNTS_ENABLED = 'true';
    process.env.DEMO_ENABLED = 'true';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-secret-for-the-guide-spec';
    const on = guide.renderGuide('fr');
    assert.ok(on.includes('<a class="cta-btn" href="/demo">'), 'demo link missing where the demo is on');
    assert.ok(on.includes(guide.TEXT.fr.cta.demoButton));
    assert.ok(!on.includes(guide.TEXT.fr.cta.openButton));
  } finally {
    for (const [k, v] of [['ACCOUNTS_ENABLED', saved.a], ['DEMO_ENABLED', saved.d], ['SESSION_SECRET', saved.s]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('each page links the other languages, the FAQ in its own, and back', () => {
  for (const code of SUPPORTED_LOCALES) {
    const html = guide.renderGuide(code);
    for (const other of SUPPORTED_LOCALES.filter((c) => c !== code)) {
      assert.ok(html.includes(`href="${encodeURI(guidePath(other))}" hreflang="${other}"`),
        `${code} does not link the ${other} guide`);
    }
    assert.ok(html.includes(`href="/faq?lang=${code}"`), `${code} does not link its FAQ`);
  }
});

test('the FAQ links the guide in the reader\'s language (#1171)', () => {
  for (const code of SUPPORTED_LOCALES) {
    assert.ok(renderFaq(code).includes(`href="${encodeURI(guidePath(code))}"`),
      `the ${code} FAQ does not link the ${code} guide`);
  }
});

/* The pages join the global limiter's exempt set the way robots.txt does
   (lib/app.js). Built on a throwaway app with a ceiling of 2, so the third
   request to an ordinary path is refused and the guide's are not. */
test('the guide pages do not spend the global per-IP budget', async () => {
  const saved = process.env.RATE_LIMIT_MAX;
  process.env.RATE_LIMIT_MAX = '2';
  let limited;
  try { limited = createApp(); } finally { process.env.RATE_LIMIT_MAX = saved; }
  for (let i = 0; i < 4; i++) {
    const res = await request(limited).get(encodeURI(guidePath('ko')));
    assert.equal(res.status, 200, `guide request ${i + 1}: ${res.status}`);
  }
  // Control: the same budget does refuse an ordinary navigation, so the loop
  // above proves an exemption rather than a limiter that never counts.
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await request(limited).get('/round/x')).status);
  assert.deepEqual(codes, [200, 200, 429]);
});
