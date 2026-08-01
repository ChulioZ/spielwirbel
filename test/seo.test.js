'use strict';

// The crawler surface (issue #510): robots.txt, sitemap.xml, the noindex on the
// two standalone pages, and the static hero in the served shell.
//
// Everything here is asserted over HTTP rather than against the files, because
// the defect this fixes was a SERVING one: no robots.txt existed, so the SPA
// fallback answered /robots.txt with the app shell at `200 text/html`. A file
// that is present but shadowed, and a file that is absent, both look like a
// working robots.txt from anywhere except the response's content type — which
// is why the type is pinned as hard as the body.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const request = require('supertest');
const { app } = require('./helpers');

const ROOT = path.join(__dirname, '..');

/** The `Disallow:` paths in a robots.txt body, comments stripped. */
function disallowRules(body) {
  return body
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => /^Disallow:/i.test(l))
    .map((l) => l.slice('Disallow:'.length).trim())
    .filter(Boolean);
}

/*
 * Does a robots.txt rule match a path? A rule is a PREFIX, with `*` as a
 * wildcard for any run of characters.
 *
 * Deliberately plain string walking rather than building a RegExp out of the
 * rule: escaping a pattern for reuse as a pattern is the thing CodeQL's
 * js/incomplete-sanitization flags, and it was right to — the first version
 * escaped `/` but not `\`. There is nothing to get wrong here.
 */
function robotsRuleMatches(rule, urlPath) {
  const parts = rule.split('*');
  if (!urlPath.startsWith(parts[0])) return false;
  let at = parts[0].length;
  for (const part of parts.slice(1)) {
    if (part === '') continue;
    const found = urlPath.indexOf(part, at);
    if (found === -1) return false;
    at = found + part.length;
  }
  return true;
}

/** Loads a lang table the way i18n-parity does — they are browser scripts. */
function loadLocale(name) {
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/lang', `${name}.js`), 'utf8'), context);
  return context.I18N[name];
}

test('GET /robots.txt is a real text/plain policy, not the app shell', async () => {
  const res = await request(app).get('/robots.txt');
  assert.equal(res.status, 200);
  // The whole point: before #510 this was `text/html` and ~11 KB of index.html.
  assert.match(res.headers['content-type'], /^text\/plain/);
  assert.doesNotMatch(res.text, /<html/i);
  assert.match(res.text, /^User-agent: \*$/m);
  assert.match(res.text, /^Sitemap: https:\/\/spielwirbel\.app\/sitemap\.xml$/m);
});

test('robots.txt disallows the surfaces that have no head of their own', async () => {
  // Only paths that cannot carry a per-page noindex: the API, user uploads, and
  // the unbounded /round/ id space (all served the identical shell, whose
  // canonical already points at the front door). Anything that IS an HTML page
  // we ship uses noindex instead — see the next test for why.
  const res = await request(app).get('/robots.txt');
  const rules = disallowRules(res.text);
  for (const p of ['/api/', '/uploads/', '/round/']) {
    assert.ok(rules.includes(p), `robots.txt should disallow ${p} (has: ${rules.join(', ')})`);
  }
});

test('robots.txt disallows NO page that carries a noindex (#510)', async () => {
  // The trap this pins, and the reason the two mechanisms are not
  // interchangeable: a Disallow stops the fetch, so the crawler never reads the
  // page's `noindex` and the existing index entry survives indefinitely.
  // Crawl-allowed + noindex is the only pair that REMOVES an indexed page, and
  // removing login.html's entry is the entire point of the issue.
  //
  // The page list is DERIVED from the files rather than written out, so a page
  // that gains a noindex later is covered without anyone remembering this test —
  // that is how admin.html was caught: it has carried a noindex since #268 and
  // was nonetheless disallowed here in this issue's first draft, which would
  // have frozen its entry had it ever been indexed (and advertised the admin
  // path in a file crawlers and scanners both read).
  //
  // Matching is a scan of every Disallow rather than a literal per-page check,
  // so a future `Disallow: /*.html` or `Disallow: /login*` is caught too — the
  // mistake reappears as a pattern far more easily than as an exact path.
  const noindexPages = fs.readdirSync(path.join(ROOT, 'public'))
    .filter((f) => f.endsWith('.html'))
    .filter((f) => /<meta name="robots" content="noindex/.test(
      fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')))
    .map((f) => '/' + f);
  assert.ok(noindexPages.length >= 3,
    `expected at least login/kontakt/admin to be noindex, found ${noindexPages.join(', ')}`);

  const res = await request(app).get('/robots.txt');
  for (const page of noindexPages) {
    for (const rule of disallowRules(res.text)) {
      assert.ok(!robotsRuleMatches(rule, page),
        `robots.txt rule "Disallow: ${rule}" blocks ${page} — its noindex can then never be read`);
    }
  }
});

test('the standalone pages served on every instance carry a noindex', async () => {
  for (const page of ['/login.html', '/kontakt.html', '/admin.html']) {
    const res = await request(app).get(page);
    assert.equal(res.status, 200, `${page} is still served`);
    assert.match(res.text, /<meta name="robots" content="noindex, nofollow"\s*\/?>/,
      `${page} must be noindex — it is served on every instance regardless of auth mode`);
  }
});

test('GET /sitemap.xml is valid XML listing the public pages', async () => {
  const res = await request(app).get('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /xml/);
  assert.doesNotMatch(res.text, /<html/i);
  assert.match(res.text, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

  const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [
    'https://spielwirbel.app/',
    // The FAQ (#489) is server-rendered prose, so a crawler reads it whole
    // without running JS — the one page besides these that is worth indexing.
    'https://spielwirbel.app/faq',
    'https://spielwirbel.app/impressum',
    'https://spielwirbel.app/datenschutz',
    'https://spielwirbel.app/nutzungsbedingungen',
  ]);
  // Every entry must be on the canonical host, or the sitemap advertises URLs
  // that 301 (lib/canonical.js consolidates .de/.com onto .app).
  for (const loc of locs) assert.match(loc, /^https:\/\/spielwirbel\.app\//);
});

test('the sitemap lists no private or noindex URL', async () => {
  const res = await request(app).get('/sitemap.xml');
  const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const loc of locs) {
    assert.doesNotMatch(loc, /\/round\/|\/api\/|\/uploads\/|login\.html|kontakt\.html|admin\.html/,
      `${loc} must not be in the sitemap`);
  }
});

test('the raw HTML of GET / carries the hero as crawlable BODY text (#510)', async () => {
  // The served bytes, with no JS run — exactly what a non-rendering crawler
  // sees. Before #510 this document's <body> held no prose at all.
  //
  // Scoped to <main id="app">, and that scoping is the whole test. Both hero
  // strings ALSO occur in the head — `landing.hero.title` inside <title>, and
  // `landing.hero.sub` verbatim as <meta name="description"> and og:description
  // (#436/#430) — so the obvious `res.text.includes(…)` is vacuously true
  // against a document with no body content whatsoever. Verified: it passed with
  // the static hero deleted outright, which is precisely the regression it is
  // supposed to catch.
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);

  const main = res.text.match(/<main id="app"[\s\S]*?<\/main>/);
  assert.ok(main, 'the served shell still has a <main id="app">');

  // Read the two elements' own text rather than stripping comments and tags out
  // of the block. Both are `[^<]*`, so a comment can never be mistaken for
  // content (which is what CodeQL's js/incomplete-multi-character-sanitization
  // flagged about the strip-then-search version), and the assertion gets
  // stricter: the copy has to be THE HEADING, not merely present somewhere.
  const de = loadLocale('de');
  const el = (re, what) => {
    const m = main[0].match(re);
    assert.ok(m, `the served <main> has no ${what} — the crawlable hero is gone`);
    return m[1].trim();
  };

  assert.equal(el(/<h1 class="landing-hero__title">([^<]*)<\/h1>/, 'hero heading'),
    de['landing.hero.title'],
    'the hero heading must be real body text, not only a <title>/<meta> value');
  assert.equal(el(/<p class="landing-hero__sub">([^<]*)<\/p>/, 'hero sub-line'),
    de['landing.hero.sub'],
    'the hero sub-line must be real body text, not only a <meta description> value');
});

test('a deep link still serves the same generic shell (#430 stays true)', async () => {
  // The static hero rides the SPA fallback, so it is now returned for /round/…
  // too. That must stay as generic as the link-preview card: no round id, no
  // tenant data. Pinned here because #510 is what put body text on that
  // response for the first time.
  const res = await request(app).get('/round/some-round-id/regal');
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes('some-round-id'), 'the shell must not echo the requested path');

  const home = await request(app).get('/');
  assert.equal(res.text, home.text, 'every route is served the identical document');
});
