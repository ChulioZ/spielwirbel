'use strict';

/* Pokale › Abzeichen in Klassisch (#1388, K17; one row per holder since
 * #1856): the section, its empty form, the holder rows, the collection behind
 * each, the tile's accessible name, and the card opened inside it — rendered
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

const rows = (dom) => [...section(dom).querySelectorAll('.badge-member')];
// Open a holder's collection and hand back its body (sheet or popover).
function collection(dom, mid) {
  dom.document.getElementById(`abzeichen-${mid}`).click();
  return dom.document.querySelector('.badge-collection');
}

test('one plaque per member in the standings order; the round\'s row sits on the round\'s plaque (#1857)', async (t) => {
  // Ben wins twice, Anna once: the standings put Ben first.
  const r = badgeRound([night('s1', 1), night('s2', 2, { winnerIds: ['m2'] }), night('s3', 3, { winnerIds: ['m2'] })]);
  const dom = await pokale(t, r);
  assert.deepEqual(rows(dom).map((b) => b.dataset.mid), ['m2', 'm1']);
  assert.equal(section(dom).querySelector('ol.badge-members').children.length, 2, 'an ordered list — standings order is meaning');
  const roundRow = dom.app.querySelector('.pokale-plaque #abzeichen-round');
  assert.ok(roundRow && roundRow.classList.contains('badge-member--round'), "the round's own row is on its plaque");
  assert.equal(section(dom).querySelector('#abzeichen-round'), null, 'and nowhere else');
  for (const row of rows(dom).concat(roundRow)) {
    assert.equal(row.tagName, 'BUTTON', 'the whole row is a button');
    assert.equal(row.type, 'button');
  }
});

test('a row is one line: earned pins only, the counts, a chevron — no legend, no place, no „N offen" (#1856)', async (t) => {
  const r = badgeRound([night('s1', 1), night('s2', 2, { winnerIds: ['m2'] })]);
  const dom = await pokale(t, r, { wide: true });
  const sec = section(dom);
  assert.equal(sec.querySelector('.badge-legend'), null, 'no legend — the rows draw earned marks only');
  assert.equal(sec.querySelector('.badge-member__rank'), null, 'no „Platz N" — the standings say it');
  assert.equal(sec.querySelector('details'), null, 'no disclosure open state at any width');
  assert.equal(sec.querySelectorAll('.badge').length, 0, 'no tiles on the page — they live in the collection');
  const anna = sec.querySelector('#abzeichen-m1');
  const earned = dom.run(`roundBadges(${JSON.stringify(r)}).members.m1.filter((e) => e.state === 'earned').length`);
  assert.ok(earned > 0, 'the fixture earns Anna something');
  assert.equal(anna.querySelectorAll('.badge-member__pin').length, Math.min(earned, dom.run('BADGE_ROW_PINS')));
  assert.ok([...anna.querySelectorAll('.badge-member__pin')].every((p) => p.dataset.state === 'earned'), 'only earned pins');
  assert.equal(anna.querySelector('.badge-member__pins').getAttribute('aria-hidden'), 'true', 'a pin is decorative');
  assert.ok(anna.querySelector('.badge-member__go'), 'a chevron');
  assert.match(anna.getAttribute('aria-label'), new RegExp(`^Anna, 1 Sieg, ${earned} verdient`), 'the name carries the wins and the counts');
});

test('a row draws at most BADGE_ROW_PINS pins and says the rest as „+N"', async (t) => {
  // Sixty nights Anna wins, alternating two games: ten marks of hers earned.
  const many = Array.from({ length: 60 }, (_, i) => night(`s${i + 1}`, (i % 28) + 1, { chosenGameId: i % 2 ? 'g1' : 'g2' }));
  const r = badgeRound(many);
  const dom = await pokale(t, r);
  const row = section(dom).querySelector('#abzeichen-m1');
  const earned = dom.run(`roundBadges(${JSON.stringify(r)}).members.m1.filter((e) => e.state === 'earned').length`);
  const max = dom.run('BADGE_ROW_PINS');
  assert.ok(earned > max, `the fixture must overflow the row (${earned} earned)`);
  assert.equal(row.querySelectorAll('.badge-member__pin').length, max);
  assert.equal(row.querySelector('.badge-member__more[data-cut="6"]').textContent, `+${earned - max}`);
  // A phone shows three pins (styles.css), so it shows the count beyond THREE.
  const narrow = dom.run('BADGE_ROW_PINS_NARROW');
  assert.equal(row.querySelector(`.badge-member__more[data-cut="${narrow}"]`).textContent, `+${earned - narrow}`);
  // And a very narrow row two (#1857) — its own count beyond TWO.
  const tiny = dom.run('BADGE_ROW_PINS_TINY');
  assert.equal(row.querySelector(`.badge-member__more[data-cut="${tiny}"]`).textContent, `+${earned - tiny}`);
});

test('a NARROW ROW hides exactly the pins its „+N" counts — at any viewport (#1857)', () => {
  /* Keyed to the row's own width, not the viewport: since #1857 a row is
     narrow in a 372px tile at 1470 and in the round's 340px plaque column, and
     a viewport query left six pins there that covered the name and the wins. */
  const { atBlocks, mediaBlocks, rulesOf, CSS } = require('./support/css');
  const narrow = atBlocks(CSS, 'container').filter(([q]) => /^badge-row\s*\(max-width:\s*\d+px\)/.test(q)).flatMap(([, css]) => rulesOf(css));
  const hides = narrow.filter(([, b]) => /display:\s*none/.test(b)).flatMap(([sel]) => sel.split(',').map((x) => x.trim()));
  const nth = hides.map((x) => /\.badge-member__pin:nth-child\(n\+(\d+)\)/.exec(x)).find(Boolean);
  assert.ok(nth, 'a narrow row no longer narrows its pins');
  assert.equal(Number(nth[1]) - 1, 3, 'the pins left in a narrow row');
  assert.ok(hides.includes('.badge-member__more[data-cut="6"]'), 'the wide count still shows in a narrow row');
  assert.ok(narrow.some(([sel, b]) => sel.trim() === '.badge-member__more[data-cut="3"]' && /display:\s*inline/.test(b)), 'the narrow count never shows');
  // The row is that container, and no viewport query cuts the pins any more.
  assert.ok(rulesOf(CSS).some(([sel, b]) => sel.trim() === '.badge-member' && /container:\s*badge-row\s*\/\s*inline-size/.test(b)), 'the row is not the container');
  const byViewport = mediaBlocks().flatMap(([, css]) => rulesOf(css)).filter(([sel]) => /\.badge-member__pin:nth-child/.test(sel));
  assert.deepEqual(byViewport.map(([sel]) => sel.trim()), [], 'a viewport query still cuts the pins');
});

test('a VERY narrow row keeps two pins and the count beyond two (#1857)', () => {
  /* Measured: a 304px row content box (a 360px phone) under Der Tisch left the name and
     wins 57px beside three pins, and „7 unterwegs" ran under them. The tighter
     block must come AFTER the 480px one — both match there, and source order
     decides which „+N" shows. */
  const { atBlocks, rulesOf, CSS } = require('./support/css');
  const blocks = atBlocks(CSS, 'container').filter(([q]) => /^badge-row\s*\(max-width:/.test(q));
  const width = ([q]) => Number(/max-width:\s*(\d+)px/.exec(q)[1]);
  assert.equal(blocks.length, 2, 'two narrow cuts');
  assert.ok(width(blocks[1]) < width(blocks[0]), 'the tighter cut must come last, or the wider one wins');
  const rules = rulesOf(blocks[1][1]);
  const hides = rules.filter(([, b]) => /display:\s*none/.test(b)).flatMap(([sel]) => sel.split(',').map((x) => x.trim()));
  assert.ok(hides.includes('.badge-member__pin:nth-child(n+3)'), 'two pins left');
  assert.ok(hides.includes('.badge-member__more[data-cut="3"]'), 'the count beyond three still shows');
  assert.ok(rules.some(([sel, b]) => sel.trim() === '.badge-member__more[data-cut="2"]' && /display:\s*inline/.test(b)), 'the count beyond two never shows');
  // Everywhere else the count beyond two is hidden.
  assert.ok(rulesOf(CSS).some(([sel, b]) => sel.split(',').map((x) => x.trim()).includes('.badge-member__more[data-cut="2"]') && /display:\s*none/.test(b)));
});

test('every tile in a collection is a button naming its state in words, in the sheets’ shape', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  const round = collection(dom, 'round');
  const tiles = [...round.querySelectorAll('.badge')];
  assert.ok(tiles.length > 10, 'the round collection rendered');
  for (const b of tiles) {
    assert.equal(b.tagName, 'BUTTON', 'a mark is reachable and operable by keyboard');
    assert.match(b.dataset.state, /^(earned|progress|locked|secret)$/);
    const word = dom.run(`t('badges.state.${b.dataset.state}')`).toLowerCase();
    assert.ok(b.getAttribute('aria-label').includes(`, ${word}`), `${b.dataset.key}: ${b.getAttribute('aria-label')}`);
  }
  const founded = tileOf(round, 'founded');
  assert.equal(founded.getAttribute('aria-label'), 'Gegründet, verdient, neu. Verdient im Juli 2026 · Catan');
  assert.ok(founded.hasAttribute('data-new'));
  const secret = round.querySelector('.badge[data-state="secret"]');
  assert.equal(secret.querySelector('.badge__name').textContent, dom.run("t('badges.state.secret')"), 'a secret keeps its name until earned');
  assert.ok(secret.querySelector('.ti-lock-question'), 'and shows the padlock, not its own glyph');
});

test('a member’s in-progress tile carries its ring and its count', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  const regular = tileOf(collection(dom, 'm1'), 'regular');
  assert.equal(regular.getAttribute('aria-label'), 'Stammgast, unterwegs. 1 / 10 · Bei 10 Sessions dabei');
  assert.equal(regular.querySelector('.badge__mark').style.getPropertyValue('--pct'), '10', 'the ring length is the share done');
});

test('a reached tier is said once, in the name — no corner pill (operator decision 2026-09-26)', async (t) => {
  const ten = Array.from({ length: 10 }, (_, i) => night(`s${i + 1}`, i + 1));
  const dom = await pokale(t, badgeRound(ten));
  const round = collection(dom, 'round');
  const sessions = tileOf(round, 'sessions');
  assert.equal(sessions.dataset.state, 'earned', 'ten finished sessions reach the first tier');
  assert.match(sessions.querySelector('.badge__name').textContent, / 10$/);
  assert.equal(round.querySelectorAll('.badge__tier').length, 0);
});

/* The collection's three groups (#1856, after #1541): Verdient and Unterwegs
   as full tiles, Offen as a strip of bare marks. The condition leaves the
   locked tile (it lives in the card), but never the accessible name. */
function assertGroups(host, label) {
  const group = (st) => host.querySelector(`.badge-collection__group[data-state="${st}"]`);
  const states = [...host.querySelectorAll('.badge-collection__group')].map((g) => g.dataset.state);
  assert.deepEqual(states, ['earned', 'progress', 'locked'], `${label}: Verdient, Unterwegs, Offen`);
  assert.ok([...group('earned').querySelectorAll('.badge')].every((b) => b.dataset.state === 'earned'), `${label}: earned group`);
  assert.ok([...group('progress').querySelectorAll('.badge')].every((b) => b.dataset.state === 'progress'), `${label}: progress group`);
  const strip = group('locked').querySelector('.badge-grid--strip');
  assert.ok(strip, `${label}: Offen is the strip`);
  assert.equal(strip.classList.contains('badge-grid--compact'), false,
    `${label}: the strip is not the Tischkarte's compact row, whose design skins print the name`);
  const closed = [...strip.querySelectorAll('.badge')];
  assert.ok(closed.length && closed.every((b) => /^(locked|secret)$/.test(b.dataset.state)), `${label}: locked and secret, secrets included`);
  for (const b of closed) {
    assert.equal(b.querySelector('.badge__line'), null, `${label}: ${b.dataset.key} carries no condition line on the tile`);
    assert.ok(b.getAttribute('aria-label').length > b.dataset.key.length, `${label}: ${b.dataset.key} keeps its accessible name`);
  }
  assert.match(group('earned').querySelector('.badge-collection__title').textContent, /^Verdient · \d+$/);
}

test('a collection groups the marks into Verdient, Unterwegs and Offen, in catalogue order (#1856)', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1), night('s2', 2, { winnerIds: ['m2'] })]));
  const round = collection(dom, 'round');
  assertGroups(round, 'round');
  const catalogue = Array.from(dom.run("BADGE_CATALOGUE.filter((d) => d.holder === 'round').map((d) => d.key)"));
  const k = [...round.querySelectorAll('.badge-grid--strip .badge')].map((b) => b.dataset.key);
  assert.deepEqual(k, catalogue.filter((c) => k.includes(c)), 'stable catalogue order inside the strip');
  dom.run('closeSheet()');
  await waitFor(() => !dom.document.querySelector('.sheet-backdrop'));
  assertGroups(collection(dom, 'm1'), 'm1');
});

test('a tile opens its card INLINE, and Back to the collection returns focus to the tile (#1856)', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  const host = collection(dom, 'round');
  const locked = host.querySelector('.badge-grid--strip .badge[data-state="locked"]');
  const key = locked.dataset.key;
  locked.click();
  assert.equal(dom.document.querySelectorAll('.sheet-backdrop').length, 1, 'still ONE overlay — the collection was not replaced');
  const card = host.querySelector('.badge-card');
  assert.ok(card, 'the card opens inside the collection');
  assert.ok(card.querySelector('.badge-card__cond').textContent.length > 0, 'and states the condition');
  assert.equal(dom.document.activeElement, card.querySelector('.badge-card__name'), 'focus moves to the card’s name');
  host.querySelector('.badge-collection__back').click();
  assert.equal(host.querySelector('.badge-card'), null, 'back shows the collection again');
  assert.equal(dom.document.activeElement.dataset.key, key, 'focus returns to the tile it came from');
});

test('below 860px the collection is a sheet: focus lands in it, Escape closes it and returns focus to the row', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  const row = dom.document.getElementById('abzeichen-round');
  row.focus();
  row.click();
  const sheet = dom.document.querySelector('.sheet-backdrop');
  assert.ok(sheet, 'a sheet on a phone');
  assert.equal(dom.document.querySelector('.popover'), null);
  assert.equal(sheet.querySelector('.sheet').getAttribute('aria-label'), 'Abzeichen von Kartographen');
  assert.ok(sheet.contains(dom.document.activeElement), 'focus moves into the collection');
  tileOf(sheet, 'founded').click();
  const card = sheet.querySelector('.badge-card');
  assert.equal(card.querySelector('.badge-card__name').textContent, 'Gegründet');
  assert.equal(card.querySelector('.badge-card__holder').textContent, 'Kartographen');
  assert.equal(card.querySelector('.badge-card__earned').textContent, 'Verdient im Juli 2026 · Catan');

  dom.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => !dom.document.querySelector('.sheet-backdrop'), { label: 'Escape closes the sheet' });
  await waitFor(() => dom.document.activeElement === row, { label: 'focus returns to the row' });
});

test('below 860px Back closes the collection', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]));
  collection(dom, 'm1');
  assert.ok(dom.document.querySelector('.sheet-backdrop .badge-collection'));
  dom.window.history.back();
  await waitFor(() => !dom.document.querySelector('.sheet-backdrop'), { label: 'Back closes the sheet' });
});

test('from 860px the collection is an anchored popover, named as a dialog, and Escape returns focus', async (t) => {
  const dom = await pokale(t, badgeRound([night('s1', 1)]), { wide: true });
  const row = dom.document.getElementById('abzeichen-m1');
  row.focus();
  row.click();
  const pop = dom.document.querySelector('.popover.popover--badges');
  assert.ok(pop, 'a popover on a desktop');
  assert.equal(dom.document.querySelector('.sheet-backdrop'), null);
  assert.equal(pop.getAttribute('role'), 'dialog');
  assert.equal(pop.getAttribute('aria-label'), 'Abzeichen von Anna');
  tileOf(pop, 'regular').click();
  // Every tier, the reached ones marked by a glyph and a word — not by colour.
  const tiers = [...pop.querySelectorAll('.badge-card__tier')];
  assert.deepEqual(tiers.map((li) => li.textContent.replace(/,.*$/, '').trim()), ['10', '25', '50', '100', '250']);
  assert.equal(pop.querySelectorAll('[data-reached]').length, 0, 'one session reaches no tier of ten');
  assert.match(pop.querySelector('.badge-card__next').textContent, /1 \/ 10/);

  dom.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => !dom.document.querySelector('.popover'), { label: 'Escape closes the popover' });
  assert.equal(dom.document.activeElement, row, 'focus returns to the row that opened it');
});

test('showBadges lands on the holder’s row with the collection open; without a holder, on the section', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  wideAt(dom, false);
  await dom.call('showBadges', RID, 'm2');
  await waitFor(() => dom.document.getElementById('abzeichen-m2'), { label: 'the Pokale tab rendered' });
  const sheet = await waitFor(() => dom.document.querySelector('.sheet-backdrop .badge-collection'), { label: 'Ben’s collection opened' });
  assert.equal(sheet.closest('.sheet').getAttribute('aria-label'), 'Abzeichen von Ben');
  dom.run('closeSheet()');
  await waitFor(() => !dom.document.querySelector('.sheet-backdrop'));
  await waitFor(() => dom.document.activeElement === dom.document.getElementById('abzeichen-m2'), { label: 'focus is on the row' });

  // The target is consumed: a later visit opens nothing.
  await dom.call('showRound', RID, 'pokale');
  await waitFor(() => dom.document.getElementById('abzeichen-m2'));
  assert.equal(dom.document.querySelector('.sheet-backdrop'), null);

  // No holder („+N weitere"): the section, focused, no collection.
  await dom.call('showBadges', RID, null);
  await waitFor(() => dom.document.activeElement === dom.document.getElementById('abzeichen'), { label: 'the section is focused' });
  assert.equal(dom.document.querySelector('.sheet-backdrop'), null);
});

/* A long German name in a narrow tile (Der Tisch at 390px: four tiles a row)
   used to split mid-word — „Gründungsm / itglied", „Dauerbrenne / r" — because
   `overflow-wrap: anywhere` breaks wherever it must. `hyphens: auto` makes it
   break at a syllable with a hyphen instead („Gründungs- / mitglied"), checked in
   real Chrome; the Browser pane has no hyphenation dictionaries and cannot show
   it (.claude/skills/browser-verification/browser-pane-has-no-hyphenation.md). `<html lang>` follows
   the locale (i18n.js), which hyphenation needs. */
test('a badge name hyphenates rather than splitting a word anywhere (#1464)', () => {
  const { rulesOf, topLevel } = require('./support/css');
  const rule = rulesOf(topLevel()).find(([sel]) => sel.trim() === '.badge__name');
  assert.ok(rule, 'the base .badge__name rule exists');
  assert.match(rule[1], /hyphens:\s*auto/);
});
