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

   Cross-file references (openSheet/closeSheet from sheet.js) are
   resolved at CALL time, inside confirmDialog's body — never at load time — so
   this file is safe to load before them
   (.claude/rules/frontend-script-load-order.md).

   ## Sheet-over-sheet is REPLACE, and that is the app's own semantics

   `openSheet` tears down an already-open sheet rather than stacking on it (see
   its comment in sheet.js: one history marker, one focus trap, one
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

/* The dialog's anatomy (#1195, T15b): the TITLE is the question, the text under
   it the consequence, the button the verb. Every caller already writes its
   message in that order — „„Azul“ aussortieren? Weg aus Regal und Auslosung —
   jederzeit zurückholen." — so the split needs no new copy: the question is the
   text up to its first sentence-ending question mark, and the rest is what
   follows from it. Before this the heading was the neutral „Bitte bestätigen"
   on every dialog, which told the reader nothing the button did not.

   Three guards, each against a message that exists or plausibly will:
     - the mark must END a sentence — followed by whitespace or the end — so
       nothing is split mid-token;
     - it must sit OUTSIDE quotation marks, because the question usually names
       a game, and a title like „Wer war's? Das Spiel" must not be cut in two.
       Tracked as a stack over the pairs the nine locales use („“ “” «» ‹› 「」
       and the ASCII ones); German's closing “ is English's opening one, which
       is why the open quote's closer is tested before any opener is;
     - no mark at all (a locale phrasing it as a statement) returns null, and
       the caller keeps the neutral heading with the whole message as the text.

   A message whose question comes LAST („Es fehlen noch 3 Stimmen. Trotzdem
   beenden?") becomes a two-sentence heading. Accepted rather than cut at the
   preceding full stop: dates in these messages carry full stops too („vom
   19.09.") and a sentence splitter that misreads one would put half a date in
   the heading. Pure — no DOM — so a spec can call it directly. */
function splitConfirmQuestion(text) {
  const s = String(text || '');
  const closes = { '„': '“”', '«': '»', '‹': '›', '「': '」', '“': '”', '"': '"', '\'': '\'' };
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const top = stack[stack.length - 1];
    if (top && closes[top].includes(c)) { stack.pop(); continue; }
    // An apostrophe inside a word („war's") is not a quotation mark, so an
    // ASCII ' only OPENS after whitespace or at the start of the message.
    if (c === '\'' && i > 0 && !/\s/.test(s[i - 1])) continue;
    if (closes[c]) { stack.push(c); continue; }
    if ((c === '?' || c === '？') && !stack.length && (i === s.length - 1 || /\s/.test(s[i + 1]))) {
      return { question: s.slice(0, i + 1).trim(), rest: s.slice(i + 1).trim() };
    }
  }
  return null;
}

/* Ask the user to confirm an action. Resolves true only when they press the
   confirm button; every dismissal path — the × button, the backdrop, Escape and
   browser Back — resolves false, so a call site reads exactly like the
   `if (!confirm(msg)) return;` it replaces:

     if (!await confirmDialog({ body: t('round.deleteConfirm', { name }) })) return;

   @param {object}  o
   @param {string}  o.body          the question, as plain text (the old confirm message);
                                    its question sentence becomes the heading
   @param {string} [o.title]        dialog heading; overrides that split
   @param {string} [o.confirmLabel] the real verb; defaults to a neutral "confirm"
   @param {boolean}[o.danger=true]  style the confirm button as destructive
   @param {string} [o.icon]         Tabler class for the confirm button
   @returns {Promise<boolean>}
*/
function confirmDialog(o) {
  const opts = o || {};
  const danger = opts.danger !== false;
  // An explicit title wins and leaves the body whole; otherwise the question
  // is lifted out of the body into the heading (splitConfirmQuestion, above).
  const split = opts.title ? null : splitConfirmQuestion(opts.body);
  const title = opts.title || (split ? split.question : t('common.confirmTitle'));
  const bodyText = split ? split.rest : (opts.body || '');
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
          <p class="confirm-dialog__body">${esc(bodyText)}</p>
          <div class="confirm-dialog__opts"></div>
          <div class="toolbar sheet__actions sheet__actions--confirm">
            <button class="btn" type="button" data-act="cancel">${esc(t('common.cancel'))}</button>
            <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-act="ok"><i class="ti ${esc(icon)}" aria-hidden="true"></i> ${esc(label)}</button>
          </div>
        </div>
      </div>`);
    const sheet = backdrop.querySelector('.sheet');
    /* Optional follow-up questions (#1006), each a checkbox the caller reads
       back. They exist because the one destructive act can have consequences
       only the caller knows about — retiring a member orphans the games they
       alone own, and leaves their seat linked to an account that can then never
       claim another one here — and asking about those in a second dialog after
       the first has been confirmed is how a user ends up answering a question
       about a change they have already made.

       The RETURN TYPE is conditional, deliberately: with no options this still
       resolves to a plain boolean, so none of the ~20 existing callers change.
       With options it resolves to `{ ok, picked }`. */
    const optWrap = sheet.querySelector('.confirm-dialog__opts');
    const options = Array.isArray(opts.options) ? opts.options : [];
    options.forEach((o) => {
      const row = h(`<label class="confirm-dialog__opt">
           <input type="checkbox"${o.checked ? ' checked' : ''} />
           <span>${esc(o.label)}</span>
         </label>`);
      row.dataset.id = o.id;
      optWrap.appendChild(row);
    });
    const picked = () => Object.fromEntries(
      [...optWrap.querySelectorAll('.confirm-dialog__opt')]
        .map((row) => [row.dataset.id, row.querySelector('input').checked]));
    const answer = (ok) => (options.length ? { ok, picked: ok ? picked() : {} } : ok);
    document.body.appendChild(backdrop);

    const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
    document.addEventListener('keydown', onKey, true);
    // The onClose hook covers every path that does NOT run a closeSheet
    // callback — browser Back, and one sheet being replaced by another.
    openSheet(backdrop, onKey, () => { if (outcome === null) finish(answer(false)); });
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
    sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

    // Resolve through closeSheet's callback, never on the line after it: the
    // close queues a history pop, and a caller that opened its own sheet in
    // response would be dismissed by that pop a moment later (the reasoning
    // views-archive.js's option list already follows).
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      outcome = false;
      closeSheet(() => finish(answer(false)));
    });
    sheet.querySelector('[data-act="ok"]').addEventListener('click', () => {
      outcome = true;
      // Read BEFORE closeSheet: the close tears the backdrop out of the
      // document, and an unchecked read afterwards answers about a detached
      // tree that no longer holds the user's choices.
      const a = answer(true);
      closeSheet(() => finish(a));
    });

    // Focus the CANCEL button, not the destructive one — a stray Enter on a
    // dialog that appeared under the user's hands must not delete a round.
    // After openSheet, so trapFocus captures the opener as its restore target.
    sheet.querySelector('[data-act="cancel"]').focus();
  });
}
