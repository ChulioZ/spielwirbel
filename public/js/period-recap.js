/* Spielwirbel – the per-period recap (#800): what one calendar month or year
   looked like for a round, beside the all-time Rückblick (#484, recap.js).

   Everything here is derived ON DEMAND from the round payload and the activity
   feed the Pokale tab already has. Sessions stay the single source of truth
   (CLAUDE.md §Architecture), so deleting one removes its effect for free;
   nothing is stored, denormalized or fetched.

   Its dependencies arrive in `deps` rather than off the shared scope, for the
   reason recap.js's header sets out: a public/js file cannot require() a
   sibling, so injection is what keeps this file usable both as a shared-scope
   frontend script and as a CommonJS module the tests require, without a second
   copy of any rule. `deps` is { peopleOf, ratingOf, scoreOf, shelfOf, priorOf,
   playsOf, minRatings,
   isActive } — sessionPeople (session-people.js), effectiveRating
   (vote-scale.js), scoreRatings (vote-score.js) and RECAP_MIN_RATINGS
   (recap.js). The threshold is injected rather than re-declared here precisely
   because a second `3` is the drift
   .claude/rules/shared-constants-across-the-stack.md exists to prevent: the
   all-time best-rated card and this one must agree on how much evidence a
   crown costs.

   Load order: see index.html — after recap.js. */

'use strict';

// The month and year a timestamp falls in, by the LOCAL calendar of the device
// reading it. That is deliberate and must not be "fixed" toward UTC: a session
// that started at 22:00 on July 31 belongs to the group's July, and every other
// date on these screens (the Chronik's month headers, fmtMonth) is already
// local. A UTC bucket would move that evening into August for everyone east of
// Greenwich while the timeline above it still said July.
function periodKeyOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = String(d.getFullYear());
  return { month: `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`, year: y };
}

// A period matches a timestamp when the timestamp's own key for that granularity
// is the period's key — so a year needs no range arithmetic and cannot disagree
// with the months nested in it.
const inPeriod = (iso, period) => {
  const keys = periodKeyOf(iso);
  return !!keys && keys[period.kind] === period.key;
};

// Only nights that actually happened. `finished` is the same predicate recap.js
// and the Pokale standings use, so the period card's session count cannot
// disagree with the all-time one sitting above it. A split parent (#796) is not
// finished — its tables are, and they count individually, which is what the
// Chronik shows too.
const playedSessions = (round) => (round.sessions || []).filter((s) => s.finished);

// How each activity type moves the three shelf numbers.
//
// The bulk entries carry a COUNT and no title (#253/#481/#832), so one import of
// 120 games has to contribute 120 — rendering it as a single event would make
// the biggest shelf change a round ever has the smallest number on the card.
//
// `games_moved_in` counts as growth for the same reason an import does: those
// games are on this round's shelf now. Its mirror `games_moved_out`, and
// `game_deleted`, are deliberately in NEITHER bucket: a game that left the round
// was not *retired*, which is the specific act of keeping a game while taking it
// off the active list, and folding the two together would make one number mean
// two different things.
//
// `games_copied_in` (#916) counts for the identical reason. `games_copied_out`
// is in no bucket either, and here that is not even a judgement call: nothing
// left the source shelf, so a copy out changed none of the three numbers.
//
// `game_restored`/`game_uncompleted` do not decrement. The card is a record of
// what happened in the period, not a net delta — a game retired in July and
// restored in August is one event in each month, not zero in both.
const SHELF_EVENTS = {
  game_added: { field: 'added', n: 1 },
  games_imported: { field: 'added', count: true },
  games_moved_in: { field: 'added', count: true },
  games_copied_in: { field: 'added', count: true },
  game_retired: { field: 'retired', n: 1 },
  games_retired: { field: 'retired', count: true },
  game_completed: { field: 'completed', n: 1 },
};

const shelfEvents = (activities) =>
  (Array.isArray(activities) ? activities : []).filter((a) => a && SHELF_EVENTS[a.type]);

// Every period the round has something to say about, newest first, months before
// years. Periods with neither a played session nor a shelf change are not
// offered at all, so the picker has no empty rows and the section needs no empty
// state (the issue's own constraint).
//
// Months lead because the freshest, most specific slice is the one a group opens
// the tab for; the year sits below it, one click away.
function periodsOf(round, activities) {
  const months = new Set();
  const years = new Set();
  const note = (iso) => {
    const keys = periodKeyOf(iso);
    if (!keys) return;
    months.add(keys.month);
    years.add(keys.year);
  };
  playedSessions(round).forEach((s) => note(s.createdAt));
  shelfEvents(activities).forEach((a) => note(a.at));
  const desc = (a, b) => b.localeCompare(a);
  return [
    ...[...months].sort(desc).map((key) => ({ kind: 'month', key, at: `${key}-01T00:00:00` })),
    ...[...years].sort(desc).map((key) => ({ kind: 'year', key, at: `${key}-01-01T00:00:00` })),
  ];
}

// Which games were chosen how often, over the period's played sessions. Ids of
// deleted games are dropped, exactly as the Pokale tab's Meistgespielt card
// does: a stat naming a game that is no longer on the shelf has nothing to show.
function playTally(round, sessions) {
  const known = new Set((round.games || []).map((g) => g.id));
  const counts = new Map();
  sessions.forEach((s) => {
    if (!s.chosenGameId || !known.has(s.chosenGameId)) return;
    counts.set(s.chosenGameId, (counts.get(s.chosenGameId) || 0) + 1);
  });
  return counts;
}

// The best-rated game of the period, over the votes cast in the period's own
// sessions — so the threshold is evidence from THIS month, not the round's
// lifetime total, and a game the group rated once in July cannot be crowned by
// the twelve ratings it collected in June.
//
// ACTIVE SHELF ONLY, and deliberately unlike `playTally` above, which counts a
// retired game's nights. That asymmetry is #643's decision, not an oversight:
// Meistgespielt is a record of evenings that happened, while „Bestbewertet" is a
// claim of taste — and retiring a game is the user withdrawing that claim. What
// forces it here rather than leaving it a judgement call is that this card
// renders under the SAME label as the all-time one, which is active-only
// (`bestAndWorst`, recap.js): two cards with one label disagreeing about whether
// a retired game may be named would be incoherent whichever answer is right in
// the abstract. See .claude/rules/active-games-filter-sites.md, and
// test/pokale-retired.test.js, which pins the rule for the whole tab.
function bestRated(round, sessions, deps) {
  const known = new Set((round.games || []).filter(deps.isActive).map((g) => g.id));
  const ratings = new Map();
  sessions.forEach((session) => {
    const votes = session.votes || {};
    deps.peopleOf(round, session).forEach((person) => {
      const own = votes[person.id] || {};
      Object.keys(own).forEach((gid) => {
        if (!known.has(gid)) return;
        // A retirement proposal is the zero of the scale (#797), so it belongs
        // in the score like any other vote.
        const rating = deps.ratingOf(own[gid]);
        if (rating === null) return;
        const list = ratings.get(gid) || [];
        list.push(rating);
        ratings.set(gid, list);
      });
    });
  });
  // Ranked on the Spielwirbel-Score (#893), not the raw mean (#914) — injected
  // rather than computed here, for the reason this file's header gives about
  // `ratingOf`: a second copy of the curve is the drift. The all-time card next
  // to this one (recap.js's `bestAndWorst`) has always used it, so until #914 the
  // two „Bestbewertet" cards were one label over two different arithmetics.
  //
  // The field is `score`, not `avg`, deliberately — the same naming call
  // `bestAndWorst` documents: the sibling per-member stats really are raw means,
  // and one name for both would make that distinction invisible at the call site.
  //
  // And SHRUNK toward the period's own prior (#894), for the same reason again:
  // the all-time card beside it is shrunk, so leaving this one raw would put two
  // different arithmetics back under one label — the very split #914 closed. The
  // prior, the vote counts and the plays are all read from THIS period, so the
  // card answers „das bestbewertete Spiel 2026" out of 2026's evidence rather
  // than borrowing the round's whole history; over a period covering everything
  // the two cards therefore print the same number, which
  // test/chronik-period-recap.test.js pins.
  const plays = deps.playsOf({ sessions });
  const raw = new Map();
  ratings.forEach((list, gid) => {
    const sc = deps.scoreOf(list);
    if (sc) raw.set(gid, { score: sc.score, count: list.length });
  });
  // The prior is read over every active game rated in the period, NOT only the
  // ones clearing `minRatings`: it answers "what does a game on this shelf
  // typically score", and a thin game is still evidence about that even when it
  // may not wear a crown itself.
  const prior = deps.priorOf([...raw.values()].map((r) => r.score));
  let top = null;
  const scores = new Map();
  raw.forEach((r, gid) => {
    if (r.count < deps.minRatings) return;
    const score = deps.shelfOf(r.score, r.count, plays.get(gid) || 0, prior);
    if (score === null) return;
    scores.set(gid, score);
    if (top === null || score > top) top = score;
  });
  if (top === null) return null;
  const gameIds = [...scores.keys()].filter((gid) => scores.get(gid) === top);
  return { gameIds, score: top };
}

// The whole recap for one period. `period` is a row from periodsOf().
function periodRecap(round, activities, period, deps) {
  const sessions = playedSessions(round).filter((s) => inPeriod(s.createdAt, period));
  const plays = playTally(round, sessions);
  let max = 0;
  plays.forEach((n) => { if (n > max) max = n; });
  const shelf = { added: 0, retired: 0, completed: 0 };
  shelfEvents(activities)
    .filter((a) => inPeriod(a.at, period))
    .forEach((a) => {
      const rule = SHELF_EVENTS[a.type];
      const n = rule.count ? Number(a.count) : rule.n;
      if (Number.isFinite(n) && n > 0) shelf[rule.field] += n;
    });
  return {
    sessions: sessions.length,
    // Distinct games actually played, which is not the same as the number of
    // sessions: a group can spend four nights on one campaign.
    gamesPlayed: plays.size,
    topPlayed: max > 0 ? { gameIds: [...plays.keys()].filter((gid) => plays.get(gid) === max), count: max } : null,
    topRated: bestRated(round, sessions, deps),
    ...shelf,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { periodKeyOf, periodsOf, periodRecap };
}
