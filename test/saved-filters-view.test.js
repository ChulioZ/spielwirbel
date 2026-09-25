'use strict';

/* Saved session filters (#1328) on the two screens that WRITE them: the
   session setup's „Filter speichern" and the Einstellungen list.

   The setup cases read the screen's state back through the save body, which is
   the one observable that covers every control at once — so the same probe also
   proves what a saved chip's prefill actually put on the screen (stale seats and
   tags dropped, nothing leaking in from the round's remembered draw).

   Rendered through the jsdom harness, never `require`d
   (`.claude/rules/testing-views-under-jsdom.md`). */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor } = require('./support/dom');

const game = (id, maxPlaytime) => ({
  id, title: 'Spiel ' + id, minPlayers: 1, maxPlayers: 6, minPlaytime: 20, maxPlaytime,
});
const round = (over = {}) => ({
  id: 'r1',
  name: 'Freitagsrunde',
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
    { id: 'm3', name: 'Cleo', retired: true },
  ],
  games: [game('g1', 30), game('g2', 45), game('g3', 120), game('g4', 180)],
  sessions: [],
  tags: [{ id: 't1', name: 'Koop' }],
  ...over,
});

/* Opens the setup screen, presses „Filter speichern", names the filter and
   saves; resolves with the POST body the screen sent. `prefillOf(dom)` builds
   the prefill inside the harness (savedFilterPrefill lives in its realm). */
async function saveFromSetup(t, r, prefillOf) {
  const dom = loadApp();
  t.after(() => dom.close());
  const posts = [];
  dom.set('api', async (method, url, body) => {
    if (method === 'POST' && url === `/api/rounds/${r.id}/filters`) {
      posts.push({ ...body });
      return { id: 'new1', name: body.name };
    }
    return {};
  });
  dom.set('toast', () => {});
  dom.call('showStartSession', r, prefillOf ? prefillOf(dom) : undefined);
  dom.document.querySelector('.setup-save__btn').click();
  const input = dom.document.querySelector('#savedFilterName');
  assert.ok(input, 'the save sheet did not open');
  input.value = '  Kurzer Rest  ';
  dom.document.querySelector('#savedFilterGo').click();
  await waitFor(() => posts.length, { label: 'the save POST' });
  return { dom, body: posts[0] };
}

test('„Filter speichern" posts the screen\'s current setup, seats included', async (t) => {
  const r = round({ lastSessionFilters: { tagIds: ['t1'], excludeTagIds: [], count: 4, tagMode: 'any' } });
  const { body } = await saveFromSetup(t, r);
  assert.equal(body.name, 'Kurzer Rest', 'the name is trimmed before it is sent');
  assert.equal(body.count, 4);
  assert.deepEqual([...body.tagIds], ['t1']);
  assert.deepEqual([...body.excludeTagIds], []);
  assert.equal(body.tagMode, 'any');
  assert.equal(body.multiTable, false);
  assert.deepEqual([...body.memberIds], ['m1', 'm2'], 'the active seats — never the retired one');
  assert.equal('guests' in body, false, 'guests are the evening\'s, not the filter\'s');
});

test('a saved chip\'s prefill REPLACES the remembered draw and drops stale seats and tags', async (t) => {
  // The remembered draw says OR-mode, a Koop tag, 180 min, multi-table and 5 —
  // none of which the saved filter carries. Merged naively, all of it leaks in.
  const r = round({
    lastSessionFilters: {
      tagIds: ['t1'], excludeTagIds: [], count: 5, tagMode: 'any',
      metadata: { maxPlaytime: 180 }, multiTable: true,
    },
  });
  const saved = { id: 'f1', name: 'Kurz', tagIds: ['deleted-tag'], excludeTagIds: [], count: 2, memberIds: ['m1', 'm3', 'gone'] };
  const { body: s } = await saveFromSetup(t, r, (dom) => dom.call('savedFilterPrefill', saved));
  assert.equal(s.count, 2);
  assert.deepEqual([...s.tagIds], [], 'a deleted tag is dropped');
  assert.equal(s.tagMode, 'all', 'the remembered OR-mode leaked into the saved filter');
  assert.equal(s.multiTable, false, 'the remembered multi-table leaked into the saved filter');
  assert.notEqual(s.metadata.maxPlaytime, 180, 'the remembered 180 min leaked into the saved filter');
  assert.deepEqual([...s.memberIds], ['m1'], 'a retired and a removed seat are dropped, the rest kept');
});

test('a saved filter whose seats have ALL gone seats everyone', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const posts = [];
  dom.set('api', async (method, url, b) => { if (method === 'POST') posts.push({ ...b }); return { id: 'x', name: 'y' }; });
  dom.set('toast', () => {});
  const saved = { id: 'f1', name: 'Alt', tagIds: [], excludeTagIds: [], count: 1, memberIds: ['m3', 'gone'] };
  dom.call('showStartSession', round(), dom.call('savedFilterPrefill', saved));
  dom.document.querySelector('.setup-save__btn').click();
  dom.document.querySelector('#savedFilterName').value = 'Probe';
  dom.document.querySelector('#savedFilterGo').click();
  await waitFor(() => posts.length, { label: 'the probe POST' });
  assert.deepEqual([...posts[0].memberIds], ['m1', 'm2']);
});

test('the save control is open until /api/config reports a ceiling', (t) => {
  // MUST touch no setter: the default is what an instance whose config probe
  // failed runs on (.claude/rules/break-the-code-on-purpose.md, defaulted flags).
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ({}));
  const full = Array.from({ length: 9 }, (_, i) => ({ id: 'f' + i, name: 'F' + i }));
  dom.call('showStartSession', round({ savedFilters: full }));
  assert.equal(dom.document.querySelector('.setup-save__btn').disabled, false);
  assert.equal(dom.document.querySelector('.setup-save__reason').hidden, true);
});

test('at the ceiling the save control is disabled with a VISIBLE reason naming it', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ({}));
  dom.call('setSavedFilterLimits', { perRound: 2, nameMax: 40 });
  dom.call('showStartSession', round({ savedFilters: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }));
  const btn = dom.document.querySelector('.setup-save__btn');
  const reason = dom.document.querySelector('.setup-save__reason');
  assert.equal(btn.disabled, true);
  assert.equal(reason.hidden, false);
  assert.match(reason.textContent, /2/);
  assert.equal(btn.getAttribute('aria-describedby'), reason.id);
});

test('the name input takes its maxlength from the config, not a copy', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ({}));
  dom.call('setSavedFilterLimits', { perRound: 6, nameMax: 40 });
  dom.call('showStartSession', round());
  dom.document.querySelector('.setup-save__btn').click();
  assert.equal(dom.document.querySelector('#savedFilterName').getAttribute('maxlength'), '40');
});

test('a refused save names the reason and leaves the sheet open', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const toasts = [];
  dom.set('toast', (msg) => toasts.push(msg));
  dom.set('api', async (method) => {
    if (method === 'POST') throw new Error('filter_name_taken');
    return {};
  });
  dom.call('showStartSession', round());
  dom.document.querySelector('.setup-save__btn').click();
  dom.document.querySelector('#savedFilterName').value = 'Doppelt';
  dom.document.querySelector('#savedFilterGo').click();
  await waitFor(() => toasts.length, { label: 'the refusal toast' });
  assert.equal(toasts[0], dom.run("t('savedFilters.toast.nameTaken')"));
  assert.ok(dom.document.querySelector('#savedFilterName'), 'the sheet closed on a refusal');
});

// ------------------------------------------------------------ Einstellungen

/* A stateful stub: the list lives here and every write updates it, because
   the screen re-renders after each one and its SWR read revalidates against
   this — a static fixture would put the old order back. */
function settingsServer(r) {
  const calls = [];
  const api = async (method, url, body) => {
    calls.push({ method, url, body: body && JSON.parse(JSON.stringify(body)) });
    const base = `/api/rounds/${r.id}/filters`;
    if (method === 'PATCH' && url === `${base}/order`) {
      r.savedFilters = body.filterIds.map((id) => r.savedFilters.find((f) => f.id === id));
      return r.savedFilters;
    }
    if (method === 'PATCH' && url.startsWith(base + '/')) {
      const f = r.savedFilters.find((x) => url.endsWith('/' + x.id));
      f.name = body.name;
      return { ...f };
    }
    if (method === 'DELETE') {
      r.savedFilters = r.savedFilters.filter((x) => !url.endsWith('/' + x.id));
      return { ok: true };
    }
    return JSON.parse(JSON.stringify(r));
  };
  return { api, calls };
}
const rowNames = (dom) => [...dom.app.querySelectorAll('.saved-filter-row__name')].map((el) => el.textContent);

test('Einstellungen explains where filters come from when there are none', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', settingsServer(round()).api);
  await dom.call('showRoundSettings', 'r1');
  const empty = dom.app.querySelector('.saved-filters__empty');
  assert.ok(empty, 'no empty state');
  assert.equal(empty.textContent, dom.run("t('savedFilters.empty')"));
});

test('Einstellungen lists the saved filters in order and reorders them', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const r = round({ savedFilters: [{ id: 'a', name: 'Eins' }, { id: 'b', name: 'Zwei' }, { id: 'c', name: 'Drei' }] });
  const server = settingsServer(r);
  dom.set('api', server.api);
  await dom.call('showRoundSettings', 'r1');
  assert.deepEqual(rowNames(dom), ['Eins', 'Zwei', 'Drei']);
  const rows = dom.app.querySelectorAll('.saved-filter-row');
  assert.equal(rows[0].querySelector('.sf-act--up').disabled, true, 'the first row can move up');
  assert.equal(rows[2].querySelector('.sf-act--down').disabled, true, 'the last row can move down');

  rows[0].querySelector('.sf-act--down').click();
  const order = await waitFor(() => server.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/order')), { label: 'the reorder' });
  assert.deepEqual(order.body.filterIds, ['b', 'a', 'c'], 'the WHOLE order is sent');
  await waitFor(() => rowNames(dom)[0] === 'Zwei', { label: 'the re-render' });
  assert.deepEqual(rowNames(dom), ['Zwei', 'Eins', 'Drei']);
});

test('Einstellungen renames and deletes (with a confirm)', async (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  const r = round({ savedFilters: [{ id: 'a', name: 'Eins' }, { id: 'b', name: 'Zwei' }] });
  const server = settingsServer(r);
  dom.set('api', server.api);
  dom.set('toast', () => {});
  const asked = [];
  dom.set('confirmDialog', async (opts) => { asked.push(opts.body); return true; });
  await dom.call('showRoundSettings', 'r1');

  dom.app.querySelector('.saved-filter-row .sf-act--rename').click();
  const input = dom.app.querySelector('.tag-edit input');
  input.value = ' Eins neu ';
  dom.app.querySelector('.tag-edit .btn--primary').click();
  const rename = await waitFor(() => server.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/a')), { label: 'the rename' });
  assert.deepEqual(rename.body, { name: 'Eins neu' });
  await waitFor(() => rowNames(dom)[0] === 'Eins neu', { label: 'the renamed row' });

  const rows = dom.app.querySelectorAll('.saved-filter-row');
  rows[1].querySelector('.sf-act--delete').click();
  await waitFor(() => server.calls.find((c) => c.method === 'DELETE'), { label: 'the delete' });
  assert.equal(asked.length, 1, 'deleted without asking');
  assert.match(asked[0], /Zwei/);
  await waitFor(() => rowNames(dom).length === 1, { label: 'the row to go' });
});

/* #1346: the save control sits BESIDE the trigger it saves the result of, not
   under the pool. `.fbar` and `.fbar-mount` are `display: contents` in the
   setup filter bar, so DOM order inside it IS the flex order — the button has to
   be the trigger's next sibling (and so ahead of the chip line, which takes a
   line of its own), and the reason line has to come after the chips. */
test('the save control follows the Filter trigger, and its reason line ends the filter bar', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ({}));
  dom.call('showStartSession', round(), { tagIds: ['t1'] });
  const bar = dom.document.querySelector('.setup-filterbar');
  const trigger = bar.querySelector('.fbar__trigger');
  const btn = dom.document.querySelector('.setup-save__btn');
  const reason = dom.document.querySelector('.setup-save__reason');
  assert.ok(trigger, 'the fixture offers a filter');
  assert.equal(trigger.nextElementSibling, btn, 'the save button is not beside the trigger');
  const chips = bar.querySelector('.fbar__chips');
  assert.ok(btn.compareDocumentPosition(chips) & 4, 'the chip line must follow the button');
  assert.equal(bar.lastElementChild, reason, 'the reason line must end the filter bar, after the chips');
  // The label is a real text node the button is named by — hidden visually on a
  // phone, never removed, so the accessible name stays single-sourced.
  assert.equal(btn.querySelector('.setup-save__label').textContent, dom.run("t('savedFilters.save')"));
});

test('with nothing to filter by, the save control still renders in the filter bar', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async () => ({}));
  const bare = (id) => ({ id, title: 'Spiel ' + id });
  dom.call('showStartSession', round({ games: [bare('g1'), bare('g2')], tags: [] }));
  const mount = dom.document.querySelector('#filterMount');
  assert.equal(mount.hidden, true, 'the fixture must offer no filter at all');
  const btn = dom.document.querySelector('.setup-save__btn');
  assert.equal(mount.nextElementSibling, btn, 'the save button must stand in the filter bar after the mount');
});
