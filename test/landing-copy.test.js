'use strict';

// Landing positioning (#483, #503). The copy itself is a judgement call and is
// not pinned here — what IS pinned are the claims on the page that can go from
// true to false without anyone noticing, because nothing else in the suite looks
// at marketing text.
//
// A claim goes false two ways, and both are covered: by WORDING (the licence
// term, the unlinked source chip) and by PLACEMENT — a sentence that is true
// about the control it describes and false about the one it ends up next to
// (#503), or one shown on an instance whose config does not back it
// (.claude/rules/hidden-attribute-vs-display-rule.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { CSS, rulesOf, mediaBlocks, outranks, whole } = require('./support/css');
const { bodyOf } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'public/js/views-landing.js'), 'utf8');
const STATS = fs.readFileSync(path.join(ROOT, 'public/js/views-stats.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

/** Loads a lang table the way i18n-parity does — they are browser scripts. */
function loadLocale(name) {
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/lang', `${name}.js`), 'utf8'), context);
  return context.I18N[name];
}

test('no user-facing string calls Spielwirbel "open source" (#483)', () => {
  // LICENSE is PolyForm Noncommercial 1.0.0, which is NOT OSI-approved — the
  // noncommercial restriction fails OSD #6. So "Open Source" in user-facing copy
  // would be a false public claim, the same family as the operator-gated
  // EU-hosting chip in .claude/rules/hidden-attribute-vs-display-rule.md. The
  // honest framing needs no licence term at all, which is why the trust chip is
  // phrased as a benefit ("Code öffentlich einsehbar" / "Code out in the open").
  //
  // Scanned across BOTH locales rather than just the landing keys: the wrong
  // term is just as false in a settings screen or a toast, and a rule that only
  // guards the page where someone happened to think of it is the rule that gets
  // walked around. CONTRIBUTING.md's four mentions are verbatim DCO boilerplate
  // and are deliberately out of scope here — this reads the lang tables only.
  for (const lang of ['de', 'en']) {
    const dict = loadLocale(lang);
    for (const [key, value] of Object.entries(dict)) {
      assert.doesNotMatch(
        String(value),
        /open[\s-]?source/i,
        `${lang}.js "${key}" calls the project open source — it is source-available (PolyForm Noncommercial)`,
      );
    }
  }
});

test('the "code out in the open" chip actually links somewhere (#483)', () => {
  // The chip's whole value is that the claim can be checked. Shipped unlinked it
  // still renders, still reads fine, and quietly asserts something a visitor has
  // no way to act on — a silent failure, since no view test looks at hrefs.
  const m = VIEW.match(/const LANDING_REPO_URL = '([^']+)'/);
  assert.ok(m, 'views-landing.js declares LANDING_REPO_URL');
  assert.match(m[1], /^https:\/\//, 'the repo link must be https — it is rendered on the public landing page');

  const chip = VIEW.match(/<a class="landing-chip landing-chip--link"[\s\S]*?<\/a>/);
  assert.ok(chip, 'the source-code trust chip is still an anchor');
  assert.match(chip[0], /href="\$\{LANDING_REPO_URL\}"/, 'the chip points at LANDING_REPO_URL');
  // rel is not cosmetic on a target="_blank" link: without noopener the opened
  // page gets a window.opener handle back into this origin.
  assert.match(chip[0], /rel="noopener noreferrer"/, 'an external _blank link needs rel="noopener noreferrer"');
});

test('the offer is ONE renderer, and its demo half is gated as a whole (#1090)', () => {
  // The claim this pins is a positioning one: the page must make ONE offer. It
  // used to make two — the hero led with the demo, the closing block with
  // „Registrieren" — because they were two hand-copied blocks that drifted. So
  // what is asserted is that there is one renderer and that every surface goes
  // through it, which is the only property a second copy cannot satisfy.
  const fn = VIEW.match(/function renderLandingOffer\(opts\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'views-landing.js declares renderLandingOffer()');
  assert.match(fn[0], /landing-offer__demo/, 'the demo button lives in the offer');
  assert.match(fn[0], /landing-offer__note/, 'the note lives in the offer, beside its button');
  assert.match(fn[0], /landing-offer__register/, 'the register fallback lives in the offer');

  // Two call sites here (hero + close) and one in views-stats.js. Counting them
  // is what makes a fourth surface with its own copy show up as a red test.
  assert.equal((VIEW.match(/renderLandingOffer\(\{/g) || []).length, 2,
    'the landing renders the offer exactly twice — hero and close');
  assert.match(STATS, /renderLandingOffer\(\{ trust: false \}\)/,
    '/entdecken\u2019s logged-out CTA renders the shared offer, not a copy of it');
  assert.doesNotMatch(STATS, /landing-offer__demo|landing\.hero\.ctaDemo/,
    'views-stats.js must not rebuild the offer — that is how the two pitches drifted');

  // #503's finding, carried forward: a promise of „ohne E-Mail" must never end
  // up labelling a control that needs one. With one primary there is no button
  // row left to sit under, so what replaces that structural guard is the gate —
  // each demo-only element carries the pair itself, so an instance without a
  // demo renders none of them rather than an orphaned caption.
  for (const cls of ['landing-offer__demo', 'landing-offer__note', 'landing-offer__alt']) {
    const el = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*data-demo-only hidden`);
    assert.match(fn[0], el, `.${cls} carries the data-demo-only/hidden pair itself`);
  }
  assert.doesNotMatch(
    fn[0].slice(fn[0].indexOf('landing-offer__register')),
    /data-demo-only/,
    'the register fallback is NOT demo-gated — it is what an instance without a demo shows',
  );
});

test('every demo-gated element in the offer undoes its own display (#1090)', () => {
  // An author `display` rule beats the UA `[hidden] { display: none }`, so an
  // element that declares one and ships hidden is ON SCREEN on an instance with
  // DEMO_ENABLED unset — a dead button under a promise of a demo it does not
  // offer (.claude/rules/hidden-attribute-vs-display-rule.md). `el.hidden` still
  // reports true while it renders, so nothing but the paint shows it.
  //
  // Derived from the stylesheet rather than listed here: any element that
  // declares a display and is gated must have its pair, and a hand-written list
  // would go stale the moment a fourth element joined the offer.
  const gated = ['.landing-offer__note', '.landing-offer__alt', '.landing-offer__trust'];
  for (const sel of gated) {
    assert.ok(bodyOf(sel), `${sel} is declared`);
    const guard = bodyOf(`${sel}[hidden]`)
      || bodyOf('.landing-offer__note[hidden],\n.landing-offer__alt[hidden],\n.landing-offer__trust[hidden]');
    assert.ok(guard, `${sel}[hidden] has no display:none pair`);
    assert.match(guard, /display:\s*none/);
  }
  // The two buttons are covered by `.btn[hidden]`, which predates this block —
  // asserted rather than assumed, because dropping it would break them silently.
  assert.match(bodyOf('.btn[hidden]') || '', /display:\s*none/,
    '.btn[hidden] is what hides the demo and register buttons');
});

test('no rule can out-rank `.landing-chip[hidden]` and publish the EU claim (#1090)', () => {
  // The EU-hosting claim is true only on the operator's configured instance; on a
  // self-hoster's non-EU box it is a false public statement, which is the whole
  // reason it ships `hidden` (.claude/rules/hidden-attribute-vs-display-rule.md).
  //
  // §3 of that rule is what this guards, and it is NOT hypothetical here: #1090's
  // own phone rule re-published the claim. `.landing-chip[hidden]` is (0,2,0) and
  // `.landing-offer__trust .landing-chip` is (0,2,0) too — a TIE, decided by source
  // order, which the later block won. Measured on the page before the fix:
  // `el.hidden === true` with `getComputedStyle(el).display === 'inline'`, i.e. the
  // claim on screen while every DOM probe said it was hidden.
  //
  // So the invariant is cascade-level rather than about one selector: ANY rule
  // that gives a `.landing-chip` a display must either lose to the guard on
  // specificity or exclude `[hidden]` itself. Media blocks are swept too — the
  // rule that caused this lived in one, which is exactly where nobody looks.
  const guard = '.landing-chip[hidden]';
  const everywhere = [
    ...rulesOf(CSS).map(([sel, body]) => [sel, body, '']),
    ...mediaBlocks(CSS).flatMap(([q, css]) => rulesOf(css).map(([sel, body]) => [sel, body, ` in @media ${q.trim()}`])),
  ];
  // The chip must be the SUBJECT of the rule, not merely somewhere in it: a rule
  // that hides a descendant (`.landing-chip .ti`) says nothing about the chip's
  // own display, and counting it would make the sweep flag correct rules.
  const subjectIsChip = (sel) => sel.split(',').some((part) =>
    whole('.landing-chip').test(part.trim().split(/\s+|\s*>\s*/).pop() || ''));
  const setters = everywhere.filter(([sel, body]) =>
    subjectIsChip(sel) && /(?:^|;|\{)\s*display:/.test(body));
  assert.ok(setters.length >= 2,
    'expected at least the base rule and the [hidden] guard — the sweep found nothing to check');

  let guarded = 0;
  for (const [sel, body, where] of setters) {
    if (sel.includes('[hidden]') && /display:\s*none/.test(body)) { guarded++; continue; }
    // Every OTHER display setter is safe only if the guard STRICTLY out-ranks it
    // — a tie is decided by source order, which is what shipped the bug — or if
    // it refuses to match a hidden chip at all.
    const safe = outranks(guard, sel) || sel.includes(':not([hidden])');
    assert.ok(safe,
      `"${sel}"${where} gives .landing-chip a display at or above the specificity of `
      + `${guard} without excluding [hidden] — the operator-gated EU claim renders on every instance`);
  }
  assert.ok(guarded >= 1, `${guard} itself is gone — nothing hides the gated claim any more`);
});

test('the static crawlable hero in index.html matches lang/de.js (#510)', () => {
  // index.html carries a copy of the hero because the served HTML otherwise has
  // no body text at all and a crawler that runs no JS sees an empty document.
  // It is a genuine duplicate with no way to share the source — index.html is
  // static, with no templating (the same bind as public/kontakt.html's design
  // tokens) — so this parity test IS the licence for the copy
  // (.claude/rules/shared-constants-across-the-stack.md). Retune the German
  // hero copy in one place and this goes red naming both values.
  //
  // Drift here is silent in the worst way: the page still renders correctly for
  // every human visitor, because showLanding() overwrites the static markup on
  // boot. Only the crawler — the one audience this markup exists for — keeps
  // reading the stale wording.
  const de = loadLocale('de');
  const text = (re, what) => {
    const m = INDEX.match(re);
    assert.ok(m, `index.html: no static ${what} found — the crawlable hero is gone`);
    return m[1].trim();
  };

  assert.equal(text(/<h1 class="landing-hero__title">([\s\S]*?)<\/h1>/, 'hero title'),
    de['landing.hero.title']);
  assert.equal(text(/<p class="landing-hero__sub">([\s\S]*?)<\/p>/, 'hero sub-line'),
    de['landing.hero.sub']);
  assert.equal(text(/<div class="landing-hero__brand">[\s\S]*?<span>([\s\S]*?)<\/span>/, 'hero brand'),
    de['app.title']);
});

test('lang/de.js reproduces the static <title> byte for byte (#566)', () => {
  // Same licensed-duplicate shape as the hero test above, one element further up
  // the document. The <title> stays static German because a crawler runs no JS
  // and has no locale (#436/#510); i18n.js then overwrites it client-side from
  // 'app.tabTitle'. Those two must agree exactly, or a German visitor watches the
  // tab flicker to a different wording on boot — the one audience this feature is
  // NOT for, and the only one who would notice.
  //
  // Nothing else looks at both: the SEO tests read the served bytes and the
  // parity test reads the lang tables, so the two could drift indefinitely.
  const de = loadLocale('de');
  const m = INDEX.match(/<title>([\s\S]*?)<\/title>/);
  assert.ok(m, 'index.html still has a static <title>');
  assert.equal(m[1].trim(), de['app.tabTitle']);
});

test('the static hero carries no config-gated claim (#510)', () => {
  // The static markup cannot be gated on GET /api/config, so anything
  // operator- or demo-conditional would be published unconditionally — including
  // on a self-hoster's non-EU box. That is precisely the failure
  // .claude/rules/hidden-attribute-vs-display-rule.md exists to prevent, and it
  // would be invisible here: the claim is replaced by the real, correctly gated
  // hero milliseconds later, so only a crawler (or a screenshot of the first
  // paint) would ever show it.
  // PARSED, not regex-matched over the raw text. `/<main id="app"[\s\S]*?<\/main>/`
  // binds to the first occurrence of that string in the file — and a COMMENT
  // mentioning `<main id="app">` is one, so the block then starts several lines
  // early and sweeps in whatever precedes the real element. #525 detonated
  // exactly that: its <noscript> is documented in prose naming the tag, and the
  // widened block swallowed the demo and terms banners, whose <button>s made
  // this assertion fail against markup that is entirely correct.
  //
  // Parsing is the remedy .claude/rules/css-text-assertions-strip-comments.md
  // prescribes for HTML specifically — a comment is not an element, so the
  // mistake becomes unrepresentable, where a `<!--…-->` strip would buy a
  // high-severity CodeQL js/incomplete-multi-character-sanitization alert for a
  // regex. A bare JSDOM of the file: nothing runs, so this is the served markup.
  const main = new JSDOM(INDEX).window.document.querySelector('main#app');
  assert.ok(main, 'index.html still has a <main id="app">');
  assert.equal(main.querySelector('[data-operator-only]'), null,
    'no operator-gated claim in the static hero');
  assert.equal(main.querySelector('[data-demo-only]'), null,
    'no demo-gated CTA in the static hero');
  // Buttons would be dead until main.js boots and wires them.
  assert.equal(main.querySelector('button'), null,
    'the static hero holds no controls — nothing wires them yet');
});

test('the landing takes every colour from the theme variables (#503, #1090)', () => {
  // A literal pastel here would clash the moment --brand is retuned, and the
  // landing page renders on the default theme rather than a round's chosen one,
  // so nothing else would ever surface the mismatch
  // (.claude/rules/theme-derived-colors.md). The tinted box the demo used to sit
  // in went with #1090 — what carries a tint now is the trust chip and the top
  // bar's „Anmelden", so those are what this checks.
  for (const sel of ['.landing-chip', '.topbar__login', '.landing-claim__icon']) {
    const body = bodyOf(sel) || '';
    assert.ok(body, `${sel} is declared`);
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `no literal hex in ${sel}`);
  }
  assert.match(bodyOf('.topbar__login') || '', /background:\s*var\(--brand-tint-soft\)/);
  assert.match(bodyOf('.topbar__login') || '', /border-color:[^;]*var\(--brand-edge\)/);
});
