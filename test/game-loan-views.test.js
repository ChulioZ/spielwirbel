'use strict';

/* Lent boxes (#1775) on the screens that render them, run under jsdom: the
 * Chronik's two lines, the Spielepass chip and menu, the Regal marker, the
 * setup screen's pot and its „Verliehene Spiele mitwirbeln" toggle, and the
 * marker on „Jetzt spielen". The server half is test/game-loan.test.js. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');

const dom = loadApp({ locale: 'de' });
after(() => dom.close());
dom.set('isLoggedIn', () => false);
dom.set('showSessionLobby', () => {});
dom.set('showResults', () => {});
// A phone: the editor presents as a sheet (jsdom has no matchMedia of its own).
dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }];
let seq = 0;
const roundFixture = (games) => ({
  id: `loan-${++seq}`, name: 'Freitagsrunde', members: MEMBERS.map((m) => ({ ...m })),
  tags: [], sessions: [], activities: [], games: games.map((g) => ({ ...g })),
});
const LENT = { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8, loan: { to: 'Ben', memberId: 'm2', since: `${new Date().getFullYear()}-11-03` } };
// This year's day, so the chip prints no year (fmtLoanDay) whenever the suite runs.
const HOME = { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 };

test('the Chronik names the borrower on both lines, by the seat\'s current name', () => {
  const round = roundFixture([HOME]);
  round.members[1].name = 'Benedikt'; // renamed since the loan
  dom.app.innerHTML = '';
  dom.call('renderChronikTab', round, [
    { id: 'a1', type: 'game_lent', at: '2026-11-03T10:00:00.000Z', gameId: 'g1', title: 'Azul', to: 'Ben', memberId: 'm2' },
    { id: 'a2', type: 'game_returned', at: '2026-11-05T10:00:00.000Z', gameId: 'g1', title: 'Azul', to: 'Nachbarin' },
  ]);
  const texts = [...dom.app.querySelectorAll('.timeline .tl-act__text')].map((el) => el.textContent);
  assert.ok(texts.includes('„Azul“ an Benedikt verliehen'), texts.join(' | '));
  assert.ok(texts.includes('„Azul“ ist von Nachbarin zurück'), texts.join(' | '));
});

test('the Spielepass shows „Verliehen an … seit …" and offers „Zurück", which sends a DELETE', async () => {
  const round = roundFixture([LENT, HOME]);
  const calls = [];
  dom.set('api', async (method, url) => {
    calls.push(`${method} ${url}`);
    return method === 'GET' ? round : {};
  });
  dom.set('confirmDialog', async () => true);
  await dom.call('showGameDetail', round.id, 'g1');
  const chip = dom.app.querySelector('.gd-head .tag--loan');
  assert.ok(chip, 'the loan chip is on the card');
  assert.match(chip.textContent.trim(), /^Verliehen an Ben seit 3\.11\.$/);
  // The page menu carries „Zurück" (Klassisch: the „…" popover).
  dom.app.querySelector('.gd-menu').click();
  const back = [...dom.document.querySelectorAll('.popover button')].find((b) => /Zurück/.test(b.textContent));
  assert.ok(back, 'the menu offers „Zurück"');
  back.click();
  await flush();
  assert.ok(calls.includes(`DELETE /api/rounds/${round.id}/games/g1/loan`), calls.join(' | '));
});

test('a box at home offers „Verliehen", and the editor PUTs the seat it was given', async () => {
  const round = roundFixture([HOME]);
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body: body && { ...body } });
    if (method === 'PUT') return { ...HOME, loan: { to: 'Anna', memberId: 'm1', since: '2026-11-09' } };
    return round;
  });
  await dom.call('showGameDetail', round.id, 'g2');
  assert.equal(dom.app.querySelector('.gd-head .tag--loan'), null, 'no chip for a box at home');
  dom.app.querySelector('.gd-menu').click();
  const lend = [...dom.document.querySelectorAll('.popover button')].find((b) => /Verliehen/.test(b.textContent));
  assert.ok(lend, 'the menu offers „Verliehen"');
  lend.click();
  await flush();
  const sheet = dom.document.querySelector('.popover--loan, .editor--loan');
  assert.ok(sheet, 'the loan editor opened');
  const name = sheet.querySelector('#loanName');
  assert.equal(Number(name.getAttribute('maxlength')), dom.get('LOAN_TO_MAX'));
  sheet.querySelector('#loanWho').value = 'm1';
  sheet.querySelector('.btn--primary').click();
  await flush();
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put, 'a PUT was sent');
  assert.equal(put.url, `/api/rounds/${round.id}/games/g2/loan`);
  assert.equal(put.body.memberId, 'm1');
  assert.equal('to' in put.body, false, 'a picked seat sends no typed name');
});

test('the pot leaves a lent box out until „Verliehene Spiele mitwirbeln" is on, and the draw is told', async () => {
  const round = roundFixture([LENT, HOME]);
  const posts = [];
  dom.set('api', async (method, url, body) => {
    if (method === 'POST') posts.push({ ...body });
    return { session: { id: 's1' }, games: [], members: [], guests: [], teams: [] };
  });
  await dom.call('showStartSession', round);
  const title = () => dom.app.querySelector('#poolTitle').textContent;
  assert.match(title(), /1 Spiel im Topf/, 'the lent box is out of the pot by default');
  const lentChip = dom.app.querySelector('.setup-addons__chip[data-addon="lent"]');
  assert.ok(lentChip, 'the toggle is offered when a box is out');
  lentChip.click();
  assert.match(title(), /2 Spiele im Topf/, 'the toggle puts it back');
  dom.app.querySelector('#go').click();
  await flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].includeLent, true);
});

test('no box out, no toggle — an ordinary evening\'s row is unchanged', async () => {
  await dom.call('showStartSession', roundFixture([HOME]));
  assert.equal(dom.app.querySelector('.setup-addons__chip[data-addon="lent"]'), null);
});

test('the Regal card and „Jetzt spielen" both mark a lent box', async () => {
  const round = roundFixture([LENT, HOME]);
  dom.app.innerHTML = '';
  dom.call('renderRegalTab', round, round.games);
  const marker = dom.app.querySelector('.exp-pill--loan');
  assert.ok(marker, 'the Regal card carries the marker');
  assert.match(marker.getAttribute('aria-label'), /^Verliehen an Ben/);
  assert.equal(dom.app.querySelectorAll('.exp-pill--loan').length, 1, 'only the lent box');

  dom.call('showDirectPlayPicker', round);
  const rows = [...dom.document.querySelectorAll('.play-pick__row')];
  const azul = rows.find((r) => /Azul/.test(r.textContent));
  assert.ok(azul, 'a lent box stays pickable for „Jetzt spielen"');
  assert.match(azul.textContent, /Verliehen/);
  assert.doesNotMatch(rows.find((r) => /Catan/.test(r.textContent)).textContent, /Verliehen/);
});
