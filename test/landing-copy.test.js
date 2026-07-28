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
const { bodyOf } = require('./support/css');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'public/js/views-landing.js'), 'utf8');
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

test('the demo note sits inside the demo block, not under the CTA row (#503)', () => {
  // The defect this pins is a CLAIM going false by adjacency rather than by
  // wording: `.landing-hero__cta` wraps, so a note rendered after it landed
  // under „Anmelden" at 375px and at 1600px alike — "start now, no e-mail"
  // labelling the two actions that do need one. Structure is the fix, so
  // structure is what is asserted; the copy keys are deliberately untouched.
  const block = VIEW.match(/<div class="landing-hero__demo"[\s\S]*?<\/div>/);
  assert.ok(block, 'the hero renders a .landing-hero__demo wrapper');
  assert.match(block[0], /id="landingDemo"/, 'the demo button lives in the demo block');
  assert.match(block[0], /landing-hero__demo-note/, 'the demo note lives in the demo block, beside its button');

  // The gate rides the wrapper alone: on its children it would leave an empty
  // tinted box on a demo-less instance, which is worse than the bug it fixes.
  assert.match(block[0], /<div class="landing-hero__demo" data-demo-only hidden>/,
    'the demo block carries the data-demo-only/hidden pair itself');
  const cta = VIEW.match(/<div class="landing-hero__cta">[\s\S]*?<\/div>/);
  assert.ok(cta, 'the hero still renders a .landing-hero__cta row');
  assert.doesNotMatch(cta[0], /data-demo-only|landingDemo/,
    'nothing demo-gated may sit in the CTA row — that is what put the note under „Anmelden"');
});

test('.landing-hero__demo[hidden] undoes its own display (#503)', () => {
  // `.landing-hero__demo` declares `display: flex`, and an author rule beats the
  // UA `[hidden] { display: none }` — so without the pair below, an instance
  // with DEMO_ENABLED unset renders a dead button beneath a promise of a demo it
  // does not offer (.claude/rules/hidden-attribute-vs-display-rule.md). Same
  // failure family as the operator-gated EU-hosting chip, and just as invisible:
  // `el.hidden` still reports true while the block is on screen.
  assert.match(bodyOf('.landing-hero__demo') || '', /display:\s*flex/,
    '.landing-hero__demo declares its own display, which is why the guard below is needed');
  const guard = bodyOf('.landing-hero__demo[hidden]');
  assert.ok(guard, '.landing-hero__demo[hidden] rule not found');
  assert.match(guard, /display:\s*none/);
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

test('the static hero carries no config-gated claim (#510)', () => {
  // The static markup cannot be gated on GET /api/config, so anything
  // operator- or demo-conditional would be published unconditionally — including
  // on a self-hoster's non-EU box. That is precisely the failure
  // .claude/rules/hidden-attribute-vs-display-rule.md exists to prevent, and it
  // would be invisible here: the claim is replaced by the real, correctly gated
  // hero milliseconds later, so only a crawler (or a screenshot of the first
  // paint) would ever show it.
  const main = INDEX.match(/<main id="app"[\s\S]*?<\/main>/);
  assert.ok(main, 'index.html still has a <main id="app">');
  assert.doesNotMatch(main[0], /data-operator-only/, 'no operator-gated claim in the static hero');
  assert.doesNotMatch(main[0], /data-demo-only/, 'no demo-gated CTA in the static hero');
  // Buttons would be dead until main.js boots and wires them.
  assert.doesNotMatch(main[0], /<button/, 'the static hero holds no controls — nothing wires them yet');
});

test('the hero demo block takes every colour from the theme variables (#503)', () => {
  // A literal pastel here would clash the moment --brand is retuned, and the
  // landing page renders on the default theme rather than a round's chosen one,
  // so nothing else would ever surface the mismatch
  // (.claude/rules/theme-derived-colors.md).
  const body = bodyOf('.landing-hero__demo') || '';
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, 'no literal hex in .landing-hero__demo');
  assert.match(body, /background:\s*var\(--brand-tint-soft\)/);
  assert.match(body, /border:[^;]*var\(--brand-edge\)/);
});
