'use strict';

/* Der Tisch as SPIELWIRBEL'S FACE (#1198) — the logged-out landing and the
 * logged-out statistics, in public/css/designs/tisch.css, plus the design band
 * the issue asks the landing to carry.
 *
 * Most of this slice is repaint and is covered generically, as for every Tisch
 * slice: test/tisch-hub-lobby.test.js derives "a rule reading a scheme-gated
 * token is itself scheme-gated", and test/design-layer.test.js refuses a colour
 * literal outside the root blocks. The pages OUTSIDE the SPA are pinned by
 * test/standalone-page-brand.test.js. What neither can see is below: that
 * Klassisch is untouched by the one element this slice adds, that the band
 * states a count the instance can back, and the ink pairs this slice puts on a
 * ground no design-wide sweep pairs it with.
 *
 * Named `tisch-face`, not `landing-*`: three landing specs already exist, and a
 * spec that overwrites a sibling is silent in both directions
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf, bodyOf } = require('./support/css');
const { contrast, token } = require('./support/theme');
const { designById, DESIGN_REGISTRY } = require('../public/js/designs');
const { loadApp } = require('./support/dom');

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rulesOf(SHEET);
const TISCH = designById('tisch');
const AA = 4.5;

const rulesMatching = (needle) => RULES.filter(([sel]) => sel.replace(/\s+/g, ' ').includes(needle));

/* ---- Klassisch is exactly what it was ------------------------------------ */

test('#1198: styles.css keeps the design band off, so Klassisch renders no band at all', () => {
  // The band is markup every design receives; only a design that asks shows it.
  // Without this rule the landing a visitor sees TODAY would grow a section.
  assert.match(bodyOf('.landing-designs') || '', /display:\s*none/);
});

test('#1198: only Der Tisch turns the band on, and only once it has content', () => {
  const on = rulesMatching('.landing-designs:not(:empty)');
  assert.ok(on.length >= 1, 'tisch.css no longer shows the band');
  for (const [sel] of on) {
    // Scheme-gated like every colour rule here, and `:not(:empty)` because a
    // failed /api/config leaves the section EMPTY — a felt bar with nothing on it.
    assert.match(sel, /:root\[data-design="tisch"\]\[data-scheme="dark"\]/);
  }
  // Nothing else in the sheet displays it unconditionally.
  const bare = RULES.filter(([sel, body]) => /\.landing-designs(?![_\w:-])/.test(sel) && !/:not\(:empty\)/.test(sel) && /display\s*:/.test(body));
  assert.deepEqual(bare.map(([s]) => s), []);
});

test('#1198: „Code öffentlich einsehbar" leaves the trust row under Der Tisch only', () => {
  const hide = rulesMatching('.landing-offer__source');
  assert.equal(hide.length, 1, 'expected exactly one rule for the source chip');
  assert.match(hide[0][0], /^:root\[data-design="tisch"\]/);
  assert.match(hide[0][1], /display:\s*none/);
  // …and styles.css does not touch the hook, so Klassisch keeps the chip.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.ok(!/landing-offer__source/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
});

/* ---- the band, rendered --------------------------------------------------- */

function boot(t, cfg) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/config')) {
      return cfg ? { ok: true, json: async () => cfg } : { ok: false, json: async () => ({}) };
    }
    if (String(url).startsWith('/api/stats/public')) return { ok: false, status: 404, json: async () => ({}) };
    throw new Error(`unexpected fetch: ${url}`);
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  return dom;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('#1198: the band names the designs the instance OFFERS, and counts those', async (t) => {
  const ids = DESIGN_REGISTRY.map((d) => d.id);
  assert.ok(ids.length >= 2, 'the registry needs two designs for this test to mean anything');
  const dom = boot(t, { designs: ids });
  await dom.call('showLanding');
  await settle();

  const band = dom.document.querySelector('.landing-designs');
  assert.ok(band, 'the band was removed although the instance offers a choice');
  // The count is the server's, never the sheet's „Sieben": production offers only
  // the enabled designs, and a public page promising more is contradicted one
  // click later by the chooser.
  assert.equal(band.querySelector('.landing-designs__title').textContent,
    dom.call('t', 'landing.designs.title', { n: ids.length }));
  assert.match(band.querySelector('.landing-designs__title').textContent, new RegExp(`^${ids.length}\\b`));
  const items = [...band.querySelectorAll('.landing-design')];
  assert.equal(items.length, ids.length);

  // Each poster wears its OWN design's material; Klassisch declares none and so
  // falls back to the shared defaults rather than restating them in JS.
  const tile = (i) => items[i].querySelector('.design-tile').style.getPropertyValue('--tile-page');
  assert.equal(tile(ids.indexOf('klassisch')), '');
  assert.equal(tile(ids.indexOf('tisch')), TISCH.page);
  assert.equal(items[ids.indexOf('tisch')].querySelector('.landing-design__name').textContent,
    dom.call('t', TISCH.labelKey));
});

test('#1198: one design is not a choice — the band leaves the page', async (t) => {
  const dom = boot(t, { designs: ['klassisch'] });
  await dom.call('showLanding');
  await settle();
  assert.equal(dom.document.querySelector('.landing-designs'), null);
});

test('#1198: a failed /api/config removes the band rather than leaving a shell', async (t) => {
  const dom = boot(t, null);
  await dom.call('showLanding');
  await settle();
  // withAppConfig hands the callback null on a non-ok answer; offeredDesigns()
  // reads that as the face alone, which is below the bar.
  assert.equal(dom.document.querySelector('.landing-designs'), null);
});

/* ---- the ink pairs this slice introduces ---------------------------------- */

test('#1198: every ink this slice sets clears AA on the ground it is set on', () => {
  const v = (name) => token(name, TISCH);
  const pairs = [
    // The hero on felt: claim, sub-line, trust row and the register link.
    ['--felt-ink on --felt', '--felt-ink', '--felt'],
    ['--felt-ink-soft on --felt', '--felt-ink-soft', '--felt'],
    // The step numeral and the band's posters' names, on the felt's deep stop.
    ['--felt-ink on --felt-deep', '--felt-ink', '--felt-deep'],
    // The wordmark and claim plates: brass, both stops.
    ['--on-accent on --brass-hi', '--on-accent', '--brass-hi'],
    ['--on-accent on --gold-deep', '--on-accent', '--gold-deep'],
    // The claims boards and the stats tallies, on walnut.
    ['--ink-soft on --surface', '--ink-soft', '--surface'],
    ['--gold on --surface', '--gold', '--surface'],
    // The standalone pages' paper: FAQ and legal body text and links.
    ['--paper-ink on --paper-raised', '--paper-ink', '--paper-raised'],
    ['--paper-ink-soft on --paper-raised', '--paper-ink-soft', '--paper-raised'],
    ['--accent-deep on --paper-raised', '--accent-deep', '--paper-raised'],
  ];
  const fails = [];
  for (const [label, fg, bg] of pairs) {
    const ratio = contrast(v(fg), v(bg));
    // `!(>=)` rather than `<`, so a NaN from a mis-shaped token fails loudly
    // (.claude/rules/nan-passes-every-threshold-guard.md).
    if (!(ratio >= AA)) fails.push(`${label} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(fails, []);
});
