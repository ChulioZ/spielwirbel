'use strict';

/* The result screen's photo block (#1774), rendered through showResults — the
 * real call site — rather than by calling the block's own builder, so a block
 * that exists but is never placed on the screen fails here. Named -view so it
 * cannot collide with test/session-photo.test.js, the route spec
 * (.claude/rules/test-file-names-collide-silently.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { night, badgeRound, stubApi } = require('./support/badge-fixture');

async function results(t, session, { design } = {}) {
  const r = badgeRound([session]);
  const dom = loadApp({ locale: 'de', ...(design ? { design } : {}) });
  t.after(() => dom.close());
  stubApi(dom, r);
  const calls = [];
  const plain = dom.get('api');
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (/\/finish$/.test(url)) return { ...session, finished: true, winnerIds: [] };
    return plain(method, url, body);
  });
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  return { dom, calls, block: () => dom.app.querySelector('.session-photo') };
}

test('a played session without a photo offers „Foto hinzufügen" and the consent hint', async (t) => {
  const { dom, block } = await results(t, night('s1', 1));
  const el = block();
  assert.ok(el, 'the block is on the screen');
  assert.equal(el.hidden, false);
  assert.equal(el.querySelector('img'), null);
  assert.match(el.querySelector('.session-photo__add').textContent, /Foto hinzufügen/);
  assert.equal(el.querySelector('.session-photo__hint').textContent, dom.run("t('result.photo.hint')"));
  assert.equal(el.querySelector('input[type=file]').getAttribute('accept'), 'image/*');
});

test('a session that is not played yet shows nothing — until it is marked played', async (t) => {
  const { dom, block, calls } = await results(t, night('s1', 1, { finished: false, winnerIds: [] }));
  assert.equal(block().hidden, true, 'no add button before the evening is played');

  // The phase changes WITHOUT a re-render of the screen; the block has to
  // follow it through rs.photoRefresh (views-session-result-band.js).
  const mark = [...dom.app.querySelectorAll('button')].find((b) => /Als gespielt markieren/.test(b.textContent));
  assert.ok(mark, 'the screen offers „Als gespielt markieren"');
  mark.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.some((c) => /\/finish$/.test(c.url)), 'the finish was saved');
  assert.equal(block().hidden, false, 'the add button appears once it is played');
});

test('a session with a photo shows it whole, with replace and remove', async (t) => {
  const { dom, block } = await results(t, night('s1', 1, { photo: '/uploads/abc123.webp' }));
  const img = block().querySelector('img.session-photo__img');
  assert.equal(img.getAttribute('src'), '/uploads/abc123.webp');
  assert.equal(img.getAttribute('alt'), dom.run("t('result.photo.alt')"));
  const labels = [...block().querySelectorAll('.session-photo__actions button')].map((b) => b.textContent.trim());
  assert.deepEqual(labels, ['Foto ersetzen', 'Foto entfernen']);
  assert.equal(block().querySelector('.session-photo__add'), null);
});

test('a photo whose evening was reset stays visible and removable', async (t) => {
  const { block } = await results(t, night('s1', 1, { finished: false, winnerIds: [], photo: '/uploads/old.webp' }));
  assert.equal(block().hidden, false);
  assert.ok(block().querySelector('img'));
});

test('the block renders under Der Tisch too', async (t) => {
  const { block } = await results(t, night('s1', 1, { photo: '/uploads/t.webp' }), { design: 'tisch' });
  assert.ok(block() && !block().hidden && block().querySelector('img'));
});

test('a route code maps to the message a person can act on', () => {
  const { sessionPhotoErrorKey } = require('../public/js/session-photo-view');
  assert.equal(sessionPhotoErrorKey('photo_too_large'), 'result.photo.err.tooLargeServer');
  assert.equal(sessionPhotoErrorKey('invalid_image'), 'result.photo.err.invalid');
  assert.equal(sessionPhotoErrorKey('quota_photos'), 'result.photo.err.quota');
  assert.equal(sessionPhotoErrorKey('anything_else'), 'result.photo.err.generic');
});

/* ------------------------------ the Chronik row ----------------------------- */

const { wideAt } = require('./support/badge-fixture');

function chronik(t, sessions, design) {
  const r = badgeRound(sessions);
  r.games[0].image = 'https://cf.geekdo-images.com/catan.jpg';
  const dom = loadApp({ locale: 'de', ...(design ? { design } : {}) });
  t.after(() => dom.close());
  stubApi(dom, r);
  wideAt(dom, false);
  // jsdom has an IntersectionObserver-free window, so the cover loader paints
  // at once — which is what lets this read the slot's background directly.
  dom.run('delete window.IntersectionObserver');
  dom.call('renderChronikTab', r, []);
  const card = (sid) => [...dom.app.querySelectorAll('.session-card')].find((a) => a.getAttribute('href').endsWith(`/${sid}`));
  return { dom, card };
}

for (const design of ['klassisch', 'tisch', 'ocean', 'programmheft', 'forest']) {
  test(`${design}: the evening's photo takes the Chronik thumbnail, the cover stays otherwise`, (t) => {
    const { card } = chronik(t, [night('s1', 1, { photo: '/uploads/abend.webp' }), night('s2', 2)], design);
    const slot = (sid) => card(sid).querySelector('.session-card__img');
    assert.match(slot('s1').style.backgroundImage, /\/uploads\/abend\.webp/);
    assert.match(slot('s2').style.backgroundImage, /catan/, 'a session without a photo keeps the cover');
  });
}

test('bruecke: the log line (no thumbnail) marks a session that has a photo', (t) => {
  const { dom, card } = chronik(t, [night('s1', 1, { photo: '/uploads/b.webp' }), night('s2', 2)], 'bruecke');
  const mark = card('s1').querySelector('.session-card__photo-mark');
  assert.ok(mark);
  assert.equal(mark.getAttribute('aria-label'), dom.run("t('chronik.hasPhoto')"));
  assert.equal(card('s2').querySelector('.session-card__photo-mark'), null);
});
