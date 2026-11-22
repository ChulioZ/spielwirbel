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
  // A second session nobody won: a repeat win would be Titelverteidiger.
  const r = badgeRound([night('s1', 1), night('s2', 2, { winnerIds: [] })]);
  const dom = boot(t, r);
  dom.call('renderChronikTab', r, []);
  const first = itemOf(dom, 's1');
  assert.ok(first, 'the first session is on the timeline');
  const rows = badgeRowsOf(first);
  assert.deepEqual(rows.map((x) => x.querySelector('.chronik-row__text').textContent),
    ['Anna · Erster Sieg', 'Anna · Gründungsmitglied', 'Anna · Anfängerglück', 'Ben · Gründungsmitglied', 'Kartographen · Gegründet'],
    'members first (in catalogue order), then the round');
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

test('a Chronik row’s plain click lands on that holder’s row in Pokale, its collection open (#1856)', async (t) => {
  const r = badgeRound([night('s1', 1, { winnerIds: ['m2'] })]);
  const dom = boot(t, r);
  dom.call('renderChronikTab', r, []);
  const link = badgeRowsOf(itemOf(dom, 's1')).map((x) => x.querySelector('a')).find((a) => a.textContent === 'Ben · Erster Sieg');
  assert.ok(link, 'Ben’s first win has its row');
  link.click();
  await waitFor(() => dom.document.getElementById('abzeichen-m2'), { label: 'Pokale rendered' });
  const sheet = await waitFor(() => dom.document.querySelector('.sheet-backdrop .badge-collection'), { label: 'the collection opened' });
  assert.equal(sheet.closest('.sheet').getAttribute('aria-label'), 'Abzeichen von Ben');
});

test('a ROUND mark’s Chronik row opens the round’s collection (#1856)', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = boot(t, r);
  dom.call('renderChronikTab', r, []);
  const link = badgeRowsOf(itemOf(dom, 's1')).map((x) => x.querySelector('a')).find((a) => a.textContent === 'Kartographen · Gegründet');
  assert.ok(link, 'the round’s founding has its row');
  link.click();
  const sheet = await waitFor(() => dom.document.querySelector('.sheet-backdrop .badge-collection'), { label: 'the collection opened' });
  assert.equal(sheet.closest('.sheet').getAttribute('aria-label'), 'Abzeichen von Kartographen');
});

// ---------------------------------------------------------------------- hub

/* „Zuletzt gespielt" carries the line since #1853 took the Pokale preview off
   the Start tab — the one fact only that preview used to say. */
test('the hub’s „Zuletzt gespielt" says what is new since the latest session', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = boot(t, r);
  await dom.call('showRound', RID, 'start');
  const last = [...dom.app.querySelectorAll('a.ticket')].find((a) => /Zuletzt gespielt/.test(a.textContent));
  assert.ok(last, 'no „Zuletzt gespielt" ticket');
  const line = last.querySelector('.hub-row--badges');
  assert.ok(line, 'the ticket does not carry the Abzeichen line');
  // Erster Sieg, Anfängerglück, two Gründungsmitglieder and Gegründet.
  assert.equal(line.textContent.trim(), '5 neue Abzeichen seit Catan');
  assert.equal(line.querySelector('a, button'), null, 'a plain line — the ticket keeps its one link');
  assert.equal(dom.app.querySelectorAll('.hub-row--badges').length, 1, 'the line is on the Start tab twice');
});

test('with nothing new, the hub line names the newest mark instead', (t) => {
  const r = badgeRound([night('s1', 1), night('s2', 2, { winnerIds: [] })]);
  const dom = boot(t, r);
  const line = dom.call('hubBadgeLine', r);
  assert.match(line.textContent.trim(), /^Zuletzt: /);
});

// --------------------------------------------------------------- Tischkarte

test('die Tischkarte shows earned marks only, and a tap opens that member’s collection in Pokale', async (t) => {
  const r = badgeRound([night('s1', 1)]);
  const dom = boot(t, r);
  await dom.call('showMember', RID, 'm1');
  const row = await waitFor(() => dom.app.querySelector('.member-card__badges'), { label: 'the Tischkarte rendered' });
  const tiles = [...row.querySelectorAll('.badge')];
  assert.deepEqual(tiles.map((b) => [b.dataset.key, b.dataset.state]),
    [['firstWin', 'earned'], ['founder', 'earned'], ['beginnersLuck', 'earned']]);
  assert.equal(row.querySelector('.member-card__badges-label').textContent, 'Abzeichen · 3');
  assert.equal(tiles[0].tagName, 'BUTTON');
  assert.doesNotMatch(dom.app.textContent, /Siegwertung/, 'the withdrawn measure must not come back with the row');

  tiles[0].click();
  await waitFor(() => dom.document.getElementById('abzeichen-m1'), { label: 'Pokale rendered' });
  const sheet = await waitFor(() => dom.document.querySelector('.sheet-backdrop .badge-collection'), { label: 'the collection opened' });
  assert.equal(sheet.closest('.sheet').getAttribute('aria-label'), 'Abzeichen von Anna', 'the tap navigates to Anna’s collection, not a card on the Tischkarte');
});

test('a member with nothing earned gets no badge row at all', async (t) => {
  // Ben missed the first session, so he is no Gründungsmitglied either.
  const r = badgeRound([night('s1', 1, { memberIds: ['m1'] }), night('s2', 2)]);
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
