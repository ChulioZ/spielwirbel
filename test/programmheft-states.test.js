'use strict';

/* Das Programmheft's empty, young and long-language states (#1377, sheet
 * Programmheft-P7-Leerzustaende.dc.html: P7.1–P7.6, P7.10). Every one is a
 * markup branch on designIs('programmheft') or a rule in programmheft.css, so
 * the spec runs the real views under the design and asserts each state — and
 * pins Klassisch's rendered DOM for the same states against a signature captured
 * BEFORE this issue touched the code (test/fixtures/programmheft-states-klassisch.json).
 *
 * Regenerate the fixture only for a deliberate Klassisch change:
 *   UPDATE_KLASSISCH_SIGNATURE=1 node --test test/programmheft-states.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { domSignature } = require('./support/dom-signature');

const FIXTURE = path.join(__dirname, 'fixtures', 'programmheft-states-klassisch.json');
const PH_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'programmheft.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

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
const base = (extra) => ({
  id: 'r1', name: 'Spieletreff Ost', background: null, marker: 0,
  members: [{ id: 'm1', name: 'Marco' }, { id: 'm2', name: 'Aylin' }],
  games: [], sessions: [], tags: [], ...extra,
});
// P7.3: founded, nothing on the shelf.
const emptyRound = () => base();
// P7.4: the shelf imported, never played (two games without a player count).
const readyRound = () => base({
  name: 'Familie Berger',
  games: Array.from({ length: 12 }, (_, i) => game(10 + i, i < 2 ? { minPlayers: null, maxPlayers: null } : {})),
});
// P7.5: one session played.
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

// ------------------------------------------------------------- Klassisch

const KLASSISCH_SCREENS = {
  'hub start (no games)': (t) => hub(t, null, emptyRound()),
  'hub start (games, no session)': (t) => hub(t, null, readyRound()),
  'hub start (one session)': (t) => hub(t, null, firstRound()),
  'hub start (demo)': (t) => hub(t, null, firstRound(), { demo: true }),
  'lobby (empty)': (t) => lobby(t, null, []),
  'lobby (empty, signed in)': (t) => lobby(t, null, [], { onboard: true }),
};

test('Klassisch: the young states render exactly the DOM they rendered before #1377', async (t) => {
  const got = {};
  for (const [name, render] of Object.entries(KLASSISCH_SCREENS)) {
    const dom = await render(t);
    got[name] = domSignature(dom.app);
    assert.ok(got[name].length > 5, `${name}: only ${got[name].length} elements — did the render fail?`);
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

const precedes = (dom, a, b) =>
  Boolean(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

test('Programmheft P7.3: a round without games — the empty table leads, everything else says when', async (t) => {
  const dom = await hub(t, 'programmheft', emptyRound());
  const lead = dom.app.querySelector('.ph-hub__lead');
  const table = lead.querySelector('.empty--table');
  assert.ok(table, 'the empty table is not the lead');
  // Exactly one primary action on the empty state.
  assert.equal(table.querySelectorAll('.btn--primary').length, 1);
  assert.equal(dom.app.querySelectorAll('.ph-hub .btn--primary:not(:disabled)').length, 1, 'more than one live primary on the page');
  assert.ok(dom.app.querySelector('.ph-hub__box .hub-cta[disabled]'), 'the locked start button left the box');

  // The side column: two locked blocks, each a sentence, in the sheet's order.
  // The threshold is the app's own (SUGGEST_MIN_SHELF), not the sheet's „3".
  // No Kümmerliste: careList() waits for the first played session, so the
  // sheet's „ab dem ersten Spiel" would not be true.
  const side = [...dom.app.querySelectorAll('.ph-hub__suggest .ph-locked, .ph-hub__side .ph-locked')];
  assert.deepEqual(side.map((b) => b.querySelector('.ph-locked__title').textContent),
    ['Wie wär’s mit', 'Rundenpuls']);
  assert.deepEqual(side.map((b) => b.querySelector('.ph-locked__text').textContent), [
    `Vorschläge gibt es ab ${dom.run('SUGGEST_MIN_SHELF')} Spielen im Regal.`,
    'Zahlen gibt es ab der ersten Session.',
  ]);

  // The strip: Regal, Pokale and Chronik locked, then „Nicht im Regal".
  const strip = dom.app.querySelector('.ph-hub__strip');
  const previews = [...strip.querySelectorAll('.ph-locked')];
  assert.deepEqual(previews.map((p) => text(p.querySelector('.ph-locked__title'))), ['Regal', 'Pokale', 'Chronik']);
  assert.deepEqual(previews.map((p) => text(p.querySelector('.ph-locked__state'))), ['0 Spiele', 'Noch keine Pokale', 'Noch nichts passiert']);
  previews.forEach((p) => assert.match(p.querySelector('a').getAttribute('href'), /\/round\/r1\/(regal|pokale|chronik)$/));
  assert.ok(precedes(dom, previews[2], strip.querySelector('.hub-offshelf')), '„Nicht im Regal" must close the strip');
});

test('Programmheft P7.4: games but no session — the lead says what is ready, the box says „Erste Session"', async (t) => {
  const dom = await hub(t, 'programmheft', readyRound());
  const young = dom.app.querySelector('.ph-hub__lead .ph-young');
  assert.ok(young, 'the lead column is empty on a round that has not played yet');
  assert.equal(young.querySelector('.ph-young__kicker').textContent, 'Zuletzt gespielt');
  assert.equal(young.querySelector('.ph-young__title').textContent, 'Noch keine Session');
  assert.equal(young.querySelector('.ph-young__count').textContent, '12');
  assert.equal(young.querySelector('.ph-young__ready').textContent, '12 Spiele stehen bereit');
  assert.equal(young.querySelector('a, button'), null, 'the lead is a notice — the one action is the box');
  assert.match(text(dom.app.querySelector('.ph-hub__box .hub-cta')), /Erste Session wirbeln/);
  assert.equal(dom.app.querySelectorAll('.ph-hub .btn--primary').length, 1, 'more than one primary on the page');

  const pulse = [...dom.app.querySelectorAll('.ph-hub__side .ph-locked')].map((b) => text(b));
  assert.deepEqual(pulse, ['Rundenpuls Zahlen gibt es ab der ersten Session.']);
  const locked = [...dom.app.querySelectorAll('.ph-hub__strip .ph-locked')].map((p) => text(p.querySelector('.ph-locked__title')));
  assert.deepEqual(locked, ['Pokale', 'Chronik'], 'the Regal preview must be the real one once the shelf holds games');
});

test('Programmheft P7.5: after the first session — the pulse draws, the lead says when series come', async (t) => {
  const dom = await hub(t, 'programmheft', firstRound());
  const lead = dom.app.querySelector('.ph-hub__lead .ph-lead');
  assert.ok(lead, 'no lead story after the first session');
  assert.equal(text(lead.querySelector('.ph-lead__note')), 'Serien zeigen wir ab 3 Sessions — vorher wären sie Zufall.');
  assert.ok(dom.app.querySelector('.ph-hub__side .pulse-bars'), 'the Rundenpuls does not draw from the first session');
  assert.equal(dom.app.querySelector('.ph-locked'), null, 'a locked block survived the first session');
  assert.doesNotMatch(text(dom.app.querySelector('.ph-hub__box .hub-cta')), /Erste/);
});

test('Programmheft P7.6: the demo condenses its previews and invites', async (t) => {
  const dom = await hub(t, 'programmheft', firstRound(), { demo: true });
  const lead = dom.app.querySelector('.ph-hub__lead');
  const list = lead.querySelector('nav.hub-demo');
  assert.ok(list, 'no condensed demo list');
  assert.deepEqual([...list.querySelectorAll('.hub-demo__label')].map((l) => l.textContent), ['Regal', 'Chronik', 'Pokale']);
  const invite = lead.querySelector('.hub-card--demo-invite');
  assert.ok(invite && precedes(dom, list, invite), 'the invitation does not follow the list');
  assert.equal(dom.app.querySelectorAll('.hub-card--demo-invite').length, 1, 'the invitation rendered twice');
  assert.equal(dom.app.querySelector('.ph-hub__strip .hub-preview'), null, 'the previews render beside the condensed list');
});

test('Programmheft P7.1: the empty lobby — the black box to found a round, and the columns it will fill', async (t) => {
  const dom = await lobby(t, 'programmheft', [], { onboard: true });
  const first = dom.app.querySelector('.ph-first');
  assert.ok(first, 'no Programmheft first-run block');
  const cta = first.querySelector('a.lobby-cta');
  assert.ok(cta, 'the create link is gone');
  assert.equal(text(cta.querySelector('.lobby-cta__title')), 'Neue Runde gründen');
  assert.equal(cta.querySelector('.lobby-cta__action'), null, 'the action repeats the title');
  assert.equal(dom.app.querySelectorAll('a[href="/round/new"]').length, 1, 'more than one way to found a round');
  const slots = first.querySelector('.ph-first__slots');
  assert.equal(slots.getAttribute('aria-hidden'), 'true');
  assert.equal(slots.children.length, 3);
  assert.equal(text(slots.children[0]), 'Hier erscheint deine Runde');
});

// ------------------------------------------------------------ the CSS

test('Programmheft #1377: no text is set in hair, hatch or accent below 24px', () => {
  const start = PH_CSS.indexOf('.ph-locked');
  assert.ok(start > 0, 'no #1377 section in programmheft.css');
  const own = PH_CSS.slice(start);
  const decls = [...own.matchAll(/(?:^|[;{\s])color:\s*var\((--[\w-]+)\)/g)].map((m) => m[1]);
  assert.ok(decls.length >= 5, `only ${decls.length} colour declarations found — did the parse break?`);
  for (const token of decls) assert.ok(!['--hair', '--hatch', '--accent', '--line'].includes(token), `text in ${token}`);
});
