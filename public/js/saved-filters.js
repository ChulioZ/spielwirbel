/* Spielwirbel – a round's SAVED session filters (#1328).

   A group's recurring draws, under a name: „Kinderabend-Filter: diese vier
   Leute, Familien-Tag, max. 45 Min". Saved from the session setup screen,
   shown as the hub's quick-start chips (hubPresetChips, hub-cards.js — ONE
   renderer every design calls), managed in the round's Einstellungen.

   Three pieces live here, because each is reached from a different screen and
   none of them belongs to that screen's file:
   - `savedFilterPrefill`, the chip's replay of a filter onto the setup screen;
   - `renderSaveFilterAction` + its sheet, the setup screen's save control;
   - `renderSavedFiltersSection`, the Einstellungen list.

   The two numbers — the per-round ceiling and the name length — come from
   GET /api/config (core.js calls setSavedFilterLimits), never from a copy here
   (.claude/rules/shared-constants-across-the-stack.md).

   Part of the frontend; all files share one global script scope. Nothing here
   runs at load time beyond two declarations, and every sibling it calls is
   reached at call time (.claude/rules/frontend-script-load-order.md). */

'use strict';

/* `perRound: null` is "not loaded yet (or the probe failed)": the save action
   then stays enabled and the server's 403 is the backstop, which is the same
   degradation game-editors.js's expansions cap takes. */
let savedFilterLimits = { perRound: null, nameMax: null };
function setSavedFilterLimits(cfg) {
  const n = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  savedFilterLimits = { perRound: n(cfg && cfg.perRound), nameMax: n(cfg && cfg.nameMax) };
}

// Whether the round has reached its ceiling, as far as the client knows.
function savedFiltersFull(round) {
  const cap = savedFilterLimits.perRound;
  return cap !== null && ((round && round.savedFilters) || []).length >= cap;
}

/* The prefill a saved chip hands showStartSession. EVERY key is present, on
   purpose: showStartSession merges a prefill OVER the round's remembered draw
   (`{ ...lastSessionFilters, ...prefill }`, so a metadata-only built-in chip
   keeps last week's tags). A saved filter is the whole setup instead, so a key
   it does not carry must not fall through to last week's value — an absent
   `tagMode` would otherwise inherit an 'any', an absent `metadata` last week's
   „max. 60 Min". The absent-key discipline of the STORED blob is undone here,
   at the one place that knows the blob means "exactly this".

   `memberIds` is resolved against the round again by showStartSession (#1275):
   a seat retired or removed since the save is dropped there, and an empty
   survivor set falls back to everyone. Deleted tags are dropped there too. */
function savedFilterPrefill(sf) {
  return {
    tagIds: Array.isArray(sf.tagIds) ? sf.tagIds : [],
    excludeTagIds: Array.isArray(sf.excludeTagIds) ? sf.excludeTagIds : [],
    tagMode: sf.tagMode === 'any' ? 'any' : 'all',
    metadata: sf.metadata || {},
    multiTable: sf.multiTable === true,
    count: sf.count,
    memberIds: Array.isArray(sf.memberIds) ? sf.memberIds : [],
  };
}

// Keep the round the screens hold AND its SWR entry in step with the server's
// list, so the hub renders the new chips without waiting for a revalidation.
function storeSavedFilters(round, list) {
  round.savedFilters = list;
  swrStore.set('round:' + round.id, round);
}

function savedFilterError(e) {
  if (e.message === 'filter_name_taken') return t('savedFilters.toast.nameTaken');
  if (e.message === 'quota_filters') return t('savedFilters.toast.quota');
  if (e.message === 'filters_changed') return t('savedFilters.toast.changed');
  return e.message;
}

// =================== The setup screen's save control ===================

/* „Filter speichern", beside the Filter trigger (#1346). `snapshot()` returns
   the screen's CURRENT state as the draw body would carry it — the caller owns
   that state, this only posts it. At the ceiling the button is disabled and says
   why in a visible line, never in a `title` a touch screen cannot show (the
   #1269 reasoning for the hub CTA's lock).

   Returns the button and the reason line SEPARATELY: the caller places them as
   two items of the setup filter bar — the button on the trigger's line, the
   reason on a line of its own after the chips — which one wrapper could not do.
   The label is its own span so a phone can clip it visually and keep it as the
   button's accessible name. */
function renderSaveFilterAction(round, snapshot) {
  const btn = h(`<button type="button" class="btn btn--ghost btn--sm setup-save__btn" aria-describedby="saveFilterReason"><i class="ti ti-bookmark" aria-hidden="true"></i><span class="setup-save__label">${esc(t('savedFilters.save'))}</span></button>`);
  const reason = h('<p class="muted setup-save__reason" id="saveFilterReason"></p>');
  const sync = () => {
    const full = savedFiltersFull(round);
    btn.disabled = full;
    reason.hidden = !full;
    reason.textContent = full ? t('savedFilters.limit', { n: savedFilterLimits.perRound }) : '';
  };
  btn.addEventListener('click', () => openSaveFilterSheet(round, snapshot(), sync));
  sync();
  return { btn, reason };
}

function openSaveFilterSheet(round, body, onSaved) {
  const max = savedFilterLimits.nameMax;
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('savedFilters.save'))}">
        <div class="sheet__head">
          <h2>${esc(t('savedFilters.save'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="field">
          <label for="savedFilterName">${esc(t('savedFilters.nameLabel'))}</label>
          <input id="savedFilterName" class="input" type="text" autocomplete="off"${max ? ` maxlength="${max}"` : ''}
                 placeholder="${esc(t('savedFilters.namePlaceholder'))}">
          <p class="muted field__hint">${esc(t('savedFilters.hint'))}</p>
        </div>
        <div class="toolbar sheet__actions">
          <button type="button" class="btn btn--primary btn--lg" id="savedFilterGo">${iconText('ti-bookmark', t('savedFilters.submit'))}</button>
        </div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const input = sheet.querySelector('#savedFilterName');
  document.body.appendChild(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  // After openSheet, synchronously — see showInvite for both reasons.
  input.focus();
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  let saving = false;
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return toast(t('savedFilters.toast.nameMissing'));
    if (saving) return;
    saving = true;
    try {
      const saved = await api('POST', `/api/rounds/${round.id}/filters`, { ...body, name });
      storeSavedFilters(round, [...(round.savedFilters || []), saved]);
      closeSheet();
      toast(t('savedFilters.toast.saved'));
      if (onSaved) onSaved();
    } catch (e) {
      toast(savedFilterError(e), { tone: 'error' });
    } finally {
      saving = false;
    }
  };
  sheet.querySelector('#savedFilterGo').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
}

// =================== Einstellungen: the list ===================

/* The round's saved filters with rename, delete and reorder — the tag screen's
   controls (#1004/#1159), in a vertical list, so the arrows say up/down rather
   than the tag tiles' „nach vorne/hinten". Every change re-renders through
   currentView(), which reads the SWR entry storeSavedFilters just updated.

   Returns the nodes to append; the heading is included so the section can be
   placed as one piece. */
function renderSavedFiltersSection(round) {
  const frag = document.createDocumentFragment();
  frag.appendChild(h(`<h2 class="rs-section__h" id="savedFiltersHeading">${esc(t('savedFilters.title'))}</h2>`));
  const list = round.savedFilters || [];
  if (!list.length) {
    frag.appendChild(h(`<p class="muted saved-filters__empty">${esc(t('savedFilters.empty'))}</p>`));
    return frag;
  }
  const base = `/api/rounds/${round.id}/filters`;
  const rerender = async (fid, cls) => {
    await currentView();
    // Re-rendering drops focus; hand it back to the control that was pressed
    // (or its partner, when the move reached an end), so a keyboard user can
    // press „Nach oben" three times and move ONE filter three places.
    if (!fid) return;
    const row = [...document.querySelectorAll('.saved-filter-row')].find((el) => el.dataset.fid === fid);
    const target = row && row.querySelector(cls);
    const partner = row && row.querySelector(cls === '.sf-act--up' ? '.sf-act--down' : '.sf-act--up');
    const el = target && !target.disabled ? target : partner;
    if (el) el.focus();
  };

  const box = h('<div class="ds-list saved-filters" aria-labelledby="savedFiltersHeading"></div>');
  list.forEach((sf, i) => {
    const row = h(`<div class="ds-row ds-row--static saved-filter-row">
        <div class="ds-row__main"><i class="ti ti-bookmark" aria-hidden="true"></i><span class="saved-filter-row__name">${esc(sf.name)}</span></div>
        <div class="ds-row__meta"></div>
      </div>`);
    row.dataset.fid = sf.id;
    const meta = row.querySelector('.ds-row__meta');
    const act = (icon, label, cls) => {
      const b = h(`<button type="button" class="tag-act ${cls}" aria-label="${esc(label)}" title="${esc(label)}"><i class="ti ${icon}" aria-hidden="true"></i></button>`);
      meta.appendChild(b);
      return b;
    };

    // Only worth showing once there is something to reorder; disabled rather
    // than hidden at the ends, so a row's control set never changes width.
    if (list.length > 1) {
      const move = async (delta, cls) => {
        const ids = list.map((f) => f.id);
        const [moved] = ids.splice(i, 1);
        ids.splice(i + delta, 0, moved);
        try {
          storeSavedFilters(round, await api('PATCH', `${base}/order`, { filterIds: ids }));
          await rerender(sf.id, cls);
        } catch (e) {
          toast(savedFilterError(e), { tone: 'error' });
          // `filters_changed`: another device saved or deleted one. The local
          // list is stale by definition, so take the server's.
          if (e.message === 'filters_changed') {
            storeSavedFilters(round, (await fetchRoundFresh(round.id)).savedFilters || []);
            currentView();
          }
        }
      };
      const up = act('ti-arrow-up', t('savedFilters.moveUp'), 'sf-act--up');
      const down = act('ti-arrow-down', t('savedFilters.moveDown'), 'sf-act--down');
      up.disabled = i === 0;
      down.disabled = i === list.length - 1;
      up.addEventListener('click', () => move(-1, '.sf-act--up'));
      down.addEventListener('click', () => move(1, '.sf-act--down'));
    }

    const edit = act('ti-pencil', t('savedFilters.rename'), 'sf-act--rename');
    edit.addEventListener('click', () => {
      const open = row.nextElementSibling;
      if (open && open.classList.contains('tag-edit')) { open.remove(); return; }
      const max = savedFilterLimits.nameMax;
      const editor = h(`<div class="tag-edit">
          <div class="toolbar">
            <input class="input" style="flex:1" value="${esc(sf.name)}"${max ? ` maxlength="${max}"` : ''}
                   aria-label="${esc(t('savedFilters.nameLabel'))}" />
            <button type="button" class="btn btn--primary">${esc(t('savedFilters.submit'))}</button>
          </div>
        </div>`);
      const nameInput = editor.querySelector('input');
      const save = async () => {
        const name = nameInput.value.trim();
        if (!name) return toast(t('savedFilters.toast.nameMissing'));
        try {
          const updated = await api('PATCH', `${base}/${sf.id}`, { name });
          storeSavedFilters(round, list.map((f) => (f.id === sf.id ? updated : f)));
          toast(t('savedFilters.toast.renamed'));
          await rerender();
        } catch (e) { toast(savedFilterError(e), { tone: 'error' }); }
      };
      editor.querySelector('.btn--primary').addEventListener('click', save);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
      });
      row.after(editor);
      nameInput.focus();
    });

    const del = act('ti-trash', t('savedFilters.delete'), 'tag-act--danger sf-act--delete');
    del.addEventListener('click', async () => {
      if (!await confirmDialog({
        body: t('savedFilters.deleteConfirm', { name: sf.name }),
        confirmLabel: t('savedFilters.delete'), icon: 'ti-trash',
      })) return;
      try {
        await api('DELETE', `${base}/${sf.id}`);
        storeSavedFilters(round, list.filter((f) => f.id !== sf.id));
        toast(t('savedFilters.toast.deleted'));
        await rerender();
      } catch (e) { toast(savedFilterError(e), { tone: 'error' }); }
    });

    box.appendChild(row);
  });
  frag.appendChild(box);
  return frag;
}
