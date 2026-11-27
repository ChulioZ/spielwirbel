/* Spielwirbel – the Spielwirbel-Rekord (#1788): the best personal score for a
   BoardGameGeek game across every round on the instance, and the three outlier
   checks that hold a suspicious score back for the operator.

   Shared by the server and the client (.claude/rules/shared-constants-across-the-stack.md):
   lib/game-records.js runs these checks in the scheduler's recompute, and the
   result screen runs the SAME checks the moment points are saved — the table is
   rewritten at most one tick later, so without the client half „Neuer
   Spielwirbel-Rekord!" would appear up to fifteen minutes late, and a hand-copied
   client rule would announce a record the server then holds back.

   Only the VALUE ever leaves the server, never who holds it. What a round read
   carries per BGG-linked game is `game.swRecord`:

     { value,      // the record, or null while no counted score exists
       lowWins,    // the direction the record is measured in
       dist?,      // { count, q1, q3 } once the distribution check applies
       set,        // this round's score keys that SET a Spielwirbel-Rekord
       pending,    // this round's score keys held back for review
       excluded }  // this round's score keys the operator excluded

   A score key here is ROUND-LOCAL — `<sessionId>/<seatId>` — so a round learns
   about its own scores and nothing about anybody else's.

   ## The three checks

   Each is mirrored for lowest-wins. The two RATIO checks only apply while both
   numbers are positive: a ratio over zero or a negative score (golf-style and
   penalty games go below zero) says nothing, and „3× the median" of −4 is not a
   threshold anyone could explain. The distribution check has no such limit.

     1. session — more than OUTLIER_SESSION_FACTOR × the median of the other
        personal scores of the same session (from a session with ≥ 2 of them);
     2. jump    — would beat the standing record by more than
        OUTLIER_JUMP_FACTOR × (from the second counted score);
     3. distribution — beyond Q3 + OUTLIER_IQR_FACTOR × IQR (Q1 − … for
        lowest-wins), once the game has OUTLIER_MIN_DISTRIBUTION counted scores.

   The thresholds are a starting point (the issue says so), which is why they
   are named here rather than written into the comparisons.

   Pure and DOM-free; loads before the views (index.html). */

'use strict';

const OUTLIER_SESSION_FACTOR = 3;
const OUTLIER_JUMP_FACTOR = 2;
const OUTLIER_IQR_FACTOR = 3;
const OUTLIER_MIN_DISTRIBUTION = 20;

// Linear-interpolated quantile of an ASCENDING list (the common "type 7").
function recordQuantile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// The figures the admin screen shows and check 3 reads, or null for no scores.
function recordDistribution(values) {
  const sorted = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    count: sorted.length,
    median: recordQuantile(sorted, 0.5),
    p90: recordQuantile(sorted, 0.9),
    q1: recordQuantile(sorted, 0.25),
    q3: recordQuantile(sorted, 0.75),
  };
}

// Is `a` strictly better than `b` in this direction? (point-records.js has the
// same comparison as `pointsBeat`; restated so this file needs no sibling.)
function recordBeats(a, b, lowWins) {
  return lowWins ? a < b : a > b;
}

/* Why `points` is an outlier — `[]` when it is not. `ctx`:
     peers:  the OTHER personal scores of the same session
     record: the record standing before this score (null = none yet)
     dist:   { count, q1, q3 } of the game's counted scores, or null */
function outlierReasons(points, ctx, lowWins) {
  const reasons = [];
  if (!Number.isFinite(points)) return reasons;
  const c = ctx || {};
  const peers = (c.peers || []).filter(Number.isFinite);
  if (peers.length >= 1) {
    const median = recordQuantile(peers.slice().sort((a, b) => a - b), 0.5);
    if (points > 0 && median > 0 && (lowWins
      ? points * OUTLIER_SESSION_FACTOR < median
      : points > median * OUTLIER_SESSION_FACTOR)) reasons.push('session');
  }
  const rec = c.record;
  if (Number.isFinite(rec) && points > 0 && rec > 0 && (lowWins
    ? points * OUTLIER_JUMP_FACTOR < rec
    : points > rec * OUTLIER_JUMP_FACTOR)) reasons.push('jump');
  const d = c.dist;
  if (d && d.count >= OUTLIER_MIN_DISTRIBUTION && Number.isFinite(d.q1) && Number.isFinite(d.q3)) {
    const iqr = d.q3 - d.q1;
    if (lowWins ? points < d.q1 - OUTLIER_IQR_FACTOR * iqr : points > d.q3 + OUTLIER_IQR_FACTOR * iqr) {
      reasons.push('distribution');
    }
  }
  return reasons;
}

/* What the result screen says beside one personal score: 'set' („Neuer
   Spielwirbel-Rekord!"), 'pending' („…? Wird geprüft") or null.

   The recompute's marks win whenever it has seen the score. A score it has not
   seen yet — saved since the last tick — is judged here with the same checks
   against the cached value: it can only be unseen if it beats that value
   (a counted score never does, since the value is the best of them), so the
   fallback cannot fire for a score the table already accounts for. */
function swRecordMark(game, sessionId, seatId, points, peers) {
  const r = game && game.swRecord;
  if (!r || !Number.isFinite(points)) return null;
  const key = `${sessionId}/${seatId}`;
  const has = (list) => Array.isArray(list) && list.includes(key);
  if (has(r.set)) return 'set';
  if (has(r.pending)) return 'pending';
  if (has(r.excluded)) return null;
  const value = Number.isFinite(r.value) ? r.value : null;
  if (value !== null && !recordBeats(points, value, !!r.lowWins)) return null;
  return outlierReasons(points, { peers, record: value, dist: r.dist || null }, !!r.lowWins).length ? 'pending' : 'set';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OUTLIER_SESSION_FACTOR, OUTLIER_JUMP_FACTOR, OUTLIER_IQR_FACTOR, OUTLIER_MIN_DISTRIBUTION,
    recordQuantile, recordDistribution, recordBeats, outlierReasons, swRecordMark,
  };
}
