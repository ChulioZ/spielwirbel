'use strict';

/* The Abzeichen's three quieter placements (#1388): one Chronik row per
 * earning under the session that produced it, one line in the hub's Pokale
 * preview, and the Tischkarte's earned-only row. Each rendered through its real
 * caller under jsdom. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor } = require('./support/dom');
const { RID, night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');

function boot(t, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, round);
  wideAt(dom, false);
  return dom;
}

// The timeline item holding session `sid`'s card.
const itemOf = (dom, sid) => [...dom.app.querySelectorAll('.tl-item')]
  .find((it) => { const a = it.querySelector('.session-card'); return a && a.getAttribute('href').endsWith(`/${sid}`); });
const badgeRowsOf = (item) => [...item.querySelectorAll('.chronik-row--badge')];

// ------------------------------------------------------------------ Chronik

test('each earning is one row under the session that earned it, linking to its holder', (t) => {
  const r = badgeRound([night('s1', 1), night('s2', 2)]);
  const dom = boot(t, r);
  dom.call('renderChronikTab', r, []);
  const first = itemOf(dom, 's1');
  assert.ok(first, 'the first session is on the timeline');
  const rows = badgeRowsOf(first);
  assert.deepEqual(rows.map((x) => x.querySelector('.chronik-row__text').textContent),
    ['Anna · Erster Sieg', 'Kartographen · Gegründet'], 'members first, then the round');
  for (const row of rows) {
    assert.equal(row.querySelector('.chronik-row__label').textContent, dom.run("t('badges.title')"));
    const a = row.querySelector('a.chronik-row__text');
    assert.match(a.getAttribute('href'), /\/pokale$/, 'a real link into Pokale › Abzeichen');
  }
  assert.ok(rows[0].querySelector('.ti-crown'), 'the mark’s own glyph');
  assert.deepEqual(badgeRowsOf(itemOf(dom, 's2')), [], 'the second session earned nothing');
});

test('a tier row names its tier, under the session that reached it', (t) => {
  const sessions = Array.from({ length: 10 }, (_, i) => night(`s${i + 1}`, i + 1));
  const r = badgeRound(sessions);
  const dom = boot(t, r);
  dom.call('renderChronikTab', r, []);
  const texts = badgeRowsOf(itemOf(dom, 's10')).map((x) => x.querySelector('.chronik-row__text').textContent);
  assert.ok(texts.includes('Anna · Stammgast 10'), texts.join(' | '));
  assert.ok(texts.includes('Kartographen · Sessions 10'), texts.join(' | '));
});

test('a Chronik row’s plain click lands on that holder’s row in Pokale', async (t) => {
  const r = badgeRound([night('s1', 1, { winnerIds: ['m2'] })]);
  const dom = boot(t, r);
  dom.call('renderChronikTab', r, []);
  const link = badgeRowsOf(itemOf(dom, 's1'))[0].querySelector('a');
  assert.equal(link.textContent, 'Ben · Erster Sieg');
  link.click();
  const row = await waitFor(() => dom.document.getElementById('abzeichen-m2'), { label: 'Pokale rendered' });
  assert.equal(row.open, true);
  assert.equal(dom.document.activeElement, row.querySelector('summary'));
});

// ---------------------------------------------------------------------- hub

test('the hub’s Pokale preview says what is new since the latest session', (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = boot(t, r);
  const card = dom.call('hubPokalePreview', r);
  const line = card.querySelector('.hub-row--badges');
  assert.equal(line.textContent.trim(), '2 neue Abzeichen seit Catan');
  assert.notEqual(line.tagName, 'A', 'a plain line — the card keeps its one link');
});

test('with nothing new, the hub line names the newest mark instead', (t) => {
  const r = badgeRound([night('s1', 1), night('s2', 2)]);
  const dom = boot(t, r);
  const line = dom.call('hubPokalePreview', r).querySelector('.hub-row--badges');
  assert.match(line.textContent.trim(), /^Zuletzt: /);
});

// --------------------------------------------------------------- Tischkarte

test('die Tischkarte shows earned marks only, and a tap goes to that member in Pokale', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = boot(t, r);
  await dom.call('showMember', RID, 'm1');
  const row = await waitFor(() => dom.app.querySelector('.member-card__badges'), { label: 'the Tischkarte rendered' });
  const tiles = [...row.querySelectorAll('.badge')];
  assert.deepEqual(tiles.map((b) => [b.dataset.key, b.dataset.state]), [['firstWin', 'earned']]);
  assert.equal(row.querySelector('.member-card__badges-label').textContent, 'Abzeichen · 1');
  assert.equal(tiles[0].tagName, 'BUTTON');
  assert.doesNotMatch(dom.app.textContent, /Siegwertung/, 'the withdrawn measure must not come back with the row');

  tiles[0].click();
  const target = await waitFor(() => dom.document.getElementById('abzeichen-m1'), { label: 'Pokale rendered' });
  assert.equal(dom.document.activeElement, target.querySelector('summary'));
  assert.equal(dom.document.querySelector('.sheet-backdrop, .popover'), null, 'the Tischkarte tap navigates, it opens no card');
});

test('a member with nothing earned gets no badge row at all', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = boot(t, r);
  await dom.call('showMember', RID, 'm2');
  await waitFor(() => dom.app.querySelector('.member-card'), { label: 'the Tischkarte rendered' });
  assert.equal(dom.app.querySelector('.member-card__badges'), null);
});

test('Dauerbrenner: each tier’s row sits under the session of the game that crossed it (#1463)', (t) => {
  const at = (i) => new Date(Date.UTC(2026, 6, 1, 20) + i * 86400000).toISOString();
  const sessions = Array.from({ length: 35 }, (_, i) => night(`s${i + 1}`, 1,
    { createdAt: at(i), winnerIds: [], chosenGameId: i < 10 ? 'g1' : 'g2' }));
  const r = badgeRound(sessions);
  const dom = boot(t, r);
  dom.call('renderChronikTab', r, []);
  const rowsAt = (sid) => badgeRowsOf(itemOf(dom, sid)).map((x) => x.querySelector('.chronik-row__text').textContent);
  assert.ok(rowsAt('s10').includes('Kartographen · Dauerbrenner 10'), rowsAt('s10').join(' | '));
  assert.ok(rowsAt('s35').includes('Kartographen · Dauerbrenner 25'), rowsAt('s35').join(' | '));
  // The session each row sits under is the crossing game's.
  assert.match(itemOf(dom, 's10').querySelector('.session-card').textContent, /Catan/);
  assert.match(itemOf(dom, 's35').querySelector('.session-card').textContent, /Azul/);
  // Nowhere else: Catan's later plays never reach 25.
  const all = sessions.flatMap((s) => rowsAt(s.id)).filter((x) => x.includes('Dauerbrenner'));
  assert.deepEqual(all, ['Kartographen · Dauerbrenner 10', 'Kartographen · Dauerbrenner 25']);
});
