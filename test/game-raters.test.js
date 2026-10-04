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
  // No numeric average on the tile (#1530): a „3,5" beside the score invites
  // the arithmetic the score deliberately does not do. The face carries it, a
  // screen reader hears the face's word, and the tooltip still counts votes.
  for (const tile of strip) {
    assert.doesNotMatch(tile.textContent, /\d/, `a rater tile prints a digit: „${tile.textContent.trim()}"`);
  }
  assert.equal(first.querySelector('.sr-only').textContent, 'gern', 'Ada\'s 4 is read out as its word');
  assert.match(first.getAttribute('title'), /Bewertung/, 'the vote count stays in the tooltip');
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

/* ------------------------------------------------------------ the strip's rows

   Four people read 3+1 at 390 in Ocean, Die Brücke and Forest, and five read 4+1
   wherever four tracks fit (audit 2026-10-04 U3). Pixels are not assertable here
   — jsdom applies no external stylesheet — so the sheet is read as text and every
   number is DERIVED from the two the strip declares, its track floor and its gap:
   the width bands, the track count in each, and the row break each count needs.
   A retune of either number, or one break written at the wrong child, goes red. */

const fs = require('node:fs');
const path = require('node:path');

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function stripSpec() {
  const rule = /\.raters\s*\{([^}]*)\}/.exec(SHEET);
  assert.ok(rule, 'the .raters rule is gone');
  const floor = Number(/minmax\((\d+)px,\s*1fr\)/.exec(rule[1])[1]);
  const gap = Number(/(?:^|[\s;])gap:\s*(\d+)px/.exec(rule[1])[1]);
  assert.match(rule[1], /container-type:\s*inline-size/, 'the breaks query the strip\'s own width');
  return { floor, gap };
}

// Every `@container (...) { ... }` block that breaks rows: its width band, and
// the child each "exactly n" count starts its second row at.
function bands() {
  const out = [];
  const re = /@container\s*\(([^{]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(SHEET))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; depth && i < SHEET.length; i++) depth += SHEET[i] === '{' ? 1 : SHEET[i] === '}' ? -1 : 0;
    const body = SHEET.slice(re.lastIndex, i - 1);
    const lo = /(\d+)px\s*<=\s*width/.exec(m[1]);
    const hi = /width\s*<\s*(\d+)px/.exec(m[1]);
    const breaks = {};
    for (const [, n, k] of body.matchAll(/\.rater:first-child:nth-last-child\((\d+)\)\s*~\s*\.rater:nth-child\((\d+)\)/g)) {
      breaks[n] = Number(k);
    }
    if (Object.keys(breaks).length) {
      assert.match(body, /grid-column-start:\s*1/, `the ${m[1]} band names its breaks but starts no row`);
      out.push({ lo: lo ? Number(lo[1]) : 0, hi: hi ? Number(hi[1]) : Infinity, breaks });
    }
  }
  return out;
}

test('the rater strip fits four people in every design\'s phone column', () => {
  const { floor, gap } = stripSpec();
  // The strips measured at 390 (2026-10-04): Ocean's and Die Brücke's padded
  // panels 320px, Forest's 330, the rest 362 — and Forest's desktop strip 312.
  for (const width of [312, 320, 330, 362]) {
    const tracks = Math.floor((width + gap) / (floor + gap));
    assert.ok(tracks >= 4, `a ${width}px strip holds ${tracks} tracks — four people wrap ${tracks}+${4 - tracks}`);
  }
});

test('each width band breaks its rows where they fill evenly, for up to eight people', () => {
  const { floor, gap } = stripSpec();
  const edge = (k) => k * floor + (k - 1) * gap; // where k tracks begin to fit
  const got = bands();
  assert.ok(got.length >= 5, `only ${got.length} @container bands found — did the block move?`);
  for (const { lo, hi, breaks } of got) {
    const m = Math.floor((hi + gap) / (floor + gap)) - 1; // tracks inside the band
    if (lo) assert.equal(lo, edge(m), `a band starts at ${lo}px, but ${m} tracks begin at ${edge(m)}px`);
    assert.equal(hi, edge(m + 1), `the ${m}-track band must end where ${m + 1} tracks begin`);
    // As many rows as m tracks need, and as few columns as fill them.
    const want = {};
    for (let n = m + 1; n <= 8; n++) {
      const cols = Math.ceil(n / Math.ceil(n / m));
      if (cols < m) want[n] = cols + 1;
    }
    assert.deepEqual({ ...breaks }, want, `the ${m}-track band (${lo}–${hi}px) breaks the wrong rows`);
  }
  // …and every band that NEEDS a break has a block at all.
  const covered = new Set(got.map(({ hi }) => hi));
  for (let m = 3; m <= 7; m++) assert.ok(covered.has(edge(m + 1)), `no band for ${m} tracks`);
});
