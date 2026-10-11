'use strict';

/*
 * The selection mode's Tags action (#1000), and creating a tag from it (#1619),
 * rendered for real and driven through the DOM. Split from
 * bulk-select-view.test.js, which covers the selection mode itself and the
 * other bulk actions; the two share only the small fixture helpers below.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush, waitFor } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);

let rid = 0;
const roundFixture = (over = {}) => ({
  id: `bt-${++rid}`,
  name: 'Freitagsrunde',
  members: [{ id: 'm1', name: 'Anna' }],
  tags: [],
  sessions: [],
  games: [
    { id: 'g1', title: 'Azul' },
    { id: 'g2', title: 'Brass' },
    { id: 'g3', title: 'Cascadia' },
  ],
  ...over,
});

function spy() {
  const calls = [];
  const confirms = [];
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body: body && JSON.parse(JSON.stringify(body)) });
    return {};
  });
  dom.set('confirmDialog', (o) => { confirms.push(o.body); return Promise.resolve(true); });
  dom.set('toast', () => {});
  dom.set('showRound', () => {});
  return { calls, confirms, posts: () => calls.filter((c) => c.method === 'POST') };
}

const regal = (over) => {
  dom.app.innerHTML = '';
  const r = roundFixture(over);
  dom.call('renderRegalTab', r, r.games.filter((g) => !g.retired && !g.completed && !g.wish));
  return r;
};
const cards = () => [...dom.app.querySelectorAll('.game-card')];
const cardFor = (title) => cards().find((c) => c.querySelector('.game-card__title').textContent === title);
const toggleBtn = () => [...dom.app.querySelectorAll('.section-tools .link-btn')]
  .find((b) => /Auswählen|Fertig/.test(b.textContent));
const bar = () => dom.app.querySelector('.bulk-bar');
const act = (name) => bar().querySelector(`[data-act="${name}"]`);

/* A sheet closes through history.back(), whose popstate jsdom queues on a task
   source flush() does not drain — see .claude/rules/jsdom-popstate-needs-a-real-timer.md. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => dom.window.setTimeout(r, 0));
};
const sheet = () => dom.document.querySelector('.sheet-backdrop .sheet');
const APPLY = dom.run("t('common.apply')");
const sheetBtn = (label) => [...sheet().querySelectorAll('.sheet__actions .btn')]
  .find((b) => b.textContent.trim() === label);

const TAGS_ROUND = {
  tags: [{ id: 't1', name: 'Kenner' }, { id: 't2', name: 'Kurz' }],
};

/* ------------------------------------------------------------- bulk tags

   The tags picker (#1000) shares openBulkPicker with the owners one, so the
   sheet scaffolding above already covers the OK/cancel path. What is specific
   here — and what no route spec can see — is the TRI-STATE: one chip means
   three different edits depending on how often it was clicked, and the third
   state is „leave alone", which must reach the server as neither list. */

const tagChipFor = (name) => [...sheet().querySelectorAll('.bulk-tags__chips .chip')]
  .find((c) => c.textContent.includes(name));

test('the tags action opens a picker over the round\'s tags, all three neutral', async () => {
  spy();
  regal(TAGS_ROUND);
  toggleBtn().click();
  assert.equal(act('tags').disabled, true, 'an empty selection must not be actionable');

  cardFor('Azul').click();
  assert.equal(act('tags').disabled, false);
  act('tags').click();

  assert.ok(sheet(), 'no picker opened');
  assert.equal(sheet().querySelectorAll('.bulk-tags__chips .chip').length, 2, 'one chip per round tag');
  // Neutral is the only safe start: the selection may hold games whose tags
  // differ, so any preselected state would be a claim about all of them.
  assert.ok([...sheet().querySelectorAll('.bulk-tags__chips .chip')]
    .every((c) => !c.classList.contains('is-on') && !c.classList.contains('is-excluded')));
  assert.equal(sheetBtn(APPLY).disabled, true, 'nothing picked is an unfinished sentence, not a no-op');

  sheetBtn('Abbrechen').click();
  await settle();
});

test('one click adds, two removes, three leaves the tag out of both lists', async () => {
  const { posts, confirms } = spy();
  const r = regal(TAGS_ROUND);
  toggleBtn().click();
  cardFor('Azul').click();
  cardFor('Cascadia').click();
  act('tags').click();

  tagChipFor('Kenner').click();                       // add
  tagChipFor('Kurz').click(); tagChipFor('Kurz').click(); // remove
  assert.ok(tagChipFor('Kenner').classList.contains('is-on'));
  assert.ok(tagChipFor('Kurz').classList.contains('is-excluded'));
  sheetBtn(APPLY).click();
  await settle();

  // #1360: the chips already show the direction and nothing is lost that the
  // same sheet cannot restore, so „Übernehmen" applies straight away.
  assert.equal(confirms.length, 0, 'the tags picker raised a second dialog');
  assert.equal(posts().length, 1);
  assert.equal(posts()[0].path, `/api/rounds/${r.id}/games/bulk-tags`);
  assert.deepEqual([...posts()[0].body.gameIds].sort(), ['g1', 'g3']);
  assert.deepEqual([...posts()[0].body.addTagIds], ['t1']);
  assert.deepEqual([...posts()[0].body.removeTagIds], ['t2']);
});

test('a third click returns the chip to neutral and sends neither instruction', async () => {
  const { posts } = spy();
  regal(TAGS_ROUND);
  toggleBtn().click();
  cardFor('Azul').click();
  act('tags').click();

  tagChipFor('Kenner').click();
  const chip = tagChipFor('Kurz');
  chip.click(); chip.click(); chip.click();           // add -> remove -> neutral
  assert.ok(!tagChipFor('Kurz').classList.contains('is-on'));
  assert.ok(!tagChipFor('Kurz').classList.contains('is-excluded'));
  sheetBtn(APPLY).click();
  await settle();

  assert.deepEqual([...posts()[0].body.addTagIds], ['t1']);
  assert.deepEqual([...posts()[0].body.removeTagIds], [], 'a neutral chip must travel in neither list');
});

/* With the confirm gone (#1360), the disabled „Übernehmen" is the ONLY thing
   between an empty pick and a request — so it is tested on its own, including
   the way back: a chip clicked round to neutral again must re-disable it
   (.claude/rules/redundant-guards-make-each-other-untestable.md). */
test('Übernehmen re-disables when every chip is back to neutral, and sends nothing', async () => {
  const { posts } = spy();
  regal(TAGS_ROUND);
  toggleBtn().click();
  cardFor('Azul').click();
  act('tags').click();

  const chip = tagChipFor('Kenner');
  chip.click();
  assert.equal(sheetBtn(APPLY).disabled, false, 'one pick enables it');
  chip.click(); chip.click();                         // remove -> neutral
  assert.equal(sheetBtn(APPLY).disabled, true, 'nothing picked any more, yet still actionable');
  sheetBtn(APPLY).click();
  await settle();
  assert.equal(posts().length, 0, 'a disabled Übernehmen still sent a request');
  sheetBtn('Abbrechen').click();
  await settle();
});

/* ------------------------------------------------- creating a tag inline (#1619)

   The bulk action exists for organising a freshly imported shelf, which is
   exactly when the right tag does not exist yet — so the sheet creates one
   through the TAGS route (which carries the per-round quota and the
   case-insensitive dedupe) and hands it back pre-set to „add". */

/* Answers the tags POST like the route does: a known name (any case) returns
   the existing tag, anything else a fresh one — or the quota error. */
function tagSpy(round, { quota = false, hold = null } = {}) {
  const calls = [];
  const toasts = [];
  let seq = 0;
  dom.set('api', async (method, path, body) => {
    calls.push({ method, path, body: body && JSON.parse(JSON.stringify(body)) });
    if (method === 'POST' && path === `/api/rounds/${round.id}/tags`) {
      if (quota) throw new Error('quota_tags');
      if (hold) await hold;
      const hit = (round.tags || []).find((tg) => tg.name.toLowerCase() === body.name.toLowerCase());
      return hit || { id: `new-${++seq}`, name: body.name, icon: body.icon };
    }
    return method === 'GET' ? round : { updated: 1 };
  });
  dom.set('confirmDialog', () => Promise.resolve(true));
  dom.set('toast', (msg, opts) => toasts.push({ msg, tone: opts && opts.tone }));
  dom.set('showRound', () => {});
  return {
    calls, toasts,
    tagPosts: () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tags')),
    bulkPosts: () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/bulk-tags')),
  };
}
const nameInput = () => sheet().querySelector('.bulk-tags__create input');
const addTagBtn = () => sheet().querySelector('.bulk-tags__create [data-act="create-tag"]');
// Open the Regal, pick Azul + Cascadia, open the tags sheet. The fixture round
// is passed in rather than built here so tagSpy can answer from its tags.
const openTagsFor = (over) => {
  const r = roundFixture(over);
  dom.app.innerHTML = '';
  return r;
};
const showAndOpen = (r) => {
  dom.call('renderRegalTab', r, r.games.filter((g) => !g.retired && !g.completed && !g.wish));
  toggleBtn().click();
  cardFor('Azul').click();
  cardFor('Cascadia').click();
  act('tags').click();
};

test('a round with no tags still offers the tags action, with just the create row', async () => {
  const r = openTagsFor();
  tagSpy(r);
  showAndOpen(r);

  assert.ok(sheet(), 'no picker opened');
  assert.ok(nameInput(), 'no way to name a new tag');
  assert.equal(nameInput().getAttribute('aria-label'), dom.run("t('tags.addPlaceholder')"),
    'a placeholder is not a label');
  assert.equal(nameInput().getAttribute('maxlength'), '30');
  assert.ok(sheet().querySelector('.bulk-tags__create .icon-picker__trigger'), 'no icon picker');
  assert.equal(sheet().querySelector('.bulk-tags__chips').hidden, true, 'an empty chip row must not show');
  assert.equal(sheetBtn(APPLY).disabled, true, 'nothing picked and nothing typed');

  sheetBtn('Abbrechen').click();
  await settle();
});

test('„Hinzufügen" creates the tag, and its chip arrives set to add', async () => {
  const r = openTagsFor(TAGS_ROUND);
  const { tagPosts, bulkPosts } = tagSpy(r);
  showAndOpen(r);

  nameInput().value = 'Neu';
  addTagBtn().click();
  await waitFor(() => tagChipFor('Neu'), { label: 'the new chip' });

  assert.equal(tagPosts().length, 1);
  assert.equal(tagPosts()[0].body.name, 'Neu');
  assert.ok(tagChipFor('Neu').classList.contains('is-on'), 'a created tag must start as add');
  assert.equal(nameInput().value, '', 'the input clears for the next one');
  assert.equal(sheetBtn(APPLY).disabled, false);
  assert.equal(r.tags.length, 2, 'the cached round must not be mutated');

  tagChipFor('Kurz').click(); tagChipFor('Kurz').click(); // and a remove alongside
  sheetBtn(APPLY).click();
  await settle();

  assert.equal(bulkPosts().length, 1);
  assert.deepEqual([...bulkPosts()[0].body.gameIds].sort(), ['g1', 'g3']);
  assert.deepEqual([...bulkPosts()[0].body.addTagIds], ['new-1']);
  assert.deepEqual([...bulkPosts()[0].body.removeTagIds], ['t2']);
});

test('Enter in the name field creates, like „Hinzufügen"', async () => {
  const r = openTagsFor(TAGS_ROUND);
  const { tagPosts } = tagSpy(r);
  showAndOpen(r);

  nameInput().value = 'Abend';
  nameInput().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => tagChipFor('Abend'), { label: 'the new chip' });
  assert.equal(tagPosts().length, 1);

  sheetBtn('Abbrechen').click();
  await settle();
});

test('Übernehmen with only a typed name creates the tag and applies it', async () => {
  const r = openTagsFor();
  const { tagPosts, bulkPosts } = tagSpy(r);
  showAndOpen(r);

  nameInput().value = 'Koop';
  nameInput().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(sheetBtn(APPLY).disabled, false, 'a typed name is something to apply');
  sheetBtn(APPLY).click();
  await waitFor(() => bulkPosts().length, { label: 'the bulk-tags request' });
  await settle();

  assert.equal(tagPosts().length, 1);
  assert.equal(tagPosts()[0].body.name, 'Koop');
  assert.deepEqual([...bulkPosts()[0].body.addTagIds], ['new-1']);
  assert.deepEqual([...bulkPosts()[0].body.removeTagIds], []);
});

test('an existing name (any case) marks that chip as add — no duplicate', async () => {
  const r = openTagsFor(TAGS_ROUND);
  const { bulkPosts } = tagSpy(r);
  showAndOpen(r);

  nameInput().value = 'kenner';
  addTagBtn().click();
  await waitFor(() => tagChipFor('Kenner').classList.contains('is-on'), { label: 'Kenner set to add' });

  assert.equal(sheet().querySelectorAll('.bulk-tags__chips .chip').length, 2, 'a duplicate chip appeared');
  sheetBtn(APPLY).click();
  await settle();
  assert.deepEqual([...bulkPosts()[0].body.addTagIds], ['t1']);
});

/* The create is awaited before the sheet closes, so the window between the tap
   and the close is real — held open here with a deferred reply so a second tap
   can land inside it (.claude/rules/redundant-guards-make-each-other-untestable.md). */
test('a second tap on Übernehmen while the tag is being created applies once', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const r = openTagsFor();
  const { tagPosts, bulkPosts } = tagSpy(r, { hold });
  showAndOpen(r);

  nameInput().value = 'Koop';
  nameInput().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  sheetBtn(APPLY).click();
  await flush();
  sheetBtn(APPLY).click();
  release();
  await waitFor(() => bulkPosts().length, { label: 'the bulk-tags request' });
  await settle();

  assert.equal(tagPosts().length, 1, 'the tag was created twice');
  assert.equal(bulkPosts().length, 1, 'the selection was tagged twice');
});

test('a second „Hinzufügen" while the first is in flight creates the tag once', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const r = openTagsFor(TAGS_ROUND);
  const { tagPosts } = tagSpy(r, { hold });
  showAndOpen(r);

  nameInput().value = 'Neu';
  addTagBtn().click();
  addTagBtn().click();
  nameInput().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  nameInput().value = 'Weiter';                     // typed while the request ran
  release();
  await waitFor(() => tagChipFor('Neu'), { label: 'the new chip' });
  await flush();

  assert.equal(tagPosts().length, 1, 'the same name was posted more than once');
  assert.equal(nameInput().value, 'Weiter', 'the create wiped a name typed meanwhile');
  assert.equal(sheet().querySelectorAll('.bulk-tags__chips .chip').length, 3);
  sheetBtn('Abbrechen').click();
  await settle();
});

/* Editing while the create behind Übernehmen is pending runs syncOk, which must
   not hand the button back before the submission settles. */
test('Übernehmen stays disabled while its creation is pending, whatever else is edited', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const r = openTagsFor(TAGS_ROUND);
  const { bulkPosts } = tagSpy(r, { hold });
  showAndOpen(r);

  nameInput().value = 'Koop';
  nameInput().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  sheetBtn(APPLY).click();
  await flush();
  nameInput().value = 'Koop2';
  nameInput().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  tagChipFor('Kenner').click();
  assert.equal(sheetBtn(APPLY).disabled, true, 'an edit re-enabled Übernehmen mid-submission');

  release();
  await waitFor(() => tagChipFor('Koop'), { label: 'the created chip' });
  await settle();
  // The name typed meanwhile is unsubmitted, so the sheet must not close over it.
  assert.ok(sheet(), 'Übernehmen closed over a name typed while it ran');
  assert.equal(nameInput().value, 'Koop2');
  assert.equal(bulkPosts().length, 0, 'applied before the second name was submitted');

  sheetBtn(APPLY).click();
  await waitFor(() => bulkPosts().length, { label: 'the bulk-tags request' });
  await settle();
  assert.equal(bulkPosts().length, 1);
  assert.deepEqual([...bulkPosts()[0].body.addTagIds].sort(), ['new-1', 'new-2', 't1']);
});

/* „Abbrechen" while the create behind Übernehmen is pending is the user saying
   no. The tag itself stays (as with „Hinzufügen"), but nothing is applied. */
test('cancelling while Übernehmen\'s creation is pending applies nothing', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const r = openTagsFor(TAGS_ROUND);
  const { bulkPosts } = tagSpy(r, { hold });
  showAndOpen(r);

  nameInput().value = 'Koop';
  nameInput().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  sheetBtn(APPLY).click();
  await flush();
  sheetBtn('Abbrechen').click();
  await settle();
  release();
  await settle();

  assert.equal(bulkPosts().length, 0, 'a cancelled sheet still applied the tags');
});

test('a tag created and then cancelled is offered when the sheet reopens', async () => {
  const r = openTagsFor(TAGS_ROUND);
  tagSpy(r);
  showAndOpen(r);

  nameInput().value = 'Neu';
  addTagBtn().click();
  await waitFor(() => tagChipFor('Neu'), { label: 'the new chip' });
  sheetBtn('Abbrechen').click();
  await settle();

  act('tags').click();
  assert.ok(tagChipFor('Neu'), 'the created tag vanished from the reopened sheet');
  assert.ok(!tagChipFor('Neu').classList.contains('is-on'), 'a reopened sheet starts neutral');
  assert.equal(r.tags.length, 2, 'the cached round must not be mutated');
  sheetBtn('Abbrechen').click();
  await settle();
});

/* Enter also confirms an IME candidate (Korean ships), so a composing Enter is
   not a request to create — it would post a half-typed name. */
test('Enter during IME composition does not create', async () => {
  const r = openTagsFor(TAGS_ROUND);
  const { tagPosts } = tagSpy(r);
  showAndOpen(r);

  nameInput().value = '협력';
  nameInput().dispatchEvent(new dom.window.KeyboardEvent('keydown',
    { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
  await flush();
  assert.equal(tagPosts().length, 0, 'a composing Enter created the tag');
  // WebKit can deliver the confirming Enter AFTER compositionend, with
  // isComposing false but the IME's keyCode 229 still on it.
  nameInput().dispatchEvent(new dom.window.KeyboardEvent('keydown',
    { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
  await flush();
  assert.equal(tagPosts().length, 0, 'a keyCode-229 Enter created the tag');
  // Control: a plain Enter still creates, so the two above are not vacuous.
  nameInput().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => tagPosts().length, { label: 'the plain-Enter create' });

  sheetBtn('Abbrechen').click();
  await settle();
});

test('the quota error toasts and keeps the sheet open, applying nothing', async () => {
  const r = openTagsFor(TAGS_ROUND);
  const { toasts, bulkPosts } = tagSpy(r, { quota: true });
  showAndOpen(r);

  nameInput().value = 'Zuviel';
  nameInput().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  sheetBtn(APPLY).click();
  await waitFor(() => toasts.length, { label: 'the quota toast' });
  await settle();

  assert.equal(toasts[0].msg, dom.run("t('tags.toast.quota')"));
  assert.equal(toasts[0].tone, 'error');
  assert.ok(sheet(), 'the sheet closed and the typed name was lost');
  assert.equal(nameInput().value, 'Zuviel');
  assert.equal(bulkPosts().length, 0, 'a failed creation must not apply anything');

  sheetBtn('Abbrechen').click();
  await settle();
});
