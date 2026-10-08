/* Spielwirbel – views: the results screen's session management — each row's
   „Spielen" and „…" menu, removing a game, cancelling and deleting the
   session, and the two footers (Klassisch's link row, the composed designs'
   foot). Split out of showResults (#1543).

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

/* Is this a direct-play session (#532) whose Tafel says nothing? Such a
   session is created with `votes: {}` and its game already chosen, so the
   section renders a heading naming a vote nobody was asked for over exactly
   one row restating the „Auf dem Tisch" band directly above it. #915 already
   stripped that row's vote-derived parts; this drops the rest (#1107).

   All three terms are load-bearing, and two of them guard states reachable
   TODAY rather than legacy data:
     !hasVotes          — session-level, per #915's reasoning.
     games.length === 1 — a lobby closed with zero votes and 2+ games is a
                          real state, and there the rows are the only list of
                          candidates the group has.
     chosenId           — draw ONE game, close the lobby with zero votes, and
                          nothing is chosen: the row's „Spielen" button is then
                          the only way onto the table. Without this term that
                          group lands on an empty screen.

   A FUNCTION, not a frozen flag: `chosenId` is mutable, so `resultUpdateChosen()`
   has to re-ask. The transition is one-way in practice, because the two
   clear-choice controls are dropped for this case (resultRenderAction,
   resultRenderBand). */
function resultIsSoloDirectPlay(rs) {
  return !rs.hasVotes && rs.games.length === 1 && !!rs.chosenId;
}

async function resultRemoveGame(rs, g) {
  const { round, session } = rs;
  if (!await confirmDialog({
    body: t('result.removeGameConfirm', { title: g.title }),
    confirmLabel: t('result.removeGame'), icon: 'ti-trash',
  })) return;
  try {
    await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}/games/${g.id}`);
    toast(t('result.toast.gameRemoved', { title: g.title }));
    const fresh = await fetchRoundFresh(round.id);
    const sess = fresh.sessions.find((s) => s.id === session.id) || session;
    rs.reopen(fresh, sess);
  } catch (e) { toast(e.message, { tone: 'error' }); }
}

/* One action column per row, rebuilt by `resultUpdateChosen` whenever the phase
   moves. The old row carried a „Spielen" button that went `disabled` at 0.45
   opacity on every row of every finished session (245px over five rows) plus
   a permanent „Aus Session entfernen" trash link (168px) — spent instrument
   on a record. Nothing is disabled here: a control that cannot act is not
   rendered.

   The „…" menu is on EVERY row, not only on a finished one. Removing a game
   is the session's own housekeeping and must not disappear while the evening
   is running — the issue's phase list only requires that a FINISHED session
   have no bare remove link, and putting the menu everywhere satisfies that
   while keeping the action reachable in both phases. */
function resultRenderAction(rs, { gameId, game, actionEl, titleId }) {
  const { round, session, rowRefs } = rs;
  actionEl.innerHTML = '';
  const isChosen = gameId === rs.chosenId;
  if (rs.finished || rs.cancelled) {
    // nothing primary: the choice is settled and the row is a record
  } else if (isChosen) {
    actionEl.appendChild(h(`<span class="trow__chip">${iconText('ti-check', t('result.onTable'))}</span>`));
  } else {
    const btn = h(`<button class="btn play-btn" aria-describedby="${titleId}">${iconText('ti-player-play', t('result.play'))}</button>`);
    btn.addEventListener('click', async () => {
      try {
        await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId });
        rs.chosenId = gameId;
        session.chosenGameId = gameId;
        rs.freshChoice = true;
        resultUpdateChosen(rs);
        // The row lifts as it hands its game to the table (#1058). Added
        // AFTER the re-render, because `resultUpdateChosen` rebuilds the action
        // column and a class set before it would be on a node nobody sees.
        // Removed on `animationend` so a later re-render cannot replay it.
        const lifted = rowRefs.find((x) => x.gameId === gameId);
        if (lifted) {
          lifted.row.classList.add('is-lift');
          lifted.row.addEventListener('animationend', function off(e) {
            if (e.animationName !== 'trow-lift') return;
            lifted.row.classList.remove('is-lift');
            lifted.row.removeEventListener('animationend', off);
          });
        }
        toast(t('result.toast.willPlay', { title: game.title }));
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
    actionEl.appendChild(btn);
  }
  const menuBtn = h(`<button type="button" class="btn btn--sm trow__menu" aria-label="${esc(t('result.more'))}" aria-describedby="${titleId}" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>`);
  const items = [{ icon: 'ti-external-link', label: t('result.openGame'), kind: 'edit', run: () => showGameDetail(round.id, gameId) }];
  // Un-choosing is how a live session changes its mind; it was the second tap
  // on „Spielen" before the chip replaced that button.
  // Not for a solo direct-play session: with one game there is nothing else to
  // choose, and with the Tafel gone there would be no way back (#1107). The
  // escape hatch stays „Session löschen" in the footer.
  if (isChosen && !rs.finished && !rs.cancelled && !resultIsSoloDirectPlay(rs)) {
    items.push({ icon: 'ti-x', label: t('result.clearChoice'), kind: 'undoable', run: async () => {
      try {
        await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId: null });
        rs.chosenId = null;
        session.chosenGameId = null;
        resultUpdateChosen(rs);
        toast(t('result.toast.choiceCleared'));
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } });
  }
  items.push({ icon: 'ti-trash', label: t('result.removeGame'), kind: 'destructive', run: () => resultRemoveGame(rs, game) });
  // Buttons only, so this is a popover at every width — the account menu's
  // case, not the editors' (.claude/rules/popover-vs-sheet-editors.md §2b).
  // `aria-expanded` is synced through openPopover's onClose rather than by
  // wrapping `close`: the wrapped form misses four of the six exits.
  menuBtn.addEventListener('click', () => {
    openPopover(menuBtn, (el, close) => fillMenu(el, items, close),
      () => menuBtn.setAttribute('aria-expanded', 'false'));
    menuBtn.setAttribute('aria-expanded', 'true');
  });
  actionEl.appendChild(menuBtn);
}

function resultUpdateChosen(rs) {
  const { rowRefs, tafelHint, tafel } = rs;
  rowRefs.forEach((ref) => {
    ref.row.classList.toggle('is-chosen', ref.gameId === rs.chosenId);
    resultRenderAction(rs, ref);
  });
  // The prompt lives on the Tafel's own kicker now, beside the heading it
  // belongs to, rather than in a banner between the head and the rows.
  if (tafelHint) tafelHint.hidden = !!(rs.chosenId || rs.finished || rs.cancelled);
  // …and the whole section stands down when it would only restate the band
  // (#1107). Toggled here rather than skipped at build time so `rowRefs` stays
  // intact and nothing downstream needs a null check.
  tafel.hidden = resultIsSoloDirectPlay(rs);
  resultRenderCancel(rs);
  resultRenderBand(rs);
}

// Cancel is the alternative final state: only offered while no game is
// chosen, and undoable like the finish reset. Rendered as a `link-btn` in the
// footer next to „Session löschen" (#614) — the rare escape hatch, not a peer
// of the result it used to sit above.
// The two cancel actions and the delete, as closures both footers call — the
// Klassisch link row below and Der Tisch's „Mehr" menu (#1275) — so the two
// designs cannot drift apart on what cancelling or deleting actually does.
async function resultSetCancelled(rs, next) {
  const { round, session } = rs;
  try {
    await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/cancel`, { cancelled: next });
    rs.cancelled = next;
    session.cancelled = next;
    if (!next) session.cancelledAt = null;
    toast(t(next ? 'result.toast.cancelled' : 'result.toast.cancelUndone'));
    resultUpdateChosen(rs);
  } catch (e) { toast(e.message, { tone: 'error' }); }
}

async function resultConfirmCancel(rs) {
  if (!await confirmDialog({
    body: t('result.cancelConfirm'), confirmLabel: t('result.cancel'), icon: 'ti-x',
    cancelLabel: t('result.keepSession'),
  })) return;
  await resultSetCancelled(rs, true);
}

async function resultDeleteSession(rs) {
  const { round, session, when } = rs;
  if (!await confirmDialog({
    body: t('sessions.deleteConfirm', { when }),
    confirmLabel: t('result.deleteSession'), icon: 'ti-trash',
  })) return;
  try {
    await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}`);
    toast(t('sessions.deleted'));
    showRound(round.id);
  } catch (e) { toast(e.message, { tone: 'error' }); }
}

function resultRenderCancel(rs) {
  const { cancelWrap } = rs;
  cancelWrap.innerHTML = '';
  if (rs.finished || rs.chosenId) return;
  if (rs.cancelled) {
    const undo = h(`<button class="link-btn">${esc(t('result.cancelUndo'))}</button>`);
    undo.addEventListener('click', () => resultSetCancelled(rs, false));
    cancelWrap.appendChild(undo);
  } else {
    // „Session abbrechen" alone, with the reason („Kein Spiel gefällt") moved
    // to the title (#817): spelled out it was 293px, which with „Session
    // löschen" beside it wrapped the footer row at 375px. Visible text is
    // present, so the title supplies the accessible DESCRIPTION and not the
    // name — SC 2.5.3 is unaffected.
    const btn = h(`<button class="link-btn" title="${esc(t('result.cancelHint'))}">${iconText('ti-x', t('result.cancel'))}</button>`);
    btn.addEventListener('click', () => resultConfirmCancel(rs));
    cancelWrap.appendChild(btn);
  }
}

/* Der Tisch's foot (#1275): „Noch eine Session" once this one is settled,
   „Teilen", and „Mehr" holding what Klassisch's footer row offers — cancel
   (or its undo) while no game is chosen, and delete for a co-owner. Refilled
   from resultRenderBand, which every phase change reaches.

   „Noch eine Session" opens the setup PREFILLED with tonight's members
   (operator question 1, decided unilaterally — see the PR): the same people
   sitting down again is the common case, and a plain setup would seat every
   member of the round. Guests are not carried: they were named for this
   session only, and the setup's guest list is the place to add them again. */
function resultRenderFoot(rs) {
  const { tischFoot, people, round, session, shareNow } = rs;
  if (!tischFoot) return;
  const more = [];
  if (!rs.finished && !rs.chosenId) {
    more.push(rs.cancelled
      ? { icon: 'ti-arrow-back-up', label: t('result.cancelUndo'), kind: 'undoable', run: () => resultSetCancelled(rs, false) }
      : { icon: 'ti-x', label: t('result.cancel'), kind: 'destructive', run: () => resultConfirmCancel(rs) });
  }
  // Taking someone out (#1538). `destructive` because its confirm is a danger
  // one (popover.js's kind rule); first among them, since it corrects the
  // evening where the other two throw it away.
  if (people.length > 1) {
    more.unshift({ icon: 'ti-user-minus', label: t('session.removeEntry'), kind: 'destructive', run: () => showRemovePersonSheet(round, session, rs.reopen) });
  }
  if (roundCan(round, 'session.delete')) {
    more.push({ icon: 'ti-trash', label: t('result.deleteSession'), kind: 'destructive', run: () => resultDeleteSession(rs) });
  }
  const memberIds = people.filter((p) => !p.guest).map((p) => p.id);
  fillComposedResultFoot(tischFoot, {
    again: rs.finished || rs.cancelled ? () => showStartSession(round, { memberIds }) : null,
    againDisabled: !round.games.some(isActiveGame),
    share: shareNow,
    more,
  });
}
