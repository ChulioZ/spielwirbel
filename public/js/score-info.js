/* Spielwirbel – the ⓘ sheets that explain a derived number (#893, #895).

   TWO SHEETS, ONE MECHANISM. It opened as the Spielwirbel-Score's explainer and
   #895 added the Siegwertung's, which wants the identical „button → openSheet"
   shape — so the topic became a parameter rather than a near-identical second
   module (.claude/rules/shared-constants-across-the-stack.md's reasoning, one
   level up: a copy of this file would drift in its focus trap and its Escape
   path, not in a constant). The file and the `.score-info` CSS class keep their
   original names: the class is the shared style hook for the dot and is pinned
   by name in test/score-results-view.test.js, so renaming only the module would
   make the naming less consistent, not more.

   Everything below is about the Spielwirbel-Score specifically; the Siegwertung
   entry follows the same rules — principle, no formula, one per screen.

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
   the top result row's label, the Regal sort control), never on every pill: a
   dozen ⓘ buttons down a shelf is noise, and they would all say the same thing.

   On the results screen that occurrence was the page HEAD until #902, hanging
   off „4 Spiele · 3. September" where it read as an annotation on the date and
   went unnoticed; it now rides the first row that has a score to explain. A
   session nobody voted in therefore carries no ⓘ at all — the same rule, not an
   omission: there is no number on screen to explain.

   Load order: see index.html — after core.js, which owns `openSheet`/`h`/`t`. */

'use strict';

// The sheets, keyed by topic. `body` is one or more i18n keys; every paragraph
// after the first renders muted, which is the shape the score sheet already had
// (principle first, the caveat under it). Keeping the key wiring in a table
// rather than in each caller is what stops a third sheet from inventing a
// fourth naming convention for the same three strings.
const INFO_SHEETS = {
  score: { title: 'score.infoTitle', open: 'score.infoOpen', body: ['score.infoBody', 'score.infoRaw'] },
  win: { title: 'win.infoTitle', open: 'win.infoOpen', body: ['win.infoBody'] },
};

// The ⓘ trigger, as an HTML string so it can be interpolated into a template
// the caller is already building. `wireInfoButtons` binds whatever landed in the
// DOM — one call after the markup is inserted, however many buttons it holds.
function infoButton(topic) {
  return `<button type="button" class="score-info" data-info-topic="${esc(topic)}" aria-label="${esc(t(INFO_SHEETS[topic].open))}"><i class="ti ti-info-circle" aria-hidden="true"></i></button>`;
}

// Bind every unbound ⓘ inside `root`. Idempotent via the dataset flag, so a
// view that re-renders a fragment cannot stack a second listener on a button it
// already wired.
function wireInfoButtons(root) {
  (root || document).querySelectorAll('[data-info-topic]').forEach((b) => {
    if (b.dataset.scoreInfoBound) return;
    b.dataset.scoreInfoBound = '1';
    b.addEventListener('click', (e) => {
      // The Regal's control sits inside a label and the detail's inside a link
      // row; without this the click would also toggle whatever wraps it.
      e.preventDefault();
      e.stopPropagation();
      openInfoSheet(b.dataset.infoTopic);
    });
  });
}

// Goes through openSheet for the focus trap, page lock and Back-dismissal
// (#145/#333/#622) — never assign activeSheet directly.
function openInfoSheet(topic) {
  const sheet = INFO_SHEETS[topic];
  const paragraphs = sheet.body
    .map((key, i) => `<p${i ? ' class="muted"' : ''}>${esc(t(key))}</p>`)
    .join('');
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t(sheet.title))}">
        <div class="sheet__head">
          <h2>${esc(t(sheet.title))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="score-info__body">
          ${paragraphs}
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
