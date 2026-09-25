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

/* ---- Dragging a tile (#1180) ----
 *
 * SortableJS needs real layout, so no spec here performs a drag — jsdom has
 * none, and a test that appeared to would be asserting its own simulation. What
 * the REAL library does give us under jsdom is its instance, so these specs
 * reach the view's own handlers through `Sortable.get(list).options` and play
 * the part of the gesture exactly as Sortable does: move the DOM node first,
 * then report the draggable indices. Everything after that is the view's code.
 */

const listOf = (dom) => dom.app.querySelector('.ds-list--tiles');
const sortableOf = (dom) => dom.run('Sortable.get(document.querySelector(\'.ds-list--tiles\'))');

/* What Sortable has done by the time `onEnd` fires: the row is already in its
   new place. Then the event, in the only fields the view may read. */
function dragDrop(dom, from, to) {
  const list = listOf(dom);
  const rows = [...list.querySelectorAll('.tag-row')];
  const moved = rows[from];
  const rest = rows.filter((r) => r !== moved);
  if (to >= rest.length) list.appendChild(moved); else list.insertBefore(moved, rest[to]);
  sortableOf(dom).options.onEnd({ oldDraggableIndex: from, newDraggableIndex: to });
}

test('the tag list is made draggable by the real library, tiles only (#1180)', async (t) => {
  const { dom } = await boot(t);
  const inst = sortableOf(dom);
  assert.ok(inst, 'no Sortable instance on the tag list — makeReorderable was never called');
  assert.equal(inst.options.draggable, '.tag-row');
  assert.equal(inst.options.filter, '.tag-act', 'the arrows, pencil and trash keep their clicks');
  assert.ok(listOf(dom).classList.contains('is-reorderable'), 'the grab cursor hangs off this class');
});

test('dropping a tile persists the whole new order through the arrows\' route (#1180)', async (t) => {
  const { dom, sent } = await boot(t);
  dragDrop(dom, 2, 0);
  await flush();
  assert.deepEqual(names(dom), ['Muy bien a 2', 'Muy bien a 3', 'Muy bien a 4']);
  assert.deepEqual(sent, [['t3', 't1', 't2']],
    'ONE PATCH …/tags/order with the full list — the same request an arrow press makes');

  // The ends followed the tag: it is first now, so its back arrow is dead and
  // the tile it displaced has a live one again.
  assert.equal(rowFor(dom, 'Muy bien a 2').querySelector('.tag-act--back').disabled, true);
  assert.equal(rowFor(dom, 'Muy bien a 3').querySelector('.tag-act--back').disabled, false);
  assert.equal(rowFor(dom, 'Muy bien a 4').querySelector('.tag-act--fwd').disabled, true);
});

test('the arrows still work after a drag, on the order the drag left (#1180)', async (t) => {
  const { dom, sent } = await boot(t);
  dragDrop(dom, 0, 2);
  await flush();
  assert.deepEqual(names(dom), ['Muy bien a 4', 'Muy bien a 2', 'Muy bien a 3']);
  rowFor(dom, 'Muy bien a 3').querySelector('.tag-act--back').click();
  await flush();
  assert.deepEqual(names(dom), ['Muy bien a 4', 'Muy bien a 3', 'Muy bien a 2']);
  assert.deepEqual(sent, [['t2', 't3', 't1'], ['t2', 't1', 't3']],
    'the arrow moved the tag from where the DRAG put it — one shared order, not two');
});

test('a drop tells a screen reader where the tile landed (#1180)', async (t) => {
  const { dom } = await boot(t);
  dragDrop(dom, 2, 0);
  await flush();
  const live = dom.document.getElementById('srLive').textContent;
  assert.match(live, /Muy bien a 2/, 'the announcement names the tag');
  assert.match(live, /\b1\b.*\b3\b/, 'and its new position out of the total');
  assert.deepEqual(dom.context.__toasts || [], [], 'silently — a sighted user watched it land');
});

test('a drag closes an open inline editor rather than stranding it (#1180)', async (t) => {
  const { dom } = await boot(t);
  const pencil = [...rowFor(dom, 'Muy bien a 3').querySelectorAll('.tag-act')]
    .find((b) => b.querySelector('.ti-pencil'));
  pencil.click();
  assert.equal(dom.app.querySelectorAll('.tag-edit').length, 1, 'the pencil opened its editor');
  sortableOf(dom).options.onStart({});
  assert.equal(dom.app.querySelectorAll('.tag-edit').length, 0,
    'anchored after its own row, it would otherwise end up beside another tag');
});

test('a drop against a stale list re-renders from the server (#1180)', async (t) => {
  const { dom } = await boot(t, { patch: () => { throw new Error('tags_changed'); } });
  dragDrop(dom, 2, 0);
  await flush();
  await flush();
  assert.deepEqual(names(dom), ['Muy bien a 3', 'Muy bien a 4', 'Muy bien a 2'],
    'the dragged order was thrown away, exactly as an arrow press\'s is');
  assert.ok((dom.context.__toasts || []).some((m) => /geändert|changed/i.test(m)));
});

test('a single tag is not made draggable (#1180)', async (t) => {
  const { dom } = await boot(t, { tags: [{ id: 't1', name: 'Kennerspiel' }] });
  assert.equal(sortableOf(dom), undefined, 'nothing to reorder, so no drag and no grab cursor');
  assert.equal(listOf(dom).classList.contains('is-reorderable'), false);
});
