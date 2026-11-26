'use strict';

/*
 * Spielwirbel-Rekorde (#1788): the best personal score for a BoardGameGeek game
 * across every round on the instance — its VALUE only, never who holds it.
 *
 * WHY A BACKGROUND RECOMPUTE AND NOT A READ. A user can only ever read their own
 * tenant (RLS), so a value over every round cannot be computed in a request. The
 * scheduler (`recomputeGameRecords`, lib/scheduler.js) reads every round under
 * the read-only admin escape (`repo.gameRecordSources()`), and rewrites two
 * global tables (migration 20261126130000_game_records.js):
 *
 *   game_records   per BGG id: value, direction, distribution, and the
 *                  ROUND-LOCAL score keys that hold, set and count toward it
 *   score_reviews  per flagged/decided score: the admin snapshot + opaque `ref`
 *
 * A score key is `<roundId>/<sessionId>/<seatId>`. No table stores a tenant or
 * an account id: a round read finds ITS keys by prefix (the overlay below), and
 * the profile finds the account's own seats in the rounds it already reads
 * (lib/user-stats.js). Deleting a session removes its scores on the next
 * recompute, which is also what clears them after an account erasure.
 *
 * WHAT COUNTS (the issue's scope, each pinned in test/game-records.test.js):
 *  - one record per BGG id, across player counts; unlinked games have none;
 *  - PERSONAL scores only — a member playing as themselves. A team's shared
 *    score and the automa never count (the round's personal-best rule, #1630/
 *    #1672), and neither does a guest, who has no person behind the seat;
 *  - demo tenants never count (the source read excludes them);
 *  - direction: the operator's confirmation (#1786) when set, else the majority
 *    of rounds with points for that game, a tie going to highest-wins;
 *  - no minimum sample: one counted score is a record.
 *
 * THE REVIEW. A score the outlier checks (public/js/game-records.js) flag is
 * HELD BACK when it is flagged the first time the recompute sees it, and KEEPS
 * COUNTING when it was already counted and only stands out now (more scores
 * moved the distribution) — so a record or a medal never vanishes without an
 * operator decision. „Gültig" counts it and is never flagged again; „Nicht
 * werten" excludes it for good. Neither touches the round's own records.
 * Every recompute re-checks every undecided score, so a flag whose reason went
 * away is dropped again.
 *
 * WHO SET A RECORD (the account Abzeichen): a counted score better than every
 * counted score from earlier sessions of that game, and the best of its own
 * session (a tie there sets it for both). Replayed by session date, so a
 * backdated session lands where its date puts it, and never lost by being
 * beaten. The first counted score of a game sets one.
 */

const crypto = require('crypto');
const repo = require('./repo');
const { logger } = require('./observability');
const { bggIdOf, foldScoringRounds } = require('./game-scoring');
const { sessionPartyGroups, sessionPeople } = require('../public/js/session-people');
const { isValidPoints } = require('../public/js/point-records');
const { recordDistribution, recordBeats, outlierReasons } = require('../public/js/game-records');

// The opaque id the admin screen acts by. A hash of the key, so the round,
// session and seat ids never reach the operator's browser; ids are random, so
// it cannot be walked back.
const scoreRef = (key) => crypto.createHash('sha256').update(`game-record:${key}`).digest('hex').slice(0, 20);

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* Every personal score in the sources, grouped by BGG id, plus each round's own
   stored direction per BGG id (the majority's evidence). A round's `games` are
   the STORED rows (the source read is not overlaid), so the confirmation never
   feeds back into its own majority. */
function collectScores(sources) {
  const byGame = new Map();
  const directionRows = [];
  for (const round of sources || []) {
    const games = new Map((round.games || []).map((g) => [g.id, g]));
    const ctx = { ...round, members: (round.members || []).map((m) => ({ id: m.id, name: m.name || '' })) };
    const lowByBgg = new Map();
    for (const s of round.sessions || []) {
      if (!s || s.finished !== true || s.cancelled === true || !s.chosenGameId) continue;
      if (!s.scores || typeof s.scores !== 'object' || !Object.keys(s.scores).length) continue;
      const game = games.get(s.chosenGameId);
      const bggId = bggIdOf(game);
      if (!bggId) continue;
      lowByBgg.set(bggId, lowByBgg.get(bggId) || game.lowScoreWins === true);
      const parties = sessionPartyGroups(ctx, s);
      const personal = parties
        .filter((p) => !p.team && !p.people[0].guest && isValidPoints(s.scores[p.id]))
        .map((p) => ({ seat: p.id, points: s.scores[p.id] }));
      if (!personal.length) continue;
      const players = sessionPeople(ctx, s).length;
      const sessionKey = `${round.id}/${s.id}`;
      const list = byGame.get(bggId) || [];
      personal.forEach((p) => list.push({
        key: `${sessionKey}/${p.seat}`,
        roundId: round.id,
        sessionKey,
        points: p.points,
        at: typeof s.createdAt === 'string' ? s.createdAt : '',
        players,
        peers: personal.filter((o) => o !== p).map((o) => o.points),
      }));
      byGame.set(bggId, list);
    }
    for (const [bggId, low] of lowByBgg) directionRows.push({ bggId, low, titles: [] });
  }
  return { byGame, directionRows };
}

// Direction per BGG id: the confirmation, else the majority of rounds (tie →
// highest wins). Uses #1786's own fold, so the admin queue and this agree.
function directions(directionRows, settings) {
  const out = new Map();
  for (const f of foldScoringRounds(directionRows)) out.set(f.bggId, f.lowWins > f.highWins);
  for (const s of settings || []) {
    if (s.state === 'confirmed') out.set(String(s.bggId), !!s.lowScoreWins);
  }
  return out;
}

/*
 * The pure computation. `reviews` is a Map key -> stored review, `seen` the Set
 * of score keys any previous recompute already knew (counted or reviewed) —
 * what separates „flagged on entry" (held back) from „flagged later" (keeps
 * counting). `now` stamps new flags.
 *
 * Returns { records: [row], reviews: Map key -> review to store (flagged ones
 * only; decided rows are never rewritten here), unflagged: [key], gone: [key] }.
 */
function computeRecords({ sources, settings, reviews, seen, now }) {
  const stored = reviews || new Map();
  const known = seen || new Set();
  const { byGame, directionRows } = collectScores(sources);
  const dirOf = directions(directionRows, settings);
  const records = [];
  const flagged = new Map();
  const unflagged = [];
  const present = new Set();

  for (const [bggId, scores] of [...byGame.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const lowWins = dirOf.get(bggId) === true;
    scores.sort((a, b) => cmpStr(a.at, b.at) || cmpStr(a.sessionKey, b.sessionKey));
    scores.forEach((s) => present.add(s.key));
    const stateOf = (s) => (stored.get(s.key) || {}).state;
    // The distribution check reads the game's scores minus the excluded and
    // the already-held-back ones, so a held-back outlier cannot widen the very
    // fence that judges it.
    const dist = recordDistribution(scores
      .filter((s) => stateOf(s) !== 'excluded' && !(stateOf(s) === 'flagged' && stored.get(s.key).heldBack))
      .map((s) => s.points));

    let record = null;
    const counted = [];
    const set = [];
    let i = 0;
    while (i < scores.length) {
      // One session at a time: its scores are simultaneous.
      const group = [];
      const sk = scores[i].sessionKey;
      while (i < scores.length && scores[i].sessionKey === sk) group.push(scores[i++]);
      const before = record;
      const live = [];
      for (const s of group) {
        const review = stored.get(s.key);
        if (review && review.state === 'excluded') continue;
        const reasons = review && review.state === 'valid' ? [] : outlierReasons(s.points, { peers: s.peers, record: before, dist }, lowWins);
        if (reasons.length) {
          const heldBack = review && review.state === 'flagged' ? !!review.heldBack : !known.has(s.key);
          flagged.set(s.key, {
            state: 'flagged',
            heldBack,
            reasons,
            bggId,
            points: s.points,
            players: s.players,
            at: s.at || null,
            peers: s.peers.slice().sort((a, b) => (lowWins ? a - b : b - a)),
            ref: scoreRef(s.key),
            flaggedAt: (review && review.state === 'flagged' && review.flaggedAt) || now,
          });
          if (heldBack) continue;
        } else if (review && review.state === 'flagged') {
          unflagged.push(s.key);
        }
        live.push(s);
        counted.push(s);
      }
      if (!live.length) continue;
      const best = live.reduce((b, s) => (recordBeats(s.points, b, lowWins) ? s.points : b), live[0].points);
      if (before === null || recordBeats(best, before, lowWins)) {
        live.filter((s) => s.points === best).forEach((s) => set.push({ key: s.key, at: s.at || null }));
        record = best;
      }
    }
    const figures = recordDistribution(counted.map((s) => s.points));
    const holders = counted.filter((s) => s.points === record);
    records.push({
      bggId,
      lowWins,
      value: record,
      count: figures ? figures.count : 0,
      median: figures ? figures.median : null,
      p90: figures ? figures.p90 : null,
      q1: figures ? figures.q1 : null,
      q3: figures ? figures.q3 : null,
      rounds: new Set(counted.map((s) => s.roundId)).size,
      recordAt: holders.length ? holders[0].at || null : null,
      held: holders.map((s) => s.key),
      set,
      counted: counted.map((s) => s.key),
    });
  }
  const gone = [...stored.keys()].filter((k) => !present.has(k));
  return { records, reviews: flagged, unflagged, gone };
}

/* --------------------------- the recompute job ---------------------------- */

let lastRun = null;

// Read everything, compute, write. Never throws: a failure leaves the previous
// tables standing (a record must not blank because one tick hit a hiccup).
async function recompute(now = new Date().toISOString()) {
  try {
    const [sources, settings, storedReviews, previous] = await Promise.all([
      repo.gameRecordSources(),
      repo.listGameScoringSettings(),
      repo.listScoreReviews(),
      repo.listGameRecords(),
    ]);
    const reviews = new Map(storedReviews.map((r) => [r.key, r]));
    const seen = new Set(reviews.keys());
    previous.forEach((r) => (r.counted || []).forEach((k) => seen.add(k)));
    const out = computeRecords({ sources, settings, reviews, seen, now });
    await repo.replaceGameRecords(out.records);
    // Only UNDECIDED rows are written or dropped by the job, and the repo
    // re-checks that inside the write — an operator decision landing between
    // this read and this write must win.
    for (const [key, review] of out.reviews) await repo.putScoreReview(key, review, { onlyUndecided: true });
    if (out.unflagged.length) await repo.deleteScoreReviews(out.unflagged, { onlyUndecided: true });
    if (out.gone.length) await repo.deleteScoreReviews(out.gone, { onlyUndecided: false });
    repo.recordsIndex.invalidate();
    lastRun = now;
    return { games: out.records.length, flagged: out.reviews.size, gone: out.gone.length };
  } catch (err) {
    logger.error({ event: 'game_records_recompute_failed', err: err.message });
    return null;
  }
}

/* ----------------------------- the admin lists ---------------------------- */

// The review list: every flagged score, newest flag first, with the game's
// distribution beside it. Nothing here names a round, tenant, member or account.
async function reviewList() {
  const [reviews, rows] = await Promise.all([repo.listScoreReviews(), repo.listGameRecords()]);
  const byId = new Map(rows.map((r) => [String(r.bggId), r]));
  return reviews
    .filter((v) => v.state === 'flagged')
    .map((v) => {
      const r = byId.get(String(v.bggId)) || {};
      return {
        ref: v.ref,
        bggId: String(v.bggId),
        points: v.points,
        heldBack: !!v.heldBack,
        reasons: v.reasons || [],
        players: v.players || null,
        at: v.at || null,
        peers: v.peers || [],
        flaggedAt: v.flaggedAt || null,
        lowWins: !!r.lowWins,
        record: Number.isFinite(r.value) ? r.value : null,
        count: r.count || 0,
        median: Number.isFinite(r.median) ? r.median : null,
        p90: Number.isFinite(r.p90) ? r.p90 : null,
      };
    })
    .sort((a, b) => cmpStr(b.flaggedAt || '', a.flaggedAt || '') || cmpStr(a.ref, b.ref));
}

// The current records: one row per game that has one, most counted scores first.
async function recordList() {
  const rows = await repo.listGameRecords();
  return rows
    .filter((r) => Number.isFinite(r.value))
    .map((r) => ({
      bggId: String(r.bggId),
      value: r.value,
      lowWins: !!r.lowWins,
      count: r.count || 0,
      median: Number.isFinite(r.median) ? r.median : null,
      p90: Number.isFinite(r.p90) ? r.p90 : null,
      rounds: r.rounds || 0,
      recordAt: r.recordAt || null,
      refs: (r.held || []).map(scoreRef),
    }))
    .sort((a, b) => b.count - a.count || cmpStr(a.bggId, b.bggId));
}

// The stored key behind an opaque ref — a flagged/decided review's, or a
// record-holding score's (the records list may exclude one nobody flagged).
async function resolveRef(ref) {
  const reviews = await repo.listScoreReviews();
  const hit = reviews.find((v) => v.ref === ref);
  if (hit) return { key: hit.key, review: hit };
  for (const r of await repo.listGameRecords()) {
    const key = (r.held || []).find((k) => scoreRef(k) === ref);
    if (key) return { key, review: null, record: r };
  }
  return null;
}

module.exports = {
  scoreRef,
  computeRecords,
  recompute,
  reviewList,
  recordList,
  resolveRef,
  lastRun: () => lastRun,
};
