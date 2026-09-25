'use strict';

/* Ocean's sign-in, design chooser and Konto design section (#1215, O5.1-O5.5).
 *
 * Three claims no generic sweep makes:
 *
 *   1. The page gradient behind the two auth screens never runs darker than the
 *      lowest stop the accent was measured on. That is the review's one real
 *      contrast failure in a control (O5.2, 4.03:1 on the old bottom stop), and
 *      the design-token sweep cannot see it: it measures each water stop, not
 *      which stops a RULE actually paints behind text.
 *   2. The chooser composes as postcards under Ocean — and only under Ocean.
 *      Klassisch keeps its live-preview list, Der Tisch its posters.
 *   3. No other design's colour enters ocean.css (review R4, the issue's own
 *      acceptance line): their postcards paint from registry data, inline.
 *
 * The layout (four across at 1440, rows under a sticky commit at 390) is CSS
 * jsdom cannot apply; it was checked in a real browser at both widths.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf } = require('./support/css');
const { contrast, token } = require('./support/theme');
const {
  DESIGN_REGISTRY, CLASSIC_DESIGN, DESIGN_CHOOSER_REVISION, designById,
} = require('../public/js/designs');

const OCEAN = designById('ocean');
const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'ocean.css'), 'utf8')
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

/* ---------------------------- 1. the water ---------------------------------- */

test('#1215: the sign-in gradient stops at --water-flat, and every text ink clears AA on every stop', () => {
  const rule = rulesOf(SHEET).find(([sel]) => /body\.auth-screen:has\(/.test(sel));
  assert.ok(rule, 'ocean.css paints no gradient behind the auth screens — did the selector move?');
  const bg = /background-image:\s*([^;]+)/.exec(rule[1]);
  assert.ok(bg, 'the auth-screen rule sets no background-image');
  const stops = [...bg[1].matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
  assert.ok(stops.length >= 2, `a gradient needs two stops, found ${stops.join(', ')}`);

  // The accent may carry text down to --water-flat and on nothing darker
  // (ocean.css, the water tokens). The last stop is what sits under the legal
  // line at the bottom of the register screen's scroll.
  const allowed = ['--water-foam', '--water-shallows', '--water-surf', '--water-flat'];
  for (const stop of stops) {
    assert.ok(allowed.includes(stop), `${stop} is darker than --water-flat, the accent's floor`);
  }
  assert.equal(stops[stops.length - 1], '--water-flat', 'the gradient must end on the measured floor');

  // What stands on it once the card goes on a phone: the legal links (--brand),
  // the consent line and labels (--ink-soft), the headings (--ink).
  const failures = [];
  for (const stop of stops) {
    for (const ink of ['--brand', '--ink-soft', '--ink']) {
      const ratio = contrast(token(ink, OCEAN), token(stop, OCEAN));
      if (!(ratio >= 4.5)) failures.push(`${ink} on ${stop} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, []);
});

test('#1215: no other design\'s colour is declared in ocean.css', () => {
  const sheet = SHEET.toLowerCase();
  const foreign = [];
  for (const d of DESIGN_REGISTRY.filter((x) => x.id !== 'ocean')) {
    const own = [d.page, d.accent, ...(d.poster ? [...d.poster.ground, d.poster.ink, d.poster.sub] : [])]
      .filter(Boolean).map((c) => c.toLowerCase());
    for (const hex of own) {
      // Ocean's own palette may coincide with a hex another design also uses;
      // that is not a foreign colour, it is a shared one Ocean declared itself.
      const oceanOwn = [OCEAN.page, OCEAN.accent, ...OCEAN.poster.ground, OCEAN.poster.ink, OCEAN.poster.sub];
      if (oceanOwn.includes(hex)) continue;
      if (sheet.includes(hex)) foreign.push(`${d.id} ${hex}`);
    }
  }
  assert.ok(DESIGN_REGISTRY.filter((x) => x.id !== 'ocean' && x.poster).length >= 2,
    'fewer than two other designs carry poster colours — this test checks nothing');
  assert.deepEqual(foreign, [], 'a postcard colour belongs to its design\'s registry row, not to ocean.css');
});

/* --------------------------- 2. the chooser --------------------------------- */

const ME = { id: 'u1', design: 'ocean', designChooserSeen: null };

test('#1215: under Ocean the chooser is postcards — every design by its sign, Klassisch first', (t) => {
  const dom = boot(t, 'ocean', ME);
  dom.call('maybeShowDesignChooser', ME);
  const sheet = dom.document.querySelector('.design-chooser--cards');
  assert.ok(sheet, 'no postcard chooser under Ocean');
  assert.equal(dom.document.querySelector('.design-poster, .design-chooser__list'), null,
    'another design\'s composition leaked into Ocean\'s');

  const cards = [...sheet.querySelectorAll('.design-postcard')];
  assert.deepEqual(cards.map((c) => c.querySelector('input').value), DESIGN_REGISTRY.map((d) => d.id));
  assert.equal(cards[0].querySelector('input').value, CLASSIC_DESIGN);
  assert.equal(cards[0].querySelector('.design-card__badge').textContent, 'Wie bisher');
  for (const card of cards) {
    const design = designById(card.querySelector('input').value);
    assert.ok(card.querySelector(`.design-tile--glyph .ti.${design.glyph}`), `${design.id} is missing its sign`);
  }
  assert.ok(cards[0].querySelector('.ti-dice-3'), 'Klassisch keeps the die');
  assert.ok(sheet.querySelector('.design-postcard.is-on .ti-wave-sine'), 'the worn design is the picked card');

  // The art paints from the registry, inline — a design's own poster colours.
  const tisch = cards.find((c) => c.querySelector('input').value === 'tisch').querySelector('.design-tile--glyph');
  assert.equal(tisch.style.getPropertyValue('--poster-top'), designById('tisch').poster.ground[0]);

  // One radio group, one commit — named after the pick.
  assert.equal(sheet.querySelectorAll('[role="radiogroup"]').length, 1);
  assert.equal(sheet.querySelector('#designChooserGo').textContent, 'Ocean übernehmen');
  assert.match(sheet.querySelector('.design-deck__picked').textContent, /Ocean/);
});

test('#1215: a postcard only selects — no preview — and the commit stores it in one request', async (t) => {
  const dom = boot(t, 'ocean', ME);
  const sent = [];
  dom.set('accountApi', (method, p, body) => {
    sent.push([method, p, body]);
    return Promise.resolve({ ...ME, design: body.design || ME.design, designChooserSeen: DESIGN_CHOOSER_REVISION });
  });
  dom.call('maybeShowDesignChooser', ME);
  const sheet = dom.document.querySelector('.design-chooser--cards');
  const klassisch = sheet.querySelector(`.design-postcard input[value="${CLASSIC_DESIGN}"]`);
  klassisch.checked = true;
  klassisch.dispatchEvent(new dom.window.Event('change'));

  assert.equal(dom.document.documentElement.dataset.design, 'ocean',
    'the sheet is Ocean\'s markup — previewing another design would repaint it in rules that do not know it');
  assert.equal(sheet.querySelector('#designChooserGo').textContent, 'Klassisch übernehmen');
  assert.match(sheet.querySelector('.design-deck__picked').textContent, /Klassisch/);
  assert.equal(sheet.querySelectorAll('.design-postcard.is-on').length, 1);
  assert.ok(klassisch.closest('.design-postcard').classList.contains('is-on'));

  sheet.querySelector('#designChooserGo').click();
  await flush();
  assert.deepEqual(plain(sent), [['POST', '/design-chooser-seen', { design: CLASSIC_DESIGN }]]);
  assert.equal(dom.document.documentElement.dataset.design, CLASSIC_DESIGN);
});

test('#1215: „Später entscheiden" on the postcards keeps the design and still records the chooser', async (t) => {
  const dom = boot(t, 'ocean', ME);
  const sent = [];
  dom.set('accountApi', (method, p, body) => { sent.push(body); return Promise.resolve({ ...ME, designChooserSeen: DESIGN_CHOOSER_REVISION }); });
  dom.call('maybeShowDesignChooser', ME);
  const sheet = dom.document.querySelector('.design-chooser--cards');
  const tisch = sheet.querySelector('.design-postcard input[value="tisch"]');
  tisch.checked = true;
  tisch.dispatchEvent(new dom.window.Event('change'));
  sheet.querySelector('#designChooserSkip').click();
  await flush();
  assert.deepEqual(plain(sent), [{}]);
  assert.equal(dom.document.documentElement.dataset.design, 'ocean');
});

test('#1215: Klassisch and Der Tisch never get the postcards', (t) => {
  for (const design of [CLASSIC_DESIGN, 'tisch']) {
    const me = { ...ME, design };
    const dom = boot(t, design, me);
    dom.call('maybeShowDesignChooser', me);
    assert.ok(dom.document.querySelector('.design-chooser'), `${design}: no chooser at all`);
    assert.equal(dom.document.querySelector('.design-chooser--cards, .design-postcard, .design-tile--glyph'), null,
      `${design}: Ocean's postcards leaked`);
  }
});

/* ------------------------ 3. the Konto design section ------------------------ */

test('#1215: under Ocean the Konto design section is signs and an info box (O5.5)', (t) => {
  const dom = boot(t, 'ocean', ME);
  const wrap = dom.call('buildDesignSection', { ...ME });
  assert.ok(wrap.classList.contains('konto-design--card'));
  const head = wrap.querySelector('.konto-design__head');
  assert.ok(head && head.querySelector('h2') && head.querySelector('p.muted'), 'title and hint share one head');
  const cards = [...wrap.querySelectorAll('.design-card')];
  assert.equal(cards.length, DESIGN_REGISTRY.length);
  for (const card of cards) {
    assert.ok(card.querySelector('.design-tile--glyph .ti'), 'each design shows its sign');
    assert.equal(card.querySelector('.design-card__desc'), null, 'O5.5 prints the name alone');
  }
  const note = wrap.querySelector('.konto-design__note');
  assert.ok(note && note.querySelector('.ti-info-circle'), 'the closing note is the info box');
  // DOM order is the picture's: head, the signs, the note.
  assert.deepEqual([...wrap.children].map((el) => el.classList[0]),
    ['konto-design__head', 'design-picker', 'muted']);
});

test('#1215: Klassisch\'s Konto design section is untouched', (t) => {
  const me = { ...ME, design: CLASSIC_DESIGN };
  const dom = boot(t, CLASSIC_DESIGN, me);
  const wrap = dom.call('buildDesignSection', me);
  assert.equal(wrap.className, 'konto-design');
  assert.deepEqual([...wrap.children].map((el) => el.tagName.toLowerCase() + '.' + el.classList[0]),
    ['h2.konto-section__h', 'p.muted', 'div.design-picker', 'p.muted']);
  assert.equal(wrap.querySelectorAll('.design-card__desc').length, DESIGN_REGISTRY.length);
  assert.equal(wrap.querySelector('.design-tile--glyph, .konto-design__note'), null);
});
