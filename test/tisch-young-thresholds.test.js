'use strict';

/* Der Tisch's young-round features (#1280, T7.2 / T7.5 / T7.6):
 *
 *   - T7.5: until the third played session the Rundenpuls carries a sentence
 *     instead of series, the Pokale streak card waits, and the
 *     podium — on the hub preview AND on the Pokale tab — becomes the leader
 *     plus „Ein Podium braucht 3 Sessions.";
 *   - T7.2: a one-round lobby gets an invite slip on the tile and a
 *     „Nächster Schritt" card under the grid;
 *   - T7.6: the demo's hub condenses its three previews into one list and
 *     carries the „Gefällt dir das?" invitation.
 *
 * Every branch is a designIs('tisch') gate, so each screen is rendered twice
 * through the real view: under Klassisch asserting the structure it has always
 * had, and under Der Tisch. The two thresholds are pinned twice as well — by
 * value at the boundary (2 → 3 sessions) on every site, and by NAME in the
 * source, so a site cannot quietly grow its own literal 3.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { YOUNG_ROUND_SERIES_FROM, YOUNG_ROUND_PODIUM_FROM } = require('../public/js/hub-insights');

const game = (n) => ({ id: 'g' + n, title: 'Spiel ' + n, minPlayers: 2, maxPlayers: 4, createdAt: '2026-01-0' + (n % 9 + 1) + 'T10:00:00.000Z' });
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const play = (id, n, days, winnerIds) => ({
  id, createdAt: daysAgo(days), done: true, finished: true,
  gameIds: ['g' + n], chosenGameId: 'g' + n, winnerIds, memberIds: ['m1', 'm2', 'm3'],
  votes: { m1: { ['g' + n]: { rating: 5 } }, m2: { ['g' + n]: { rating: 4 } } },
});

/* `n` played sessions, Anna winning every one — so from two on there IS a
   streak to hold back, and Anna is the sole leader throughout. */
const round = (n) => ({
  id: 'r1',
  name: 'Sonntagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cem' }],
  games: Array.from({ length: 8 }, (_, i) => game(10 + i)),
  sessions: Array.from({ length: n }, (_, i) => play(900 + i, 10 + i, 3 + i, ['m1'])),
  tags: [],
});

function boot(t, design, r, { demo = false, accounts = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('accountsActive', () => accounts);
  dom.set('isDemoAccount', () => demo);
  dom.set('api', async (method, url) => (/recommendations/.test(url) ? { recommendations: [] } : r));
  return dom;
}

async function hub(t, design, r, opts) {
  const dom = boot(t, design, r, opts);
  await dom.call('showRound', r.id, 'start');
  return dom;
}

async function pokale(t, design, r) {
  const dom = boot(t, design, r);
  await dom.call('renderPokaleTab', r);
  return dom;
}

const cardByTitle = (dom, title) => [...dom.app.querySelectorAll('.hub-cards .hub-card')]
  .find((c) => c.querySelector('.hub-card__title').textContent.trim() === title);
const SERIES = `Serien zeigen wir ab ${YOUNG_ROUND_SERIES_FROM} Sessions — vorher wären sie Zufall.`;
const PODIUM = `Ein Podium braucht ${YOUNG_ROUND_PODIUM_FROM} Sessions.`;

// ------------------------------------------------------------- the constants

test('both thresholds are the third session', () => {
  assert.equal(YOUNG_ROUND_SERIES_FROM, 3);
  assert.equal(YOUNG_ROUND_PODIUM_FROM, 3);
});

/* By NAME, not only by value: every gate and every sentence reads the shared
   constant. A site with its own `< 3` would pass every boundary test below
   today and drift the day the operator moves the number. */
test('every site gates on the shared constant, never on a literal', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'public/js', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const sites = {
    'hub-cards.js': ['YOUNG_ROUND_SERIES_FROM'],
    'hub-previews.js': ['YOUNG_ROUND_PODIUM_FROM'],
    'views-pokale.js': ['YOUNG_ROUND_SERIES_FROM', 'YOUNG_ROUND_PODIUM_FROM'],
  };
  for (const [file, names] of Object.entries(sites)) {
    const code = src(file);
    for (const name of names) {
      assert.ok(code.includes(name), `${file} no longer reads ${name}`);
    }
    // Both shapes the sites use: the call compared inline (`youngRoundPlayed(r,
    // hubDeps()) < N` — note the nested parens) and the `played` local.
    assert.doesNotMatch(code, /(youngRoundPlayed\(.*\)|\bplayed)\s*<\s*\d/, `${file} compares the played count to a literal`);
  }
});

// ------------------------------------------------------------- T7.5, the hub

test('Klassisch hub after one session: no pulse card, a normal Pokale preview, no threshold anywhere', async (t) => {
  const dom = await hub(t, null, round(1));
  assert.equal(cardByTitle(dom, 'Rundenpuls'), undefined, 'Klassisch’s pulse still needs two sessions');
  assert.equal(dom.app.querySelector('.hub-card__threshold, .hub-preview__threshold, .hub-demo'), null);
});

test('Der Tisch hub after one session: real pulse tiles plus the series sentence', async (t) => {
  const dom = await hub(t, 'tisch', round(1));
  const pulse = cardByTitle(dom, 'Rundenpuls');
  assert.ok(pulse, 'Der Tisch draws the pulse from the first session');
  assert.equal(pulse.querySelector('.pulse-tile__n').textContent, '1');
  assert.equal(pulse.querySelector('.hub-card__threshold').textContent, SERIES);
  assert.equal(pulse.lastElementChild.querySelector(':scope > .hub-card__threshold') !== null, true,
    'the sentence closes the card, after the figures');
});

test('Der Tisch hub: the series sentence stays until the third session and then goes', async (t) => {
  const two = await hub(t, 'tisch', round(YOUNG_ROUND_SERIES_FROM - 1));
  assert.ok(cardByTitle(two, 'Rundenpuls').querySelector('.hub-card__threshold'));
  const three = await hub(t, 'tisch', round(YOUNG_ROUND_SERIES_FROM));
  assert.equal(cardByTitle(three, 'Rundenpuls').querySelector('.hub-card__threshold'), null);
});

test('Der Tisch Pokale preview below the threshold names only the leader and says when the podium comes', async (t) => {
  const dom = await hub(t, 'tisch', round(YOUNG_ROUND_PODIUM_FROM - 1));
  const card = dom.app.querySelector('.hub-previews .hub-preview .hub-card__title .ti-trophy').closest('.hub-preview');
  assert.equal(card.querySelector('.hub-preview__sub').textContent, 'Anna führt');
  assert.deepEqual([...card.querySelectorAll('.hub-preview__name')].map((e) => e.textContent), ['Anna'],
    'no second and third place off two evenings');
  assert.equal(card.querySelector('.hub-preview__threshold').textContent, PODIUM);
});

test('Der Tisch Pokale preview from the threshold on ranks as before', async (t) => {
  const dom = await hub(t, 'tisch', round(YOUNG_ROUND_PODIUM_FROM));
  const card = dom.app.querySelector('.hub-previews .hub-preview .hub-card__title .ti-trophy').closest('.hub-preview');
  assert.equal(card.querySelector('.hub-preview__threshold'), null);
  assert.ok(card.querySelectorAll('.hub-preview__rank').length > 1, 'the stage is back');
});

// ------------------------------------------------------------- T7.5, the Pokale tab

test('Klassisch Pokale tab after one session keeps its podium and its streak card', async (t) => {
  const dom = await pokale(t, null, round(2));
  assert.ok(dom.app.querySelector('.podium'), 'Klassisch lost its podium');
  assert.equal(dom.app.querySelector('.pokale-young'), null);
  assert.match(dom.app.textContent, /Siegesserie/, 'Klassisch’s streak card shows from two in a row, as before');
});

test('Der Tisch Pokale tab below the threshold: the crowned leader and the sentence, no podium, no streak', async (t) => {
  const dom = await pokale(t, 'tisch', round(YOUNG_ROUND_PODIUM_FROM - 1));
  assert.equal(dom.app.querySelector('.podium'), null, 'a podium off two evenings');
  const young = dom.app.querySelector('.pokale-young');
  assert.ok(young);
  assert.equal(young.querySelector('.pokale-young__lead').textContent, 'Anna führt mit 2 Siegen');
  assert.equal(young.querySelector('.pokale-young__when').textContent, PODIUM);
  const seat = young.querySelector('a.pokale-young__seat');
  assert.equal(seat.getAttribute('href'), '/round/r1/member/m1', 'the leader stays a link to their page');
  assert.equal(seat.getAttribute('aria-label'), 'Anna');
  assert.ok(seat.querySelector('.ti-crown'));
  // Everyone NOT named stays reachable, on the summary line.
  assert.deepEqual([...dom.app.querySelectorAll('.podium__rest-name')].map((e) => e.dataset.mid), ['m2', 'm3']);
  assert.doesNotMatch(dom.app.textContent, /Siegesserie/, 'a series before the sentence says series exist');
});

test('Der Tisch Pokale tab from the threshold on: the podium and the streak are back', async (t) => {
  const dom = await pokale(t, 'tisch', round(YOUNG_ROUND_PODIUM_FROM));
  assert.ok(dom.app.querySelector('.podium'));
  assert.equal(dom.app.querySelector('.pokale-young'), null);
  assert.match(dom.app.textContent, /Siegesserie/);
});

test('Der Tisch Pokale tab with no winner yet shows only the sentence', async (t) => {
  const r = round(1);
  r.sessions[0].winnerIds = [];
  const dom = await pokale(t, 'tisch', r);
  const young = dom.app.querySelector('.pokale-young');
  assert.equal(young.querySelector('.pokale-young__seat'), null);
  assert.equal(young.textContent.trim(), PODIUM);
});

// ------------------------------------------------------------- T7.2, the lobby

const summary = (over = {}) => ({
  id: 'r1', name: 'Donnerstagsrunde', members: [{ id: 'm1', name: 'Lea' }], gameCount: 3, playedCount: 0,
  background: null, marker: 2, openSessions: [], lastPlayed: null, ...over,
});

async function lobby(t, design, rounds, { accounts = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async () => rounds);
  dom.set('accountApi', async () => ({ items: [] }));
  dom.set('accountsActive', () => accounts);
  dom.set('isLoggedIn', () => true);
  dom.set('withAppConfig', () => {});
  await dom.call('showHome');
  return dom;
}

test('Klassisch one-round lobby is unchanged: no slip, no next-step card', async (t) => {
  const dom = await lobby(t, null, [summary()]);
  const card = dom.app.querySelector('.round-card:not(.round-card--new)');
  assert.deepEqual([...card.querySelector('.round-card__body').children].map((el) => el.className),
    ['round-card__name', 'round-card__meta'], 'the Klassisch tile gained a child');
  assert.equal(dom.app.querySelector('.next-step'), null);
});

test('Der Tisch one-round lobby: the invite slip on the tile and the next-step card under the grid', async (t) => {
  const dom = await lobby(t, 'tisch', [summary()]);
  const slip = dom.app.querySelector('.round-card .round-card__invite');
  assert.equal(slip.textContent, 'Lade die anderen ein — dann zählt eine Abstimmung.');
  assert.equal(slip.closest('a.round-card') !== null, true, 'text inside the tile’s one link, never a control');
  const next = dom.app.querySelector('.next-step');
  assert.equal(dom.app.querySelector('.lobby-list').nextElementSibling, next, 'right under the grid — DOM order is visual order');
  assert.equal(next.querySelector('h2').textContent, 'Nächster Schritt');
  assert.deepEqual([...next.querySelectorAll('button.next-step__row')].map((b) => b.textContent.trim()),
    ['Regal von BGG holen', 'Mitglieder einladen']);
});

test('Der Tisch next-step rows fetch the round and open the two sheets', async (t) => {
  const dom = await lobby(t, 'tisch', [summary()]);
  const seen = [];
  dom.set('fetchRoundFresh', async (rid) => ({ id: rid, full: true }));
  dom.set('showBggImport', (r) => seen.push(['bgg', r.id, r.full]));
  dom.set('showInvite', (r) => seen.push(['invite', r.id, r.full]));
  const rows = dom.app.querySelectorAll('.next-step__row');
  rows[0].click();
  rows[1].click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(seen.map((x) => [...x]), [['bgg', 'r1', true], ['invite', 'r1', true]]);
});

test('Der Tisch next-step card leaves when it has nothing to offer', async (t) => {
  const played = await lobby(t, 'tisch', [summary({ playedCount: 1 })]);
  assert.equal(played.app.querySelector('.next-step'), null, 'a round that has played is past this card');
  const two = await lobby(t, 'tisch', [summary(), summary({ id: 'r2', name: 'Zweite' })]);
  assert.equal(two.app.querySelector('.next-step, .round-card__invite'), null, 'only a ONE-round lobby');
  const shared = await lobby(t, 'tisch', [summary({ shared: true, role: 'editor' })]);
  assert.equal(shared.app.querySelector('.next-step, .round-card__invite'), null, 'a shared round’s steps are its owner’s');
  const noAccounts = await lobby(t, 'tisch', [summary()], { accounts: false });
  assert.equal(noAccounts.app.querySelector('.next-step'), null, 'neither step exists without accounts');
});

test('Der Tisch invite slip only on a round that seats its founder alone', async (t) => {
  const dom = await lobby(t, 'tisch', [summary({ members: [{ id: 'm1', name: 'Lea' }, { id: 'm2', name: 'Jo' }] })]);
  assert.equal(dom.app.querySelector('.round-card__invite'), null);
  assert.ok(dom.app.querySelector('.next-step'), 'the next steps still apply');
});

// ------------------------------------------------------------- T7.6, the demo

test('Klassisch demo hub is unchanged: the previews, no summary, no invitation', async (t) => {
  const dom = await hub(t, null, round(4), { demo: true });
  assert.equal(dom.app.querySelector('.hub-demo, .hub-card--demo-invite'), null);
  assert.equal(dom.app.querySelectorAll('.hub-preview').length, 3);
});

test('Der Tisch hub that is not a demo keeps its previews and has no invitation', async (t) => {
  const dom = await hub(t, 'tisch', round(4));
  assert.equal(dom.app.querySelector('.hub-demo, .hub-card--demo-invite'), null);
  assert.equal(dom.app.querySelectorAll('.hub-preview').length, 3);
});

test('Der Tisch demo hub: the condensed list and the invitation lead the grid, the previews go', async (t) => {
  const dom = await hub(t, 'tisch', round(4), { demo: true });
  const grid = dom.app.querySelector('.hub-cards');
  const first = grid.children[0].firstElementChild;
  const second = grid.children[1].firstElementChild;
  assert.ok(first.matches('nav.hub-demo'), 'the summary leads the grid');
  assert.ok(second.matches('.hub-card--demo-invite'), 'the invitation follows it');
  assert.equal(dom.app.querySelectorAll('.hub-preview').length, 0, 'the three previews are the list now');

  const rows = [...first.querySelectorAll('a.hub-demo__row')];
  assert.deepEqual(rows.map((a) => a.getAttribute('href')), ['/round/r1/regal', '/round/r1/chronik', '/round/r1/pokale'],
    'the three destinations the previews linked to');
  assert.deepEqual(rows.map((a) => a.querySelector('.hub-demo__value').textContent),
    ['8 Spiele', '4 Sessions', 'Anna führt']);
  assert.ok(first.getAttribute('aria-label'), 'a named navigation region');

  assert.equal(second.querySelector('h2').textContent.trim(), 'Gefällt dir das?');
  let left = 0;
  dom.set('leaveDemoForRegister', () => { left++; });
  second.querySelector('button.hub-demo__cta').click();
  assert.equal(left, 1, 'the invitation is the banner’s own exit');
});

test('the demo banner and the invitation share one exit', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/demo-account.js'), 'utf8');
  assert.match(src, /cta\.onclick = \(\) => leaveDemoForRegister\(\);/);
});
