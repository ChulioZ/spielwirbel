/* Spielwirbel – Die Brücke's Pokale plates (#1422: B3.4 desktop, B6.2 phone).
   Loaded after bruecke-shelf.js; shares one global script scope. Called from
   views-pokale.js at render time only, so the load order constrains nothing
   here (.claude/rules/frontend-script-load-order.md).

   B3.4 puts THREE plates beside the leaderboard — „Bestes Spiel", „Längste
   Serie", „Meiste Vetos" — where the other designs show the four trophy cards
   (Meistgespielt, Bestbewertet, Siegesserie, Staubfänger). The design owns its
   layout, so under Brücke these replace those four; every other design keeps
   them untouched. A plate is the sheet's: an eyebrow, a display value, one sub
   line — no cover and no icon (neither sheet draws one).

   Every figure is one the app already shows somewhere else, read from the same
   source, so a plate cannot contradict the screen one tap away:
   - Bestes Spiel is `recap.best` — the Bestbewertet card's own pick, i.e. the
     game the Regal puts at the top (#894) — with the Spielepass's „Mal
     gespielt" count beside its score;
   - Längste Serie is `longestStreak` (session-tally.js), the same nights and
     skips as the current-streak card, gated by the same young-round number;
   - Meiste Vetos is the Spielepass's „× kein Schub" tile (B13.4), maximised
     over the active shelf — the shelf index the page already built. Retired,
     finished and wished-for games are not on it, which keeps this a statement
     about the shelf the group still plays from.

   No module.exports: DOM code, reached through the jsdom harness — see
   .claude/rules/frontend-helper-modules-and-coverage.md. */

'use strict';

// One plate. `links` is a list of [text, wire] pairs: each becomes an <a> in
// the value line, wired by its own callback (a game or a member link), joined
// by commas — a tie names every holder. A trailing `tail` is plain text after
// the links („ · 3").
function brueckePlate(label, links, sub, tail = '') {
  const card = h(`<div class="pokale-card pokale-card--plate">
       <span class="pokale-card__label">${esc(label)}</span>
       <span class="pokale-card__value"></span>
       <span class="pokale-card__sub">${esc(sub)}</span>
     </div>`);
  const value = card.querySelector('.pokale-card__value');
  links.forEach(([text, wire], i) => {
    if (i) value.appendChild(document.createTextNode(', '));
    const a = h(`<a class="pokale-card__link">${esc(text)}</a>`);
    wire(a);
    value.appendChild(a);
  });
  if (tail) value.appendChild(document.createTextNode(tail));
  return card;
}

// „Februar bis März 2026" (B3.4): the month the run started — with its year only
// when the run crossed one — and the month it ended. One month prints once.
function brueckeStreakSpan(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  const sameYear = a.getFullYear() === b.getFullYear();
  if (sameYear && a.getMonth() === b.getMonth()) return fmtMonth(to);
  const start = sameYear ? a.toLocaleString(localeTag(locale), { month: 'long' }) : fmtMonth(from);
  return t('pokale.streakSpan', { from: start, to: fmtMonth(to) });
}

/* The right column: a `.pokale-cards` holding whichever of the three plates
   the round has data for (possibly none — the caller appends it only when it
   has children, as it does the four cards). */
function brueckePokalePlates(round, { shelfIndex, recap, finished, seriesHeld }) {
  const col = h('<div class="pokale-cards pokale-cards--plates"></div>');
  const gameLinks = (games) => games.map((g) => [g.title, (a) => makeGameLink(a, round.id, g.id)]);

  if (recap.best) {
    const games = recapGames(round, recap.best.gameIds);
    const score = fmtAvg(displayScore(recap.best.score));
    // The play count belongs to ONE game; a tie prints the shared score only.
    const plays = games.length === 1 ? (shelfIndex.byGame[games[0].id] || {}).plays || 0 : null;
    const playedLine = plays === null ? ''
      : plays ? tn(plays, 'pokale.playedOne', 'pokale.played', { n: plays }) : t('pokale.dustyNever');
    if (games.length) col.appendChild(brueckePlate(t('pokale.bestGame'), gameLinks(games), playedLine ? `${score} · ${playedLine}` : score));
  }

  const rec = longestStreak(round, finished, { sessionEnding, sessionPartyCount });
  const holders = round.members.filter((m) => rec.memberIds.includes(m.id));
  if (holders.length && rec.n >= 2 && !seriesHeld) {
    col.appendChild(brueckePlate(
      t('pokale.longestStreak'),
      holders.map((m) => [m.name, (a) => makeMemberLink(a, round.id, m.id)]),
      rec.from ? brueckeStreakSpan(rec.from, rec.to) : t('pokale.streakN', { n: rec.n }),
      ` · ${rec.n}`
    ));
  }

  // In shelf order, so a tie reads the same on every render. `byGame` holds the
  // ACTIVE shelf only, so an archived game reads 0 here without a second filter.
  const vetoes = (g) => (shelfIndex.byGame[g.id] || {}).vetoes || 0;
  const most = round.games.reduce((max, g) => Math.max(max, vetoes(g)), 0);
  if (most > 0) {
    const games = round.games.filter((g) => vetoes(g) === most);
    col.appendChild(brueckePlate(t('pokale.mostVetoes'), gameLinks(games),
      tn(most, 'score.reasonVetoBrueckeOne', 'score.reasonVetoBruecke', { n: most })));
  }
  return col;
}
