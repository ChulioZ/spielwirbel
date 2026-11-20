/* Spielwirbel – views: the session result's ONE composition (#1846), shared by
   all six designs. It replaced four per-design composers (Klassisch, Ocean,
   Forest, Die Brücke) and two `:has()` grids (Der Tisch, Das Programmheft),
   each of which cut the DOM at a fixed place whatever the evening's phase. The
   cut was constant and the content was not: while deciding, the side column
   held only the head beside a 1,300–1,500px ranking; after a game, it carried
   head, people, points, band, „Wie war's?" and the foot, so „Noch eine
   Session" fell below the fold.

   So the screen is built once, in DOM order = phone order:

     head (+ who was there, the teams)           ← spans
     .result-cols
       .result-aside  the evening: the badges just earned, the band, „Wer
                      fängt an?", the foot, and after a game the one list
                      of parties
       .result-main   the ranking and the record: Tafel, phone bar, photo,
                      guest offer, log, comments

   and resultPlace() moves only what the PHASE moves — the foot (in the head
   row while deciding) and the people row (absent once the party list names
   everyone) — plus one phase class on `.result-screen`. The columns come from
   styles.css, keyed off that class and the screen's own width (a container
   query, not the viewport). Part of the frontend; all files share one global
   script scope. */

function composeResultScreen(rs) {
  const { screen, head, badgeMoment, tischSlot, forestFacts, resultFoot, partySlot } = rs;
  // The design classes stay: every design sheet scopes its result rules to
  // them. Only their old column logic is gone.
  if (rs.oceanLook) screen.classList.add('result-screen--ocean');
  else if (rs.forestLook) screen.classList.add('result-screen--forest');
  else if (rs.brueckeLook) screen.classList.add('result-screen--bruecke');
  else if (!rs.tischLook) screen.classList.add('result-screen--klassisch');
  if (RESULT_ASIDE_END.some(designIs)) screen.classList.add('result-screen--aside-end');

  const aside = h('<div class="result-aside"></div>');
  const main = h('<div class="result-main"></div>');
  /* The badge moment („Neu verdient", #1388) keeps its place ahead of the
     band, the order test/badges-result-moment.test.js pins — so on a phone it
     still follows the headline. In the evening column it can be tall: 249px
     for a first session's eight founders at 1470×870 (measured, #1846). */
  const inAside = [badgeMoment, tischSlot, forestFacts, resultFoot, partySlot].filter(Boolean);
  const top = new Set([head, ...rs.headExtras]);
  [...screen.children].forEach((el) => {
    if (top.has(el) || inAside.includes(el)) return;
    main.appendChild(el);
  });
  inAside.forEach((el) => aside.appendChild(el));
  const cols = h('<div class="result-cols"></div>');
  cols.append(aside, main);
  screen.appendChild(cols);
  Object.assign(rs, { aside, main, cols });
  resultPlace(rs);
}

/* Called by resultRenderBand on every phase change (and once by the composer):
   the phase class, where the foot sits, and whether the people row stands. A
   no-op until the composer has run, because the first resultUpdateChosen in
   showResults paints the band before the columns exist. */
function resultPlace(rs) {
  const { screen, aside, head, resultFoot, partySlot } = rs;
  if (!aside) return;
  const phase = resultPhaseOf({
    chosenId: rs.chosenId, finished: rs.finished, cancelled: rs.cancelled,
    pickerOpen: rs.pickerOpen, solo: resultIsSoloDirectPlay(rs),
  });
  RESULT_PHASES.forEach((p) => screen.classList.toggle(`result-screen--${p}`, p === phase));
  // While deciding there is no evening column: „Teilen · Mehr" (and a
  // cancelled session's „Noch eine Session") join the head row instead.
  if (phase === 'deciding') {
    if (resultFoot.parentNode !== head) head.appendChild(resultFoot);
  } else {
    // After the band — except under Forest's played record, whose ~300px tree
    // pushed „Noch eine Session" under the fold, so the foot leads the column
    // there (operator decision, #1568). Before that the foot holds only
    // „Teilen · Mehr", and the band's own action comes first.
    const before = rs.forestLook && phase === 'played' ? rs.tischSlot : partySlot;
    if (resultFoot.nextSibling !== before) aside.insertBefore(resultFoot, before);
  }
  // After a game the party list names everyone once — with crown, points and
  // „Wie war's?" — so „Wer dabei war" and the teams line stand down.
  const listed = !partySlot.hidden;
  rs.headExtras.forEach((el) => { el.hidden = listed; });
  if (rs.peopleEl && rs.peopleEl.closest('.page-head')) rs.peopleEl.hidden = listed;
}
