'use strict';

/*
 * Spielwirbel-Rekorde (#1788): the pure computation (lib/game-records.js
 * `computeRecords`), the three outlier checks and the result screen's mark
 * (public/js/game-records.js), the round-local read overlay
 * (lib/game-record-overlay.js), and the recompute end to end on the JSON
 * backend. The HTTP half — the admin screen and what a round read carries — is
 * test/game-records-admin.test.js; the repo methods are in
 * test/support/repo-contract.js.
 *
 * The sources are built by hand in the shape `repo.gameRecordSources()`
 * returns, so each case states exactly the rounds it is about.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { store } = require('./helpers');
const repo = require('../lib/repo');
const { computeRecords, recompute, scoreRef } = require('../lib/game-records');
const { buildIndex, overlayRoundRecords } = require('../lib/game-record-overlay');
const {
  outlierReasons, recordDistribution, swRecordMark,
  OUTLIER_MIN_DISTRIBUTION,
} = require('../public/js/game-records');

const bgg = (id) => ({ provider: 'bgg', externalId: id });
let seq = 0;
const at = () => `2026-03-${String((seq += 1)).padStart(2, '0')}T20:00:00.000Z`;

// One source round: members `a`..`d`, the games given, and sessions built from
// `[gameId, scores, extra?]`, each dated one day after the last.
function src(id, games, plays) {
  return {
    id,
    members: ['a', 'b', 'c', 'd'].map((m) => ({ id: m, name: m.toUpperCase() })),
    games,
    sessions: plays.map(([gid, scores, extra = {}], i) => ({
      id: `${id}-s${i}`,
      finished: true,
      cancelled: false,
      chosenGameId: gid,
      memberIds: Object.keys(scores).filter((k) => ['a', 'b', 'c', 'd'].includes(k)),
      scores,
      createdAt: at(),
      ...extra,
    })),
  };
}

const run = (sources, opts = {}) => computeRecords({
  sources, settings: opts.settings || [], reviews: opts.reviews || new Map(), seen: opts.seen || new Set(), now: 'now',
});
const rec = (out, id) => out.records.find((r) => r.bggId === id);

// --- what counts --------------------------------------------------------------

test('one record per BGG id across rounds; personal scores only — never a team, a guest or the automa', () => {
  const azul = { id: 'g1', title: 'Azul', source: bgg('230802') };
  const out = run([
    src('r1', [azul], [['g1', { a: 50, b: 40 }]]),
    // A team's 65 and a guest's 70 are on the sheet; neither is personal. Both
    // beat every personal score WITHOUT tripping an outlier check — a 200 would
    // be held back as a jump anyway, and then this case could not tell the
    // team filter from the outlier check (measured: green with the filter gone).
    src('r2', [{ ...azul, id: 'g2' }], [
      ['g2', { t1: 65 }, { teams: [{ id: 't1', personIds: ['a', 'b'] }], memberIds: ['a', 'b', 'c'] }],
      ['g2', { gx: 70, c: 60 }, { guests: [{ id: 'gx', name: 'Gast' }], memberIds: ['c'] }],
    ]),
    // The automa scores 999 — it is a field of its own, never a party.
    src('r3', [{ ...azul, id: 'g3' }], [['g3', { d: 55 }, { automa: { name: 'Bot', points: 999 } }]]),
    // An unlinked game has no Spielwirbel-Rekord at all.
    src('r4', [{ id: 'g4', title: 'Hausspiel' }], [['g4', { a: 9999 }]]),
  ]);
  assert.deepEqual(out.records.map((r) => r.bggId), ['230802']);
  const r = rec(out, '230802');
  assert.equal(r.value, 60, 'the guest\'s 70, the team\'s 65 and the automa\'s 999 never count');
  assert.equal(out.reviews.size, 0, 'nothing here was an outlier — the filters alone decide');
  assert.deepEqual(r.held, ['r2/r2-s1/c']);
  // r1, r2 (c played beside a guest — still personal) and r3 (d's own 55 beside the automa).
  assert.equal(r.rounds, 3);
});

test('a game scored by ONE round has a record from its first counted score', () => {
  const out = run([src('r1', [{ id: 'g1', source: bgg('1') }], [['g1', { a: 7 }]])]);
  assert.equal(rec(out, '1').value, 7);
  assert.deepEqual(rec(out, '1').set, [{ key: 'r1/r1-s0/a', at: rec(out, '1').set[0].at }]);
});

test('direction: the #1786 confirmation wins; else the majority of rounds; a tie is highest-wins', () => {
  const game = (id, low) => ({ id, source: bgg('5'), ...(low ? { lowScoreWins: true } : {}) });
  const three = [
    src('r1', [game('g1', true)], [['g1', { a: 10, b: 20 }]]),
    src('r2', [game('g2', true)], [['g2', { a: 30 }]]),
    src('r3', [game('g3', false)], [['g3', { a: 40 }]]),
  ];
  assert.equal(rec(run(three), '5').lowWins, true, 'two of three rounds say lowest wins');
  assert.equal(rec(run(three), '5').value, 10);
  assert.equal(rec(run(three.slice(1)), '5').lowWins, false, '1:1 is a tie — highest wins');
  assert.equal(rec(run(three.slice(1)), '5').value, 40);
  const confirmed = run(three, { settings: [{ bggId: '5', state: 'confirmed', lowScoreWins: false }] });
  assert.deepEqual([rec(confirmed, '5').lowWins, rec(confirmed, '5').value], [false, 40]);
  // A dismissal is not a confirmation.
  assert.equal(rec(run(three, { settings: [{ bggId: '5', state: 'dismissed' }] }), '5').lowWins, true);
});

test('ties share the record; the setter replay is by session DATE, and a later tie sets nothing', () => {
  const g = { id: 'g1', source: bgg('9') };
  // Inserted out of date order: the backdated session (#1616) must replay first.
  const r = src('r1', [g], [['g1', { a: 50 }], ['g1', { b: 40, c: 40 }], ['g1', { d: 50 }]]);
  r.sessions[1].createdAt = '2026-01-01T20:00:00.000Z';
  const out = rec(run([r]), '9');
  assert.equal(out.value, 50);
  assert.deepEqual(out.held.sort(), ['r1/r1-s0/a', 'r1/r1-s2/d'], 'both 50s hold it');
  assert.deepEqual(out.set.map((e) => e.key), ['r1/r1-s1/b', 'r1/r1-s1/c', 'r1/r1-s0/a'],
    'the backdated 40s (a tie inside one session) set it first, then a\'s 50; d\'s later 50 beats nothing');
});

// --- the three checks --------------------------------------------------------

test('the session check: > 3× the median of the other personal scores, mirrored for lowest-wins', () => {
  assert.deepEqual(outlierReasons(31, { peers: [10, 9, 11] }, false), ['session']);
  assert.deepEqual(outlierReasons(30, { peers: [10, 9, 11] }, false), [], 'exactly 3× is not more than 3×');
  assert.deepEqual(outlierReasons(3, { peers: [10, 9, 11] }, true), ['session'], 'lowest-wins: under a third');
  assert.deepEqual(outlierReasons(31, { peers: [] }, false), [], 'a solo session cannot be judged');
  assert.deepEqual(outlierReasons(-50, { peers: [-2, -3] }, true), [], 'ratios mean nothing below zero');
});

test('the jump check: beats the standing record by more than 2×, from the second score', () => {
  assert.deepEqual(outlierReasons(201, { record: 100 }, false), ['jump']);
  assert.deepEqual(outlierReasons(200, { record: 100 }, false), []);
  assert.deepEqual(outlierReasons(49, { record: 100 }, true), ['jump']);
  assert.deepEqual(outlierReasons(500, { record: null }, false), [], 'no record yet: nothing to jump over');
});

test('the distribution check: beyond Q3 + 3×IQR once the game has enough scores', () => {
  const values = Array.from({ length: OUTLIER_MIN_DISTRIBUTION }, (_, i) => 40 + (i % 10));
  const dist = recordDistribution(values);
  const fence = dist.q3 + 3 * (dist.q3 - dist.q1);
  assert.deepEqual(outlierReasons(Math.ceil(fence) + 1, { dist }, false), ['distribution']);
  assert.deepEqual(outlierReasons(Math.floor(fence), { dist }, false), []);
  assert.deepEqual(outlierReasons(Math.floor(dist.q1 - 3 * (dist.q3 - dist.q1)) - 1, { dist }, true), ['distribution']);
  const thin = recordDistribution(values.slice(1));
  assert.deepEqual(outlierReasons(10000, { dist: thin }, false), [], 'one score short of the floor');
});

// --- the review --------------------------------------------------------------

const jumpy = () => [src('r1', [{ id: 'g1', source: bgg('7') }], [['g1', { a: 10 }], ['g1', { a: 50 }]])];

test('a score flagged the first time it is seen is HELD BACK — it does not count', () => {
  const out = run(jumpy());
  assert.equal(rec(out, '7').value, 10);
  const review = out.reviews.get('r1/r1-s1/a');
  assert.deepEqual([review.state, review.heldBack, review.reasons], ['flagged', true, ['jump']]);
  assert.equal(review.ref, scoreRef('r1/r1-s1/a'));
  assert.ok(!JSON.stringify(review).includes('r1'), 'the stored snapshot names no round, session or seat');
});

test('a score that was already counted and only stands out now KEEPS COUNTING until decided', () => {
  const out = run(jumpy(), { seen: new Set(['r1/r1-s1/a']) });
  assert.equal(rec(out, '7').value, 50, 'a record never vanishes without an operator decision');
  assert.equal(out.reviews.get('r1/r1-s1/a').heldBack, false);
});

test('„Gültig" counts and is never flagged again; „Nicht werten" excludes for good', () => {
  const valid = run(jumpy(), { reviews: new Map([['r1/r1-s1/a', { state: 'valid', points: 50 }]]) });
  assert.equal(rec(valid, '7').value, 50);
  assert.equal(valid.reviews.size, 0);
  const excluded = run(jumpy(), { reviews: new Map([['r1/r1-s1/a', { state: 'excluded', points: 50 }]]), seen: new Set(['r1/r1-s1/a']) });
  assert.equal(rec(excluded, '7').value, 10);
  assert.equal(excluded.reviews.size, 0);
});

test('a decision applies to the points it was made on — an EDITED score is judged again, as new', () => {
  // The operator marked a 50 valid; the round then edited it to 500.
  const sources = [src('r1', [{ id: 'g1', source: bgg('7') }], [['g1', { a: 10 }], ['g1', { a: 500 }]])];
  const key = 'r1/r1-s1/a';
  const out = run(sources, { reviews: new Map([[key, { state: 'valid', points: 50 }]]), seen: new Set([key]) });
  assert.equal(rec(out, '7').value, 10, 'the 500 is not waved through by a decision about a 50');
  assert.deepEqual([out.reviews.get(key).heldBack, out.reviews.get(key).points], [true, 500]);
  assert.deepEqual(out.stale, [key], 'the stale decision is reported, so the job may overwrite it');
  // An excluded 50 edited to 12 counts again once it passes the checks.
  const back = run([src('r1', [{ id: 'g1', source: bgg('7') }], [['g1', { a: 10 }], ['g1', { a: 12 }]])],
    { reviews: new Map([[key, { state: 'excluded', points: 50 }]]), seen: new Set([key]) });
  assert.equal(rec(back, '7').value, 12);
  assert.deepEqual(back.stale, [key]);
  // A decision on the SAME points still holds.
  const same = run(sources, { reviews: new Map([[key, { state: 'valid', points: 500 }]]), seen: new Set([key]) });
  assert.deepEqual([rec(same, '7').value, same.stale], [500, []]);
});

test('an undecided flag whose reason went away is dropped; a review whose session is gone is reported gone', () => {
  const flagged = { state: 'flagged', heldBack: true };
  // The 50 is no longer a jump once 18 and 30 sit between it and the 10 (each
  // under 2× the record before it, so neither is flagged on its own).
  const sources = [src('r1', [{ id: 'g1', source: bgg('7') }], [['g1', { a: 10 }], ['g1', { b: 18 }], ['g1', { c: 30 }], ['g1', { a: 50 }]])];
  const out = run(sources, { reviews: new Map([['r1/r1-s3/a', flagged], ['r9/x/y', { state: 'excluded' }]]) });
  assert.equal(out.reviews.size, 0);
  assert.deepEqual(out.unflagged, ['r1/r1-s3/a']);
  assert.equal(rec(out, '7').value, 50);
  assert.deepEqual(out.gone, ['r9/x/y']);
});

test('a held-back outlier cannot widen the fence that judges it', () => {
  const plays = Array.from({ length: OUTLIER_MIN_DISTRIBUTION }, (_, i) => ['g1', { a: 40 + (i % 5) }]);
  plays.push(['g1', { b: 400 }]);
  const sources = [src('r1', [{ id: 'g1', source: bgg('3') }], plays)];
  const key = `r1/r1-s${OUTLIER_MIN_DISTRIBUTION}/b`;
  const out = run(sources, { reviews: new Map([[key, { state: 'flagged', heldBack: true, reasons: ['jump'] }]]) });
  assert.ok(out.reviews.get(key).reasons.includes('distribution'));
  assert.equal(rec(out, '3').value, 44);
});

// --- the overlay and the client mark -------------------------------------------

test('the overlay is round-local: a round sees the value and its OWN keys, never another round\'s', () => {
  const out = run([
    src('r1', [{ id: 'g1', source: bgg('7') }], [['g1', { a: 10 }], ['g1', { a: 50 }]]),
    src('r2', [{ id: 'g2', source: bgg('7') }], [['g2', { b: 12 }]]),
  ]);
  const reviews = [...out.reviews].map(([key, v]) => ({ ...v, key }));
  const index = buildIndex([out.records, reviews]);
  const r1 = overlayRoundRecords({ id: 'r1', games: [{ id: 'g1', source: bgg('7') }, { id: 'g9', title: 'Frei' }] }, index);
  assert.deepEqual(r1.games[0].swRecord, {
    value: 12, lowWins: false, held: [], set: ['r1-s0/a'], pending: ['r1-s1/a'], excluded: [],
    dist: { count: 2, q1: 10.5, q3: 11.5 },
  });
  assert.equal('swRecord' in r1.games[1], false, 'an unlinked game carries none');
  const r2 = overlayRoundRecords({ id: 'r2', games: [{ id: 'g2', source: bgg('7') }] }, index);
  assert.deepEqual([r2.games[0].swRecord.held, r2.games[0].swRecord.set], [['r2-s0/b'], ['r2-s0/b']]);
  assert.ok(!JSON.stringify(r2).includes('r1'), 'nothing of r1 reaches r2');
  // A linked game nobody has scored yet still takes part.
  const fresh = overlayRoundRecords({ id: 'r3', games: [{ id: 'g3', source: bgg('8'), lowScoreWins: true }] }, index);
  assert.deepEqual([fresh.games[0].swRecord.value, fresh.games[0].swRecord.lowWins], [null, true]);
});

test('swRecordMark: the recompute\'s marks win; an unseen score is judged with the same checks', () => {
  const game = { swRecord: { value: 100, lowWins: false, held: [], set: ['s1/a'], pending: ['s2/a'], excluded: ['s3/a'] } };
  assert.equal(swRecordMark(game, 's1', 'a', 100, []), 'set');
  assert.equal(swRecordMark(game, 's2', 'a', 900, []), 'pending');
  assert.equal(swRecordMark(game, 's3', 'a', 900, []), null, 'excluded never shows');
  assert.equal(swRecordMark(game, 's4', 'a', 150, [140]), 'set', 'beats it, passes the checks');
  assert.equal(swRecordMark(game, 's4', 'a', 201, [190]), 'pending', 'a jump over the record');
  assert.equal(swRecordMark(game, 's4', 'a', 100, []), null, 'a tie beats nothing');
  assert.equal(swRecordMark(game, 's4', 'a', 99, []), null);
  assert.equal(swRecordMark({ swRecord: { value: null, lowWins: false } }, 's', 'a', 5, []), 'set', 'the first score is one');
  assert.equal(swRecordMark({}, 's', 'a', 5, []), null, 'no swRecord, no mark');
});

// --- end to end on the JSON backend -------------------------------------------

test('recompute writes both tables, a round read carries swRecord, and a demo tenant never counts', async () => {
  store.data.gameRecords.splice(0);
  store.data.scoreReviews.splice(0);
  const make = async (tenant, scores) => {
    const scoped = repo.forTenant(tenant);
    const round = await scoped.createRound({ name: 'R', members: ['A', 'B'], importFromRoundId: null });
    const game = await scoped.createGame(round.id, { title: 'Azul', minPlayers: 1, maxPlayers: 4, image: null, source: bgg('4444') });
    const [m1, m2] = round.members.map((m) => m.id);
    await scoped.createSession(round.id, {
      createdAt: at(), gameIds: [game.id], votes: {}, chosenGameId: game.id, finished: true, cancelled: false,
      memberIds: [m1, m2], winnerIds: [], scores: { [m1]: scores[0], [m2]: scores[1] },
    });
    return { round, game, scoped };
  };
  const mine = await make('t-records', [41, 39]);
  await make('demo-records', [900, 800]);
  const result = await recompute();
  assert.ok(result && result.games >= 1);
  const row = (await repo.listGameRecords()).find((r) => r.bggId === '4444');
  assert.equal(row.value, 41, 'the demo tenant\'s 900 never counts');
  const read = await mine.scoped.getRound(mine.round.id);
  const sw = read.games[0].swRecord;
  assert.equal(sw.value, 41);
  assert.deepEqual(sw.set, [`${read.sessions[0].id}/${read.members[0].id}`]);
  // getGame reads the same overlay for the same round.
  assert.equal((await mine.scoped.getGame(mine.round.id, mine.game.id)).swRecord.value, 41);
  // The stored game is untouched: the overlay is read-only.
  assert.equal('swRecord' in store.findRound(mine.round.id).games[0], false);
});

test('a failed recompute logs the error CODE, never its message — a Knex message quotes the SQL', async () => {
  const { recentLogs } = require('../lib/observability');
  const real = repo.gameRecordSources;
  repo.gameRecordSources = async () => {
    const err = new Error('insert into "score_reviews" values (\'r-secret/s/m\', 500) - boom');
    err.code = '23505';
    throw err;
  };
  try {
    assert.equal(await recompute(), null, 'a failure leaves the tables standing and reports null');
  } finally {
    repo.gameRecordSources = real;
  }
  const line = recentLogs().find((l) => l.event === 'game_records_recompute_failed');
  assert.ok(line, 'the failure is logged');
  assert.equal(line.code, '23505');
  assert.ok(!JSON.stringify(recentLogs()).includes('r-secret'), 'the SQL\'s score key never reaches the log');
});
