'use strict';

/*
 * The tag manager's reorder controls (#1159), driven as a real DOM.
 *
 * Run through the jsdom harness rather than matched as source text: what goes
 * wrong in a reorder control is a listener bound to the wrong row, an end
 * button that never disables, or focus falling to the document mid-move — none
 * of which a regex over `views-round-settings.js` can see
 * (`.claude/rules/testing-views-under-jsdom.md`).
 *
 * The controls say „nach vorne"/„nach hinten" and carry LEFT/RIGHT arrows on
 * purpose: `.ds-list--tiles` is a wrapping grid (three columns at reading
 * width, one on a phone), so up/down would point somewhere the tag does not go
 * at most widths.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');

const RID = 'r1';

const tagRound = (tags) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags,
  members: [],
  games: [{ id: 'g1', title: 'Catan', minPlayers: 2, maxPlayers: 4, tagIds: [] }],
  sessions: [],
});

/* The reporter's own case: three tags created in an order he did not want. */
const THREE = [
  { id: 't1', name: 'Muy bien a 3' },
  { id: 't2', name: 'Muy bien a 4' },
  { id: 't3', name: 'Muy bien a 2' },
];

async function boot(t, { tags = THREE, patch } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  const sent = [];
  dom.set('api', async (method, url, body) => {
    if (/\/activities$/.test(url)) return [];
    if (method === 'PATCH' && /\/tags\/order$/.test(url)) {
      sent.push(body.tagIds);
      if (patch) return patch(body);
      return body.tagIds.map((id) => tags.find((tg) => tg.id === id));
    }
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return tagRound(tags);
    return {};
  });
  dom.set('toast', (m) => { dom.context.__toasts = (dom.context.__toasts || []).concat(m); });
  await dom.call('showTags', RID);
  await flush();
  return { dom, sent };
}

const names = (dom) => [...dom.app.querySelectorAll('.tag-row .tag--custom')].map((el) => el.textContent.trim());
const rowFor = (dom, name) => [...dom.app.querySelectorAll('.tag-row')]
  .find((r) => r.querySelector('.tag--custom').textContent.trim() === name);

test('the tag manager reorders a tag and persists the whole new order (#1159)', async (t) => {
  const { dom, sent } = await boot(t);
  assert.deepEqual(names(dom), ['Muy bien a 3', 'Muy bien a 4', 'Muy bien a 2'],
    'the fixture renders in creation order — the problem being fixed');

  // „Muy bien a 2" goes to the front, in two presses.
  const back = () => rowFor(dom, 'Muy bien a 2').querySelector('.tag-act--back');
  back().click();
  await flush();
  assert.deepEqual(names(dom), ['Muy bien a 3', 'Muy bien a 2', 'Muy bien a 4'],
    'the DOM moves optimistically, without waiting for the round-trip');
  back().click();
  await flush();
  assert.deepEqual(names(dom), ['Muy bien a 2', 'Muy bien a 3', 'Muy bien a 4']);

  assert.deepEqual(sent, [['t1', 't3', 't2'], ['t3', 't1', 't2']],
    'each press sends the FULL order, which is what lets the server reject a stale list');
});

test('focus stays on the pressed button, so repeated presses walk ONE tag (#1159)', async (t) => {
  const { dom } = await boot(t);
  const doc = dom.document;

  // The keyboard case the issue names: without the focus restore, moving the
  // row detaches it, focus falls to <body>, and three presses would move three
  // different tags one place each.
  const pressed = rowFor(dom, 'Muy bien a 2').querySelector('.tag-act--back');
  pressed.focus();
  pressed.click();
  await flush();
  assert.equal(doc.activeElement, rowFor(dom, 'Muy bien a 2').querySelector('.tag-act--back'),
    'focus followed the tag, not the position');

  doc.activeElement.click();
  await flush();
  assert.deepEqual(names(dom), ['Muy bien a 2', 'Muy bien a 3', 'Muy bien a 4'],
    'so two presses moved one tag two places');

  // At the front its own button is now disabled and cannot hold focus, so it
  // hands over to its partner rather than letting focus fall to the document.
  const row = rowFor(dom, 'Muy bien a 2');
  assert.equal(row.querySelector('.tag-act--back').disabled, true);
  assert.equal(doc.activeElement, row.querySelector('.tag-act--fwd'));
});

test('the ends are disabled, not hidden, and follow the tag as it moves (#1159)', async (t) => {
  const { dom } = await boot(t);
  const state = () => [...dom.app.querySelectorAll('.tag-row')].map((r) => [
    r.querySelector('.tag-act--back').disabled, r.querySelector('.tag-act--fwd').disabled]);

  assert.deepEqual(state(), [[true, false], [false, false], [false, true]]);
  assert.equal(dom.app.querySelectorAll('.tag-act--back').length, 3,
    'every row keeps both buttons — a tile whose controls change width as it moves is worse');

  rowFor(dom, 'Muy bien a 2').querySelector('.tag-act--back').click();
  await flush();
  rowFor(dom, 'Muy bien a 2').querySelector('.tag-act--back').click();
  await flush();
  assert.deepEqual(state(), [[true, false], [false, false], [false, true]],
    'the disabled ends moved with the order, not with the tags');
});

test('a single tag gets no reorder controls at all (#1159)', async (t) => {
  const { dom } = await boot(t, { tags: [{ id: 't1', name: 'Kennerspiel' }] });
  assert.equal(dom.app.querySelectorAll('.tag-row').length, 1, 'the row rendered');
  assert.equal(dom.app.querySelectorAll('.tag-act--back, .tag-act--fwd').length, 0,
    'two permanently dead buttons are worse than none');
  assert.ok(dom.app.querySelector('.tag-act[aria-label]'), 'the edit/delete controls are still there');
});

test('a 409 tags_changed re-renders from the server instead of keeping the local order (#1159)', async (t) => {
  const { dom } = await boot(t, { patch: () => { throw new Error('tags_changed'); } });
  rowFor(dom, 'Muy bien a 2').querySelector('.tag-act--back').click();
  await flush();
  await flush();

  assert.deepEqual(names(dom), ['Muy bien a 3', 'Muy bien a 4', 'Muy bien a 2'],
    'the optimistic move was thrown away — this list is stale by definition');
  assert.ok((dom.context.__toasts || []).some((m) => /geändert|changed/i.test(m)),
    'and the user is told why the tag jumped back');
});

test('the arrows are icon-only, so the LABEL carries the whole meaning (#1159)', async (t) => {
  const { dom } = await boot(t);
  for (const cls of ['.tag-act--back', '.tag-act--fwd']) {
    const btn = dom.app.querySelector(cls);
    assert.ok(btn.getAttribute('aria-label'), `${cls} has no aria-label`);
    assert.equal(btn.textContent.trim(), '', `${cls} has visible text — it is meant to be icon-only`);
    assert.equal(btn.querySelector('i').getAttribute('aria-hidden'), 'true',
      `${cls}'s glyph must not be announced beside the label`);
  }
  // Left/right, never up/down: the list is a wrapping grid.
  assert.ok(dom.app.querySelector('.tag-act--back .ti-arrow-left'));
  assert.ok(dom.app.querySelector('.tag-act--fwd .ti-arrow-right'));
});
