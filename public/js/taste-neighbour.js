/* Spielwirbel – whose taste in the round sits closest to a member's, and whose
   sits furthest away (#1778), for die Tischkarte's „Geschmack" line.

   A PURE derivation over the round object, computed on demand from the
   sessions' votes like every other rating statistic — nothing is stored.

   THE MEASURE is the mean absolute difference of the two members' per-game
   AVERAGE rating, over the games both have rated: 0 means they rate every
   shared game identically, 4 that one always gives a 1 where the other gives a
   5. It was chosen over a rank correlation because it needs no variance — a
   member who rates everything a 4 has an undefined correlation with everyone,
   while the distance still says something true about them — and because it
   reads directly in the rating's own units, which keeps the code explainable.

   Per-game AVERAGE, not per vote: a game rated on ten evenings would otherwise
   count ten times as much as one rated once, so the pair's verdict would be the
   verdict on whatever they happen to play most.

   A pair qualifies only with at least TASTE_MIN_SHARED shared games. Below that
   one lucky agreement names a „neighbour" off two games, and the line would
   change with every evening.

   Which games may count is `isNameableGame` (recap.js), the bar the Pokale
   Lieblingsspiele and the member page's favourite apply: a retired game is a
   preference the round has withdrawn, so agreeing about it is not shared taste
   today. Which members may be NAMED is `activeMembers` (member-active.js) — a
   retired seat leaves the forward-facing person lists, and this line names
   people (.claude/rules/retired-members-filter-sites.md). Guests are never
   candidates: only round members are scanned.

   WORDS ONLY on the page: the distance orders, it is never printed (#1778,
   the voting stance — no percentage, no score about how much two people
   agree).

   `deps` is injected with a global fallback, the memberStats shape, so the
   function also runs under Node. Dependency-free otherwise. */

const TASTE_MIN_SHARED = 5;

/* gameId -> that member's average rating, nameable games only. */
function tasteAverages(round, mid, isNameable) {
  const nameable = new Set(round.games.filter(isNameable).map((g) => g.id));
  const sums = {};
  round.sessions.forEach((s) => {
    const votes = (s.votes || {})[mid] || {};
    Object.keys(votes).forEach((gid) => {
      const v = votes[gid];
      if (!v || !Number.isFinite(v.rating) || !nameable.has(gid)) return;
      const e = sums[gid] || (sums[gid] = { sum: 0, n: 0 });
      e.sum += v.rating;
      e.n += 1;
    });
  });
  const avg = {};
  Object.keys(sums).forEach((gid) => { avg[gid] = sums[gid].sum / sums[gid].n; });
  return avg;
}

/* Mean absolute difference over the shared games, or null below the floor. */
function tasteDistance(a, b) {
  const shared = Object.keys(a).filter((gid) => gid in b);
  if (shared.length < TASTE_MIN_SHARED) return null;
  const total = shared.reduce((acc, gid) => acc + Math.abs(a[gid] - b[gid]), 0);
  // Rounded so two pairs that are equal on paper tie, rather than splitting on
  // the last bit of a float sum.
  return Math.round((total / shared.length) * 1e9) / 1e9;
}

/* { near: [member…], far: [member…] } — both empty when no pair qualifies.
   Ties are named together, in the round's member order. `far` is empty
   whenever it would name exactly the people `near` does (one qualifying pair,
   or every pair at one distance): „closest" and „most different" naming the
   same person says nothing either way. */
function tasteNeighbours(round, mid, deps) {
  const d = deps || { isNameableGame, activeMembers };
  const own = tasteAverages(round, mid, d.isNameableGame);
  const scored = d.activeMembers(round)
    .filter((m) => m.id !== mid)
    .map((m) => ({ member: m, dist: tasteDistance(own, tasteAverages(round, m.id, d.isNameableGame)) }))
    .filter((x) => x.dist !== null);
  if (!scored.length) return { near: [], far: [] };
  const min = Math.min(...scored.map((x) => x.dist));
  const max = Math.max(...scored.map((x) => x.dist));
  const pick = (v) => scored.filter((x) => x.dist === v).map((x) => x.member);
  return { near: pick(min), far: max > min ? pick(max) : [] };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TASTE_MIN_SHARED, tasteDistance, tasteNeighbours };
}
