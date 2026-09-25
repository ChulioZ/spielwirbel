/* Spielwirbel – „Dein Rückblick" (#1147): one calendar month or year of an
   ACCOUNT's play, across every round it sits in — the per-period recap
   (period-recap.js, #800) for a person rather than for a round.

   Input is the flat play list the own profile carries (`plays`, built by
   lib/user-plays.js): `[{ at, key, title, image, rating }]`, one row per
   finished session the account sat at. Everything here is derived on demand
   from it; nothing is stored.

   The BUCKETING happens here, on the reader's device, and on purpose: the
   server runs in UTC, and a session at 22:00 on July 31 belongs to the group's
   July for every reader east of Greenwich too. So `periodKeyOf` and `periodsOf`
   are period-recap.js's own, INJECTED rather than re-declared — a second
   month-bucketing function is how the profile and the Chronik two taps away
   would come to disagree about what „März" is
   (.claude/rules/shared-constants-across-the-stack.md).

   What this deliberately does NOT carry: wins, win rates, a Siegwertung. It is
   a record of what you played, not of who won (the issue's scope).

   `deps` is { periodKeyOf, periodsOf }. Load order: see index.html — after
   period-recap.js, before views-profile.js. */

'use strict';

// The play list as the minimal round shape `periodsOf` reads — finished
// sessions dated by `createdAt`, no shelf events (added/retired/completed are
// a round's shelf, not a person's). Adapting the input rather than writing a
// second `periodsOf` keeps the ordering (months newest first, then years) and
// the "no empty period is ever offered" rule in exactly one place.
function accountPeriodsOf(plays, deps) {
  const sessions = (Array.isArray(plays) ? plays : []).map((p) => ({ finished: true, createdAt: p.at }));
  return deps.periodsOf({ sessions }, []);
}

// Game rows for display: first title and first cover seen for a key. The same
// game on two shelves can carry two local titles; the oldest play's wins, which
// is stable across renders (the server sorts oldest first).
function accountRecapGame(games, p) {
  const g = games.get(p.key);
  if (!g) {
    games.set(p.key, { key: p.key, title: p.title, image: p.image || null });
  } else if (!g.image && p.image) {
    g.image = p.image;
  }
  return games.get(p.key);
}

const accountRecapByTitle = (a, b) => String(a.title).localeCompare(String(b.title));

/* The recap of one period (a row from accountPeriodsOf):

   { sessions, gamesPlayed,
     topPlayed: { games, count } | null,
     topRated:  { games, rating, plays } | null,
     newGames:  [game] }

   where a game is { key, title, image }. */
function accountRecap(plays, period, deps) {
  const list = Array.isArray(plays) ? plays : [];
  const games = new Map();
  list.forEach((p) => accountRecapGame(games, p));

  const inPeriod = (p) => {
    const keys = deps.periodKeyOf(p.at);
    return !!keys && keys[period.kind] === period.key;
  };
  const rows = list.filter(inPeriod);

  const count = new Map(); // key -> plays in the period
  const ratings = new Map(); // key -> own ratings in the period
  rows.forEach((p) => {
    count.set(p.key, (count.get(p.key) || 0) + 1);
    if (Number.isFinite(p.rating)) {
      const r = ratings.get(p.key) || [];
      r.push(p.rating);
      ratings.set(p.key, r);
    }
  });

  // Meistgespielt: ties share the row, as on every other card in the app;
  // listed alphabetically so the order does not depend on the input's.
  let max = 0;
  count.forEach((n) => { if (n > max) max = n; });
  const topPlayed = max > 0
    ? { games: [...count.keys()].filter((k) => count.get(k) === max).map((k) => games.get(k)).sort(accountRecapByTitle), count: max }
    : null;

  /* Am besten bewertet — the account's OWN ratings, not the group's score, so
     neither the Spielwirbel-Score curve nor RECAP_MIN_RATINGS transfers: that
     bar is about how much GROUP evidence a crown costs, and here the only voice
     is yours. The rule, in order:
       1. at least one own rating in the period (a game you played but never
          rated cannot be your best-rated one);
       2. the highest MEAN of your ratings for that game within the period;
       3. among equal means, more plays in the period wins — the same
          evidence-first tie-break user-stats.js applies to its tiles;
       4. what is still tied shares the row, listed alphabetically. */
  let topRated = null;
  ratings.forEach((r, key) => {
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const n = count.get(key) || 0;
    if (!topRated || mean > topRated.rating || (mean === topRated.rating && n > topRated.plays)) {
      topRated = { keys: [key], rating: mean, plays: n };
    } else if (mean === topRated.rating && n === topRated.plays) {
      topRated.keys.push(key);
    }
  });
  if (topRated) {
    topRated = { games: topRated.keys.map((k) => games.get(k)).sort(accountRecapByTitle), rating: topRated.rating, plays: topRated.plays };
  }

  /* Neu ausprobiert: games whose EARLIEST play by this account, ever — over the
     WHOLE list, every round included — falls in this period. Computed from the
     instant, not from list order, and timezone-stable in the sense that matters:
     the earliest play is the earliest play whatever calendar buckets it. */
  const first = new Map(); // key -> earliest play
  list.forEach((p) => {
    const f = first.get(p.key);
    if (!f || new Date(p.at) < new Date(f.at)) first.set(p.key, p);
  });
  const newGames = [...first.values()].filter(inPeriod).map((p) => games.get(p.key)).sort(accountRecapByTitle);

  return {
    sessions: rows.length,
    gamesPlayed: count.size,
    topPlayed,
    topRated,
    newGames,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { accountPeriodsOf, accountRecap };
}
