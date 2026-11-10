/* Spielwirbel – the „Verliehen" editor on a game's Spielepass (#1775): who has
   the box — a seat of the round OR any typed name — and since when. Its own
   file rather than a sixth editor in game-editors.js, which sits at its line
   budget. Same context object as those editors ({ rid, round, game, refresh }).

   The borrower's name is free text about a third party: it goes into the DOM
   through `esc()`/`.value` only, never as markup, and is capped at the shared
   LOAN_TO_MAX the route validates against. Part of the frontend; all files
   share one global script scope. */

function openLoanEditor(ctx, anchor) {
  const { rid, round, game, refresh } = ctx;
  const loan = game.loan || null;
  openEditor(anchor, 'loan', t('loan.sheetTitle', { title: game.title }), (el, close) => {
    const seats = activeMembers(round);
    const who = h(`<select class="input" id="loanWho">
        <option value="">${esc(t('loan.whoNone'))}</option>
        ${seats.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
      </select>`);
    const name = h(`<input class="input" id="loanName" maxlength="${LOAN_TO_MAX}" autocomplete="off" autocorrect="off" spellcheck="false" />`);
    name.placeholder = t('loan.namePlaceholder');
    const since = h('<input class="input" id="loanSince" type="date" />');
    const today = loanToday();
    since.max = today;
    since.value = (loan && loan.since) || today;
    if (loan && loan.memberId && seats.some((m) => m.id === loan.memberId)) who.value = loan.memberId;
    else if (loan) name.value = loan.to;
    // One borrower at a time: picking a seat clears the typed name and the
    // other way round, so the request never carries both.
    who.addEventListener('change', () => { if (who.value) name.value = ''; });
    name.addEventListener('input', () => { if (name.value) who.value = ''; });

    const field = (id, label, control) => {
      const f = h(`<div class="field"><label for="${id}">${esc(label)}</label></div>`);
      f.appendChild(control);
      return f;
    };
    const okBtn = h(`<button type="button" class="btn btn--primary">${esc(t('loan.save'))}</button>`);
    const save = async () => {
      const typed = name.value.trim();
      if (!who.value && !typed) return toast(t('loan.needName'));
      const body = who.value ? { memberId: who.value } : { to: typed };
      if (isLoanDay(since.value)) body.since = since.value;
      try {
        const saved = await api('PUT', `/api/rounds/${rid}/games/${game.id}/loan`, body);
        close();
        toast(t('loan.toast.lent', { title: game.title, name: loanBorrowerName(round, saved.loan) }), { tone: 'success' });
        refresh();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    };
    okBtn.addEventListener('click', save);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    if (seats.length) el.appendChild(field('loanWho', t('loan.whoLabel'), who));
    el.append(field('loanName', t('loan.nameLabel'), name), field('loanSince', t('loan.sinceLabel'), since),
      editorActions(okBtn));
    return () => (seats.length ? who : name).focus();
  });
}

// „Zurück": the box is home again. A neutral confirm — it is undone by lending
// it again, so it is filed as undoable, not as a deletion.
async function returnLoan(ctx) {
  const { rid, round, game, refresh } = ctx;
  const name = loanBorrowerName(round, game.loan);
  if (!await confirmDialog({
    body: t('loan.returnConfirm', { title: game.title, name }),
    confirmLabel: t('loan.menuReturn'), icon: 'ti-arrow-back-up', danger: false,
  })) return;
  try {
    await api('DELETE', `/api/rounds/${rid}/games/${game.id}/loan`);
    toast(t('loan.toast.returned', { title: game.title }), { tone: 'success' });
    refresh();
  } catch (e) { toast(e.message, { tone: 'error' }); }
}

// The Spielepass chip text: „Verliehen an Kim seit 3.11.".
function loanChipText(round, loan) {
  return t('loan.chip', { name: loanBorrowerName(round, loan), date: fmtLoanDay(loan.since) });
}
