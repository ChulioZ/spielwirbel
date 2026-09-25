/* Spielwirbel – the round's Einstellungen screen (#561).

   One home for every round-LEVEL action, at every width. Before this, the three
   that are not about a specific game were stranded in tab footers: "Einladen"
   and "Spiele verschieben" at the foot of the Regal grid, and — worst —
   "Diese Runde löschen" at the foot of the CHRONIK timeline, which was the only
   footer that was not `rail-owned`, so it sat there at every width while the
   rail carried no entry for it at all. Deleting a round is not a history
   concern, and on a phone it was reachable only by switching tabs and scrolling
   past the entire month-grouped history.

   Since #956 it also HOLDS showMarker (the design picker until #1187) and showTags, the two sub-screens its own
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
  applyMarker(round);
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
  // Ocean puts the marker picker ON this screen (#1219, O14.1 „Name & Marker"),
  // so its row would only lead to the same eight swatches one tap further on —
  // a new place replaces its entry point. The /design route itself stays: a
  // bookmark still reaches it, and Klassisch and Der Tisch still link to it.
  const ocean = designIs('ocean');
  [
    { icon: 'ti-tags', label: t('round.tags'), sub: 'tags', go: () => showTags(rid) },
    { icon: 'ti-palette', label: t('round.marker'), sub: 'design', go: () => showMarker(rid) },
  ].filter(({ sub }) => !(ocean && sub === 'design')).forEach(({ icon, label, sub, go }) => {
    const row = h(`<a class="ds-row rs-row">
         <div class="ds-row__main"><i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></div>
         <div class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></div>
       </a>`);
    navLink(row, roundPath(rid, sub), go);
    nav.appendChild(row);
  });
  app.appendChild(nav);

  // --- The round's saved session filters (#1328) — rename, delete, reorder.
  // Inline rather than a routed sub-screen: a list of at most a handful of
  // names needs no page of its own. Every grantee may manage them — they cost
  // 'round.write', the floor anyone who can draw in the round clears.
  app.appendChild(renderSavedFiltersSection(round));

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
      } catch (e) { toast(e.message, { tone: 'error' }); }
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
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
    danger.appendChild(delBtn);
  }
  app.appendChild(danger);
  if (ocean) composeOceanSettings(round, rid);
}

/* Ocean's Einstellungen (#1219, O14.1): the same sections as cards, the marker
   picker as the first of them, and the danger zone in a column of its own from
   1280px. Composed AFTER the shared build, out of its own nodes, so every
   handler above is the one that runs and Klassisch never enters this function.

   Each `h2.rs-section__h` opens a card that takes every sibling up to the next
   one — the section's list, the saved filters, the danger box. The marker card
   goes first because O14.1 leads with it, and it states in the app's own
   sentence (`marker.note`) the one thing the screen exists to say: the marker is
   the ROUND's, seen by everyone in it whatever design they wear. */
function composeOceanSettings(round, rid) {
  const head = app.querySelector(':scope > .page-head');
  const main = h('<div class="rs-ocean__main"></div>');
  const aside = h('<div class="rs-ocean__aside"></div>');
  const marker = h(`<section class="rs-card rs-card--marker">
       <h2 class="rs-section__h">${esc(t('marker.title'))}</h2>
     </section>`);
  marker.appendChild(renderMarkerGrid(round, rid));
  marker.appendChild(h(`<p class="muted rs-card__note">${esc(t('marker.note'))}</p>`));
  main.appendChild(marker);

  // Everything after the page head, in document order: the headings and what
  // follows each of them.
  const after = [...app.children].slice([...app.children].indexOf(head) + 1);
  let card = null;
  after.forEach((el) => {
    if (el.matches('h2.rs-section__h')) {
      const danger = el.classList.contains('rs-section__h--danger');
      card = h(`<section class="rs-card${danger ? ' rs-card--danger' : ''}"></section>`);
      (danger ? aside : main).appendChild(card);
    }
    if (card) card.appendChild(el);
  });

  const cols = h('<div class="rs-ocean"></div>');
  cols.appendChild(main);
  cols.appendChild(aside);
  app.appendChild(cols);
}

// =================== The two sub-screens Einstellungen links to ===================
//
// Moved here from views-round-detail.js by #956: both are routed screens of
// their own (router.js reaches them directly) and both are reached from the row
// list above, so they belong with the screen that offers them rather than beside
// the game detail view they had nothing to do with.

async function showMarker(rid) {
  currentView = () => showMarker(rid);
  syncUrl(roundPath(rid, 'design'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyMarker(round);
  setContext(round.name);
  setDocTitle(t('round.marker'), round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'design');
  app.appendChild(backRow(() => showRound(rid)));
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('marker.title'))}</h1></div>`));

  const sec = h('<div class="section"></div>');
  sec.appendChild(h(`<div class="muted" style="margin-bottom:14px">${esc(t('marker.note'))}</div>`));
  const grid = renderMarkerGrid(round, rid);
  sec.appendChild(grid);
  app.appendChild(sec);
}

/* The eight swatches, and they are the ACTIVE design's eight (#1187). A round
   stores only an index, so the picker shows what the chooser will paint for the
   person looking at it — someone on Der Tisch picks between felts, someone on
   Klassisch between the palette accents, someone on Ocean between the person
   colours (member-colors.js; designs.js carries the copy that
   test/design-tokens.test.js pins) — and all of
   them are choosing the same index. Falling back to FACE_DESIGN keeps it
   renderable on a self-hosted instance with no accounts, where there is no
   active design at all.

   This screen was the DESIGN picker until #1187: seventeen cards, a palette
   group and a world poster grid. Rounds no longer own a design; since the flip
   (#1202) a round that wore one shows the marker it maps to (round-marker.js),
   and the picker shows that marker pressed.

   Shared by the /design screen and, under Ocean, the Einstellungen screen's
   marker card (#1219). A pick re-renders whichever of the two is showing. */
function renderMarkerGrid(round, rid) {
  const active = activeDesign();
  const designId = (active && active.id) || FACE_DESIGN;
  const markers = designMarkers(designId);
  const ink = markerInk(designId);
  const current = roundMarker(round);

  const grid = h('<div class="marker-cards"></div>');
  markers.forEach((m, i) => {
    const on = i === current;
    const label = esc(t(m.labelKey));
    // The same three tokens a round carries (round-theme.js's markerStyle), so
    // the swatch is painted by what the four surfaces read rather than by hexes
    // this screen spells for itself. --marker-ink is the check glyph's, and it
    // is per design rather than per scheme — see markerInk() in designs.js.
    const sw = h(`<button class="marker-card${on ? ' is-active' : ''}" type="button"
         aria-pressed="${on}" style="--marker:${m.color};--marker-deep:${m.deep};--marker-ink:${ink}" title="${label}">
         <span class="marker-card__fill"><i class="ti ti-check" aria-hidden="true"></i></span>
         <span class="marker-card__name">${label}</span>
       </button>`);
    sw.addEventListener('click', async () => {
      if (on) return;
      try {
        const saved = await api('PATCH', `/api/rounds/${rid}/marker`, { index: i });
        /* Seed the SWR cache before re-rendering, for the reason the design
           picker documented before it: fetchRound() answers from the cached
           copy, which still holds the OLD marker, so a bare currentView() would
           repaint the previous colour and only correct itself once the
           revalidation landed. The route answers with `{ marker }` alone, hence
           the patch rather than a swrStore.set of the response. */
        const key = 'round:' + rid;
        const cached = swrStore.get(key);
        if (cached) swrStore.set(key, { ...cached, marker: saved.marker });
        /* …and the LOBBY's list, for the same reason one screen over (#1197).
           `rounds` is its own SWR key, and inside its 5s freshness window
           showHome() serves it without revalidating — so going back to the
           lobby right after a pick drew the tile in the OLD felt, and it only
           corrected itself on a later visit. */
        const list = swrStore.get('rounds');
        if (Array.isArray(list)) {
          swrStore.set('rounds', list.map((r) => (r && r.id === rid ? { ...r, marker: saved.marker } : r)));
        }
        toast(t('marker.toast.set'));
        currentView();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
    grid.appendChild(sw);
  });
  return grid;
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
  applyMarker(round);
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
    } catch (e) { toast(e.message === 'quota_tags' ? t('tags.toast.quota') : e.message, { tone: 'error' }); }
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

    /* Manual order (#1159). Array order IS the stored order, and every surface
       that lists tags — these tiles, the game-detail chips, the Regal bulk
       sheet, the filter panel, the draw presets — renders it straight, so
       moving a tile here moves the tag everywhere.

       The controls say „nach vorne"/„nach hinten" rather than up/down: this is
       a WRAPPING GRID (`.ds-list--tiles`, three columns at reading width, one
       on a phone), so the previous tag is to the left on a laptop and above on
       a phone. An up arrow would point somewhere the tag does not go at most
       widths; „earlier/later" is true at every width, and for an icon-only
       button the label is what a screen reader reads anyway. */
    const order = tags.map((tg) => tg.id);
    const rows = new Map();

    // Each save sends the WHOLE order, so two in flight at once can be applied
    // in either sequence and leave the server on the earlier of the two. Chain
    // them instead: a keyboard user holding „nach vorne" outruns the network.
    let pending = Promise.resolve();
    const persist = () => {
      pending = pending.then(async () => {
        try {
          await api('PATCH', `/api/rounds/${rid}/tags/order`, { tagIds: order.slice() });
        } catch (e) {
          // `tags_changed` means another tab created or deleted a tag, so this
          // list is stale by definition and there is nothing local worth
          // keeping — take the server's.
          toast(e.message === 'tags_changed' ? t('tags.toast.changed') : e.message, { tone: 'error' });
          showTags(rid);
          throw e; // stop the chain; the view is being rebuilt under it
        }
      }).catch(() => {});
    };

    // Disabled rather than hidden at the two ends: a tile whose control set
    // changes width as it moves is worse than a dead button.
    const syncEnds = () => {
      order.forEach((tagId, i) => {
        const row = rows.get(tagId);
        row.querySelector('.tag-act--back').disabled = i === 0;
        row.querySelector('.tag-act--fwd').disabled = i === order.length - 1;
      });
    };

    // An open inline editor is inserted AFTER its own row, so moving rows
    // around would strand it beside a different tag. Reordering is not
    // editing — close it.
    const closeEditors = () => list.querySelectorAll('.tag-edit').forEach((el) => el.remove());

    // The model half of a move, shared by the arrows and the drag (#1180): the
    // drag has already moved the DOM node by the time it reports, so the node
    // is the caller's business and only the order, the ends and the save are
    // common.
    const applyOrder = (from, to) => {
      order.splice(to, 0, order.splice(from, 1)[0]);
      syncEnds();
      persist();
    };

    const move = (tagId, delta, pressed, partner) => {
      const from = order.indexOf(tagId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= order.length) return;
      closeEditors();
      applyOrder(from, to);
      const row = rows.get(tagId);
      // After the splice the tag that swapped places with this one sits at the
      // OLD index, in both directions.
      const swapped = rows.get(order[from]);
      if (delta < 0) swapped.before(row); else swapped.after(row);
      // Re-inserting the row detaches it, which drops focus — so pressing
      // „nach vorne" three times would otherwise move three different tags one
      // place each instead of one tag three places. When the move just disabled
      // the pressed button (the tag reached an end), hand focus to its partner
      // rather than letting it fall to the document.
      (pressed.disabled ? partner : pressed).focus();
    };

    // Dragging a tile (#1180), beside the arrows rather than instead of them —
    // they stay the keyboard path and the SC 2.5.7 single-pointer alternative.
    // A sighted user watches the tile land; the silent live region tells a
    // screen-reader user where it went.
    const drop = (from, to) => {
      const { name } = tags.find((x) => x.id === order[from]);
      applyOrder(from, to);
      announce(t('tags.moved', { name, position: to + 1, count: order.length }));
    };

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
            toast(e.message === 'tag_name_taken' ? t('tags.toast.nameTaken') : e.message, { tone: 'error' });
          }
        };
        editor.querySelector('.btn--primary').addEventListener('click', save);
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
        row.after(editor);
        nameInput.focus();
      });
      // Only worth showing once there is something to reorder: a lone tag would
      // carry two permanently dead buttons.
      if (tags.length > 1) {
        const back = h(`<button class="tag-act tag-act--back" aria-label="${esc(t('tags.moveEarlier'))}" title="${esc(t('tags.moveEarlier'))}"><i class="ti ti-arrow-left" aria-hidden="true"></i></button>`);
        const fwd = h(`<button class="tag-act tag-act--fwd" aria-label="${esc(t('tags.moveLater'))}" title="${esc(t('tags.moveLater'))}"><i class="ti ti-arrow-right" aria-hidden="true"></i></button>`);
        back.addEventListener('click', () => move(tg.id, -1, back, fwd));
        fwd.addEventListener('click', () => move(tg.id, 1, fwd, back));
        row.querySelector('.ds-row__meta').appendChild(back);
        row.querySelector('.ds-row__meta').appendChild(fwd);
      }
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
        } catch (e) { toast(e.message, { tone: 'error' }); }
      });
      row.querySelector('.ds-row__meta').appendChild(del);
      rows.set(tg.id, row);
      list.appendChild(row);
    });
    if (tags.length > 1) {
      syncEnds();
      list.classList.add('is-reorderable');
      makeReorderable(list, {
        itemSelector: '.tag-row',
        filterSelector: '.tag-act',
        onStart: closeEditors,
        onMove: drop,
      });
    }
    sec.appendChild(list);
  }
  app.appendChild(sec);
}
