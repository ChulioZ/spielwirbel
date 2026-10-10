'use strict';

/* Klassisch's and Der Tisch's Einstellungen (#1581): the round's name and its
 * marker picker on the page, in two columns — set-up left, actions right — and
 * the separate /design screen retired, its address landing here. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush, waitFor } = require('./support/dom');

const RID = 'r1';
const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  marker: 2,
  background: null,
  tags: [],
  providers: [],
  savedFilters: [],
  members: [{ id: 'm1', name: 'Anna' }],
  games: [{ id: 'g1', title: 'Azul', tagIds: [] }],
  sessions: [],
};

function boot(t, { design = 'klassisch', round = ROUND } = {}) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (method === 'PATCH' && /\/marker$/.test(url)) return { marker: body.index };
    if (method === 'PATCH' && url === `/api/rounds/${RID}`) return { ...round, name: body.name };
    if (/\/activities$/.test(url)) return [];
    if (url === `/api/rounds/${RID}`) return { ...round };
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  return { dom, calls };
}

const headings = (col) => [...col.querySelectorAll('h2.rs-section__h')].map((h) => h.textContent.trim());

for (const design of ['klassisch', 'tisch']) {
  test(`${design}: name and marker lead the set-up column, the actions take the other`, async (t) => {
    const { dom } = boot(t, { design });
    await dom.call('showRoundSettings', RID);
    const [main, aside, extra] = dom.app.querySelectorAll(':scope > .rs-cols > .rs-col');
    assert.ok(main && aside && !extra, 'expected exactly two columns');
    assert.ok(aside.classList.contains('rs-col--act'));
    assert.ok(main.firstElementChild.matches('.rs-sec--name'), 'the name must lead the set-up');
    assert.equal(main.querySelector('.rs-sec--name input').value, 'Freitagsrunde');
    assert.ok(main.children[1].matches('.rs-sec--marker'), 'the marker picker follows the name');
    const swatches = main.querySelectorAll('.rs-sec--marker .marker-card');
    assert.equal(swatches.length, 8);
    assert.equal(swatches[2].getAttribute('aria-pressed'), 'true');
    const t_ = (k) => dom.run(`t('${k}')`);
    assert.ok(headings(main).includes(t_('roundSettings.config')));
    assert.deepEqual(headings(aside), [t_('roundSettings.manage'), t_('roundSettings.danger')]);
    // Nothing left stranded outside the columns after the page head.
    const head = dom.app.querySelector(':scope > .page-head');
    let n = head.nextElementSibling;
    const loose = [];
    for (; n; n = n.nextElementSibling) if (!n.matches('.rs-cols')) loose.push(n.className);
    assert.deepEqual(loose, []);
  });
}

test('no row leads to a separate marker screen any more — Tags is the one sub-screen', async (t) => {
  const { dom } = boot(t);
  await dom.call('showRoundSettings', RID);
  const hrefs = [...dom.app.querySelectorAll('a.rs-row[href]')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, [`/round/${RID}/tags`]);
});

test('a grantee who may not rename sees the marker but no name field', async (t) => {
  const { dom } = boot(t, { round: { ...ROUND, shared: true, role: 'editor' } });
  await dom.call('showRoundSettings', RID);
  assert.equal(dom.app.querySelector('.rs-sec--name'), null);
  assert.ok(dom.app.querySelector('.rs-col:first-child > .rs-sec--marker'), 'the marker must then lead');
});

test('the name field is labelled by its heading and commits on blur', async (t) => {
  const { dom, calls } = boot(t);
  await dom.call('showRoundSettings', RID);
  const input = dom.app.querySelector('.rs-sec--name input');
  const label = dom.document.getElementById(input.getAttribute('aria-labelledby'));
  assert.equal(label.textContent.trim(), dom.run("t('newRound.nameLabel')"));
  input.focus();
  input.value = 'Samstagsrunde';
  input.blur();
  const patch = await waitFor(() => calls.find((c) => c.method === 'PATCH'), { label: 'the rename PATCH' });
  assert.equal(patch.url, `/api/rounds/${RID}`);
  assert.equal(patch.body.name, 'Samstagsrunde');
});

test('a swatch picked on the settings screen saves and repaints there', async (t) => {
  const { dom, calls } = boot(t);
  await dom.call('showRoundSettings', RID);
  dom.app.querySelectorAll('.marker-card')[5].click();
  await flush();
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, `/api/rounds/${RID}/marker`);
  assert.ok(dom.app.querySelector('.rs-cols'), 'the re-render must stay on Einstellungen');
  const pressed = [...dom.app.querySelectorAll('.marker-card')].findIndex((c) => c.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed, 5);
});

test('the old /design address lands on Einstellungen', async (t) => {
  const { dom } = boot(t);
  assert.match(dom.run(`String(resolveRoute('/round/${RID}/design'))`), /showRoundSettings/);
  await dom.run(`resolveRoute('/round/${RID}/design')()`);
  await flush();
  assert.equal(dom.window.location.pathname, `/round/${RID}/settings`, 'the address is rewritten to the screen shown');
  assert.equal(dom.run("typeof showMarker"), 'undefined', 'the retired screen left dead code behind');
});
