'use strict';

/*
 * The top bar's „…" overflow menu (#1460): which buttons fold, in what order,
 * what the menu does with them, and when the fit is redone.
 *
 * Driven through the jsdom harness, never require() — topbar-overflow.js touches
 * `document` throughout. jsdom has no layout, so the widths come in through the
 * two seams the module measures with (`topbarWidth`, `topbarRoom`); the
 * arithmetic itself is test/topbar-fit.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

// Priority order, highest first — the operator's decision in #1460.
const PRIORITY = ['accountBtn', 'inboxBtn', 'supportBtn', 'designBtn', 'feedbackBtn', 'langPicker'];

// A bar of 38px buttons, a 40px home link, no round name, a 10px gap.
function boot(t, { available = 400, loggedIn = true, widths = {} } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const doc = dom.document;
  const room = { available, gap: 10 };
  const w = { homeBtn: 40, moreBtn: 38, loginBtn: 96, ...widths };
  dom.set('topbarRoom', () => room);
  dom.set('topbarWidth', (el) => {
    if (!el) return null;
    if (el.classList.contains('topbar')) return 400;
    if (el.classList.contains('lang-picker__globe')) return 38;
    if (el.id === 'context') return null;
    return el.id in w ? w[el.id] : 38;
  });
  for (const id of ['supportBtn', 'designBtn', 'feedbackBtn']) doc.getElementById(id).hidden = false;
  doc.getElementById('accountBtn').hidden = !loggedIn;
  doc.getElementById('inboxBtn').hidden = !loggedIn;
  doc.getElementById('loginBtn').hidden = loggedIn;
  return { dom, doc, room };
}

const folded = (doc) => [...doc.querySelectorAll('.topbar > [data-folded]')].map((el) => el.id || el.className);
const more = (doc) => doc.getElementById('moreBtn');
const openMenu = (dom) => { dom.call('openMoreMenu', more(dom.document)); return [...dom.document.querySelectorAll('.popover .popover__opt')]; };

test('with room for everything, nothing folds and „…" stays hidden', (t) => {
  const { dom, doc } = boot(t);
  dom.call('fitTopbar');
  assert.deepEqual(folded(doc), []);
  assert.equal(more(doc).hidden, true);
});

test('buttons fold strictly lowest priority first: language, feedback, design, support, inbox, account', (t) => {
  const { dom, doc, room } = boot(t);
  const seen = new Set();
  // 40 home + n×38 + „…" + gaps: walk the room down a pixel at a time. At every
  // width the folded set must be a TAIL of the priority list — the first fold
  // takes two at once, since „…" needs a slot of its own.
  for (let available = 330; available >= 40; available -= 1) {
    room.available = available;
    dom.call('fitTopbar');
    const set = PRIORITY.map((id) => !!doc.getElementById(id).dataset.folded);
    const firstFolded = set.indexOf(true);
    if (firstFolded !== -1) assert.ok(set.slice(firstFolded).every(Boolean), `at ${available}px: ${set}`);
    set.forEach((f, i) => { if (f) seen.add(PRIORITY[i]); });
  }
  assert.equal(seen.size, PRIORITY.length, 'the walk reached every fold');
  assert.equal(more(doc).hidden, false);
});

test('language folds the globe AND the select over it, never one without the other', (t) => {
  const { dom, doc } = boot(t, { available: 300 });
  dom.call('fitTopbar');
  assert.ok(doc.getElementById('langPicker').dataset.folded, 'the select');
  assert.ok(doc.querySelector('.lang-picker__globe').dataset.folded, 'its globe');
});

test('a fold is undone by the next pass once the room is back', (t) => {
  const { dom, doc, room } = boot(t, { available: 200 });
  dom.call('fitTopbar');
  assert.ok(folded(doc).length > 0);
  room.available = 400;
  dom.call('fitTopbar');
  assert.deepEqual(folded(doc), []);
  assert.equal(more(doc).hidden, true);
});

test('a button the app gated off takes no part: neither in the bar nor in the menu', (t) => {
  const { dom, doc } = boot(t, { available: 160 });
  doc.getElementById('supportBtn').hidden = true;
  dom.call('fitTopbar');
  assert.equal(doc.getElementById('supportBtn').dataset.folded, undefined, 'not marked folded');
  const labels = openMenu(dom).map((b) => b.textContent.trim());
  assert.ok(!labels.includes(dom.call('t', 'support.button')), labels.join(' | '));
});

test('logged out, „Anmelden" takes the account slot and is measured at its real width', (t) => {
  // 40 + 96 + 38 + 38 + „…" 38 + 4 gaps = 290: login, design and support stay.
  const { dom, doc } = boot(t, { available: 290, loggedIn: false });
  dom.call('fitTopbar');
  assert.deepEqual(['loginBtn', 'supportBtn', 'designBtn'].map((id) => !!doc.getElementById(id).dataset.folded), [false, false, false]);
  assert.ok(doc.getElementById('feedbackBtn').dataset.folded);
  assert.ok(doc.getElementById('langPicker').dataset.folded);
});

test('the menu lists the folded buttons in priority order, each by its own name', (t) => {
  // Room for account + inbox + „…": support, design, feedback, language fold.
  const { dom, doc } = boot(t, { available: 190 });
  dom.call('fitTopbar');
  const labels = openMenu(dom).map((b) => b.textContent.trim());
  assert.deepEqual(labels, [
    doc.getElementById('supportBtn').getAttribute('aria-label'),
    doc.getElementById('designBtn').getAttribute('aria-label'),
    doc.getElementById('feedbackBtn').getAttribute('aria-label'),
    dom.call('t', 'a11y.language'),
  ]);
  assert.equal(more(doc).getAttribute('aria-expanded'), 'true');
});

test('a menu row does what its bar button does — it clicks it', (t) => {
  const { dom, doc } = boot(t, { available: 190 });
  dom.call('fitTopbar');
  let clicked = 0;
  doc.getElementById('feedbackBtn').addEventListener('click', () => { clicked++; });
  const row = openMenu(dom).find((b) => b.textContent.trim() === doc.getElementById('feedbackBtn').getAttribute('aria-label'));
  row.click();
  assert.equal(clicked, 1);
  assert.equal(doc.querySelector('.popover'), null, 'the menu closed first');
});

test('the language row opens a list of every locale, and a pick switches like the picker', (t) => {
  const { dom, doc } = boot(t, { available: 190 });
  dom.set('showHome', () => {});
  dom.call('setupLangPicker');
  dom.call('fitTopbar');
  openMenu(dom).find((b) => b.textContent.trim() === dom.call('t', 'a11y.language')).click();
  const rows = [...doc.querySelectorAll('.popover .lang-menu .popover__opt')];
  assert.equal(rows.length, dom.get('SUPPORTED_LOCALES').length);
  assert.equal(rows.find((r) => r.getAttribute('aria-pressed') === 'true').getAttribute('lang'), 'de');
  rows.find((r) => r.getAttribute('lang') === 'en').click();
  assert.equal(dom.call('getLocale'), 'en');
  assert.equal(doc.getElementById('langPicker').value, 'en');
});

test('a folded inbox hands its unread dot — and the word — to „…"', (t) => {
  const { dom, doc, room } = boot(t, { available: 60 + 38 + 38 + 20 });
  doc.getElementById('inboxDot').hidden = false;
  dom.call('fitTopbar');
  assert.ok(doc.getElementById('inboxBtn').dataset.folded);
  assert.equal(doc.getElementById('moreDot').hidden, false);
  assert.equal(more(doc).getAttribute('aria-label'), dom.call('t', 'topbar.moreUnread'));
  const inboxRow = openMenu(dom).find((b) => b.textContent.trim() === doc.getElementById('inboxBtn').getAttribute('aria-label'));
  assert.ok(inboxRow.querySelector('.popover__dot'), 'the row carries the mark too');

  // Back in the bar, the inbox shows its own dot and „…" stops claiming one.
  dom.call('closePopover');
  room.available = 400;
  dom.call('fitTopbar');
  assert.equal(doc.getElementById('moreDot').hidden, true);
  assert.equal(more(doc).getAttribute('aria-label'), dom.call('t', 'topbar.more'));
});

test('a folded button that opens a popover of its own hangs it off „…"', (t) => {
  const { dom, doc } = boot(t, { available: 60 });
  dom.call('fitTopbar');
  const design = doc.getElementById('designBtn');
  assert.equal(design.dataset.folded, 'moreBtn');
  more(doc).getBoundingClientRect = () => ({ top: 10, bottom: 50, left: 300, right: 338, width: 38, height: 40 });
  dom.call('openPopover', design, (el) => { el.textContent = 'x'; });
  // Below its anchor: 50 + the 6px gap. Off the folded button's own zero box,
  // it would sit at 6.
  assert.equal(doc.querySelector('.popover').style.top, '56px');
});

test('the fit is redone when the app reveals a button, with no call from the app', async (t) => {
  const { dom, doc } = boot(t, { available: 400 });
  doc.getElementById('supportBtn').hidden = true;
  dom.call('setupTopbarOverflow');
  assert.deepEqual(folded(doc), []);
  // Now too narrow for all six — but nothing changes until the bar does.
  dom.set('topbarRoom', () => ({ available: 250, gap: 10 }));
  doc.getElementById('supportBtn').hidden = false;
  await flush();
  assert.ok(folded(doc).length > 0, 'the observer refitted');
  assert.equal(more(doc).hidden, false);
});

test('„…" toggles its menu, and is named in the active language', (t) => {
  const { dom, doc } = boot(t, { available: 190 });
  dom.call('setupTopbarOverflow');
  assert.equal(more(doc).getAttribute('aria-label'), dom.call('t', 'topbar.more'));
  more(doc).click();
  assert.ok(doc.querySelector('.popover'));
  more(doc).click();
  assert.equal(doc.querySelector('.popover'), null);
  assert.equal(more(doc).getAttribute('aria-expanded'), 'false');
});
