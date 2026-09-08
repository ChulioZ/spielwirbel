'use strict';

/* An open popover editor must not outlive the screen it was opened on (2026-09-08
 * audit, A-013). openPopover() closes on mousedown-outside, Escape, scroll and
 * resize — and a keyboard-activated link (Enter fires `click` with no mousedown)
 * or the browser's Back button produces none of those, so the editor floated
 * over the NEXT screen with `activePopover` still set, which kept uiBusy() true
 * until the next mousedown. Every view calls syncUrl() first, so that is the
 * one seam both paths cross. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

function openOne(dom) {
  const doc = dom.document;
  const anchor = doc.createElement('button');
  doc.body.appendChild(anchor);
  anchor.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 100, right: 300, width: 200, height: 40 });
  dom.context.__anchor = anchor;
  dom.context.__build = (el) => { el.textContent = 'editor'; };
  dom.run('openPopover(__anchor, __build)');
  return doc.querySelector('.popover');
}

test('a view syncing its URL closes the popover left open on the previous screen', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const card = openOne(dom);
  assert.ok(card, 'the popover opened');
  assert.equal(dom.run('!!activePopover'), true);

  dom.run("syncUrl('/round/r1/regal')");

  assert.equal(dom.document.querySelector('.popover'), null, 'the popover is gone');
  assert.equal(dom.run('!!activePopover'), false, 'and nothing believes an overlay is still up');
  assert.equal(dom.run('uiBusy()'), false, 'so a background re-render is no longer suppressed');
});

test('syncUrl with no popover open is a no-op for the overlay state', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run("syncUrl('/round/r1/regal')");
  assert.equal(dom.run('!!activePopover'), false);
});
