'use strict';

/* The Konto's section index in every design but Der Tisch (#1582).
 *
 * Das Programmheft (#1376) and Forest (#1470) had an index of the Konto's
 * sections beside them; Klassisch, Ocean and Die Brücke rendered one long
 * column. composeKontoIndex (views-account-index.js) now builds it for all of
 * them, and each stylesheet draws it. What is pinned here is what regresses
 * silently:
 *
 *   - every design but Der Tisch gets the index, one entry per section heading,
 *     in page order — and the sections keep every heading Klassisch has;
 *   - an entry JUMPS: the heading takes focus (tabindex -1) and its section
 *     scrolls into view, nothing is hidden;
 *   - a demo (fewer sections) gets an index that matches its own page;
 *   - the base stylesheet hides the index unconditionally and shows it only
 *     inside a desktop media block, so the phone stays one column.
 *
 * The two-column layout itself is CSS jsdom cannot apply; it was measured in
 * Chromium at 390, 768, 1280 and 1440.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, topLevel, mediaBlocks, CSS } = require('./support/css');

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

const ME = {
  id: 'u-ada', email: 'ada@example.test', username: 'ada', demo: false, avatar: null,
  statsVisible: true, notifyRoundInvitations: true, notifyFriendRequests: true, bgStats: false,
  bggUsername: null, design: 'klassisch',
};

async function konto(t, design, me = ME) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  dom.set('withAppConfig', (cb) => cb({ designs: ['klassisch', 'tisch', 'ocean', 'bruecke', 'programmheft', 'forest'] }));
  dom.set('accountApi', async (method, p) => {
    if (p === '/me') return { ...me, design };
    if (p === '/passkeys') return { passkeys: [] };
    return {};
  });
  dom.run(`accountUser = ${JSON.stringify({ ...me, design })}`);
  dom.call('applyDesign', design);
  await dom.call('showAccount');
  await flush();
  return dom;
}

const headings = (dom) => [...dom.app.querySelectorAll('.konto-ph__body h2.konto-section__h')].map(text);

for (const design of ['klassisch', 'ocean', 'bruecke', 'programmheft']) {
  test(`#1582: ${design}'s Konto has an index of every section beside them`, async (t) => {
    const dom = await konto(t, design);
    const nav = dom.app.querySelector(':scope > .konto-ph > nav.konto-index');
    assert.ok(nav, 'no index');
    assert.equal(nav.getAttribute('aria-label'), dom.run("t('konto.index.label')"));
    // Nothing of the screen is left outside the two columns.
    assert.deepEqual([...dom.app.children].map((el) => el.className), ['lobby-head', 'konto-ph']);
    const want = headings(dom);
    assert.ok(want.length >= 10, `only ${want.length} sections rendered`);
    const links = [...nav.querySelectorAll('li > button.konto-index__link[type="button"]')];
    assert.deepEqual(links.map(text), want);
  });
}

test('#1582: the index holds exactly the headings Klassisch rendered before it', async (t) => {
  // The sections are Klassisch's own (no section added or dropped by the index):
  // the same headings in the same order under every index design.
  const base = headings(await konto(t, 'klassisch'));
  for (const design of ['ocean', 'bruecke']) {
    assert.deepEqual(headings(await konto(t, design)), base, design);
  }
});

test('#1582: an entry jumps — the heading takes focus and its section scrolls into view', async (t) => {
  const dom = await konto(t, 'klassisch');
  const links = [...dom.app.querySelectorAll('.konto-index__link')];
  const sections = [...dom.app.querySelector('.konto-ph__body').children];
  const scrolled = [];
  sections.forEach((s, i) => { s.scrollIntoView = () => scrolled.push(i); });
  links[3].click();
  const heading = sections[3].querySelector('h2');
  assert.equal(dom.document.activeElement, heading);
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.deepEqual(scrolled, [3]);
  // A jump hides nothing: every section is still in the page.
  assert.equal(dom.app.querySelectorAll('.konto-ph__body h2.konto-section__h').length, links.length);
});

test('#1582: a demo\'s index matches its shorter page', async (t) => {
  const dom = await konto(t, 'klassisch', { ...ME, demo: true });
  const links = [...dom.app.querySelectorAll('.konto-index__link')].map(text);
  assert.deepEqual(links, headings(dom));
  assert.ok(!links.includes(dom.run("t('konto.pw.title')")), 'a demo has no password section');
  assert.ok(links.includes(dom.run("t('konto.demo.title')")));
});

test('#1582: Der Tisch keeps its dashboard and gets no index', async (t) => {
  const dom = await konto(t, 'tisch');
  assert.equal(dom.app.querySelector('.konto-index, .konto-ph'), null);
});

test('#1582: the base stylesheet shows the index only at desktop widths', () => {
  const always = rulesOf(topLevel(CSS));
  const hidden = always.find(([sel]) => sel === '.konto-index');
  assert.ok(hidden && /display:\s*none/.test(hidden[1]), 'the index must be hidden outside the desktop block');
  const desktop = mediaBlocks(CSS).filter(([q]) => /min-width:\s*1024px/.test(q))
    .flatMap(([, body]) => rulesOf(body));
  const shown = desktop.find(([sel]) => sel === '.konto-index');
  assert.ok(shown && /display:\s*block/.test(shown[1]), 'no desktop rule shows the index');
  const grid = desktop.find(([sel]) => sel === '.konto-ph');
  assert.ok(grid && /grid-template-columns:\s*\d+px minmax\(0, 1fr\)/.test(grid[1]), 'no two-column desktop grid');
});
