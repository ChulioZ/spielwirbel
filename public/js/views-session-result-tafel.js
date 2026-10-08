/* Spielwirbel – views: the results screen's Tafel (#1056) — the tally of a
   session's votes into ranked rows, and the rows themselves with the gold top
   group. Split out of showResults (#1543).

   Every function here takes the results screen's one context object, `rs`,
   built once by showResults (views-session.js) — see its comment there for
   what it holds. Fixed inputs and DOM nodes are destructured at the top of
   each function; the evening's PHASE (`rs.chosenId`, `rs.finished`,
   `rs.cancelled`, `rs.winnerIds`, `rs.ending`, `rs.pickerOpen`, …) is always
   read and written through `rs`, because the screen's controls change it after
   render and every function must see the change. Nothing here names
   showResults: a re-render goes through `rs.reopen`, so the dependency runs one
   way (#1543, the #968 shape). Part of the frontend; all files share one global
   script scope. */

/* The „aussortiert" / „durchgespielt" badge (#250). Shared by the ranking row
   and the table band (#1107) rather than written twice: the band is the ONLY
   surface carrying it once the Tafel is gated away, so a look-alike copy here
   would be a fact that silently drifts. */
function resultArchivedBadge(g) {
  return g.retired
    ? ` <span class="tag tag--retired">${iconText('ti-archive', t('result.retiredTag'))}</span>`
    : g.completed
      ? ` <span class="tag tag--completed">${iconText('ti-circle-check', t('result.completedTag'))}</span>`
      : '';
}

function tallyResultRows(games, people, session) {
  // Tally per game.
  const rows = games.map((g) => {
    const ratings = [];
    people.forEach((p) => {
      const v = (session.votes[p.id] || {})[g.id];
      if (v && Number.isFinite(v.rating)) ratings.push(v.rating);
    });
    const sum = ratings.reduce((a, b) => a + b, 0);
    const avg = ratings.length ? sum / ratings.length : 0;
    // The Spielwirbel-Score (#893): the same votes weighed through the tile
    // curve, so a game one person does not want to play stops outranking a game
    // everybody is fine with. `avg` stays for the share text's raw fallback and
    // for anything describing the votes rather than the game.
    const sc = scoreRatings(ratings);
    // Indexed by rating, so slot 0 is a permanent hole the chart below skips —
    // the same shape (and the same reason) as vote-score.js's TILE_VALUE.
    const dist = [0, 0, 0, 0, 0, 0];
    ratings.forEach((r) => dist[r]++);
    return {
      game: g,
      avg,
      score: sc ? sc.score : 0,
      // What the pill prints and what places tie on — see computePlaces.
      shown: sc ? displayScore(sc.score) : 0,
      vetoes: sc ? sc.vetoes : 0,
      count: ratings.length,
      dist,
    };
  });

  // Sorted on the UNCLAMPED score, so two games below the displayed floor still
  // order by how bad they actually are.
  rows.sort((a, b) => b.score - a.score);
  // Tie-aware places ("1, 2, 2, 4"): games with the same displayed score share
  // a place and a medal. Drives both the winner spotlight and the medal list.
  computePlaces(rows).forEach((place, i) => { rows[i].place = place; });
  return rows;
}

function buildResultTafel(rs) {
  const { round, session, games, rows, hasVotes, reveal, screen, tischLook, phLook, brueckeLook, forestLook } = rs;
  // „1× kein Schub" under Die Brücke — the scale's end word, never „kein Veto".
  const whyOf = (r) => (brueckeLook ? brueckeScoreReason(r) : scoreReason(r));
  /* Die Tafel (#1056) — the ranked rows, carrying the celebration themselves.

     What this replaces: a 900px gold `.spotlight` around 272px of winner covers,
     sitting above rows that stated the same ranking again. It conflated two
     different facts — what the VOTE said (a top place, possibly shared) and what
     was PLAYED (one game, someone won) — so a tie showed two covers over one
     pair of winners with nothing linking them, and a group that played a third
     game made the hero contradict the record.

     The row is the whole instrument now: a rank rail, a background fill whose
     width IS the Spielwirbel-Score, and — for every row sharing first place —
     one gold group with one kicker. A tie therefore adds a ROW rather than
     growing anything, which is the property `.claude/rules/rank-encodings-must-
     not-be-growable-by-ties.md` asks for. */
  const tafel = h(`<div class="tafel">
       <div class="tafel__kick">
         <h2 class="tafel__title">${esc(tn(games.length, 'result.voteTitleOne', 'result.voteTitle', { n: games.length }))}</h2>
         <span class="tafel__hint" hidden>${esc(t('result.choosePrompt'))}</span>
       </div>
     </div>`);
  screen.appendChild(tafel);
  const tafelHint = tafel.querySelector('.tafel__hint');
  // Der Tisch's column-header row (#1275). Only over a ranking: a session nobody
  // voted in lists candidates, with no votes or score to head (#915). The
  // score's ⓘ moves up beside the heading, because the row's „Spielwirbel-Score"
  // label it used to ride is exactly what the header's „Score" replaces.
  if (tischLook && hasVotes) {
    if (rows.some((r) => r.count)) {
      tafel.querySelector('.tafel__title').insertAdjacentHTML('afterend', infoButton('score'));
    }
    tafel.appendChild(composedTafelCols());
  }

  /* The gold group. Same gate the spotlight had: two or more games to rank, a
     top place to name, and a session that was not cancelled — a cancelled
     evening has nothing to celebrate, and a single-game session has nothing to
     have won. `reveal` is the only thing that animates it; every other way in
     (the Chronik, a shared link, a cold load) renders the rest state, which is
     also what a reduced-motion reader gets. */
  const topRows = rows.filter((r) => r.place === 1);
  const hasTop = rows.length >= 2 && topRows.length && !session.cancelled;
  let topGroup = null;
  if (hasTop) {
    const shared = topRows.length > 1;
    topGroup = h(`<div class="tafel-top${reveal ? ' is-reveal' : ''}">
         <div class="tafel-top__kicker">
           <i class="ti ti-crown tafel-top__crown" aria-hidden="true"></i>
           ${esc(t(shared ? 'result.winnerShared' : 'result.voteWinner'))}
         </div>
       </div>`);
    tafel.appendChild(topGroup);
    if (reveal) {
      // Design-agnostic on purpose (#940): a design may re-shape these SAME bits
      // in CSS (the round worlds did, until #1202), so nothing here knows which
      // design is worn. The per-bit randomness therefore travels as custom
      // properties: the colour, because an inline `background` would beat every
      // rule a design could write; and a horizontal drift, set for every bit
      // and simply ignored by the default fall.
      const conf = h('<div class="confetti" aria-hidden="true"></div>');
      for (let i = 0; i < 16; i++) {
        const bit = h('<span class="confetti__bit"></span>');
        bit.style.left = Math.round(Math.random() * 100) + '%';
        bit.style.setProperty('--bit-color', MEMBER_COLORS[i % MEMBER_COLORS.length]);
        bit.style.setProperty('--bit-drift', Math.round(Math.random() * 60 - 30) + 'px');
        bit.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
        conf.appendChild(bit);
      }
      topGroup.appendChild(conf);
    }
  }

  const maxBar = Math.max(1, ...rows.map((r) => Math.max(...r.dist)));
  const rowRefs = [];
  let infoPlaced = false;

  rows.forEach((r, i) => {
    const g = r.game;
    const imgStyle = g.image ? `style="background-image:url('${coverUrl(g.image, COVER_THUMB)}')"` : '';
    const fallback = coverPlaceholder(g);
    /* The distribution, drawn in the VOTE CARD's vocabulary (#890): five columns
       1–5, each tinted with `avgColor(n)` and named on an always-visible axis by
       the same mood face the voter pressed minutes earlier. (It had a sixth for
       the trash tile until #909 removed that rung; `dist` is still indexed by
       rating, so the chart drops slot 0 rather than re-basing the array.)

       What it replaces, and why: identical `--brand-edge` bars whose only
       numerals were vote COUNTS, sitting precisely where an axis label belongs.
       So a „3" in the fourth column read as „this is a 3" before it read as
       „three people", while bar height already carried that count. The label
       channel is spent on the axis instead, and colour does the rest — the
       columns stop having to be read as a left-to-right sequence at all.

       Counts stay in `title=`, on the whole column rather than the bar, so a
       one-vote column is still hoverable. The readable numbers remain the score
       and its „Spielwirbel-Score" label.

       The label cannot live INSIDE the bar: an unvoted rung is 0px tall, and
       every column must be labelled — that is what makes an empty rung read as
       an empty slot rather than as a missing one. Hence the full-height track
       behind each fill, and the separate axis row. */
    const bars = !hasVotes ? '' : r.dist
      .slice(RATING_MIN)
      .map((c, i) => {
        const n = i + RATING_MIN;
        const title = t('result.barTitle', { c, word: voteSaidWord(n) });
        // The axis is the face alone (#1530): the rung's digit went with the
        // vote card's, so nothing on the chart invites averaging the columns.
        // The tooltip names the rung by its WORD for the same reason. The fill
        // and the glyph carry the ramp; a glyph is a non-text UI component, so
        // it sits at the 3:1 bar rather than text's 4.5:1.
        /* `--sc` + `data-stop` rather than two inline colours (#1191). T8.2
           ships the bar half of a ramp DARKER than the pill half, because these
           sit on paper while a pill carries its own ink — so a design has to be
           able to repaint the fill and the glyph, and an inline `background`
           would beat every rule it could write. The continuous colour stays the
           default, so Klassisch is unchanged. */
        /* Das Programmheft prints the COUNT in each step's square (#1374, P4.3:
           „· · · 1 3"), so a reader gets the same fact in words; the glyph-and-
           digit axis the other designs label the columns with is hidden there. */
        const phCount = phLook
          ? `<span class="bar-col__n" aria-hidden="true">${c || '·'}</span><span class="sr-only">${esc(title)}</span>` : '';
        return `<div class="bar-col" title="${esc(title)}" style="--sc:${avgColor(n)}" data-stop="${rampStop(n)}"${phLook ? ` data-count="${c}"` : ''}>
             <div class="bar-track"><div class="bar" style="height:${Math.round((c / maxBar) * 100)}%"></div>${phCount}</div>
             <div class="bar-axis"><i class="ti ${ratingFace(n)}" aria-hidden="true"></i></div>
           </div>`;
      })
      .join('');
    // Info if the game has been archived in the meantime (#250: either way).
    const retiredBadge = resultArchivedBadge(g);
    /* The score's NAME, not a vote count (#902). Within one session `n` is the
       same on every row — the vote card refuses to advance until each drawn
       game has been placed somewhere on the scale (see the guard in
       renderVote) — so „Score aus 3" restated the participant line once per
       row while the number itself, no longer a plain mean since #893, went
       unnamed. A row nobody voted on prints the bare „–" and gets NO label at
       all: there is no score there to name.

       The single ⓘ rides the first labelled row, i.e. the highest-scoring game
       anybody voted on (`rows` is sorted by score above). score-info.js places
       it once per screen, never per pill. */
    const scoreLabel = r.count
      ? `<div class="score-label">${esc(t('score.name'))}${infoPlaced ? '' : ` ${infoButton('score')}`}</div>`
      : '';
    if (r.count) infoPlaced = true;
    /* Who brings the box, on EVERY row (#1008). #971 printed this only inside
       the chosen row's finish panel, and a VOTING session has no chosen game
       until somebody taps „Spielen" — so the one screen listing every candidate
       said nothing about ownership at the exact moment the group is deciding.
       Same shared rule as the panel, so the two can never disagree. */
    const bringers = boxBringers(round, session, g, shelfParty);
    const ownersLine = bringers.length
      ? `<div class="trow__owners">${iconText('ti-user', t('result.ownedBy', { names: bringers.join(', ') }))}</div>`
      : '';
    /* The fill: `--pct` is the displayed score over the scale's top, so the row
       IS its own bar chart and the empty part of a row is the score's
       remainder. That is what lets the row use the 544px of nothing it used to
       carry between the mini chart and the number — a wider column becomes a
       longer score axis instead of a wider gutter (`.claude/rules/tiles-vs-
       lists.md`). `--sc` travels as the raw accent and CSS does the mix, the
       `.stamp` mechanism from #1040: an inline `background` would beat every
       rule a design could write. A row nobody voted on carries 0%,
       so it is simply bare. */
    const pct = r.count ? Math.round((r.shown / RATING_MAX) * 1000) / 10 : 0;
    const fillVars = `--pct:${pct}%;${r.count ? `--sc:${scoreColor(r.score)};` : ''}`;
    // Only the reveal path gets a duration, and it is per row: every fill starts
    // together, the short ones land first and the winner's completes last.
    const raceVar = reveal && r.count ? `--dur:${(0.5 + r.shown * 0.32).toFixed(2)}s;` : '';
    // Das Programmheft prints the revealed Tafel top first (P10.4); capped at
    // the tenth row so any Tafel is printed inside the sheet's 1.8s. Die
    // Brücke's decrypted Tafel drives in on the same index (B10.4, #1248).
    // Forest reads the same index to light its rows up one by one (F10.4, #1476).
    const printVar = reveal && (phLook || brueckeLook || forestLook) ? `--print-i:${Math.min(i, 9)};` : '';
    const rankClass = r.place && r.place <= 3 ? ` trow__rank--${r.place}` : '';
    const row = tischLook ? composedTrow({
      row: r, hasVotes, bars, rankClass, imgStyle, fallback,
      rowClass: `trow${reveal ? ' is-race' : ''}`, rowStyle: `${fillVars}${raceVar}${printVar}`,
      title: g.title, badge: retiredBadge, ownersLine,
      whyLine: r.count && whyOf(r) ? `<div class="score-why">${esc(whyOf(r))}</div>` : '',
    }) : h(`<div class="trow${reveal ? ' is-race' : ''}" style="${fillVars}${raceVar}">
         <span class="trow__rank${rankClass}">${r.place || ''}</span>
         <a class="trow__img" ${imgStyle}>${fallback}</a>
         <div class="trow__main">
           <a class="trow__title">${esc(g.title)}${retiredBadge}</a>
           ${ownersLine}
           ${r.count && scoreReason(r) ? `<div class="score-why">${esc(scoreReason(r))}</div>` : ''}
         </div>
         ${hasVotes ? `<div class="trow__bars">${bars}</div>` : ''}
         <div class="trow__score">
           ${!hasVotes ? '' : `
           <div class="score-big"${r.count ? ` style="--sc:${scoreColor(r.score)}"` : ''}>${r.count ? fmtAvg(r.shown) : '–'}</div>
           ${scoreLabel}`}
         </div>
         <div class="trow__action"></div>
       </div>`);
    // Title and cover open the game's detail page (the action column below lives
    // in a sibling element, so it keeps working independently). The cover is
    // flagged redundant: it targets the same game as the title beside it, so it
    // stays mouse-clickable but is not a second (nameless) tab stop.
    const titleEl = row.querySelector('.trow__title');
    makeGameLink(titleEl, round.id, g.id);
    makeGameLink(row.querySelector('.trow__img'), round.id, g.id, { redundant: true });
    // What the row's „Spielen" and „…" point `aria-describedby` at (audit
    // 2026-10-04 A6): every row repeats the same two labels, so without it a
    // screen reader's list of controls reads „Spielen, Spielen, Spielen".
    titleEl.id = `trow-title-${i}`;
    rowRefs.push({ gameId: g.id, game: g, row, actionEl: row.querySelector('.trow__action'),
      ownersEl: row.querySelector('.trow__owners'), titleId: titleEl.id });
    (hasTop && r.place === 1 ? topGroup : tafel).appendChild(row);
  });
  rs.tafel = tafel;
  rs.tafelHint = tafelHint;
  rs.rowRefs = rowRefs;
}
