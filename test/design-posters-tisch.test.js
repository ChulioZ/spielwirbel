'use strict';

/* The design chooser as Der Tisch's posters (#1277, T5.3 at 1440, T5.4 at 390).
 *
 * Run through the jsdom harness (.claude/rules/testing-views-under-jsdom.md)
 * under BOTH designs:
 *
 *  - Klassisch must render exactly the chooser sheet and the Konto cards it
 *    rendered before #1277 — the same children, in the same order, and not one
 *    poster, row or bill leaking in.
 *  - Der Tisch renders one poster per offered design (wordmark, tagline, ritual
 *    words, its own button) plus the „Später mehr" tile, and one row per design
 *    (material tile, name, one sentence, radio) with one commit button.
 *
 * Plus the fallback the issue asks for: a design that declares none of the new
 * registry fields still gets a usable poster and row.
 *
 * Named for the surface and the design, so it collides with no module basename
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush, translator } = require('./support/dom');
const { rulesOf } = require('./support/css');
const {
  DESIGN_REGISTRY, CLASSIC_DESIGN, DESIGN_CHOOSER_REVISION, designById,
} = require('../public/js/designs');

const T = translator('de');
const ALL = { designs: DESIGN_REGISTRY.map((d) => d.id) };
const plain = (v) => JSON.parse(JSON.stringify(v));

function boot(t, { design = 'klassisch', me = {}, cfg = ALL } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const who = { id: 'u1', design, designChooserSeen: null, ...me };
  const sent = [];
  dom.set('withAppConfig', (cb) => cb(cfg));
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  dom.set('accountApi', (method, p, body) => {
    sent.push([method, p, body]);
    return Promise.resolve({ ...who, design: (body && body.design) || who.design, designChooserSeen: DESIGN_CHOOSER_REVISION });
  });
  dom.run(`accountUser = ${JSON.stringify(who)}`);
  dom.call('applyDesign', design);
  return { dom, who, sent };
}

// One line per child: tag + classes. Enough to see an added, dropped or
// reordered block.
const shape = (el) => [...el.children].map((c) => `${c.tagName.toLowerCase()}.${[...c.classList].join('.')}`);

/* -------------------------------- Klassisch -------------------------------- */

test('Klassisch: the chooser sheet is exactly the pre-#1277 dialog', (t) => {
  const { dom, who } = boot(t);
  dom.call('maybeShowDesignChooser', who);
  const sheet = dom.document.querySelector('.design-chooser');
  assert.ok(sheet.classList.contains('sheet--dialog'));
  assert.ok(sheet.parentElement.classList.contains('sheet-backdrop--center'));
  assert.deepEqual(shape(sheet), [
    'div.sheet__head.sheet__head--stacked',
    'p.muted',
    'div.design-chooser__list',
    'p.muted.design-chooser__foot',
    'div.sheet__actions',
  ]);
  assert.deepEqual([...sheet.querySelectorAll('.sheet__actions button')].map((b) => [b.id, b.textContent]),
    [['designChooserSkip', T('design.chooser.skip')], ['designChooserGo', T('design.chooser.confirm')]]);
  // The cards keep the bare swatch: no bill class, no wordmark inside it.
  const tiles = [...sheet.querySelectorAll('.design-card .design-tile')];
  assert.equal(tiles.length, DESIGN_REGISTRY.length);
  for (const tile of tiles) {
    assert.equal(tile.className, 'design-tile');
    assert.equal(tile.children.length, 0);
  }
  assert.equal(dom.document.querySelector('.design-poster, .design-row, .design-tile--bill, .design-posters'), null,
    'a Tisch-only element leaked into the Klassisch chooser');
});

test('Klassisch: the Konto cards keep their bare swatch', (t) => {
  const { dom, who } = boot(t);
  const list = dom.call('renderDesignPicker', ALL, who.design, () => {});
  for (const tile of list.querySelectorAll('.design-tile')) {
    assert.equal(tile.className, 'design-tile');
    assert.equal(tile.textContent, '');
  }
});

/* -------------------------------- Der Tisch -------------------------------- */

function tischChooser(t, opts) {
  const ctx = boot(t, { design: 'tisch', ...opts });
  ctx.dom.call('maybeShowDesignChooser', ctx.who);
  ctx.sheet = ctx.dom.document.querySelector('.design-chooser');
  return ctx;
}

test('Tisch: one poster per offered design, then the „Später mehr" tile, in registry order', (t) => {
  const { sheet } = tischChooser(t);
  assert.ok(sheet.classList.contains('design-chooser--posters'));
  // A docked sheet on the phone (T5.4), so NOT the centred-dialog backdrop.
  assert.equal(sheet.parentElement.classList.contains('sheet-backdrop--center'), false);
  assert.deepEqual(shape(sheet), [
    'div.sheet__head.design-chooser__head',
    'ul.design-posters',
    'div.design-rows',
    'div.design-chooser__commit',
  ]);
  // „Später entscheiden" is in the head, after the intro — top right.
  assert.deepEqual(shape(sheet.querySelector('.design-chooser__head')),
    ['div.design-chooser__intro', 'button.btn.btn--ghost.design-chooser__skip']);

  const posters = [...sheet.querySelectorAll('.design-posters > li')];
  assert.equal(posters.length, DESIGN_REGISTRY.length + 1);
  const later = posters.pop();
  assert.ok(later.classList.contains('design-poster--later'));
  assert.equal(later.querySelector('.design-poster__name').textContent, T('design.chooser.moreTitle'));
  assert.equal(later.querySelector('.design-poster__desc').textContent, T('design.chooser.later'));
  assert.equal(later.querySelector('button'), null, 'the promise tile offers nothing to press');

  assert.deepEqual(posters.map((p) => p.querySelector('.design-poster__pick').dataset.design),
    DESIGN_REGISTRY.map((d) => d.id));
});

test('Tisch: every poster prints wordmark, tagline, sentence, ritual words and its own button', (t) => {
  const { sheet } = tischChooser(t);
  const [klassisch, tisch] = sheet.querySelectorAll('.design-poster:not(.design-poster--later)');
  const words = `${T('startSession.potHeading')} · ${T('round.startSession')} · ${T('startSession.draw')}`;

  // Klassisch's bill carries the BRAND (T5.3), Tisch's its own name.
  assert.equal(klassisch.querySelector('.design-tile__word').textContent, T('app.title'));
  assert.equal(klassisch.querySelector('.design-tile__sub').textContent, T('design.klassisch.tagline'));
  assert.equal(tisch.querySelector('.design-tile__word').textContent, T('design.tisch.name'));
  assert.equal(tisch.querySelector('.design-tile__sub').textContent, T('design.tisch.tagline'));

  for (const [poster, d] of [[klassisch, designById('klassisch')], [tisch, designById('tisch')]]) {
    // The bill is FIRST (the picture above the text) and hidden from AT.
    assert.ok(poster.firstElementChild.classList.contains('design-tile--bill'));
    assert.equal(poster.firstElementChild.getAttribute('aria-hidden'), 'true');
    assert.equal(poster.querySelector('.design-poster__desc').textContent, T(d.descKey));
    assert.equal(poster.querySelector('.design-poster__words').textContent, words);
    // Poster colours arrive inline from the registry, never from a stylesheet.
    const bill = poster.querySelector('.design-tile--bill');
    assert.equal(bill.style.getPropertyValue('--poster-top'), d.poster.ground[0]);
    assert.equal(bill.style.getPropertyValue('--poster-ink'), d.poster.ink);
    // The name is a heading, badge inside it.
    assert.equal(poster.querySelector('.design-poster__name').tagName, 'H3');
  }
  assert.equal(klassisch.querySelector('.design-card__badge').textContent, T('design.klassisch.badge'));

  // The design worn is marked, and its button says so; the other offers itself.
  assert.ok(tisch.classList.contains('is-on'));
  assert.equal(klassisch.classList.contains('is-on'), false);
  const tBtn = tisch.querySelector('.design-poster__pick');
  const kBtn = klassisch.querySelector('.design-poster__pick');
  assert.ok(tBtn.classList.contains('btn--primary'));
  assert.ok(kBtn.classList.contains('btn--ghost'));
  // Visible label first, then the design's name for a screen reader — so
  // two „Auswählen" buttons are not ambiguous (SC 2.4.6 / 2.5.3).
  assert.equal(kBtn.textContent, `${T('design.poster.pick')} — ${T('design.klassisch.name')}`);
  assert.equal(tBtn.textContent, `${T('design.poster.picked')} — ${T('design.tisch.name')}`);
});

test('Tisch: a poster button is the answer — one request, painted at once', async (t) => {
  const { dom, sheet, sent } = tischChooser(t);
  const kBtn = sheet.querySelector('.design-poster__pick[data-design="klassisch"]');
  kBtn.click();
  assert.equal(dom.document.documentElement.dataset.design, 'klassisch', 'painted before the round trip');
  assert.equal(dom.document.querySelector('.design-chooser'), null, 'the sheet closed');
  await flush();
  assert.deepEqual(plain(sent), [['POST', '/design-chooser-seen', { design: 'klassisch' }]]);
});

test('Tisch: keeping the worn design is an answer too', async (t) => {
  const { sheet, sent } = tischChooser(t);
  sheet.querySelector('.design-poster__pick[data-design="tisch"]').click();
  await flush();
  assert.deepEqual(plain(sent), [['POST', '/design-chooser-seen', { design: 'tisch' }]]);
});

test('Tisch: the top „Später entscheiden" records seen and changes nothing', async (t) => {
  const { dom, sheet, sent } = tischChooser(t);
  sheet.querySelector('#designChooserSkip').click();
  await flush();
  assert.deepEqual(plain(sent), [['POST', '/design-chooser-seen', {}]]);
  assert.equal(dom.document.documentElement.dataset.design, 'tisch');
});

test('Tisch (phone): a row per design — tile, name, one sentence, radio — and one commit', async (t) => {
  const { dom, sheet, sent } = tischChooser(t);
  const rows = [...sheet.querySelectorAll('.design-rows > .design-row')];
  assert.equal(rows.length, DESIGN_REGISTRY.length);
  // DOM order = visual order: tile, text, radio at the right edge.
  assert.deepEqual(shape(rows[0]), ['span.design-tile.design-tile--bill', 'span.design-row__body', 'input.']);
  assert.equal(rows[0].querySelector('.design-row__desc').textContent, T('design.klassisch.short'));
  assert.equal(rows[1].querySelector('.design-row__desc').textContent, T('design.tisch.short'));
  // #1277 review: the 58px tile prints the design's NAME, never the wordmark —
  // „Spielwirbel" in 12px broke mid-word into „Spielwir / bel" there.
  assert.equal(rows[0].querySelector('.design-tile__word').textContent, T('design.klassisch.name'));
  assert.equal(rows[1].querySelector('.design-tile__word').textContent, T('design.tisch.name'));
  // The 58px tile prints the wordmark only — a tagline would not fit.
  assert.equal(rows[0].querySelector('.design-tile__sub'), null);
  assert.equal(sheet.querySelector('.design-rows input:checked').value, 'tisch');

  const go = sheet.querySelector('#designChooserGo');
  assert.equal(go.textContent, T('design.chooser.confirmNamed', { name: T('design.tisch.name') }));

  // Choosing a row only SELECTS: no request, no repaint (the sheet is styled
  // by Der Tisch's own stylesheet, so a preview would unstyle it).
  const radio = rows[0].querySelector('input');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event('change'));
  assert.equal(sent.length, 0);
  assert.equal(dom.document.documentElement.dataset.design, 'tisch');
  assert.ok(rows[0].classList.contains('is-on'));
  assert.equal(rows[1].classList.contains('is-on'), false, 'exactly one row reads as chosen');
  assert.equal(go.textContent, T('design.chooser.confirmNamed', { name: T('design.klassisch.name') }));

  go.click();
  await flush();
  assert.deepEqual(plain(sent), [['POST', '/design-chooser-seen', { design: 'klassisch' }]]);
  assert.equal(dom.document.documentElement.dataset.design, 'klassisch');
});

test('Tisch (phone): the bottom „Später entscheiden" answers exactly once', async (t) => {
  const { sheet, sent } = tischChooser(t);
  sheet.querySelector('#designChooserSkipRow').click();
  sheet.querySelector('#designChooserGo').click();
  await flush();
  assert.deepEqual(plain(sent), [['POST', '/design-chooser-seen', {}]]);
});

test('Tisch: the Konto cards print a bill with the wordmark and no tagline (T5.2)', (t) => {
  const { dom } = boot(t, { design: 'tisch' });
  const list = dom.call('renderDesignPicker', ALL, 'tisch', () => {});
  const bills = [...list.querySelectorAll('.design-card .design-tile--bill')];
  assert.equal(bills.length, DESIGN_REGISTRY.length);
  assert.equal(bills[0].querySelector('.design-tile__word').textContent, T('app.title'));
  assert.equal(list.querySelector('.design-tile__sub'), null);
});

/* --------------------------- a design without fields ------------------------- */

test('a design that declares none of the poster fields still gets a usable poster and row', (t) => {
  const { dom, who } = boot(t, { design: 'tisch', cfg: { designs: [...ALL.designs, 'probe'] } });
  // The shape a future design (#1203–#1207) has before its poster copy lands:
  // only the fields every row already carries.
  dom.run(`DESIGN_REGISTRY.push({ id: 'probe', labelKey: 'design.tisch.name', descKey: 'design.tisch.desc',
    page: '#223344', accent: '#ddeeff', enabled: false })`);
  dom.call('maybeShowDesignChooser', who);
  const poster = dom.document.querySelector('.design-poster__pick[data-design="probe"]').closest('.design-poster');
  const bill = poster.querySelector('.design-tile--bill');
  assert.equal(bill.querySelector('.design-tile__word').textContent, T('design.tisch.name'), 'the name stands in for a wordmark');
  assert.equal(bill.querySelector('.design-tile__sub'), null, 'no tagline line, rather than an empty one');
  assert.equal(poster.querySelector('.design-poster__words'), null, 'no ritual line, rather than an empty one');
  assert.equal(poster.querySelector('.design-poster__desc').textContent, T('design.tisch.desc'));
  // No poster colours: the tile's own page/accent pair paints it.
  assert.equal(bill.style.getPropertyValue('--poster-top'), '');
  assert.equal(bill.style.getPropertyValue('--tile-page'), '#223344');

  const row = dom.document.querySelector('.design-row input[value="probe"]').closest('.design-row');
  assert.equal(row.querySelector('.design-row__desc').textContent, T('design.tisch.desc'), 'the sentence falls back to descKey');
});

/* ------------------------------- the registry -------------------------------- */

test('every poster key a registry row names exists in every locale', () => {
  const locales = require('../public/js/locales').LOCALES.map((l) => l.code);
  let checked = 0;
  for (const code of locales) {
    const tr = translator(code);
    for (const d of DESIGN_REGISTRY) {
      for (const key of [d.wordmarkKey, d.taglineKey, d.shortKey, ...(d.ritualKeys || [])].filter(Boolean)) {
        assert.notEqual(tr(key), key, `${code}: ${d.id} names a missing key ${key}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= locales.length * 10, `anti-vacuous: only ${checked} keys checked`);
});

test('Klassisch („Wie bisher") still heads the posters, though the face moved (#1202)', (t) => {
  const { sheet } = tischChooser(t);
  const first = sheet.querySelector('.design-poster');
  assert.equal(first.querySelector('.design-poster__pick').dataset.design, CLASSIC_DESIGN);
  assert.equal(first.querySelector('.design-card__badge').textContent, 'Wie bisher',
    'the badge names the way BACK, not the face');
});

/* ---------------------------------- the CSS ---------------------------------- */

const TISCH = rulesOf(fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''));
const decl = (selector, prop) => {
  const hit = TISCH.find(([sel]) => sel.split(',').map((s) => s.trim()).includes(selector));
  const m = hit && hit[1].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

test('CSS: the display ink is only ever set at display size, small text takes the small-text ink', () => {
  /* The registry holds `poster.ink` to 3:1 only (large text) and `poster.sub`
     to 4.5:1 (test/a11y-contrast.test.js). That split is only honest while the
     wordmark stays ≥ 18.66px bold wherever it takes --poster-ink, and the
     58px tile's 12px word takes --poster-sub. */
  const px = (v) => parseFloat(v);
  assert.ok(px(decl(':root[data-design="tisch"] .design-tile__word', 'font-size')) >= 24);
  assert.ok(px(decl(':root[data-design="tisch"] .design-card .design-tile__word', 'font-size')) >= 18.66);
  assert.equal(decl(':root[data-design="tisch"] .design-tile__word', 'font-weight'), '800');
  assert.equal(decl(':root[data-design="tisch"][data-scheme="dark"] .design-tile__word', 'color'),
    'var(--poster-ink, var(--tile-accent))');
  assert.equal(decl(':root[data-design="tisch"][data-scheme="dark"] .design-row .design-tile__word', 'color'),
    'var(--poster-sub, var(--tile-accent))');
});
