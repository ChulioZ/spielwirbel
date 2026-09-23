'use strict';

/* Der Tisch's tier 2a (#1196, T13.1–T13.5): the Chronik's paper strips and
 * felt recap, the Pokale's brass podium, the member page, the off-shelf
 * segments and the recommendations.
 *
 * Mostly CSS, so mostly text (.claude/rules/testing-views-under-jsdom.md); the
 * pixels were judged in a browser at 390 and 1440. What is pinned here is what
 * regresses SILENTLY:
 *
 *   - a plinth losing its tone or its one ink — the contrast figures live in
 *     test/a11y-contrast.test.js, this pins that the rules actually PAINT them;
 *   - the paper strip forgetting to re-point an ink its content reads — derived
 *     from views-chronik.js, so a new inline status colour there is covered;
 *   - the felt stage reaching a world round, where it would sit under the
 *     world's own floor art;
 *   - the recap's desktop column losing its row span;
 *   - the off-shelf segments: real links to the four routes, the current one
 *     marked, hidden in the app's own design and shown in this one.
 *
 * The scheme gate is NOT re-checked: test/tisch-hub-lobby.test.js derives it
 * over the whole file.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf, bodyOfIn, declaredValue, mediaBlocks } = require('./support/css');
const { loadApp } = require('./support/dom');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const SHEET = stripComments(read('public/css/designs/tisch.css'));
const RULES = rulesOf(SHEET.replace(/@media[^{]+\{/g, ''));
const APP_RULES = rulesOf(stripComments(read('public/styles.css')));
const HOOK = ':root[data-design="tisch"][data-scheme="dark"]';

const bodiesFor = (needle) => RULES
  .filter(([selector]) => selector.includes(needle))
  .map(([, body]) => body)
  .join('\n');

test('each plinth is struck in its own metal and carries the one plinth ink', () => {
  const stops = {
    1: /var\(--brass-hi\)[\s\S]*var\(--gold-deep\)/,
    2: /var\(--plinth-silver-hi\)[\s\S]*var\(--plinth-silver\)/,
    3: /var\(--plinth-bronze-hi\)[\s\S]*var\(--plinth-bronze\)/,
  };
  for (const [rank, re] of Object.entries(stops)) {
    const body = bodiesFor(`.podium__col--${rank} .podium__base`);
    assert.ok(body, `rank ${rank}'s plinth is not painted by the design`);
    assert.match(body, re, `rank ${rank}'s plinth is not its own metal`);
  }

  const base = bodyOfIn(`${HOOK} .podium__base`, RULES);
  assert.ok(base, 'the plinth has no base rule');
  assert.equal(declaredValue(base, 'color'), 'var(--plinth-ink)',
    'review finding A5: one dark ink on every plinth');

  /* Both texts on a plinth must INHERIT that ink — a colour set on either one
     would bypass the measured pair. styles.css sets none today; the design must
     not add one. */
  for (const child of ['.podium__rank', '.podium__shared']) {
    assert.equal(declaredValue(bodiesFor(child), 'color'), null,
      `${child} sets its own colour and escapes --plinth-ink`);
    const app = APP_RULES.filter(([sel]) => sel.split(',').map((s) => s.trim()).includes(child));
    assert.ok(app.length, `styles.css no longer styles ${child} — re-read this test`);
    for (const [, body] of app) {
      assert.equal(declaredValue(body, 'color'), null,
        `styles.css now colours ${child}; the plinth ink no longer reaches it`);
    }
  }
});

test('the paper strip re-points every ink its content reads', () => {
  const strip = bodyOfIn(`${HOOK} .timeline .session-card`, RULES);
  assert.ok(strip, 'the Chronik strip is not painted by the design');
  assert.match(strip, /var\(--paper\)[\s\S]*var\(--paper-raised\)/, 'the strip is not paper');

  /* Derived, not listed: every token the session card's own view writes INLINE
     is a colour tuned for walnut, and it now stands on paper. */
  const view = read('public/js/views-chronik.js');
  const card = view.slice(view.indexOf('function buildSessionCard'), view.indexOf('function buildActivityRow'));
  const inline = [...card.matchAll(/style="color:var\((--[a-z-]+)\)"/g)].map((m) => m[1]);
  assert.ok(inline.includes('--danger'), 'the fixture moved — the cancelled line no longer paints --danger inline');
  for (const tok of ['--ink', '--ink-soft', ...inline]) {
    assert.ok(declaredValue(strip, tok), `the strip leaves ${tok} at its walnut value, on paper`);
  }
  assert.equal(declaredValue(strip, '--danger'), 'var(--accent-deep)',
    'a status on paper takes the Zinnober measured there, not the light --danger');

  const title = bodyOfIn(`${HOOK} .timeline .session-card__title`, RULES);
  assert.equal(declaredValue(title, 'color'), 'var(--ink)',
    'the title reads --brand-strong in styles.css, brass lifted toward white');
});

test('the felt stage stays out of a world round', () => {
  const stage = RULES.filter(([sel]) => /\.podium$/.test(sel.trim()));
  assert.ok(stage.length, 'the podium has no felt stage');
  for (const [sel, body] of stage) {
    if (!/background/.test(body) && !/padding/.test(body)) continue;
    assert.match(sel, /:not\(\[data-world\]\)/,
      `${sel.trim()} would paint felt under a world's floor art (#1083)`);
  }
});

test('from 1280px the recap is a third column spanning every row', () => {
  const desk = mediaBlocks(SHEET).filter(([q]) => /min-width:\s*1280px/.test(q)).map(([, css]) => css).join('\n');
  const rules = rulesOf(desk);
  const grid = rules.find(([sel]) => sel.trim().endsWith('.app:has(> .precap)'));
  assert.ok(grid, 'no three-track grid for a screen with a recap');
  assert.match(declaredValue(grid[1], 'grid-template-columns'), /^var\(--rail-w\) minmax\(0, 1fr\) \d+px$/);
  const col = rules.find(([sel]) => sel.trim().endsWith('> .precap'));
  assert.ok(col, 'the recap is not placed');
  assert.equal(declaredValue(col[1], 'grid-column'), '3');
  assert.equal(declaredValue(col[1], 'grid-row'), '1 / span 999',
    '`1 / -1` would leave the recap in row 1 and push a gap under the timeline');
});

test('the segment strip is hidden in the app\'s design and shown in this one', () => {
  const app = APP_RULES.find(([sel]) => sel.trim() === '.offshelf-seg');
  assert.ok(app, 'styles.css no longer hides the segments');
  assert.equal(declaredValue(app[1], 'display'), 'none');
  assert.equal(declaredValue(bodyOfIn(`${HOOK} .offshelf-seg`, RULES), 'display'), 'flex');
});

// --- the markup: offShelfSegments (off-shelf.js) -----------------------------
const RID = 'r1';
const round = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  members: [{ id: 'm1', name: 'Anna' }],
  games: [
    { id: 'g1', title: 'Catan', tagIds: [] },
    { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
    { id: 'g3', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z', tagIds: [] },
  ],
  sessions: [],
};

async function render(t, view, ...args) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/recommendations$/.test(url)) return { profileGames: 0, recommendations: [], dismissed: [] };
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    return {};
  });
  await dom.call(view, ...args);
  return dom;
}

const segmentsOf = (dom) => {
  const nav = dom.app.querySelector('nav.offshelf-seg');
  assert.ok(nav, 'the screen renders no segment strip');
  return [...nav.querySelectorAll('a')].map((a) => ({
    href: a.getAttribute('href'),
    current: a.getAttribute('aria-current'),
    text: a.textContent.replace(/\s+/g, ' ').trim(),
  }));
};

test('every off-shelf screen heads itself with the four segments, its own marked', async (t) => {
  for (const [view, sub] of [['showRetired', 'retired'], ['showCompleted', 'completed'], ['showWishlist', 'wishlist']]) {
    const segs = segmentsOf(await render(t, view, RID));
    assert.deepEqual(segs.map((s) => s.href), ['retired', 'completed', 'wishlist', 'recommendations']
      .map((s) => `/round/${RID}/${s}`), `${view}: the segments are not the four routes`);
    assert.deepEqual(segs.filter((s) => s.current === 'page').map((s) => s.href), [`/round/${RID}/${sub}`],
      `${view}: exactly its own segment must be current`);
  }
});

test('the segments count what the rail counts, and the recommendations screen has them too', async (t) => {
  const segs = segmentsOf(await render(t, 'showRetired', RID));
  assert.equal(segs[0].text, 'Aussortiert (1)');
  assert.equal(segs[2].text, 'Wunschliste (1)');

  const rec = segmentsOf(await render(t, 'showRecommendations', RID));
  assert.equal(rec.find((s) => s.current === 'page').href, `/round/${RID}/recommendations`);
});
