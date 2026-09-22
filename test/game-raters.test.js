'use strict';

/* „Wer wie gewertet hat" on the Spielepass (#1190) — who is behind the number
 * the page prints, as one tile per person.
 *
 * The section is NEW, so the red these assertions need is the test-first one and
 * it was taken by reverting the feature: with `gameRaters` and its block removed,
 * five of the six below fail by name
 * (`.claude/rules/break-the-code-on-purpose.md`, route 1).
 *
 * The fixture is built around the ONE decision the issue could not settle on its
 * own: a person's figure is their MEAN across sessions, not their latest vote
 * (operator, 2026-09-22). So Anna rates the same game 5 and then 2 — the two
 * readings disagree (3,5 against 2,0) and the assertion can tell them apart. A
 * fixture where everyone voted once would pass against either.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [
      { id: 'm1', name: 'Anna' },
      { id: 'm2', name: 'Ben' },
      // Ties with Ben at 3,0 — and sorts BEFORE him, which is the only thing
      // that exercises the comparator's second key. Without a tie the
      // „broken by name" half of the test below is a claim, not a measurement.
      { id: 'm4', name: 'Ada' },
      // Rates nothing — a member who was there and did not vote must not get a
      // tile, or the strip claims a rating nobody gave.
      { id: 'm3', name: 'Cleo' },
    ],
    games: [
      { id: 'g1', title: 'Catan', image: '/uploads/catan.jpg', tagIds: [] },
      // Drawn in a session, rated by nobody: the strip must not render at all.
      // This is a DIFFERENT condition from "no sessions", which is why it has
      // its own game rather than being asserted on a sparse one.
      { id: 'g2', title: 'Azul', image: '/uploads/azul.jpg', tagIds: [] },
    ],
    sessions: [
      {
        id: 's1', createdAt: '2026-06-01T19:00:00.000Z', finished: true,
        gameIds: ['g1', 'g2'], chosenGameId: 'g1', winnerIds: ['m1'],
        memberIds: ['m1', 'm2', 'm3', 'm4'],
        guests: [{ id: 'gu1', name: 'Dora' }],
        votes: {
          m1: { g1: { rating: 5 } },
          m2: { g1: { rating: 3 } },
          m4: { g1: { rating: 3 } },
          gu1: { g1: { rating: 4 } },
        },
      },
      {
        id: 's2', createdAt: '2026-06-08T19:00:00.000Z', finished: true,
        gameIds: ['g1'], chosenGameId: 'g1', winnerIds: ['m2'],
        memberIds: ['m1', 'm2'],
        // A guest at a SECOND evening, sharing Dora's name. The app has no
        // cross-session guest identity, so this is a second person and a second
        // tile — asserted below, because silently merging them by name is the
        // tempting shortcut.
        guests: [{ id: 'gu2', name: 'Dora' }],
        votes: {
          m1: { g1: { rating: 2 } },
          gu2: { g1: { rating: 1 } },
        },
      },
    ],
  };
}

function bootApp(t_) {
  const dom = loadApp();
  t_.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  return { dom, round };
}

const tiles = (dom) => [...dom.app.querySelectorAll('.gd-raters .rater')];

test('a person\'s figure is their MEAN across sessions, not their latest vote', async (t_) => {
  const { dom, round } = bootApp(t_);
  const rows = await dom.call('gameRaters', round, 'g1');
  const anna = rows.find((r) => r.person.id === 'm1');
  assert.ok(anna, 'Anna rated g1 twice and must appear');
  assert.equal(anna.n, 2, 'both of Anna\'s votes are counted');
  assert.equal(anna.avg, 3.5, 'Anna voted 5 then 2 — the mean is 3,5 (her latest is 2)');
  // The mood is one of five glyphs, so the mean is rounded for the FACE only.
  assert.equal(anna.face, 4, '3,5 rounds to the 4 face while the figure stays 3,5');
});

test('the strip counts exactly the votes the game\'s own score counts', async (t_) => {
  const { dom, round } = bootApp(t_);
  const rows = await dom.call('gameRaters', round, 'g1');
  const raw = await dom.call('rawGameStats', round, 'g1');
  /* The row exists to explain the number above it, so the two must be built
     from the same votes. Summing the per-person means back up weighted by each
     person's count has to return the game's own mean — which is the property
     that breaks the moment either side changes who it admits. */
  const votes = rows.reduce((a, r) => a + r.n, 0);
  const total = rows.reduce((a, r) => a + r.avg * r.n, 0);
  assert.equal(votes, raw.count, 'the strip and the score admit the same votes');
  assert.ok(Math.abs(total / votes - raw.avg) < 1e-9,
    `the strip averages to ${(total / votes).toFixed(3)}, the game to ${raw.avg.toFixed(3)}`);
});

test('a guest gets a tile, and two evenings\' guests are two people', async (t_) => {
  const { dom, round } = bootApp(t_);
  const rows = await dom.call('gameRaters', round, 'g1');
  const doras = rows.filter((r) => r.person.name === 'Dora');
  assert.equal(doras.length, 2, 'the app has no cross-session guest identity — these are two visitors');
  assert.ok(doras.every((r) => r.person.guest), 'both are marked as guests');
  assert.deepEqual([...doras.map((r) => r.avg)].sort(), [1, 4]);
  // A member who was present and did not rate has nothing to show.
  assert.equal(rows.find((r) => r.person.id === 'm3'), undefined, 'Cleo rated nothing');
});

test('the tiles run warmest first, and a tie is broken by name rather than by insertion', async (t_) => {
  const { dom, round } = bootApp(t_);
  const rows = await dom.call('gameRaters', round, 'g1');
  assert.deepEqual([...rows.map((r) => r.avg)], [4, 3.5, 3, 3, 1]);
  // The tie, named: Ada and Ben both average 3,0 and Ada comes first.
  assert.deepEqual([...rows.filter((r) => r.avg === 3).map((r) => r.person.name)], ['Ada', 'Ben']);
});

test('the Spielepass renders a tile per rater, with the app\'s own five moods', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const strip = tiles(dom);
  assert.equal(strip.length, 5, 'one tile per person who rated it');

  const first = strip[0];
  assert.ok(first.querySelector('.avatar'), 'the tile carries the person\'s avatar');
  assert.match(first.querySelector('.rater__n').textContent.trim(), /^[1-5](,\d)?$/);
  // The faces are the app's, resolved through ratingFace — never a set of this
  // screen's own (rating-faces.js's header: a second copy is what drifts).
  const moods = await dom.get('MOODS');
  const face = first.querySelector('.rater__face');
  assert.ok(moods.some((m) => face.classList.contains(m)),
    `the mood glyph „${face.className}" is not one of the app's five`);

  // A guest is named as one wherever they appear (personLabel), here in the
  // tile's own text rather than only in its tooltip.
  assert.ok(strip.some((el) => /Gast/.test(el.textContent)), 'a guest tile is marked as a guest');
});

test('a game drawn but never rated renders no strip at all', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g2');
  assert.equal(dom.app.querySelector('.gd-raters'), null,
    'an empty heading over an empty strip is the emptiness this screen avoids');
});
