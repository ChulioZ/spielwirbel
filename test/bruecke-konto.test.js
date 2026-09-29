'use strict';

/* Die Brücke's sign-in, Konto and design cards (#1242, B5.1-B5.4).
 *
 * The generic sweeps already hold most of this slice: test/design-layer.test.js
 * refuses a colour literal outside bruecke.css's root blocks, the contrast
 * harness measures every token the rules read, and test/bruecke-tokens.test.js
 * checks faces and the --ink-dim ban over the whole file. What none of them can
 * see is below:
 *
 *   1. No other design's colour enters bruecke.css (the issue's acceptance
 *      line, Tisch A8 / Ocean R4) — the swatches paint from registry data.
 *   2. The Konto cards under Brücke carry B5.2's parts — each design's own
 *      swatch, its scheme, the „Deins" mark — with Klassisch first as „Wie
 *      bisher"; and Klassisch's own section is untouched.
 *   3. Every text link on the auth screens is sized at target-min.
 *
 * The layout (four across at 1440, rows at 390) is CSS jsdom cannot apply; it
 * was measured in Chromium at both widths, links included.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { loadApp, flush } = require('./support/dom');
const { rulesOf } = require('./support/css');
const { contrast, token } = require('./support/theme');
const { DESIGN_REGISTRY, CLASSIC_DESIGN, designById } = require('../public/js/designs');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

const BRUECKE = designById('bruecke');
const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'bruecke.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const ALL = { designs: DESIGN_REGISTRY.map((d) => d.id) };
const plain = (v) => JSON.parse(JSON.stringify(v));

function boot(t, design, me) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('withAppConfig', (cb) => cb(ALL));
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => !!me);
  dom.set('toast', () => {});
  if (me) dom.run(`accountUser = ${JSON.stringify(me)}`);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return dom;
}

const colours = (d) => [d.page, d.accent, ...(d.poster ? [...d.poster.ground, d.poster.ink, d.poster.sub] : [])]
  .filter(Boolean).map((c) => c.toLowerCase());

/* --------------------------- 1. foreign colours ------------------------------ */

test('#1242: no other design\'s colour is declared in bruecke.css', () => {
  const sheet = SHEET.toLowerCase();
  const own = colours(BRUECKE);
  const foreign = [];
  for (const d of DESIGN_REGISTRY.filter((x) => x.id !== 'bruecke')) {
    for (const hex of colours(d)) {
      if (own.includes(hex)) continue; // a hex Brücke declares as its own is not foreign
      if (sheet.includes(hex)) foreign.push(`${d.id} ${hex}`);
    }
  }
  // Anti-vacuous: the scan must have something to look for.
  assert.ok(DESIGN_REGISTRY.filter((x) => x.id !== 'bruecke' && x.poster).length >= 3,
    'fewer than three other designs carry poster colours — this test checks nothing');
  assert.deepEqual(foreign, [], 'a swatch colour belongs to its design\'s registry row, not to bruecke.css');
});

test('#1242: Brücke\'s own poster is B1\'s page gradient, and the swatch reads the poster', () => {
  assert.deepEqual(BRUECKE.poster.ground, ['#10203a', BRUECKE.page]);
  assert.equal(BRUECKE.poster.ink, BRUECKE.accent);
  const rule = rulesOf(SHEET).find(([sel, body]) => /\.design-tile--swatch/.test(sel) && /linear-gradient/.test(body));
  assert.ok(rule, 'no swatch gradient in bruecke.css');
  assert.match(rule[1], /var\(--poster-top/);
  assert.match(rule[1], /var\(--poster-foot/);
});

/* --------------------------- 2. the Konto cards ------------------------------ */

/* The picker's „Hell"/„Dunkel" line reads `scheme` and falls back to „Hell"
   for a row without one — so a dark design that forgot the field would be
   labelled light with nothing going red. Every row states it instead. */
test('#1242: every registry row declares its scheme explicitly', () => {
  const missing = DESIGN_REGISTRY.filter((d) => !['light', 'dark'].includes(d.scheme))
    .map((d) => `${d.id}: ${JSON.stringify(d.scheme)}`);
  assert.deepEqual(missing, [], 'a design row without scheme: \'light\' | \'dark\'');
  assert.equal(designById(CLASSIC_DESIGN).scheme, 'light');
  assert.equal(BRUECKE.scheme, 'dark');
});

const ME = { id: 'u1', design: 'bruecke', designChooserSeen: null };

test('#1242: under Brücke every design is a swatch card — Klassisch first as „Wie bisher", the worn one „Deins"', (t) => {
  const dom = boot(t, 'bruecke', ME);
  const wrap = dom.call('buildDesignSection', { ...ME });
  const cards = [...wrap.querySelectorAll('.design-card')];
  assert.deepEqual(cards.map((c) => c.querySelector('input').value), DESIGN_REGISTRY.map((d) => d.id));
  assert.equal(cards[0].querySelector('input').value, CLASSIC_DESIGN);
  assert.equal(cards[0].querySelector('.design-card__badge').textContent, 'Wie bisher');

  for (const card of cards) {
    const design = designById(card.querySelector('input').value);
    const swatch = card.querySelector('.design-tile--swatch');
    assert.ok(swatch, `${design.id} has no swatch`);
    assert.equal(swatch.getAttribute('aria-hidden'), 'true');
    if (design.poster) {
      assert.equal(swatch.style.getPropertyValue('--poster-top'), design.poster.ground[0], `${design.id} swatch top`);
      assert.equal(swatch.style.getPropertyValue('--poster-foot'), design.poster.ground[1], `${design.id} swatch foot`);
    }
    assert.equal(card.querySelector('.design-card__scheme').textContent,
      design.scheme === 'dark' ? 'Dunkel' : 'Hell', `${design.id} scheme line`);
    assert.equal(card.querySelector('.design-card__desc'), null, 'B5.2 prints the name and scheme, no sentence');
    const mark = card.querySelector('.design-card__mine');
    assert.ok(mark && mark.getAttribute('aria-hidden') === 'true', `${design.id} has no hidden „Deins" mark`);
    assert.equal(mark.textContent.trim(), 'Deins');
  }
  // Exactly one card is the worn one, and it is Brücke.
  const on = cards.filter((c) => c.classList.contains('is-on'));
  assert.deepEqual(on.map((c) => c.querySelector('input').value), ['bruecke']);
  // The mark shows on the picked card only — a CSS rule keyed on .is-on.
  assert.ok(rulesOf(SHEET).some(([sel, body]) => /\.design-card\.is-on \.design-card__mine/.test(sel) && /display:\s*inline-flex/.test(body)),
    'no rule reveals „Deins" on the picked card');
});

test('#1242: picking Brücke on the Konto stores it and applies it app-wide', async (t) => {
  const me = { ...ME, design: CLASSIC_DESIGN };
  const dom = boot(t, CLASSIC_DESIGN, me);
  const sent = [];
  dom.set('accountApi', (method, p, body) => {
    sent.push([method, p, body]);
    return Promise.resolve({ ...me, design: body.design });
  });
  const wrap = dom.call('buildDesignSection', me);
  dom.document.body.appendChild(wrap);
  dom.run('currentView = null'); // the re-render is the Konto's own business
  const radio = wrap.querySelector('.design-card input[value="bruecke"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.deepEqual(plain(sent), [['PATCH', '/me', { design: 'bruecke' }]]);
  assert.equal(dom.document.documentElement.dataset.design, 'bruecke');
  assert.equal(dom.document.documentElement.dataset.scheme, 'dark');
});

test('#1242: Klassisch\'s design cards never get Brücke\'s parts', (t) => {
  const me = { ...ME, design: CLASSIC_DESIGN };
  const dom = boot(t, CLASSIC_DESIGN, me);
  const wrap = dom.call('buildDesignSection', me);
  assert.equal(wrap.querySelector('.design-tile--swatch, .design-card__scheme, .design-card__mine'), null);
  assert.equal(wrap.querySelectorAll('.design-card__desc').length, DESIGN_REGISTRY.length);
});

test('#1242: the Konto composes as plates under Brücke (and Ocean), never under Klassisch', (t) => {
  for (const [design, want] of [['bruecke', true], ['ocean', true], [CLASSIC_DESIGN, false]]) {
    const dom = boot(t, design, { ...ME, design });
    assert.equal(dom.call('kontoAsCards'), want, design);
  }
});

test('#1242: „Deins" and the scheme line clear AA where they are painted', () => {
  // The mark is small text on the cyan fill: the night ink, never the accent.
  assert.ok(contrast(token('--on-accent', BRUECKE), token('--brand', BRUECKE)) >= 4.5);
  // The scheme line and the badge sit on the plate.
  assert.ok(contrast(token('--ink-soft', BRUECKE), token('--surface', BRUECKE)) >= 4.5);
  assert.ok(contrast(token('--brand', BRUECKE), token('--surface', BRUECKE)) >= 4.5);
});

/* ------------------------------ 3. the links --------------------------------- */

test('#1242: every text link on the auth screens is sized at target-min', () => {
  const rules = rulesOf(SHEET);
  const sized = (needle) => rules.some(([sel, body]) =>
    sel.split(',').some((s) => s.includes(needle)) && /min-height:\s*var\(--target-min\)/.test(body));
  // The two cross-links and „Passwort vergessen?" are .link-btn, the legal line
  // holds two bare <a>. B5.1 draws „Registrieren" at 24px (review A2).
  assert.ok(sized('.link-btn'), '.link-btn is not at target-min');
  assert.ok(sized('.auth__terms a'), 'the legal line\'s links are not at target-min');
  const terms = rules.find(([sel]) => sel.includes('.auth__terms a'));
  assert.match(terms[1], /display:\s*inline-flex/, 'min-height does nothing on an inline <a>');
});

/* The Konto foot note calls what a switch changes by the SECTION's own name
   („Design"), not by a synonym („Aussehen") — one thing, one word on one card.
   Read from the parsed dictionaries, so comments cannot satisfy it. The FIRST
   sentence already names the design („Klassisch ist das Design …"), so only
   the last one is checked — that is where the synonym sat. */
test('#1242: the Konto foot note names the section by its title word, in every locale', () => {
  const off = [];
  for (const locale of SUPPORTED_LOCALES) {
    const ctx = { I18N: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lang', `${locale}.js`), 'utf8'), ctx);
    const dict = ctx.I18N[locale];
    const title = dict['konto.design.title'].toLowerCase();
    const sentences = dict['konto.design.note'].split(/[.!?。]\s+/).filter(Boolean);
    const last = sentences[sentences.length - 1].toLowerCase();
    if (sentences.length < 2 || !last.includes(title)) off.push(`${locale}: „${last}" lacks „${title}"`);
  }
  assert.ok(SUPPORTED_LOCALES.length >= 9, 'fewer than nine locales — this checks less than it claims');
  assert.deepEqual(off, []);
});
