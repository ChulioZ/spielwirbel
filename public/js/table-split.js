/* Spielwirbel – splitting one voted session across several tables (#796).

   The objective, the search that optimises it, and the per-table numbers the
   builder screen shows. ONE file for both sides: lib/routes/sessions.js computes
   the proposals server-side and persists them, while the builder screen
   recomputes a table's average, its lowest rating and its violations live as
   people are moved by hand. Those two must agree exactly — a builder that scores
   a hand-made table differently from the way the recommendation was scored is a
   screen arguing with itself, with no error anywhere
   (.claude/rules/shared-constants-across-the-stack.md).

   Pure and dependency-free, so it works both as a shared-scope frontend script
   and as a CommonJS module the server and the test suite require. It reads a
   vote through `effectiveRating` (public/js/vote-scale.js), which is INJECTED
   rather than required for the reason recap.js injects it: a public/js file
   cannot require a sibling, and the suite loads this one into Node.
   Load order: see index.html — after vote-scale.js. */

'use strict';

// The smallest table worth calling a table, counted in PARTIES rather than
// bodies (#575): a pair playing as one team holds one hand, so three parties is
// three hands whatever the headcount behind them. Everything here counts parties
// for feasibility and PEOPLE for ratings, and the two are never conflated.
const MIN_TABLE_PARTIES = 3;

// At or below this, a seating is a tier-1 violation: the person is at a game
// they said they did not want to play. It is the bottom two of the 0-5 scale
// whose zero is the retirement proposal (#797) — so a retire vote is a violation
// by construction, with no separate clause, and a legacy row carrying both a
// rating and the flag resolves the same way here as everywhere else.
//
// THE THRESHOLD IS COUPLED TO THE SCALE. If the scale is ever changed, this
// moves with it in the same change; they must not drift apart.
const VIOLATION_MAX = 2;

// What an ABSENT vote counts as. A completed vote can never produce one — the
// vote card requires a rating or the zero tile — but partial and hand-crafted
// data can, and it must be neither a violation nor a reason to seat someone at a
// game they never rated. The midpoint of the 1-5 range a rating is actually
// written in; an integer, so every comparison below stays exact.
const NEUTRAL_RATING = 3;

// One person's rating for one game, as this file scores it.
function seatRating(votes, personId, gameId, effectiveRating) {
  const byGame = (votes || {})[personId];
  const r = byGame ? effectiveRating(byGame[gameId]) : null;
  return r === null || r === undefined ? NEUTRAL_RATING : r;
}

/* What ONE table says about itself: the two numbers the builder shows and the
   people the group needs to see named.

   Over the SEATED only, never over everyone — the whole point of the pair is to
   answer "is this table alright" for the people actually at it. The lowest is
   what makes a bad split visible at a glance; the average alone hides one
   miserable person behind five happy ones. */
function tableFeedback(table, votes, effectiveRating) {
  const personIds = (table && table.personIds) || [];
  const gameId = table && table.gameId;
  let sum = 0;
  let lowest = null;
  const violations = [];
  personIds.forEach((pid) => {
    const r = seatRating(votes, pid, gameId, effectiveRating);
    sum += r;
    if (lowest === null || r < lowest) lowest = r;
    if (r <= VIOLATION_MAX) violations.push(pid);
  });
  return { sum, avg: personIds.length ? sum / personIds.length : null, lowest, violations };
}

// Every party count from MIN_TABLE_PARTIES up to `maxParties` this game can
// seat, ascending. Derived from `fitsPlayerCount`, so owned expansions (#653)
// widen it exactly as they widen the draw pool — and the set may have HOLES,
// which is why it is enumerated rather than reduced to a min/max pair: a 3-4
// base with a 6-8 expansion admits {3,4,6,7,8} and nothing at 5.
function admittedTableSizes(game, maxParties, fitsPlayerCount) {
  const sizes = [];
  for (let s = MIN_TABLE_PARTIES; s <= maxParties; s++) {
    if (fitsPlayerCount(game, s)) sizes.push(s);
  }
  return sizes;
}

/* THE MULTI-TABLE DRAW POOL PREDICATE — the sibling of `fitsPlayerCount`, and
   the reason the relaxed pool is not simply a different player count.

   `fitsPlayerCount` is point containment: does this box seat exactly the party
   at the table? Multi-table asks a different question — can this box seat SOME
   table the group could form? — so it is an existence test over the admitted
   sizes between three and the whole group.

   The upper bound matters as much as the lower one. A 10-12 player game admits
   no table a group of six could form, so it has no business in their pool even
   though its maximum clears three; bounding by `maxParties` is what says so.
   Owned expansions and the absent-range rule are inherited wholesale, because
   the whole predicate is expressed through `fitsPlayerCount` rather than by
   reading min/max again (.claude/rules/expansions-widen-by-union.md).

   It lives HERE rather than beside `fitsPlayerCount` in draw-pool.js only
   because these are classic scripts over one global lexical scope: two files
   cannot both declare `MIN_TABLE_PARTIES`, and every other user of that constant
   is in this file. draw-pool.js carries a pointer to it. */
function fitsSomeTable(game, maxParties, fitsPlayerCount) {
  for (let s = MIN_TABLE_PARTIES; s <= maxParties; s++) {
    if (fitsPlayerCount(game, s)) return true;
  }
  return false;
}

/* Which table counts are worth searching at all, from the headcount and the
   pool — never a fixed ceiling (#796 section 3a). A group of sixty needs a dozen
   tables or more, and a hard maximum would simply make the feature unusable at
   that size.

       ceil(N / largest table the pool can seat)  <=  k  <=  floor(N / 3)

   The lower bound is computed against the k LARGEST capacities rather than
   against one repeated maximum, because the games differ: two 4-player games
   cannot seat nine parties even though one 9-player game could. The upper bound
   can never exceed the number of distinct games drawn either — two tables playing
   the same box at once needs two copies of it. */
function feasibleTableCounts(games, totalParties, fitsPlayerCount) {
  const caps = (games || [])
    .map((g) => {
      const sizes = admittedTableSizes(g, totalParties, fitsPlayerCount);
      return sizes.length ? sizes[sizes.length - 1] : 0;
    })
    .filter((c) => c >= MIN_TABLE_PARTIES)
    .sort((a, b) => b - a);
  const kMax = Math.min(Math.floor(totalParties / MIN_TABLE_PARTIES), caps.length);
  if (kMax < 1) return [];
  let kMin = 0;
  let seats = 0;
  while (seats < totalParties && kMin < caps.length) {
    seats += caps[kMin];
    kMin++;
  }
  if (seats < totalParties) return []; // every drawn game together cannot seat them
  const out = [];
  for (let k = Math.max(1, kMin); k <= kMax; k++) out.push(k);
  return out;
}

/* The score of a whole split, as a LEXICOGRAPHIC tuple on the raw ratings — no
   weights, no normalisation, no aggregate anyone could argue about. Lower is
   better in every field, which is why the two "highest" tiers are stored
   negated: it keeps `compareSplits` a single loop instead of a per-field
   direction table nobody can check at a glance.

     1. violations  — people seated at a game they do not want to play
     2. -sum        — the sum of every seated person's raw rating
     3. -lowest     — the highest lowest rating across all seated people
     4. emptySeats  — fuller tables ...
     5. tables      — ... then fewer of them

   Tier 2 stays comparable ACROSS table counts because every person is seated
   exactly once in every candidate, so the sum always has the same number of
   terms. Tier 4 measures fullness against each game's OWN capacity rather than
   against the biggest table in the split: seating four parties at a 2-4 game
   leaves no empty seat, seating them at a 1-12 game leaves eight. */
function scoreSplit(tables, ctx) {
  let violations = 0;
  let sum = 0;
  let lowest = Infinity;
  let emptySeats = 0;
  tables.forEach((tb) => {
    const agg = ctx.aggregate(tb);
    violations += agg.violations;
    sum += agg.sum;
    if (agg.lowest < lowest) lowest = agg.lowest;
    emptySeats += ctx.capOf(tb.gameId) - tb.partyIds.length;
  });
  return [violations, -sum, -(lowest === Infinity ? 0 : lowest), emptySeats, tables.length];
}

// Negative when `a` is the better split. Plain lexicographic order on integers,
// so the comparison is exact and two runs of the same search cannot disagree.
function compareSplits(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/* A deterministic RNG, seeded from the session id.

   The randomness is in the SEARCH (restarts), never in the scoring — the
   objective above is a pure function of the split and the votes, on integers.
   Seeding costs nothing and buys two things: two simultaneous first requests
   compute byte-identical proposals, so whichever loses the idempotent write has
   produced the same answer anyway; and a split someone reports as bad is
   reproducible from the stored session instead of being a one-off nobody can
   recreate. */
function seedFrom(text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pick a feasible size for every table: start each at its smallest admitted
// count and grow random tables one admitted step at a time until the parties are
// exactly used up. Returns null when this game subset cannot seat them at all,
// which is the normal way an infeasible `k` drops out of the search.
function chooseSizes(admits, totalParties, rand) {
  const idx = admits.map(() => 0);
  let seated = admits.reduce((n, sizes) => n + sizes[0], 0);
  if (seated > totalParties) return null;
  while (seated < totalParties) {
    const options = [];
    admits.forEach((sizes, t) => {
      const next = sizes[idx[t] + 1];
      if (next !== undefined && next - sizes[idx[t]] <= totalParties - seated) options.push(t);
    });
    if (!options.length) return null;
    const t = options[Math.floor(rand() * options.length)];
    seated += admits[t][idx[t] + 1] - admits[t][idx[t]];
    idx[t]++;
  }
  return admits.map((sizes, t) => sizes[idx[t]]);
}

// Seat every party, one at a time in random order, at whichever table with room
// left scores best for that party alone. A deliberately shallow start — the local
// search below is what actually finds the split; this only has to be feasible and
// not absurd.
function seedAssignment(gameIds, sizes, partyIds, ctx, rand) {
  const tables = gameIds.map((gameId) => ({ gameId, partyIds: [] }));
  shuffleWith(partyIds, rand).forEach((pid) => {
    let best = -1;
    let bestKey = null;
    tables.forEach((tb, t) => {
      if (tb.partyIds.length >= sizes[t]) return;
      const cell = ctx.cell(pid, tb.gameId);
      const key = [cell.violations, -cell.sum, -cell.lowest];
      if (bestKey === null || compareSplits(key, bestKey) < 0) {
        bestKey = key;
        best = t;
      }
    });
    tables[best].partyIds.push(pid);
  });
  return tables;
}

// Try one party moving from `from` to `to`. Both table sizes change, so both have
// to stay inside their game's admitted set — the holes an expansion leaves make
// this a real test rather than a range check.
function tryMoves(from, to, tables, ctx, state) {
  if (from.partyIds.length - 1 < MIN_TABLE_PARTIES) return false;
  if (!ctx.admits(from.gameId, from.partyIds.length - 1)) return false;
  if (!ctx.admits(to.gameId, to.partyIds.length + 1)) return false;
  for (let i = 0; i < from.partyIds.length; i++) {
    const x = from.partyIds.splice(i, 1)[0];
    to.partyIds.push(x);
    const next = scoreSplit(tables, ctx);
    if (compareSplits(next, state.score) < 0) {
      state.score = next;
      return true;
    }
    to.partyIds.pop();
    from.partyIds.splice(i, 0, x);
  }
  return false;
}

function trySwaps(ta, tb, tables, ctx, state) {
  for (let i = 0; i < ta.partyIds.length; i++) {
    for (let j = 0; j < tb.partyIds.length; j++) {
      const x = ta.partyIds[i];
      const y = tb.partyIds[j];
      ta.partyIds[i] = y;
      tb.partyIds[j] = x;
      const next = scoreSplit(tables, ctx);
      if (compareSplits(next, state.score) < 0) {
        state.score = next;
        return true;
      }
      ta.partyIds[i] = x;
      tb.partyIds[j] = y;
    }
  }
  return false;
}

// Swap a table's game for one nothing else is using; the current size has to be
// admitted by the replacement.
function trySwapGames(tables, ctx, unused, state) {
  for (let t = 0; t < tables.length; t++) {
    for (let u = 0; u < unused.length; u++) {
      const gid = unused[u];
      if (!ctx.admits(gid, tables[t].partyIds.length)) continue;
      const prev = tables[t].gameId;
      tables[t].gameId = gid;
      const next = scoreSplit(tables, ctx);
      if (compareSplits(next, state.score) < 0) {
        state.score = next;
        unused[u] = prev;
        return true;
      }
      tables[t].gameId = prev;
    }
  }
  return false;
}

/* Hill-climb from a seeded assignment with the three operators above.

   First-improvement, bounded by PASSES rather than by wall clock — a search whose
   result depended on how fast the machine ran would break the one property the
   whole persistence design exists to guarantee. */
function improve(tables, ctx, unused, maxPasses) {
  const state = { score: scoreSplit(tables, ctx) };
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let a = 0; a < tables.length && !moved; a++) {
      for (let b = a + 1; b < tables.length && !moved; b++) {
        moved = trySwaps(tables[a], tables[b], tables, ctx, state)
          || tryMoves(tables[a], tables[b], tables, ctx, state)
          || tryMoves(tables[b], tables[a], tables, ctx, state);
      }
    }
    if (!moved) moved = trySwapGames(tables, ctx, unused, state);
    if (!moved) break;
  }
  return state.score;
}

// The best split this search finds for exactly `k` tables, or null when `k` is
// infeasible over this pool.
function bestSplitForCount(k, ctx, rand, restarts, maxPasses) {
  let bestTables = null;
  let bestScore = null;
  for (let r = 0; r < restarts; r++) {
    const shuffled = shuffleWith(ctx.gameIds, rand);
    const picked = shuffled.slice(0, k);
    const sizes = chooseSizes(picked.map((gid) => ctx.sizesOf(gid)), ctx.partyIds.length, rand);
    if (!sizes) continue;
    const tables = seedAssignment(picked, sizes, ctx.partyIds, ctx, rand);
    const score = improve(tables, ctx, shuffled.slice(k), maxPasses);
    if (bestScore === null || compareSplits(score, bestScore) < 0) {
      bestScore = score;
      bestTables = tables.map((tb) => ({ gameId: tb.gameId, partyIds: tb.partyIds.slice() }));
    }
  }
  return bestTables ? { tables: bestTables, score: bestScore } : null;
}

// How many restarts one table count gets. Held roughly constant in TOTAL work
// rather than per split: the local search is quadratic in the party count, so a
// fixed restart budget would make a sixty-person round cost twenty times a
// twelve-person one for the same request.
function restartBudget(partyCount) {
  return Math.max(6, Math.min(24, Math.round(400 / Math.max(1, partyCount))));
}

// How many proposals are persisted. The builder's control selects among these, so
// it also bounds how many table counts the group can choose between.
const MAX_TABLE_PROPOSALS = 5;

/* Every proposal this session gets, one per feasible table count, SMALLEST
   FIRST.

   The window is the smallest feasible counts rather than the best-scoring ones,
   and that is a deliberate departure from the issue's wording. More tables means
   more distinct games, which means fewer tier-1 violations and a higher tier-2
   sum — so "best-scoring" degenerates to "as many tables as the pool allows", the
   very shattering section 3a warns about, and a window around it would offer the
   group five variations of the most fragmented arrangement. The smallest feasible
   count is also the default the issue asks for, so the window starts where the
   highlight is.

   `parties` is [{ id, personIds }] — one entry per team plus one per un-teamed
   person, so a team is never split across two tables and all its people's ratings
   count. */
function proposeTableSplits({ parties, games, votes, seed, effectiveRating, fitsPlayerCount }) {
  const partyList = (parties || []).filter((p) => p && Array.isArray(p.personIds) && p.personIds.length);
  const total = partyList.length;
  const counts = feasibleTableCounts(games, total, fitsPlayerCount);
  if (!counts.length) return [];

  const sizesByGame = new Map();
  const capByGame = new Map();
  const usable = [];
  (games || []).forEach((g) => {
    const sizes = admittedTableSizes(g, total, fitsPlayerCount);
    if (!sizes.length) return;
    sizesByGame.set(g.id, sizes);
    capByGame.set(g.id, sizes[sizes.length - 1]);
    usable.push(g.id);
  });

  // Every (party, game) pair scored once up front: the local search evaluates the
  // same cells thousands of times, and they never change.
  const cells = new Map();
  partyList.forEach((p) => {
    usable.forEach((gid) => {
      const fb = tableFeedback({ gameId: gid, personIds: p.personIds }, votes, effectiveRating);
      cells.set(p.id + ' ' + gid, {
        sum: fb.sum,
        lowest: fb.lowest === null ? NEUTRAL_RATING : fb.lowest,
        violations: fb.violations.length,
      });
    });
  });

  const ctx = {
    partyIds: partyList.map((p) => p.id),
    gameIds: usable,
    cell: (pid, gid) => cells.get(pid + ' ' + gid),
    sizesOf: (gid) => sizesByGame.get(gid),
    admits: (gid, size) => sizesByGame.get(gid).includes(size),
    capOf: (gid) => capByGame.get(gid),
    aggregate: (tb) => {
      let violations = 0;
      let sum = 0;
      let lowest = Infinity;
      tb.partyIds.forEach((pid) => {
        const c = ctx.cell(pid, tb.gameId);
        violations += c.violations;
        sum += c.sum;
        if (c.lowest < lowest) lowest = c.lowest;
      });
      return { violations, sum, lowest: lowest === Infinity ? NEUTRAL_RATING : lowest };
    },
  };

  const byId = new Map(partyList.map((p) => [p.id, p]));
  const rand = mulberry32(seedFrom(seed));
  const restarts = restartBudget(total);
  const proposals = [];
  for (const k of counts) {
    if (proposals.length >= MAX_TABLE_PROPOSALS) break;
    if (k < 2) continue; // a single table is not a split
    const best = bestSplitForCount(k, ctx, rand, restarts, 6);
    if (!best) continue;
    proposals.push({
      tables: best.tables.map((tb) => ({
        gameId: tb.gameId,
        personIds: tb.partyIds.flatMap((pid) => byId.get(pid).personIds),
      })),
    });
  }
  return proposals;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MIN_TABLE_PARTIES,
    VIOLATION_MAX,
    NEUTRAL_RATING,
    MAX_TABLE_PROPOSALS,
    seatRating,
    tableFeedback,
    admittedTableSizes,
    fitsSomeTable,
    feasibleTableCounts,
    scoreSplit,
    compareSplits,
    proposeTableSplits,
  };
}
