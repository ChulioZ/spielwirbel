/* Spielwirbel – a lent box (#1775): „verliehen an Kim seit 3. 11.".

   `game.loan = { to, memberId?, since }`, ABSENT when the box is at home (never
   null on disk — absent-key parity, .claude/rules/postgres-backend.md).
   `to` is the borrower's name as typed or picked, `memberId` the round seat when
   one was picked, `since` a calendar day 'YYYY-MM-DD'.

   Shared with the server (.claude/rules/shared-constants-across-the-stack.md):
   lib/routes/games.js validates the name against LOAN_TO_MAX and the day
   against isLoanDay, and lib/draw.js applies fitsLoanFilter — the same clause
   the setup screen's live preview applies, so the preview cannot promise a box
   the draw leaves out (or the reverse). Dependency-free and requirable from
   Node; part of the frontend's shared global scope in the browser. */

// The longest borrower name the UI offers and the route accepts. A name, not a
// note — free text about a third party, shown to the whole round.
const LOAN_TO_MAX = 60;

// How long a box may be out before the Kümmerliste mentions it: eight weeks.
const LOAN_LONG_DAYS = 56;

const LOAN_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real calendar day, written the way the date input writes it. Round-tripped
// through Date.UTC so '2026-02-31' is refused rather than read as 3 March.
function isLoanDay(v) {
  const m = typeof v === 'string' && LOAN_DAY_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Is this box out of the house right now? Anything but a loan with a name reads
// as "at home", so a malformed blob can only ever leave a game drawable.
function isLentOut(game) {
  const loan = game && game.loan;
  return !!(loan && typeof loan === 'object' && typeof loan.to === 'string' && loan.to.trim());
}

// The draw clause. A lent box is NOT drawn unless the session asked for lent
// games too („Verliehene Spiele mitwirbeln") — only a literal `true` opts in, so
// an absent or malformed flag keeps the default.
function fitsLoanFilter(game, includeLent) {
  return includeLent === true || !isLentOut(game);
}

// Who has it, as the round should read it: the seat's CURRENT name when the
// borrower was picked from the round and is still a member, else the name as
// typed at the time. A deleted seat therefore falls back to the stored text —
// the memberId is left in place and simply stops resolving.
function loanBorrowerName(round, loan) {
  if (!loan) return '';
  const seat = loan.memberId && ((round && round.members) || []).find((m) => m.id === loan.memberId);
  return seat && seat.name ? seat.name : String(loan.to || '');
}

// A calendar day as a day number, read in LOCAL time for a Date and as written
// for a 'YYYY-MM-DD' — so "eight weeks" counts calendar days on both sides of a
// DST switch (.claude/rules/server-computed-calendar-periods.md §8).
function loanDayIndex(v) {
  if (typeof v === 'string') {
    const m = LOAN_DAY_RE.exec(v);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
  }
  const d = new Date(v);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
}

// Today as the date input writes it, in the device's own calendar.
function loanToday(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The games out for at least LOAN_LONG_DAYS, longest out first. A loan whose
// day cannot be read is left out rather than guessed at.
function longLoans(games, now = Date.now()) {
  const today = loanDayIndex(now);
  return (games || [])
    .filter((g) => isLentOut(g))
    .map((g) => ({ game: g, days: today - loanDayIndex(g.loan.since) }))
    .filter((x) => Number.isFinite(x.days) && x.days >= LOAN_LONG_DAYS)
    .sort((a, b) => b.days - a.days)
    .map((x) => x.game);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LOAN_TO_MAX, LOAN_LONG_DAYS, isLoanDay, isLentOut, fitsLoanFilter,
    loanBorrowerName, loanDayIndex, loanToday, longLoans,
  };
}
