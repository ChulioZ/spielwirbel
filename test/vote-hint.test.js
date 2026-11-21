'use strict';

/* The vote card's taste hint (#1839): public/js/vote-hint.js, required into
 * Node with its siblings injected. Where it is drawn is
 * test/vote-hint-view.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const hint = require('../public/js/vote-hint');
const vector = require('../public/js/taste-vector');
const { tasteAverages } = require('../public/js/taste-neighbour');
const { isNameableGame } = require('../public/js/recap');
const { creditedDesigners } = require('../public/js/provider-info-fields');
const recommend = require('../lib/recommend');

const { personRatings } = require('../public/js/session-ratings');
const DEPS = { tasteAverages, isNameableGame, personRatings, creditedDesigners, ...vector };
const { voteTasteHint, voterTasteProfile, tasteMatch } = hint;
const run = (round, mid, game) => voteTasteHint(round, mid, game, DEPS);

const TILES = ['Tile Placement', 'Pattern Building'];
const PARTY = ['Voting', 'Team-Based Game'];

const game = (id, title, mechanics, categories = [], extra = {}) => ({ id, title, mechanics, categories, ...extra });

// Five rated games with metadata: three the voter likes (tile-laying), two
// they do not (party games).
const SHELF = () => [
  game('azul', 'Azul', TILES, ['Abstract Strategy'], { designers: ['Michael Kiesling'] }),
  game('patch', 'Patchwork', TILES, ['Puzzle']),
  game('sag', 'Sagrada', ['Dice Rolling', 'Pattern Building'], ['Dice']),
  game('wolf', 'Werwolf', PARTY, ['Party Game']),
  game('code', 'Codenames', PARTY, ['Party Game', 'Word Game']),
];
const RATINGS = { azul: 5, patch: 5, sag: 4, wolf: 1, code: 2 };

function roundWith({ extraGames = [], ratings = RATINGS, sessions = [] } = {}) {
  const votes = { m1: {} };
  Object.keys(ratings).forEach((gid) => { votes.m1[gid] = { rating: ratings[gid] }; });
  return {
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [...SHELF(), ...extraGames],
    sessions: [{ id: 's0', votes, memberIds: ['m1', 'm2'], chosenGameId: null }, ...sessions],
  };
}

const CALICO = game('cal', 'Calico', TILES, ['Puzzle']);

test('a tile-layer the voter has never seen names the two liked games that share the most', () => {
  const round = roundWith({ extraGames: [CALICO] });
  // Patchwork first: it shares both mechanics AND the Puzzle category, Azul
  // only the mechanics. Sagrada (one mechanic) is the third and is cut.
  assert.deepEqual(run(round, 'm1', CALICO).map((g) => g.title), ['Patchwork', 'Azul']);
});

test('a game like the ones the voter dislikes gets no hint — there is no negative one', () => {
  const party = game('dix', 'Just One', PARTY, ['Party Game']);
  const round = roundWith({ extraGames: [party] });
  assert.equal(run(round, 'm1', party), null);
  // The match is real and low, not merely absent.
  const profile = voterTasteProfile(round, 'm1', DEPS);
  assert.ok(tasteMatch(profile, party, DEPS) < hint.TASTE_HINT_MIN_MATCH);
});

test('below the evidence floor nothing is said, at the floor it is', () => {
  const four = { azul: 5, patch: 5, sag: 4, wolf: 1 };
  assert.equal(run(roundWith({ extraGames: [CALICO], ratings: four }), 'm1', CALICO), null);
  assert.equal(hint.TASTE_HINT_MIN_RATED, 5);
  assert.ok(run(roundWith({ extraGames: [CALICO] }), 'm1', CALICO));
});

test('a rated game without metadata does not count towards the floor', () => {
  const bare = game('bare', 'Ohne Daten', []);
  const ratings = { azul: 5, patch: 5, sag: 4, wolf: 1, bare: 5 };
  const round = roundWith({ extraGames: [bare, CALICO], ratings });
  assert.equal(run(round, 'm1', CALICO), null);
});

test('no hint when every rated game sits at or below the neutral face', () => {
  const flat = { azul: 3, patch: 3, sag: 2, wolf: 1, code: 1 };
  assert.equal(run(roundWith({ extraGames: [CALICO], ratings: flat }), 'm1', CALICO), null);
});

test('a game rated exactly at the neutral face is never named', () => {
  // Azul shares both mechanics with Calico — more than Sagrada's one — so it
  // would be named second if a neutral rating counted as liked.
  const ratings = { ...RATINGS, azul: 3 };
  const round = roundWith({ extraGames: [CALICO], ratings });
  assert.deepEqual(run(round, 'm1', CALICO).map((g) => g.id), ['patch', 'sag']);
});

test('a liked game that shares nothing with the candidate is not named', () => {
  const own = (id, mech, rating) => [game(id, id, [mech], ['Cat-' + id]), rating];
  const rows = [own('x1', 'X', 5), own('y1', 'Y', 5), own('z1', 'Z', 1), own('z2', 'Z', 1), own('z3', 'Z', 2)];
  const round = {
    members: [{ id: 'm1', name: 'Anna' }],
    games: rows.map((r) => r[0]),
    sessions: [{ id: 's0', memberIds: [], votes: { m1: Object.fromEntries(rows.map(([g, r]) => [g.id, { rating: r }])) } }],
  };
  const candidate = game('cx', 'Kandidat', ['X'], []);
  assert.deepEqual(run(round, 'm1', candidate).map((g) => g.id), ['x1']);
});

test('a weak match below the threshold says nothing, even with a shared value', () => {
  // Shares Tile Placement with two liked games, but leans on the party games
  // the voter dislikes: a real, positive, small match.
  const mixed = game('mix', 'Gemischt', ['Tile Placement', 'Voting'], ['Party Game']);
  const round = roundWith({ extraGames: [mixed] });
  const m = tasteMatch(voterTasteProfile(round, 'm1', DEPS), mixed, DEPS);
  assert.ok(m > 0 && m < hint.TASTE_HINT_MIN_MATCH, `match ${m}`);
  assert.equal(run(round, 'm1', mixed), null);
});

test('a game the voter has rated or played gets no hint', () => {
  // Rated: Azul itself is a liked tile-layer, i.e. the strongest possible match.
  const round = roundWith();
  assert.equal(run(round, 'm1', round.games[0]), null);
  // Played without a rating: a seat at the evening Calico was chosen.
  const played = roundWith({
    extraGames: [CALICO],
    sessions: [{ id: 's1', votes: {}, memberIds: ['m1'], chosenGameId: 'cal' }],
  });
  assert.equal(run(played, 'm1', CALICO), null);
  // …but someone ELSE's evening with it does not make it known to this voter,
  // and neither does a cancelled one.
  const others = roundWith({
    extraGames: [CALICO],
    sessions: [
      { id: 's1', votes: {}, memberIds: ['m2'], chosenGameId: 'cal' },
      { id: 's2', votes: {}, memberIds: ['m1'], chosenGameId: 'cal', cancelled: true },
    ],
  });
  assert.ok(run(others, 'm1', CALICO));
});

test('a game with no mechanics and no categories gets no hint, even from a designer', () => {
  const byDesigner = game('dsg', 'Kiesling-Spiel', [], [], { designers: ['Michael Kiesling'] });
  assert.equal(run(roundWith({ extraGames: [byDesigner] }), 'm1', byDesigner), null);
});

test('a guest seat, a missing id, or a member with no ratings gets nothing', () => {
  const round = roundWith({ extraGames: [CALICO] });
  assert.equal(run(round, 'g:guest', CALICO), null);
  // …even a guest seat that has voted on the whole shelf: only round members
  // carry a history here.
  round.sessions[0].votes['g:guest'] = { ...round.sessions[0].votes.m1 };
  assert.ok(run(round, 'm1', CALICO), 'the same votes do speak for a member');
  assert.equal(run(round, 'g:guest', CALICO), null);
  assert.equal(run(round, undefined, CALICO), null);
  assert.equal(run(round, 'm2', CALICO), null);
});

test('a retired game neither counts towards the floor nor is named', () => {
  const round = roundWith({ extraGames: [CALICO] });
  round.games.find((g) => g.id === 'azul').retired = true;
  // Four nameable rated games are left: under the floor.
  assert.equal(run(round, 'm1', CALICO), null);
});

test('at most two names, and only liked games that share a value', () => {
  const ratings = { ...RATINGS, kingd: 5 };
  const kingdomino = game('kingd', 'Kingdomino', TILES, ['Puzzle']);
  const round = roundWith({ extraGames: [kingdomino, CALICO], ratings });
  const named = run(round, 'm1', CALICO).map((g) => g.id);
  assert.equal(named.length, hint.TASTE_HINT_NAMES);
  named.forEach((id) => assert.ok(!['wolf', 'code'].includes(id)));
});

test('the recommender and the hint use the one shared vector math', () => {
  // lib/recommend.js no longer defines its own copy: the module it requires is
  // this one, so a change to either is a change to both.
  const src = require('node:fs').readFileSync(require.resolve('../lib/recommend'), 'utf8');
  assert.match(src, /require\('\.\.\/public\/js\/taste-vector'\)/);
  assert.doesNotMatch(src, /^function (accumulate|normalize|prefixSums|attainable|cosine)\b/m);
  assert.equal(typeof recommend.recommend, 'function');
  // The rescale still saturates for a candidate carrying only the strongest value.
  const vec = vector.normalize({ a: 3, b: 1 });
  assert.equal(vector.cosine(vec, ['a'], vector.prefixSums(vec)), 1);
});
