'use strict';

/* Das Programmheft's Einstellungen edit the round's name in place (#1423,
 * P14.6 „Name"): an always-open field at the head of the set-up column, which
 * commits on blur like every inline editor in the app. The commit decision is
 * saveRoundName (views-round.js), shared with the rail's click-to-edit heading,
 * so both editors are driven here — the refactor moved the heading's logic.
 *
 * jsdom fires real blur events (unlike the Browser pane,
 * .claude/rules/blur-events-never-fire-in-the-preview-pane.md), so `blur()` on
 * a focused field is the real path; a dispatched FocusEvent is used where the
 * field is not focused, which is what Enter → blur() does in a focused page. */

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

function boot(t, { design = 'programmheft', round = ROUND, patch } = {}) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  const calls = [];
  const toasts = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (method === 'PATCH' && url === `/api/rounds/${RID}`) return patch ? patch(body) : { ...round, name: body.name };
    if (/\/activities$/.test(url)) return [];
    if (url === `/api/rounds/${RID}`) return { ...round };
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('toast', (msg, opts) => { toasts.push({ msg, tone: opts && opts.tone }); });
  return { dom, calls, toasts };
}

const patches = (calls) => calls.filter((c) => c.method === 'PATCH');
const field = (dom) => dom.app.querySelector('.rs-ph__sec--name input');

test('the name field heads the set-up column, holding the round\'s name, labelled by its kicker', async (t) => {
  const { dom } = boot(t);
  await dom.call('showRoundSettings', RID);
  const sec = dom.app.querySelector('.rs-ph > .rs-ph__col:not(.rs-ph__col--act) > .rs-ph__sec--name');
  assert.ok(sec, 'no name section in the left column');
  assert.equal(sec.parentElement.firstElementChild, sec, 'the name must lead the column (P14.6)');
  const input = field(dom);
  assert.equal(input.value, 'Freitagsrunde');
  const label = dom.document.getElementById(input.getAttribute('aria-labelledby'));
  assert.ok(label && sec.contains(label), 'the field is not labelled by its own heading');
  assert.equal(label.textContent.trim(), dom.run("t('newRound.nameLabel')"));
});

test('leaving the field commits the rename and re-renders the screen', async (t) => {
  const { dom, calls, toasts } = boot(t);
  await dom.call('showRoundSettings', RID);
  const input = field(dom);
  input.focus();
  input.value = '  Samstagsrunde ';
  input.blur();
  const patch = await waitFor(() => patches(calls)[0], { label: 'the rename PATCH' });
  assert.equal(patch.url, `/api/rounds/${RID}`);
  assert.equal(patch.body.name, 'Samstagsrunde', 'the name is sent trimmed');
  // currentView() rebuilt the screen, so the field that was edited is gone.
  await waitFor(() => !input.isConnected, { label: 'the re-render' });
  assert.deepEqual(toasts.map((x) => x.msg), [dom.run("t('round.toast.renamed')")]);
});

test('Enter commits by leaving the field', async (t) => {
  const { dom, calls } = boot(t);
  await dom.call('showRoundSettings', RID);
  const input = field(dom);
  input.focus();
  input.value = 'Sonntagsrunde';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const patch = await waitFor(() => patches(calls)[0], { label: 'the rename PATCH' });
  assert.equal(patch.body.name, 'Sonntagsrunde');
  assert.notEqual(dom.document.activeElement, input, 'Enter must leave the field');
});

test('an unchanged name is not sent', async (t) => {
  const { dom, calls, toasts } = boot(t);
  await dom.call('showRoundSettings', RID);
  field(dom).dispatchEvent(new dom.window.FocusEvent('blur'));
  await flush(); await flush();
  assert.equal(patches(calls).length, 0);
  assert.equal(toasts.length, 0);
});

// Its own test, with nothing in flight before it: an earlier blur still
// awaiting its save would hold the one-save-at-a-time guard and swallow this
// blur for the wrong reason (.claude/rules/redundant-guards-make-each-other-untestable.md).
test('Escape puts the saved name back and sends nothing', async (t) => {
  const { dom, calls, toasts } = boot(t);
  await dom.call('showRoundSettings', RID);
  const input = field(dom);
  input.focus();
  input.value = 'Verworfen';
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await flush(); await flush();
  assert.equal(input.value, 'Freitagsrunde');
  assert.equal(patches(calls).length, 0);
  assert.equal(toasts.length, 0);
});

test('a blank name is refused: no request, a hint, and the saved name back in the field', async (t) => {
  const { dom, calls, toasts } = boot(t);
  await dom.call('showRoundSettings', RID);
  const input = field(dom);
  input.value = '   ';
  input.dispatchEvent(new dom.window.FocusEvent('blur'));
  await waitFor(() => toasts.length, { label: 'the hint' });
  assert.equal(patches(calls).length, 0);
  assert.equal(toasts[0].msg, dom.run("t('round.toast.needName')"));
  assert.equal(input.value, 'Freitagsrunde');
});

test('a failed save says why and restores the saved name', async (t) => {
  const { dom, toasts } = boot(t, { patch: () => { throw new Error('Forbidden'); } });
  await dom.call('showRoundSettings', RID);
  const input = field(dom);
  input.value = 'Samstagsrunde';
  input.dispatchEvent(new dom.window.FocusEvent('blur'));
  await waitFor(() => toasts.length, { label: 'the error toast' });
  assert.deepEqual({ ...toasts[0] }, { msg: 'Forbidden', tone: 'error' });
  assert.equal(input.value, 'Freitagsrunde');
});

test('a second blur while the save is in flight sends nothing more', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { dom, calls } = boot(t, { patch: async (body) => { await gate; return { ...ROUND, name: body.name }; } });
  await dom.call('showRoundSettings', RID);
  const input = field(dom);
  input.value = 'Samstagsrunde';
  input.dispatchEvent(new dom.window.FocusEvent('blur'));
  await waitFor(() => patches(calls).length, { label: 'the first PATCH' });
  input.dispatchEvent(new dom.window.FocusEvent('blur'));
  await flush();
  release();
  await flush(); await flush();
  assert.equal(patches(calls).length, 1);
});

test('a grantee who may not rename gets no name field, and the markers lead again', async (t) => {
  const { dom } = boot(t, { round: { ...ROUND, shared: true, role: 'editor' } });
  await dom.call('showRoundSettings', RID);
  assert.equal(dom.app.querySelector('.rs-ph__sec--name'), null);
  const main = dom.app.querySelector('.rs-ph > .rs-ph__col:not(.rs-ph__col--act)');
  assert.ok(main.firstElementChild.classList.contains('rs-ph__sec--marker'));
});

test('Klassisch\'s settings carry no name field', async (t) => {
  const { dom } = boot(t, { design: 'klassisch' });
  await dom.call('showRoundSettings', RID);
  assert.equal(dom.app.querySelector('.rs-ph__sec--name, .rs-ph__name'), null);
});

test('the rail\'s round-name heading still renames through the same commit', async (t) => {
  const { dom, calls, toasts } = boot(t, { design: 'klassisch' });
  await dom.call('showRoundSettings', RID);
  const heading = dom.app.querySelector('.rail .gd-title');
  assert.ok(heading, 'no editable round name in the rail');
  heading.click();
  const input = dom.app.querySelector('.rail .rn-title-input');
  assert.ok(input, 'clicking the heading opened no editor');
  input.value = '';
  input.dispatchEvent(new dom.window.FocusEvent('blur'));
  await waitFor(() => toasts.length, { label: 'the blank hint' });
  assert.equal(patches(calls).length, 0, 'a blank name was sent');
  assert.ok(dom.app.querySelector('.rail .gd-title'), 'the heading was not restored');

  dom.app.querySelector('.rail .gd-title').click();
  const again = dom.app.querySelector('.rail .rn-title-input');
  again.value = 'Samstagsrunde';
  again.dispatchEvent(new dom.window.FocusEvent('blur'));
  const patch = await waitFor(() => patches(calls)[0], { label: 'the rename PATCH' });
  assert.equal(patch.body.name, 'Samstagsrunde');
});
