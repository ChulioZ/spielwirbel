'use strict';

/* Der Tisch gives a YOUNG round the sheet's centrepiece (#1269, T7.1/T7.3/T7.4):
 * the empty table on a 0-game hub with a visible lock reason on the plate, the
 * „Erste Session wirbeln" invitation and a sentence per card once games exist
 * but no session does, and a second way into an empty lobby.
 *
 * Every piece is a markup branch on designIs('tisch'), so each screen is
 * rendered twice through the real view — once under Klassisch, asserting the
 * structure it has always had, and once under Der Tisch. The CSS half (where
 * the table sits in the ≥1280 band, the [hidden] guard) is pinned as text at
 * the end, since jsdom applies no stylesheet.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, bodyOf, mediaBlocks } = require('./support/css');

const game = (id) => ({ id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, createdAt: '2026-01-0' + (id % 9 + 1) + 'T10:00:00.000Z' });

const round = ({ games = 0, sessions = [] } = {}) => ({
  id: 'r1',
  name: 'Sonntagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Lea' }, { id: 'm2', name: 'Jo' }],
  games: Array.from({ length: games }, (_, i) => game(10 + i)),
  sessions,
  tags: [],
});

async function hub(t, design, r, { accounts = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('accountsActive', () => accounts);
  dom.set('api', async (method, url) => (/recommendations/.test(url) ? { recommendations: [] } : r));
  await dom.call('showRound', r.id, 'start');
  return dom;
}

const pane = (dom) => [...dom.app.children].filter((el) => !el.matches('.rail, .dock'));
const cardTitles = (dom) => [...dom.app.querySelectorAll('.hub-cards .hub-card__title')].map((el) => el.textContent.trim());

// ------------------------------------------------------------- Klassisch

// The operator widened this in the merge interview (2026-09-24): Klassisch's
// phone 0-game hub had the same dead end — a faded button whose reason was a
// `title` no touch screen shows, and no next step. So the empty table and the
// visible reason are the APP's now; only the young-round sentences stay Tisch's.
test('Klassisch 0-game hub gets the empty table and the visible reason too', async (t) => {
  const dom = await hub(t, null, round());
  const cta = pane(dom).find((el) => el.matches('.hub-cta'));
  assert.ok(cta && cta.disabled, 'the Klassisch CTA must stay a direct, disabled child of #app');
  assert.equal(cta.hasAttribute('title'), false, 'the reason is on the button now, not in a tooltip');
  assert.equal(cta.getAttribute('aria-describedby'), 'hub-cta-reason');
  assert.equal(cta.querySelector('.hub-cta__reason').textContent, 'ab dem ersten Spiel');
  const table = dom.app.querySelector('.empty--table');
  assert.ok(table, 'Klassisch shows no next step on a 0-game round');
  assert.equal(table.nextElementSibling, cta, 'the table sits right before the locked button');
  assert.equal(table.querySelectorAll('.empty__actions .btn').length, 2);
  assert.equal(dom.app.querySelector('.empty--rail-gap'), null, 'the table IS the stand-in; two would stack');
  assert.deepEqual([...dom.app.querySelectorAll('.hub-actions > *')].map((el) => el.textContent.trim()), ['Einstellungen'],
    '„Spiel hinzufügen" lives on the table now, not twice');
});

test('Klassisch with games and no session: no invitation, no sentence cards, the usual label', async (t) => {
  const dom = await hub(t, null, round({ games: 3 }));
  const cta = pane(dom).find((el) => el.matches('.hub-cta'));
  assert.equal(cta.textContent.trim(), 'Session wirbeln');
  assert.equal(dom.app.querySelector('.hub-card--young, .hub-card--sentence'), null);
  assert.deepEqual(cardTitles(dom), [], 'a young Klassisch round still meets no card at all');
});

// ------------------------------------------------------------- Der Tisch, 0 games

test('Der Tisch 0-game hub: the empty table sits between the seats and the plate, with both actions', async (t) => {
  const dom = await hub(t, 'tisch', round());
  const stage = dom.app.querySelector('.hub-stage');
  assert.deepEqual([...stage.children].map((el) => el.classList.contains('empty--table') ? 'table' : el.classList[0]),
    ['hero', 'table', 'btn'], 'hero → empty table → plate is the sheet’s reading order');
  const table = stage.querySelector('.empty--table');
  assert.equal(table.querySelector('.empty__title').textContent, 'Der Topf ist noch leer');
  assert.match(table.querySelector('.empty__text').textContent, /von BGG\.$/);
  const actions = [...table.querySelectorAll('.empty__actions > button')].map((b) => b.textContent.trim());
  assert.deepEqual(actions, ['Spiel hinzufügen', 'Von BGG übernehmen']);
  assert.equal(dom.app.querySelector('.empty--rail-gap'), null, 'the table IS the stand-in — no second empty box');
  assert.equal([...dom.app.querySelectorAll('.hub-actions > *')].some((b) => /Spiel hinzufügen/.test(b.textContent)), false,
    '„Spiel hinzufügen" is on the table — the quick action would be the same control twice');
});

test('Der Tisch 0-game hub without accounts offers no BGG import and says nothing about it', async (t) => {
  const dom = await hub(t, 'tisch', round(), { accounts: false });
  const table = dom.app.querySelector('.empty--table');
  assert.equal(table.querySelectorAll('.empty__actions > button').length, 1);
  assert.doesNotMatch(table.textContent, /BGG/);
});

test('Der Tisch empty table actions open the add-game sheet and the BGG import', async (t) => {
  const dom = await hub(t, 'tisch', round());
  const seen = [];
  dom.set('showAddGame', (r) => seen.push(['add', r.id]));
  dom.set('showBggImport', (r) => seen.push(['bgg', r.id]));
  dom.app.querySelectorAll('.empty--table .empty__actions > button').forEach((b) => b.click());
  assert.deepEqual(seen.map((x) => [...x]), [['add', 'r1'], ['bgg', 'r1']]);
});

test('Der Tisch prints the lock reason on the plate and links it as the description', async (t) => {
  const dom = await hub(t, 'tisch', round());
  const cta = dom.app.querySelector('.hub-stage > .hub-cta');
  assert.ok(cta.disabled);
  const reason = cta.querySelector('.hub-cta__reason');
  assert.ok(reason, 'no visible reason on the locked plate');
  assert.equal(reason.textContent, 'ab dem ersten Spiel', 'the copy must state the app’s real threshold — one game');
  assert.equal(cta.getAttribute('aria-describedby'), reason.id);
  assert.equal(dom.document.getElementById(reason.id), reason, 'aria-describedby must resolve');
  assert.equal(reason.getAttribute('aria-hidden'), 'true', 'the reason would otherwise join the button’s NAME');
  assert.equal(cta.title, '', 'a title would repeat the reason as a tooltip');
});

// ------------------------------------------------------------- Der Tisch, games but no session

test('Der Tisch round with games and no session: first-session label, invitation first, sentences instead of zeros', async (t) => {
  const dom = await hub(t, 'tisch', round({ games: 3 }));
  const cta = dom.app.querySelector('.hub-stage > .hub-cta');
  assert.equal(cta.disabled, false);
  assert.equal(cta.textContent.trim(), 'Erste Session wirbeln');
  assert.equal(cta.querySelector('.hub-cta__reason'), null);

  assert.deepEqual(cardTitles(dom).slice(0, 3), ['3 Spiele stehen bereit', 'Wie wär’s mit', 'Rundenpuls'],
    'the invitation leads, then the two sentence cards in the grid’s own order');
  const young = dom.app.querySelector('.hub-card--young');
  assert.equal(young.querySelectorAll('.hub-preview__cover').length, 3);
  assert.equal(young.querySelector('.hub-preview__covers').getAttribute('aria-hidden'), 'true');

  const sentences = [...dom.app.querySelectorAll('.hub-card--sentence .hub-card__facts')].map((p) => p.textContent);
  assert.deepEqual(sentences, [
    'Vorschläge gibt es ab 6 Spielen im Regal.',
    'Zahlen gibt es ab der ersten Session.', // Der Tisch draws its tiles from one session (#1280)
  ], 'each sentence must state the threshold the code actually applies');
  assert.equal(dom.app.querySelector('.pulse-tiles, .pulse-bars'), null, 'a young round drew a zero');
});

test('Der Tisch young round with a full shelf shows real suggestions, not a sentence', async (t) => {
  const dom = await hub(t, 'tisch', round({ games: 8 }));
  const suggest = [...dom.app.querySelectorAll('.hub-card')].find((c) => /Wie wär/.test(c.textContent));
  assert.ok(suggest.querySelector('.hub-row'), 'a shelf past the floor suggests games — the sentence would be false');
  assert.equal(suggest.classList.contains('hub-card--sentence'), false);
});

test('Der Tisch round that has played is not young: no invitation, no sentences, the usual label', async (t) => {
  const played = {
    id: 900, createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), done: true, finished: true,
    gameIds: [10], chosenGameId: 10, winnerIds: ['m1'], memberIds: ['m1', 'm2'], votes: {},
  };
  const dom = await hub(t, 'tisch', round({ games: 3, sessions: [played] }));
  assert.equal(dom.app.querySelector('.hub-stage > .hub-cta').textContent.trim(), 'Session wirbeln');
  assert.equal(dom.app.querySelector('.hub-card--young, .hub-card--sentence'), null,
    'a played round is past the young sentences — its later thresholds are asserted in test/tisch-young-thresholds.test.js');
});

test('a cancelled draw leaves a round young; a running one does not', async (t) => {
  const cancelled = { id: 901, createdAt: '2026-09-01T10:00:00.000Z', done: true, cancelled: true, gameIds: [10], memberIds: ['m1'], votes: {} };
  const dom = await hub(t, 'tisch', round({ games: 3, sessions: [cancelled] }));
  assert.equal(dom.app.querySelector('.hub-stage > .hub-cta').textContent.trim(), 'Erste Session wirbeln');
  assert.equal(dom.run('roundIsYoung({ sessions: [{ done: false }] })'), false);
  assert.equal(dom.run('roundIsYoung({ sessions: [] })'), true);
});

// ------------------------------------------------------------- the empty lobby

async function lobby(t, design, { loggedIn = true, demo = true, demoAccount = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async () => []);
  dom.set('accountApi', async () => ({ items: [] }));
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => loggedIn);
  dom.set('isDemoAccount', () => demoAccount);
  dom.set('withAppConfig', (cb) => cb({ demo }));
  await dom.call('showHome');
  return dom;
}

test('Klassisch empty lobby is unchanged: the create card and nothing beside it', async (t) => {
  const dom = await lobby(t, null);
  assert.ok(dom.app.querySelector('.lobby-cta'));
  assert.equal(dom.app.querySelector('.lobby-alt'), null, 'the second way in leaked into Klassisch');
});

test('Der Tisch empty lobby offers „Ich wurde eingeladen" as a link to the inbox, beside the create card', async (t) => {
  const dom = await lobby(t, 'tisch');
  const cta = dom.app.querySelector('.lobby-cta');
  const alt = dom.app.querySelector('.lobby-alt');
  assert.ok(alt, 'no second way in');
  assert.equal(cta.nextElementSibling, alt, 'a sibling right after the card — never inside the <a>');
  assert.equal(cta.contains(alt), false);
  const invited = alt.querySelector('a.lobby-alt__invited');
  assert.equal(invited.getAttribute('href'), '/inbox');
  assert.match(invited.textContent, /Ich wurde eingeladen/);
  // No demo line (operator, merge interview 2026-09-24): only a signed-in
  // account sees this lobby, and the app holds one login — viewing the demo
  // would sign a brand-new account out of itself.
  assert.equal(alt.querySelector('.lobby-alt__demo'), null, 'the demo line is gone');
  assert.equal(alt.querySelectorAll('a, button').length, 1, '„Ich wurde eingeladen" is the only second way in');
});

// ------------------------------------------------------------- the CSS half

const TISCH = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const T = ':root[data-design="tisch"][data-scheme="dark"] ';

test('tisch.css spans the empty table across the ≥1280 band', () => {
  const wide = mediaBlocks(TISCH).filter(([q]) => /min-width:\s*1280px/.test(q)).map(([, css]) => css).join('\n');
  assert.match(bodyOf(T + '.hub-stage > .empty--table', rulesOf(wide)) || '', /grid-column:\s*1\s*\/\s*-1/,
    'from 1280 the table must span the band’s grid, or it lands in the plate’s column');
});

// A locked CTA that prints its reason cannot also be faded: `.btn:disabled`'s
// 0.45 opacity put „ab dem ersten Spiel" at ~2:1. So the hub CTA reads as
// unavailable by being SUNKEN instead — Der Tisch's answer, taken for every
// design in the #1269 merge interview — with --ink-soft on --sunken,
// a pair test/a11y-contrast.test.js already measures in every theme.
const STYLES = fs.readFileSync(path.join(__dirname, '..', 'public/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('the locked hub CTA is sunken, not faded, so the reason on it is legible', () => {
  const b = bodyOf('.btn.hub-cta:disabled', rulesOf(STYLES)) || '';
  assert.match(b, /opacity:\s*1\b/, 'the fade must be undone, or the reason reads at ~2:1');
  assert.match(b, /background:\s*var\(--sunken\)/);
  assert.match(b, /border-style:\s*dashed/, 'a solid white plate reads as a live secondary button');
  assert.match(b, /color:\s*var\(--ink-soft\)/);
  assert.match(b, /box-shadow:\s*inset\b/, 'without the fade, the inset cast is what says "unavailable"');
});
