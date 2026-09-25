'use strict';

/*
 * An account's own play list (issue #1147) — the raw material of „Dein
 * Rückblick" on the OWN profile. One flat row per finished session the account
 * sat at, across every seat it holds; the client buckets it into months and
 * years (public/js/account-recap.js).
 *
 * Why a flat list and not per-period figures: bucketing needs a CALENDAR, and
 * the only calendar that gives the profile the same „März" as the Chronik two
 * taps away is the reader's device (`periodKeyOf`, public/js/period-recap.js).
 * The server runs in UTC, so a server-side bucket would move every evening
 * session on the last of a month into the next one for readers east of
 * Greenwich (.claude/rules/server-computed-calendar-periods.md §1 makes the
 * opposite call for a cached cross-tenant payload, and says why).
 *
 * The same walk as lib/user-stats.js — own tenant plus every grant, via the
 * exported `roundsForUser` — and the same disclosure property, by construction:
 * a row carries a timestamp, a cross-round game key, a title, a cover path and
 * this account's own rating. No round name, round id, member name or tenant id.
 * It is served on the SELF branch of the profile route only; nothing about its
 * shape has been through the friend-disclosure pass #1089's `stats` went through.
 *
 * Not truncated, ever: a capped list would silently understate a year total.
 */

const repo = require('./repo');
const { gameKey, roundsForUser } = require('./user-stats');
const { isNameableGame } = require('../public/js/recap');

// The rows of one seat. Same "joined" predicate as memberStats: a legacy session
// with no memberIds counts everyone as having joined.
function seatPlays(round, mid, into) {
  (round.sessions || []).forEach((s) => {
    if (!s.finished || !s.chosenGameId) return;
    if (Array.isArray(s.memberIds) && !s.memberIds.includes(mid)) return;
    // A deleted game has nothing to name — dropped, as playedKeys does.
    const game = (round.games || []).find((g) => g.id === s.chosenGameId);
    if (!game) return;
    const vote = ((s.votes || {})[mid] || {})[game.id];
    const rated = vote && Number.isFinite(vote.rating) ? vote.rating : null;
    into.push({
      // Dated by createdAt, the stamp every other surface dates a session by —
      // finishedAt moves on every winner correction
      // (.claude/rules/server-computed-calendar-periods.md §7).
      at: s.createdAt || null,
      key: gameKey(game),
      title: game.title,
      image: game.image || null,
      // A RETIRED game's rating is withheld: retiring is the round withdrawing a
      // taste claim, the bar the profile's favourite tile applies through the
      // same `isNameableGame` (member-stats.js). The PLAY still counts — the
      // session happened — exactly as the Chronik's Meistgespielt counts it.
      rating: isNameableGame(game) ? rated : null,
    });
  });
}

// Every play of `uid`, oldest first. An unknown account gets null; an account
// with no seat or no finished session gets []. A row with no createdAt cannot
// be placed in any period and is dropped.
async function accountPlays(uid) {
  const user = await repo.getUserById(uid);
  if (!user) return null;
  const plays = [];
  for (const round of await roundsForUser(user)) {
    for (const m of round.members || []) {
      if (m.userId === uid) seatPlays(round, m.id, plays);
    }
  }
  return plays
    .filter((p) => p.at)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

module.exports = { accountPlays };
