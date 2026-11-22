'use strict';

/* The young-round features (#1280, T7.2 / T7.5 / T7.6), built for Der Tisch
 * and moved to every design by #1318 where they are app features rather than
 * paint:
 *
 *   - T7.5: until the third played session the Rundenpuls carries a sentence
 *     instead of series, the Pokale streak card waits, and the podium on the
 *     Pokale tab becomes the leader plus „Ein Podium braucht 3 Sessions.";
 *   - T7.2: a one-round lobby gets an invite slip on the tile and a
 *     „Nächster Schritt" card under the grid;
 *   - T7.6: the demo's hub carries the „Gefällt dir das?" invitation.
 *
 * #1853 took the previews, the condensed demo list and the Rundenpuls off the
 * Start tab; the pulse card itself lives on in the Chronik head (#1852,
 * round-head-lines.js), so its thresholds are pinned on the card directly.
 *
 * Since #1318 the thresholds and the next-step card hold under every design,
 * and the demo invitation too; only the invite slip on the lobby tile stays
 * Tisch composition. So each screen is rendered under
 * Klassisch AND Der Tisch through the real view. The two thresholds are pinned
 * twice as well — by
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

// ----------------------------------------------- T7.5, the Rundenpuls card

/* The card the Chronik head folds (round-head-lines.js), rendered on its own
   under each design: the hub no longer draws it (#1853). */
function pulseCardOf(t, design, r) {
  const dom = boot(t, design, r);
  const card = dom.call('hubPulseCard', r, r.games);
  return { dom, card };
}

test('Klassisch pulse after one session: the facts plus the series sentence, no bars (#1318, #1586)', (t) => {
  const { card: pulse } = pulseCardOf(t, null, round(1));
  assert.equal(pulse.classList.contains('hub-card--sentence'), false, 'a played round gets its facts, not the sentence card');
  assert.equal(pulse.querySelector('.pulse-bars'), null, 'Klassisch’s bar chart waits for three sessions');
  assert.equal(pulse.querySelector('.hub-card__facts:not(.hub-card__threshold)').textContent,
    '1 Session in 12 Monaten · Vor 3 Tagen gespielt');
  const coverage = pulse.querySelector('a.hub-row');
  assert.equal(coverage.textContent.trim(), '7 von 8 Spielen waren noch nie dran');
  assert.equal(coverage.getAttribute('href'), '/round/r1/regal', 'the coverage link reaches the Regal');
  assert.equal(pulse.querySelector('.hub-card__body').lastElementChild.textContent, SERIES,
    'the series sentence closes the card, after the facts');
});

test('Klassisch pulse at two sessions: facts plus the series sentence, and the bar chart waits for three (#1318, #1586)', (t) => {
  const { card: pulse } = pulseCardOf(t, null, round(YOUNG_ROUND_SERIES_FROM - 1));
  assert.ok(pulse, 'a played round still gets the card');
  assert.equal(pulse.querySelector('.pulse-bars'), null, 'no bar chart off two evenings');
  assert.match(pulse.textContent, /2 Sessions in 12 Monaten/, 'the facts are stated before the series');
  assert.equal(pulse.querySelector('.hub-card__threshold').textContent, SERIES, 'the sentence names the threshold');
  const { card: drawn } = pulseCardOf(t, null, round(YOUNG_ROUND_SERIES_FROM));
  assert.ok(drawn.querySelector('.pulse-bars'), 'the bars arrive at three');
  assert.equal(drawn.querySelector('.hub-card__threshold'), null);
});

test('Der Tisch pulse after one session: real pulse tiles plus the series sentence', (t) => {
  const { card: pulse } = pulseCardOf(t, 'tisch', round(1));
  assert.ok(pulse, 'Der Tisch draws the pulse from the first session');
  assert.equal(pulse.querySelector('.pulse-tile__n').textContent, '1');
  assert.equal(pulse.querySelector('.hub-card__threshold').textContent, SERIES);
  assert.equal(pulse.lastElementChild.querySelector(':scope > .hub-card__threshold') !== null, true,
    'the sentence closes the card, after the figures');
});

test('Der Tisch pulse: the series sentence stays until the third session and then goes', (t) => {
  assert.ok(pulseCardOf(t, 'tisch', round(YOUNG_ROUND_SERIES_FROM - 1)).card.querySelector('.hub-card__threshold'));
  assert.equal(pulseCardOf(t, 'tisch', round(YOUNG_ROUND_SERIES_FROM)).card.querySelector('.hub-card__threshold'), null);
});

/* #1586: the facts are content, so every design states them from the first
   played session — each in its own form — and only the bars wait. The series
   sentence closes the card wherever the design does not say it elsewhere: the
   Programmheft says it in its hub lead story. No design draws bars before
   three (#1586 merge interview, 2026-10-07, the Programmheft included). */
const SERIES_ELSEWHERE = new Set(['programmheft']);

for (const design of ['klassisch', 'tisch', 'ocean', 'bruecke', 'programmheft', 'forest']) {
  for (const n of [1, YOUNG_ROUND_SERIES_FROM - 1]) {
    test(`${design} pulse at ${n} played session(s): the three facts, the Regal link, the series sentence once (#1586)`, (t) => {
      const { card: pulse } = pulseCardOf(t, design, round(n));
      assert.ok(pulse, 'no Rundenpuls on a played round');
      assert.equal(pulse.classList.contains('hub-card--sentence'), false, 'the sentence card stands in for the facts');
      const said = pulse.textContent.replace(/\s+/g, ' ');
      assert.match(said, new RegExp(`${n} ?Sessions? in 12 Monaten`), 'the session count is missing');
      assert.match(said, /3 ?Tage(n)? (her|gespielt)/, 'the days since the last session are missing');
      assert.match(said, new RegExp(`${8 - n} ?(von 8 Spielen waren noch nie dran|ungespielt)`), 'the never-played count is missing');
      assert.ok(pulse.querySelector('a[href="/round/r1/regal"]'), 'the coverage link no longer reaches the Regal');
      assert.equal(pulse.querySelector('.pulse-bars'), null, 'the bars wait for three sessions');
      const inCard = pulse.querySelector('.hub-card__threshold');
      if (SERIES_ELSEWHERE.has(design)) {
        assert.equal(inCard, null, `${design} says the series sentence twice`);
      } else {
        assert.equal(inCard.textContent, SERIES);
        assert.equal(pulse.querySelector('.hub-card__body').lastElementChild, inCard, 'the sentence closes the card');
      }
    });
  }
}

test('the Start tab draws no Rundenpuls and no Pokale preview in any design (#1853)', async (t) => {
  for (const design of ['klassisch', 'tisch', 'ocean', 'bruecke', 'programmheft', 'forest']) {
    const dom = await hub(t, design, round(4));
    assert.equal(cardByTitle(dom, 'Rundenpuls'), undefined, `${design} still draws the pulse on Start`);
    assert.equal(dom.app.querySelector('.hub-preview, .pulse-bars, .pulse-tile'), null, `${design} still draws a preview`);
    // Anti-vacuous: the hub did render.
    assert.ok(dom.app.querySelector('.hub-cta'), `${design}: no hub rendered`);
  }
});

test('Klassisch Pokale tab below the threshold: the crowned leader and the sentence, no podium, no streak (#1318)', async (t) => {
  const dom = await pokale(t, null, round(YOUNG_ROUND_PODIUM_FROM - 1));
  assert.equal(dom.app.querySelector('.podium'), null, 'a podium off two evenings');
  const young = dom.app.querySelector('.pokale-young');
  assert.ok(young, 'Klassisch names the leader too');
  assert.equal(young.querySelector('.pokale-young__lead').textContent, 'Anna führt mit 2 Siegen');
  assert.equal(young.querySelector('.pokale-young__when').textContent, PODIUM);
  assert.equal(young.querySelector('a.pokale-young__seat').getAttribute('href'), '/round/r1/member/m1');
  assert.deepEqual([...dom.app.querySelectorAll('.podium__rest-name')].map((e) => e.dataset.mid), ['m2', 'm3'],
    'everyone not named stays reachable');
  assert.doesNotMatch(dom.app.textContent, /Siegesserie/, 'the streak waits for the series threshold');
});

test('Klassisch Pokale tab from the threshold on: the podium and the streak are back', async (t) => {
  const dom = await pokale(t, null, round(YOUNG_ROUND_PODIUM_FROM));
  assert.ok(dom.app.querySelector('.podium'));
  assert.equal(dom.app.querySelector('.pokale-young'), null);
  assert.match(dom.app.textContent, /Siegesserie/);
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

test('Klassisch one-round lobby: the next-step card under the grid, but no Tisch slip on the tile (#1318)', async (t) => {
  const dom = await lobby(t, null, [summary()]);
  const card = dom.app.querySelector('.round-card:not(.round-card--new)');
  assert.deepEqual([...card.querySelector('.round-card__body').children].map((el) => el.className),
    ['round-card__name', 'round-card__meta'], 'the invite slip is Der Tisch’s paper, out of scope for Klassisch');
  const next = dom.app.querySelector('.next-step');
  assert.ok(next, 'Klassisch shows the next steps too');
  assert.equal(dom.app.querySelector('.lobby-list').nextElementSibling, next, 'right under the grid');
  assert.equal(next.querySelector('h2').textContent, 'Nächster Schritt');
  assert.deepEqual([...next.querySelectorAll('button.next-step__row')].map((b) => b.textContent.trim()),
    ['Regal von BGG holen', 'Mitglieder einladen']);
});

test('Klassisch next-step rows open the two sheets, and the card keeps the same gates', async (t) => {
  const dom = await lobby(t, null, [summary()]);
  const seen = [];
  dom.set('fetchRoundFresh', async (rid) => ({ id: rid, full: true }));
  dom.set('showBggImport', (r) => seen.push(['bgg', r.id, r.full]));
  dom.set('showInvite', (r) => seen.push(['invite', r.id, r.full]));
  for (const row of dom.app.querySelectorAll('.next-step__row')) row.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(seen.map((x) => [...x]), [['bgg', 'r1', true], ['invite', 'r1', true]]);

  const played = await lobby(t, null, [summary({ playedCount: 1 })]);
  assert.equal(played.app.querySelector('.next-step'), null, 'a round that has played is past this card');
  const two = await lobby(t, null, [summary(), summary({ id: 'r2', name: 'Zweite' })]);
  assert.equal(two.app.querySelector('.next-step'), null, 'only a ONE-round lobby');
  const shared = await lobby(t, null, [summary({ shared: true, role: 'editor' })]);
  assert.equal(shared.app.querySelector('.next-step'), null, 'a shared round’s steps are its owner’s');
  const noAccounts = await lobby(t, null, [summary()], { accounts: false });
  assert.equal(noAccounts.app.querySelector('.next-step'), null, 'neither step exists without accounts');
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

for (const design of [null, 'tisch']) {
  const name = design ? 'Der Tisch' : 'Klassisch';
  test(`${name} demo hub: the invitation leads the grid, and nothing condenses the gone previews (#1318, #1853)`, async (t) => {
    const dom = await hub(t, design, round(4), { demo: true });
    const grid = dom.app.querySelector('.hub-cards');
    const first = grid.children[0].firstElementChild;
    assert.ok(first.matches('.hub-card--demo-invite'), 'the invitation leads the grid');
    assert.equal(first.querySelector('h2').textContent.trim(), 'Gefällt dir das?');
    assert.equal(dom.app.querySelector('.hub-demo, .hub-preview'), null, 'a preview or its condensed list is back');
    let left = 0;
    dom.set('leaveDemoForRegister', () => { left++; });
    first.querySelector('button.hub-demo__cta').click();
    assert.equal(left, 1, 'the invitation is the banner’s own exit');
  });

  test(`${name} hub that is not a demo has no invitation`, async (t) => {
    const dom = await hub(t, design, round(4));
    assert.equal(dom.app.querySelector('.hub-demo, .hub-card--demo-invite'), null);
    assert.ok(dom.app.querySelector('.hub-cta'), 'no hub rendered');
  });
}

test('the demo banner and the invitation share one exit', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/demo-account.js'), 'utf8');
  assert.match(src, /cta\.onclick = \(\) => leaveDemoForRegister\(\);/);
});
