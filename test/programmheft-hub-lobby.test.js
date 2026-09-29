'use strict';

/* Das Programmheft composes the lobby, the round hub and the shared chrome
 * (#1372) — P3.1/P3.2 at desktop, P2.1/P6.1 on a phone, the Kopf, Telefonkopf,
 * Dock and Fuß sheets. Every one of those is a markup branch on
 * designIs('programmheft') or a rule in programmheft.css, so the spec runs the
 * real views under the design and asserts the P3.2 checklist block by block —
 * and pins Klassisch's rendered DOM against a signature captured from the code
 * BEFORE this issue touched it (test/fixtures/klassisch-hub-lobby.json), so a
 * branch that leaks into the default path goes red naming the element.
 *
 * Regenerate the fixture only for a deliberate Klassisch change:
 *   UPDATE_KLASSISCH_SIGNATURE=1 node --test test/programmheft-hub-lobby.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { domSignature } = require('./support/dom-signature');
const { rulesOf, mediaBlocks, outranks } = require('./support/css');

const FIXTURE = path.join(__dirname, 'fixtures', 'klassisch-hub-lobby.json');
const PH_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'programmheft.css'), 'utf8')
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

/* Anna leads with two wins, Ben has one, Cem none; eight active games (half of
   them short, so the presets have something to narrow), four evenings in the
   last year (the Rundenpuls draws its bars), one game in each off-shelf list. */
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

// ------------------------------------------------------------- Klassisch

/* The five Klassisch screens this issue's branches sit in. Each is rendered
   with no design applied — the default path — and reduced to its signature. */
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

test('Klassisch: the hub and the lobby render exactly the DOM they rendered before #1372', async (t) => {
  const got = {};
  for (const [name, render] of Object.entries(KLASSISCH_SCREENS)) {
    const dom = await render(t);
    got[name] = domSignature(dom.app);
    assert.ok(got[name].length > 10, `${name}: only ${got[name].length} elements — did the render fail?`);
    assert.equal(dom.app.querySelector('[class*="ph-"]'), null, `${name}: a Programmheft element leaked into Klassisch`);
  }
  if (process.env.UPDATE_KLASSISCH_SIGNATURE) {
    fs.writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + '\n');
    return;
  }
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(Object.keys(got), Object.keys(want));
  for (const name of Object.keys(want)) assert.deepEqual(got[name], want[name], `${name}: Klassisch's DOM changed`);
});

// ---------------------------------------------------------- Programmheft

/* `a` precedes `b` in document order — DOM order is the phone order and the
   reading order (#1372's constraint), so the checklist is asserted as a SEQUENCE
   rather than as a set of blocks that merely exist. */
const precedes = (dom, a, b) =>
  Boolean(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);

test('Programmheft hub: the P3.2 checklist, block by block, in reading order', async (t) => {
  const dom = await hub(t, 'programmheft');
  const root = dom.app.querySelector('.ph-hub');
  assert.ok(root, 'no Programmheft frame');
  const cell = (name) => root.querySelector(`.ph-hub__${name}`);

  // The head of the page: marker bar, the name as the one <h1>, the members row.
  const head = cell('head');
  assert.equal(dom.app.querySelectorAll('h1').length, 1, 'the Start tab must keep exactly one <h1>');
  const hero = head.querySelector('.hero');
  assert.ok(hero && !hero.classList.contains('rail-owned'), 'the head would be hidden from 1280 up');
  assert.match(hero.querySelector('h1').textContent, /Freitagsrunde/);
  assert.ok(hero.querySelector('.ph-marker[aria-hidden="true"]'), 'no marker bar over the name');
  const members = hero.querySelector('.ph-members');
  assert.equal(members.querySelector('.ph-members__label').textContent, 'Mitglieder');
  const seats = [...members.querySelectorAll('.hero__members > a.avatar:not(.avatar--retired)')];
  assert.deepEqual(seats.map((s) => s.querySelector('.seat__name').textContent), ['Anna', 'Ben', 'Cem']);
  assert.equal(seats[0].querySelector('.seat__wins--lead').textContent, '2 Siege', 'the leader carries her count');
  assert.equal(seats[2].querySelector('.seat__wins'), null, 'a zero is not printed');
  assert.ok(members.querySelector('.avatar--add .seat__name'), '„Platz dazu" is not captioned');
  assert.match(members.querySelector('a.ph-members__settings').getAttribute('href'), /\/settings$/);

  // The black box: „Neue Session", the one action, the labelled presets.
  const box = cell('box');
  assert.equal(box.querySelector('.ph-box__kicker').textContent, 'Neue Session');
  const cta = box.querySelector('.hub-cta');
  assert.ok(cta && !cta.classList.contains('rail-owned'), 'the start button left the box or is hidden from 1280 up');
  const presets = box.querySelector('.hub-presets');
  assert.ok(presets && !presets.classList.contains('rail-owned'), 'the presets left the box');
  assert.ok(precedes(dom, box.querySelector('.ph-box__label'), presets), 'the „Schnellstart" label must precede its chips');

  // The lead story: ONE link to the last result — kicker, headline, „Ergebnis ansehen".
  const lead = cell('lead').querySelector('a.ph-lead');
  assert.ok(lead, 'no lead story');
  assert.match(lead.getAttribute('href'), /903/);
  assert.match(lead.querySelector('.ph-lead__kicker').textContent, /^Zuletzt gespielt · /);
  assert.match(lead.querySelector('.ph-lead__headline').textContent, /Spiel 13/);
  assert.match(lead.querySelector('.ph-lead__open').textContent, /Ergebnis ansehen/);
  assert.equal(dom.app.querySelector('.ticket'), null, 'the Klassisch ticket rendered beside the lead');

  // The side column carries the pulse; the strip the previews and the off-shelf group.
  assert.ok(cell('side').querySelector('.hub-card'), 'the side column is empty');
  const strip = cell('strip');
  assert.ok(strip.querySelector('.hub-card'), 'no preview in the strip');
  assert.ok(strip.querySelector('.off-shelf__row'), 'the off-shelf destinations are unreachable');
  const actions = root.querySelector(':scope > .hub-actions');
  assert.ok(actions, 'the quiet actions left the page');

  // Reading order is the phone order.
  const order = [head, box, cell('lead'), cell('suggest'), cell('side'), cell('more'), strip, actions];
  for (let i = 1; i < order.length; i++) assert.ok(precedes(dom, order[i - 1], order[i]), `block ${i} is out of order`);
  assert.equal(dom.app.querySelector('.empty--rail-gap'), null, 'the rail-gap stand-in rendered under the Programmheft');
});

test('Programmheft hub: the lead prints the winners inside the results screen\'s own sentence', async (t) => {
  const round = busyRound();
  round.sessions.push(play(904, 14, ago(1), ['m2', 'm3']));
  const dom = await hub(t, 'programmheft', 'start', round);
  const headline = dom.app.querySelector('.ph-lead__headline');
  assert.equal(headline.querySelector('.ph-lead__winner').textContent, 'Ben und Cem');
  assert.equal(headline.textContent, '„Spiel 14“ wurde gespielt. Ben und Cem haben gewonnen!');
});

test('Programmheft hub: a round without games leads with the empty table', async (t) => {
  const dom = await hub(t, 'programmheft', 'start', youngRound());
  assert.ok(dom.app.querySelector('.ph-hub__lead .empty--table'), 'the empty table is not the lead');
  assert.ok(dom.app.querySelector('.ph-hub__box .hub-cta[disabled]'), 'the locked start button left the box');
});

test('Programmheft rail: the section line is the five links and nothing else', async (t) => {
  for (const tab of ['start', 'regal']) {
    const dom = await hub(t, 'programmheft', tab);
    const rail = dom.app.querySelector('.rail');
    assert.ok(rail, `${tab}: no rail rendered`);
    assert.equal(rail.querySelector('.rail__id'), null, `${tab}: the section line carries the identity`);
    assert.equal(rail.querySelector('.rail__cta'), null, `${tab}: the section line carries a start button`);
    assert.equal(rail.querySelectorAll('.rail__item').length, 5, `${tab}: not five links`);
  }
});

// ------------------------------------------------- Programmheft, the CSS

/* jsdom applies no stylesheet, so the chrome's layout decisions are held as
   CSS text. Each lookup names its @media block, and each override is checked to
   OUTRANK the styles.css rule it replaces — a tie would be decided by source
   order across two files, which is exactly how an override goes inert. */
const block = (query) => {
  const hits = mediaBlocks(PH_CSS).filter(([q]) => q.includes(query));
  assert.ok(hits.length, `no @media block for ${query} in programmheft.css`);
  return hits.flatMap(([, body]) => rulesOf(body));
};
const ruleWith = (rules, part, decl) => {
  const hit = rules.find(([sel, body]) => sel.includes(part) && decl.test(body));
  assert.ok(hit, `no rule for ${part} declaring ${decl}`);
  return hit[0].split(',').map((s) => s.trim()).find((s) => s.includes(part));
};

test('Programmheft chrome: the phone dock is shown on the result screen', () => {
  const sel = ruleWith(block('max-width: 859px'), '.result-screen) .dock.dock--sub', /display:\s*grid/);
  assert.ok(outranks(sel, '.dock--sub'), 'the result-screen dock loses to styles.css\'s `.dock--sub { display: none }`');
});

test('Programmheft chrome: from 1280 the section line runs above a one-column page', () => {
  const wide = block('min-width: 1280px');
  ruleWith(wide, '.app:has(.rail)', /grid-template-columns:\s*minmax\(0, 1fr\);/);
  ruleWith(wide, '.app:has(.rail) > .rail', /flex-direction:\s*row/);
  const content = ruleWith(wide, '.app:has(.rail) > *:not(.rail)', /grid-column:\s*1;/);
  assert.ok(outranks(content, '.app:has(.rail) > *:not(.rail)'), 'the content stays in the rail grid\'s second column');
  const hub = ruleWith(wide, '.app > .ph-hub', /max-width:\s*none/);
  assert.ok(outranks(hub, '.app > *:not(.rail):not(.dock)'), 'the hub stays capped at the reading measure');
});

test('Programmheft chrome: the Telefonkopf keeps its wordmark', () => {
  const sel = ruleWith(block('max-width: 520px'), '.topbar__word', /display:\s*inline/);
  assert.ok(outranks(sel, '.topbar__word'), 'styles.css still hides the wordmark on a phone');
});

test('Programmheft: every Anton override in #1372 outranks the Archivo reset it follows', () => {
  /* The reset list hands small display-face rules back to Archivo at the
     specificity of its MOST specific member, so an Anton rule written later has
     to reach that too or it silently prints in Archivo. */
  const reset = /(:root\[data-design="programmheft"\] :is\([\s\S]*?\))\s*\{\s*font-family:\s*var\(--font\);/.exec(PH_CSS);
  assert.ok(reset, 'no Archivo reset list');
  // #1372's section opens on the masthead rule (comments are stripped).
  const start = PH_CSS.indexOf(' .topbar {');
  assert.ok(start > reset.index, 'the #1372 section must follow the reset list');
  const own = PH_CSS.slice(start);
  const anton = rulesOf(own).filter(([, body]) => /font-family:\s*var\(--font-display\)/.test(body));
  assert.ok(anton.length >= 3, `only ${anton.length} Anton rules found — did the parse break?`);
  let contested = 0;
  for (const [sel] of anton) {
    for (const s of sel.split(',').map((x) => x.trim())) {
      // Only a subject the reset list also names is contested.
      const subject = s.split(' ').pop().match(/\.[\w-]+/g) || [];
      const named = subject.some((c) => new RegExp(`\\${c}(?![\\w-])`).test(reset[1]));
      if (!named) continue;
      contested += 1;
      assert.ok(!outranks(reset[1], s), `${s} loses to the Archivo reset`);
    }
  }
  assert.ok(contested >= 1, 'no contested Anton rule found — the lobby tile\'s name is named in the reset');
});

test('Programmheft lobby: the dateline, the Extrablatt and the tiles', async (t) => {
  const dom = await lobby(t, 'programmheft', [
    summary({ openSessions: [{ id: 's1', stage: 'voting', at: ago(0) }] }),
    summary({ id: 'r2', name: 'Sonntagsrunde', lastPlayed: null }),
  ]);
  assert.match(dom.document.querySelector('#context').textContent, /^Kiosk · /);
  const extra = dom.app.querySelector('a.ph-extra');
  assert.ok(extra, 'no Extrablatt for the running vote');
  assert.equal(extra.querySelector('.ph-extra__label').textContent, 'Extrablatt');
  assert.match(extra.querySelector('.ph-extra__go').textContent, /Jetzt abstimmen/);
  assert.equal(dom.app.querySelector('.ticket'), null, 'the Klassisch ticket rendered beside the Extrablatt');
  const tiles = [...dom.app.querySelectorAll('a.round-card--ph')];
  assert.deepEqual(tiles.map((c) => c.querySelector('.round-card__name').textContent), ['Donnerstagsrunde', 'Sonntagsrunde']);
  assert.equal(tiles[0].querySelector('.round-card__kicker--live').textContent, 'Abstimmung läuft');
  assert.ok(tiles[0].getAttribute('style').includes('--marker'), 'the tile lost its marker');
  assert.ok(dom.app.querySelector('a.round-card--new'), 'the new-round tile is unreachable');
  assert.equal(dom.app.querySelectorAll('h1').length, 1);
});
