'use strict';

/* Der Tisch (#1057): the chosen game's own band, above the Tafel.
 *
 * It replaces the in-row `.row-finish` panel, which sat 1000+px down a 2905px
 * page on the evening it was needed and then stayed there at full size
 * afterwards — a 344px winner picker on a session finished months ago. The band
 * exists in three states and in only three states, and the one that matters most
 * is the FOURTH: with no game chosen it must not exist at all. The deep-dive's
 * empty „Auf dem Tisch" slot was rejected on 2026-09-12 for exactly that.
 *
 * Driven through the jsdom harness because every assertion here is about what
 * the screen builds and in which phase (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { bodyOf, mediaBlocks, rulesOf, outranks } = require('./support/css');

const ME = 'user-me';

function fixture(over = {}, roundOver = {}) {
  const session = {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2', 'm3'],
    votes: {
      m1: { g1: { rating: 5 }, g2: { rating: 3 } },
      m2: { g1: { rating: 4 }, g2: { rating: 2 } },
      m3: { g1: { rating: 4 }, g2: { rating: 2 } },
    },
    votedIds: ['m1', 'm2', 'm3'],
    done: true,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: 'g1',
    events: [],
    ...over,
  };
  const round = {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    members: [
      { id: 'm1', name: 'Anna', userId: ME },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Clara' },
    ],
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [session],
    ...roundOver,
  };
  round.sessions = [session];
  return { round, session };
}

async function show(t, over = {}, roundOver = {}) {
  const { round, session } = fixture(over, roundOver);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sent = [];
  dom.set('api', async (method, path, body) => {
    if (method === 'POST' && /\/finish$/.test(path)) {
      sent.push({ path, body: JSON.parse(JSON.stringify(body)) });
      const winnerIds = body.winnerIds || [];
      const saved = { ...session, finished: body.finished !== false, winnerIds,
        finishedAt: body.finished === false ? null : '2026-08-02T22:10:00.000Z' };
      if (body.ending && !winnerIds.length) saved.ending = body.ending; else delete saved.ending;
      return saved;
    }
    if (method === 'POST' && /\/choice$/.test(path)) { sent.push({ path, body: { ...body } }); return {}; }
    return round;
  });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showResults', round, session);
  return { dom, sent };
}

const band = (dom) => dom.app.querySelector('.tisch');
const btn = (dom, rx) => [...dom.app.querySelectorAll('.tisch button, .tisch-bar button')]
  .find((b) => rx.test(b.textContent));

// ------------------------------------------------------------ the three states

test('with no game chosen the band does not exist — nothing may take that room', async (t) => {
  const { dom } = await show(t, { chosenGameId: null });
  assert.ok(band(dom).hidden, 'an empty „Auf dem Tisch" slot is exactly what was rejected');
  assert.equal(band(dom).textContent.trim(), '', 'and it holds nothing either');
  assert.ok(dom.app.querySelector('.tisch-bar').hidden, 'nor does the phone CTA');
});

test('am Tisch: the box, the title, who brings it, and one action', async (t) => {
  const { dom } = await show(t, {}, {
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], ownerIds: ['m1'], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
  });
  const el = band(dom);
  assert.equal(el.hidden, false);
  assert.equal(el.dataset.state, 'table');
  assert.ok(el.querySelector('.tisch__box'), 'the box');
  assert.equal(el.querySelector('.tisch__title').textContent.trim(), 'Catan');
  assert.match(el.querySelector('.tisch__note').textContent, /Gehört Anna/);
  assert.ok(btn(dom, /Als gespielt markieren/), 'the one action the evening needs');
  assert.equal(el.querySelector('.stamp'), null, 'nothing is stamped before it is played');
  assert.equal(el.querySelector('.winner-chips'), null, 'and no winner is asked for yet (#254)');
});

test('„Anderes Spiel wählen" clears the choice, the band and the row chip together', async (t) => {
  const { dom, sent } = await show(t);
  assert.ok(dom.app.querySelector('.trow.is-chosen .trow__chip'), 'the chosen row states it');
  btn(dom, /Anderes Spiel wählen/).click();
  await flush();
  assert.deepEqual(sent.map((s) => ({ ...s.body })), [{ gameId: null }]);
  assert.ok(band(dom).hidden, 'the band goes with the choice');
  assert.equal(dom.app.querySelector('.trow.is-chosen'), null, 'and so does the row chip');
  assert.equal(dom.app.querySelectorAll('.play-btn').length, 2, 'every row offers „Spielen" again');
});

test('finishing stamps the box and opens the picker, because who won is the one question left', async (t) => {
  const { dom, sent } = await show(t);
  btn(dom, /Als gespielt markieren/).click();
  await flush();

  assert.deepEqual(sent.map((s) => s.body), [{ finished: true, winnerIds: [] }]);
  assert.equal(band(dom).dataset.state, 'done');
  const stamp = band(dom).querySelector('.stamp.stamp--table');
  assert.ok(stamp, 'the box is stamped');
  assert.match(stamp.textContent, /Gespielt/);
  assert.doesNotMatch(stamp.textContent, /Invalid/, 'and carries a real date');
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 2,
    'the picker opens: parties and endings');
  assert.ok(dom.app.querySelector('.tisch-bar').hidden, 'the phone CTA is spent');
});

test('recording a winner collapses the picker to the seats', async (t) => {
  const { dom } = await show(t, { finished: true });
  // An archived session opens on the PICTURE, not on the picker.
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 0,
    'a session finished months ago must not open on a 344px picker');
  btn(dom, /Ändern/).click();
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 2, '„Ändern" reopens it');

  [...dom.app.querySelectorAll('.winner-chip')].find((c) => /Anna/.test(c.textContent)).click();
  await flush();
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 0, 'and recording closes it again');
  const seats = band(dom).querySelectorAll('.tisch__seats .seat');
  assert.equal(seats.length, 1);
  assert.match(seats[0].textContent, /Anna/);
  assert.match(band(dom).querySelector('.tisch__won').textContent, /hat gewonnen/);
});

test('a team win renders one seat per member', async (t) => {
  const { dom } = await show(t, {
    finished: true,
    winnerIds: ['m1', 'm2'],
    teams: [{ id: 't1', name: 'Die Zwei', memberIds: ['m1', 'm2'] }],
  });
  const seats = [...band(dom).querySelectorAll('.tisch__seats .seat')];
  assert.deepEqual(seats.map((s) => s.querySelector('.seat__name').textContent.trim()), ['Anna', 'Ben'],
    'a team win is its people — that is what `winnerIds` already stores');
  assert.match(band(dom).querySelector('.tisch__won').textContent, /haben gewonnen/,
    'and the plural follows the seat count');
});

test('an ending renders its own line instead of seats', async (t) => {
  const { dom } = await show(t, { finished: true, ending: 'noWinner' });
  assert.equal(band(dom).querySelector('.tisch__seats'), null, 'nobody won, so there is nobody to seat');
  assert.match(band(dom).querySelector('.tisch__outcome').textContent, /ohne Sieger/);
});

test('„Zurücksetzen" returns the band to the am-Tisch state', async (t) => {
  const { dom, sent } = await show(t, { finished: true, winnerIds: ['m1'] });
  btn(dom, /Zurücksetzen/).click();
  await flush();
  assert.deepEqual(sent.map((s) => s.body), [{ finished: false, winnerIds: [] }]);
  assert.equal(band(dom).dataset.state, 'table');
  assert.equal(band(dom).querySelector('.stamp'), null, 'the stamp is lifted with it');
  assert.ok(btn(dom, /Als gespielt markieren/), 'and the evening can be played again');
  assert.equal(dom.app.querySelector('.tisch-bar').hidden, false, 'the phone CTA is back');
});

test('the in-row finish panel and the chosen-game banner are gone', async (t) => {
  const { dom } = await show(t, { finished: true, winnerIds: ['m1'] });
  assert.equal(dom.app.querySelector('.row-finish'), null);
  assert.equal(dom.app.querySelector('.chosen-banner'), null);
  assert.equal(dom.app.querySelector('.winner-result'), null,
    'the trophy line is the seats now');
  // The chosen row stays in the ranking with its chip: the ranking is the VOTE's
  // record and must stay complete — place 3 must not become place 2.
  assert.equal(dom.app.querySelectorAll('.trow').length, 2);
});

// ------------------------------------------------------------ the CSS contract

test('the phone CTA sticks to the bottom and is hidden from the rail breakpoint up', () => {
  const bar = bodyOf('.tisch-bar');
  assert.ok(bar, '.tisch-bar rule is gone');
  assert.match(bar, /position:\s*sticky/, 'a bar that does not stick is one more card');
  assert.match(bar, /bottom:\s*0/);
  assert.match(bar, /env\(safe-area-inset-bottom/, 'or it sits under the home indicator');

  const hide = mediaBlocks()
    .filter(([q]) => /min-width:\s*1280px/.test(q))
    .flatMap(([, css]) => rulesOf(css))
    .find(([sel, body]) => /\.tisch-bar/.test(sel) && /display:\s*none/.test(body));
  assert.ok(hide, 'the bar is never hidden on desktop, where a fitting column makes it a card');
  // (0,3,0): `.tisch-bar[hidden]` is (0,2,0) — an attribute counts in the same
  // column as a class — so a two-class selector here would TIE it and ride on
  // source order, which is what this sheet's own convention forbids.
  assert.ok(outranks(hide[0], '.tisch-bar[hidden]'),
    `"${hide[0]}" ties the [hidden] rule it competes with and rides on source order`);
});

test('the band is a two-column grid and its box carries a box shadow', () => {
  const el = bodyOf('.tisch');
  assert.match(el, /grid-template-columns:\s*128px/, 'the box leads at a size worth recognising');
  assert.match(bodyOf('.tisch__box'), /box-shadow:\s*var\(--shadow-2\)/,
    'this is the physical thing somebody carries to the table');
  assert.match(bodyOf('.tisch__seats .avatar'), /box-shadow:\s*0 0 0 3px var\(--gold\)/,
    'the winners are ringed in gold');
});

test('the stamp on the box is the SAME component as the game page presses', () => {
  // Not a look-alike: `.stamp--table` only re-sizes it, so a change to the
  // Stempelkarte's border, mask or tint reaches this surface for free.
  const table = bodyOf('.stamp--table');
  assert.ok(table, '.stamp--table rule is gone');
  assert.doesNotMatch(table, /border:\s*3px double/, 'the double rule belongs to `.stamp` itself');
  assert.match(bodyOf('.stamp::before'), /border:\s*3px double var\(--sc\)/,
    'and `.stamp` must still be the thing that declares it');
});
