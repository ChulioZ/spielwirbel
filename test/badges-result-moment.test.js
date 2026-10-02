'use strict';

/* The result moment (#1388, handover §3.4): at most two marks the session just
 * earned, the rest folded into „+N weitere", only for the round's latest
 * finished session, and never a modal — part of the page, with the table and
 * its actions operable from the first paint. Rendered through showResults, the
 * real call site. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor } = require('./support/dom');
const { night, badgeRound, stubApi } = require('./support/badge-fixture');

async function results(t, sessions, sid) {
  const r = badgeRound(sessions);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  const s = r.sessions.find((x) => x.id === sid);
  await dom.call('showResults', r, s, r.games, false);
  return dom;
}

const moment = (dom) => dom.app.querySelector('.badge-moment');

test('the first session shows what it earned, each mark with its holder', async (t) => {
  // Anna alone and nobody won: her Gründungsmitglied and the round's Gegründet.
  const dom = await results(t, [night('s1', 1, { memberIds: ['m1'], winnerIds: [] })], 's1');
  const m = moment(dom);
  assert.equal(m.hidden, false);
  assert.equal(m.querySelector('.badge-moment__title').textContent.trim(), dom.run("t('badges.moment.title')"));
  const items = [...m.querySelectorAll('.badge-moment__item')];
  // newSince orders members first, then the round.
  assert.deepEqual(items.map((li) => li.querySelector('.badge-moment__holder').textContent), ['Anna', 'Kartographen']);
  const tile = items[0].querySelector('.badge');
  assert.equal(tile.dataset.key, 'founder');
  assert.equal(tile.getAttribute('aria-label'), 'Anna, Gründungsmitglied, verdient, neu. Verdient im Juli 2026 · Catan',
    'here the holder is part of the name — several holders share the list');
  assert.equal(m.querySelector('.badge-moment__more'), null, 'two marks fit, nothing is folded');
});

test('at most two marks — the rest fold into „+N weitere", which opens Pokale › Abzeichen', async (t) => {
  // Anna and Ben share the win: per head Erster Sieg, Gründungsmitglied and
  // Anfängerglück, plus the round's Gegründet and Gemeinsam gewonnen = eight.
  const dom = await results(t, [night('s1', 1, { winnerIds: ['m1', 'm2'] })], 's1');
  const m = moment(dom);
  assert.equal(m.querySelectorAll('.badge').length, 2);
  const more = m.querySelector('.badge-moment__more');
  assert.equal(more.textContent, '+6 weitere');
  assert.equal(more.tagName, 'A');
  assert.match(more.getAttribute('href'), /\/pokale$/, 'a real link to the Pokale tab');
});

test('an older session shows no moment — that is the Chronik’s job', async (t) => {
  const dom = await results(t, [night('s1', 1), night('s2', 2)], 's1');
  assert.equal(moment(dom).hidden, true);
  assert.equal(moment(dom).children.length, 0);
});

test('a session that earned nothing shows no moment', async (t) => {
  // The second night, won by nobody: nothing crosses a threshold (a repeat win
  // by Anna would be Titelverteidiger).
  const dom = await results(t, [night('s1', 1), night('s2', 2, { winnerIds: [] })], 's2');
  assert.equal(moment(dom).hidden, true);
});

test('the moment is part of the page, not a modal in front of it', async (t) => {
  const dom = await results(t, [night('s1', 1, { winnerIds: ['m1', 'm2'] })], 's1');
  const m = moment(dom);
  assert.equal(m.tagName, 'SECTION');
  assert.equal(m.closest('[role="dialog"], [aria-modal], .sheet-backdrop, .popover'), null);
  assert.equal(dom.document.querySelector('.sheet-backdrop, .popover, [aria-modal="true"]'), null, 'nothing is open over the page');
  assert.equal(dom.document.querySelector('[inert]'), null, 'nothing behind it is made inert');
  // The table follows it and is live from the first paint.
  const tisch = dom.app.querySelector('.tisch');
  assert.ok(tisch && !tisch.hidden, 'the table is rendered');
  assert.ok(m.compareDocumentPosition(tisch) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'after the headline, before the table');
  assert.equal(dom.document.activeElement, dom.document.body, 'no focus is stolen into the moment');
});

test('a winner tap refills the moment in place', async (t) => {
  // Anna alone, no winner recorded yet: only the two foundings are new.
  const r = badgeRound([night('s1', 1, { memberIds: ['m1'], winnerIds: [] })]);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  dom.set('api', async (method, url, body) => {
    if (/\/finish$/.test(url)) return { winnerIds: body.winnerIds, finishedAt: '2026-07-01T22:00:00.000Z' };
    return /\/activities$/.test(url) ? [] : {};
  });
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  const m = moment(dom);
  assert.deepEqual([...m.querySelectorAll('.badge')].map((b) => b.dataset.key), ['founder', 'founded']);

  // An archived session keeps its picker behind „Ändern“.
  const change = [...dom.app.querySelectorAll('.tisch button')].find((b) => b.textContent.trim() === dom.run("t('result.change')"));
  assert.ok(change, 'the archived table offers „Ändern“');
  change.click();
  const anna = [...dom.app.querySelectorAll('.winner-chip')].find((c) => c.textContent.includes('Anna'));
  assert.ok(anna, 'the winner picker offers Anna');
  anna.click();
  await waitFor(() => m.querySelector('.badge').dataset.key === 'firstWin', { label: 'the moment picks up the first win' });
  assert.equal(moment(dom), m, 'the same section, refilled rather than re-created');
  // A solo win is no contest, so no Anfängerglück — the win, then her founding.
  assert.deepEqual([...m.querySelectorAll('.badge')].map((b) => b.dataset.key), ['firstWin', 'founder']);
  assert.equal(m.querySelector('.badge-moment__more').textContent, '+1 weiteres');
});

test('Dauerbrenner names the game that crossed THIS tier, not the first one to reach 10 (#1463)', async (t) => {
  // Catan reaches 10, then Azul overtakes it and reaches 25 on the last night.
  const at = (i) => new Date(Date.UTC(2026, 6, 1, 20) + i * 86400000).toISOString();
  const sessions = Array.from({ length: 35 }, (_, i) => night(`s${i + 1}`, 1,
    { createdAt: at(i), winnerIds: [], chosenGameId: i < 10 ? 'g1' : 'g2' }));
  const dom = await results(t, sessions, 's35');
  const items = [...moment(dom).querySelectorAll('.badge-moment__item')];
  assert.deepEqual(items.map((li) => li.querySelector('.badge').dataset.key), ['evergreen'], 'nothing else crosses on night 35');
  assert.equal(items[0].querySelector('.badge__name').textContent, 'Dauerbrenner 25');
  assert.equal(items[0].querySelector('.badge__line').textContent, 'Azul 25-mal gespielt');
});
