/* Spielwirbel – the session result as Der Tisch composes it (#1275, T2.5 at 390,
   T4.4 at 1440).

   What the sheet draws and the app did not: the Tafel as COMPACT rows under a
   column-header row (Platz · Spiel · Score), each ending in a score pill with
   the per-game distribution under it; the people on the felt head as crowned
   pieces; and a foot carrying „Noch eine Session" with „Teilen" and „Mehr"
   beside it.

   Every builder here is called from showResults (views-session.js) and only
   under `tischLook` (Der Tisch, and Ocean, which shares the composition) —
   Klassisch never reaches this file, so its DOM is the default path,
   untouched. Its own file rather than more branches inside
   views-session.js, which is on the token budget's allowlist already
   (.claude/rules/token-friendly-source-files.md).

   No module.exports: every function builds DOM, and a require() from Node would
   enter the coverage report almost wholly unreachable
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach these
   through the jsdom harness (test/tisch-result-tafel.test.js). */

'use strict';

/* The column-header row. A LIST with an `aria-hidden` header, not a <table>:
   every row carries links and a menu, and nesting those in table cells buys
   nothing a screen reader needs. So the header is purely visual and each row
   says what its cells are — the rank cell carries „Platz" and the pill carries
   the score's name, both as `.sr-only` text, and the distribution is a named
   group.

   Laid on the SAME column tracks as the rows (tisch.css makes the Tafel a grid
   and every row and this header a subgrid of it), so a label cannot drift off
   its column however wide a pill or a „Spielen" button makes one row. */
function composedTafelCols() {
  return h(`<div class="tafel__cols" aria-hidden="true">
       <span class="tafel__col tafel__col--place">${esc(t('result.colPlace'))}</span>
       <span class="tafel__col tafel__col--game">${esc(t('result.colGame'))}</span>
       <span class="tafel__col tafel__col--score">${esc(t('result.colScore'))}</span>
     </div>`);
}

/* One compact row. The cells showResults already computes are passed in as
   finished HTML, so the classes every downstream handler reads (`.trow__title`,
   `.trow__img`, `.trow__owners`, `.trow__action`) are the same ones the
   Klassisch row carries — updateChosen, the lift, the reveal race and the
   owners stand-down need no second code path.

   DOM ORDER IS VISUAL ORDER (WCAG 2.4.3): the distribution comes LAST, because
   it sits below the row. The Klassisch row keeps it between the title and the
   score, where it also sits on screen.

   The distribution is always shown (#1363). It used to sit behind a vote-count
   toggle, but within one session that count is the same on every row (the vote
   card will not advance until every drawn game is rated — #902's reasoning for
   dropping „Score aus 3" from Klassisch), so the column repeated one number and
   hid the one part that differs. A row nobody rated gets empty tracks, as in
   Klassisch, so every row keeps one shape. The toggle's label was the bars'
   accessible name; it moves onto the group, since the header is aria-hidden and
   the per-column `title=` is not a name. */
function composedTrow(p) {
  const r = p.row;
  const pill = !p.hasVotes ? ''
    : r.count
      ? `<span class="score-pill trow__pill" style="--sc:${scoreColor(r.score)}" data-stop="${scoreStop(r.score)}"><span class="sr-only">${esc(t('score.name'))} </span>${fmtAvg(r.shown)}</span>`
      : '<span class="score-pill score-pill--none trow__pill">–</span>';
  return h(`<div class="${p.rowClass}" style="${p.rowStyle}">
       <span class="trow__rank${p.rankClass}"><span class="sr-only">${esc(t('result.colPlace'))} </span>${r.place || ''}</span>
       <a class="trow__img" ${p.imgStyle}>${p.fallback}</a>
       <div class="trow__main">
         <a class="trow__title">${esc(p.title)}${p.badge}</a>
         ${p.ownersLine}
         ${p.whyLine}
       </div>
       ${pill}
       <div class="trow__action"></div>
       ${p.hasVotes ? `<div class="trow__bars" role="group"
           aria-label="${esc(tn(r.count, 'result.distShowOne', 'result.distShow', { n: r.count }))}">${p.bars}</div>` : ''}
     </div>`);
}

/* „Wer dabei war" on the felt head: the same people the Klassisch line lists,
   each a piece carrying a crown that `paintComposedCrowns` switches on for a
   winner. The crown is `aria-hidden` — the head's own sentence already names
   who won, so saying it twice to a screen reader adds nothing. */
function composedPersonCrown() {
  return '<i class="ti ti-crown result-people__crown" aria-hidden="true"></i>';
}

// Re-run on every render of the band (renderTisch), because a winner chip, the
// reset and „Ändern" all move the winners without re-rendering the screen.
function paintComposedCrowns(root, winnerIds) {
  if (!root) return;
  root.querySelectorAll('.result-people__person[data-pid]').forEach((el) => {
    el.classList.toggle('is-winner', winnerIds.includes(el.dataset.pid));
  });
}

/* The foot (T2.5, T4.4): the next evening, sharing this one, and everything
   else behind „Mehr". Refilled on every phase change rather than built once,
   because what belongs in it moves with the session: „Noch eine Session" only
   once this one is settled (finished or cancelled — while it is still running,
   the next one is not the question), and cancelling only while no game is
   chosen, exactly as Klassisch's footer offers it.

   `again` is null when the button does not belong; `againDisabled` mirrors the
   hub's own gate (no active game to draw from). An empty `more` renders no
   „Mehr" at all rather than a menu with nothing in it. */
function fillComposedResultFoot(foot, { again, againDisabled, share, more }) {
  foot.innerHTML = '';
  if (again) {
    const btn = h(`<button type="button" class="btn btn--primary result-foot__again">${iconText('ti-tornado', t('tables.oneMore'))}</button>`);
    btn.addEventListener('click', again);
    if (againDisabled) {
      btn.disabled = true;
      btn.title = t('round.startSessionDisabled');
    }
    foot.appendChild(btn);
  }
  if (share) {
    const btn = h(`<button type="button" class="btn btn--ghost result-foot__share">${iconText('ti-share', t('share.button'))}</button>`);
    btn.addEventListener('click', share);
    foot.appendChild(btn);
  }
  if (more.length) {
    const btn = h(`<button type="button" class="btn btn--ghost result-foot__more" aria-expanded="false">${iconText('ti-dots', t('result.more'))}</button>`);
    // Buttons only, so a popover at every width — the same menu the rows open
    // (.claude/rules/popover-vs-sheet-editors.md §2b). `aria-expanded` is synced
    // through openPopover's onClose, which sees every exit.
    btn.addEventListener('click', () => {
      openPopover(btn, (el, close) => fillMenu(el, more, close),
        () => btn.setAttribute('aria-expanded', 'false'));
      btn.setAttribute('aria-expanded', 'true');
    });
    foot.appendChild(btn);
  }
  foot.hidden = !foot.childElementCount;
}
