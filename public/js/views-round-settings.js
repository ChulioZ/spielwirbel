/* Spielwirbel – the round's Einstellungen screen (#561).

   One home for every round-LEVEL action, at every width. Before this, the three
   that are not about a specific game were stranded in tab footers: "Einladen"
   and "Spiele verschieben" at the foot of the Regal grid, and — worst —
   "Diese Runde löschen" at the foot of the CHRONIK timeline, which was the only
   footer that was not `rail-owned`, so it sat there at every width while the
   rail carried no entry for it at all. Deleting a round is not a history
   concern, and on a phone it was reachable only by switching tabs and scrolling
   past the entire month-grouped history.

   Since #956 it also HOLDS showBackground/showTags, the two sub-screens its own
   row list links to. They came from views-round-detail.js, where they were an
   independently editable concern sitting inside a file past its size budget
   (.claude/rules/token-friendly-source-files.md).

   The two sheets it opens — showTransferGames and showInvite — are in
   views-round-actions.js, loaded right after this file (#528). They had stayed
   behind in views-round-tabs.js when #561 moved their entry points here, so a
   change to either action meant opening the Regal's file to edit an
   Einstellungen action.

   Part of the frontend; all files share one global script scope. Every name it
   uses from a sibling file is referenced at call time, never at load time
   (.claude/rules/frontend-script-load-order.md). */

'use strict';

async function showRoundSettings(rid) {
  currentView = () => showRoundSettings(rid);
  syncUrl(roundPath(rid, 'settings'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  setDocTitle(t('rail.settings'), round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'settings');
  app.appendChild(backRow(() => showRound(rid)));
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('rail.settings'))}</h1></div>`));

  // --- The three routed configuration screens. Real <a href> via navLink (#330);
  // they own their own screens, so this only links to them and duplicates nothing.
  app.appendChild(h(`<h2 class="rs-section__h">${esc(t('roundSettings.config'))}</h2>`));
  const nav = h('<div class="ds-list"></div>');
  [
    { icon: 'ti-tags', label: t('round.tags'), sub: 'tags', go: () => showTags(rid) },
    { icon: 'ti-palette', label: t('round.design'), sub: 'design', go: () => showBackground(rid) },
  ].forEach(({ icon, label, sub, go }) => {
    const row = h(`<a class="ds-row rs-row">
         <div class="ds-row__main"><i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></div>
         <div class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></div>
       </a>`);
    navLink(row, roundPath(rid, sub), go);
    nav.appendChild(row);
  });
  app.appendChild(nav);

  // --- The two sheet actions. The gate asks the shared capability table (#137)
  // rather than testing `shared`, so a grantee is never offered an action the
  // route would 403 — and the two cannot drift, since the server consults the same
  // table (.claude/rules/shared-constants-across-the-stack.md). Both are still
  // owner-only in effect: no grantee role clears either capability.
  // They open sheets rather than routing, so they stay <button>s (#330).
  const actions = [];
  if (round.games.length && roundCan(round, 'games.moveOut')) {
    actions.push({ icon: 'ti-arrow-right', label: t('transferGames.link'), onClick: () => showTransferGames(round) });
  }
  if (accountsActive() && roundCan(round, 'round.shares.manage')) {
    actions.push({ icon: 'ti-users', label: t('invite.link'), onClick: () => showInvite(round) });
  }
  if (actions.length) {
    app.appendChild(h(`<h2 class="rs-section__h">${esc(t('roundSettings.manage'))}</h2>`));
    const list = h('<div class="ds-list"></div>');
    actions.forEach(({ icon, label, onClick }) => {
      const row = h(`<button class="ds-row rs-row" type="button">
           <span class="ds-row__main"><i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></span>
           <span class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>
         </button>`);
      row.addEventListener('click', onClick);
      list.appendChild(row);
    });
    app.appendChild(list);
  }

  // --- The one irreversible action, visually separated — the Konto screen's
  // pattern (#419), which is what this screen exists to give the round too. On a
  // SHARED round the owner-only delete is replaced by "leave": a grantee gives up
  // their own access, while the owner's round and their seat's history stay.
  app.appendChild(h(`<h2 class="rs-section__h rs-section__h--danger">${esc(t('roundSettings.danger'))}</h2>`));
  const danger = h(`<div class="rs-danger">
       <p class="muted">${esc(t(round.shared ? 'roundSettings.leaveIntro' : 'roundSettings.deleteIntro'))}</p>
     </div>`);
  if (round.shared) {
    const leaveBtn = h(`<button class="btn btn--danger" type="button">${esc(t('share.leave'))}</button>`);
    leaveBtn.addEventListener('click', async () => {
      if (!await confirmDialog({
        body: t('share.leaveConfirm', { name: round.name }), confirmLabel: t('share.leave'),
      })) return;
      try {
        await api('DELETE', `/api/rounds/${rid}/shares/${accountUser.id}`);
        showHome();
      } catch (e) { toast(e.message); }
    });
    danger.appendChild(leaveBtn);
  } else {
    const delBtn = h(`<button class="btn btn--danger" type="button">${esc(t('round.deleteRound'))}</button>`);
    delBtn.addEventListener('click', async () => {
      if (!await confirmDialog({
        body: t('round.deleteConfirm', { name: round.name }),
        confirmLabel: t('round.deleteRound'), icon: 'ti-trash',
      })) return;
      try {
        await api('DELETE', '/api/rounds/' + rid);
        showHome();
      } catch (e) { toast(e.message); }
    });
    danger.appendChild(delBtn);
  }
  app.appendChild(danger);
}

// =================== The two sub-screens Einstellungen links to ===================
//
// Moved here from views-round-detail.js by #956: both are routed screens of
// their own (router.js reaches them directly) and both are reached from the row
// list above, so they belong with the screen that offers them rather than beside
// the game detail view they had nothing to do with.

async function showBackground(rid) {
  currentView = () => showBackground(rid);
  syncUrl(roundPath(rid, 'design'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  setDocTitle(t('round.design'), round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'design');
  app.appendChild(backRow(() => showRound(rid)));
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('design.title'))}</h1></div>`));

  // Which card is active. A design that matches nothing — a legacy plain colour
  // or a hand-edited hex — de-selects Standard without selecting anything else,
  // exactly as the hex-only lookup did before ids existed (#903).
  const bg = round.background;
  const current = resolveDesign(bg);
  const stored = Boolean(bg && bg.type === 'theme' && bg.page);

  // Two groups: the colour palettes, then the worlds. Each card is a tiny live
  // preview — page background, an accent "button", a text line and the accent
  // dot. A world card also carries data-world plus its OWN --brand, so the
  // ornament rules paint its backdrop, frame and display face in its accent
  // rather than in the round's (see "Worlds" in styles.css).
  [
    { titleKey: 'design.group.colors', noteKey: 'design.note', designs: PALETTES },
    { titleKey: 'design.group.worlds', noteKey: 'design.worlds.note', designs: WORLDS },
  ].forEach((group) => {
    const sec = h(`<div class="section"><h2>${esc(t(group.titleKey))}</h2></div>`);
    sec.appendChild(h(`<div class="muted" style="margin-bottom:14px">${esc(t(group.noteKey))}</div>`));
    const grid = h('<div class="theme-cards"></div>');
    group.designs.forEach((th) => {
      const active = th.std ? !stored : Boolean(current && current.id === th.id);
      const worldAttr = th.world ? ` data-world="${esc(th.world)}"` : '';
      // A dark design previews as a dark CARD, inside whatever scheme the round
      // is in (#904) — the token block matches .theme-card[data-scheme] as well
      // as :root. Both tokens it derives from go inline for that reason: a dark
      // card needs its own --page-bg to lift a --surface and sink a --line off,
      // and every card needs --brand so an ornament paints the design it names.
      const schemeAttr = th.scheme ? ` data-scheme="${esc(th.scheme)}"` : '';
      const style = `background:${th.page};--page-bg:${th.page};--brand:${th.accent}`;
      const sw = h(`<button class="theme-card${th.world ? ' theme-card--world' : ''}${active ? ' is-active' : ''}"${worldAttr}${schemeAttr} aria-pressed="${active}" style="${style}" title="${esc(t(th.labelKey))}">
         <span class="theme-card__bar" style="background:${th.accent}"></span>
         <span class="theme-card__line"></span>
         <span class="theme-card__line theme-card__line--short"></span>
         <span class="theme-card__name" style="color:${th.accent}">${esc(t(th.labelKey))}</span>
         <span class="theme-card__check" style="background:${th.accent}"><i class="ti ti-check" aria-hidden="true"></i></span>
       </button>`);
      sw.addEventListener('click', async () => {
        const payload = th.std
          ? { type: 'none' }
          : { type: 'theme', id: th.id, page: th.page, accent: th.accent };
        try {
          const saved = await api('POST', `/api/rounds/${rid}/background`, payload);
          applyBackground(saved.background);
          /* Re-render, rather than sweeping the active class by hand.

             Until #904 a design change was purely CSS — applyBackground() moved
             two custom properties and every tone on screen followed — so the
             only thing left to update was which card reads as chosen. A dark
             design also flips two things JS resolves AT RENDER TIME: the member
             tone on every avatar (memberTone) and the rating ramp (avgColor).
             Those were painted inline while the old scheme was in force, so
             without a redraw the rail's avatars keep light-scheme discs and
             carry the dark scheme's near-black initials — measured: unreadable,
             on the one screen where the design can change.

             The cache has to be seeded first: fetchRound() serves the SWR copy,
             which still holds the OLD background, so a bare currentView() would
             repaint the previous design and only correct itself when the
             revalidation landed. The route answers with `{ background }` alone,
             hence the patch rather than a swrStore.set of the response. */
          const key = 'round:' + rid;
          const cached = swrStore.get(key);
          if (cached) swrStore.set(key, { ...cached, background: saved.background });
          toast(t('design.toast.set'));
          currentView();
        } catch (e) { toast(e.message); }
      });
      grid.appendChild(sw);
    });
    sec.appendChild(grid);
    app.appendChild(sec);
  });
}

// =================== Tags (custom round tags, #238) ===================

// Manage the round's tag list: create (deduped server-side) and delete (which
// silently unassigns the tag from every game). Assignment to games happens in
// the add-game sheet and the game detail's tag popover, not here.
async function showTags(rid) {
  currentView = () => showTags(rid);
  syncUrl(roundPath(rid, 'tags'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  setDocTitle(t('tags.title'), round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'tags');
  app.appendChild(backRow(() => showRound(rid)));
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('tags.title'))}</h1></div>`));

  const sec = h('<div class="section"></div>');
  sec.appendChild(h(`<div class="muted" style="margin-bottom:14px">${esc(t('tags.note'))}</div>`));

  const addRow = h(`<div class="toolbar" style="margin-bottom:14px">
       <input class="input" style="flex:1" maxlength="30" placeholder="${esc(t('tags.addPlaceholder'))}"
              aria-label="${esc(t('tags.addPlaceholder'))}" />
       <button class="btn btn--primary"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('tags.add'))}</button>
     </div>`);
  const input = addRow.querySelector('input');
  // Icon picker for the new tag (#255). The trigger sits inline in the name row
  // so it reads as one sub-form (#293); the grid it expands still gets the full
  // width on its own line below.
  const picker = tagIconPicker(null);
  input.after(picker.trigger);
  // A duplicate name returns the existing tag (the server dedupes) — detected
  // here by its id already being known, for the right toast.
  const existingIds = new Set((round.tags || []).map((tg) => tg.id));
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      const tag = await api('POST', `/api/rounds/${rid}/tags`, { name, icon: picker.get() });
      toast(existingIds.has(tag.id) ? t('tags.toast.exists') : t('tags.toast.added'));
      showTags(rid);
    } catch (e) { toast(e.message === 'quota_tags' ? t('tags.toast.quota') : e.message); }
  };
  // Select the submit button explicitly: the icon-picker trigger (#293) is also
  // a <button> and sits earlier in the row, so a bare `querySelector('button')`
  // would silently bind "add" to the trigger and leave Hinzufügen inert.
  addRow.querySelector('.btn--primary').addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  sec.appendChild(addRow);
  sec.appendChild(picker.grid);

  const tags = round.tags || [];
  if (tags.length === 0) {
    sec.appendChild(emptyState({ icon: 'ti-tags', title: t('tags.emptyTitle'), text: t('tags.empty') }));
  } else {
    const list = h('<div class="ds-list ds-list--tiles"></div>');
    tags.forEach((tg) => {
      const n = round.games.filter((g) => (g.tagIds || []).includes(tg.id)).length;
      const row = h(`<div class="ds-row ds-row--static tag-row">
           <div class="ds-row__main"><span class="tag tag--custom"><i class="ti ${tagIconClass(tg.icon)}" aria-hidden="true"></i>${esc(tg.name)}</span></div>
           <div class="ds-row__meta"><span class="muted tag-row__count">${esc(tn(n, 'tags.gamesOne', 'tags.games'))}</span></div>
         </div>`);
      // Edit an existing tag — its NAME (#1004) and its icon (#255). The Tags
      // screen is the only surface that edits a tag; the popover and add-game
      // sheet only create and assign. Expands inline rather than opening a
      // dialog, as the icon-only version did before it.
      //
      // ONE pencil rather than a second button beside it: the row already
      // carries two actions at tile width, and name and icon are one question
      // („what is this tag"). They are also saved in ONE PATCH, so the two can
      // never land half-applied — which is the reason the repo takes a patch
      // rather than two mutators.
      const edit = h(`<button class="tag-act" aria-label="${esc(t('tags.edit'))}" title="${esc(t('tags.edit'))}"><i class="ti ti-pencil" aria-hidden="true"></i></button>`);
      edit.addEventListener('click', () => {
        const open = row.nextElementSibling;
        if (open && open.classList.contains('tag-edit')) { // second click closes it
          open.remove();
          return;
        }
        // Expanded: the pencil button IS the disclosure here (#293), so the
        // picker must not add a second one inside it.
        const p = tagIconPicker(tg.icon, { expanded: true });
        const editor = h(`<div class="tag-edit">
             <div class="toolbar">
               <input class="input" style="flex:1" maxlength="30" value="${esc(tg.name)}"
                      aria-label="${esc(t('tags.namePlaceholder'))}" />
               <button class="btn btn--primary">${esc(t('tags.save'))}</button>
             </div>
           </div>`);
        editor.appendChild(p.grid);
        const nameInput = editor.querySelector('input');
        const save = async () => {
          const name = nameInput.value.trim();
          if (!name) { toast(t('tags.toast.nameMissing')); return; }
          try {
            await api('PATCH', `/api/rounds/${rid}/tags/${tg.id}`, { name, icon: p.get() });
            toast(t('tags.toast.updated'));
            showTags(rid);
          } catch (e) {
            toast(e.message === 'tag_name_taken' ? t('tags.toast.nameTaken') : e.message);
          }
        };
        editor.querySelector('.btn--primary').addEventListener('click', save);
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
        row.after(editor);
        nameInput.focus();
      });
      row.querySelector('.ds-row__meta').appendChild(edit);
      const del = h(`<button class="tag-act tag-act--danger" aria-label="${esc(t('tags.delete'))}"><i class="ti ti-trash" aria-hidden="true"></i></button>`);
      del.addEventListener('click', async () => {
        if (n > 0 && !await confirmDialog({
          body: t('tags.deleteConfirm', { name: tg.name }),
          confirmLabel: t('tags.delete'), icon: 'ti-trash',
        })) return;
        try {
          await api('DELETE', `/api/rounds/${rid}/tags/${tg.id}`);
          toast(t('tags.toast.deleted'));
          showTags(rid);
        } catch (e) { toast(e.message); }
      });
      row.querySelector('.ds-row__meta').appendChild(del);
      list.appendChild(row);
    });
    sec.appendChild(list);
  }
  app.appendChild(sec);
}
