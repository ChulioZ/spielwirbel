/* Spielwirbel – views: the voting lobby's sheets — the last-resort share-URL
   fallback, the vote link as a QR code (#1170), and taking someone out of a
   session (#1538), which the results screen opens too. Split out of
   views-session-live.js (#1574), which keeps the lobby itself; every function
   here is top-level and closes over nothing. Part of the frontend; all files
   share one global script scope. */

/* Last-resort share fallback: no `navigator.share`, no clipboard. Was a
   `prompt()` used as a read-only display — an INPUT dialog for something the
   user can only read, in OS chrome, on a screen the round has themed (#939).
   A field rather than a paragraph because the URL still has to be selectable,
   and it says "copy this" rather than the clipboard path's "copied": nothing
   was copied, and claiming otherwise is the one thing this branch must not do. */
function showShareUrlSheet(url) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('lobby.share'))}">
        <div class="sheet__head">
          <h2>${esc(t('lobby.share'))}</h2>
          <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p class="muted">${esc(t('lobby.shareManual'))}</p>
        <input id="shareUrlField" class="input" readonly
          aria-label="${esc(t('lobby.share'))}" value="${esc(url)}" />
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  // Focus AFTER openSheet, and select the whole URL: a manual copy is the only
  // thing this sheet is for, so it starts one keystroke away.
  const field = sheet.querySelector('#shareUrlField');
  field.focus();
  field.select();
}

/* The vote link as a code to hold up at the table (#1170).

   Drawn by the server (lib/routes/sessions.js), which mints the link through
   the same guard the share button does and encodes the URL it would itself
   serve — so the picture cannot point somewhere the link does not. Fetched on
   every open rather than cached: the code then always shows the link currently
   in force.

   Injected as inline SVG, never as a `data:` image URL — the token would
   otherwise sit in an attribute that a screenshot, a devtools copy or a crash
   report carries off with it. The markup is the server's own. */
function showVoteQrSheet(round, session) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog vote-qr" role="dialog" aria-modal="true" aria-label="${esc(t('lobby.qr'))}">
        <div class="sheet__head">
          <h2>${esc(round.name)}</h2>
          <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="vote-qr__code" role="img" aria-label="${esc(t('lobby.qrAlt'))}">
          <p class="muted center">${esc(t('lobby.qrLoading'))}</p>
        </div>
        <p class="muted center vote-qr__hint">${esc(t('lobby.qrHint'))}</p>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  api('POST', `/api/rounds/${round.id}/sessions/${session.id}/vote-link/qr`, {}).then(({ svg }) => {
    // The sheet may be gone by now — a code nobody is waiting for is not an
    // error, and writing into a detached node would hide the next one.
    if (!document.body.contains(backdrop)) return;
    sheet.querySelector('.vote-qr__code').innerHTML = svg;
  }).catch((e) => {
    if (document.body.contains(backdrop)) closeSheet();
    toast(e.message, { tone: 'error' });
  });
}

/* Take someone out of a session (#1538): one sheet listing the session's people,
   opened from the lobby and from the results screen in every design. A sheet
   rather than a control on each person's row, because every design composes
   those rows differently, and this is a correction the group makes rarely:
   one quiet entry per screen keeps it out of the way of the people list's
   real job. Each name opens a confirm, which replaces this sheet (openSheet's
   replace path) instead of stacking on it.

   `onDone(fresh, session)` re-renders the calling screen from the server's view,
   so the tally, teams and winners follow from the new people set. */
function showRemovePersonSheet(round, session, onDone) {
  const people = sessionPeople(round, session);
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog remove-person" role="dialog" aria-modal="true" aria-label="${esc(t('session.removeTitle'))}">
        <div class="sheet__head">
          <h2>${esc(t('session.removeTitle'))}</h2>
          <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p class="muted">${esc(t('session.removeIntro'))}</p>
        <ul class="remove-person__list"></ul>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const list = sheet.querySelector('.remove-person__list');
  // A person's column is non-empty once they have rated anything: the lobby
  // knows that only as `votedIds` (the values are redacted while voting runs),
  // the results screen from the revealed votes themselves.
  const voted = new Set(session.votedIds || []);
  Object.entries(session.votes || {}).forEach(([pid, byGame]) => {
    if (byGame && Object.keys(byGame).length) voted.add(pid);
  });
  people.forEach((p) => {
    const row = h(`<li class="remove-person__row">
        <span class="live-person__avatar live-person__avatar--sm" style="background:${personColor(round, p)}">${avatarFace(initials(p.name), { userId: p.userId })}</span>
        <span class="remove-person__name">${esc(personLabel(p))}</span>
        <button type="button" class="btn btn--sm remove-person__btn">${iconText('ti-user-minus', t('session.removeAction'))}</button>
      </li>`);
    const btn = row.querySelector('button');
    btn.setAttribute('aria-label', t('session.removeActionFor', { name: personLabel(p) }));
    btn.addEventListener('click', () => removePerson(p));
    list.appendChild(row);
  });
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  async function removePerson(p) {
    const name = personLabel(p);
    const ok = await confirmDialog({
      title: t('session.removeConfirmTitle', { name }),
      body: t(voted.has(p.id) ? 'session.removeConfirmVoted' : 'session.removeConfirm', { name }),
      confirmLabel: t('session.removeAction'),
      icon: 'ti-user-minus',
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}/people/${p.id}`);
      toast(t('session.removed', { name }));
      const fresh = await fetchRoundFresh(round.id);
      const s = fresh.sessions.find((x) => x.id === session.id);
      if (!s) return showRound(round.id, 'start');
      onDone(fresh, s);
    } catch (e) {
      const known = { last_person: 'session.removeLast', already_split: 'session.removeSplit' };
      toast(known[e.message] ? t(known[e.message]) : e.message, { tone: 'error' });
    }
  }
}

// The quiet entry to the sheet above, or null when there is nobody to take out
// (a session must keep at least one person, so one person means no action).
function removePersonEntry(round, session, onDone) {
  if (sessionPeople(round, session).length < 2) return null;
  const btn = h(`<button type="button" class="link-btn remove-person__entry">${iconText('ti-user-minus', t('session.removeEntry'))}</button>`);
  btn.addEventListener('click', () => showRemovePersonSheet(round, session, onDone));
  return btn;
}
