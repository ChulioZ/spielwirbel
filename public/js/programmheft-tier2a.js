/* Spielwirbel – Das Programmheft's tier-2a extras (#1379): the pieces its
   sheet (Programmheft-P13-Tier2a) draws that no other design has, kept out of
   the view files they plug into because views-member.js sits at the 700-line
   budget (.claude/rules/token-friendly-source-files.md).

     - the Chronik's head actions: „Rückblick" (phone, P13.2) opens the period
       recap as a sheet (P15a sheet 12), „Teilen" (desktop, P13.1) shares the
       period the black box is showing;
     - „Letzte Siege" on the member page (P13.5/P13.6).

   Every builder here is called only under designIs('programmheft'), so
   Klassisch's DOM never sees any of it. Part of the frontend; all files share
   one global script scope (load order: see index.html — after
   views-period-recap.js and views-member.js, whose helpers these call at click
   or render time only). */

'use strict';

/* The two head actions. `periodSec` is the recap the page already rendered
   (the black box); null when the round has no period worth offering, and then
   neither action exists — there is nothing to open or to share.

   „Rückblick" renders a FRESH recap into the sheet rather than moving the box:
   the box is the desktop column and stays where it is, hidden on a phone by
   programmheft.css, so the sheet and the box can never fight over one node.
   „Teilen" presses the box's own share button, so the head and the box share
   one model and one delivery path — and it is not rendered where that button
   is not (a browser that can neither share nor download a file). */
function programmheftChronikActions(round, activities, periodSec) {
  if (!periodSec) return { recap: null, share: null };
  // P13.2 sets „Rückblick" beside the page title, P13.1 sets „Teilen" at the
  // end of the filter row — two places, so two elements, each placed by the
  // caller where the sheet draws it (DOM order = visual order).
  const recap = h(`<button type="button" class="btn btn--ghost btn--sm ph-chronik-recap">${iconText('ti-history', t('recap.title'))}</button>`);
  recap.addEventListener('click', () => openProgrammheftRecapSheet(round, activities));
  const boxShare = periodSec.querySelector('.precap__share');
  let share = null;
  if (boxShare) {
    share = h(`<button type="button" class="btn btn--ghost btn--sm ph-chronik-share">${iconText('ti-share', t('share.button'))}</button>`);
    share.addEventListener('click', () => boxShare.click());
  }
  return { recap, share };
}

function openProgrammheftRecapSheet(round, activities) {
  const label = t('recap.title');
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet ph-recap-sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
        <div class="sheet__head">
          <h2>${esc(label)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const recap = renderPeriodRecapSection(round, activities);
  if (recap) sheet.appendChild(recap);
  document.body.appendChild(backdrop);
  const dismiss = () => closeSheet();
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  sheet.querySelector('.sheet__close').addEventListener('click', dismiss);
}

/* „Letzte Siege" (P13.5/P13.6): the member's most recent wins, newest first —
   date, the game played, and the session's score (the Chronik's own pill
   value, gameStatsForSession). Over FINISHED sessions only,
   the same predicate memberStats counts `wins` with, so the list can never show
   a win the figure above it does not count. Each row links to its session.

   Null with no win at all: the „Siege 0" figure already says so, and an empty
   panel under it would say it twice. */
const PH_RECENT_WINS = 4;

function programmheftRecentWins(round, mid) {
  const wins = newestSessionsFirst(round.sessions
    .filter((s) => s.finished && (s.winnerIds || []).includes(mid)))
    .slice(0, PH_RECENT_WINS);
  if (!wins.length) return null;
  const panel = h(`<div class="ph-wins">
       <h2 class="ph-wins__title">${esc(t('member.recentWins'))}</h2>
       <ul class="ph-wins__list"></ul>
     </div>`);
  const list = panel.querySelector('.ph-wins__list');
  wins.forEach((s) => {
    const game = s.chosenGameId && round.games.find((g) => g.id === s.chosenGameId);
    const score = game ? gameStatsForSession(round, s, game.id).score : null;
    const li = h(`<li><a class="ph-wins__row">
         <span class="ph-wins__date">${esc(fmtDate(s.createdAt))}</span>
         <span class="ph-wins__game">${esc(game ? game.title : t('sessions.played'))}</span>
         ${score === null ? '' : `<span class="ph-wins__score">${esc(fmtAvg(displayScore(score)))}</span>`}
       </a></li>`);
    navLink(li.querySelector('a'), resultsPath(round.id, s.id), () => showResults(round, s));
    list.appendChild(li);
  });
  return panel;
}
