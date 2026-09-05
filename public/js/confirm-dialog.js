/* Spielwirbel – the themed confirmation dialog (issue #939).

   Replaces the browser's own `confirm()` at every destructive or otherwise
   weighty moment in the app. A native dialog is OS chrome: system font, system
   buttons, a generic "OK" that says nothing about what is about to happen, and
   no way to reach the round's design tokens — so the one screen a round themes
   hardest hands the user over to the operating system at exactly the moment
   that carries the most weight. This sheet inherits `--surface`/`--ink` like
   every other overlay, names the real verb on its button, and can mark the
   destructive path with `.btn--danger`.

   Its own small, dependency-free file for the reason focus-trap.js and
   page-lock.js are ones (.claude/rules/frontend-helper-modules-and-coverage.md).
   Part of the frontend's shared global scope; load order: see index.html.

   Cross-file references (openSheet/closeSheet from views-round-detail.js) are
   resolved at CALL time, inside confirmDialog's body — never at load time — so
   this file is safe to load before them
   (.claude/rules/frontend-script-load-order.md).

   ## Sheet-over-sheet is REPLACE, and that is the app's own semantics

   `openSheet` tears down an already-open sheet rather than stacking on it (see
   its comment in views-round-detail.js: one history marker, one focus trap, one
   page lock). So a confirmation raised from inside an open sheet closes it. One
   call site does that — the „Spiele verschieben" sheet — and it re-opens itself
   when the user declines; see views-round-actions.js. Everything else is raised
   from a screen, where there is nothing to replace.

   ## What is deliberately NOT converted

   `vote.leaveConfirm` (views-session.js) stays native. It is read by
   `confirmLeave()` (router.js), a SYNCHRONOUS boolean guard that a popstate
   handler answers with while the pop is already in flight — and this dialog
   arbitrates the very history stack that guard is arbitrating. See §4 of #939. */

'use strict';

/* Ask the user to confirm an action. Resolves true only when they press the
   confirm button; every dismissal path — the × button, the backdrop, Escape and
   browser Back — resolves false, so a call site reads exactly like the
   `if (!confirm(msg)) return;` it replaces:

     if (!await confirmDialog({ body: t('round.deleteConfirm', { name }) })) return;

   @param {object}  o
   @param {string}  o.body          the question, as plain text (the old confirm message)
   @param {string} [o.title]        dialog heading; defaults to a neutral one
   @param {string} [o.confirmLabel] the real verb; defaults to a neutral "confirm"
   @param {boolean}[o.danger=true]  style the confirm button as destructive
   @param {string} [o.icon]         Tabler class for the confirm button
   @returns {Promise<boolean>}
*/
function confirmDialog(o) {
  const opts = o || {};
  const danger = opts.danger !== false;
  const title = opts.title || t('common.confirmTitle');
  const label = opts.confirmLabel || t('common.confirm');
  const icon = opts.icon || (danger ? 'ti-alert-triangle' : 'ti-check');

  return new Promise((resolve) => {
    // `null` until one of the two buttons speaks for the user. Every other exit
    // leaves it null, which is what makes "dismissed" mean "no" — including the
    // Back path, which never runs a closeSheet callback at all.
    let outcome = null;
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
        <div class="sheet sheet--dialog" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="sheet__head">
            <h2>${esc(title)}</h2>
            <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
          </div>
          <p class="confirm-dialog__body">${esc(opts.body || '')}</p>
          <div class="toolbar sheet__actions sheet__actions--confirm">
            <button class="btn" type="button" data-act="cancel">${esc(t('common.cancel'))}</button>
            <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-act="ok"><i class="ti ${esc(icon)}" aria-hidden="true"></i> ${esc(label)}</button>
          </div>
        </div>
      </div>`);
    const sheet = backdrop.querySelector('.sheet');
    document.body.appendChild(backdrop);

    const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
    document.addEventListener('keydown', onKey, true);
    // The onClose hook covers every path that does NOT run a closeSheet
    // callback — browser Back, and one sheet being replaced by another.
    openSheet(backdrop, onKey, () => { if (outcome === null) finish(false); });
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
    sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

    // Resolve through closeSheet's callback, never on the line after it: the
    // close queues a history pop, and a caller that opened its own sheet in
    // response would be dismissed by that pop a moment later (the reasoning
    // views-archive.js's option list already follows).
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      outcome = false;
      closeSheet(() => finish(false));
    });
    sheet.querySelector('[data-act="ok"]').addEventListener('click', () => {
      outcome = true;
      closeSheet(() => finish(true));
    });

    // Focus the CANCEL button, not the destructive one — a stray Enter on a
    // dialog that appeared under the user's hands must not delete a round.
    // After openSheet, so trapFocus captures the opener as its restore target.
    sheet.querySelector('[data-act="cancel"]').focus();
  });
}
