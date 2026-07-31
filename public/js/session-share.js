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

// One line per rated game, in the screen's order: "1. Catan · Ø 4.5".
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
    .map((r) => t('share.row', { place: r.place, title: r.title, avg: r.avg.toFixed(1) }));
}

// The headline: the same sentence the results screen puts in its <h1>, so the
// message opens with what the reader would see on the screen it came from.
// Returns null while the session has no outcome yet (nothing chosen, not
// cancelled) — then the ratings alone are the whole message.
function shareHeadline(result, t) {
  if (result.cancelled) return t('result.titleCancelled');
  if (!result.playedTitle) return null;
  const names = result.winnerNames || [];
  if (!names.length) return t('result.titlePlayed', { game: result.playedTitle });
  return t(names.length === 1 ? 'result.titleWonOne' : 'result.titleWonMany', {
    game: result.playedTitle,
    names: result.winnerNames.join(', '),
  });
}

// The full message. `result` is
// { roundName, when, cancelled, playedTitle, winnerNames, rows: [{ title, avg, count, place }] }.
function sessionShareText(result, t) {
  const blocks = [t('share.header', { round: result.roundName, when: result.when })];
  const headline = shareHeadline(result, t);
  if (headline) blocks[0] += '\n' + headline;
  const lines = shareRatingLines(result.rows || [], t);
  // A cancelled session still carries ratings — the group rated the games, they
  // just did not play one — so the block is dropped only when there is nothing
  // rated at all, never because of the session's state.
  if (lines.length) blocks.push([t('share.ratings')].concat(lines).join('\n'));
  return blocks.join('\n\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sessionShareText, shareRatingLines, shareHeadline };
}
