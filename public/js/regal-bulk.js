/* Spielwirbel – the Regal's SELECTION MODE and its four bulk actions (#832,
   #972, #1000). Split out of views-regal.js by #1000, which took that file past
   the 700-line budget (.claude/rules/token-friendly-source-files.md).

   The seam is real rather than a line-count cut: everything here is about a SET
   of picked games — entering the mode, painting the picks, and the four things
   that can be done to them — while what remains in views-regal.js is the grid,
   its filters and its sort. Neither half is edited for the other's reason.

   WHY IT TAKES A CONTEXT OBJECT, and why two of its entries are thunks: this
   was a closure over eight of `renderRegalTab`'s locals, two of them assigned
   after the block ran (`cardById`, `renderGames`). A plain value would capture
   `undefined`; a getter reads them at CALL time, which is the only moment they
   are needed. That is the whole reason this could not be a file move.

     grid      the cards container — the delegated pick listener lives on it
     gamesSec  the section that carries the `is-selecting` class
     cards()   the id -> card map, read when the mode is entered
     refresh() the grid's own re-render

   NO `module.exports`: this is DOM code, and requiring it into Node would put
   an unreachable file in the coverage report and redden `coverage:ci` with
   every test green (.claude/rules/frontend-helper-modules-and-coverage.md). It
   is tested through the jsdom harness, like the views it came from.

   Frontend shared-scope script; load order: see index.html. */

'use strict';

/* The scaffolding both picker sheets need — the backdrop, the head, the focus
   trap, the four dismissal paths and the OK/Cancel row. It was written twice
   (owners #972, tags #1000) before this split, which is the duplication the
   extraction pays for.

   `build(body, ok)` fills the sheet and may enable the OK button as the picks
   change; `onOk` runs AFTER the sheet has closed, through `closeSheet`'s
   callback rather than on the line after it — the close queues a history pop
   that would otherwise dismiss the confirm dialog the action opens a moment
   later (.claude/rules/sheet-history-back-dismissal.md). */
function openBulkPicker({ title, hint, okDisabled = false }, build, onOk) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p class="muted bulk-owners__hint">${esc(hint)}</p>
        <div class="toolbar sheet__actions"></div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const okBtn = h(`<button type="button" class="btn btn--primary"${okDisabled ? ' disabled' : ''}>${esc(t('common.ok'))}</button>`);
  const result = build(sheet, okBtn);

  document.body.appendChild(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  // Through openSheet for the focus trap (#145) and Back-dismissal (#333) —
  // never by assigning activeSheet directly.
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  okBtn.addEventListener('click', () => closeSheet(() => onOk(result)));
  const cancelBtn = h(`<button type="button" class="btn">${esc(t('common.cancel'))}</button>`);
  cancelBtn.addEventListener('click', () => closeSheet());
  const actions = sheet.querySelector('.sheet__actions');
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
}

// Build the selection mode for one render of the Regal. Returns the bar, the
// toolbar button, and the three hooks the grid's own renderer calls.
function createRegalBulk(ctx) {
  const { round, rid, grid, gamesSec } = ctx;
  // --- Selection mode (#832): tidy the shelf in bulk.
  //
  // It lives IN the grid rather than in a picker sheet on purpose. A shelf can
  // be filled in one action (the BGG collection import, #481) but was emptied
  // one game and two steps at a time, so undoing a 200-game import ran to some
  // 400 interactions — which is what a tester hit mid-evaluation. A flat sheet
  // of 200 checkbox rows would be a bulk path with no way to aim it; here the
  // search, the tag chips, the metadata filters and the sort all keep working,
  // so "select all" means "everything I have narrowed to".
  //
  // The selection deliberately SURVIVES a filter change: picking a few games,
  // searching again and picking a few more is the normal way to use it. The
  // count is always on screen, so a selection reaching beyond what is currently
  // shown is stated rather than hidden.
  let selecting = false;
  let shownCards = [];
  const selection = new Set();
  const canBulkDelete = roundCan(round, 'game.delete');
  // A round with no seats has nobody to name as an owner, so the picker could
  // only ever clear. Hidden rather than disabled, the same call renderOwnerChips
  // makes for its own empty row (#971).
  const canSetOwners = (round.members || []).length > 0;
  // A round with no tags has nothing to offer, so the picker could only ever
  // be empty. Hidden rather than disabled, the same call `canSetOwners` makes
  // for a seatless round — and creating a tag inline is deliberately out of
  // scope here: that is the Tags screen's job, and it carries the per-round
  // quota check this route does not.
  const canSetTags = (round.tags || []).length > 0;

  const bulkBar = h(`<div class="bulk-bar" hidden>
       <div class="bulk-bar__info">
         <span class="bulk-bar__count" aria-live="polite"></span>
         <span class="muted bulk-bar__hint">${esc(t('bulk.hint'))}</span>
       </div>
       <div class="bulk-bar__actions">
         <button type="button" class="link-btn" data-act="all"></button>
         ${canSetOwners ? `<button type="button" class="btn" data-act="owners"><i class="ti ti-users" aria-hidden="true"></i> ${esc(t('bulk.owners'))}</button>` : ''}
         ${canSetTags ? `<button type="button" class="btn" data-act="tags"><i class="ti ti-tags" aria-hidden="true"></i> ${esc(t('bulk.tags'))}</button>` : ''}
         <button type="button" class="btn" data-act="retire"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('bulk.retire'))}</button>
         ${canBulkDelete ? `<button type="button" class="btn btn--danger" data-act="delete"><i class="ti ti-trash-x" aria-hidden="true"></i> ${esc(t('bulk.delete'))}</button>` : ''}
       </div>
     </div>`);
  const bulkCount = bulkBar.querySelector('.bulk-bar__count');
  const bulkAll = bulkBar.querySelector('[data-act="all"]');

  // The one place the card's selected state is written, so the class, the
  // ARIA state and the enabled actions can never disagree.
  function syncSelection() {
    shownCards.forEach((c) => {
      const on = selection.has(c.dataset.gid);
      c.classList.toggle('is-picked', on);
      if (selecting) c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const n = selection.size;
    bulkCount.textContent = tn(n, 'bulk.selectedOne', 'bulk.selected');
    // „Alle auswählen" until everything currently SHOWN is on, then „Auswahl
    // aufheben" — showTransferGames' semantics, not the tag chips' (#723). The two
    // differ deliberately; see the comment on tag-chips.js's bulk toggle.
    const allShown = shownCards.length > 0 && shownCards.every((c) => selection.has(c.dataset.gid));
    bulkAll.textContent = allShown ? t('bulk.selectNone') : t('bulk.selectAll');
    bulkBar.querySelectorAll('[data-act="owners"], [data-act="tags"], [data-act="retire"], [data-act="delete"]')
      .forEach((b) => { b.disabled = n === 0; });
  }

  // A card is a link to the game's detail page; in selection mode it becomes a
  // toggle instead. Swapping the role and dropping the href is what keeps that
  // honest for assistive tech — a nested checkbox would be an interactive
  // control inside an <a>, the shape the archive rows avoid too.
  function paintCardMode(card) {
    if (selecting) {
      card.dataset.href = card.getAttribute('href') || '';
      card.removeAttribute('href');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-pressed', 'false');
    } else {
      if (card.dataset.href) card.setAttribute('href', card.dataset.href);
      card.removeAttribute('role');
      card.removeAttribute('tabindex');
      card.removeAttribute('aria-pressed');
      card.classList.remove('is-picked');
    }
  }

  function setSelecting(on) {
    selecting = on;
    if (!on) selection.clear();
    gamesSec.classList.toggle('is-selecting', on);
    bulkBar.hidden = !on;
    button.classList.toggle('is-active', on);
    button.querySelector('.tools-label').textContent = on ? t('bulk.done') : t('bulk.select');
    Object.values(ctx.cards()).forEach(paintCardMode);
    ctx.refresh();
  }

  // Capture phase, on the grid: the card's own navLink handler is attached to
  // the card itself, so stopping propagation here is what keeps a pick from
  // navigating away. Delegated rather than per-card, so it costs one listener
  // whatever the shelf holds.
  const toggleFrom = (e) => {
    if (!selecting) return false;
    const card = e.target.closest && e.target.closest('.game-card');
    if (!card || !grid.contains(card)) return false;
    e.preventDefault();
    e.stopPropagation();
    const gid = card.dataset.gid;
    if (selection.has(gid)) selection.delete(gid); else selection.add(gid);
    syncSelection();
    return true;
  };
  grid.addEventListener('click', toggleFrom, true);
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    toggleFrom(e);
  }, true);

  bulkAll.addEventListener('click', () => {
    const allShown = shownCards.length > 0 && shownCards.every((c) => selection.has(c.dataset.gid));
    shownCards.forEach((c) => {
      if (allShown) selection.delete(c.dataset.gid); else selection.add(c.dataset.gid);
    });
    syncSelection();
  });

  // Both actions send the explicit id list the user just confirmed a count
  // for — never an "everything" shortcut, which could pick up a game added
  // from another device since the mode was entered (showTransferGames' reasoning).
  async function runBulk(act) {
    const ids = [...selection];
    if (!ids.length) return;
    const msg = act === 'retire'
      ? tn(ids.length, 'bulk.confirmRetireOne', 'bulk.confirmRetire')
      : selectionTouchesHistory(round, selection)
        ? tn(ids.length, 'bulk.confirmDeleteOne', 'bulk.confirmDelete')
        : tn(ids.length, 'bulk.confirmDeletePlainOne', 'bulk.confirmDeletePlain');
    if (!await confirmDialog({
      body: msg,
      confirmLabel: t(act === 'retire' ? 'bulk.retire' : 'bulk.delete'), icon: 'ti-trash',
    })) return;
    const buttons = [...bulkBar.querySelectorAll('button')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await api('POST', `/api/rounds/${rid}/games/bulk-${act}`, { gameIds: ids });
      const n = act === 'retire' ? res.retired : res.deleted;
      toast(act === 'retire'
        ? tn(n, 'bulk.retiredOne', 'bulk.retired')
        : tn(n, 'bulk.deletedOne', 'bulk.deleted'));
      // Await the fresh round before re-rendering: after a destructive bulk
      // action the stale-then-revalidate render would show the deleted games
      // one more time, which reads as the action having failed.
      await fetchRoundFresh(rid);
      showRound(rid, 'regal');
    } catch (e) {
      buttons.forEach((b) => { b.disabled = false; });
      syncSelection();
      toast(e.message);
    }
  }
  /* Set who owns the selected boxes (#972). The third bulk action, and the only
     one that is not destructive — so it leads with a PICKER instead of a
     confirm: there is nothing to warn about until the user has said who.

     The chosen set REPLACES each game's owners rather than adding to them,
     like the other two actions and unlike a merge. That makes an empty pick
     the clear, which is why the confirm below has a second wording rather than
     an empty name list — "set the owners of 12 games to ''" is not a sentence.

     The picker starts EMPTY on purpose: the selection can hold games with
     different owners, so there is no honest pre-state to show, and pretending
     one (the seat's `ownerPreset`, say) would make an accidental OK silently
     rewrite a shelf. */
  function openOwnersSheet() {
    if (!selection.size) return;
    const selected = new Set();
    openBulkPicker(
      { title: t('bulk.owners'), hint: tn(selection.size, 'bulk.ownersHintOne', 'bulk.ownersHint') },
      (sheet) => {
        sheet.querySelector('.bulk-owners__hint').after(renderOwnerChips(round, selected));
        return selected;
      },
      (picked) => runOwners([...picked])
    );
  }

  async function runOwners(ownerIds) {
    const ids = [...selection];
    if (!ids.length) return;
    // Clearing is the half worth a warning, so only it is styled destructive.
    const clearing = ownerIds.length === 0;
    const msg = clearing
      ? tn(ids.length, 'bulk.confirmOwnersClearOne', 'bulk.confirmOwnersClear')
      : tn(ids.length, 'bulk.confirmOwnersOne', 'bulk.confirmOwners', { names: ownerNames(round, ownerIds).join(', ') });
    if (!await confirmDialog({
      // The verb has to match the deed: a btn--danger reading „Besitzer setzen"
      // on a dialog asking whether to REMOVE them is the one moment the user
      // most needs the button to say what it does.
      body: msg, icon: 'ti-users', danger: clearing,
      confirmLabel: t(clearing ? 'bulk.ownersClear' : 'bulk.owners'),
    })) return;
    const buttons = [...bulkBar.querySelectorAll('button')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await api('POST', `/api/rounds/${rid}/games/bulk-owners`, { gameIds: ids, ownerIds });
      toast(tn(res.updated, 'bulk.ownersSetOne', 'bulk.ownersSet'));
      await fetchRoundFresh(rid);
      showRound(rid, 'regal');
    } catch (e) {
      buttons.forEach((b) => { b.disabled = false; });
      syncSelection();
      toast(e.message);
    }
  }
  /* Add and remove tags across the selection (#1000) — the fourth bulk action,
     and like the owners one it leads with a PICKER rather than a confirm:
     there is nothing to warn about until the user has said which tags.

     IT DOES NOT REPLACE, and that is the decision that separates it from the
     owners sheet twenty lines above. A 50-game selection carries 50 different
     tag sets, so „Se reemplazan las entradas actuales" here would silently
     strip every tag those games already had — on the action whose whole point
     is organising a freshly imported shelf. Each chip is TRI-STATE: add,
     remove, or leave alone, with `leave alone` the default for every tag.

     That also removes the owners sheet's reason for starting empty: there is
     no pre-state to misrepresent, because „untouched" is a real third answer
     rather than a stand-in for „mixed". */
  function openTagsSheet() {
    if (!selection.size) return;
    // Map<tagId, 'add' | 'remove'>; a tag absent from it is left alone.
    const picks = new Map();
    openBulkPicker(
      { title: t('bulk.tags'), hint: tn(selection.size, 'bulk.tagsHintOne', 'bulk.tagsHint'), okDisabled: true },
      (sheet, okBtn) => {
        const chipRow = h(`<div class="filter-chips bulk-tags__chips" role="group" aria-label="${esc(t('bulk.tags'))}"></div>`);
        sheet.querySelector('.bulk-owners__hint').after(chipRow);
        /* Its OWN three labels rather than paintTagChip's: those say "only games
           with it" / "games with it are hidden", which describe a FILTER. Here
           the same three visual states mean an edit, and a chip that looks
           identical while meaning something else is exactly the confusion worth
           one more key per state. */
        (round.tags || []).forEach((tg) => {
          const chip = h('<button type="button" class="chip"></button>');
          const paint = () => {
            const st = picks.get(tg.id);
            chip.classList.toggle('is-on', st === 'add');
            chip.classList.toggle('is-excluded', st === 'remove');
            chip.setAttribute('aria-label', t(
              st === 'add' ? 'bulk.tagAdd' : st === 'remove' ? 'bulk.tagRemove' : 'bulk.tagLeave',
              { name: tg.name }));
            const icon = st === 'remove' ? 'ti-ban' : tagIconClass(tg.icon);
            chip.innerHTML = `<i class="ti ${icon}" aria-hidden="true"></i>${esc(tg.name)}`;
          };
          chip.addEventListener('click', () => {
            const st = picks.get(tg.id);
            if (!st) picks.set(tg.id, 'add');
            else if (st === 'add') picks.set(tg.id, 'remove');
            else picks.delete(tg.id);
            paint();
            // Nothing picked is not a no-op to confirm — it is an unfinished
            // sentence, so the action stays unavailable rather than reporting a
            // successful zero.
            okBtn.disabled = picks.size === 0;
          });
          paint();
          chipRow.appendChild(chip);
        });
        return picks;
      },
      (picked) => {
        const listOf = (want) => [...picked].filter(([, st]) => st === want).map(([id]) => id);
        runTags(listOf('add'), listOf('remove'));
      }
    );
  }

  async function runTags(addTagIds, removeTagIds) {
    const ids = [...selection];
    if (!ids.length || !(addTagIds.length + removeTagIds.length)) return;
    const nameOf = (id) => ((round.tags || []).find((tg) => tg.id === id) || {}).name || id;
    // The confirm states the COUNT and the DIRECTION, both of which the user
    // can otherwise only infer from chip colours they set a moment ago. Three
    // wordings rather than one with empty halves: „remove: " followed by
    // nothing is not a sentence.
    const added = addTagIds.map(nameOf).join(', ');
    const removed = removeTagIds.map(nameOf).join(', ');
    const key = addTagIds.length && removeTagIds.length ? 'bulk.confirmTagsBoth'
      : addTagIds.length ? 'bulk.confirmTagsAdd' : 'bulk.confirmTagsRemove';
    if (!await confirmDialog({
      body: tn(ids.length, `${key}One`, key, { added, removed }),
      icon: 'ti-tags', confirmLabel: t('bulk.tags'),
    })) return;
    const buttons = [...bulkBar.querySelectorAll('button')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await api('POST', `/api/rounds/${rid}/games/bulk-tags`,
        { gameIds: ids, addTagIds, removeTagIds });
      // `updated` counts games that actually CHANGED, so re-adding a tag the
      // selection already carries says „0 Spiele" rather than lying about 50.
      toast(tn(res.updated, 'bulk.tagsSetOne', 'bulk.tagsSet'));
      await fetchRoundFresh(rid);
      showRound(rid, 'regal');
    } catch (e) {
      buttons.forEach((b) => { b.disabled = false; });
      syncSelection();
      toast(e.message);
    }
  }
  const bulkTagsBtn = bulkBar.querySelector('[data-act="tags"]');
  if (bulkTagsBtn) bulkTagsBtn.addEventListener('click', openTagsSheet);

  const bulkOwnersBtn = bulkBar.querySelector('[data-act="owners"]');
  if (bulkOwnersBtn) bulkOwnersBtn.addEventListener('click', openOwnersSheet);
  bulkBar.querySelector('[data-act="retire"]').addEventListener('click', () => runBulk('retire'));
  const bulkDelBtn = bulkBar.querySelector('[data-act="delete"]');
  if (bulkDelBtn) bulkDelBtn.addEventListener('click', () => runBulk('delete'));

  const button = h(`<button class="link-btn"><i class="ti ti-checkbox" aria-hidden="true"></i> <span class="tools-label">${esc(t('bulk.select'))}</span></button>`);
  button.addEventListener('click', () => setSelecting(!selecting));

  return {
    bar: bulkBar,
    button,
    /* What "select all" means, handed in on every render: the cards currently
       shown, i.e. everything the search, the chips, the filters and the sort
       have narrowed to. */
    setShown(cards) { shownCards = cards; },
    isSelecting() { return selecting; },
    sync: syncSelection,
  };
}
