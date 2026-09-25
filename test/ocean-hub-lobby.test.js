'use strict';

/* Ocean composes the lobby and the round hub (#1211) — O2.1/O2.5 on a phone,
 * O3.1/O3.2 at desktop, O6.1 for the phone lobby: the Reling (five links, no
 * identity, no start button), the hub as three columns around the shell with
 * the one action, the Rundenpuls as its own block, the Chronik preview as its
 * last sessions, „Nicht im Regal" as one group, and the lobby's water tiles and
 * running-session notice.
 *
 * Every one of those is a markup branch on designIs('ocean'), so the spec runs
 * the real views under Ocean and asserts the structure — and runs Klassisch on
 * the same fixtures to prove it is untouched. What jsdom cannot see (which
 * width shows which column) is pinned as CSS text at the end
 * (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');

const OCEAN_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'ocean.css'), 'utf8');

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const game = (id, extra = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4,
  createdAt: '2026-01-0' + (id % 9 + 1) + 'T10:00:00.000Z', ...extra,
});
const play = (id, gid, when, winnerIds) => ({
  id, createdAt: when, done: true, finished: true,
  gameIds: [gid], chosenGameId: gid, winnerIds, memberIds: ['m1', 'm2', 'm3'],
  votes: { m1: { [gid]: { rating: 5 } }, m2: { [gid]: { rating: 4 } } },
});

/* Anna leads with two wins, Ben has one, Cem none. Eight games so the shelf
   outgrows the Regal strip, half of them under an hour (the presets need
   something to narrow), four evenings in the last year — past
   YOUNG_ROUND_SERIES_FROM, so the Rundenpuls draws its bars — and one game in
   each off-shelf list. */
const busyRound = () => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  marker: 2,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cem' }],
  games: [
    ...Array.from({ length: 8 }, (_, i) => game(10 + i, { minPlaytime: 30, maxPlaytime: i % 2 ? 45 : 120 })),
    game(30, { retired: true }),
    game(31, { completed: true }),
    game(32, { wish: true }),
  ],
  sessions: [
    play(900, 10, ago(60), ['m1']),
    play(901, 11, ago(40), ['m1']),
    play(902, 12, ago(20), ['m2']),
    play(903, 13, ago(5), []),
  ],
  tags: [],
});

async function screen(t, design, tab = 'start', round = busyRound()) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async (method, url) => {
    if (/recommendations/.test(url)) return { recommendations: [] };
    if (/activities/.test(url)) return [];
    return round;
  });
  await dom.call('showRound', round.id, tab);
  return dom;
}

// ------------------------------------------------------------- the Reling

test('Ocean: the Reling is the five links and nothing else — no identity, no start button, no off-shelf rows', async (t) => {
  const dom = await screen(t, 'ocean');
  const rail = dom.app.querySelector('.rail');
  assert.ok(rail, 'no rail rendered');
  assert.equal(rail.querySelector('.rail__id'), null, 'the Reling carries the round identity');
  assert.equal(rail.querySelector('.rail__cta'), null, 'the Reling carries a start button (operator ruling: hub only)');
  assert.equal(rail.querySelector('.hub-presets'), null, 'the Reling carries the presets');
  assert.deepEqual(
    [...rail.querySelectorAll('.rail__item')].map((a) => a.textContent.trim()),
    ['Start', 'Regal', 'Chronik', 'Pokale', 'Einstellungen'],
  );
  assert.equal(rail.querySelector('.rail__item[aria-current="page"]').textContent.trim(), 'Start');
});

test('Ocean: the dock carries exactly the four hub sections', async (t) => {
  const dom = await screen(t, 'ocean');
  assert.deepEqual(
    [...dom.app.querySelectorAll('.dock .dock__item')].map((a) => a.textContent.trim()),
    ['Start', 'Regal', 'Chronik', 'Pokale'],
  );
});

test('Ocean: every other round screen wears the same Reling, and the Regal keeps its way off the shelf', async (t) => {
  // Pokale goes through the same renderHubTabs; its tab needs a richer fixture.
  for (const tab of ['regal', 'chronik']) {
    const dom = await screen(t, 'ocean', tab);
    const items = [...dom.app.querySelectorAll('.rail .rail__item')];
    assert.equal(items.length, 5, `${tab}: the Reling has ${items.length} entries`);
    assert.equal(dom.app.querySelector('.rail .rail__id'), null, `${tab}: the Reling grew an identity block`);
    if (tab === 'regal') {
      /* The Reling carries no off-shelf rows, so the Regal's own trigger is the
         desktop's only way to them — it must not be `rail-owned` (hidden). */
      const trigger = [...dom.app.querySelectorAll('.link-btn')].find((b) => /Nicht im Regal/.test(b.textContent));
      assert.ok(trigger, 'the Regal lost its „Nicht im Regal" trigger');
      assert.ok(!trigger.classList.contains('rail-owned'), 'the Regal\'s off-shelf trigger is hidden from 1280 up under Ocean');
    }
  }
});

test('Klassisch keeps its rail: identity, the start button and the off-shelf rows', async (t) => {
  const dom = await screen(t, null);
  const rail = dom.app.querySelector('.rail');
  assert.ok(rail.querySelector('.rail__id'), 'Klassisch lost the rail identity');
  assert.ok(rail.querySelector('.rail__cta'), 'Klassisch lost the rail start button');
  assert.ok(rail.querySelectorAll('.rail__item').length > 5, 'Klassisch lost the rail off-shelf rows');
  assert.equal(dom.app.querySelector('.ocean-hub'), null, 'Klassisch grew the Ocean frame');
  assert.ok(dom.app.querySelector('.hero').classList.contains('rail-owned'), 'Klassisch\'s hero stopped being rail-owned');
});

// ------------------------------------------------------------- the hub

test('Ocean: the hub is three columns in phone order — crew, the shell and its blocks, the previews', async (t) => {
  const dom = await screen(t, 'ocean');
  const hub = dom.app.querySelector('.ocean-hub');
  assert.ok(hub, 'no Ocean frame');
  assert.deepEqual(
    [...hub.children].map((el) => el.className.split(' ')[0]),
    ['ocean-hub__crew', 'ocean-hub__main', 'ocean-hub__aside', 'hub-offshelf', 'hub-actions'],
  );
  // One <h1> at every width: the hero keeps it and is no longer rail-owned.
  const hero = hub.querySelector('.ocean-hub__crew .hero');
  assert.ok(hero && !hero.classList.contains('rail-owned'), 'the hero would be hidden from 1280 up');
  assert.equal(dom.app.querySelectorAll('h1').length, 1, 'the hub should carry exactly one h1');
  assert.equal(hero.querySelector('h1').textContent.trim(), 'Freitagsrunde');
  assert.ok(hero.querySelector('.ocean-tide'), 'the round marker has no tide line');
});

test('Ocean: the one action is „Abtauchen" in the shell, the presets are the app\'s own strings', async (t) => {
  const dom = await screen(t, 'ocean');
  const main = dom.app.querySelector('.ocean-hub__main');
  const cta = main.querySelector('.ocean-shell > .hub-cta');
  assert.ok(cta, 'the start button is not in the shell');
  assert.equal(cta.textContent.trim(), 'Abtauchen');
  assert.ok(!cta.classList.contains('rail-owned'), 'the start button would be hidden from 1280 up');
  assert.equal(dom.app.querySelectorAll('.hub-cta, .rail__cta').length, 1, 'the one action is on screen twice');
  const presets = main.querySelector('.hub-presets');
  assert.ok(presets && !presets.classList.contains('rail-owned'), 'the presets are missing or rail-owned');
  const labels = dom.run(`['short','light','meaty','family'].map((k) => t('hub.preset.' + k))`);
  for (const chip of presets.querySelectorAll('.hub-preset')) {
    assert.ok(labels.includes(chip.textContent.trim()), `„${chip.textContent.trim()}" is not an app preset string`);
  }
});

test('Ocean: the crew captions every seat with its name, and the win count beside those who have one', async (t) => {
  const dom = await screen(t, 'ocean');
  const seats = [...dom.app.querySelectorAll('.ocean-hub .hero__members > a.avatar')];
  assert.deepEqual(seats.map((s) => s.querySelector('.seat__name').textContent), ['Anna', 'Ben', 'Cem']);
  assert.deepEqual(seats.map((s) => (s.querySelector('.seat__wins') || { textContent: '' }).textContent),
    ['2 Siege', '1 Sieg', '']);
  assert.ok(seats[0].querySelector('.seat__wins .ti-crown'), 'the leader carries no crown');
  assert.equal(dom.app.querySelector('.ocean-hub .avatar--add .seat__name').textContent, 'Platz dazu');
});

test('Ocean: the Rundenpuls is its own titled block with all three lines, and the Chronik preview shows sessions', async (t) => {
  const dom = await screen(t, 'ocean');
  const main = dom.app.querySelector('.ocean-hub__main');
  const pulse = [...main.querySelectorAll('.hub-card')]
    .find((c) => c.querySelector('.hub-card__title').textContent.trim() === 'Rundenpuls');
  assert.ok(pulse, 'no block titled „Rundenpuls" in the centre column');
  assert.ok(pulse.querySelector('.pulse-bars'), 'the Rundenpuls lost its monthly bars');
  assert.match(pulse.textContent, /4 Sessions in 12 Monaten · Vor 5 Tagen gespielt/);
  assert.match(pulse.textContent, /4 von 8 Spielen waren noch nie dran/);

  const aside = dom.app.querySelector('.ocean-hub__aside');
  const chronik = [...aside.querySelectorAll('.hub-preview')]
    .find((c) => c.querySelector('.hub-card__title').textContent.trim() === 'Chronik');
  assert.ok(chronik, 'no Chronik preview in the preview column');
  assert.equal(chronik.querySelector('.pulse-bars'), null, 'the Chronik preview shows the pulse bars (review round 1)');
  assert.deepEqual([...chronik.querySelectorAll('.hub-preview__session .hub-preview__name')].map((n) => n.textContent),
    ['Spiel 13', 'Spiel 12', 'Spiel 11'], 'the Chronik preview is not its last three sessions, newest first');
  // Rows inside a preview are never links — its one link is at the foot.
  assert.equal(chronik.querySelectorAll('a').length, 1);
});

test('Ocean: „Zuletzt gespielt" sits in the pair under the shell, the previews and Kümmerliste in the aside', async (t) => {
  const dom = await screen(t, 'ocean');
  const pair = dom.app.querySelector('.ocean-hub__main .ocean-pair');
  assert.ok(pair, 'no pair under the shell');
  assert.ok(pair.querySelector('.ticket'), 'the last-played card is not in the pair');
  const aside = dom.app.querySelector('.ocean-hub__aside');
  assert.deepEqual([...aside.querySelectorAll(':scope > .hub-preview .hub-card__title')].map((h) => h.textContent.trim()),
    ['Regal', 'Pokale', 'Chronik']);
  const bars = aside.querySelectorAll('.hub-preview__bar');
  assert.ok(bars.length >= 2, 'the Pokale preview draws no standings bars');
  assert.equal(bars[0].style.getPropertyValue('--share'), '100%', 'the leader\'s bar is not the full length');
});

test('Ocean: „Nicht im Regal" is one heading over the three lists and „Könnte euch gefallen", at every width', async (t) => {
  const dom = await screen(t, 'ocean');
  const groups = dom.app.querySelectorAll('.hub-offshelf');
  assert.equal(groups.length, 1);
  const group = groups[0];
  assert.ok(!group.classList.contains('rail-owned'), 'the group would vanish from 1280 up, where the Reling has no rows');
  assert.equal(group.querySelectorAll('.hub-offshelf__title').length, 1);
  assert.equal(group.querySelector('.hub-offshelf__title').textContent, 'Nicht im Regal');
  const rows = [...group.querySelectorAll('.off-shelf__row')].map((r) => r.textContent.trim());
  assert.equal(rows.length, 4);
  assert.match(rows[3], /Könnte euch gefallen/);
});

// ------------------------------------------------------------- the lobby

const summary = (extra = {}) => ({
  id: 'r1', name: 'Donnerstagsrunde', marker: 2, background: null,
  members: [{ id: 'm1', name: 'Marco' }, { id: 'm2', name: 'Jonas' }],
  gameCount: 12, playedCount: 23,
  lastPlayed: { gameTitle: 'Nordlichter', winnerNames: ['Jonas'], at: ago(3) },
  openSessions: [],
  ...extra,
});

async function lobby(t, design, rounds) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('accountsActive', () => false);
  dom.set('api', async () => rounds);
  await dom.call('showHome');
  return dom;
}

test('Ocean lobby: the greeting and the sub-brand, the question line unchanged', async (t) => {
  const dom = await lobby(t, 'ocean', [summary()]);
  assert.equal(dom.app.querySelector('.lobby-head h1').textContent, 'Willkommen an der Küste.');
  assert.equal(dom.app.querySelector('.lobby-head__sub').textContent, 'Welche Runde spielt heute?');
  assert.equal(dom.document.querySelector('.topbar__context').textContent, 'Die Küste · deine Runden');
});

test('Ocean lobby: a tile is water with the seats on the tide line, and one link', async (t) => {
  const dom = await lobby(t, 'ocean', [summary({ openSessions: [{ id: 's1', stage: 'voting', at: ago(0) }] })]);
  const tile = dom.app.querySelector('.round-card--ocean');
  assert.ok(tile, 'no Ocean tile');
  assert.match(tile.getAttribute('style'), /--marker:/, 'the tile does not carry its marker');
  assert.ok(tile.querySelector('.round-card__water .round-card__tide'), 'no tide line');
  assert.equal(tile.querySelectorAll('.round-card__water .avatar').length, 2);
  assert.equal(tile.querySelector('.round-card__live').textContent, 'Abstimmung läuft');
  assert.match(tile.querySelector('.round-card__stats').textContent, /12 Spiele · 23 Sessions/);
  assert.equal(tile.querySelectorAll('a, button').length, 0, 'a control nested inside the tile link');
});

test('Ocean lobby: a running vote is a notice naming the round, linking to the session', async (t) => {
  const dom = await lobby(t, 'ocean', [summary({ openSessions: [{ id: 's1', stage: 'voting', at: ago(0) }] })]);
  const notice = dom.app.querySelector('.home-resume .ocean-notice');
  assert.ok(notice, 'no notice for the running vote');
  assert.equal(dom.app.querySelector('.home-resume .ticket'), null, 'the Klassisch ticket rendered beside it');
  assert.equal(notice.querySelector('.ocean-notice__kicker').textContent, 'Abstimmung läuft');
  assert.equal(notice.querySelector('.ocean-notice__title').textContent, 'Donnerstagsrunde');
  assert.match(notice.getAttribute('href'), /\/round\/r1\/session\/s1$/);
});

test('Klassisch lobby is untouched: its greeting, its tile, no kicker', async (t) => {
  const dom = await lobby(t, null, [summary()]);
  assert.equal(dom.app.querySelector('.lobby-head h1').textContent, 'Schön, dass ihr da seid.');
  assert.equal(dom.app.querySelector('.round-card--ocean'), null);
  assert.ok(dom.app.querySelector('.round-card .round-card__emblem'), 'Klassisch lost its emblem');
  assert.equal(dom.document.querySelector('.topbar__context').textContent, '');
});

// ------------------------------------------------------------- the CSS half

test('ocean.css: the #1211 section lays out the Reling at 104px and the hub as 250 / free / 320 from 1280', () => {
  const at = OCEAN_CSS.indexOf('/* ===== #1211 — ');
  assert.ok(at > 0, 'the #1211 section header is missing');
  const own = OCEAN_CSS.slice(at);
  const wide = own.split('@media (min-width: 1280px)').slice(1).join('\n');
  assert.match(wide, /\.rail \{[^}]*width: 104px/);
  assert.match(wide, /grid-template-columns: 250px minmax\(0, 1fr\) 320px/);
  // The dock below 860 is four equal targets of the O1 control size.
  assert.match(own, /@media \(max-width: 859px\)[\s\S]*?\.dock__item \{[^}]*flex: 1;[^}]*min-height: 56px/);
});
