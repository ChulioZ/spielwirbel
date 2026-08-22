/* Spielwirbel – the shareable session summary (#526): the plain text behind the
   results screen's „Teilen" button.

   Pure and dependency-free, so it works both as a shared-scope frontend script
   and as a CommonJS module the test suite can require. The translate function is
   passed IN for the same reason recap.js takes its resolver: a public/js file
   cannot require() a sibling, and `t` lives in i18n.js.

   The builder takes the view model showResults has ALREADY computed — the same
   sorted rows, places and winner names it just rendered — rather than re-tallying
   the votes itself. That is what keeps the shared text and the screen from
   drifting apart, and it is why the summary can never contain more than the
   screen shows (the issue's own constraint): there is nothing else here to read.

   Text only, and nothing but the group's own words: no cover art, no link, no
   footer. Provider covers may not be redistributed
   (.claude/rules/provider-cover-hotlinking.md), and the user picks the recipient,
   so nothing is ever sent anywhere by the app itself.

   Load order: see index.html. */

'use strict';

// The medals mirror the screen's own `rank-medal--gold/silver/bronze`, which it
// awards to places 1-3 and to nothing else — so a tie for 2nd correctly yields
// two silvers, and place 4 falls back to a plain "4.", exactly as the rows below
// the podium do.
//
// These live here rather than in lang/*.js on purpose: they are language-
// independent symbols, not copy, so translating them would be meaningless and
// having every locale carry a copy is how one of them ends up different. (They
// are the app's only emoji — the lang tables deliberately have none. A chat
// message is not app chrome, and the whole point of the button is to produce
// something that reads as a message rather than as a log dump.)
const SHARE_MEDALS = ['🥇', '🥈', '🥉'];
const SHARE_TROPHY = '🏆';

// One line per rated game, in the screen's order: "🥇 Catan · Ø 4.5".
//
// Unrated games are skipped rather than rendered as the screen's "–": a bare
// dash carries no information in a chat message, and computePlaces gives such a
// row no place, so there would be nothing to number it with either.
//
// The average is `toFixed(1)`, exactly as the screen prints it — deliberately
// NOT locale-formatted. What is shared has to match the pill the group is
// looking at while they read the message.
function shareRatingLines(rows, t) {
  return rows
    .filter((r) => r.place && r.count)
    .map((r) =>
      t('share.row', {
        rank: SHARE_MEDALS[r.place - 1] || r.place + '.',
        title: r.title,
        avg: r.avg.toFixed(1),
      })
    );
}

// The headline: the same SENTENCE the results screen puts in its <h1>, so the
// message opens with what the reader would see on the screen it came from.
// Returns null while the session has no outcome yet (nothing chosen, not
// cancelled) — then the ratings alone are the whole message.
//
// The trophy leads that sentence only when somebody actually won. A cancelled
// session and a played-but-unrecorded one both get none: a trophy over „Session
// abgebrochen" would be reading the room badly, and the emoji is here to mark a
// result, not to decorate every message.
//
// `join` is core.js's `joinNames` — injected, like `t`, because that is where it
// lives and this file cannot require() a sibling. It matters that it is the real
// one: the h1 reads "Anna und Ben", so a local `names.join(', ')` here would put
// a subtly different sentence in the chat than the one on screen, and would be
// worse German besides. The comma fallback exists only so the builder stays
// callable without it.
function shareHeadline(result, t, join) {
  // The outcome, not the two booleans (#796): a session split across several
  // tables was neither played nor cancelled, and without this arm it would fall
  // through to `playedTitle`-less silence — a message describing the ratings of
  // an evening with no account of what happened at it.
  if (result.outcome === 'split') return t('result.titleSplit');
  if (result.cancelled) return t('result.titleCancelled');
  if (!result.playedTitle) return null;
  const names = result.winnerNames || [];
  if (!names.length) return t('result.titlePlayed', { game: result.playedTitle });
  return SHARE_TROPHY + ' ' + t(names.length === 1 ? 'result.titleWonOne' : 'result.titleWonMany', {
    game: result.playedTitle,
    names: (join || ((xs) => xs.join(', ')))(names),
  });
}

// The full message. `result` is
// { roundName, when, outcome, cancelled, playedTitle, winnerNames,
//   tables: [{ title, names }], rows: [{ title, avg, count, place }] }.
function sessionShareText(result, t, join) {
  const blocks = [t('share.header', { round: result.roundName, when: result.when })];
  const headline = shareHeadline(result, t, join);
  if (headline) blocks[0] += '\n' + headline;
  // The tables of a split evening (#796) — the one thing its message is actually
  // about, since no game was played at the parent. Absent for every other
  // session, so nothing else gains a block.
  const tables = result.tables || [];
  if (tables.length) {
    blocks.push([t('share.tables')].concat(
      tables.map((tb) => t('share.table', { title: tb.title, names: tb.names }))
    ).join('\n'));
  }
  const lines = shareRatingLines(result.rows || [], t);
  // A cancelled session still carries ratings — the group rated the games, they
  // just did not play one — so the block is dropped only when there is nothing
  // rated at all, never because of the session's state.
  if (lines.length) blocks.push([t('share.ratings')].concat(lines).join('\n'));
  return blocks.join('\n\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sessionShareText, shareRatingLines, shareHeadline, SHARE_MEDALS, SHARE_TROPHY };
}
