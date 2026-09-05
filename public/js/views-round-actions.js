/* Spielwirbel – views: the two round-level sheets the Einstellungen screen
   opens — "Spiele verschieben oder kopieren" (#253/#402/#916) and "Einladen"
   (#207/#466).
   showRoundSettings (views-round-settings.js) is their only caller; they live
   apart from it because a sheet and the screen listing it are independently
   editable (.claude/rules/token-friendly-source-files.md).
   Part of the frontend; all files share one global script scope. */

// Move games of this round into another of the user's rounds (#253), either the
// whole shelf or a selection (#402) — or COPY them there instead (#916), which
// leaves this shelf untouched and lands fresh rows on the target's.
//
// One sheet with a mode toggle rather than two, because everything except the
// verb is shared: the picker, select-all/none, and the target dropdown. The two
// modes differ in what they promise, so every string the user reads is swapped
// with the mode — a copy that says „verschieben" anywhere would be describing a
// destructive act it does not perform.
//
// The target list is fetched BEFORE the sheet opens, so it never renders an empty
// picker or a loading state — a user with only this one round gets a plain
// explanation instead. The target's own SHELF is fetched lazily and only in copy
// mode; see the duplicate flagging below.
async function showTransferGames(round) {
  let rounds;
  try {
    rounds = await fetchRoundList({ rerender: false });
  } catch (e) {
    toast(e.message);
    return;
  }
  const others = rounds.filter((r) => r.id !== round.id);
  const n = round.games.length;
  let mode = 'move';

  // Archived games transfer too, so they are listed — but labelled, since they
  // are invisible on the Regal the user is looking at and would otherwise be a
  // surprise in the count. A copy keeps the state, so the label stays true on
  // the other side.
  const stateOf = (g) =>
    g.retired ? t('retired.crumb')
      : g.completed ? t('completed.crumb')
        : g.wish ? t('wish.crumb')
          : '';

  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog sheet--list" role="dialog" aria-modal="true" aria-label="${esc(t('moveGames.title'))}">
        <div class="sheet__head">
          <h2 id="transferTitle">${esc(t('moveGames.title'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        ${others.length
          ? `<div class="transfer-modes" role="group" aria-label="${esc(t('transferGames.mode'))}">
               <button type="button" class="chip is-on" data-mode="move" aria-pressed="true"><i class="ti ti-arrow-right" aria-hidden="true"></i> ${esc(t('transferGames.modeMove'))}</button>
               <button type="button" class="chip" data-mode="copy" aria-pressed="false"><i class="ti ti-copy" aria-hidden="true"></i> ${esc(t('transferGames.modeCopy'))}</button>
             </div>
             <p class="muted" id="transferIntro">${esc(tn(n, 'moveGames.introOne', 'moveGames.intro'))}</p>
             <div class="field">
               <label for="moveTarget" id="transferPick">${esc(t('moveGames.pick'))}</label>
               <select id="moveTarget" class="input">
                 ${others.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}
               </select>
             </div>
             <p class="muted transfer-dup-hint" id="transferDupHint" hidden>${esc(t('copyGames.dupHint'))}</p>
             <div class="move-picker">
               <div class="move-list__head">
                 <span id="moveCount" class="muted" aria-live="polite"></span>
                 <button id="moveToggle" type="button" class="link-btn"></button>
               </div>
               <div class="ds-list move-list" role="group" aria-label="${esc(t('moveGames.games'))}">
                 ${round.games.map((g) => {
    const state = stateOf(g);
    return `<label class="ds-row move-row">
                     <div class="ds-row__main">
                       <span class="move-row__name" title="${esc(g.title)}">${esc(g.title)}</span>
                       ${state ? `<span class="muted move-row__state">${esc(state)}</span>` : ''}
                       <span class="muted move-row__dup" hidden>${esc(t('copyGames.dupFlag'))}</span>
                     </div>
                     <div class="ds-row__meta">
                       <input type="checkbox" class="provider-row__box" value="${esc(g.id)}" checked />
                     </div>
                   </label>`;
  }).join('')}
               </div>
             </div>
             <div class="toolbar sheet__actions">
               <button id="moveGo" class="btn btn--primary btn--lg"><i class="ti ti-arrow-right" aria-hidden="true"></i> <span id="transferSubmit">${esc(t('moveGames.submit'))}</span></button>
             </div>`
          : `<p class="muted">${esc(t('transferGames.empty'))}</p>`}
      </div>
    </div>`);
  const form = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  form.querySelector('.sheet__close').addEventListener('click', closeSheet);

  const go = form.querySelector('#moveGo');
  if (!go) return;

  const boxes = [...form.querySelectorAll('.move-row input')];
  const rows = [...form.querySelectorAll('.move-row')];
  const countEl = form.querySelector('#moveCount');
  const toggle = form.querySelector('#moveToggle');
  const select = form.querySelector('#moveTarget');
  const dupHint = form.querySelector('#transferDupHint');
  const picked = () => boxes.filter((b) => b.checked).map((b) => b.value);
  // The toggle offers whichever action is still available: "select all" once
  // anything is unchecked, "clear" while everything is on.
  const sync = () => {
    const sel = picked().length;
    countEl.textContent = tn(sel, 'moveGames.selectedOne', 'moveGames.selected');
    toggle.textContent = sel === boxes.length ? t('moveGames.selectNone') : t('moveGames.selectAll');
    go.disabled = sel === 0;
  };
  boxes.forEach((b) => b.addEventListener('change', sync));
  toggle.addEventListener('click', () => {
    const all = picked().length === boxes.length;
    boxes.forEach((b) => { b.checked = !all; });
    sync();
  });

  // Which of this round's games the CHOSEN TARGET already has by title. Fetched
  // from the target round rather than reported back by the route, because the
  // flag has to be visible while the user still has a choice — a "we skipped
  // these" answer after the fact cannot be argued with, and the picker's whole
  // job is letting them tick one back on.
  //
  // Same trimmed, case-insensitive rule tags merge by, so „catan" and „Catan"
  // are one game to the eye and to this flag. fetchRound is SWR-cached, so
  // flipping between two targets costs one request each, not one per flip.
  const norm = (s) => (s || '').trim().toLowerCase();
  const dupCache = new Map();
  let dupToken = 0;
  const clearDupes = () => {
    rows.forEach((row) => { row.querySelector('.move-row__dup').hidden = true; });
    dupHint.hidden = true;
  };
  async function markDuplicates() {
    const token = ++dupToken;
    const targetId = select.value;
    if (mode !== 'copy' || !targetId) { clearDupes(); return; }
    if (!dupCache.has(targetId)) {
      try {
        const target = await fetchRound(targetId);
        dupCache.set(targetId, new Set((target.games || []).map((g) => norm(g.title))));
      } catch {
        // A failed lookup flags nothing rather than blocking the copy: the round
        // is allowed to end up with two identically-titled games, so the flag is
        // an aid, never a gate.
        dupCache.set(targetId, new Set());
      }
    }
    // A slower answer for a target the user has already moved off must not
    // repaint the picker under them.
    if (token !== dupToken || mode !== 'copy') return;
    const have = dupCache.get(targetId);
    let any = false;
    rows.forEach((row, i) => {
      const dup = have.has(norm(round.games[i].title));
      row.querySelector('.move-row__dup').hidden = !dup;
      if (dup) { boxes[i].checked = false; any = true; }
    });
    dupHint.hidden = !any;
    sync();
  }

  // Every string the user reads swaps with the mode. The submit icon swaps too —
  // an arrow on a copy would say the games are leaving.
  const applyMode = () => {
    const copy = mode === 'copy';
    const title = t(copy ? 'copyGames.title' : 'moveGames.title');
    form.setAttribute('aria-label', title);
    form.querySelector('#transferTitle').textContent = title;
    form.querySelector('#transferIntro').textContent =
      tn(n, copy ? 'copyGames.introOne' : 'moveGames.introOne', copy ? 'copyGames.intro' : 'moveGames.intro');
    form.querySelector('#transferPick').textContent = t(copy ? 'copyGames.pick' : 'moveGames.pick');
    form.querySelector('#transferSubmit').textContent = t(copy ? 'copyGames.submit' : 'moveGames.submit');
    go.querySelector('.ti').className = `ti ${copy ? 'ti-copy' : 'ti-arrow-right'}`;
    form.querySelectorAll('.transfer-modes .chip').forEach((chip) => {
      const on = chip.dataset.mode === mode;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    markDuplicates();
  };
  form.querySelectorAll('.transfer-modes .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.dataset.mode === mode) return;
      mode = chip.dataset.mode;
      applyMode();
    });
  });
  // Switching target re-asks; switching back to move only clears the flags and
  // deliberately leaves the ticks alone — an auto-untick is a narrowing the user
  // can see, and silently re-ticking would undo their own choices with it.
  select.addEventListener('change', markDuplicates);
  sync();

  go.addEventListener('click', async () => {
    const targetId = select.value;
    const targetName = (others.find((r) => r.id === targetId) || {}).name || '';
    const ids = picked();
    if (!ids.length) return;
    const copy = mode === 'copy';
    // A copy touches no history at all, so it never needs the move's warning —
    // its confirm just names the count and the round.
    let msg;
    if (copy) {
      msg = tn(ids.length, 'copyGames.confirmOne', 'copyGames.confirm', { round: targetName });
    } else {
      // Only warn about history when a selected game actually carries any: a
      // shelf-tidying move of never-played games loses nothing, and a warning
      // that cries wolf gets clicked through.
      const chosen = new Set(ids);
      const touchesHistory = (round.sessions || []).some((s) => (s.gameIds || []).some((x) => chosen.has(x)));
      msg = touchesHistory
        ? tn(ids.length, 'moveGames.confirmOne', 'moveGames.confirm', { round: targetName })
        : tn(ids.length, 'moveGames.confirmPlainOne', 'moveGames.confirmPlain', { round: targetName });
    }
    if (!confirm(msg)) return;
    go.disabled = true;
    try {
      // Send the explicit selection even when everything is checked — the count
      // the user just confirmed is then exactly what the server transfers, with
      // no "all" shortcut that could pick up a game added from another device
      // since the sheet opened.
      const path = `/api/rounds/${round.id}/games/${copy ? 'copy-to' : 'move-to'}`;
      const res = await api('POST', path, { targetRoundId: targetId, gameIds: ids });
      toast(copy
        ? tn(res.copiedGames, 'copyGames.toast.doneOne', 'copyGames.toast.done')
        : tn(res.movedGames, 'moveGames.toast.doneOne', 'moveGames.toast.done'));
      closeSheet(() => showRound(round.id, 'regal'));
    } catch (e) {
      go.disabled = false;
      const ns = copy ? 'copyGames' : 'moveGames';
      const msg2 =
        e.message === 'quota_games' ? t(`${ns}.toast.quotaGames`)
          : e.message === 'quota_tags' ? t(`${ns}.toast.quotaTags`)
            : e.message;
      toast(msg2);
    }
  });
}

// Invite an account to share this round (#207). The OWNER fixes the seat here —
// take over a specific user-less member, or create a fresh one — so the invitee
// can't pick the wrong person. Accounts mode only (the entry points gate on
// accountsActive(); the route 404s otherwise). A grantee who somehow reaches this
// fails safely: the send route 404s a round they don't own.
async function showInvite(round) {
  const rid = round.id;
  const freeSeats = (round.members || []).filter((m) => !m.userId);

  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('invite.title'))}">
        <div class="sheet__head">
          <h2>${esc(t('invite.title'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p class="muted">${esc(t('invite.intro', { round: round.name }))}</p>
        <div class="field">
          <label for="inviteUser">${esc(t('invite.username'))}</label>
          <input id="inviteUser" class="input" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(t('invite.usernamePlaceholder'))}">
        </div>
        <div class="field">
          <label for="inviteSeat">${esc(t('invite.seat'))}</label>
          <select id="inviteSeat" class="input">
            <option value="">${esc(t('invite.newMember'))}</option>
            ${freeSeats.map((m) => `<option value="${esc(m.id)}">${esc(t('invite.takeOver', { name: m.name }))}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="inviteRole">${esc(t('share.role'))}</label>
          <select id="inviteRole" class="input">
            ${ROUND_ROLES.filter((r) => r !== 'owner').map((r) =>
    `<option value="${esc(r)}"${r === 'editor' ? ' selected' : ''}>${esc(t('share.role.' + r))}</option>`).join('')}
          </select>
          <p class="muted field__hint" id="inviteRoleHint">${esc(t('share.role.editor.hint'))}</p>
        </div>
        <div class="toolbar sheet__actions">
          <button id="inviteGo" class="btn btn--primary btn--lg"><i class="ti ti-mail" aria-hidden="true"></i> ${esc(t('invite.submit'))}</button>
        </div>
      </div>
    </div>`);
  const form = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  // Synchronous, and after openSheet: iOS only raises the soft keyboard for a
  // focus() inside the opening gesture, and trapFocus captures the pre-open
  // activeElement as its restore target. Don't defer this into a timeout.
  form.querySelector('#inviteUser').focus();
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  form.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  // #137: the hint follows the picked role, so the difference between the two is
  // stated where the choice is made rather than only in the FAQ.
  const roleSel = form.querySelector('#inviteRole');
  roleSel.addEventListener('change', () => {
    form.querySelector('#inviteRoleHint').textContent = t('share.role.' + roleSel.value + '.hint');
  });

  const go = form.querySelector('#inviteGo');
  go.addEventListener('click', async () => {
    const username = form.querySelector('#inviteUser').value.trim();
    const memberId = form.querySelector('#inviteSeat').value || null;
    const role = roleSel.value;
    if (!username) { form.querySelector('#inviteUser').focus(); return; }
    go.disabled = true;
    try {
      await accountApi('POST', '/invitations', { roundId: rid, username, memberId, role });
      toast(t('invite.toast.sent', { user: username }));
      closeSheet();
    } catch (e) {
      go.disabled = false;
      toast(inviteError(e.message));
    }
  });
  form.querySelector('#inviteUser').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go.click();
    }
  });

  // The Freundeskreis picker (#466) is fetched only AFTER the sheet is up:
  // typing a username must never wait on a network call. A failed fetch simply
  // leaves the picker out — the username field is the whole feature without it,
  // and accountApi already handles a dead session itself. The sheet may be gone
  // (or replaced) by the time this resolves, hence the isConnected check.
  try {
    const { friends } = await accountApi('GET', '/friends');
    if (backdrop.isConnected) insertFriendPicker(form, round, friends);
  } catch { /* no picker; inviting by username is unaffected */ }
}

// Offer the caller's accepted friends above the username field (#466), so an
// owner doesn't have to remember a handle they saw once in another view.
// Dropped: friends already holding a seat here (they would only ever produce
// `already_member`) and any whose username didn't resolve (nothing to address).
// When that leaves nothing, no field is inserted at all — the sheet then looks
// exactly as it did before. Inserting after openSheet is safe for the focus
// trap: focusables() is recomputed on every Tab, so the select joins the tab
// order at its DOM position (focus-trap.js).
function insertFriendPicker(form, round, friends) {
  const seated = new Set((round.members || []).map((m) => m.userId).filter(Boolean));
  const eligible = (friends || []).filter((f) => f.username && !seated.has(f.userId));
  if (!eligible.length) return;

  const field = h(`<div class="field">
      <label for="inviteFriend">${esc(t('invite.friendLabel'))}</label>
      <select id="inviteFriend" class="input">
        <option value="">${esc(t('invite.friendPick'))}</option>
        ${eligible.map((f) => `<option value="${esc(f.username)}">${esc(f.username)}</option>`).join('')}
      </select>
    </div>`);

  const user = form.querySelector('#inviteUser');
  user.closest('.field').before(field);
  // Fill the input rather than replacing it: it stays editable, so a non-friend
  // can still be invited by hand and the submit path reads one field as before.
  field.querySelector('#inviteFriend').addEventListener('change', (e) => {
    if (e.target.value) user.value = e.target.value;
  });
}

// Map a send-route error code to a localized message.
function inviteError(code) {
  const map = {
    user_not_found: 'invite.err.userNotFound',
    cannot_invite_self: 'invite.err.self',
    already_member: 'invite.err.alreadyMember',
    already_invited: 'invite.err.alreadyInvited',
    invalid_seat: 'invite.err.seatGone',
    seat_taken: 'invite.err.seatTaken',
    round_not_found: 'invite.err.roundGone',
  };
  return t(map[code] || 'invite.err.generic');
}
