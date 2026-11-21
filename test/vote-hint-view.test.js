'use strict';

/* The vote card's taste hint on screen (#1839), through the jsdom harness
 * (.claude/rules/testing-views-under-jsdom.md): the hot-seat card in Klassisch
 * and a composed design, the seat it follows, and its absence on the shared
 * link. The derivation itself is test/vote-hint.test.js.
 *
 * jsdom applies no stylesheet, so where the line sits is held by the CSS-text
 * sweep at the end: every composed grid that names a `pitch` area must name a
 * `hint` area right under it, with a row for it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./support/dom');
const { setMotion } = require('./support/vote-card');

const TILES = ['Tile Placement', 'Pattern Building'];
const PARTY = ['Voting', 'Team-Based Game'];
const g = (id, title, mechanics, categories) => ({ id, title, mechanics, categories, minPlayers: 2, maxPlayers: 4, tagIds: [] });

const SHELF = [
  g('azul', 'Azul', TILES, ['Abstract Strategy']),
  g('patch', 'Patchwork', TILES, ['Puzzle']),
  g('sag', 'Sagrada', ['Dice Rolling', 'Pattern Building'], ['Dice']),
  g('wolf', 'Werwolf', PARTY, ['Party Game']),
  g('code', 'Codenames', PARTY, ['Party Game']),
];
// A name with markup in it: the round's own titles must arrive as text.
const CALICO = g('cal', 'Calico <b>!</b>', TILES, ['Puzzle']);
const KNOWN = SHELF[0];

// Anna has rated the shelf; Ben has rated nothing.
const roundFixture = () => ({
  id: 'r1', name: 'Donnerstagsrunde', background: null, tags: [], providers: [],
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [...SHELF, CALICO],
  sessions: [{
    id: 's0', createdAt: '2026-11-01T18:00:00.000Z', memberIds: ['m1', 'm2'], guests: [],
    votes: { m1: { azul: { rating: 5 }, patch: { rating: 5 }, sag: { rating: 4 }, wolf: { rating: 1 }, code: { rating: 2 } } },
    done: true, finished: true, cancelled: false, winnerIds: [], chosenGameId: null,
  }],
});

const sessionFixture = () => ({
  id: 's1', createdAt: '2026-11-17T18:00:00.000Z', gameIds: ['cal', 'azul'], memberIds: ['m1', 'm2'],
  guests: [], votes: {}, votedIds: [], done: false, cancelled: false, finished: false,
  winnerIds: [], chosenGameId: null,
});

const ANNA = { id: 'm1', name: 'Anna', guest: false };
const BEN = { id: 'm2', name: 'Ben', guest: false };
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

async function wizard(t, { design = null, person = ANNA, games = [CALICO, KNOWN] } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  const round = roundFixture();
  dom.set('api', async () => round);
  dom.set('currentUserId', () => null);
  await dom.call('startVoting', round, sessionFixture(), games, [person], {
    skipIntro: true, saveVotes: async () => {}, onSaved: async () => {},
  });
  return dom;
}

test('Klassisch: the hint sits under the title, names the liked games, and is plain text', async (t) => {
  const dom = await wizard(t);
  const line = dom.app.querySelector('.vote__hint');
  assert.ok(line, 'a voter with a profile sees a hint on a game they do not know');
  assert.equal(line.previousElementSibling.className, 'vote__title');
  assert.equal(text(line), 'Könnte dir gefallen – wie Patchwork und Azul');
  assert.doesNotMatch(line.textContent, /\d/, 'the hint carries no number');
});

test('Der Tisch: the hint is on the paper card, between title and meta', async (t) => {
  const dom = await wizard(t, { design: 'tisch' });
  const paper = dom.app.querySelector('.vote__card');
  const classes = [...paper.children].map((c) => c.className.split(' ')[0]);
  assert.deepEqual(classes.slice(0, 4), ['vote__img', 'vote__title', 'vote__hint', 'vote__meta']);
});

test('the hint follows the seat that is voting, and a known game gets none', async (t) => {
  assert.equal((await wizard(t, { person: BEN })).app.querySelector('.vote__hint'), null,
    'Ben has rated nothing, so nothing is said to him');
  assert.equal((await wizard(t, { games: [KNOWN] })).app.querySelector('.vote__hint'), null,
    'Anna rated Azul herself');
  assert.equal((await wizard(t, { person: { id: 'g:x', name: 'Gast', guest: true } })).app.querySelector('.vote__hint'), null,
    'a guest has no history in the round');
});

test('a name in the hint is escaped, never markup', async (t) => {
  // Calico is the candidate, so to have it NAMED it must be a liked game:
  // vote on Kingdomino instead with Calico rated.
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  const round = roundFixture();
  round.sessions[0].votes.m1.cal = { rating: 5 };
  const kingdomino = g('kd', 'Kingdomino', TILES, ['Puzzle']);
  round.games.push(kingdomino);
  dom.set('api', async () => round);
  dom.set('currentUserId', () => null);
  await dom.call('startVoting', round, sessionFixture(), [kingdomino], [ANNA], {
    skipIntro: true, saveVotes: async () => {}, onSaved: async () => {},
  });
  const line = dom.app.querySelector('.vote__hint');
  assert.ok(line.textContent.includes('Calico <b>!</b>'));
  assert.equal(line.children.length, 0, 'markup in a title became an element');
});

test('the shared-link card never shows a hint', (t) => {
  for (const design of [null, 'tisch']) {
    const dom = loadApp({ locale: 'de' });
    t.after(() => dom.close());
    setMotion(dom, true);
    if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
    const ballot = {
      roundName: 'Donnerstagsrunde', demo: false,
      games: [{ id: 'cal', title: 'Calico', minPlayers: 2, maxPlayers: 4, pitch: null }],
      people: [{ id: 'm1', name: 'Anna', color: null, hasVoted: false, linked: true }],
    };
    dom.call('renderVoteLinkCards', 'tok', ballot, ballot.people[0]);
    assert.ok(dom.app.querySelector('.vote__title'), 'the card rendered');
    assert.equal(dom.app.querySelector('.vote__hint'), null);
  }
});

/* ------------------------- CSS: the grid's hint area --------------------- */

// A composed grid naming `pitch` but no `hint` would auto-place the hint after
// the faces; one naming both with too few rows would shift every later area.
test('every composed vote-card grid names a hint area under the pitch, with a row for it', () => {
  const dir = path.join(__dirname, '..', 'public', 'css', 'designs');
  let checked = 0;
  const wrong = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]*\.vote__card[^{}]*)\{([^}]*)\}/g)) {
      const areas = (m[2].match(/grid-template-areas:([^;]*);/) || [])[1];
      if (!areas || !/\bpitch\b/.test(areas)) continue;
      checked += 1;
      const rows = [...areas.matchAll(/"([^"]*)"/g)].map((r) => r[1].trim().split(/\s+/));
      const at = rows.findIndex((r) => r.includes('pitch'));
      const col = rows[at].indexOf('pitch');
      if (!rows[at + 1] || rows[at + 1][col] !== 'hint') wrong.push(`${file}: no hint under pitch — ${m[1].trim()}`);
      const tpl = (m[2].match(/grid-template-rows:([^;]*);/) || [])[1];
      if (tpl && tpl.trim().split(/\s+/).length !== rows.length) wrong.push(`${file}: ${rows.length} area rows, rows template ${tpl.trim()}`);
    }
  }
  assert.ok(checked >= 10, `only ${checked} vote-card grids found — the sweep is not seeing the designs`);
  assert.deepEqual(wrong, []);
});

test('Klassisch pins the hint to its own row in the split grid', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const pin = (sel) => Number((css.match(new RegExp(`\\.vote--split ${sel} \\{ grid-row: (\\d+); \\}`)) || [])[1]);
  assert.equal(pin('\\.vote__hint'), pin('\\.vote__pitch') + 1);
  assert.equal(pin('\\.vote__q'), pin('\\.vote__hint') + 1);
});

test('on a phone the hint row takes its height out of the elastic cover', () => {
  // Measured at 390x640 (#1839): pitch + hint ran 8px past the fold without it.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const base = css.match(/\.vote \.vote__img \{[^}]*calc\(100svh - (\d+)px\)/);
  const withHint = css.match(/\.vote:has\(\.vote__hint\) \.vote__img \{[^}]*calc\(100svh - (\d+)px\)/);
  assert.ok(base && withHint, 'both cover heights are declared');
  assert.ok(Number(withHint[1]) - Number(base[1]) >= 18, `the hint row needs 18px, got ${withHint[1] - base[1]}`);
});
