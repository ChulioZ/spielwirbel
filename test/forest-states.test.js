'use strict';

/* Forest's empty, young and long-language states (#1471, sheet
 * Forest-F7-Leerzustaende.dc.html: F7.1–F7.6, F7.10). Every one is a markup
 * branch on designIs('forest') or a rule in forest.css's #1471 section, so the
 * spec runs the real views under the design and asserts each state — and pins
 * Klassisch's rendered DOM for the same states against the signature the
 * Programmheft's states spec captured before either design touched them
 * (test/fixtures/programmheft-states-klassisch.json, the same six screens).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { domSignature } = require('./support/dom-signature');

const FIXTURE = path.join(__dirname, 'fixtures', 'programmheft-states-klassisch.json');
const FOREST_RAW = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'forest.css'), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const game = (id, extra = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, createdAt: ago(30 - (id % 20)), ...extra,
});
const play = (id, gid, when, winnerIds) => ({
  id, createdAt: when, done: true, finished: true,
  gameIds: [gid], chosenGameId: gid, winnerIds, memberIds: ['m1', 'm2'],
  votes: { m1: { [gid]: { rating: 5 } }, m2: { [gid]: { rating: 4 } } },
});
// The same rounds programmheft-states.test.js renders, so the fixture applies.
const base = (extra) => ({
  id: 'r1', name: 'Spieletreff Ost', background: null, marker: 0,
  members: [{ id: 'm1', name: 'Marco' }, { id: 'm2', name: 'Aylin' }],
  games: [], sessions: [], tags: [], ...extra,
});
const emptyRound = () => base();
const readyRound = () => base({
  name: 'Familie Berger',
  games: Array.from({ length: 12 }, (_, i) => game(10 + i, i < 2 ? { minPlayers: null, maxPlayers: null } : {})),
});
const firstRound = () => ({ ...readyRound(), name: 'WG Kastanienallee', sessions: [play(900, 12, ago(1), ['m2'])] });

async function hub(t, design, round, { demo = false, locale = 'de' } = {}) {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  if (demo) dom.set('isDemoAccount', () => true);
  dom.set('api', async (method, url) => {
    if (/recommendations/.test(url)) return { recommendations: [] };
    if (/activities/.test(url)) return [];
    return round;
  });
  await dom.call('showRound', round.id, 'start');
  return dom;
}

async function lobby(t, design, rounds, { onboard = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('accountsActive', () => onboard);
  dom.set('isLoggedIn', () => onboard);
  dom.set('api', async () => rounds);
  await dom.call('showHome');
  return dom;
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const precedes = (dom, a, b) => Boolean(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
// Live primaries on the page — a disabled one is not an action.
const primaries = (dom) => [...dom.app.querySelectorAll('.btn--primary:not(:disabled)')];

// ------------------------------------------------------------- Klassisch

const KLASSISCH_SCREENS = {
  'hub start (no games)': (t) => hub(t, null, emptyRound()),
  'hub start (games, no session)': (t) => hub(t, null, readyRound()),
  'hub start (one session)': (t) => hub(t, null, firstRound()),
  'hub start (demo)': (t) => hub(t, null, firstRound(), { demo: true }),
  'lobby (empty)': (t) => lobby(t, null, []),
  'lobby (empty, signed in)': (t) => lobby(t, null, [], { onboard: true }),
};

test('Klassisch: the young states render exactly the DOM they rendered before #1471', async (t) => {
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(Object.keys(KLASSISCH_SCREENS), Object.keys(want));
  for (const [name, render] of Object.entries(KLASSISCH_SCREENS)) {
    const dom = await render(t);
    const got = domSignature(dom.app);
    assert.ok(got.length > 5, `${name}: only ${got.length} elements — did the render fail?`);
    assert.equal(dom.app.querySelector('[class*="forest-"]'), null, `${name}: a Forest element leaked into Klassisch`);
    assert.deepEqual(got, want[name], `${name}: Klassisch's DOM changed`);
  }
});

// The signature carries no text, so the words this slice changes under Forest
// are pinned for Klassisch separately.
test('Klassisch: the young states keep their words', async (t) => {
  let dom = await hub(t, null, readyRound());
  assert.equal(text(dom.app.querySelector('.hub-cta')), 'Session wirbeln');
  dom = await hub(t, null, emptyRound());
  assert.equal(text(dom.app.querySelector('.empty--table .empty__title')), 'Der Topf ist noch leer');
  dom = await lobby(t, null, [], { onboard: true });
  assert.equal(text(dom.app.querySelector('.lobby-head__sub')), 'Welche Runde spielt heute?');
  assert.equal(text(dom.app.querySelector('.lobby-cta__title')), 'Willkommen bei Spielwirbel!');
});

// ---------------------------------------------------------------- Forest

test('Forest F7.3: a round without games — the stump shows its rings, the empty table names the one action', async (t) => {
  const dom = await hub(t, 'forest', emptyRound());
  const main = dom.app.querySelector('.forest-hub__main');
  const stump = main.querySelector('.forest-stump');
  assert.ok(stump.classList.contains('forest-stump--empty'), 'the stump is not the empty one');
  assert.equal(stump.children.length, 0, 'the empty stump holds something');
  assert.equal(stump.getAttribute('aria-hidden'), 'true');
  assert.equal(dom.app.querySelector('.hub-cta'), null, 'a dead „Session wirbeln" stayed beside „Spiel hinzufügen"');

  const table = main.querySelector('.empty--table');
  assert.ok(table && precedes(dom, stump, table), 'the empty table is not under the stump');
  assert.equal(text(table.querySelector('.empty__title')), 'Der Stumpf ist noch leer');
  assert.deepEqual(primaries(dom).map(text), ['Spiel hinzufügen'], 'not exactly one primary action');

  // The right column: Regal, Pokale and Chronik stand locked, in that order,
  // each in its own screen's words, each still leading to its sub-page.
  const locked = [...dom.app.querySelectorAll('.forest-hub__aside > .forest-locked')];
  assert.deepEqual(locked.map((b) => text(b.querySelector('.forest-locked__title'))), ['Regal', 'Pokale', 'Chronik']);
  assert.deepEqual(locked.map((b) => text(b.querySelector('.forest-locked__state'))), ['0 Spiele', 'Noch keine Pokale', 'Noch nichts passiert']);
  assert.deepEqual(locked.map((b) => text(b.querySelector('.forest-locked__text'))), [
    'ab dem ersten Spiel', 'Die erste Session entscheidet, wer sie holt.', 'Eure erste Session schreibt den ersten Eintrag.',
  ]);
  locked.forEach((b) => assert.match(b.querySelector('a').getAttribute('href'), /\/round\/r1\/(regal|pokale|chronik)$/));
  // No locked pulse on an empty shelf: the sheet draws none, and the table says it.
  assert.equal(locked.length, 3);
});

test('Forest F7.4: games but no session — „Erste Session wirbeln", what is waiting, and the locked pulse', async (t) => {
  const dom = await hub(t, 'forest', readyRound());
  const cta = dom.app.querySelector('.forest-stump > .hub-cta');
  assert.match(text(cta), /^Erste Session wirbeln$/);
  assert.deepEqual(primaries(dom), [cta], 'not exactly one primary action');
  const young = dom.app.querySelector('.forest-stump + .forest-young');
  assert.ok(young, 'nothing under the stump says what is waiting');
  assert.equal(text(young.querySelector('.forest-young__title')), '12 Spiele stehen bereit');
  assert.match(text(young.querySelector('.forest-young__text')), /^Noch keine Session/);
  assert.equal(young.querySelector('a, button'), null, 'the young line is a notice, not a second action');

  const aside = [...dom.app.querySelectorAll('.forest-hub__aside > *')];
  const locked = aside.filter((el) => el.classList.contains('forest-locked'));
  assert.deepEqual(locked.map((b) => text(b.querySelector('.forest-locked__title'))), ['Pokale', 'Chronik', 'Rundenpuls'],
    'the Regal preview must be the real one once the shelf holds games');
  // The pulse's own floor — the first session in every design since #1586.
  assert.equal(text(locked[2].querySelector('.forest-locked__text')), 'Zahlen gibt es ab der ersten Session.');
  assert.ok(aside[0].querySelector('a[href$="/regal"]'), 'the Regal preview no longer leads the column');
});

test('Forest F7.5: after the first session — the stump says „Session wirbeln", the line says when series come', async (t) => {
  const dom = await hub(t, 'forest', firstRound());
  assert.match(text(dom.app.querySelector('.forest-stump > .hub-cta')), /^Session wirbeln$/);
  assert.equal(text(dom.app.querySelector('.forest-stump + .forest-young')), 'Serien zeigen wir ab 3 Sessions — vorher wären sie Zufall.');
  assert.ok(dom.app.querySelector('.forest-pair .forest-last'), '„Zuletzt gespielt" is gone');
  assert.equal(dom.app.querySelector('.forest-locked'), null, 'a locked block survived the first session');
});

test('Forest F7.6: the demo — the invitation as a band over the hub, the condensed list, the previews kept', async (t) => {
  const dom = await hub(t, 'forest', firstRound(), { demo: true });
  const invite = dom.app.querySelector(':scope > .hub-card--demo-invite');
  const frame = dom.app.querySelector(':scope > .forest-hub');
  assert.ok(invite && invite.nextElementSibling === frame, 'the invitation is not the band over the hub');
  assert.equal(dom.app.querySelectorAll('.hub-card--demo-invite').length, 1, 'the invitation rendered twice');
  const list = dom.app.querySelector('.forest-hub__main nav.hub-demo');
  assert.ok(list && precedes(dom, dom.app.querySelector('.forest-stump'), list), 'no condensed list under the stump');
  assert.deepEqual([...list.querySelectorAll('.hub-demo__label')].map((l) => l.textContent), ['Regal', 'Chronik', 'Pokale']);
  assert.ok(dom.app.querySelector('.forest-hub__aside a[href$="/pokale"]'), 'the previews left the right column');
});

test('Forest F7.1: the empty lobby — the trees, the greeting, one sentence and one action', async (t) => {
  for (const onboard of [true, false]) {
    const dom = await lobby(t, 'forest', [], { onboard });
    const first = dom.app.querySelector(':scope > .forest-first');
    assert.ok(first, 'no Forest first-run block');
    assert.equal(first.querySelector('.forest-first__trees').getAttribute('aria-hidden'), 'true');
    assert.equal(text(first.querySelector('h1')), 'Willkommen im Wald.');
    assert.equal(text(first.querySelector('.lobby-head__sub')),
      onboard ? 'Hier gründest du deine erste Runde und holst alle an den Tisch.' : 'Hier gründet ihr eure erste Runde und holt alle an den Tisch.');
    assert.equal(dom.app.querySelectorAll('h1').length, 1);
    assert.equal(dom.app.querySelectorAll('a[href="/round/new"]').length, 1, 'more than one way to found a round');
    assert.deepEqual(primaries(dom).map(text), ['Neue Runde gründen']);
    assert.equal(dom.app.querySelector('.lobby-cta'), null, 'Klassisch\'s card stayed beside the button');
  }
});

test('Forest F7.10: the young states keep their words in Finnish', async (t) => {
  const dom = await hub(t, 'forest', emptyRound(), { locale: 'fi' });
  assert.equal(text(dom.app.querySelector('.empty--table .empty__title')), 'Kanto on vielä tyhjä');
});

// ------------------------------------------------------------ the CSS

test('Forest #1471: no text is set in a hairline, hatch or motif colour, and nothing is cut with an ellipsis', () => {
  // This slice's own section only, header to the next header: later Forest
  // slices append theirs after it, and their rules are not this guard's business.
  const start = FOREST_RAW.indexOf('/* ===== #1471');
  assert.ok(start > 0, 'no #1471 section in forest.css');
  const next = FOREST_RAW.indexOf('/* ===== #', start + 1);
  const own = stripComments(FOREST_RAW.slice(start, next === -1 ? undefined : next));
  assert.ok(own.includes('.forest-stump--empty'), 'the #1471 section lost its empty stump');
  const decls = [...own.matchAll(/(?:^|[;{\s])color:\s*var\((--[\w-]+)\)/g)].map((m) => m[1]);
  assert.ok(decls.length >= 10, `only ${decls.length} colour declarations found — did the parse break?`);
  const banned = ['--line', '--hatch', '--bark', '--bark-light', '--wood', '--wood-ring', '--wood-edge', '--leaf-1', '--leaf-2', '--leaf-3', '--leaf-4'];
  for (const token of decls) assert.ok(!banned.includes(token), `text in ${token}`);
  assert.doesNotMatch(own, /text-overflow:\s*ellipsis|white-space:\s*nowrap/, 'a long title may be cut');
});
