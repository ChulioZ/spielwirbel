'use strict';

/* No vote surface prints a digit of the 1–5 scale (#1530).

   A rung is its FACE and its WORD. The digit went because a voter who pressed
   „4" and „5" expects the game's score to be their mean, and the
   Spielwirbel-Score deliberately is not (vote-score.js weights the bottom rung
   and shrinks thin evidence). With no digit on any vote there is no average to
   compute, so nothing to mismatch.

   One sweep per surface, across every design that can be worn — the hot-seat
   card, the shared-link card, the review step, the results distribution and
   the landing page's picture of the card. A digit can come back through the
   visible text OR the accessible name, so both are read: a „4 von 5" moved into
   `aria-label` is the same digit, announced instead of printed.

   Seen red against the pre-#1530 markup (the `.mood__n` / `.vote-review__n` /
   `.bar-axis__n` spans and the „{n} von {max}" labels put back) — see the PR. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { setMotion, beat } = require('./support/vote-card');

const DESIGNS = ['klassisch', 'tisch', 'ocean', 'bruecke', 'programmheft', 'forest'];
const DIGIT = /[1-5]/;

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cleo' }];
const GAMES = [
  { id: 'g1', title: 'Kartographen', minPlayers: 2, maxPlayers: 5 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
];
const roundFixture = (sessions = []) => ({
  id: 'r1', name: 'Donnerstagsrunde', background: null,
  members: MEMBERS.map((m) => ({ ...m })), games: GAMES.map((g) => ({ ...g })),
  sessions, tags: [], activity: [],
});
const openSession = () => ({
  id: 's1', createdAt: '2026-09-24T18:00:00.000Z', gameIds: ['g1', 'g2'],
  memberIds: ['m1', 'm2', 'm3'], guests: [], votes: {}, votedIds: [],
  done: false, cancelled: false, finished: false, winnerIds: [], chosenGameId: null,
});

function boot(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  dom.set('currentUserId', () => null);
  dom.call('applyDesign', design);
  return dom;
}

// Every place a face or a chip states its rung: its text and its name.
const spoken = (el) => `${el.textContent} | ${el.getAttribute('aria-label') || ''}`;

function assertNoDigits(els, where) {
  assert.ok(els.length >= 5, `${where}: only ${els.length} elements found — the sweep would be vacuous`);
  for (const el of els) assert.doesNotMatch(spoken(el), DIGIT, `${where} states a digit: „${spoken(el).trim()}"`);
}

async function wizard(t, design) {
  const dom = boot(t, design);
  dom.set('api', async () => roundFixture());
  await dom.call('startVoting', roundFixture(), openSession(), GAMES, [MEMBERS[0]], {
    skipIntro: true, saveVotes: async () => {}, onSaved: async () => {},
  });
  return dom;
}

test('the hot-seat card: every face is its glyph and its word, in every design', async (t) => {
  for (const design of DESIGNS) {
    const dom = await wizard(t, design);
    const faces = [...dom.app.querySelectorAll('.rating .mood')];
    assertNoDigits(faces, `${design}: hot-seat face`);
    // The word is in the DOM under every face, even where a design's sheet
    // prints only the two ends (Ocean, Die Brücke) — it is the face's name.
    for (const f of faces) {
      const word = f.querySelector('.mood__word');
      assert.ok(word && word.textContent.trim(), `${design}: a face has no word`);
      assert.equal(f.getAttribute('aria-label'), word.textContent, `${design}: the name is not the word alone`);
    }
  }
});

test('the shared-link card: no digit in any design', (t) => {
  const BALLOT = {
    roundName: 'Donnerstagsrunde', demo: false, games: GAMES,
    people: [{ id: 'm1', name: 'Anna', color: null, hasVoted: false, linked: false }],
  };
  for (const design of DESIGNS) {
    const dom = boot(t, design);
    dom.call('renderVoteLinkCards', 'tok', BALLOT, BALLOT.people[0]);
    assertNoDigits([...dom.app.querySelectorAll('.rating .mood')], `${design}: link face`);
  }
});

test('the review step: each row names its rating by the word, never the digit', async (t) => {
  for (const design of DESIGNS) {
    const dom = await wizard(t, design);
    for (const n of [4, 2]) {
      dom.app.querySelectorAll('.rating .mood')[n - 1].click();
      await beat(dom);
    }
    const chips = [...dom.app.querySelectorAll('.vote-review__rating')];
    assert.equal(chips.length, 2, `${design}: no review rows`);
    assert.deepEqual(chips.map((c) => c.textContent.trim()), ['gern', 'eher nicht'], `${design}: the chips`);
    const rows = [...dom.app.querySelectorAll('.vote-review__row')];
    for (const r of rows) assert.doesNotMatch(r.getAttribute('aria-label'), DIGIT, `${design}: a row's name states a digit`);
  }
});

test('the results distribution: the axis is the face alone, the tooltip names the rung by its word', async (t) => {
  const done = {
    ...openSession(), done: true, finished: true, votedIds: ['m1', 'm2', 'm3'],
    finishedAt: '2026-09-24T22:00:00.000Z', chosenGameId: 'g1', events: [],
    votes: { m1: { g1: { rating: 5 }, g2: { rating: 2 } }, m2: { g1: { rating: 4 }, g2: { rating: 3 } }, m3: { g1: { rating: 5 }, g2: { rating: 1 } } },
  };
  const round = roundFixture([done]);
  for (const design of DESIGNS) {
    const dom = boot(t, design);
    dom.set('showSessionLobby', () => {});
    dom.set('api', async () => round);
    await dom.call('showResults', round, done);
    await flush();
    const cols = [...dom.app.querySelectorAll('.bar-col')];
    assert.ok(cols.length >= 5, `${design}: no distribution rendered`);
    for (const c of cols) {
      assert.doesNotMatch(c.querySelector('.bar-axis').textContent, /\S/, `${design}: the axis prints text`);
      // The tooltip carries the COUNT (a number of votes, not a rung) and the word.
      assert.match(c.getAttribute('title'), /^\d+× „.+“$/, `${design}: the tooltip is „N× „word““`);
      assert.doesNotMatch(c.getAttribute('title').replace(/^\d+× /, ''), DIGIT, `${design}: the tooltip states the rung's digit`);
    }
  }
});

test('the landing page\'s picture of the card has no digits either', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => { dom.run('stopLandingMoments()'); dom.close(); });
  const stage = dom.call('renderLandingMoments');
  dom.app.appendChild(stage);
  const faces = [...stage.querySelectorAll('.lm-scene--vote .rating .mood')];
  assertNoDigits(faces, 'landing face');
  assert.deepEqual(faces.map((f) => f.querySelector('.mood__word').textContent),
    ['gar nicht', 'eher nicht', 'wäre okay', 'gern', 'unbedingt']);
});
