'use strict';

/* Die Brücke composes the lobby and the round hub (#1238) — B2.1 (phone
 * lobby), B2.2 (phone hub), B3.1 (desktop hub): the Abschnittsleiste (five
 * links, no identity, no start button), the hub as one frame of named slots in
 * the phone order, the Missionskontrolle panel around „Mission starten", the
 * members captioned with their wins, the Rundenpuls as its own block with all
 * three lines, and the lobby's „Eingehendes Signal" notice.
 *
 * Every one of those is a markup branch on designIs('bruecke'), so the spec
 * runs the real views under Die Brücke and asserts the structure — and runs
 * Klassisch on the same fixtures to prove it is untouched. What jsdom cannot
 * see (which width shows which column) is pinned as CSS text at the end
 * (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const BRUECKE_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'bruecke.css'), 'utf8');

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

/* Anna leads with two wins, Ben has one, Cem none. Eight games, four played
   evenings in the last year (so the Rundenpuls draws), one game in each
   off-shelf list. */
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

/* `wide` stubs matchMedia so the desktop query matches — jsdom has none, so
   without it the frame stays in the phone order. The stub keeps the `change`
   listeners it is handed on `window.__mq` so a spec can cross the breakpoint. */
async function screen(t, design, tab = 'start', round = busyRound(), { wide = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (wide) {
    dom.run(`window.__mq = [];
      window.matchMedia = (q) => ({ matches: /min-width: 1280px/.test(q),
        addEventListener(type, fn) { window.__mq.push(fn); }, removeEventListener() {} });`);
  }
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async (method, url) => {
    if (/recommendations/.test(url)) return { recommendations: [] };
    if (/activities/.test(url)) return [];
    return round;
  });
  await dom.call('showRound', round.id, tab);
  return dom;
}

// ------------------------------------------------ the Abschnittsleiste, dock

test('Die Brücke: the Abschnittsleiste is the five sections and nothing else', async (t) => {
  for (const tab of ['start', 'regal', 'chronik']) {
    const dom = await screen(t, 'bruecke', tab);
    const rail = dom.app.querySelector('.rail');
    assert.ok(rail, `${tab}: no rail rendered`);
    assert.equal(rail.querySelector('.rail__id'), null, `${tab}: the Abschnittsleiste carries the round identity`);
    assert.equal(rail.querySelector('.rail__cta'), null, `${tab}: the Abschnittsleiste carries a start button`);
    assert.equal(rail.querySelector('.hub-presets'), null, `${tab}: the Abschnittsleiste carries the presets`);
    assert.deepEqual(
      [...rail.querySelectorAll('.rail__item')].map((a) => a.textContent.trim()),
      ['Start', 'Regal', 'Chronik', 'Pokale', 'Einstellungen'],
    );
  }
});

test('Die Brücke: the dock carries exactly four entries', async (t) => {
  const dom = await screen(t, 'bruecke');
  assert.deepEqual(
    [...dom.app.querySelectorAll('.dock .dock__item')].map((a) => a.textContent.trim()),
    ['Start', 'Regal', 'Chronik', 'Pokale'],
  );
});

// ------------------------------------------------------------- the hub

test('Die Brücke: the hub is one frame of slots in the phone order', async (t) => {
  const dom = await screen(t, 'bruecke');
  const frame = dom.app.querySelector('.bruecke-hub');
  assert.ok(frame, 'no Brücke frame');
  const filled = [...frame.children]
    .filter((s) => s.children.length)
    .map((s) => s.className.replace('bruecke-hub__', ''));
  // members, Missionskontrolle, Zuletzt gespielt, Wie wär's mit, Rundenpuls,
  // Kümmerliste, the previews, the rest, Nicht im Regal, the quiet actions.
  assert.deepEqual(filled.filter((n) => n !== 'feed' && n !== 'care' && n !== 'suggest'),
    ['crew', 'mission', 'last', 'pulse', 'previews', 'more', 'offshelf', 'actions']);
  assert.ok(frame.querySelector('.bruecke-hub__crew > .hero'), 'the hero is not in the crew slot');
  assert.deepEqual([...frame.querySelectorAll('.bruecke-hub__previews > .hub-preview .hub-card__title')].map((h) => h.textContent.trim()),
    ['Regal', 'Pokale', 'Chronik']);
});

/* #1496: from 1280 the slots stand in B3.1's three column wrappers, so each
   column stacks on its own — as one grid of slots, „Zuletzt gespielt" waited
   for the tallest column and left ~700px of empty grid under the panel. */
const WIDE_COLUMNS = {
  left: ['pulse', 'care'],
  mid: ['mission', 'last', 'more'],
  right: ['suggest', 'previews', 'offshelf'],
};
const slotNames = (el) => [...el.children].map((s) => s.className.replace('bruecke-hub__', ''));

test('Die Brücke from 1280: the slots stand in three column wrappers, DOM order = visual order (#1496)', async (t) => {
  const dom = await screen(t, 'bruecke', 'start', busyRound(), { wide: true });
  const frame = dom.app.querySelector('.bruecke-hub');
  assert.deepEqual(slotNames(frame),
    ['crew', 'feed', 'col bruecke-hub__col--left', 'col bruecke-hub__col--mid', 'col bruecke-hub__col--right', 'actions']);
  for (const [col, names] of Object.entries(WIDE_COLUMNS)) {
    assert.deepEqual(slotNames(frame.querySelector(`.bruecke-hub__col--${col}`)), names, `the ${col} column`);
  }
  // The content went with its slot: „Zuletzt gespielt" directly under the panel.
  const mid = frame.querySelector('.bruecke-hub__col--mid');
  assert.ok(mid.querySelector('.bruecke-hub__mission > .bruecke-mission'), 'the panel left its slot');
  assert.ok(mid.querySelector('.bruecke-hub__last > .ticket'), '„Zuletzt gespielt" is not under the panel');
});

test('Die Brücke: crossing 1280 moves the slots back to the phone order and out again (#1496)', async (t) => {
  const dom = await screen(t, 'bruecke', 'start', busyRound(), { wide: true });
  const frame = dom.app.querySelector('.bruecke-hub');
  const phone = ['crew', 'mission', 'feed', 'last', 'suggest', 'pulse', 'care', 'previews', 'more', 'offshelf', 'actions'];
  dom.run('window.__mq.forEach((fn) => fn({ matches: false }))');
  assert.deepEqual(slotNames(frame), phone, 'narrowing did not restore the phone order');
  assert.equal(frame.querySelector('.bruecke-hub__col'), null, 'a column wrapper survived the narrow arrangement');
  dom.run('window.__mq.forEach((fn) => fn({ matches: true }))');
  assert.deepEqual(slotNames(frame.querySelector('.bruecke-hub__col--mid')), WIDE_COLUMNS.mid, 'widening again did not rebuild the columns');
});

test('Die Brücke: „Mission starten" sits in the Missionskontrolle with the presets', async (t) => {
  const dom = await screen(t, 'bruecke');
  const panel = dom.app.querySelector('.bruecke-hub__mission > .bruecke-mission');
  assert.ok(panel, 'no Missionskontrolle panel');
  assert.equal(panel.querySelector('.bruecke-mission__title').textContent, 'Missionskontrolle');
  assert.equal(panel.querySelector('.bruecke-mission__state').textContent, 'Bereit');
  const fire = panel.querySelector('.bruecke-mission__ignition > button.bruecke-mission__fire');
  assert.ok(fire, 'the one action is not the ignition button');
  assert.equal(fire.textContent.trim(), 'Mission starten');
  assert.ok(fire.querySelector('.ti-rocket'), 'the ignition wears no rocket');
  assert.ok(panel.querySelector('.hub-presets'), 'the presets are not inside the panel');
  assert.equal(panel.querySelectorAll('.bruecke-mission__ring[aria-hidden="true"]').length, 2);
  assert.equal(dom.app.querySelectorAll('.hub-cta').length, 1, 'a second start button rendered');
});

test('Die Brücke: the members carry their name and wins; „Crew" only in the decorative line', async (t) => {
  const dom = await screen(t, 'bruecke');
  const seats = [...dom.app.querySelectorAll('.hero__members > a.avatar')];
  assert.equal(seats.length, 3);
  assert.deepEqual(seats.map((s) => s.querySelector('.seat__name').textContent), ['Anna', 'Ben', 'Cem']);
  assert.deepEqual(seats.map((s) => (s.querySelector('.seat__wins') || { textContent: '' }).textContent),
    ['2 Siege', '1 Sieg', '']);
  assert.deepEqual(seats.map((s) => (s.querySelector('.seat__n') || { textContent: '' }).textContent), ['2', '1', '']);
  // The colour is a fill on the face square, never on the link or the name.
  for (const s of seats) {
    assert.equal(s.style.background, '', 'the seat link keeps the person colour');
    assert.notEqual(s.querySelector('.seat__face').style.background, '', 'the face lost the person colour');
  }
  assert.equal(dom.app.querySelector('.bruecke-crew__title').textContent, 'Mitglieder · 3');
  assert.equal(dom.app.querySelector('.avatar--add .seat__name').textContent, 'Platz dazu');
  const line = dom.app.querySelector('.hero__chips .bruecke-line');
  assert.equal(line.getAttribute('aria-hidden'), 'true');
  assert.equal(line.textContent, 'Mission 5 · Crew 3');
  // „Crew" appears in that line and nowhere else on the screen.
  const crews = dom.app.textContent.match(/Crew/g) || [];
  assert.equal(crews.length, 1);
});

test('Die Brücke: the Rundenpuls is its own block, three lines, „noch nie dran"', async (t) => {
  const dom = await screen(t, 'bruecke');
  const pulse = dom.app.querySelector('.bruecke-hub__pulse > .hub-card');
  assert.ok(pulse, 'the Rundenpuls is not in its slot');
  assert.equal(pulse.querySelector('.hub-card__title').textContent.trim(), 'Rundenpuls');
  const facts = [...pulse.querySelectorAll('.hub-card__fact')].map((f) => f.textContent.trim());
  assert.equal(facts.length, 2, 'the facts are one joined line');
  assert.match(facts[0], /Vor 5 Tagen gespielt/);
  assert.match(facts[1], /4 Sessions/);
  assert.match(pulse.textContent, /4 von 8 Spielen waren noch nie dran/);
});

test('Die Brücke: the top bar carries the decorative status as data, never as text', async (t) => {
  const dom = await screen(t, 'bruecke');
  const bar = dom.document.querySelector('.topbar');
  assert.equal(bar.getAttribute('data-status'), 'T+ 00:14:52 · Orbit stabil');
  assert.doesNotMatch(bar.textContent, /Orbit/);
});

test('Klassisch hub is untouched: no frame, its rail identity, its start label, joined pulse facts', async (t) => {
  const dom = await screen(t, null);
  assert.equal(dom.app.querySelector('.bruecke-hub'), null);
  assert.equal(dom.app.querySelector('.bruecke-mission'), null);
  assert.equal(dom.app.querySelector('.seat__face'), null);
  assert.ok(dom.app.querySelector('.rail .rail__id'), 'Klassisch lost its rail identity');
  assert.equal(dom.app.querySelector('.hub-cta').textContent.trim(), 'Session wirbeln');
  assert.equal(dom.document.querySelector('.topbar').hasAttribute('data-status'), false);
  const pulse = [...dom.app.querySelectorAll('.hub-card')].find((c) => /Rundenpuls/.test(c.textContent));
  assert.equal(pulse.querySelectorAll('.hub-card__fact').length, 0);
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

test('Brücke lobby: the greeting and the kicker, the question line unchanged', async (t) => {
  const dom = await lobby(t, 'bruecke', [summary()]);
  assert.equal(dom.app.querySelector('.lobby-head h1').textContent, 'Willkommen zurück an Bord.');
  assert.equal(dom.app.querySelector('.lobby-head__sub').textContent, 'Welche Runde spielt heute?');
  assert.equal(dom.document.querySelector('.topbar__context').textContent, 'Flotte / Übersicht');
  // The status line keys on this mark, not on `.lobby-head`, which every
  // account screen has too (#1246).
  assert.ok(dom.app.querySelector('.lobby-head.lobby-head--home'), 'the lobby head lost its home mark');
});

test('Brücke lobby: a running vote is an „Eingehendes Signal" linking to the session', async (t) => {
  const dom = await lobby(t, 'bruecke', [summary({ openSessions: [{ id: 's1', stage: 'voting', at: ago(0) }] })]);
  const notice = dom.app.querySelector('.home-resume .bruecke-notice');
  assert.ok(notice, 'no notice for the running vote');
  assert.equal(dom.app.querySelector('.home-resume .ticket'), null, 'the Klassisch ticket rendered beside it');
  assert.equal(notice.querySelector('.bruecke-notice__kicker').textContent, 'Eingehendes Signal');
  assert.equal(notice.querySelector('.bruecke-notice__title').textContent, 'Abstimmung läuft · Donnerstagsrunde');
  assert.match(notice.getAttribute('href'), /\/round\/r1\/session\/s1$/);
});

test('Klassisch lobby is untouched: its greeting, no kicker, the ticket', async (t) => {
  const dom = await lobby(t, null, [summary({ openSessions: [{ id: 's1', stage: 'voting', at: ago(0) }] })]);
  assert.equal(dom.app.querySelector('.lobby-head h1').textContent, 'Schön, dass ihr da seid.');
  assert.equal(dom.app.querySelector('.lobby-head--home'), null, 'Klassisch markup must not change');
  assert.equal(dom.document.querySelector('.topbar__context').textContent, '');
  assert.equal(dom.app.querySelector('.bruecke-notice'), null);
});

// ------------------------------------------------------------- the CSS half

test('bruecke.css: the #1238 section lays out the hub as 300 / free / 340 from 1280, rail as a bar', () => {
  const at = BRUECKE_CSS.indexOf('/* ===== #1238 — ');
  assert.ok(at > 0, 'the #1238 section header is missing');
  const own = BRUECKE_CSS.slice(at);
  const wide = own.split('@media (min-width: 1280px)').slice(1).join('\n');
  assert.match(wide, /grid-template-columns: 300px minmax\(0, 1fr\) 340px/);
  // The members keep their own area; the left wrapper starts under them while
  // the middle and right wrappers span both rows (#1496).
  assert.match(wide, /"crew +mid +right"\s*"left +mid +right"/);
  // The hero dissolves into the grid so its parts land in separate areas.
  assert.match(wide, /\.bruecke-hub__crew[^{]*\{\s*display: contents/);
  // The status line is printed out of the accessibility tree.
  assert.match(own, /content: attr\(data-status\) \/ ""/);
});

/* The #1238 section's media blocks, comments stripped (a comment naming a class
   must not stand in for the rule — css-text-assertions-strip-comments.md). */
const ownBlocks = () => {
  const at = BRUECKE_CSS.indexOf('/* ===== #1238 — ');
  const own = BRUECKE_CSS.slice(at).replace(/\/\*[\s\S]*?\*\//g, '');
  return mediaBlocks(own);
};

test('bruecke.css: the „Flotte / Übersicht" kicker is dropped below 860 and kept from 860', () => {
  const blocks = ownBlocks();
  const phone = blocks.filter(([q]) => /^\(max-width: 859px\)$/.test(q));
  assert.ok(phone.length > 0, 'no phone block in the #1238 section');
  const hides = phone.some(([, css]) => rulesOf(css).some(([sel, body]) =>
    /\.topbar__context--kicker(?![\w-])/.test(sel) && /display:\s*none/.test(body)));
  assert.ok(hides, 'the kicker truncates at 390 — it must be display: none below 860');
  // …and nowhere else, so the desktop bar keeps it.
  const elsewhere = blocks.filter(([q]) => q !== '(max-width: 859px)').some(([, css]) => rulesOf(css).some(([sel, body]) =>
    /\.topbar__context--kicker(?![\w-])/.test(sel) && /display:\s*none/.test(body)));
  assert.equal(elsewhere, false);
});

test('bruecke.css: from 1280 every column is as tall as its content, and no slot shares a row with another column (#1496)', () => {
  const wide = ownBlocks().filter(([q]) => q === '(min-width: 1280px)').map(([, css]) => css).join('\n');
  const rules = rulesOf(wide);
  // A stretched column grew to the tallest one's height and printed a tall
  // empty panel around the ignition (#1238).
  const frame = rules.find(([sel, decl]) => /\.bruecke-hub(?![\w-])\s*$/.test(sel.trim()) && /grid-template-areas/.test(decl));
  assert.ok(frame, 'no grid rule for the frame from 1280');
  assert.match(frame[1], /align-items:\s*start/);
  // The row under the members is flexible: a track a spanning item crosses is
  // sized only by the flexible pass, so the members' own row stays their height.
  // As `auto` it took the middle/right wrappers' height and opened a 333px hole
  // under the members (measured in WebKit and Chromium).
  assert.match(frame[1], /grid-template-rows:\s*auto auto auto 1fr auto;/);
  // The slots of the three columns are placed by their wrapper, never by an
  // area of their own: an area shares row lines, which is the hole.
  for (const slot of ['mission', 'last', 'suggest', 'pulse', 'care', 'previews', 'more', 'offshelf']) {
    assert.ok(!rules.some(([sel, decl]) => new RegExp(`\\.bruecke-hub__${slot}(?![\\w-])`).test(sel) && /grid-area/.test(decl)),
      `${slot} has a grid-area of its own from 1280`);
  }
  for (const col of ['left', 'mid', 'right']) {
    assert.ok(rules.some(([sel, decl]) => sel.includes(`.bruecke-hub__col--${col}`) && new RegExp(`grid-area:\\s*${col}`).test(decl)),
      `the ${col} wrapper has no area`);
  }
});
