'use strict';

/* Forest composes the lobby, the round hub and the shared chrome (#1466) —
 * F3.1/F3.2 at desktop, F2.1/F6.1 on a phone, the Kopf, Telefonkopf, Dock and
 * Fuß sheets. Every one of those is a markup branch on designIs('forest') or a
 * rule in forest.css, so the spec runs the real views under the design and
 * asserts the F3.2 checklist block by block — and pins Klassisch's rendered DOM
 * against the signature captured before #1372 touched these screens
 * (test/fixtures/klassisch-hub-lobby.json, shared with
 * test/programmheft-hub-lobby.test.js), so a Forest branch that leaks into the
 * default path goes red naming the screen.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { domSignature } = require('./support/dom-signature');
const { rulesOf, mediaBlocks, outranks } = require('./support/css');

const FIXTURE = path.join(__dirname, 'fixtures', 'klassisch-hub-lobby.json');
const FOREST_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'forest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

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

// The same round test/programmheft-hub-lobby.test.js renders: Anna leads with
// two wins, Ben has one, Cem none; eight active games, four evenings.
const busyRound = () => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  marker: 0,
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
const youngRound = () => ({ ...busyRound(), games: [], sessions: [] });

async function hub(t, design, tab = 'start', round = busyRound()) {
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

const precedes = (dom, a, b) =>
  Boolean(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);

// ------------------------------------------------------------- Klassisch

const KLASSISCH_SCREENS = {
  'hub start (busy)': (t) => hub(t, null),
  'hub start (no games)': (t) => hub(t, null, 'start', youngRound()),
  'hub regal': (t) => hub(t, null, 'regal'),
  'lobby (running vote)': (t) => lobby(t, null, [
    summary({ openSessions: [{ id: 's1', stage: 'voting', at: ago(0) }] }),
    summary({ id: 'r2', name: 'Sonntagsrunde', lastPlayed: null }),
  ]),
  'lobby (empty)': (t) => lobby(t, null, []),
};

test('Klassisch: the hub and the lobby still render the DOM they rendered before #1466', async (t) => {
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(Object.keys(KLASSISCH_SCREENS), Object.keys(want), 'the screens drifted from the shared fixture');
  for (const [name, render] of Object.entries(KLASSISCH_SCREENS)) {
    const dom = await render(t);
    const got = domSignature(dom.app);
    assert.ok(got.length > 10, `${name}: only ${got.length} elements — did the render fail?`);
    assert.equal(dom.app.querySelector('[class*="forest-"], .round-card--forest, .rail__count, .seat__ring'), null,
      `${name}: a Forest element leaked into Klassisch`);
    assert.deepEqual(got, want[name], `${name}: Klassisch's DOM changed`);
  }
});

test('Klassisch: the account button keeps its person glyph', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.run("accountUser = { username: 'ada' }; renderAccountFace()");
  const btn = dom.document.getElementById('accountBtn');
  assert.ok(btn.querySelector('.ti-user'), 'Klassisch lost the person glyph');
  assert.equal(btn.querySelector('.topbar__avatar'), null);
});

// ---------------------------------------------------------------- Forest

test('Forest hub: the F3.2 checklist, block by block, in reading order', async (t) => {
  const dom = await hub(t, 'forest');
  const root = dom.app.querySelector('.forest-hub');
  assert.ok(root, 'no Forest frame');
  const col = (name) => root.querySelector(`:scope > .forest-hub__${name}`);
  assert.equal(dom.app.querySelectorAll('h1').length, 1, 'the Start tab must keep exactly one <h1>');

  // Die Leute: ribbon, the name, the line under it, Einstellungen, the members.
  const hero = col('crew').querySelector('.hero');
  assert.ok(hero && !hero.classList.contains('rail-owned'), 'the head would be hidden from 1280 up');
  assert.ok(hero.querySelector('.forest-ribbon[aria-hidden="true"]'), 'no ribbon marker beside the name');
  assert.equal(hero.querySelector('.forest-ribbon').textContent, '', 'the ribbon carries text (rule T2)');
  assert.match(hero.querySelector('h1').textContent, /Freitagsrunde/);
  assert.match(hero.querySelector('.forest-head__since').textContent, /^Runde seit Januar 2026 · Marker Tanne$/);
  const settings = hero.querySelector('a.forest-head__settings');
  assert.match(settings.getAttribute('href'), /\/round\/r1\/settings$/);
  assert.equal(settings.textContent.trim(), 'Einstellungen', 'the gear lost its accessible name');
  assert.equal(hero.querySelector('.forest-members__label').textContent, 'Mitglieder · 3');
  const seats = [...hero.querySelectorAll('.hero__members > a.avatar:not(.avatar--retired)')];
  assert.deepEqual(seats.map((s) => s.querySelector('.seat__name').textContent), ['Anna', 'Ben', 'Cem']);
  assert.equal(seats[0].querySelector('.seat__wins').textContent, '2 Siege');
  assert.equal(seats[2].querySelector('.seat__wins'), null, 'a zero is not printed');
  assert.match(seats[0].querySelector('.seat__ring').getAttribute('style'), /background/, 'the member colour left the ring');
  assert.doesNotMatch(seats[0].getAttribute('style') || '', /background/, 'the link kept the colour — it would fill the caption');
  assert.ok(hero.querySelector('.avatar--add .seat__ring'), '„Platz dazu" lost its ring');

  // Der Baumstumpf: „Session wirbeln" inside it, the labelled quick-start row.
  const main = col('main');
  const cta = main.querySelector('.forest-stump > .hub-cta');
  assert.ok(cta && !cta.classList.contains('rail-owned'), 'the start button left the stump or hides from 1280');
  assert.match(cta.textContent, /Session wirbeln/, 'E1: the hub button stays „Session wirbeln"');
  const presets = main.querySelector('.hub-presets');
  assert.ok(presets && !presets.classList.contains('rail-owned'));
  assert.equal(presets.firstElementChild.className, 'forest-quick__label');
  assert.equal(presets.firstElementChild.getAttribute('aria-hidden'), 'true', 'the group is named already');
  assert.ok(presets.querySelectorAll('.hub-preset').length <= 3, 'more than three presets');

  // Zuletzt gespielt — ONE link to the last result — beside „Wie wär's mit".
  const last = main.querySelector('.forest-pair > a.forest-last');
  assert.ok(last, 'no „Zuletzt gespielt" card');
  assert.match(last.getAttribute('href'), /903/);
  assert.match(last.querySelector('.forest-last__kicker').textContent, /^Zuletzt gespielt · /);
  assert.equal(last.querySelector('.forest-last__title').textContent, 'Spiel 13');
  assert.match(last.querySelector('.forest-last__open').textContent, /Ergebnis ansehen/);
  assert.equal(last.querySelectorAll('a').length, 0, 'a link inside the card link');
  assert.equal(dom.app.querySelector('.ticket'), null, 'the Klassisch ticket rendered beside the card');
  assert.ok(precedes(dom, main.querySelector('.forest-stump'), last), 'the stump must come first');

  // Rechts: the previews, then the Rundenpuls and the Kümmerliste.
  const aside = col('aside');
  const hrefs = [...aside.querySelectorAll('.hub-card__go')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs.slice(0, 3), ['/round/r1/regal', '/round/r1/pokale', '/round/r1/chronik']);
  assert.ok(aside.querySelector('.pulse-bars'), 'the Rundenpuls left the right column');
  assert.equal(dom.app.querySelector('.hub-cards .pulse-bars'), null, 'the Rundenpuls rendered twice');
  // A card handed to two hosts lands in the second and leaves an empty slot in
  // the first — the grid would keep a gap where the pulse used to be.
  assert.equal(dom.app.querySelector('.hub-cards > .card-slot:empty'), null, 'an empty slot in the card grid');

  // Nicht im Regal reachable; the quiet actions stay in the DOM.
  const off = root.querySelector(':scope > .hub-offshelf');
  assert.equal(off.querySelectorAll('.off-shelf__row').length, 4, 'an off-shelf destination is unreachable');
  const order = [col('crew'), col('main'), col('aside'), off, root.querySelector(':scope > .hub-actions')];
  for (let i = 1; i < order.length; i++) assert.ok(precedes(dom, order[i - 1], order[i]), `block ${i} is out of order`);
  assert.equal(dom.app.querySelector('.empty--rail-gap'), null);
});

test('Forest hub: a session without a winner says how it ended, and the grove names its leader', async (t) => {
  const dom = await hub(t, 'forest');
  const result = dom.app.querySelector('.forest-last__result');
  assert.ok(!result.classList.contains('forest-last__result--won'));
  assert.equal(result.querySelector('.ti-crown'), null, 'a crown over an evening nobody won');
  const round = busyRound();
  round.sessions.push(play(904, 14, ago(1), ['m2', 'm3']));
  const dom2 = await hub(t, 'forest', 'start', round);
  const won = dom2.app.querySelector('.forest-last__result--won');
  assert.equal(won.textContent, 'Ben und Cem haben gewonnen');
  const pokale = dom.app.querySelector('.hub-card__go[href$="/pokale"]').closest('.hub-preview');
  assert.equal(pokale.querySelector('.hub-preview__sub').textContent, 'Anna führt');
  assert.ok(pokale.querySelectorAll('.hub-preview__bar').length >= 1, 'the grove has no trees');
});

// Since #1471 (F7.3) the empty stump shows only its rings and the empty table
// stands UNDER it — test/forest-states.test.js owns that state in full.
test('Forest hub: a round without games shows the empty stump and the empty table', async (t) => {
  const dom = await hub(t, 'forest', 'start', youngRound());
  assert.ok(dom.app.querySelector('.forest-stump--empty'), 'the empty stump is gone');
  assert.ok(dom.app.querySelector('.forest-hub__main .forest-stump + .empty--table'), 'the empty table is not under the stump');
  assert.equal(dom.app.querySelector('.forest-pair'), null, 'an empty pair wrapper stayed behind');
  assert.equal(dom.app.querySelector('.forest-head__since').textContent, 'Marker Tanne', 'a round with nothing dated invents a month');
});

test('Forest rail: the Wegweiser is the five links, with the Regal and Chronik counts', async (t) => {
  for (const tab of ['start', 'regal']) {
    const dom = await hub(t, 'forest', tab);
    const rail = dom.app.querySelector('.rail');
    assert.equal(rail.querySelector('.rail__id'), null, `${tab}: the Wegweiser carries the identity`);
    assert.equal(rail.querySelector('.rail__cta, button'), null, `${tab}: the Wegweiser carries a button`);
    const items = [...rail.querySelectorAll('.rail__item')];
    assert.equal(items.length, 5, `${tab}: not five links`);
    const counts = items.map((a) => (a.querySelector('.rail__count') || {}).textContent || '');
    assert.deepEqual(counts, ['', '8', '4', '', ''], `${tab}: the counts are wrong`);
    assert.ok(items.every((a) => !a.querySelector('.rail__count') || a.querySelector('.rail__count').getAttribute('aria-hidden') === 'true'));
  }
});

test('Forest Kopf: the account wears its ring and its name', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run('applyDesign("forest")');
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.run("accountUser = { username: 'ada' }; renderAccountFace()");
  const btn = dom.document.getElementById('accountBtn');
  assert.ok(btn.querySelector('.topbar__avatar'), 'no ring in the Kopf');
  assert.equal(btn.querySelector('.topbar__name').textContent, 'ada');
});

test('Forest lobby: the sub-brand, the greeting, the Leuchtzeichen and the clearings', async (t) => {
  const dom = await lobby(t, 'forest', [
    summary({ openSessions: [{ id: 's1', stage: 'voting', at: ago(0) }] }),
    summary({ id: 'r2', name: 'Sonntagsrunde', lastPlayed: null }),
  ]);
  assert.equal(dom.document.querySelector('#context').textContent, 'Der Wald · deine Lichtungen');
  assert.equal(dom.app.querySelector('.lobby-head h1').textContent, 'Willkommen zurück im Wald.');
  assert.equal(dom.app.querySelector('.lobby-head__sub').textContent, 'Welche Runde spielt heute?');
  const notice = dom.app.querySelector('a.forest-notice');
  assert.ok(notice, 'no Leuchtzeichen for the running vote');
  assert.equal(notice.querySelector('.forest-notice__kicker').textContent, 'Leuchtzeichen');
  assert.match(notice.querySelector('.forest-notice__title').textContent, /^Abstimmung läuft · Donnerstagsrunde$/);
  assert.match(notice.querySelector('.forest-notice__go').textContent, /Jetzt abstimmen/);
  assert.equal(dom.app.querySelector('.ticket'), null);
  const tiles = [...dom.app.querySelectorAll('a.round-card--forest')];
  assert.deepEqual(tiles.map((c) => c.querySelector('.round-card__name').textContent), ['Donnerstagsrunde', 'Sonntagsrunde']);
  assert.ok(tiles[0].getAttribute('style').includes('--marker'), 'the tile lost its marker');
  assert.equal(tiles[0].querySelector('.round-card__ribbon').textContent, '', 'the ribbon carries text');
  assert.equal(tiles[0].querySelector('.round-card__live').textContent, 'Abstimmung läuft');
  assert.equal(tiles[1].querySelector('.round-card__live'), null);
  assert.match(tiles[0].querySelector('.round-card__last').textContent, /Nordlichter — Jonas hat gewonnen/);
  assert.equal(tiles[1].querySelector('.round-card__last-wrap'), null, 'an empty last-played block');
  assert.ok(dom.app.querySelector('a.round-card--new'), 'the new-round tile is unreachable');
  assert.equal(dom.app.querySelectorAll('h1').length, 1);
});

test('Forest lobby: the first visit is welcomed, not welcomed back', async (t) => {
  const dom = await lobby(t, 'forest', []);
  assert.equal(dom.app.querySelector('.lobby-head h1').textContent, 'Willkommen im Wald.');
});

// ------------------------------------------------------------ the CSS

/* jsdom applies no stylesheet, so the chrome's decisions are held as CSS text;
   each override is checked to OUTRANK the rule it replaces, since a tie would
   be settled by source order across two files. */
const block = (query) => {
  const hits = mediaBlocks(FOREST_CSS).filter(([q]) => q.includes(query));
  assert.ok(hits.length, `no @media block for ${query} in forest.css`);
  return hits.flatMap(([, body]) => rulesOf(body));
};
const ruleWith = (rules, part, decl) => {
  const hit = rules.find(([sel, body]) => sel.includes(part) && decl.test(body));
  assert.ok(hit, `no rule for ${part} declaring ${decl}`);
  return hit[0].split(',').map((s) => s.trim()).find((s) => s.includes(part));
};
const topLevel = rulesOf(FOREST_CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''));

test('Forest chrome: the phone dock is shown on the result screen, with no entry lit', () => {
  const sel = ruleWith(block('max-width: 859px'), '.result-screen) .dock.dock--sub', /display:\s*grid/);
  assert.ok(outranks(sel, '.dock--sub'), 'the result-screen dock loses to styles.css\'s `.dock--sub { display: none }`');
  const unlit = ruleWith(topLevel, '.result-screen) .dock .dock__item.is-active', /background:\s*transparent/);
  const lit = ruleWith(topLevel, '.dock .dock__item.is-active', /background:\s*var\(--brand\)/);
  assert.ok(outranks(unlit, lit), 'the result screen still lights its owning section');
});

test('Forest chrome: from 1280 the Wegweiser runs above a one-column page, the hub uncapped', () => {
  const wide = block('min-width: 1280px');
  ruleWith(wide, '.app:has(.rail)', /grid-template-columns:\s*minmax\(0, 1fr\);/);
  ruleWith(wide, '.app:has(.rail) > .rail', /flex-direction:\s*row/);
  const content = ruleWith(wide, '.app:has(.rail) > *:not(.rail)', /grid-column:\s*1;/);
  assert.ok(outranks(content, '.app:has(.rail) > *:not(.rail)'));
  const hub = ruleWith(wide, '.app > .forest-hub', /max-width:\s*none/);
  assert.ok(outranks(hub, '.app > *:not(.rail):not(.dock)'), 'the hub stays capped at the reading measure');
});

test('Forest chrome: the Telefonkopf keeps its wordmark and drops the context line', () => {
  const phone = block('max-width: 520px');
  const word = ruleWith(phone, '.topbar__word', /display:\s*inline/);
  assert.ok(outranks(word, '.topbar__word'), 'styles.css still hides the wordmark on a phone');
  ruleWith(phone, '.topbar__context', /display:\s*none/);
});

test('Forest: the card titles in Young Serif outrank the Alegreya reset list', () => {
  const reset = /(:root\[data-design="forest"\] :is\([\s\S]*?\))\s*\{\s*font-family:\s*var\(--font\);/.exec(FOREST_CSS);
  assert.ok(reset, 'no Alegreya reset list');
  const title = ruleWith(topLevel, '.hub-card__title', /font-family:\s*var\(--font-display\)/);
  assert.ok(outranks(title, reset[1]), `${title} loses to the reset list and prints in Alegreya`);
  assert.ok(/font-size:\s*19px/.test(topLevel.find(([s]) => s.includes(title))[1]), 'Young Serif under 19px');
});
