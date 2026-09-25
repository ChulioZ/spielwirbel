'use strict';

/* The hub's quick-start chips under EVERY design (#1328).

   A round's saved filters replace the automatic „Unter 60 Min / Leichte Kost /
   …" chips, and they must do so in every design — the ones live today and the
   ones still to come. That only holds while there is ONE renderer
   (`hubPresetChips`, hub-cards.js) that every design calls and merely styles.

   So this spec does not name the designs: it walks `DESIGN_REGISTRY`, which is
   the list the account picker offers and the server validates against. A
   design added tomorrow is covered the moment it is registered, and a design
   branch that builds its own chip row — or skips the row — goes red here by
   name.

   Rendered through the jsdom harness (`.claude/rules/testing-views-under-jsdom.md`),
   never `require`d. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { DESIGN_REGISTRY } = require('../public/js/designs');

const DESIGN_IDS = DESIGN_REGISTRY.map((d) => d.id);

// Half the shelf short, half long: the one shape on which the built-in
// „Unter 60 Min" chip both narrows something and leaves something — so the
// fallback case is not vacuous, and the saved case has a built-in to hide.
const game = (id, maxPlaytime) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, image: 'c.jpg', minPlaytime: 20, maxPlaytime,
});
const SAVED = [
  { id: 'f1', name: 'Kinderrunde mit Oma und dem ganzen Rest der Familie', tagIds: [], excludeTagIds: [], count: 2, memberIds: ['m1'] },
  { id: 'f2', name: 'Nur Koop', tagIds: ['t1'], excludeTagIds: [], count: 3, tagMode: 'any', memberIds: [] },
  { id: 'f3', name: '<b>Fett</b>', tagIds: [], excludeTagIds: [], count: 1, metadata: { maxPlaytime: 60 }, multiTable: true, memberIds: [] },
];
const round = (over = {}) => ({
  id: 3,
  name: 'Freitagsrunde',
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: Array.from({ length: 8 }, (_, i) => game('g' + i, i < 4 ? 30 : 120)),
  sessions: [],
  tags: [{ id: 't1', name: 'Koop' }],
  ...over,
});

const noRecos = () => async () => ({ recommendations: [] });
const chipLabels = (root) => [...root.querySelectorAll('.hub-preset')].map((b) => b.textContent.trim());
const builtInLabels = (dom) => ['short', 'light', 'meaty', 'family'].map((k) => dom.run(`t('hub.preset.${k}')`));

test('the registry is not empty, so the loops below cannot pass vacuously', () => {
  assert.ok(DESIGN_IDS.length >= 3, `only ${DESIGN_IDS.length} designs registered`);
});

for (const design of DESIGN_IDS) {
  test(`${design}: a round with saved filters shows exactly those chips, in order, and no built-in`, (t) => {
    const dom = loadApp({ design });
    t.after(() => dom.close());
    dom.set('api', noRecos());
    const r = round({ savedFilters: SAVED });
    dom.call('renderStartTab', r, r.games);

    const labels = chipLabels(dom.app);
    assert.deepEqual(labels, SAVED.map((f) => f.name),
      `${design} rendered ${JSON.stringify(labels)} — a design must call hubPresetChips, never build or skip the row`);
    for (const builtIn of builtInLabels(dom)) {
      assert.ok(!labels.includes(builtIn), `${design} still offers the built-in „${builtIn}" beside saved filters`);
    }
    // User text is escaped: the name renders as text, never as markup.
    assert.equal(dom.app.querySelector('.hub-preset b'), null, 'a saved name was injected as HTML');
    // The whole name stays reachable although CSS may clip it on screen.
    const long = dom.app.querySelector('.hub-preset--saved');
    assert.equal(long.getAttribute('title'), SAVED[0].name);

    // The rail copy (Klassisch ≥1280px) comes from the same call; a lean rail
    // (Der Tisch) carries none, but whatever a rail carries must be the same.
    const rail = dom.call('buildRoundRail', r, 'start');
    const railLabels = chipLabels(rail);
    if (railLabels.length) assert.deepEqual(railLabels, labels, `${design}'s rail offers different chips than its Start tab`);
  });

  test(`${design}: a round without saved filters keeps the built-in chips`, (t) => {
    const dom = loadApp({ design });
    t.after(() => dom.close());
    dom.set('api', noRecos());
    const r = round();
    dom.call('renderStartTab', r, r.games);
    assert.deepEqual(chipLabels(dom.app), [dom.run("t('hub.preset.short')")],
      `${design} lost the automatic fallback chips`);
  });
}

test('a saved chip opens the setup with the WHOLE filter — every key present, seats included', (t) => {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', noRecos());
  const seen = [];
  dom.set('showStartSession', (r, prefill) => seen.push(JSON.parse(JSON.stringify(prefill))));
  const r = round({ savedFilters: SAVED });
  dom.call('renderStartTab', r, r.games);

  const chips = dom.app.querySelectorAll('.hub-preset');
  chips[0].click();
  chips[2].click();
  // Every key is spelled out, so nothing falls through to the round's
  // remembered draw when showStartSession merges the prefill over it.
  assert.deepEqual(seen[0], {
    tagIds: [], excludeTagIds: [], tagMode: 'all', metadata: {}, multiTable: false, count: 2, memberIds: ['m1'],
  });
  assert.deepEqual(seen[1], {
    tagIds: [], excludeTagIds: [], tagMode: 'all', metadata: { maxPlaytime: 60 }, multiTable: true, count: 1, memberIds: [],
  });
});

test('tapping a saved chip does not touch lastSessionFilters', (t) => {
  // Only the draw writes the remembered preset (server-side), so the chip row
  // makes no request at all — the api stub is the whole observable.
  const dom = loadApp();
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url) => { calls.push(`${method} ${url}`); return { recommendations: [] }; });
  dom.set('showStartSession', () => {});
  const r = round({ savedFilters: SAVED });
  dom.call('renderStartTab', r, r.games);
  const before = calls.length;
  dom.app.querySelector('.hub-preset').click();
  assert.equal(calls.length, before, `the chip made a request: ${calls.slice(before).join(', ')}`);
});
