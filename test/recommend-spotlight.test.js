'use strict';

/* The three spotlight tiles (#1228): one game each, re-scored with ONE term
 * deliberately altered. Kept out of test/recommend.test.js, which is already a
 * catalogue of per-term isolation cases well over its budget; these cases share
 * a different fixture (test/support/spotlight-corpus.js) whose whole point is
 * that every term varies at once.
 *
 * Each variant is asserted in the isolation shape .claude/rules/
 * recommendation-scoring.md §1 prescribes — against the TERM it alters, never
 * only "some game came back" — and each hard filter is asserted on a candidate
 * that would otherwise have WON the tile and sits outside the main list, so the
 * no-repeat rule cannot be what hides it
 * (.claude/rules/redundant-guards-make-each-other-untestable.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  recommend,
  buildProfile,
  scoreCandidate,
  complexityDirection,
  hiddenRatingsThreshold,
  MIN_PROFILE_GAMES,
} = require('../lib/recommend');
const { spotlightShelf, spotlightCandidates, row, baseInfo } = require('./support/spotlight-corpus');

const corpusOf = () => {
  const { round, rows } = spotlightShelf();
  return { round, corpus: [...rows, ...spotlightCandidates()] };
};
const profileOf = (round, corpus) => buildProfile(round, new Map(corpus.map((e) => [String(e.externalId), e])));
const spot = (result, key) => result.spotlights.find((s) => s.key === key);
const termValue = (profile, entry, term) => scoreCandidate(profile, entry).terms.find((t) => t.term === term).value;
const tasteSum = (profile, entry) =>
  ['mechanics', 'categories'].reduce((n, term) => n + (termValue(profile, entry, term) ?? 0.5), 0);

/* ------------------------------ the base list ------------------------------ */

test('the MAIN list is byte-identical to the pre-#1228 output', () => {
  // Captured from lib/recommend.js at c9a5ccf, before any spotlight code
  // existed. The variants are derived from the base score and from a COPY of the
  // profile; a variant leaking into either would move a score in the third
  // decimal or reorder this list, and the hash covers the reason lines too.
  const { round, corpus } = corpusOf();
  const recs = recommend(round, corpus).recommendations;
  assert.deepEqual(recs.map((r) => [r.externalId, r.score]), [
    ['c93', 0.83], ['c57', 0.814], ['c142', 0.733], ['c22', 0.721], ['c41', 0.716], ['c79', 0.691],
    ['c152', 0.69], ['c157', 0.688], ['c75', 0.672], ['c149', 0.66], ['c9', 0.658], ['c18', 0.653],
    ['c45', 0.65], ['c108', 0.646], ['c48', 0.609], ['c74', 0.607], ['c69', 0.606], ['c2', 0.603],
    ['c106', 0.602], ['c59', 0.598], ['c156', 0.589], ['c29', 0.584], ['c11', 0.581], ['c27', 0.577],
  ]);
  assert.equal(
    crypto.createHash('sha256').update(JSON.stringify(recs)).digest('hex'),
    '39d55197539920e21f1d15a74e13945017e5ec1554bb530f377aee7f806bfb6c',
  );
});

test('three tiles, each a distinct game, none of them in the visible list', () => {
  const { round, corpus } = corpusOf();
  const res = recommend(round, corpus);
  assert.deepEqual(res.spotlights.map((s) => s.key), ['different', 'complexityUp', 'hidden']);
  const listed = new Set(res.recommendations.map((r) => r.externalId));
  const ids = res.spotlights.map((s) => s.externalId);
  assert.equal(new Set(ids).size, 3, 'no two tiles show the same game');
  ids.forEach((id) => assert.ok(!listed.has(id), `${id} is already in the main list`));
  // The same row shape as the list, so the client builds both with one card.
  res.spotlights.forEach((s) => {
    assert.ok(Array.isArray(s.reasons));
    assert.equal(typeof s.title, 'string');
    assert.ok('image' in s && 'weight' in s && 'maxPlaytime' in s);
  });
});

test('a variant whose best is IN the list falls through to its next-best', () => {
  const { round, corpus } = corpusOf();
  // At limit 1 the complexity tile gets its first choice. Grow the list until
  // that choice is on it — the tile must then move, not repeat it.
  const first = spot(recommend(round, corpus, { limit: 1 }), 'complexityUp').externalId;
  let limit = 2;
  let res;
  for (; limit <= 80; limit += 1) {
    res = recommend(round, corpus, { limit });
    if (res.recommendations.some((r) => r.externalId === first)) break;
  }
  assert.ok(limit <= 80, 'the fixture must actually put the first choice on the list');
  const now = spot(res, 'complexityUp');
  assert.ok(now, 'the tile survives by falling through');
  assert.notEqual(now.externalId, first);
  assert.ok(!res.recommendations.some((r) => r.externalId === now.externalId));
});

/* ------------------------------- the variants ------------------------------ */

test('DIFFERENT: its winner scores worse on the taste terms than the list\'s winner', () => {
  const { round, corpus } = corpusOf();
  const res = recommend(round, corpus);
  const profile = profileOf(round, corpus);
  const byId = new Map(corpus.map((e) => [e.externalId, e]));
  const tile = byId.get(spot(res, 'different').externalId);
  const top = byId.get(res.recommendations[0].externalId);
  assert.ok(tasteSum(profile, tile) < tasteSum(profile, top),
    `different ${tasteSum(profile, tile)} vs list winner ${tasteSum(profile, top)}`);
});

// A filler that takes the one list slot at limit 1, so the rows after it are
// only ever reachable through the tiles.
const filler = () => row('filler', { rank: 1, bayesRating: 8.5, usersRated: 90000, info: baseInfo({ mechanics: ['M-a', 'M-b'], categories: ['C-a'], bestWith: [4] }) });

test('DIFFERENT picks the UNLIKE game over an equally good like one', () => {
  // Same bayes, same weight, same length: the taste terms are the only
  // difference, so the base ranking prefers `like` and the inversion `unlike`.
  const { round, rows } = spotlightShelf();
  const pool = [
    row('like', { rank: 900, bayesRating: 7.8, usersRated: 90000, info: baseInfo({ mechanics: ['M-a', 'M-b', 'M-c'], categories: ['C-a', 'C-b'] }) }),
    row('unlike', { rank: 901, bayesRating: 7.8, usersRated: 90000, info: baseInfo({ mechanics: ['Z1', 'Z2'], categories: ['Z3'] }) }),
  ];
  const res = recommend(round, [...rows, filler(), ...pool], { limit: 1 });
  assert.equal(res.recommendations[0].externalId, 'filler');
  assert.equal(spot(res, 'different').externalId, 'unlike');
});

test('DIFFERENT is still the best game under the inversion — quality, weight, players and time count', () => {
  const { round, rows } = spotlightShelf();
  const pool = [
    row('u-bad', { rank: 900, bayesRating: 5.6, usersRated: 90000, info: baseInfo({ mechanics: ['Z1'], categories: ['Z2'] }) }),
    row('u-good', { rank: 901, bayesRating: 8.4, usersRated: 90000, info: baseInfo({ mechanics: ['Z3'], categories: ['Z4'] }) }),
  ];
  const res = recommend(round, [...rows, filler(), ...pool], { limit: 1 });
  assert.equal(spot(res, 'different').externalId, 'u-good');
});

test('DIFFERENT never claims a taste reason — that is the opposite of why it is there', () => {
  // Unlike MECHANICS but the shelf's own CATEGORIES: the inversion still picks it
  // (mechanics carry more weight), and its categories value clears the reason
  // gate — so only the explicit drop keeps „Gleiche Art Spiel wie …" off the tile.
  const { round, rows } = spotlightShelf();
  const pool = [row('mixed', { rank: 900, bayesRating: 8, usersRated: 90000, info: baseInfo({ mechanics: ['Z1', 'Z2'], categories: ['C-a', 'C-b'] }) })];
  const res = recommend(round, [...rows, filler(), ...pool], { limit: 1 });
  const tile = spot(res, 'different');
  assert.equal(tile.externalId, 'mixed');
  const profile = profileOf(round, rows);
  assert.ok(termValue(profile, pool[0], 'categories') > 0.5, 'the fixture must make the categories line reachable');
  assert.ok(!tile.reasons.some((r) => r.term === 'mechanics' || r.term === 'categories'));
  assert.ok(tile.reasons.length > 0, 'the other reasons still reach the tile');
});

test('COMPLEXITY: the winner sits about half a step off the round\'s centre, pointing up below 3.0', () => {
  const { round, corpus } = corpusOf();
  const res = recommend(round, corpus);
  const profile = profileOf(round, corpus);
  assert.ok(profile.targetWeight < 3, 'the fixture shelf is a light one');
  const tile = spot(res, 'complexityUp');
  assert.equal(tile.target, Math.round(profile.targetWeight * 10) / 10);
  const off = tile.weight - profile.targetWeight;
  assert.ok(off > 0.2 && off < 0.8, `winner is ${off} off the centre`);
  // The base complexity term would have REJECTED it — that is the point of the tile.
  const entry = corpus.find((e) => e.externalId === tile.externalId);
  assert.ok(termValue(profile, entry, 'complexity') < 0.5);
  assert.ok(!tile.reasons.some((r) => r.term === 'complexity'), 'the tile does not compare to the centre it left');
});

test('COMPLEXITY is exactly the unmodified scoreCandidate over a shifted profile — the prune skips nothing it should not', () => {
  // Brute force: score EVERY eligible candidate against a copy of the profile
  // with only targetWeight moved, and take the best one the list does not show.
  // The one-pass shortlist skips candidates whose ceiling cannot reach it; this
  // is what proves that ceiling is never tighter than the real score.
  const { round, corpus } = corpusOf();
  for (const limit of [1, 5, 24]) {
    const res = recommend(round, corpus, { limit });
    const profile = profileOf(round, corpus);
    const shifted = { ...profile, targetWeight: profile.targetWeight + complexityDirection(profile.targetWeight).shift };
    const taken = new Set([...res.recommendations.map((r) => r.externalId), spot(res, 'different').externalId]);
    const best = corpus
      .filter((e) => !profile.ownedIds.has(e.externalId) && !taken.has(e.externalId))
      .map((e) => ({ e, score: scoreCandidate(shifted, e).score }))
      .sort((a, b) => b.score - a.score || a.e.rank - b.e.rank)[0];
    assert.equal(spot(res, 'complexityUp').externalId, best.e.externalId, `limit ${limit}`);
  }
});

test('COMPLEXITY turns round at 3.0: heavier below, lighter at or above', () => {
  assert.deepEqual(complexityDirection(2.99), { key: 'complexityUp', shift: 0.5 });
  assert.deepEqual(complexityDirection(3), { key: 'complexityDown', shift: -0.5 });
  assert.deepEqual(complexityDirection(4.2), { key: 'complexityDown', shift: -0.5 });
  assert.equal(complexityDirection(null), null);

  // …and through recommend(): the same candidates, a heavy shelf.
  const { round, rows } = spotlightShelf();
  const heavy = rows.map((r) => ({ ...r, info: { ...r.info, weight: 3.6 } }));
  const corpus = [...heavy, ...spotlightCandidates()];
  const res = recommend(round, corpus);
  assert.equal(spot(res, 'complexityUp'), undefined);
  const tile = spot(res, 'complexityDown');
  assert.ok(tile, 'a heavy shelf gets the lighter tile');
  assert.ok(tile.weight < 3.6 - 0.2 && tile.weight > 3.6 - 0.8, `lighter winner at ${tile.weight}`);
});

test('COMPLEXITY never claims the complexity line, even when its winner sits AT the centre', () => {
  // Only ONE term moves, so a strong game at the round's own weight can still
  // beat a weak one half a step up. Its base complexity value is then a perfect
  // 1.0 and would clear the reason gate — „Gewicht 2,4, euer Schnitt liegt bei
  // 2,4" under „Mal was Komplexeres" — which the explicit drop is there to stop.
  const { round, rows } = spotlightShelf();
  const target = profileOf(round, rows).targetWeight;
  const pool = [
    row('at-centre', { rank: 900, bayesRating: 8, usersRated: 90000, info: baseInfo({ weight: target, mechanics: ['M-a'], categories: ['C-a'] }) }),
    row('up-a-step', { rank: 901, bayesRating: 5.6, usersRated: 90000, info: baseInfo({ weight: target + 0.5, mechanics: ['M-b'], categories: ['C-b'] }) }),
    // Taken by the DIFFERENT tile, which is resolved first — otherwise that tile
    // would claim the strong game at the centre before this one could.
    row('decoy', { rank: 902, bayesRating: 8.5, usersRated: 90000, info: baseInfo({ mechanics: ['Z1'], categories: ['Z2'] }) }),
  ];
  const res = recommend(round, [...rows, filler(), ...pool], { limit: 1 });
  const tile = spot(res, 'complexityUp');
  assert.equal(tile.externalId, 'at-centre');
  assert.equal(termValue(profileOf(round, rows), pool[0], 'complexity'), 1);
  assert.ok(!tile.reasons.some((r) => r.term === 'complexity'));
});

test('HIDDEN: the threshold is the median of the enriched corpus\'s rating counts', () => {
  const rows = [500, 100, 300, 200, 400].map((n, i) => row(`h${i}`, { usersRated: n, info: baseInfo({}) }));
  assert.equal(hiddenRatingsThreshold(rows), 300);
  // An un-enriched row and a row with no count take no part.
  const noise = [row('z1', { usersRated: 1, info: null }), row('z2', { usersRated: null, info: baseInfo({}) })];
  assert.equal(hiddenRatingsThreshold([...rows, ...noise]), 300);
  assert.equal(hiddenRatingsThreshold([rows[0]]), null, 'one row has no median worth the name');
});

test('HIDDEN: its winner is below the threshold on the varied corpus', () => {
  const { round, corpus } = corpusOf();
  const threshold = hiddenRatingsThreshold(corpus);
  const tile = corpus.find((e) => e.externalId === spot(recommend(round, corpus), 'hidden').externalId);
  assert.ok(tile.usersRated < threshold, `${tile.usersRated} is not below ${threshold}`);
});

// The planted tile winner plus a TWIN that scores a little higher on the base
// terms (a better bayes average, nothing else changed) and sits outside the list
// at LIMIT. So the twin is what the tile would pick with no pool restriction at
// all — which is what makes each case below able to fail.
function twinCase(usersRated) {
  const { round, rows } = spotlightShelf();
  const winner = tileWinner(round, rows);
  const twin = row('twin', { ...winner, externalId: 'twin', name: 'Twin', rank: 4999, bayesRating: 6.8, usersRated: 10 ** 7 });
  const corpus = [...rows, ...spotlightCandidates(), winner, twin];
  const threshold = hiddenRatingsThreshold(corpus);
  twin.usersRated = usersRated === 'threshold' ? threshold : usersRated;
  const fresh = [...corpus]; // a new array, so the per-snapshot cache recomputes
  const profile = profileOf(round, fresh);
  assert.ok(scoreCandidate(profile, twin).score > scoreCandidate(profile, winner).score);
  const res = recommend(round, fresh, { limit: LIMIT });
  assert.ok(!res.recommendations.some((r) => r.externalId === 'twin'), 'the twin must sit outside the list');
  if (usersRated === 'threshold') assert.equal(hiddenRatingsThreshold(fresh), threshold, 'moving the twin must not move the median');
  return spot(res, 'hidden').externalId;
}

test('HIDDEN: a better row the crowd HAS found cannot take the tile', () => {
  assert.equal(twinCase(10 ** 7), 'winner');
});

test('HIDDEN: a row AT the threshold is not below it', () => {
  assert.equal(twinCase('threshold'), 'winner');
});

test('HIDDEN: a row with no rating count is never a Geheimtipp', () => {
  assert.equal(twinCase(null), 'winner');
});

test('HIDDEN: the control — the same twin under the threshold DOES take the tile', () => {
  // Without this, the three cases above would pass just as well against a
  // fixture in which the twin never outscored the winner at all.
  assert.equal(twinCase(10), 'twin');
});

/* ------------------------------ the hard filters --------------------------- */

// A candidate built to WIN the hidden tile: the shelf's own taste, its weight,
// its evening length, few ratings — but a bayes average too low for the main
// list at limit 2, so only the tile could ever show it.
function tileWinner(round, rows, over = {}) {
  const profile = profileOf(round, rows);
  return row('winner', {
    name: 'Winner',
    rank: 5000,
    bayesRating: 6.6,
    usersRated: 150,
    info: baseInfo({
      weight: Math.round(profile.targetWeight * 100) / 100,
      mechanics: ['M-a', 'M-b', 'M-c'],
      categories: ['C-a', 'C-b'],
      bestWith: [4],
      recommendedWith: [3, 5],
    }),
    ...over,
  });
}
const LIMIT = 2;

test('the tile-winner fixture really wins the hidden tile and sits outside the list', () => {
  // The control for the three filter cases below: without it, "not in the tile"
  // would pass just as well against a fixture that never won it.
  const { round, rows } = spotlightShelf();
  const corpus = [...rows, ...spotlightCandidates(), tileWinner(round, rows)];
  const res = recommend(round, corpus, { limit: LIMIT });
  assert.equal(spot(res, 'hidden').externalId, 'winner');
  assert.ok(!res.recommendations.some((r) => r.externalId === 'winner'));
});

test('an OWNED game (retired, even) never reaches a tile', () => {
  const { round, rows } = spotlightShelf();
  const winner = tileWinner(round, rows);
  round.games.push({ id: 'gw', title: 'Winner', retired: true, source: { provider: 'bgg', externalId: 'winner' } });
  const res = recommend(round, [...rows, ...spotlightCandidates(), winner], { limit: LIMIT });
  // EVERY owned id, not just the planted winner: with the filter broken for the
  // tiles, the shelf's own rows — perfect taste matches — take the hidden tile
  // ahead of the winner, so a check naming only 'winner' stays green (measured).
  const owned = new Set(round.games.map((g) => g.source.externalId));
  assert.equal(owned.size, 11);
  res.spotlights.forEach((s) => assert.ok(!owned.has(s.externalId), `${s.externalId} is owned`));
});

test('a DISMISSED title never reaches a tile', () => {
  const { round, rows } = spotlightShelf();
  const winner = tileWinner(round, rows);
  round.dismissedRecommendations = [{ externalId: 'winner', title: 'Winner', at: '2026-09-25T00:00:00.000Z' }];
  const res = recommend(round, [...rows, ...spotlightCandidates(), winner], { limit: LIMIT });
  assert.ok(!res.spotlights.some((s) => s.externalId === 'winner'));
});

test('a REIMPLEMENTATION of an owned game never reaches a tile', () => {
  const { round, rows } = spotlightShelf();
  const winner = tileWinner(round, rows);
  winner.info.implementations = [rows[0].name];
  const res = recommend(round, [...rows, ...spotlightCandidates(), winner], { limit: LIMIT });
  assert.ok(!res.spotlights.some((s) => s.externalId === 'winner'));
});

/* ------------------------------ the empty states --------------------------- */

test('below the profile floor there are no tiles, however full the corpus', () => {
  const { round, corpus } = corpusOf();
  round.games = round.games.slice(0, MIN_PROFILE_GAMES - 1);
  const res = recommend(round, corpus);
  assert.equal(res.recommendations.length, 0);
  assert.deepEqual(res.spotlights, []);
});

test('no corpus, nothing left, or everything dismissed: no tiles', () => {
  const { round, rows } = spotlightShelf();
  assert.deepEqual(recommend(round, []).spotlights, []);
  assert.deepEqual(recommend(round, rows).spotlights, [], 'every row is owned — nothing left');
  const candidates = spotlightCandidates(20);
  round.dismissedRecommendations = candidates.map((c) => ({ externalId: c.externalId, title: c.name, at: 'x' }));
  assert.deepEqual(recommend(round, [...rows, ...candidates]).spotlights, []);
});

/* ------------------------------ the one pass ------------------------------- */

test('the corpus is walked ONCE per request; the threshold walk is once per snapshot', () => {
  const { round, corpus } = corpusOf();
  let walks = 0;
  const forEach = corpus.forEach.bind(corpus);
  corpus.forEach = (fn) => {
    walks += 1;
    return forEach(fn);
  };
  recommend(round, corpus);
  assert.equal(walks, 2, 'first read: the scoring pass plus the one-off threshold walk');
  walks = 0;
  recommend(round, corpus);
  assert.equal(walks, 1, 'the same snapshot again: the scoring pass alone');
});
