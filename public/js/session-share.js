/* Spielwirbel – the shareable session summary (#526): the plain text behind the
   results screen's „Teilen" button.

   Pure and dependency-free, so it works both as a shared-scope frontend script
   and as a CommonJS module the test suite can require. The translate functions
   are passed IN for the same reason recap.js takes its resolver: a public/js
   file cannot require() a sibling, and `t`/`tn` live in i18n.js.

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

// The three endings' headlines (#1038). Duplicated from `ENDING_LABELS` rather
// than injected because this file is required into Node by its own spec and by
// nothing that loads the shared-scope scripts; `test/session-share.test.js`
// asserts the two agree, the TAG_ICONS shape from
// .claude/rules/shared-constants-across-the-stack.md.
const SHARE_ENDING_TITLES = {
  lost: 'result.titleLost',
  noWinner: 'result.titleNoWinner',
  ongoing: 'result.titleOngoing',
};

// The one-line account of how a night ended without a winner (#1038), for a
// table of a split evening — the `line` half of `ENDING_LABELS`, duplicated for
// the same reason as the titles above and pinned to it by the same spec.
const SHARE_ENDING_LINES = {
  lost: 'result.endedLost',
  noWinner: 'result.endedNoWinner',
  ongoing: 'result.endedOngoing',
};

/* Which of the two messages this is (#1726). Before a game is chosen the group
   is still deciding, so the share is the vote ranking; once one is chosen —
   played or about to be — it is only about that game, and the ranking that led
   to it is dropped. A cancelled session never played one, so it keeps the
   ranking; a split evening is about its tables, which is an outcome. */
function shareStage(result) {
  if (result.outcome === 'split') return 'outcome';
  return result.playedTitle && !result.cancelled ? 'outcome' : 'ranking';
}

// How a game was rated, as counts per vote-card value, best first:
// „3× Unbedingt · 1× Gern". `dist` is [{ n, count, word }], the word being the
// one the voter pressed (voteSaidWord) — resolved by the caller, which owns the
// design. Counts only: nothing here can say who gave which rating, because
// nothing here knows (the issue's standing constraint).
function shareDistLine(dist, t) {
  return (dist || [])
    .filter((d) => d.count > 0)
    .sort((a, b) => b.n - a.n)
    .map((d) => t('share.dist', { count: d.count, word: d.word }))
    .join(' · ');
}

// The points, best first, as „Anna: 42" — `points` is
// [{ name, text, winner, automa }], `text` already formatted by the caller
// (fmtCount). The automa (#1672) closes the list, and without points it is
// named alone: it is what the table played against, as the screen lists it.
function sharePointLines(points, t) {
  return (points || []).map((pt) =>
    (pt.text ? t('points.top', { name: pt.name, points: pt.text }) : pt.name));
}

// The points a card has room for: the best `n`, but the automa always stays if
// it is in the list, since it is what the people's numbers are measured against.
function sharePointsFit(points, n) {
  const list = points || [];
  if (list.length <= n) return list;
  if (n <= 0) return [];
  const automa = list.find((pt) => pt.automa);
  if (!automa) return list.slice(0, n);
  return list.filter((pt) => !pt.automa).slice(0, n - 1).concat([automa]);
}

// One table of a split evening, in a line: who won (or how it ended), then the
// points. '' when the table recorded nothing, so a caller prints no empty line.
function shareTableResult(tb, t, join, tn) {
  const parts = [];
  const names = tb.winnerNames || [];
  if (names.length) {
    parts.push(tn(names.length, 'chronik.wonOne', 'chronik.won', { names: (join || ((xs) => xs.join(', ')))(names) }));
  } else if (SHARE_ENDING_LINES[tb.ending]) {
    parts.push(t(SHARE_ENDING_LINES[tb.ending]));
  }
  return parts.concat(sharePointLines(tb.points, t)).join(' · ');
}

// One line per rated game, in the screen's order: "🥇 Catan · Ø 4.5".
//
// Unrated games are skipped rather than rendered as the screen's "–": a bare
// dash carries no information in a chat message, and computePlaces gives such a
// row no place, so there would be nothing to number it with either.
//
// The average is formatted exactly as the screen prints it: what is shared has
// to match the pill the group is looking at while they read the message. That
// invariant is unchanged — the pill is what moved (#850), so the share text
// moved with it and a German message now reads „Ø 4,5".
//
// `fmtAvg` is injected for the same reason `t`/`tn`/`join` are (see the header)
// and, like `tn`, it takes the LAST position and has NO default here: a
// fallback would be the `toFixed(1)` this change exists to delete, so a caller
// that forgets it must fail loudly rather than quietly print a dot.
function shareRatingLines(rows, t, fmtAvg) {
  return rows
    .filter((r) => r.place && r.count)
    .map((r) =>
      t('share.row', {
        rank: SHARE_MEDALS[r.place - 1] || r.place + '.',
        title: r.title,
        score: fmtAvg(r.score),
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
// `tn` is injected beside `t` for the same reason `t` is (see the header), and
// it goes LAST rather than next to its sibling: a caller that forgets it then
// fails loudly on `tn is not a function`, where an argument inserted mid-list
// would silently read `join` as the plural helper.
function shareHeadline(result, t, join, tn) {
  // The outcome, not the two booleans (#796): a session split across several
  // tables was neither played nor cancelled, and without this arm it would fall
  // through to `playedTitle`-less silence — a message describing the ratings of
  // an evening with no account of what happened at it.
  if (result.outcome === 'split') return t('result.titleSplit');
  if (result.cancelled) return t('result.titleCancelled');
  if (!result.playedTitle) return null;
  // Chosen but not played yet (#1726): the screen still reads „Ergebnis", and
  // „wurde gespielt" would claim an evening that has not happened. An absent
  // flag reads as finished, so a caller predating it keeps its sentence.
  if (result.finished === false) return t('share.chosen', { game: result.playedTitle });
  const names = result.winnerNames || [];
  if (!names.length) {
    // How it ended when nobody won (#1038). The key is passed IN, already
    // resolved by `sessionEnding`, for the same reason `t` and `join` are: this
    // file is pure and cannot reach the helper. An ending nobody recorded keeps
    // the plain sentence, which is the honest thing to say about it.
    const key = SHARE_ENDING_TITLES[result.ending];
    return t(key || 'result.titlePlayed', { game: result.playedTitle });
  }
  return SHARE_TROPHY + ' ' + tn(names.length, 'result.titleWonOne', 'result.titleWonMany', {
    game: result.playedTitle,
    names: (join || ((xs) => xs.join(', ')))(names),
  });
}

// The full message. `result` is
// { roundName, when, outcome, cancelled, finished, playedTitle, winnerNames,
//   ending, points: [{ name, text, winner, automa }],
//   tables: [{ title, names, winnerNames, ending, points }],
//   rows: [{ title, score, count, place, dist: [{ n, count, word }] }] }.
// `score` is the DISPLAYED Spielwirbel-Score (#893), already clamped by the
// caller — this text lands in a group chat where non-users see it and there is
// no UI around it, so `share.row` spells the name out in full rather than
// printing a bare number nobody can place.
function sessionShareText(result, t, join, tn, fmtAvg) {
  const blocks = [t('share.header', { round: result.roundName, when: result.when })];
  const headline = shareHeadline(result, t, join, tn);
  if (headline) blocks[0] += '\n' + headline;
  // The tables of a split evening (#796) — the one thing its message is actually
  // about, since no game was played at the parent. Absent for every other
  // session, so nothing else gains a block.
  const tables = result.tables || [];
  if (tables.length) {
    blocks.push([t('share.tables')].concat(...tables.map((tb) => {
      const said = shareTableResult(tb, t, join, tn);
      const line = t('share.table', { title: tb.title, names: tb.names });
      return said ? [line, '  ' + said] : [line];
    })).join('\n'));
  }
  // Once a game is chosen the message is about that game only (#1726): its
  // points, if anyone counted, and no ranking.
  if (shareStage(result) === 'outcome') {
    const points = sharePointLines(result.points, t);
    if (points.length) blocks.push([t('share.points')].concat(points).join('\n'));
    return blocks.join('\n\n');
  }
  // Before a pick each game carries how it was rated, under its line.
  const rated = (result.rows || []).filter((r) => r.place && r.count);
  const lines = shareRatingLines(rated, t, fmtAvg).flatMap((line, i) => {
    const dist = shareDistLine(rated[i].dist, t);
    return dist ? [line, '  ' + dist] : [line];
  });
  // A cancelled session still carries ratings — the group rated the games, they
  // just did not play one — so the block is dropped only when there is nothing
  // rated at all, never because of the session's state.
  if (lines.length) blocks.push([t('share.ratings')].concat(lines).join('\n'));
  return blocks.join('\n\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sessionShareText, shareRatingLines, shareHeadline, SHARE_MEDALS, SHARE_TROPHY, SHARE_ENDING_TITLES,
    SHARE_ENDING_LINES, shareStage, shareDistLine, sharePointLines, sharePointsFit, shareTableResult,
  };
}
