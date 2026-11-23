'use strict';

/* Pokale as the round's Ehrentafel (#1857): the „Neu seit" band's derivation
   (marks, a record, the challenge step, nothing new), the round's plaque, and
   every person exactly once — in every design — with a place only where the
   stage ranks people. Rendered under jsdom and asserted on the DOM
   (.claude/rules/testing-views-under-jsdom.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');

const DESIGNS = ['klassisch', 'tisch', 'ocean', 'bruecke', 'programmheft', 'forest'];
const DAY = 24 * 60 * 60 * 1000;

function boot(t, round, design = 'klassisch') {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, round);
  wideAt(dom, false);
  if (design !== 'klassisch') dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.context.__round = round;
  return dom;
}
// Copied into this realm: an array the vm context built fails deepStrictEqual
// on its prototype alone (.claude/rules/testing-views-under-jsdom.md).
const news = (dom) => {
  const n = dom.run('pokaleNewsItems(__round)');
  return { ...n, items: [...n.items].map((x) => ({ ...x })) };
};
const kinds = (dom) => news(dom).items.map((x) => (x.kind === 'record' ? `record:${x.record}` : x.kind));
const band = (dom) => dom.app.querySelector('.pokale-news');

// Eight nights on Catan, the wins alternating, then a ninth on Catan with no
// winner: it crosses no threshold, takes no record and moves no challenge.
function quiet(last = {}) {
  const ns = [];
  for (let i = 1; i <= 8; i++) ns.push(night(`s${i}`, i, { winnerIds: [i % 2 ? 'm1' : 'm2'] }));
  ns.push(night('s9', 12, { winnerIds: [], ...last }));
  return ns;
}

// --- the band ----------------------------------------------------------------

test('a session that changed nothing gets no band', async (t) => {
  const r = badgeRound(quiet());
  const dom = boot(t, r);
  assert.deepEqual(kinds(dom), [], 'the fixture is quiet');
  await dom.call('renderPokaleTab', r);
  assert.equal(band(dom), null, 'a band with nothing in it');
  assert.ok(dom.app.querySelector('.pokale-plaque'), 'anti-vacuous: the page rendered');
});

test('the marks the latest session earned: one item per mark, as many as Start promises', async (t) => {
  // The very first session: Anna's first win, the round founded, and so on.
  const r = badgeRound([night('s1', 1)]);
  const dom = boot(t, r);
  const marks = news(dom).items.filter((x) => x.kind === 'badge');
  assert.ok(marks.length >= 2, `only ${marks.length} marks — the fixture no longer earns any`);
  await dom.call('renderPokaleTab', r);
  const items = [...band(dom).querySelectorAll('.pokale-news__item[data-kind="badge"]')];
  assert.equal(items.length, marks.length);
  // Start's „Zuletzt gespielt" line counts the same marks (hubBadgeLine).
  const hub = dom.call('hubBadgeLine', r).textContent;
  assert.match(hub, new RegExp(`\\b${marks.length} neue`), `Start says „${hub.trim()}"`);
  assert.equal(band(dom).querySelector('.pokale-news__title').textContent, 'Neu seit Catan · 01.07.2026');
  // A mark opens its holder's collection.
  items[0].click();
  assert.ok(dom.document.querySelector('.badge-collection'), 'the mark opens no collection');
});

test('two tiers of one mark in one session are ONE item, at the higher tier', async (t) => {
  const r = badgeRound(quiet());
  const dom = boot(t, r);
  // Two earnings of one entry from one session: newSince reports both tiers.
  dom.run(`newSince = () => [
    { key: 'sessions', holder: 'round', memberId: null, tier: 10, sessionId: 's9' },
    { key: 'sessions', holder: 'round', memberId: null, tier: 25, sessionId: 's9' },
  ];`);
  const marks = news(dom).items.filter((x) => x.kind === 'badge');
  assert.deepEqual(marks.map((x) => [x.key, x.tier]), [['sessions', 25]]);
});

test('a retired member’s marks are not in the band', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  r.members[0].retired = true;
  const dom = boot(t, r);
  assert.ok(news(dom).items.every((x) => x.memberId !== 'm1'), 'a retired member is in the band');
});

test('a longer session than every earlier one is a new record — equalling it is not', async (t) => {
  const timed = (min) => quiet({ durationMinutes: min }).map((s, i) => (i < 8 ? { ...s, durationMinutes: 60 } : s));
  const longer = boot(t, badgeRound(timed(90)));
  assert.ok(kinds(longer).includes('record:longest'), 'a longer session took no record');
  const equal = boot(t, badgeRound(timed(60)));
  assert.ok(!kinds(equal).includes('record:longest'), 'equalling the record is a new one');
  const r = badgeRound(timed(90));
  const dom = boot(t, r);
  await dom.call('renderPokaleTab', r);
  const item = band(dom).querySelector('.pokale-news__item[data-kind="record"]');
  assert.equal(item.textContent.replace(/\s+/g, ' ').trim(), 'Neuer Rekord: Längste Session · Catan');
  assert.match(item.getAttribute('href'), /\/game\/g1$/, 'the record opens its game');
});

test('a game that BECOMES the most played is a new record — one that already was is not', async (t) => {
  // Azul three times, Catan twice, then Catan twice more: the last makes it.
  const ns = [1, 2, 3].map((d) => night(`a${d}`, d, { chosenGameId: 'g2', winnerIds: [] }))
    .concat([4, 5, 6].map((d) => night(`c${d}`, d, { chosenGameId: 'g1', winnerIds: [] })));
  const tied = boot(t, badgeRound(ns));
  assert.ok(kinds(tied).includes('record:mostPlayed'), 'drawing level made it a joint holder');
  const ahead = boot(t, badgeRound(quiet()));
  assert.ok(!kinds(ahead).includes('record:mostPlayed'), 'Catan already held it');
});

test('a challenge step this session made is in the band, and opens the challenge', async (t) => {
  const iso = (d) => new Date(Date.parse('2026-07-01T00:00:00.000Z') + d * DAY).toISOString();
  const r = badgeRound(quiet());
  r.challenge = { kind: 'sessions', n: 20, startedAt: iso(0), deadline: '2099-01-01T00:00:00.000Z' };
  const dom = boot(t, r);
  assert.deepEqual(kinds(dom), ['challenge']);
  assert.equal(news(dom).items[0].done, false);
  await dom.call('renderPokaleTab', r);
  const item = band(dom).querySelector('.pokale-news__item[data-kind="challenge"]');
  assert.match(item.textContent, /Challenge: 20 Sessions/);
  item.click();
  assert.ok(dom.document.querySelector('.sheet, .popover'), 'the step opens no challenge sheet');

  // A challenge that started after the session: no step, no item.
  const later = badgeRound(quiet());
  later.challenge = { ...r.challenge, startedAt: iso(30) };
  assert.deepEqual(kinds(boot(t, later)), []);
});

// --- the round's plaque --------------------------------------------------------

test('the round’s plaque: name and span, the records, the challenge and the round’s own row', async (t) => {
  const r = badgeRound(quiet());
  const dom = boot(t, r);
  await dom.call('renderPokaleTab', r);
  const plaque = dom.app.querySelector('.pokale-plaque');
  assert.equal(plaque.querySelector('.pokale-plaque__title').textContent, 'Kartographen');
  assert.equal(plaque.querySelector('.pokale-plaque__since').textContent, '9 Sessions seit Juli 2026');
  assert.ok(plaque.querySelector('.pokale-records .pokale-record'), 'no records on the plaque');
  assert.ok(plaque.querySelector('.challenge-section'), 'no challenge row on the plaque (an editor sees „starten")');
  const row = plaque.querySelector('#abzeichen-round');
  assert.equal(row.querySelector('.badge-member__name').textContent, 'Abzeichen');
  row.click();
  assert.ok(dom.document.querySelector('.badge-collection'), "the round's row opens its collection");
});

// --- each person once ----------------------------------------------------------

// Seven nights over four members: a podium (or bars / a table), a winless
// member standing at 0, and someone below the third place.
function mature() {
  const w = ['m1', 'm1', 'm2', 'm3', 'm1', 'm2', 'm4'];
  return badgeRound(w.map((mid, i) => night(`s${i + 1}`, i + 1, { winnerIds: [mid], memberIds: ['m1', 'm2', 'm3', 'm4'] })), 4);
}

for (const design of DESIGNS) {
  test(`${design}: every member is named on exactly one plaque, with a place; no summary line`, async (t) => {
    const r = mature();
    const dom = boot(t, r, design);
    await dom.call('renderPokaleTab', r);
    for (const m of r.members) {
      assert.equal(dom.app.querySelectorAll(`[id="abzeichen-${m.id}"]`).length, 1, `${m.name} has ${dom.app.querySelectorAll(`[id="abzeichen-${m.id}"]`).length} plaques`);
    }
    assert.equal(dom.app.querySelector('.podium__rest'), null, 'the summary line under the stage came back');
    const rows = design === 'ocean' || design === 'bruecke' ? '.pokale-bars__row'
      : design === 'programmheft' || design === 'forest' ? '.pokale-table tbody tr' : null;
    if (rows) {
      // The standings list every person already: the row IS the plaque.
      assert.equal(dom.app.querySelector('.badge-section'), null, `${design} lists the people twice`);
      assert.ok([...dom.app.querySelectorAll(rows)].every((row) => row.querySelector('.pokale-pins')), 'a row without its pins');
    } else {
      const places = [...dom.app.querySelectorAll('.badge-section .badge-member')]
        .map((b) => [b.dataset.mid, (b.querySelector('.badge-member__place') || {}).textContent]);
      assert.deepEqual(places, [['m1', '1'], ['m2', '2'], ['m3', '3'], ['m4', '3']], 'standings order and the tie-aware place');
    }
  });

  test(`${design}: a young round prints no place on any plaque`, async (t) => {
    const r = badgeRound([night('s1', 1), night('s2', 2, { winnerIds: ['m2'] })]);
    const dom = boot(t, r, design);
    await dom.call('renderPokaleTab', r);
    const rows = [...dom.app.querySelectorAll('.badge-section .badge-member')];
    assert.deepEqual(rows.map((b) => b.dataset.mid).sort(), ['m1', 'm2'], 'everyone on a plaque');
    assert.equal(dom.app.querySelector('.badge-member__place'), null, 'a place off two evenings');
    assert.ok(!dom.app.querySelector('.badge-members--placed'), 'tiled as a ranking without places');
  });
}
