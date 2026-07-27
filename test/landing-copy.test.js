'use strict';

// Landing positioning (#483). The copy itself is a judgement call and is not
// pinned here — what IS pinned are the two claims in it that can go from true to
// false without anyone noticing, because nothing else in the suite looks at
// marketing text.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'public/js/views-landing.js'), 'utf8');

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
