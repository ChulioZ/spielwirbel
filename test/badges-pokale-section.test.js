'use strict';

/* Pokale › Abzeichen in Klassisch (#1388, K17): the section, its dense and
 * empty forms, the tile's accessible name, and the tap-open card — rendered
 * under jsdom and clicked, never matched out of the source
 * (.claude/rules/testing-views-under-jsdom.md). What each mark IS comes from
 * achievements.js and is test/achievements.test.js's business; this file is
 * about how the view presents it. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor } = require('./support/dom');
const { RID, night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');

async function pokale(t, round, { wide = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, round);
  wideAt(dom, wide);
  await dom.call('renderPokaleTab', round);
  return dom;
}

const section = (dom) => dom.app.querySelector('.badge-section');
const tileOf = (root, key) => root.querySelector(`.badge[data-key="${key}"]`);

test('a round with no finished session gets one line and no tiles — and no hub line', async (t) => {
  const r = badgeRound([night('s1', 1, { finished: false, done: false, winnerIds: [] })]);
  const dom = await pokale(t, r);
  const sec = section(dom);
  assert.ok(sec, 'the section is there, so the round knows the feature exists');
  assert.equal(sec.querySelectorAll('.badge').length, 0, 'no wall of grey padlocks before the first session');
  assert.equal(sec.querySelector('.badge-section__empty').textContent, dom.run("t('badges.empty')"));
  assert.equal(dom.call('hubBadgeLine', r), null, 'the hub line is absent before the first finished session');
});

test('the round band comes first, then one row per member in the standings order', async (t) => {
  // Ben wins twice, Anna once: the standings put Ben first.
  const r = badgeRound([night('s1', 1), night('s2', 2, { winnerIds: ['m2'] }), night('s3', 3, { winnerIds: ['m2'] })]);
  const dom = await pokale(t, r);
  const sec = section(dom);
  const first = sec.querySelector('.badge-band--round, .badge-member');
  assert.ok(first.classList.contains('badge-band--round'), 'the round band leads');
  assert.deepEqual([...sec.querySelectorAll('.badge-member')].map((d) => d.dataset.mid), ['m2', 'm1']);
  assert.equal(sec.querySelector('.badge-member').tagName, 'DETAILS', 'a member row is a disclosure on the phone');
  assert.equal(sec.querySelector('.badge-member').open, true, 'the first row starts open on a phone');
  assert.equal(sec.querySelectorAll('.badge-member')[1].open, false, 'the rest start closed on a phone');
});

test('above 860px every member row starts open', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]), { wide: true });
  assert.ok([...section(dom).querySelectorAll('.badge-member')].every((d) => d.open));
});

test('every tile is a button naming its state in words, in the sheets’ shape', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  const sec = section(dom);
  const tiles = [...sec.querySelectorAll('.badge')];
  assert.ok(tiles.length > 20, 'the round band and both member rows rendered');
  for (const b of tiles) {
    assert.equal(b.tagName, 'BUTTON', 'a mark is reachable and operable by keyboard');
    assert.equal(b.type, 'button');
    assert.match(b.dataset.state, /^(earned|progress|locked|secret)$/);
    // State is never colour alone: the accessible name carries it as a word.
    const word = dom.run(`t('badges.state.${b.dataset.state}')`).toLowerCase();
    assert.ok(b.getAttribute('aria-label').includes(`, ${word}`), `${b.dataset.key}: ${b.getAttribute('aria-label')}`);
  }
  const founded = tileOf(sec.querySelector('.badge-band--round'), 'founded');
  assert.equal(founded.getAttribute('aria-label'), 'Gegründet, verdient, neu. Verdient im Juli 2026 · Catan');
  assert.ok(founded.hasAttribute('data-new'));
  const regular = tileOf(sec.querySelector('#abzeichen-m1'), 'regular');
  assert.equal(regular.getAttribute('aria-label'), 'Stammgast, unterwegs. 1 / 10 · Bei 10 Sessions dabei');
  assert.equal(regular.querySelector('.badge__mark').style.getPropertyValue('--pct'), '10', 'the ring length is the share done');
  const secret = sec.querySelector('.badge[data-state="secret"]');
  assert.equal(secret.querySelector('.badge__name').textContent, dom.run("t('badges.state.secret')"), 'a secret keeps its name until earned');
  assert.ok(secret.querySelector('.ti-lock-question'), 'and shows the padlock, not its own glyph');
});

test('from seven members a row shows only its earned marks, the rest behind „N offen"', async (t) => {
  const seven = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
  const dom = await pokale(t, badgeRound([night('s1', 1, { memberIds: seven })], 7));
  const row = section(dom).querySelector('#abzeichen-m1');
  const shown = [...row.querySelectorAll(':scope > .badge-grid:not(.badge-grid--rest) .badge')];
  assert.deepEqual(shown.map((b) => b.dataset.state), ['earned'], 'Anna’s one win, and nothing else in the row');
  const more = row.querySelector('.badge-member__more');
  const rest = row.querySelector('.badge-grid--rest');
  assert.equal(more.textContent, `${rest.querySelectorAll('.badge').length} offen`);
  assert.equal(rest.hidden, true);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  more.click();
  assert.equal(rest.hidden, false, 'the toggle reveals the rest');
  assert.equal(more.getAttribute('aria-expanded'), 'true');

  // Six members is not dense: every tile in the row.
  const six = await pokale(t, badgeRound([night('s1', 1, { memberIds: seven.slice(0, 6) })], 6));
  assert.equal(section(six).querySelector('.badge-member__more'), null);
});

test('below 860px the card is a sheet: focus lands in it, Escape closes it and returns focus', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  const tile = tileOf(section(dom), 'founded');
  tile.focus();
  tile.click();
  const sheet = dom.document.querySelector('.sheet-backdrop');
  assert.ok(sheet, 'a sheet on a phone');
  assert.equal(dom.document.querySelector('.popover'), null);
  const card = sheet.querySelector('.badge-card');
  assert.ok(card, 'the card is inside the sheet');
  assert.equal(card.querySelector('.badge-card__name').textContent, 'Gegründet');
  assert.equal(card.querySelector('.badge-card__holder').textContent, 'Kartographen');
  assert.equal(card.querySelector('.badge-card__earned').textContent, 'Verdient im Juli 2026 · Catan');
  assert.equal(dom.document.activeElement, card.querySelector('.badge-card__name'), 'focus moves to the card’s name');

  dom.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => !dom.document.querySelector('.sheet-backdrop'), { label: 'Escape closes the sheet' });
  await waitFor(() => dom.document.activeElement === tile, { label: 'focus returns to the tile' });
});

test('below 860px Back closes the card', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  tileOf(section(dom), 'founded').click();
  assert.ok(dom.document.querySelector('.sheet-backdrop .badge-card'));
  dom.window.history.back();
  await waitFor(() => !dom.document.querySelector('.sheet-backdrop'), { label: 'Back closes the sheet' });
});

test('from 860px the card is an anchored popover, named as a dialog, and Escape returns focus', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]), { wide: true });
  const tile = tileOf(section(dom).querySelector('#abzeichen-m1'), 'regular');
  tile.focus();
  tile.click();
  const pop = dom.document.querySelector('.popover.popover--badge');
  assert.ok(pop, 'a popover on a desktop');
  assert.equal(dom.document.querySelector('.sheet-backdrop'), null);
  assert.equal(pop.getAttribute('role'), 'dialog');
  const name = pop.querySelector('.badge-card__name');
  assert.equal(pop.getAttribute('aria-labelledby'), name.id);
  assert.equal(dom.document.activeElement, name);
  // Every tier, the reached ones marked by a glyph and a word — not by colour.
  const tiers = [...pop.querySelectorAll('.badge-card__tier')];
  assert.deepEqual(tiers.map((li) => li.textContent.replace(/,.*$/, '').trim()), ['10', '25', '50', '100']);
  assert.equal(pop.querySelectorAll('[data-reached]').length, 0, 'one session reaches no tier of ten');
  assert.match(pop.querySelector('.badge-card__next').textContent, /1 \/ 10/);

  dom.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => !dom.document.querySelector('.popover'), { label: 'Escape closes the popover' });
  assert.equal(dom.document.activeElement, tile, 'focus returns to the tile that opened it');
});

test('showBadges lands on the member’s row, opened and focused', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  wideAt(dom, false);
  await dom.call('showBadges', RID, 'm2');
  const row = await waitFor(() => dom.document.getElementById('abzeichen-m2'), { label: 'the Pokale tab rendered' });
  assert.equal(row.open, true, 'Ben’s row is opened although it is not the first');
  assert.equal(dom.document.activeElement, row.querySelector('summary'));

  // The target is consumed: a later visit lands nowhere in particular.
  dom.document.body.focus();
  await dom.call('showRound', RID, 'pokale');
  await waitFor(() => dom.document.getElementById('abzeichen-m2'));
  assert.equal(dom.document.getElementById('abzeichen-m2').open, false);
});
