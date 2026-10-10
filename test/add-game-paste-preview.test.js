'use strict';

/* The add-game form's pasted-cover preview (#1612).

   The preview used to be a `blob:` URL, which the CSP's img-src (lib/app.js)
   does not allow — so the browser refused it and the paste zone stayed empty
   while the upload itself worked. The preview is now a `data:` URL, which
   img-src already permits; the policy stays as narrow as it is.

   FileReader is async, so a read still in flight must lose to whatever the
   user did after it: clearing the image, pasting another, or picking an
   edition cover. Driven under jsdom (.claude/rules/testing-views-under-jsdom.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush, waitFor } = require('./support/dom');

const ROUND = {
  id: 1, name: 'Donnerstagsrunde', games: [], tags: [],
  members: [{ id: 'm1', name: 'Lea', userId: 'u1' }], sessions: [], activity: [],
};

function boot(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // jsdom has no object URLs. Stubbed to what a browser returns, so the old
  // blob-URL preview fails on the assertion that matters (the scheme) rather
  // than on a missing function.
  dom.window.URL.createObjectURL = () => 'blob:http://localhost/stub';
  dom.window.URL.revokeObjectURL = () => {};
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (method === 'POST' && url.endsWith('/games')) return { id: 99, title: body.get('title') };
    return {};
  });
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('currentUserId', () => 'u1');
  const navigations = [];
  dom.set('showRound', (rid, tab) => navigations.push([rid, tab]));
  return { dom, calls, navigations, toasts };
}

const png = (dom, bytes = [137, 80, 78, 71]) =>
  new dom.window.File([new Uint8Array(bytes)], 'clip.png', { type: 'image/png' });

/** Dispatch a ⌘V carrying one image file, the shape onPaste reads. */
function paste(dom, file) {
  const e = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  e.clipboardData = { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] };
  dom.document.dispatchEvent(e);
}

const previewOf = (dom) => dom.document.querySelector('.paste-zone__preview');

/** A FileReader whose reads finish only when the spec says so, in any order.
   jsdom's real one completes reads in the order they started, so an older read
   landing AFTER a newer change — the race the sequence guard exists for — never
   happens with it, and a spec of that race passes with the guard deleted. */
function deferredReads(dom) {
  const pending = [];
  dom.set('FileReader', class {
    readAsDataURL(blob) { this.blob = blob; pending.push(this); }
  });
  const land = (reader, result) => { reader.result = result; reader.onload(); };
  return { pending, land };
}

async function openForm(t, setup = () => {}) {
  const env = boot(t);
  setup(env);
  await env.dom.call('showAddGame', ROUND);
  assert.ok(previewOf(env.dom), 'the add-game form did not render its paste zone');
  return env;
}

test('a pasted image previews as a data: URL, which the CSP allows', async (t) => {
  const { dom } = await openForm(t);
  paste(dom, png(dom));
  const preview = previewOf(dom);
  await waitFor(() => (preview.getAttribute('src') || '').startsWith('data:'),
    { label: 'the preview showing the pasted image as a data: URL' });
  assert.ok(preview.getAttribute('src').startsWith('data:image/png;base64,'));
  assert.equal(preview.hidden, false);
  assert.ok(dom.document.getElementById('pasteZone').classList.contains('has-image'));
  assert.equal(dom.document.getElementById('clearImg').hidden, false);
});

test('„Bild entfernen" while the read is in flight leaves the preview empty', async (t) => {
  const { dom } = await openForm(t);
  paste(dom, png(dom));
  dom.document.getElementById('clearImg').click();
  for (let i = 0; i < 6; i++) await new Promise((r) => dom.window.setTimeout(r, 0));
  await flush();
  const preview = previewOf(dom);
  assert.equal(preview.getAttribute('src'), null, 'a stale read repainted a cleared preview');
  assert.equal(preview.hidden, true);
  assert.equal(dom.document.getElementById('pasteZone').classList.contains('has-image'), false);
});

test('a second paste wins even when the first paste\'s read lands after it', async (t) => {
  let reads;
  const { dom } = await openForm(t, ({ dom: d }) => { reads = deferredReads(d); });
  paste(dom, png(dom));
  paste(dom, png(dom));
  assert.equal(reads.pending.length, 2, 'each paste starts its own read');
  const [first, second] = reads.pending;
  reads.land(second, 'data:image/png;base64,U0VDT05E');
  reads.land(first, 'data:image/png;base64,RklSU1Q=');
  assert.equal(previewOf(dom).getAttribute('src'), 'data:image/png;base64,U0VDT05E',
    'the first paste\'s late read overwrote the second paste');
});

test('an edition cover picked while a paste is still being read stays shown', async (t) => {
  let reads;
  let onPick = null;
  const { dom } = await openForm(t, ({ dom: d }) => {
    reads = deferredReads(d);
    // The picker itself is cover-picker.js's business; here only its callback
    // matters, which is the form's showProviderImage path.
    d.set('editionCoverPicker', (rid, externalId, current, cb) => {
      onPick = cb;
      const el = d.document.createElement('div');
      el.setCurrent = () => {};
      return el;
    });
    d.set('api', async (method, url) =>
      (url.includes('/lookup/game') ? { title: 'Nordlicht', url: 'https://boardgamegeek.com/boardgame/303' } : {}));
  });
  // Re-open the form on a picked BGG hit — the path a lookup or Tisch-search
  // pick takes, and the one that mounts the edition picker.
  await dom.call('showAddGameForm', ROUND, { hit: { provider: 'bgg', providerId: '303', title: 'Nordlicht', thumbnail: null } });
  await waitFor(() => onPick, { label: 'the edition picker mounted for the BGG pick' });

  paste(dom, png(dom));
  const url = 'https://cf.geekdo-images.com/edition.jpg';
  onPick({ imageUrl: url });
  reads.land(reads.pending[0], 'data:image/png;base64,TEFURQ==');
  assert.equal(previewOf(dom).getAttribute('src'), url, 'the paste\'s late read replaced the picked edition');
});

test('saving still uploads the pasted file itself', async (t) => {
  const { dom, calls, navigations } = await openForm(t);
  dom.document.getElementById('title').value = 'Nordlichter';
  const file = png(dom);
  paste(dom, file);
  dom.document.getElementById('save').click();
  await waitFor(() => navigations.length, { label: 'the saved form closing back to the Regal' });
  const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/games'));
  assert.ok(post, 'no game was posted');
  const image = post.body.get('image');
  assert.ok(image, 'the pasted image was not uploaded');
  assert.equal(image.size, file.size);
  assert.equal(post.body.get('imageUrl'), null, 'a pasted cover must not send a provider URL');
});
