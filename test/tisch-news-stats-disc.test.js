'use strict';

/* Der Tisch's T14.3 „Was ist neu", T14.4 signed-in statistics and T15b's sheet
 * error card (#1281).
 *
 *   - every NEWS entry carries a `kind` ('new' / 'improved' / 'fixed'), phrased
 *     in every shipped locale — the in-repo data the badge reads;
 *   - under Der Tisch both heads get `.lobby-head--felt`, the news entries a
 *     badge inside their date line, the signed-in statistics head the BGG
 *     badge, and a sheet's failure card an aria-hidden icon disc;
 *   - under Klassisch every one of those screens renders exactly as before.
 *
 * Views run under jsdom (.claude/rules/testing-views-under-jsdom.md); the paint
 * is read as CSS text from tisch.css, and every new ink/ground pair is measured
 * through test/support/theme.js from the declarations the rules actually make.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, translator, flush } = require('./support/dom');
const { rulesOf, topLevel } = require('./support/css');
const { contrast, evaluate, rgb } = require('./support/theme');
const { designById } = require('../public/js/designs');
const { NEWS } = require('../public/js/news');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

const KINDS = ['new', 'improved', 'fixed'];

/* ------------------------------ the NEWS kinds ------------------------------ */

test('every NEWS entry has a kind, and every kind is phrased in every locale', () => {
  assert.ok(NEWS.length >= 1, 'the news list is empty — the check is vacuous');
  for (const entry of NEWS) {
    assert.ok(KINDS.includes(entry.kind),
      `entry ${entry.revision} has kind ${JSON.stringify(entry.kind)} — expected one of ${KINDS.join(', ')}`);
  }
  for (const code of SUPPORTED_LOCALES) {
    const t = translator(code);
    for (const kind of KINDS) {
      const key = `news.kind.${kind}`;
      const text = t(key);
      assert.ok(text && text !== key, `${code} has no ${key}`);
    }
  }
});

/* --------------------------------- the views -------------------------------- */

const ENTRIES = [
  { revision: '2026-09-02', kind: 'new', de: { title: 'Passkeys', body: 'Ohne Passwort.' }, en: { title: 'Passkeys', body: 'No password.' } },
  { revision: '2026-08-01', kind: 'improved', de: { title: 'Regal', body: 'Schneller.' }, en: { title: 'Shelf', body: 'Faster.' } },
  { revision: '2026-07-01', kind: 'fixed', de: { title: 'Import', body: 'Repariert.' }, en: { title: 'Import', body: 'Repaired.' } },
];

function bootNews(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const news = dom.get('NEWS');
  news.length = 0;
  news.push(...ENTRIES);
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('markNewsSeen', () => {});
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return dom;
}

test('Klassisch: „Was ist neu" renders exactly the pre-#1281 markup', async (t) => {
  const dom = bootNews(t, 'klassisch');
  await dom.call('showNews');
  const head = dom.app.querySelector('.lobby-head');
  assert.equal(head.className, 'lobby-head', 'the head gained a class under Klassisch');
  assert.equal(head.children.length, 1);
  const entries = [...dom.app.querySelectorAll('.news-entry')];
  assert.equal(entries.length, ENTRIES.length);
  for (const e of entries) {
    assert.deepEqual([...e.children].map((c) => c.className),
      ['news-entry__date muted', 'news-entry__title', 'news-entry__body']);
    assert.equal(e.querySelector('.news-entry__date').children.length, 0,
      'the date line carries an element under Klassisch');
  }
  assert.equal(dom.app.querySelector('.news-entry__kind'), null, 'a kind badge rendered under Klassisch');
});

test('Der Tisch: the head is on felt and each entry carries its kind badge in the date line', async (t) => {
  const dom = bootNews(t, 'tisch');
  await dom.call('showNews');
  assert.ok(dom.app.querySelector('.lobby-head').classList.contains('lobby-head--felt'));
  const tr = translator('de');
  const entries = [...dom.app.querySelectorAll('.news-entry')];
  assert.equal(entries.length, ENTRIES.length);
  entries.forEach((e, i) => {
    const badges = e.querySelectorAll('.news-entry__kind');
    assert.equal(badges.length, 1, `entry ${i} has ${badges.length} badges`);
    const badge = badges[0];
    assert.ok(badge.parentElement.classList.contains('news-entry__date'), 'the badge left the date line');
    assert.ok(badge.classList.contains(`news-entry__kind--${ENTRIES[i].kind}`));
    assert.equal(badge.textContent, tr(`news.kind.${ENTRIES[i].kind}`));
  });
});

function bootStats(t, design, { loggedOut = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/stats/public')) return { ok: false, status: 404, json: async () => ({}) };
    if (String(url).startsWith('/api/config')) return { ok: true, json: async () => ({}) };
    throw new Error(`unexpected fetch: ${url}`);
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => !loggedOut);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return dom;
}

test('Klassisch: the signed-in statistics head is unchanged', async (t) => {
  const dom = bootStats(t, 'klassisch');
  await dom.call('showEntdecken');
  const head = dom.app.querySelector('.lobby-head');
  assert.equal(head.className, 'lobby-head');
  assert.deepEqual([...head.children].map((c) => c.tagName + '.' + c.className), ['H1.', 'DIV.muted lobby-head__sub']);
});

test('Der Tisch: the signed-in statistics head is felt with the BGG badge after the title and line', async (t) => {
  const dom = bootStats(t, 'tisch');
  await dom.call('showEntdecken');
  const head = dom.app.querySelector('.lobby-head');
  assert.ok(head.classList.contains('lobby-head--felt'));
  assert.deepEqual([...head.children].map((c) => c.tagName), ['H1', 'DIV', 'IMG'], 'DOM order is title, line, badge');
  const img = head.querySelector('.lobby-head__bgg');
  assert.equal(img.getAttribute('src'), '/icons/powered-by-bgg.png');
  assert.ok(img.getAttribute('alt'), 'the BGG badge has no accessible name');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'icons', 'powered-by-bgg.png')));
});

test('Der Tisch, logged out: the face keeps the plain head (that screen is #1198\'s)', async (t) => {
  const dom = bootStats(t, 'tisch', { loggedOut: true });
  await dom.call('showEntdecken');
  const head = dom.app.querySelector('.lobby-head');
  assert.equal(head.className, 'lobby-head');
  assert.equal(head.querySelector('img'), null);
});

async function openImport(t, design, answer) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => answer);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  await dom.call('showBggImport', { id: 7, name: 'Freitagsrunde' });
  await new Promise((resolve) => setImmediate(resolve));
  return dom.document.querySelector('.bgg-import__msg');
}

test('Klassisch: the BGG import message card is unchanged — the headline is its first child', async (t) => {
  const msg = await openImport(t, 'klassisch', { state: 'ok', games: [] });
  assert.ok(msg, 'no message rendered');
  assert.deepEqual([...msg.children].map((c) => c.tagName + '.' + c.className), ['P.', 'P.muted']);
});

test('Der Tisch: every import state wears an aria-hidden icon disc above its headline', async (t) => {
  for (const [answer, icon] of [
    [{ state: 'ok', games: [] }, 'ti-cards'],
    [{ state: 'queued' }, 'ti-hourglass'],
    [{ state: 'invalid_user' }, 'ti-user-x'],
  ]) {
    const msg = await openImport(t, 'tisch', answer);
    assert.ok(msg, `no message for ${answer.state}`);
    const disc = msg.firstElementChild;
    assert.ok(disc.classList.contains('sheet-disc'), `${answer.state}: the disc is not first`);
    assert.equal(disc.getAttribute('aria-hidden'), 'true');
    assert.ok(disc.querySelector(`.ti.${icon}`), `${answer.state}: expected ${icon}`);
    assert.equal(disc.textContent.trim(), '', 'the disc carries text');
    assert.equal(msg.children[1].tagName, 'P', 'the headline no longer follows the disc');
  }
});

test('Der Tisch: the add-game search reports a failure as a card with the disc, and a hint as a plain line', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (url.includes('/lookup/search')) return { results: [] };
    return {};
  });
  dom.run('applyDesign("tisch")');
  await dom.call('showAddGame', { id: 1, name: 'R', games: [], tags: [], members: [], sessions: [], activity: [] }, {});
  const msg = dom.document.getElementById('addSearchMsg');
  const tr = translator('de');
  assert.equal(msg.classList.contains('is-fail'), false);
  assert.equal(msg.textContent, tr('addGame.searchHint'));

  const input = dom.document.getElementById('addSearchQ');
  input.value = 'zzz';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await flush();
  await flush();
  assert.ok(msg.classList.contains('is-fail'), 'a no-hit search is not reported as a failure card');
  const disc = msg.querySelector('.sheet-disc');
  assert.ok(disc && disc.getAttribute('aria-hidden') === 'true');
  assert.ok(disc.querySelector('.ti.ti-search'));
  assert.equal(msg.textContent.trim(), tr('lookup.noResults'), 'the announced text changed');
  assert.equal(msg.getAttribute('role'), 'status', 'the live region lost its role');
});

/* ------------------------------ the paint (CSS) ----------------------------- */

const RAW = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const TOP = rulesOf(topLevel(RAW));
const TISCH = designById('tisch');
const GATE = ':root[data-design="tisch"][data-scheme="dark"]';

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const ruleFor = (tail) => {
  const hits = TOP.filter(([sel]) => sel.split(',').map(norm).includes(`${GATE} ${tail}`));
  assert.equal(hits.length, 1, `expected exactly one scheme-gated top-level rule for "${tail}", found ${hits.length}`);
  return hits[0][1];
};
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`).exec(body);
  assert.ok(m, `no ${prop} in ${body}`);
  return norm(m[1]);
};
const ratio = (a, b) => contrast(rgb(evaluate(a, TISCH)), rgb(evaluate(b, TISCH)));

test('each kind badge is a measured pair at AA', () => {
  for (const kind of KINDS) {
    const body = ruleFor(`.news-entry__kind--${kind}`);
    const r = ratio(decl(body, 'color'), decl(body, 'background'));
    assert.ok(r >= 4.5, `${kind} badge measures ${r.toFixed(2)}:1`);
  }
});

test('the felt head carries paper ink on its light stop at AA, never gold', () => {
  const band = ruleFor('.lobby-head--felt');
  assert.match(decl(band, 'background-image'), /var\(--felt\)/, 'the band is not the felt');
  const h1 = decl(ruleFor('.lobby-head--felt h1'), 'color');
  const sub = decl(ruleFor('.lobby-head--felt .lobby-head__sub'), 'color');
  for (const ink of [h1, sub]) {
    assert.doesNotMatch(ink, /gold/, 'gold as text on felt (finding A1)');
    const r = ratio(ink, 'var(--felt)');
    assert.ok(r >= 4.5, `${ink} on the felt's light stop measures ${r.toFixed(2)}:1`);
  }
});

test('the icon disc: glyph at AA on the coin, rim at 3:1 on the paper card', () => {
  const disc = ruleFor('.sheet .sheet-disc');
  const coin = decl(disc, 'background');
  const glyph = ratio(decl(disc, 'color'), coin);
  assert.ok(glyph >= 4.5, `the disc glyph measures ${glyph.toFixed(2)}:1`);
  const card = decl(ruleFor('.sheet .bgg-import__msg'), 'background');
  const rim = decl(disc, 'border').split(' ').pop();
  const edge = ratio(rim, card);
  assert.ok(edge >= 3, `the disc rim measures ${edge.toFixed(2)}:1 on the card`);
});

test('the import card\'s headline rule survives the disc coming first', () => {
  ruleFor('.sheet .bgg-import__msg > p:first-of-type');
  assert.equal(TOP.some(([sel]) => /\.bgg-import__msg > p:first-child/.test(sel)), false,
    'p:first-child can no longer match the headline once the disc precedes it');
});
