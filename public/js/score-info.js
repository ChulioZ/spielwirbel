/* Spielwirbel – the ⓘ that explains the Spielwirbel-Score (#893).

   The score replaces a number every user had already learned to read, so it
   owes an explanation somewhere. Two surfaces carry it, and they do different
   jobs — keep both:

   - `scoreReason()` (core.js) is the PRIMARY one: „2,2 · 1× gar nicht", printed
     beside the number itself. It explains THIS game at the moment the group is
     deciding, which is the only moment the explanation is worth anything.
   - this sheet explains the PRINCIPLE, once, for whoever goes looking.

   It states no formula and prints none of the six tile values. Those are
   explicitly tunable, so a sheet quoting them would be wrong the first time
   anybody retunes the curve — and a group does not need the arithmetic to
   understand „wer gar nicht will, zählt schwerer".

   Placed ONCE PER SCREEN beside the primary occurrence (the game detail line,
   the results heading, the Regal sort control), never on every pill: a dozen
   ⓘ buttons down a shelf is noise, and they would all say the same thing.

   Load order: see index.html — after core.js, which owns `openSheet`/`h`/`t`. */

'use strict';

// The ⓘ trigger, as an HTML string so it can be interpolated into a template
// the caller is already building. `wireScoreInfo` binds whatever landed in the
// DOM — one call after the markup is inserted, however many buttons it holds.
function scoreInfoButton() {
  return `<button type="button" class="score-info" data-score-info aria-label="${esc(t('score.infoOpen'))}"><i class="ti ti-info-circle" aria-hidden="true"></i></button>`;
}

// Bind every unbound ⓘ inside `root`. Idempotent via the dataset flag, so a
// view that re-renders a fragment cannot stack a second listener on a button it
// already wired.
function wireScoreInfo(root) {
  (root || document).querySelectorAll('[data-score-info]').forEach((b) => {
    if (b.dataset.scoreInfoBound) return;
    b.dataset.scoreInfoBound = '1';
    b.addEventListener('click', (e) => {
      // The Regal's control sits inside a label and the detail's inside a link
      // row; without this the click would also toggle whatever wraps it.
      e.preventDefault();
      e.stopPropagation();
      openScoreInfoSheet();
    });
  });
}

// Goes through openSheet for the focus trap, page lock and Back-dismissal
// (#145/#333/#622) — never assign activeSheet directly.
function openScoreInfoSheet() {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('score.infoTitle'))}">
        <div class="sheet__head">
          <h2>${esc(t('score.infoTitle'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="score-info__body">
          <p>${esc(t('score.infoBody'))}</p>
          <p class="muted">${esc(t('score.infoRaw'))}</p>
        </div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  backdrop.querySelector('.sheet__close').addEventListener('click', () => closeSheet());
}
