'use strict';

/*
 * The read overlay for Spielwirbel-Rekorde (#1788): `game.swRecord` on every
 * BGG-linked game a round read hands out (shape: public/js/game-records.js).
 *
 * Its own file, and repo-free, for the reason lib/game-scoring.js gives:
 * lib/repo/index.js requires it to build the cached index from the two global
 * tables, so requiring the repo here would be a cycle. The computation that
 * WRITES those tables is lib/game-records.js.
 *
 * Everything attached is ROUND-LOCAL: the value and direction (published to
 * every account by design) plus this round's own score keys — never another
 * round's, and never a holder.
 */

const { bggIdOf } = require('./game-scoring');

/* The cache every round read consults, built from the two tables. Same TTL and
   invalidation shape as the scoring overlay (lib/game-scoring.js `settingsCache`):
   the recompute and the admin decision invalidate it in this process, other
   processes converge within the TTL. */
function buildIndex([rows, reviews]) {
  const byId = new Map();
  const byRound = new Map();
  const mark = (key, kind, bggId) => {
    const cut = key.indexOf('/');
    if (cut < 1) return;
    const rid = key.slice(0, cut);
    const local = key.slice(cut + 1);
    if (!byRound.has(rid)) byRound.set(rid, new Map());
    const games = byRound.get(rid);
    if (!games.has(bggId)) games.set(bggId, { held: [], set: [], pending: [], excluded: [] });
    games.get(bggId)[kind].push(local);
  };
  for (const r of rows) {
    byId.set(String(r.bggId), r);
    (r.held || []).forEach((k) => mark(k, 'held', String(r.bggId)));
    (r.set || []).forEach((e) => mark(e.key, 'set', String(r.bggId)));
  }
  for (const v of reviews) {
    if (v.state === 'flagged' && v.heldBack) mark(v.key, 'pending', String(v.bggId));
    if (v.state === 'excluded') mark(v.key, 'excluded', String(v.bggId));
  }
  return { byId, byRound };
}

// `game.swRecord` for one game of one round (shape: public/js/game-records.js).
// Every BGG-linked game carries one, with `value: null` while none is counted,
// so the result screen knows the game takes part.
function swRecordFor(game, roundId, index) {
  const id = bggIdOf(game);
  if (!id) return null;
  const row = index.byId.get(id);
  const marks = (index.byRound.get(roundId) || new Map()).get(id) || { held: [], set: [], pending: [], excluded: [] };
  const out = {
    value: row && Number.isFinite(row.value) ? row.value : null,
    lowWins: row ? !!row.lowWins : !!game.lowScoreWins,
    held: marks.held,
    set: marks.set,
    pending: marks.pending,
    excluded: marks.excluded,
  };
  if (row && Number.isFinite(row.q1) && Number.isFinite(row.q3)) out.dist = { count: row.count, q1: row.q1, q3: row.q3 };
  return out;
}

function overlayRoundRecords(round, index) {
  if (!round || !Array.isArray(round.games) || !index) return round;
  round.games.forEach((g) => {
    const r = swRecordFor(g, round.id, index);
    if (r) g.swRecord = r;
  });
  return round;
}

function overlayGameRecords(game, roundId, index) {
  if (!game || !index) return game;
  const r = swRecordFor(game, roundId, index);
  if (r) game.swRecord = r;
  return game;
}

module.exports = { buildIndex, swRecordFor, overlayRoundRecords, overlayGameRecords };
